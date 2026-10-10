//! Snapshots, restore and seek (ward timeline-001, contract `.wdd/epics/timeline.md` § T1).
//!
//! A `Timeline` owns one `World` (the position), the authoritative command log (inside that
//! world), the logs as of `head_tick`, and a budgeted store of periodic snapshots. Seeking
//! restores the newest snapshot at or before the target and replays deterministically, so the
//! result is bit-identical to an uninterrupted run. Nothing here reads a clock.

use std::collections::VecDeque;
use std::sync::Arc;

use crate::command::{Command, CommandError};
use crate::world::{CompletedTrip, GeneratedTrip, RemovalLog, World};

/// Ticks between periodic snapshots (1 sim minute).
pub const SNAPSHOT_INTERVAL_TICKS: u64 = 120;

/// Lengths of the append-only logs at a snapshot's tick.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LogLens {
    pub(crate) generated: usize,
    pub(crate) completed: usize,
    pub(crate) removed: usize,
}

/// The append-only logs of a world.
#[derive(Clone, Debug, Default)]
pub(crate) struct Logs {
    pub(crate) generated: Vec<GeneratedTrip>,
    pub(crate) completed: Vec<CompletedTrip>,
    pub(crate) removed: RemovalLog,
}

impl Logs {
    /// A copy of the first `lens` entries of each log.
    fn prefix(&self, lens: LogLens) -> Logs {
        Logs {
            generated: self.generated[..lens.generated].to_vec(),
            completed: self.completed[..lens.completed].to_vec(),
            removed: self.removed[..lens.removed].to_vec(),
        }
    }
}

/// Everything in a `World` that affects the future, at one tick: no logs (their lengths only),
/// no command log, no router, and the network and demand shared, not copied.
///
/// Field classification (every `World` field; `World::snapshot` names each one):
/// - snapshotted: tick, slots (vehicles incl. routes, retry schedule, blocked ticks,
///   reroute flags), free, lanes, credit, rr_next, origin_buffers, exit_count,
///   next_trip_id, spawned, completed, removed, removed_gridlock, completed_tt_sum,
///   demand_seed, behavior_rng, free_flow, smoothed, cost_keys, exit_time_sum,
///   exit_time_n, cost_epoch, closed, priority_queue, periodic_queue, reroute_stats;
/// - shared (`Arc`, not counted): network, demand;
/// - logs (lengths only): generated, completed_log, removed_log;
/// - owned by the timeline: command_log;
/// - derived (empty in the snapshot): router.
#[derive(Clone, Debug)]
pub struct Snapshot {
    state: World,
    lens: LogLens,
    bytes: usize,
}

impl Snapshot {
    pub(crate) fn new(state: World, lens: LogLens) -> Snapshot {
        let bytes = state.state_bytes();
        Snapshot { state, lens, bytes }
    }

    pub fn tick(&self) -> u64 {
        self.state.tick()
    }

    /// Owned bytes (capacity × element size) of the snapshotted state.
    pub fn bytes(&self) -> usize {
        self.bytes
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimelineError {
    /// `tick` is not in `[window_start, head_tick]`.
    OutsideWindow { tick: u64, window_start: u64, head_tick: u64 },
}

/// The retained replay window and its memory, as the UI shows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowInfo {
    pub window_start: u64,
    pub head_tick: u64,
    pub position_tick: u64,
    pub snapshot_bytes: usize,
    pub budget_bytes: usize,
    pub snapshots: usize,
}

#[derive(Clone, Debug)]
pub struct Timeline {
    world: World,
    /// Ascending by tick.
    /// Shared (`Arc`): a branch keeps its parent's snapshots below the branch tick without copying them.
    snapshots: VecDeque<Arc<Snapshot>>,
    snapshot_bytes: usize,
    budget_bytes: usize,
    head_tick: u64,
    /// The logs as of `head_tick`, held aside once a seek moved the position world off them.
    /// Invariant: `None` ⇒ position == head (the position world holds the head logs). It may stay
    /// `Some` at the head right after a seek; the next step clears it.
    head_logs: Option<Logs>,
    last_seek_replayed: u64,
}

impl Timeline {
    /// Starts at `world`'s tick and snapshots it at once.
    pub fn new(world: World, budget_bytes: usize) -> Timeline {
        let head_tick = world.tick();
        let mut t = Timeline {
            world,
            snapshots: VecDeque::new(),
            snapshot_bytes: 0,
            budget_bytes,
            head_tick,
            head_logs: None,
            last_seek_replayed: 0,
        };
        t.push_snapshot();
        t
    }

    /// The world at the position.
    pub fn world(&self) -> &World {
        &self.world
    }

    pub fn position_tick(&self) -> u64 {
        self.world.tick()
    }

    pub fn head_tick(&self) -> u64 {
        self.head_tick
    }

    pub fn window(&self) -> WindowInfo {
        WindowInfo {
            window_start: self.window_start(),
            head_tick: self.head_tick,
            position_tick: self.position_tick(),
            snapshot_bytes: self.snapshot_bytes,
            budget_bytes: self.budget_bytes,
            snapshots: self.snapshots.len(),
        }
    }

    pub fn snapshot_ticks(&self) -> Vec<u64> {
        self.snapshots.iter().map(|s| s.tick()).collect()
    }

    /// Ticks the last `seek` stepped after restoring.
    pub fn last_seek_replayed_ticks(&self) -> u64 {
        self.last_seek_replayed
    }

    /// One tick: a replay below the head, new history at it.
    pub fn step(&mut self) {
        self.world.step();
        let tick = self.world.tick();
        if tick >= self.head_tick {
            self.head_tick = tick;
            // caught up: the position world's logs are the head logs again (determinism)
            self.head_logs = None;
        }
        let newest = self.snapshots.back().map_or(0, |s| s.tick());
        if tick.is_multiple_of(SNAPSHOT_INTERVAL_TICKS) && (self.snapshots.is_empty() || tick > newest) {
            self.push_snapshot();
        }
    }

    pub fn step_n(&mut self, n: u64) {
        for _ in 0..n {
            self.step();
        }
    }

    /// Restore the newest snapshot ≤ `tick` and replay to it.
    pub fn seek(&mut self, tick: u64) -> Result<(), TimelineError> {
        let window_start = self.window_start();
        if tick < window_start || tick > self.head_tick {
            return Err(TimelineError::OutsideWindow { tick, window_start, head_tick: self.head_tick });
        }
        let idx = self.snapshots.partition_point(|s| s.tick() <= tick) - 1;
        if self.head_logs.is_none() {
            self.head_logs = Some(self.world.take_logs());
        }
        let snap = &self.snapshots[idx];
        let logs = self.head_logs.as_ref().expect("set above").prefix(snap.lens);
        let commands = self.world.take_commands();
        self.world = World::restored(&snap.state, commands, logs);
        let replay = tick - snap.tick();
        for _ in 0..replay {
            self.step();
        }
        self.last_seek_replayed = replay;
        Ok(())
    }

    /// Schedule a command. Below the head this edits the future: snapshots, commands and logs
    /// after the position are dropped first (commands *at* the position stay pending).
    pub fn schedule(&mut self, cmd: Command) -> Result<(), CommandError> {
        self.world.validate(&cmd)?;
        let position = self.position_tick();
        if position < self.head_tick {
            while self.snapshots.back().is_some_and(|s| s.tick() > position) {
                let s = self.snapshots.pop_back().expect("checked");
                self.snapshot_bytes -= s.bytes();
            }
            self.world.drop_commands_after(position);
            self.head_logs = None; // the position world's logs (as of the position) are the history now
            self.head_tick = position;
        }
        self.world.schedule(cmd)
    }

    /// An independent timeline from `at` (contract T2): the state at `at`, the commands before it,
    /// the logs as of it, copies of the retained snapshots before it plus one at it (within
    /// `budget_bytes`). `self` is not modified; only `Arc` data is shared.
    pub fn branch(&self, at: u64, budget_bytes: usize) -> Result<Timeline, TimelineError> {
        let window_start = self.window_start();
        if at < window_start || at > self.head_tick {
            return Err(TimelineError::OutsideWindow { tick: at, window_start, head_tick: self.head_tick });
        }
        let idx = self.snapshots.partition_point(|s| s.tick() <= at) - 1;
        let snap = &self.snapshots[idx];
        let logs = match &self.head_logs {
            Some(h) => h.prefix(snap.lens),
            None => self.world.logs_prefix(snap.lens),
        };
        let commands: Vec<Command> = self.world.command_log().iter().copied().filter(|c| c.tick < at).collect();
        let mut world = World::restored(&snap.state, commands, logs);
        for _ in snap.tick()..at {
            world.step();
        }
        let mut b = Timeline {
            world,
            snapshots: VecDeque::new(),
            snapshot_bytes: 0,
            budget_bytes,
            head_tick: at,
            head_logs: None,
            last_seek_replayed: 0,
        };
        // shared, not copied (ward polish-005): only pointers; the budget evicts what B cannot keep
        for s in self.snapshots.iter().take_while(|s| s.tick() < at) {
            b.add_snapshot(Arc::clone(s));
        }
        b.push_snapshot();
        Ok(b)
    }

    fn window_start(&self) -> u64 {
        self.snapshots.front().map_or(self.head_tick, |s| s.tick())
    }

    fn push_snapshot(&mut self) {
        let s = Arc::new(self.world.snapshot());
        self.add_snapshot(s);
    }

    /// How many snapshots this timeline shares (the same `Arc`) with `other` (ward polish-005).
    pub fn shared_snapshots(&self, other: &Timeline) -> usize {
        self.snapshots.iter().filter(|s| other.snapshots.iter().any(|o| Arc::ptr_eq(s, o))).count()
    }

    /// Append a snapshot (newest) and evict the oldest ones beyond the budget.
    fn add_snapshot(&mut self, s: Arc<Snapshot>) {
        self.snapshot_bytes += s.bytes();
        self.snapshots.push_back(s);
        while self.snapshot_bytes > self.budget_bytes && self.snapshots.len() > 1 {
            let old = self.snapshots.pop_front().expect("more than one");
            self.snapshot_bytes -= old.bytes();
        }
    }
}

//! Ward motion-003, test 1: `Timeline::exits_at` reads cumulative exit counts from the retained snapshots
//! (read-only: the world's state and hash are untouched).

use sim_core::cities::river_city;
use sim_core::{Command, CommandKind, LinkId, Timeline, World, SNAPSHOT_INTERVAL_TICKS};

const UNLIMITED: usize = usize::MAX;
const CLOSE_AT: u64 = 600;
const RUN_TO: u64 = 3000;

fn close(l: LinkId, tick: u64) -> Command {
    Command { tick, kind: CommandKind::CloseLink(l) }
}

fn world(cmds: &[Command]) -> World {
    let c = river_city(17, 23);
    let mut w = World::from_scenario(c.scenario).expect("valid scenario");
    for cmd in cmds {
        w.schedule(*cmd).expect("valid command");
    }
    w
}

fn commands() -> Vec<Command> {
    let lm = river_city(17, 23).landmarks;
    vec![close(lm.central_bridge[0], CLOSE_AT), close(lm.central_bridge[1], CLOSE_AT)]
}

/// Exit counts of every link at every tick 0..=RUN_TO, from an uninterrupted twin world.
fn twin_counts(cmds: &[Command]) -> (Vec<LinkId>, Vec<Vec<u64>>) {
    let mut w = world(cmds);
    let links: Vec<LinkId> = (0..w.network().links().len() as u32).map(LinkId).collect();
    let mut at = vec![links.iter().map(|&l| w.link_exit_count(l)).collect::<Vec<u64>>()];
    for _ in 0..RUN_TO {
        w.step();
        at.push(links.iter().map(|&l| w.link_exit_count(l)).collect());
    }
    (links, at)
}

#[test]
fn exits_at_reads_snapshots() {
    let cmds = commands();
    let (links, twin) = twin_counts(&cmds);
    let mut t = Timeline::new(world(&cmds), UNLIMITED);
    t.step_n(RUN_TO);
    let hash = t.world().state_hash();

    // every snapshot tick: the twin's counts at that tick, with base = that tick
    let snaps = t.snapshot_ticks();
    assert!(snaps.len() >= 20, "snapshots in the window");
    let mut checked_nonzero = false;
    for &s in &snaps {
        let (base, counts) = t.exits_at(s, &links).expect("a snapshot at its own tick");
        assert_eq!(base, s);
        assert_eq!(counts, twin[s as usize], "exit counts at snapshot tick {s}");
        checked_nonzero |= counts.iter().any(|&c| c > 0);
        // between snapshots: the newest snapshot at or before
        if s + 50 < RUN_TO {
            let (b2, c2) = t.exits_at(s + 50, &links).unwrap();
            let expect = s + 50 - (s + 50) % SNAPSHOT_INTERVAL_TICKS;
            assert_eq!(b2, expect, "base for tick {}", s + 50);
            assert_eq!(c2, twin[expect as usize]);
        }
    }
    assert!(checked_nonzero, "vehicles left links (the counts are not all zero)");

    // at or after the position: the current world, base = position
    for q in [RUN_TO, RUN_TO + 1000] {
        let (base, counts) = t.exits_at(q, &links).unwrap();
        assert_eq!(base, RUN_TO);
        assert_eq!(counts, twin[RUN_TO as usize]);
    }

    // a subset of links, in the given order
    let some = [links[7], links[3], links[7]];
    let (_, c) = t.exits_at(1200, &some).unwrap();
    assert_eq!(c, vec![twin[1200][7], twin[1200][3], twin[1200][7]]);

    // read-only
    for _ in 0..200 {
        let _ = t.exits_at(snaps[snaps.len() / 2], &links);
    }
    assert_eq!(t.world().state_hash(), hash, "exits_at leaves the world untouched");

    // after a seek: the same answers as the uninterrupted run (below the position from snapshots)
    t.seek(1800).expect("inside the window");
    let (base, counts) = t.exits_at(1800, &links).unwrap();
    assert_eq!(base, 1800);
    assert_eq!(counts, twin[1800]);
    let (base, counts) = t.exits_at(1250, &links).unwrap();
    assert_eq!(base, 1200);
    assert_eq!(counts, twin[1200]);
    assert_eq!(t.exits_at(2400, &links).unwrap(), (1800, twin[1800].clone()), "at or after the position: the position world");
}

#[test]
fn exits_at_outside_the_window_is_none() {
    let cmds = commands();
    // a small budget evicts the oldest snapshots
    let mut t = Timeline::new(world(&cmds), 6 * 1024 * 1024);
    t.step_n(RUN_TO);
    let first = t.snapshot_ticks()[0];
    assert!(first > 0, "the budget evicted the oldest snapshots (window starts at {first})");
    let links = [LinkId(0)];
    assert!(t.exits_at(first - 1, &links).is_none(), "before the window");
    assert_eq!(t.exits_at(first, &links).map(|(b, _)| b), Some(first));
}

#[test]
fn exits_at_in_a_branch_starts_at_the_branch_tick() {
    let lm = river_city(17, 23).landmarks;
    let mut a = Timeline::new(world(&[]), UNLIMITED);
    a.step_n(2000);
    let at = 1500;
    let mut b = a.branch(at, UNLIMITED).expect("inside the window");
    b.schedule(close(lm.central_bridge[0], at)).unwrap();
    b.schedule(close(lm.central_bridge[1], at)).unwrap();
    let links: Vec<LinkId> = (0..a.world().network().links().len() as u32).map(LinkId).collect();
    let (ba, ca) = a.exits_at(at, &links).unwrap();
    let (bb, cb) = b.exits_at(at, &links).unwrap();
    assert_eq!(bb, at, "B has a snapshot at its branch tick");
    // A's newest snapshot at or before the branch tick may be older: compare with A's twin at `at`
    let (_, twin) = twin_counts(&[]);
    assert_eq!(cb, twin[at as usize], "B at the branch tick = A's world at the branch tick");
    assert_eq!(ca, twin[ba as usize]);
    b.step_n(400);
    let (now, cnow) = b.exits_at(at + 400, &links).unwrap();
    assert_eq!(now, at + 400);
    assert!(cnow.iter().zip(&cb).all(|(n, s)| n >= s), "cumulative: never below the branch value");
}

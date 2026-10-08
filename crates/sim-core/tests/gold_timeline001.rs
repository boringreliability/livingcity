//! Ward timeline-001, regressions for the Red r3 MINORs (the approved test file stays frozen).

use sim_core::cities::three_bridges;
use sim_core::{Command, CommandKind, Timeline, TimelineError, World};

/// `WindowInfo::snapshot_bytes` is exactly Σ `Snapshot::bytes()` (the UI shows it against the budget).
#[test]
fn window_bytes_are_the_sum_of_snapshot_bytes() {
    let c = three_bridges(2026, 7);
    let w = World::from_scenario(c.scenario.clone()).unwrap();
    let tl = Timeline::new(w.clone(), usize::MAX);
    assert_eq!(tl.window().snapshot_bytes, w.snapshot().bytes());
    let mut tl = Timeline::new(w, usize::MAX);
    let mut sum = tl.window().snapshot_bytes;
    let mut probe = World::from_scenario(c.scenario.clone()).unwrap();
    for _ in 0..1200 {
        tl.step();
        probe.step();
        if probe.tick().is_multiple_of(120) {
            sum += probe.snapshot().bytes();
        }
        assert_eq!(tl.window().snapshot_bytes, sum, "tick {}", probe.tick());
    }
    assert!(sum > 0);
}

/// Right after an edit below the head, the old future is gone: seeking into it is refused.
#[test]
fn seek_past_the_new_head_after_an_edit_is_refused() {
    let c = three_bridges(2026, 7);
    let main = c.landmarks.central_bridge;
    let mut tl = Timeline::new(World::from_scenario(c.scenario.clone()).unwrap(), usize::MAX);
    tl.step_n(3600);
    tl.seek(1200).unwrap();
    tl.schedule(Command { tick: 1200, kind: CommandKind::CloseLink(main[0]) }).unwrap();
    assert_eq!(tl.seek(1500), Err(TimelineError::OutsideWindow { tick: 1500, window_start: 0, head_tick: 1200 }));
    assert_eq!(tl.position_tick(), 1200);
}

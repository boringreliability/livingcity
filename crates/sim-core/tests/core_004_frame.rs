//! Ward core-004 (Rust side): compact frame encoding at the worker boundary.
//! Contract: `.wdd/epics/core.md` § Frame / boundary format.

use sim_core::cities::three_bridges;
use sim_core::frame::{
    metrics_to_array, write_link_stats, write_vehicle_records, NetworkExport, FLAG_LANE_SHIFT, FLAG_ON_CLOSED_LINK,
    FLAG_QUEUED, FLAG_STRANDED, METRIC_NAMES, VEHICLE_RECORD_WORDS,
};
use sim_core::params::QUEUED_SPEED;
use sim_core::{Command, CommandKind, World};

/// three_bridges after 10 min, with every bridge closed 10 ticks earlier so
/// that vehicles are still on closed links and some are stranded.
fn busy_world() -> World {
    let c = three_bridges(17, 23);
    let mut w = World::from_scenario(c.scenario).unwrap();
    for b in [c.landmarks.north_bridge, c.landmarks.central_bridge, c.landmarks.south_bridge] {
        for l in b {
            w.schedule(Command { tick: 1190, kind: CommandKind::CloseLink(l) }).unwrap();
        }
    }
    for _ in 0..1200 {
        w.step();
    }
    w
}

#[test]
fn frame_records_encode_link_s_v_flags() {
    // Given a busy world with closed links and stranded vehicles
    let w = busy_world();
    // When the vehicle records are written
    let mut out = vec![0xDEAD_BEEF; 7]; // must be cleared first
    let count = write_vehicle_records(&w, &mut out);
    assert_eq!(out.len(), count as usize * VEHICLE_RECORD_WORDS);
    // Then the count is the on-network vehicles
    assert_eq!(count as u64, w.metrics().on_network);

    // And the records equal an independent walk: links ascending → lanes → front first
    let mut expected: Vec<[u32; 4]> = Vec::new();
    for link in w.network().links() {
        for view in w.link_vehicles(link.id) {
            let stranded = w.vehicle(view.id).unwrap().stranded;
            let mut flags = (view.lane as u32) << FLAG_LANE_SHIFT;
            if view.v < QUEUED_SPEED {
                flags |= FLAG_QUEUED;
            }
            if w.is_closed(link.id) {
                flags |= FLAG_ON_CLOSED_LINK;
            }
            if stranded {
                flags |= FLAG_STRANDED;
            }
            expected.push([link.id.0, (view.s as f32).to_bits(), (view.v as f32).to_bits(), flags]);
        }
    }
    let got: Vec<[u32; 4]> = out.chunks(4).map(|c| [c[0], c[1], c[2], c[3]]).collect();
    assert_eq!(got, expected);
    // And s/v round-trip through f32 bits
    for r in &got {
        let s = f32::from_bits(r[1]);
        let len = w.network().link(sim_core::LinkId(r[0])).length_m as f32;
        assert!(s.is_finite() && s >= 0.0 && s <= len + 1e-3);
    }
    // And every flag kind occurs (non-vacuous)
    for flag in [FLAG_QUEUED, FLAG_ON_CLOSED_LINK, FLAG_STRANDED] {
        assert!(got.iter().any(|r| r[3] & flag != 0), "flag {flag:#x} never set");
    }
    assert!(got.iter().any(|r| (r[3] >> FLAG_LANE_SHIFT) & 0xFF == 1), "no lane-1 vehicle");
}

#[test]
fn link_stats_match_world() {
    // Given a busy world
    let w = busy_world();
    // When link stats are written into dirty buffers
    let (mut counts, mut queued) = (vec![9u16; 3], vec![9u16; 3]);
    write_link_stats(&w, &mut counts, &mut queued);
    // Then each link's counts match the world exactly
    let n = w.network().links().len();
    assert_eq!((counts.len(), queued.len()), (n, n));
    for link in w.network().links() {
        let views = w.link_vehicles(link.id);
        assert_eq!(counts[link.id.index()] as usize, views.len());
        assert_eq!(queued[link.id.index()] as usize, views.iter().filter(|v| v.v < QUEUED_SPEED).count());
    }
    assert!(queued.iter().any(|&q| q > 0));
}

#[test]
fn network_export_matches_network() {
    // Given the test city's network
    let c = three_bridges(1, 1);
    let net = &c.scenario.network;
    // When exported
    let e = NetworkExport::new(net);
    // Then the arrays mirror it exactly
    assert_eq!(e.node_xy.len(), 2 * net.nodes().len());
    assert_eq!(e.node_is_zone.len(), net.nodes().len());
    for node in net.nodes() {
        let i = node.id.index();
        assert_eq!((e.node_xy[2 * i], e.node_xy[2 * i + 1]), (node.x_m as f32, node.y_m as f32));
        assert_eq!(e.node_is_zone[i], net.is_zone(node.id) as u8);
    }
    let n = net.links().len();
    for len in [e.link_from.len(), e.link_to.len(), e.link_lanes.len(), e.link_length.len(), e.link_speed.len()] {
        assert_eq!(len, n);
    }
    for l in net.links() {
        let i = l.id.index();
        assert_eq!(e.link_from[i], l.from.0);
        assert_eq!(e.link_to[i], l.to.0);
        assert_eq!(e.link_lanes[i], l.lanes);
        assert_eq!(e.link_length[i], l.length_m as f32);
        assert_eq!(e.link_speed[i], l.speed_limit_mps as f32);
    }
    assert_eq!(e.node_is_zone.iter().filter(|&&z| z == 1).count(), 6);
}

#[test]
fn metrics_array_matches_names() {
    // Then the names are exactly the Metrics fields, in order
    assert_eq!(
        METRIC_NAMES,
        &[
            "tick",
            "sim_time_s",
            "trips_generated",
            "spawned",
            "active",
            "on_network",
            "waiting_at_origin",
            "no_route",
            "stranded",
            "queued",
            "completed",
            "removed_unreachable",
            "unreachable",
            "mean_travel_time_s",
            "incomplete",
            "mean_incomplete_age_s",
        ]
    );
    // When converting a fresh world's metrics, None → NaN
    let c = three_bridges(1, 1);
    let fresh = World::from_scenario(c.scenario.clone()).unwrap();
    let a = metrics_to_array(&fresh.metrics());
    assert_eq!(a.len(), METRIC_NAMES.len());
    assert!(a[13].is_nan() && a[15].is_nan());

    // And for a busy world every value equals its field
    let w = busy_world();
    let m = w.metrics();
    let a = metrics_to_array(&m);
    let want = [
        m.tick as f64,
        m.sim_time_s,
        m.trips_generated as f64,
        m.spawned as f64,
        m.active as f64,
        m.on_network as f64,
        m.waiting_at_origin as f64,
        m.no_route as f64,
        m.stranded as f64,
        m.queued as f64,
        m.completed as f64,
        m.removed_unreachable as f64,
        m.unreachable as f64,
        m.mean_travel_time_s.unwrap(),
        m.incomplete as f64,
        m.mean_incomplete_age_s.unwrap(),
    ];
    assert_eq!(a, want);
}

#[test]
fn empty_world_encodes_nothing_and_clears_buffers() {
    // Given a fresh world (no vehicles yet) and dirty output buffers
    let c = three_bridges(1, 1);
    let w = World::from_scenario(c.scenario).unwrap();
    let mut out = vec![1u32; 9];
    let (mut counts, mut queued) = (vec![7u16; 2], vec![7u16; 200]);
    // When encoded
    let n = write_vehicle_records(&w, &mut out);
    write_link_stats(&w, &mut counts, &mut queued);
    // Then nothing is left over from the previous contents
    assert_eq!(n, 0);
    assert!(out.is_empty());
    let links = w.network().links().len();
    assert_eq!(counts, vec![0u16; links]);
    assert_eq!(queued, vec![0u16; links]);
}

//! Ward polish-003, test 1: each vehicle record's next link, for the renderer's junction curves.

use sim_core::cities::{river_city, three_bridges};
use sim_core::frame::{write_next_links, write_vehicle_records, NO_NEXT_LINK, VEHICLE_RECORD_WORDS};
use sim_core::{Command, CommandKind, World};

fn three_bridges_closed() -> World {
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

fn river_city_busy() -> World {
    let c = river_city(2026, 7);
    let mut w = World::from_scenario(c.scenario).unwrap();
    for l in c.landmarks.central_bridge {
        w.schedule(Command { tick: 3540, kind: CommandKind::CloseLink(l) }).unwrap();
    }
    for _ in 0..3600 {
        w.step();
    }
    w
}

fn check(w: &World, label: &str) {
    let hash = w.state_hash();
    let mut records = Vec::new();
    let count = write_vehicle_records(w, &mut records) as usize;
    let mut next = vec![7u16; 3]; // must be cleared first
    write_next_links(w, &mut next);
    assert_eq!(next.len(), count, "{label}: one entry per record");
    assert_eq!(records.len(), count * VEHICLE_RECORD_WORDS);
    // the expected next link of each record's vehicle, in record order (trip ids share that order)
    let mut trips = Vec::new();
    w.for_each_on_network_trip(|t| trips.push(t));
    assert_eq!(trips.len(), count);
    let mut none = 0usize;
    for (i, &trip) in trips.iter().enumerate() {
        let v = w.vehicle_by_trip(trip).expect("record vehicle is live");
        assert_eq!(records[4 * i], v.route[v.route_pos].0, "{label}: record {i} is on its route's current link");
        // a stranded vehicle has no valid way on: nothing to curve towards
        let expected = if v.stranded {
            NO_NEXT_LINK
        } else {
            v.route.get(v.route_pos + 1).map_or(NO_NEXT_LINK, |l| u16::try_from(l.0).expect("link id fits u16"))
        };
        assert_eq!(next[i], expected, "{label}: record {i} (trip {trip})");
        if next[i] == NO_NEXT_LINK {
            none += 1;
        }
    }
    // non-vacuous: both kinds occur in a busy city
    assert!(none >= 1, "{label}: some vehicles are on their final link ({none}/{count})");
    assert!(none * 2 <= count, "{label}: at least half have a next link ({none}/{count})");
    // reading only
    assert_eq!(w.state_hash(), hash, "{label}: encoding changed the world");
}

#[test]
fn next_links_follow_routes() {
    check(&river_city_busy(), "river_city");
    check(&three_bridges_closed(), "three_bridges closed");
    assert_eq!(NO_NEXT_LINK, u16::MAX);
}

// Ward city-003: vehicle and road inspection through wasm, the host and picking.
import { expect, test } from 'vitest';

import { Camera } from '../src/render/camera';
import type { LinkGeom } from '../src/render/geometry';
import { pickVehicle } from '../src/render/picking';
import { decodeVehicles } from '../src/sim/frame';
import { createSimHost, type SimLike } from '../src/sim/host';
import {
  FLAG_QUEUED,
  FLAG_STRANDED,
  decodeLinkDetail,
  decodeVehicleDetail,
  type FrameMessage,
  type FromWorker,
  type ReadyMessage,
  type ToWorker,
  type TrackedGone,
  type TrackedVehicle,
} from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

const isGone = (t: TrackedVehicle | TrackedGone | null): t is TrackedGone => !!t && 'gone' in t;

/** Host on real wasm River City with fake time; keeps the Sim for direct queries and counts
 * the inspection queries the host makes (per `iterate()`). */
function riverHost() {
  const memory = loadWasm();
  let t = 0;
  let sim: Sim | undefined;
  const posted: FromWorker[] = [];
  const calls: Record<string, number> = {};
  const counted = ['vehicle_detail', 'trip_outcome', 'link_detail'];
  const h = createSimHost({
    createSim: (d, b) => {
      sim = Sim.river_city(d, b);
      const target = sim as unknown as Record<string | symbol, unknown>;
      return new Proxy(target, {
        get: (o, prop) => {
          const v = o[prop];
          if (typeof v !== 'function') return v;
          const f = (v as (...a: unknown[]) => unknown).bind(o);
          if (typeof prop === 'string' && counted.includes(prop))
            return (...a: unknown[]) => {
              calls[prop] = (calls[prop] ?? 0) + 1;
              return f(...a);
            };
          return f;
        },
      }) as unknown as SimLike;
    },
    memory: () => memory,
    post: (msg) => posted.push(msg),
    now: () => t,
  });
  const send = (m: ToWorker) => h.handle(m);
  const frames = () => posted.filter((m): m is FrameMessage => m.type === 'frame');
  /** Run iterations; asserts the per-iteration query budget (≤ 1 of each inspection query). */
  const advance = (iterations: number) => {
    for (let k = 0; k < iterations; k++) {
      t += 16;
      for (const c of counted) calls[c] = 0;
      h.iterate();
      for (const c of counted) expect(calls[c] ?? 0, `${c} calls in one iteration`).toBeLessThanOrEqual(1);
    }
  };
  send({ type: 'init', demandSeed: 2026, behaviorSeed: 7 });
  send({ type: 'setSpeed', multiplier: 60 });
  send({ type: 'setRunning', running: true });
  const ready = posted.find((m): m is ReadyMessage => m.type === 'ready')!;
  return { h, send, frames, advance, ready, sim: () => sim! };
}

// 6
test('vehicle_detail_layout_roundtrip', () => {
  const memory = loadWasm();
  const sim = Sim.river_city(2026, 7);
  sim.step(1200);
  const count = sim.encode_frame();
  const tick = sim.tick();
  const words = new Uint32Array(memory.buffer, sim.frame_ptr(), sim.frame_words()).slice();
  const rec = decodeVehicles(words.buffer, count);
  expect(count).toBeGreaterThan(500);
  for (let i = 0; i < count; i += 37) {
    const trip = sim.trip_at_record(tick, i);
    expect(trip).toBeGreaterThanOrEqual(0);
    const d = decodeVehicleDetail(sim.vehicle_detail(trip))!;
    expect(d).not.toBeNull();
    expect(d.tripId).toBe(trip);
    // Then the detail is that record's vehicle
    expect(d.link).toBe(rec.link(i));
    expect(d.lane).toBe(rec.lane(i));
    expect(Math.fround(d.s)).toBe(rec.s(i));
    // And its state agrees with the record's flags
    const f = rec.flags(i);
    const expected = f & FLAG_STRANDED ? 'stranded' : f & FLAG_QUEUED ? 'queued' : 'driving';
    expect(d.state).toBe(expected);
    // And the remaining route starts with the current link
    expect(d.route[0]).toBe(rec.link(i));
    expect(d.ageS).toBeGreaterThanOrEqual(0);
  }
  // A trip that is not live decodes to null; out-of-range records give −1
  expect(decodeVehicleDetail(sim.vehicle_detail(1e12))).toBeNull();
  expect(sim.trip_at_record(tick, count + 5)).toBe(-1);
}, 30_000);

// 7
test('worker_tracks_one_vehicle', () => {
  const r = riverHost();
  r.advance(150);
  const f = r.frames().at(-1)!;
  // Given a vehicle on its final link with ≥ 30 m to go (it completes soon, not immediately)
  const sim = r.sim();
  const len = r.ready.network.linkLength;
  let record = -1;
  let trip = -1;
  for (let i = 0; i < f.count; i++) {
    const t = sim.trip_at_record(f.tick, i);
    const d = decodeVehicleDetail(sim.vehicle_detail(t));
    if (d && d.route.length === 1 && len[d.link]! - d.s >= 30) {
      record = i;
      trip = t;
      break;
    }
  }
  expect(record).toBeGreaterThanOrEqual(0); // (precondition: measured 6 final-link vehicles at tick ≈ 288)
  // When it is inspected
  r.send({ type: 'inspectVehicle', frameTick: f.tick, record });
  const seen = r.frames().length;
  r.advance(400);
  const after = r.frames().slice(seen);
  // Then frames carry it until exactly one `gone` (completed, with its travel time), then null
  const goneIdx = after.findIndex((m) => isGone(m.tracked));
  expect(goneIdx).toBeGreaterThan(0);
  for (const m of after.slice(0, goneIdx)) {
    expect(m.tracked && !isGone(m.tracked) ? m.tracked.tripId : null).toBe(trip);
  }
  const gone = after[goneIdx]!.tracked as TrackedGone;
  expect(gone).toMatchObject({ gone: true, tripId: trip, outcome: 'completed' });
  expect(gone.travelTimeS).toBeGreaterThan(0);
  for (const m of after.slice(goneIdx + 1)) expect(m.tracked).toBeNull();
}, 60_000);

// 8
test('pick_resolves_against_the_frames_tick', () => {
  const r = riverHost();
  r.advance(60);
  const old = r.frames().at(-1)!;
  const sim = r.sim();
  const before: number[] = [];
  for (let i = 0; i < old.count; i++) before.push(sim.trip_at_record(old.tick, i));
  // Time passes: the frame the user clicked on is a few frames old
  r.advance(4);
  const now = r.frames().at(-1)!;
  expect(now.tick).toBeGreaterThan(old.tick);
  const record = before.findIndex((t, i) => sim.trip_at_record(now.tick, i) !== t);
  expect(record).toBeGreaterThanOrEqual(0); // (precondition: some record now holds another vehicle)
  // When the pick from the old frame arrives
  r.send({ type: 'inspectVehicle', frameTick: old.tick, record });
  r.advance(2);
  const tracked = r.frames().at(-1)!.tracked;
  // Then it is the vehicle that was at that record in that frame
  expect(tracked && !isGone(tracked) ? tracked.tripId : null).toBe(before[record]);

  // And a frame that is no longer retained selects nothing
  r.send({ type: 'inspectVehicle', clear: true });
  r.advance(30);
  r.send({ type: 'inspectVehicle', frameTick: old.tick, record });
  r.advance(2);
  expect(r.frames().at(-1)!.tracked).toBeNull();
}, 60_000);

// 9
test('pickVehicle_nearest_within_tolerance', () => {
  // Given one horizontal 1-lane link from (0,0) to (100,0) and a camera at 1 px/m
  const link: LinkGeom = {
    id: 0,
    x0: 0,
    y0: 0,
    x1: 100,
    y1: 0,
    nx: 0,
    ny: -1,
    width: 3.5,
    lanes: 1,
    length: 100,
  } as LinkGeom;
  const cam = new Camera();
  cam.setViewport(200, 200);
  cam.cx = 50;
  cam.cy = 0;
  cam.zoom = 1;
  // three records on link 0 at s = 20, 25, 25 (the last two coincide)
  const buf = new ArrayBuffer(3 * 16);
  const w = new Uint32Array(buf);
  const fl = new Float32Array(buf);
  [20, 25, 25].forEach((s, i) => {
    w[4 * i] = 0;
    fl[4 * i + 1] = s;
    fl[4 * i + 2] = 0;
    w[4 * i + 3] = 0;
  });
  const v = decodeVehicles(buf, 3);
  const at = (s: number) => cam.worldToScreen(s, 0);
  // Then the nearest centre within 8 px wins
  expect(pickVehicle(v, [link], cam, ...at(21))).toBe(0);
  // ties → lower record
  expect(pickVehicle(v, [link], cam, ...at(25))).toBe(1);
  // beyond the tolerance → nothing
  const [sx, sy] = at(20);
  expect(pickVehicle(v, [link], cam, sx, sy + 9)).toBeNull();
  expect(pickVehicle(v, [link], cam, sx, sy + 7)).toBe(0);
  expect(pickVehicle(v, [link], cam, sx, sy + 9, 12)).toBe(0);
});

// 10
test('link_detail_capacity', () => {
  loadWasm();
  const sim = Sim.river_city(2026, 7);
  sim.step(600);
  const lm = JSON.parse(sim.landmarks_json()) as { south_bridge: [number, number]; central_bridge: [number, number] };
  const sat = sim.link_sat_flow();
  const lanes = sim.link_lanes();
  const old = decodeLinkDetail(lm.south_bridge[0], sim.link_detail(lm.south_bridge[0]));
  expect(old.link).toBe(lm.south_bridge[0]);
  expect(old.capacityVph).toBeLessThanOrEqual(900);
  expect(old.capacityVph).toBeCloseTo(lanes[lm.south_bridge[0]]! * sat[lm.south_bridge[0]]! * 3600, 3);
  const main = decodeLinkDetail(lm.central_bridge[0], sim.link_detail(lm.central_bridge[0]));
  expect(main.capacityVph).toBeCloseTo(3600, 6);
  for (const d of [old, main]) {
    expect(d.costS).toBeGreaterThanOrEqual(d.freeFlowS);
    expect(d.vehicles).toBeGreaterThanOrEqual(d.queued);
  }
  // and the ready message carries the per-link sat flow
  const r = riverHost();
  expect(Array.from(r.ready.network.linkSatFlow ?? [])).toEqual(Array.from(sat));
}, 30_000);

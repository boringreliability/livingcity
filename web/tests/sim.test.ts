// Ward core-004: the real wasm sim and the worker host.
import { describe, expect, test } from 'vitest';

import { decodeVehicles } from '../src/sim/frame';
import { createSimHost, type SimLike } from '../src/sim/host';
import {
  FLAG_ON_CLOSED_LINK,
  VEHICLE_RECORD_BYTES,
  type FrameMessage,
  type FromWorker,
  type ReadyMessage,
} from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

// 5
test('wasm sim runs in node', () => {
  // Given the real wasm module and the test city
  const memory = loadWasm();
  const sim = Sim.three_bridges(17, 23);
  // When 10 minutes of sim time run
  sim.step(1200);
  // Then traffic exists and the frame matches the metrics
  const names = sim.metric_names();
  const m = sim.metrics();
  const at = (n: string) => m[names.indexOf(n)]!;
  expect(sim.tick()).toBe(1200);
  expect(at('active')).toBeGreaterThan(0);
  const count = sim.encode_frame();
  expect(count).toBe(at('on_network'));
  expect(sim.frame_words()).toBe(count * 4);
  const words = new Uint32Array(memory.buffer, sim.frame_ptr(), sim.frame_words()).slice();
  const nLinks = sim.link_from().length;
  const d = decodeVehicles(words.buffer, count);
  for (let i = 0; i < count; i++) expect(d.link(i)).toBeLessThan(nLinks);
  // And unknown links are rejected without panicking
  expect(sim.close_link(99_999)).toBe(false);
  expect(sim.open_link(99_999)).toBe(false);
  // And two instances with the same seeds stay identical
  const a = Sim.three_bridges(5, 6);
  const b = Sim.three_bridges(5, 6);
  a.step(600);
  b.step(600);
  expect(a.state_hash_hex()).toBe(b.state_hash_hex());
  expect(a.state_hash_hex()).not.toBe(sim.state_hash_hex());
});

/** A host on the real wasm with fake time; returns its posted messages. */
function startHost() {
  const memory = loadWasm();
  let t = 0;
  const posted: FromWorker[] = [];
  const host = createSimHost({
    createSim: (d, b) => Sim.three_bridges(d, b) as unknown as SimLike,
    memory: () => memory,
    post: (msg) => posted.push(msg),
    now: () => t,
  });
  host.handle({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
  const ready = posted.find((m): m is ReadyMessage => m.type === 'ready');
  if (!ready) throw new Error('no ready message');
  host.handle({ type: 'setSpeed', multiplier: 60 });
  host.handle({ type: 'setRunning', running: true });
  const frames = () => posted.filter((m): m is FrameMessage => m.type === 'frame');
  const advance = (iterations: number) => {
    for (let k = 0; k < iterations; k++) {
      t += 16;
      host.iterate();
    }
  };
  return { host, ready, frames, advance };
}

describe('worker host', () => {
  // 10
  test('host applies close command through wasm', () => {
    // Given the host running the city at 60× for 10 sim-minutes
    const { host, ready, frames, advance } = startHost();
    advance(625);
    const last = frames().at(-1)!;
    expect(last.tick).toBeGreaterThanOrEqual(1150);
    const central = ready.landmarks.central_bridge;
    // When the central bridge is closed
    host.handle({ type: 'command', kind: 'close', link: central[0] });
    host.handle({ type: 'command', kind: 'close', link: central[1] });
    const before = frames().length;
    advance(300);
    const after = frames().slice(before);
    expect(after.length).toBeGreaterThan(100);
    // Then every frame lists both links as closed, flags vehicles on them,
    // and their occupancy never grows
    let prev = Number.POSITIVE_INFINITY;
    let flagged = 0;
    for (const f of after) {
      expect(Array.from(f.closed)).toEqual(expect.arrayContaining([central[0], central[1]]));
      const d = decodeVehicles(f.vehicles, f.count);
      for (let i = 0; i < d.count; i++) {
        if (d.link(i) === central[0] || d.link(i) === central[1]) {
          expect(d.flags(i) & FLAG_ON_CLOSED_LINK).toBeTruthy();
          flagged++;
        }
      }
      const occ = f.linkCounts[central[0]]! + f.linkCounts[central[1]]!;
      expect(occ).toBeLessThanOrEqual(prev);
      prev = occ;
    }
    expect(flagged).toBeGreaterThan(0);
    expect(prev).toBe(0);
  });

  // 11
  test('frame payload is proportional', () => {
    // Given a running host
    const { ready, frames, advance } = startHost();
    const nLinks = ready.network.linkFrom.length;
    expect(ready.network.nodeXy.length).toBe(2 * ready.network.nodeIsZone.length);
    for (const arr of [ready.network.linkTo, ready.network.linkLanes, ready.network.linkLength, ready.network.linkSpeed]) {
      expect(arr.length).toBe(nLinks);
    }
    // When it runs 300 iterations of 16 ms
    advance(300);
    const fs = frames();
    // Then at most one frame per 16 ms is posted
    expect(fs.length).toBeGreaterThan(200);
    expect(fs.length).toBeLessThanOrEqual(301);
    for (const f of fs) {
      // And the payload is exactly 16 bytes per vehicle plus per-link stats
      expect(f.vehicles.byteLength).toBe(f.count * VEHICLE_RECORD_BYTES);
      expect(f.linkCounts.length).toBe(nLinks);
      expect(f.linkQueued.length).toBe(nLinks);
      expect(f.metrics.length).toBe(ready.metricNames.length);
      // And there is no JSON or string payload besides the message type
      for (const [key, value] of Object.entries(f)) {
        if (key === 'type') continue;
        const ok =
          typeof value === 'number' ||
          value instanceof ArrayBuffer ||
          ArrayBuffer.isView(value) ||
          (typeof value === 'object' &&
            value !== null &&
            Object.values(value).every((x) => typeof x === 'number' || typeof x === 'boolean'));
        expect(ok, `field ${key}`).toBe(true);
      }
    }
  });
});

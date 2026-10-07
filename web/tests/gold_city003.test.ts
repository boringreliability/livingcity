// Ward city-003 Gold, regression tests for Gold review r1 findings (added in Gold;
// no approved Red test was changed).
import { expect, test } from 'vitest';

import { createSimHost, type SimLike } from '../src/sim/host';
import type { FrameMessage, FromWorker, ToWorker } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

function riverHost() {
  const memory = loadWasm();
  let t = 0;
  let sim: Sim | undefined;
  const posted: FromWorker[] = [];
  const h = createSimHost({
    createSim: (d, b) => (sim = Sim.river_city(d, b)) as unknown as SimLike,
    memory: () => memory,
    post: (msg) => posted.push(msg),
    now: () => t,
  });
  const send = (m: ToWorker) => h.handle(m);
  const frames = () => posted.filter((m): m is FrameMessage => m.type === 'frame');
  const advance = (n: number) => {
    for (let k = 0; k < n; k++) {
      t += 16;
      h.iterate();
    }
  };
  send({ type: 'init', demandSeed: 2026, behaviorSeed: 7 });
  send({ type: 'setSpeed', multiplier: 20 });
  send({ type: 'setRunning', running: true });
  return { send, frames, advance, sim: () => sim! };
}

// M2: an unresolvable pick (frame no longer retained) keeps the vehicle already tracked
test('fix M2: a stale pick does not drop the tracked vehicle', () => {
  const r = riverHost();
  r.advance(200);
  const f = r.frames().at(-1)!;
  r.send({ type: 'inspectVehicle', frameTick: f.tick, record: 0 });
  r.advance(1);
  const tracked = r.frames().at(-1)!.tracked;
  expect(tracked && !('gone' in tracked) ? tracked.tripId : null).not.toBeNull();
  const trip = (tracked as { tripId: number }).tripId;
  // When a click from a long-gone frame arrives (e.g. after the main thread was blocked)
  r.advance(30);
  r.send({ type: 'inspectVehicle', frameTick: f.tick, record: 5 });
  r.advance(1);
  // Then the vehicle already tracked stays tracked (unless it is gone)
  const now = r.frames().at(-1)!.tracked;
  if (now && 'gone' in now) expect(now.tripId).toBe(trip);
  else expect(now?.tripId).toBe(trip);
}, 30_000);

// m8: init resets inspection
test('fix m8: init resets inspection state', () => {
  const r = riverHost();
  r.advance(100);
  const f = r.frames().at(-1)!;
  r.send({ type: 'inspectVehicle', frameTick: f.tick, record: 0 });
  r.send({ type: 'inspectLink', link: 3 });
  r.advance(1);
  expect(r.frames().at(-1)!.linkDetail?.link).toBe(3);
  r.send({ type: 'init', demandSeed: 1, behaviorSeed: 1 });
  r.send({ type: 'setRunning', running: true });
  r.advance(2);
  const g = r.frames().at(-1)!;
  expect(g.tracked ?? null).toBeNull();
  expect(g.linkDetail ?? null).toBeNull();
}, 30_000);

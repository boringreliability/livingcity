// Ward city-002: River City through wasm and the worker host.
import { expect, test } from 'vitest';

import { createSimHost, type SimLike } from '../src/sim/host';
import type { FrameMessage, FromWorker, ReadyMessage } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

// 13
test('river city runs through wasm with the extended metrics', () => {
  // Given the real wasm module
  const memory = loadWasm();
  const sim = Sim.river_city(2026, 7);
  // Then it names itself and its river corridor
  expect(sim.city_name()).toBe('river_city');
  expect(Sim.three_bridges(1, 1).city_name()).toBe('three_bridges');
  const river = Array.from(sim.river());
  expect(river).toHaveLength(2);
  expect(river[0]!).toBeLessThan(river[1]!);
  // And the metric list is the extended one (core names first, then the city metrics)
  const names = sim.metric_names();
  expect(names.slice(-2)).toEqual(['removed_gridlock', 'unserved']);
  expect(sim.metrics()).toHaveLength(names.length);
  // And the Main Bridge links cross the corridor west → east / east → west
  const lm = JSON.parse(sim.landmarks_json()) as { central_bridge: [number, number] };
  const xy = sim.node_xy();
  const from = sim.link_from();
  const to = sim.link_to();
  const x = (node: number) => xy[2 * node]!;
  const [we, ew] = lm.central_bridge;
  expect(x(from[we]!)).toBeLessThan(river[0]!);
  expect(x(to[we]!)).toBeGreaterThan(river[1]!);
  expect(from[ew]).toBe(to[we]);
  // When 20 sim minutes run, traffic exists and the frame matches the metrics
  sim.step(2400);
  const at = (n: string) => sim.metrics()[names.indexOf(n)]!;
  expect(at('active')).toBeGreaterThan(500);
  const count = sim.encode_frame();
  expect(count).toBe(at('on_network'));
  expect(sim.frame_words()).toBe(count * 4);
  expect(memory.buffer.byteLength).toBeGreaterThan(0);
}, 30_000);

// 14
test('the host reports the city and its river in ready', () => {
  const memory = loadWasm();
  const posted: FromWorker[] = [];
  const cities: string[] = [];
  let t = 0;
  const host = createSimHost({
    createSim: (d, b, city) => {
      cities.push(city);
      return (city === 'three_bridges' ? Sim.three_bridges(d, b) : Sim.river_city(d, b)) as unknown as SimLike;
    },
    memory: () => memory,
    post: (msg) => posted.push(msg),
    now: () => t,
  });
  // When init names no city, River City is the default
  host.handle({ type: 'init', demandSeed: 2026, behaviorSeed: 7 });
  const ready = posted.find((m): m is ReadyMessage => m.type === 'ready')!;
  expect(cities).toEqual(['river_city']);
  expect(ready.city).toBe('river_city');
  expect(ready.river).toHaveLength(2);
  expect(ready.river[0]).toBeLessThan(ready.river[1]);
  expect(ready.metricNames).toContain('unserved');
  expect(ready.zones.length).toBeGreaterThanOrEqual(8);

  // And frames carry the extended metrics
  host.handle({ type: 'setSpeed', multiplier: 20 });
  host.handle({ type: 'setRunning', running: true });
  for (let k = 0; k < 10; k++) {
    t += 16;
    host.iterate();
  }
  const frame = posted.find((m): m is FrameMessage => m.type === 'frame')!;
  expect(frame.metrics).toHaveLength(ready.metricNames.length);

  // And an explicit city is honoured
  const posted2: FromWorker[] = [];
  const host2 = createSimHost({
    createSim: (d, b, city) => {
      cities.push(city);
      return (city === 'three_bridges' ? Sim.three_bridges(d, b) : Sim.river_city(d, b)) as unknown as SimLike;
    },
    memory: () => memory,
    post: (msg) => posted2.push(msg),
    now: () => 0,
  });
  host2.handle({ type: 'init', demandSeed: 1, behaviorSeed: 1, city: 'three_bridges' });
  const ready2 = posted2.find((m): m is ReadyMessage => m.type === 'ready')!;
  expect(ready2.city).toBe('three_bridges');
  expect(cities.at(-1)).toBe('three_bridges');

  // And a sim without the optional city methods (older fakes) reports the documented fallback
  const posted3: FromWorker[] = [];
  const real = Sim.three_bridges(1, 1) as unknown as Record<string | symbol, unknown>;
  const fake = new Proxy(real, {
    get: (target, prop) => {
      if (prop === 'city_name' || prop === 'river') return undefined;
      const v = target[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  createSimHost({
    createSim: () => fake as unknown as SimLike,
    memory: () => memory,
    post: (m) => posted3.push(m),
    now: () => 0,
  }).handle({ type: 'init', demandSeed: 1, behaviorSeed: 1 });
  const ready3 = posted3.find((m): m is ReadyMessage => m.type === 'ready')!;
  expect(ready3.city).toBe('unknown');
  expect(ready3.river).toEqual([0, 0]);
}, 30_000);

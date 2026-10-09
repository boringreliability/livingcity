// Ward polish-005, tests 6, 7, 9, 10: an idle host while paused, per-side frame pools in compare,
// a full clock reset on re-init, and the profiling section backed by the probe's JSON.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { SimClock } from '../src/sim/clock';
import { createSimHost, type SimLike } from '../src/sim/host';
import type { FrameMessage, FromWorker, ReadyMessage, ToWorker } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

const ROOT = join(new URL('..', import.meta.url).pathname, '..');

function host() {
  const memory = loadWasm();
  let t = 0;
  const posted: FromWorker[] = [];
  const h = createSimHost({
    createSim: (d, b) => Sim.three_bridges(d, b) as unknown as SimLike,
    memory: () => memory,
    post: (m) => posted.push(m),
    now: () => t,
  });
  const send = (m: ToWorker) => h.handle(m);
  const frames = () => posted.filter((m): m is FrameMessage => m.type === 'frame');
  const iterate = (n: number, ms = 16) => {
    for (let i = 0; i < n; i++) {
      t += ms;
      h.iterate();
    }
  };
  send({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
  const ready = posted.find((m): m is ReadyMessage => m.type === 'ready')!;
  return { send, frames, iterate, ready, h };
}

describe('polish-005', () => {
  test('6 every_message_gets_a_frame', () => {
    const w = host();
    // a short run, then paused
    w.send({ type: 'setSpeed', multiplier: 60 });
    w.send({ type: 'setRunning', running: true });
    w.iterate(120);
    w.send({ type: 'setRunning', running: false });
    w.iterate(3);
    // (paused frames keep their frozen rate: review2 G4 / review3 G4b pin them; e2 is a recorded deviation)
    // every handled message is followed by a frame within one iteration
    const head = w.frames().at(-1)!.tick;
    const messages: ToWorker[] = [
      { type: 'command', kind: 'close', link: w.ready.landmarks.north_bridge[0]! },
      { type: 'seek', tick: head - 60 },
      { type: 'inspectLink', link: 3 },
      { type: 'viewScenario', scenario: 0 },
      { type: 'setSpeed', multiplier: 5 },
      { type: 'inspectVehicle', frameTick: w.frames().at(-1)!.tick, record: 0 },
      { type: 'setRunning', running: false },
    ];
    for (const m of messages) {
      const before = w.frames().length;
      w.send(m);
      w.iterate(1);
      expect(w.frames().length, `a frame after ${m.type}`).toBeGreaterThan(before);
    }
    // running: frames keep coming
    w.send({ type: 'setRunning', running: true });
    const n1 = w.frames().length;
    w.iterate(20);
    expect(w.frames().length - n1, 'frames while running').toBeGreaterThanOrEqual(10);
  });

  test('7 compare_pools_are_per_side', () => {
    const w = host();
    w.send({ type: 'setSpeed', multiplier: 60 });
    w.send({ type: 'setRunning', running: true });
    w.iterate(120);
    w.send({ type: 'setRunning', running: false });
    w.iterate(2);
    const at = w.frames().at(-1)!.tick - 30;
    w.send({ type: 'branch', fromTick: at, then: [{ kind: 'close', link: w.ready.landmarks.central_bridge[0]! }] });
    w.iterate(2);
    w.send({ type: 'compare', on: true });
    w.iterate(2);
    w.send({ type: 'setSpeed', multiplier: 1 }); // few ticks per frame: counts often repeat
    w.send({ type: 'setRunning', running: true });
    const last: Record<number, { count: number; buffer: ArrayBuffer } | undefined> = {};
    const checked = { 0: 0, 1: 0 } as Record<number, number>;
    let seen = 0;
    for (let k = 0; k < 400; k++) {
      const before = w.frames().length;
      w.iterate(1);
      for (const f of w.frames().slice(before)) {
        seen++;
        expect(f.vehicles.byteLength).toBe(f.count * 16);
        expect(f.vehicles.byteLength, 'not a detached buffer').toBeGreaterThanOrEqual(0);
        const prev = last[f.scenario];
        if (prev && prev.count === f.count) {
          expect(f.vehicles, `side ${f.scenario}: the buffer returned for this side is reused`).toBe(prev.buffer);
          checked[f.scenario]!++;
        }
        // the UI gets a transferred copy (a new ArrayBuffer object, as in a real worker) and returns it with its side
        const back = structuredClone(f.vehicles, { transfer: [f.vehicles] });
        last[f.scenario] = { count: f.count, buffer: back };
        w.send({ type: 'returnBuffer', buffer: back, scenario: f.scenario });
      }
    }
    expect(seen).toBeGreaterThan(100);
    expect(checked[0], 'A reuses').toBeGreaterThanOrEqual(10);
    expect(checked[1], 'B reuses').toBeGreaterThanOrEqual(10);
  });

  test('9 reinit_resets_the_clock', () => {
    const run = (clock: SimClock, tick: () => number) => {
      const out: string[] = [];
      clock.setSpeed(20);
      clock.setRunning(true);
      for (let k = 0; k < 120; k++) {
        tick();
        const n = clock.plan();
        clock.report(n, 0.3 * n);
        out.push(`${n}:${JSON.stringify(clock.status())}`);
      }
      return out;
    };
    // a used clock: backlog, credit, an estimate, a full achieved window
    let t1 = 0;
    const used = new SimClock(() => t1);
    used.setSpeed(60);
    used.setRunning(true);
    for (let k = 0; k < 300; k++) {
      t1 += k % 7 === 0 ? 120 : 16; // stalls build a backlog
      const n = used.plan();
      used.report(n, 2 * n);
    }
    used.reset();
    // a fresh clock on its own time line, started at the same wall time
    let t2 = t1;
    const fresh = new SimClock(() => t2);
    const a = run(used, () => (t1 += 16));
    const b = run(fresh, () => (t2 += 16));
    expect(a).toEqual(b);
  });

  test('9b init_resets_the_host_clock', () => {
    // a host re-initialized while running behaves like a fresh host started at the same moment
    const memory = loadWasm();
    const make = (t0: number) => {
      let t = t0;
      const posted: FromWorker[] = [];
      const h = createSimHost({ createSim: (d, b) => Sim.three_bridges(d, b) as unknown as SimLike, memory: () => memory, post: (m) => posted.push(m), now: () => t });
      return {
        h,
        posted,
        advance: (n: number) => {
          for (let i = 0; i < n; i++) {
            t += 16;
            h.iterate();
          }
        },
        at: () => t,
      };
    };
    const used = make(0);
    used.h.handle({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
    used.h.handle({ type: 'setSpeed', multiplier: 60 });
    used.h.handle({ type: 'setRunning', running: true });
    for (let k = 0; k < 200; k++) used.advance(k % 9 === 0 ? 8 : 1); // stalls: backlog and credit
    const fresh = make(used.at());
    const n = used.posted.length;
    for (const x of [used, fresh]) {
      x.h.handle({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
      x.h.handle({ type: 'setSpeed', multiplier: 60 });
      x.h.handle({ type: 'setRunning', running: true });
      x.advance(60);
    }
    const clocks = (posted: FromWorker[]) =>
      posted.filter((m): m is FrameMessage => m.type === 'frame').map((f) => ({ tick: f.tick, clock: f.clock }));
    expect(clocks(used.posted.slice(n))).toEqual(clocks(fresh.posted));
  });

  test('10 performance_doc_cites_the_probe', () => {
    const json = JSON.parse(readFileSync(join(ROOT, 'web/perf-results/frame-cost.json'), 'utf8')) as Record<string, Record<string, Record<string, number>>>;
    for (const phase of ['before', 'after'] as const)
      for (const scale of ['x1', 'x3', 'x5'])
        for (const k of ['metricsMs', 'stepMs']) expect(typeof json[phase]?.[scale]?.[k], `${phase}.${scale}.${k}`).toBe('number');
    expect(existsSync(join(ROOT, 'crates/sim-core/examples/frame_cost_probe.rs'))).toBe(true);
    expect(typeof json['baseline'], 'the pre-ward step means (commit 4e5d5c1)').toBe('object');
    // the optimization is real
    expect(json.after!.x5!.stepMs!, 'step at ×5 after ≤ 0.8 × before').toBeLessThanOrEqual(0.8 * json.before!.x5!.stepMs!);
    expect(json.after!.x5!.metricsMs!, 'metrics at ×5 after ≤ 0.25 × before').toBeLessThanOrEqual(0.25 * json.before!.x5!.metricsMs!);
    const doc = readFileSync(join(ROOT, 'docs/performance.md'), 'utf8');
    const lines = doc.split('\n');
    const i = lines.findIndex((l) => /^## Profiling and optimization/.test(l));
    expect(i, 'a "## Profiling and optimization" section').toBeGreaterThanOrEqual(0);
    const j = lines.findIndex((l, k) => k > i && /^#{1,2} /.test(l));
    const sec = lines.slice(i + 1, j < 0 ? undefined : j).join('\n');
    expect(sec).toMatch(/frame-cost\.json/);
    expect(sec).toMatch(/full[- ]scan|every slot/i);
    expect(sec).toMatch(/\bactive\b/);
    const leaves: number[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'number') leaves.push(v);
      else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
    };
    walk(json);
    const plain = sec.replace(/`[^`]*`/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/\*\*/g, '');
    const numbers = [...plain.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?!\d|\.\d)/g)].map((m) => m[1]!);
    expect(numbers.length).toBeGreaterThan(6);
    const missing = numbers.filter((d) => {
      const k = d.includes('.') ? d.split('.')[1]!.length : 0;
      return !leaves.some((v) => (k > 0 ? v.toFixed(k) === d : Number.isInteger(v) && v === Number(d)));
    });
    expect(missing, 'numbers in the section that are not values in frame-cost.json').toEqual([]);
  });
});

// Ward timeline-003, tests 1–10: seek, branch and scenarios in the worker host (contract T3).
import { describe, expect, test } from 'vitest';

import { createSimHost, type SimLike } from '../src/sim/host';
import { REPLAY_BUDGET_BYTES, type FrameMessage, type FromWorker, type ToWorker } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

/** A host on real wasm (three_bridges) with a fake clock; scenario A's Sim is exposed for hashing. */
function host() {
  const memory = loadWasm();
  let t = 0;
  let a: Sim | undefined;
  const posted: FromWorker[] = [];
  const h = createSimHost({
    createSim: (d, b) => {
      a = Sim.three_bridges(d, b);
      return a as unknown as SimLike;
    },
    memory: () => memory,
    post: (m) => posted.push(m),
    now: () => t,
  });
  const send = (m: ToWorker) => h.handle(m);
  const frames = () => posted.filter((m): m is FrameMessage => m.type === 'frame');
  const errors = () => posted.filter((m) => m.type === 'error').map((m) => (m as { message: string }).message);
  const last = () => frames().at(-1)!;
  const iterate = (n: number, ms = 16) => {
    for (let i = 0; i < n; i++) {
      t += ms;
      h.iterate();
    }
  };
  /** Run (at 60×) until the viewed scenario reaches `tick`. */
  const runTo = (tick: number) => {
    send({ type: 'setSpeed', multiplier: 60 });
    send({ type: 'setRunning', running: true });
    for (let i = 0; i < 100_000 && (frames().at(-1)?.tick ?? 0) < tick; i++) iterate(1);
    send({ type: 'setRunning', running: false });
    iterate(2);
  };
  const start = () => send({ type: 'init', demandSeed: 17, behaviorSeed: 23, city: 'three_bridges' });
  return { send, frames, errors, last, iterate, runTo, start, a: () => a!, posted };
}

/** A fresh three_bridges Sim at `tick` (the reference). */
function reference(tick: number): Sim {
  loadWasm();
  const s = Sim.three_bridges(17, 23);
  s.step(tick);
  return s;
}

const CENTRAL = (s: Sim) => (JSON.parse(s.landmarks_json()) as { central_bridge: [number, number] }).central_bridge;

describe('timeline-003 host', () => {
  test('1 seek_restores_and_pauses', () => {
    const x = host();
    x.start();
    x.runTo(1000);
    x.send({ type: 'setRunning', running: true });
    x.iterate(3);
    expect(x.last().clock.running).toBe(true);
    const head = x.last().timeline.headTick;
    expect(head).toBeGreaterThanOrEqual(1000);
    x.send({ type: 'seek', tick: 500 });
    const f = x.last();
    expect(f.tick).toBe(500);
    expect(f.clock.running).toBe(false);
    expect(f.timeline.positionTick).toBe(500);
    expect(f.timeline.headTick).toBe(head);
    expect(x.a().state_hash_hex()).toBe(reference(500).state_hash_hex());
    // still paused on later iterations
    x.iterate(20);
    expect(x.last().tick).toBe(500);
  });

  test('2 seek_outside_window_is_refused', () => {
    const x = host();
    x.start();
    x.runTo(600);
    const before = x.last();
    const nErr = x.errors().length;
    x.send({ type: 'seek', tick: before.timeline.headTick + 1 });
    x.iterate(3);
    expect(x.errors().length).toBe(nErr + 1);
    expect(x.errors().at(-1)).toMatch(/replay window/i);
    expect(x.last().tick).toBe(before.tick);
    expect(x.last().timeline).toEqual(before.timeline);
    expect(x.last().clock.running).toBe(false);
  });

  test('3 frames_carry_timeline_numbers', () => {
    expect(REPLAY_BUDGET_BYTES).toBe(48 * 1024 * 1024);
    const x = host();
    x.start();
    x.runTo(800);
    for (const f of x.frames()) {
      expect(f.scenario).toBe(0);
      const tl = f.timeline;
      for (const v of Object.values(tl)) expect(typeof v).toBe('number');
      expect(tl.budgetBytes).toBe(REPLAY_BUDGET_BYTES);
      expect(tl.snapshotBytes).toBeGreaterThan(0);
      expect(tl.snapshotBytes).toBeLessThanOrEqual(tl.budgetBytes);
      expect(tl.windowStartTick).toBeLessThanOrEqual(tl.positionTick);
      expect(tl.positionTick).toBeLessThanOrEqual(tl.headTick);
      expect(tl.positionTick).toBe(f.tick);
      expect(tl.branchTick).toBe(-1);
    }
  });

  test('4 seek_resets_clock_and_inspection', () => {
    const x = host();
    x.start();
    x.runTo(900);
    const old = x.last();
    expect(old.count).toBeGreaterThan(0);
    x.send({ type: 'inspectVehicle', frameTick: old.tick, record: 0, seq: 1 });
    x.iterate(2);
    expect(x.last().tracked).not.toBeNull();
    x.send({ type: 'setRunning', running: true });
    x.iterate(3);
    expect(x.last().clock.running).toBe(true);
    x.send({ type: 'seek', tick: 300 });
    const f = x.last();
    expect(f.clock.running).toBe(false);
    expect(f.perf.ticksMeasured).toBe(0);
    expect(f.clock.executedTicks).toBe(300);
    expect(f.clock.backlogTicks).toBe(0);
    expect(f.tracked ?? null).toBeNull();
    // a pick from a pre-seek frame no longer resolves
    x.send({ type: 'inspectVehicle', frameTick: old.tick, record: 0, seq: 2 });
    x.iterate(2);
    expect(x.last().tracked ?? null).toBeNull();
  });

  test('5 replay_after_seek_is_identical', () => {
    const x = host();
    x.start();
    x.runTo(1200);
    x.send({ type: 'seek', tick: 400 });
    const ref = reference(400);
    x.send({ type: 'setSpeed', multiplier: 60 });
    x.send({ type: 'setRunning', running: true });
    let checked = 0;
    for (let i = 0; i < 100_000 && x.last().tick < 1300; i++) {
      x.iterate(1);
      const f = x.last();
      if (f.tick > ref.tick()) ref.step(f.tick - ref.tick());
      if (f.tick === ref.tick()) {
        expect(x.a().state_hash_hex()).toBe(ref.state_hash_hex());
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(x.last().timeline.headTick).toBeGreaterThanOrEqual(1300); // replay continued past the old head
  });

  test('6 branch_preserves_a', () => {
    const x = host();
    x.start();
    x.runTo(1200);
    const head = x.last().timeline.headTick;
    x.send({ type: 'seek', tick: 800 });
    const aFrame = x.last();
    const main = CENTRAL(x.a());
    // A runs on a little (a replay below its head) before the branch is made
    x.send({ type: 'setRunning', running: true });
    x.iterate(2);
    expect(x.last().clock.running).toBe(true);
    const aPos = x.last().tick;
    const aHash = x.a().state_hash_hex();
    x.send({ type: 'branch', fromTick: 800, then: main.map((link) => ({ kind: 'close' as const, link })) });
    x.iterate(3);
    let f = x.last();
    expect(f.scenario).toBe(1);
    expect(f.timeline.branchTick).toBe(800);
    expect(f.clock.running).toBe(false);
    // B at the branch point is A at 800 (its commands apply on the next tick)
    expect(f.tick).toBe(800);
    expect(Array.from(f.metrics)).toEqual(Array.from(aFrame.metrics));
    expect(Array.from(f.linkCounts)).toEqual(Array.from(aFrame.linkCounts));
    // B runs and closes the bridge
    x.send({ type: 'setRunning', running: true });
    x.iterate(10);
    expect(Array.from(x.last().closed)).toEqual(expect.arrayContaining(main));
    // A is untouched
    expect(x.a().state_hash_hex()).toBe(aHash);
    // switching the view (while B runs) pauses and shows A where it was
    x.send({ type: 'viewScenario', scenario: 0 });
    x.iterate(2);
    f = x.last();
    expect(f.clock.running).toBe(false);
    expect(f.scenario).toBe(0);
    expect(f.tick).toBe(aPos);
    expect(f.timeline.headTick).toBe(head);
    expect(f.timeline.branchTick).toBe(800);
    expect(Array.from(f.closed)).not.toContain(main[0]);
  });

  test('7 command_on_a_below_head_is_refused', () => {
    const x = host();
    x.start();
    x.runTo(1000);
    x.send({ type: 'seek', tick: 600 });
    const before = x.last();
    const hash = x.a().state_hash_hex();
    const nErr = x.errors().length;
    x.send({ type: 'command', kind: 'close', link: CENTRAL(x.a())[0] });
    x.iterate(3);
    expect(x.errors().length).toBe(nErr + 1);
    expect(x.a().state_hash_hex()).toBe(hash);
    expect(x.last().timeline).toEqual(before.timeline);
  });

  test('8 command_on_b_edits_b', () => {
    const x = host();
    x.start();
    x.runTo(1000);
    x.send({ type: 'branch', fromTick: 700, then: [] });
    x.send({ type: 'setSpeed', multiplier: 60 });
    x.send({ type: 'setRunning', running: true });
    for (let i = 0; i < 100_000 && x.last().tick < 1100; i++) x.iterate(1);
    x.send({ type: 'setRunning', running: false });
    x.iterate(2);
    expect(x.last().scenario).toBe(1);
    const aHash = x.a().state_hash_hex();
    x.send({ type: 'seek', tick: 900 });
    x.send({ type: 'command', kind: 'close', link: CENTRAL(x.a())[1] });
    x.iterate(2);
    const f = x.last();
    expect(f.timeline.positionTick).toBe(900);
    expect(f.timeline.headTick).toBe(900); // B's future was cut at the edit
    expect(x.a().state_hash_hex()).toBe(aHash);
  });

  test('9 discard_and_replace_branch', () => {
    const x = host();
    x.start();
    x.runTo(1000);
    const aTick = x.last().tick;
    x.send({ type: 'branch', fromTick: 600, then: [] });
    x.iterate(2);
    expect(x.last().timeline.branchTick).toBe(600);
    x.send({ type: 'viewScenario', scenario: 0 });
    x.send({ type: 'branch', fromTick: 400, then: [] });
    x.iterate(2);
    expect(x.last().scenario).toBe(1);
    expect(x.last().timeline.branchTick).toBe(400);
    expect(x.last().tick).toBe(400);
    x.send({ type: 'discardBranch' });
    x.iterate(2);
    const f = x.last();
    expect(f.scenario).toBe(0);
    expect(f.timeline.branchTick).toBe(-1);
    // A is where it was viewed last (its own position is preserved)
    expect(f.tick).toBe(aTick);
    expect(f.timeline.positionTick).toBe(aTick);
  });

  test('10 timeline_messages_during_warmup_are_refused', () => {
    const x = host();
    x.send({ type: 'init', demandSeed: 17, behaviorSeed: 23, city: 'three_bridges', warmupS: 300 });
    const nErr = x.errors().length;
    x.send({ type: 'seek', tick: 10 });
    x.send({ type: 'branch', fromTick: 0, then: [] });
    x.send({ type: 'viewScenario', scenario: 1 });
    expect(x.errors().length).toBe(nErr + 3);
    for (let i = 0; i < 10_000 && !x.posted.some((m) => m.type === 'ready'); i++) x.iterate(1);
    x.iterate(3);
    const f = x.last();
    expect(f.tick).toBe(600);
    expect(f.scenario).toBe(0);
    expect(f.timeline.branchTick).toBe(-1);
  });

  test('20 wasm_window_metrics_and_timeline_info_layout', () => {
    loadWasm();
    const s = Sim.three_bridges(17, 23);
    s.step(1200);
    const w = Array.from(s.window_metrics(400));
    expect(w.length).toBe(9);
    expect(w[0]).toBe(400);
    expect(w[1]).toBe(1200);
    expect(w[2]).toBeGreaterThan(0);
    expect(w[6]).toBe(w[2]! - w[3]! - w[4]! - w[5]!);
    expect(w[3]! > 0 ? w[7]! <= w[8]! : Number.isNaN(w[7])).toBe(true);
    // an empty cohort (from = now): zero counts and NaN means
    const e = Array.from(s.window_metrics(1200));
    expect(e.slice(2, 7)).toEqual([0, 0, 0, 0, 0]);
    expect(Number.isNaN(e[7])).toBe(true);
    expect(Number.isNaN(e[8])).toBe(true);
    const ti = Array.from(s.timeline_info());
    expect(ti.length).toBe(6);
    expect(ti.slice(0, 3)).toEqual([0, 1200, 1200]);
    expect(ti[4]).toBe(REPLAY_BUDGET_BYTES);
    expect(ti[5]).toBe(11); // snapshots at 0, 120, …, 1200
    expect(ti[3]).toBeGreaterThan(0);
  });
});

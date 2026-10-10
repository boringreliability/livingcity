// Ward polish-006, tests 4, 7, 8, 9: a failed B replace leaves the host on A; formatted Rust sources;
// every backlog id accounted for; perf results taken after polish-005.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { createSimHost, type SimLike } from '../src/sim/host';
import type { FrameMessage, FromWorker, ReadyMessage } from '../src/sim/protocol';
import { Sim } from '../src/wasm/sim_wasm.js';
import { loadWasm } from './helpers';

const ROOT = join(new URL('..', import.meta.url).pathname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function rsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? rsFiles(p) : n.endsWith('.rs') ? [p] : [];
  });
}

describe('polish-006', () => {
  test('4 replace_points_at_a', () => {
    const memory = loadWasm();
    let t = 0;
    const posted: FromWorker[] = [];
    const freed = new Set<object>();
    const afterFree: string[] = [];
    let branches = 0;
    /** Wrap a sim: record calls made after free(); the second branch() throws. */
    const wrap = (inner: Sim): SimLike => {
      const proxy: object = new Proxy(inner, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv) as unknown;
          if (typeof v !== 'function') return v;
          return (...args: unknown[]) => {
            if (freed.has(proxy)) afterFree.push(String(prop));
            if (prop === 'free') freed.add(proxy);
            if (prop === 'branch') {
              branches++;
              if (branches === 2) throw new Error('branch failed (test)');
              return wrap((v as (...a: unknown[]) => Sim).apply(target, args));
            }
            return (v as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
      return proxy as unknown as SimLike;
    };
    const h = createSimHost({ createSim: (d, b) => wrap(Sim.three_bridges(d, b)), memory: () => memory, post: (m) => posted.push(m), now: () => t });
    const iterate = (n: number) => {
      for (let i = 0; i < n; i++) {
        t += 16;
        h.iterate();
      }
    };
    const frames = () => posted.filter((m): m is FrameMessage => m.type === 'frame');
    h.handle({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
    const ready = posted.find((m): m is ReadyMessage => m.type === 'ready')!;
    h.handle({ type: 'setSpeed', multiplier: 60 });
    h.handle({ type: 'setRunning', running: true });
    iterate(120);
    h.handle({ type: 'setRunning', running: false });
    iterate(2);
    const at = frames().at(-1)!.tick - 40;
    // a first B, viewed
    h.handle({ type: 'branch', fromTick: at, then: [{ kind: 'close', link: ready.landmarks.central_bridge[0]! }] });
    iterate(2);
    expect(frames().at(-1)!.scenario).toBe(1);
    // a replace (B still viewed) whose new branch fails: the old B is freed, the host must fall back to A
    const errorsBefore = posted.filter((m) => m.type === 'error').length;
    h.handle({ type: 'branch', fromTick: at - 10, then: [] });
    const n = frames().length;
    iterate(10);
    const after = frames().slice(n);
    expect(after.length, 'frames continue').toBeGreaterThan(0);
    for (const f of after) expect(f.scenario, 'frames come from A').toBe(0);
    expect(afterFree, 'no call reaches a freed sim').toEqual([]);
    expect(posted.filter((m) => m.type === 'error').length, 'the failed branch is reported').toBeGreaterThan(errorsBefore);
  });

  test('4b pools_are_cleared_on_init_and_after_compare', () => {
    // a returned buffer is reused only by a frame of the same byte length, so each check returns
    // buffers at a tick whose frame comes again with the same vehicle count: an uncleared pool would reuse them
    const memory = loadWasm();
    let t = 0;
    const posted: FromWorker[] = [];
    const h = createSimHost({ createSim: (d, b) => Sim.three_bridges(d, b) as unknown as SimLike, memory: () => memory, post: (m) => posted.push(m), now: () => t });
    const iterate = (k: number) => {
      for (let i = 0; i < k; i++) {
        t += 16;
        h.iterate();
      }
    };
    const frames = () => posted.filter((m): m is FrameMessage => m.type === 'frame');
    const giveBack = (f: FrameMessage) => {
      const back = structuredClone(f.vehicles, { transfer: [f.vehicles] }); // a fresh object, as after a real transfer
      h.handle({ type: 'returnBuffer', buffer: back, scenario: f.scenario });
      return back;
    };
    h.handle({ type: 'init', demandSeed: 17, behaviorSeed: 23 });
    const ready = posted.find((m): m is ReadyMessage => m.type === 'ready')!;
    h.handle({ type: 'setSpeed', multiplier: 60 });
    h.handle({ type: 'setRunning', running: true });
    iterate(120);
    h.handle({ type: 'setRunning', running: false });
    iterate(2);
    h.handle({ type: 'branch', fromTick: frames().at(-1)!.tick - 30, then: [{ kind: 'close', link: ready.landmarks.central_bridge[0]! }] });
    h.handle({ type: 'viewScenario', scenario: 0 });
    // compare (paused): a pair; B's buffer handed back; leave compare (A viewed, so no B frame)
    let n = frames().length;
    h.handle({ type: 'compare', on: true });
    const pairB = frames().slice(n).filter((f) => f.scenario === 1).at(-1)!;
    expect(pairB, 'entering compare posts B').toBeDefined();
    const pairTick = pairB.tick;
    const pairCount = pairB.count;
    const staleB = giveBack(pairB);
    h.handle({ type: 'compare', on: false });
    // compare again at the same tick: B's frame has the same size, but must not be the stale buffer
    n = frames().length;
    h.handle({ type: 'compare', on: true });
    const againB = frames().slice(n).filter((f) => f.scenario === 1).at(-1)!;
    expect([againB.tick, againB.count], 'the same B frame again (so the stale buffer would fit)').toEqual([pairTick, pairCount]);
    expect(againB.vehicles === staleB, 'B pool cleared when compare was left').toBe(false);
    // a re-init: buffers returned before it never come back, even for a frame of the same size
    // (a warm-up, so the first frame after init carries vehicles: the stale buffer is not empty)
    h.handle({ type: 'compare', on: false });
    const firstFrameAfterInit = () => {
      const k = frames().length;
      h.handle({ type: 'init', demandSeed: 17, behaviorSeed: 23, warmupS: 600 });
      for (let i = 0; i < 2000 && frames().length === k; i++) iterate(1);
      return frames()[k]!;
    };
    const first = firstFrameAfterInit();
    expect(first, 'the first frame after init').toBeDefined();
    expect(first.count, 'the first frame after a warm-up carries vehicles').toBeGreaterThan(0);
    const staleA = giveBack(first);
    const again = firstFrameAfterInit();
    expect([again.tick, again.count], 'the same frame again').toEqual([first.tick, first.count]);
    expect(again.vehicles === staleA, 'pools cleared on init').toBe(false);
  });

  test('7 rust_sources_are_formatted', () => {
    const files = [...rsFiles(join(ROOT, 'crates/sim-core/src')), ...rsFiles(join(ROOT, 'crates/sim-wasm/src')), ...rsFiles(join(ROOT, 'crates/sim-core/examples'))];
    expect(files.length).toBeGreaterThan(10);
    expect(execFileSync('rustfmt', ['--version'], { encoding: 'utf8' })).toMatch(/rustfmt/);
    for (const cfg of ['rustfmt.toml', '.rustfmt.toml']) {
      if (existsSync(join(ROOT, cfg))) expect(read(cfg)).not.toMatch(/disable_all_formatting\s*=\s*true/);
    }
    let out = '';
    let status = 0;
    try {
      execFileSync('rustfmt', ['--check', '--edition', '2021', ...files], { encoding: 'utf8', cwd: ROOT });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      status = err.status ?? -1;
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(out.split('\n').filter((l) => l.startsWith('Diff in') || /^error/.test(l)).slice(0, 8)).toEqual([]);
    expect(status, 'rustfmt --check exits 0').toBe(0);
  });

  test('8 backlog_fully_accounted', () => {
    const backlog = read('.wdd/memory/polish-backlog.md');
    const ids = new Set([...backlog.matchAll(/^- \*\*([a-k]\d+)/gm)].map((m) => m[1]!));
    expect(ids.size).toBeGreaterThan(60);
    const known = read('docs/known-issues.md');
    const lines = known.split('\n').filter((l) => /^\s*- \*\*[a-k]\d+:?\*\*/.test(l));
    const listed = new Map(lines.map((l) => [/\*\*([a-k]\d+):?\*\*/.exec(l)![1]!, l]));
    expect(listed.size, 'no id listed twice').toBe(lines.length);
    expect([...listed.keys()].sort()).toEqual([...ids].sort());
    for (const [id, l] of listed) expect(l, `${id} has a status`).toMatch(/resolved \([^)]+\)|limitation:|deviation:/);
    const section = (doc: string, at: number) => {
      const rest = doc.slice(at);
      const next = rest.slice(3).search(/^##? /m);
      return next < 0 ? rest : rest.slice(0, next + 3);
    };
    expect(known.search(/^## Epic gate/m)).toBeGreaterThan(0);
    const gate = section(known, known.search(/^## Epic gate/m));
    expect(gate, 'the epic-gate section lists ids itself').not.toMatch(/^\s*- \*\*[a-k]\d+:?\*\*.*(resolved \(|limitation:)/m);
    for (const id of ['e2', 'e3', 'i1', 'i2', 'i3', 'i5']) expect(gate, `epic gate names ${id}`).toMatch(new RegExp(`\\b${id}\\b`));
    expect(read('README.md')).toContain('docs/known-issues.md');
    const arch = read('docs/architecture.md');
    const dev = section(arch, arch.search(/^## Deviations/m));
    const at = dev.search(/^###.*From epic polish/m);
    expect(at, 'a "### From epic polish" item list in § Deviations').toBeGreaterThan(0);
    const rest = dev.slice(at + 4);
    const polish = dev.slice(at, at + 4 + (rest.search(/^###? /m) < 0 ? rest.length : rest.search(/^###? /m)));
    for (const id of ['e2', 'e3', 'i1', 'i2', 'i3', 'i5']) expect(polish, `architecture names ${id}`).toMatch(new RegExp(`\\b${id}\\b`));
  });

  test('9 perf_results_are_current', () => {
    for (const name of ['baseline-1x', 'baseline-20x', 'closure-burst', 'stress-5x', 'timeline']) {
      const j = JSON.parse(read(`web/perf-results/${name}.json`)) as { timestamp?: string };
      expect(j.timestamp && j.timestamp >= '2026-10-10', `${name}.json taken after polish-005 (${j.timestamp})`).toBe(true);
    }
    expect(existsSync(join(ROOT, 'web/perf-results/frame-cost.json'))).toBe(true);
    const arch = read('docs/architecture.md');
    expect(arch).toMatch(/1\.5 × the expected sim advance/);
    expect(arch).not.toMatch(/1\.5 × the frame interval/);
    expect(read('docs/performance.md'), 'a browser stress before/after (polish-005)').toMatch(/stress[^\n]*before[^\n]*after|before[^\n]*after[^\n]*stress/i);
    expect(arch).toMatch(/nextLinks[^.]*copied|copied[^.]*nextLinks/);
  });
});

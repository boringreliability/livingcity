// Ward motion-005, tests 7–8 (static): the epic's wiring and documentation, and its before/after measurements.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(WEB, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// 7
test('epic_wiring_and_docs', () => {
  // supersessions: every row complete, every named test skipped next to a pointer to the log
  const log = read('.wdd/memory/supersessions.md');
  expect(log, 'authorization names the task file').toMatch(/task-2026-10-11-motion-paused-consequences\.md/);
  const rows = log.split('\n').filter((l) => /^\|\s*S\d+\s*\|/.test(l));
  expect(rows.length, 'supersession rows').toBeGreaterThanOrEqual(8);
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    const [id, , fileCell, testCell, pinned, why, replaced] = cells;
    expect(cells.length, `${id}: 7 columns`).toBe(7);
    for (const [name, v] of [['test', testCell], ['pinned behaviour', pinned], ['reason', why], ['replaced by', replaced]] as const) expect(v, `${id}: ${name}`).toBeTruthy();
    const file = /`([^`]+)`/.exec(fileCell!)?.[1];
    expect(file, `${id}: frozen file`).toBeTruthy();
    expect(fileCell, `${id}: sha256`).toMatch(/\b[0-9a-f]{64}\b/);
    const key = /`([^`]+)`/.exec(testCell!)?.[1] ?? testCell!;
    const lines = read(file!).split('\n');
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = lines.findIndex((l) => new RegExp(`test\\.skip\\(\\s*['"\`](?:\\d+ )?${esc}(?![\\w])`).test(l));
    expect(at, `${id}: ${key} is test.skip in ${file}`).toBeGreaterThanOrEqual(0);
    const near = lines.slice(Math.max(0, at - 3), at + 1).join('\n');
    expect(near, `${id}: the skip points to supersessions.md`).toMatch(/supersessions\.md/);
  }

  // known issues: the epic's resolved items are listed as resolved, never as open
  const issues = read('docs/known-issues.md').split('\n');
  for (const id of ['e2', 'e3', 'i1', 'i2', 'i4', 'i5']) {
    const mine = issues.filter((l) => new RegExp(`^\\s*-\\s+(\\*\\*)?${id}(\\*\\*|:|\\s—)`).test(l));
    expect(mine.length, `${id} is listed`).toBeGreaterThan(0);
    for (const l of mine) {
      expect(l, `${id} resolved`).toMatch(/resolved/i);
      expect(l, `${id} not open`).not.toMatch(/\b(open|unresolved|deviation)\b(?!s)/i);
    }
  }

  // WDD state
  for (const n of ['001', '002', '003', '004']) {
    expect(read(`.wdd/wards/motion/ward-${n}.md`), `motion-${n} complete`).toMatch(/^status:\s*"complete"/m);
  }
  expect(read('.wdd/CONTEXT.md'), 'CONTEXT mentions motion-005').toMatch(/motion-005/);

  // verification doc: six flows at 1× and 20×, screenshots exist
  const doc = read('docs/verification/motion-005.md');
  const flows = ['junction', 'queue', 'reopen', 'pause', 'branch', 'compar'];
  for (const f of flows) {
    const lines = doc.split('\n').filter((l) => l.toLowerCase().includes(f));
    expect(lines.some((l) => l.includes('1×')), `${f} at 1×`).toBe(true);
    expect(lines.some((l) => l.includes('20×')), `${f} at 20×`).toBe(true);
  }
  const pngs = [...doc.matchAll(/\(([^)\s]+\.png)\)/g)].map((m) => m[1]!);
  expect(pngs.length, 'screenshots linked').toBeGreaterThanOrEqual(12);
  for (const p of pngs) {
    expect(p, 'screenshots live under docs/verification/motion-005/').toMatch(/^motion-005\//);
    expect(existsSync(join(ROOT, 'docs/verification', p)), `${p} exists`).toBe(true);
  }
});

// 8
test('epic_measured_before_and_after', () => {
  const path = 'web/perf-results/motion-epic-before-after.json';
  expect(existsSync(join(ROOT, path)), path).toBe(true);
  const j = JSON.parse(read(path)) as Record<string, any>;
  expect(j['epic']).toBe('motion');
  expect(j['before']?.commit).toBe('19e9fbf');
  expect(String(j['after']?.commit ?? '')).toMatch(/^[0-9a-f]{7,40}$/);
  const finite = (v: unknown) => Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  const required = ['tickMsMean', 'nativeStepMsMedian', 'renderIntervalMedianMs', 'renderIntervalP95Ms', 'frameBytes', 'transferBytesPerS', 'pausedFramesPerS', 'pausedBytesPerS', 'presentationLagMsMedian'];
  const ss = j['swiftshader'] as Record<string, any>;
  expect(ss, 'swiftshader group').toBeTruthy();
  for (const k of required) {
    // a metric may hold one series or several labelled series ({ "baseline-1x": {before, after}, … })
    const series: Record<string, any>[] = ss[k] && ('after' in ss[k] ? [ss[k]] : Object.values(ss[k]));
    expect(series.length, `swiftshader.${k}`).toBeGreaterThan(0);
    for (const s of series) {
      expect(finite(s['after']), `swiftshader.${k}: after (≥ 2 interleaved runs)`).toBe(true);
      if (s['before'] === null) {
        expect(k, `${k}: only presentation lag may lack a before value`).toBe('presentationLagMsMedian');
        expect(String(s['note'] ?? '').length, `${k}: a note on the missing before value`).toBeGreaterThan(10);
      } else expect(finite(s['before']), `swiftshader.${k}: before (≥ 2 interleaved runs)`).toBe(true);
    }
  }
  expect(String(j['conditions']?.renderer ?? '')).toMatch(/SwiftShader/);
  const hw = j['hardware'] as Record<string, any>;
  expect(hw, 'hardware group').toBeTruthy();
  if (hw['measured'] === false) expect(String(hw['reason'] ?? '').length, 'why hardware was not measured').toBeGreaterThanOrEqual(20);
  else expect(String(hw['renderer'] ?? ''), 'hardware renderer').not.toMatch(/SwiftShader/);
  const load = j['load1min'] as Record<string, number>;
  expect(Object.keys(load ?? {}).length, 'load per run').toBeGreaterThanOrEqual(4);

  // docs/performance.md prints the epic table from this JSON
  const doc = read('docs/performance.md');
  const at = doc.indexOf('## Epic motion: before and after');
  expect(at, 'the epic section').toBeGreaterThanOrEqual(0);
  const section = doc.slice(at, doc.indexOf('\n## ', at + 5) < 0 ? undefined : doc.indexOf('\n## ', at + 5));
  expect(section).toContain('motion-epic-before-after.json');
  const values = new Set<string>();
  const collect = (v: unknown) => {
    if (typeof v === 'number') values.add(v.toFixed(1));
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(j);
  for (const k of ['renderIntervalMedianMs', 'frameBytes', 'pausedFramesPerS']) {
    const row = section.split('\n').find((l) => l.includes(k));
    expect(row, `the epic table has a ${k} row`).toBeTruthy();
    // the value cells (after the first, which names the metric and its scenario)
    const cells = row!.split('|').slice(2, -1).join('|');
    const nums = [...cells.replace(/,(?=\d{3})/g, '').matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]).toFixed(1));
    expect(nums.length, `${k}: numbers in the row`).toBeGreaterThan(0);
    for (const n of nums) expect(values.has(n), `${k}: ${n} is in the JSON`).toBe(true);
  }
});

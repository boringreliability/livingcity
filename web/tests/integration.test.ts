// Ward timeline-005, tests 3–6, 8, 9: wiring and delivery checks by static analysis of the sources.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';

const WEB = new URL('..', import.meta.url).pathname;
const ROOT = join(WEB, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'wasm' && name !== 'node_modules') out.push(...files(p, ext));
    } else if (ext.test(name)) out.push(p);
  }
  return out;
}

/** The string-literal `type` values of a union declared as `export type Name = … ;` in protocol.ts. */
function unionTypes(name: string): string[] {
  const src = read('web/src/sim/protocol.ts');
  const start = src.indexOf(`export type ${name} =`);
  expect(start, `${name} declared`).toBeGreaterThanOrEqual(0);
  let body = src.slice(start, src.indexOf(';\n', start));
  // referenced interfaces (ReadyMessage | FrameMessage | …) contribute their `type: '…'` literal
  for (const ref of body.match(/\b[A-Z]\w+Message\b/g) ?? []) {
    const i = src.indexOf(`export interface ${ref}`);
    if (i >= 0) body += src.slice(i, src.indexOf('\n}', i));
  }
  return [...new Set([...body.matchAll(/type: '(\w+)'/g)].map((m) => m[1]!))];
}

describe('timeline-005 integration checks', () => {
  test('3 protocol_messages_are_wired', () => {
    const client = read('web/src/sim/client.ts');
    const host = read('web/src/sim/host.ts');
    const worker = read('web/src/sim/worker.ts');
    const toWorker = unionTypes('ToWorker');
    expect(toWorker.length).toBeGreaterThanOrEqual(12);
    for (const t of toWorker) {
      expect(client.includes(`type: '${t}'`), `client sends ${t}`).toBe(true);
      expect(host.includes(`case '${t}'`), `host handles ${t}`).toBe(true);
    }
    const fromWorker = unionTypes('FromWorker');
    expect(new Set(fromWorker)).toEqual(new Set(['ready', 'frame', 'comparison', 'error']));
    for (const t of fromWorker) {
      expect(host.includes(`type: '${t}'`) || worker.includes(`type: '${t}'`), `posted: ${t}`).toBe(true);
      // the client routes each type; anything unknown falls to the error callbacks
      expect(t === 'error' || client.includes(`msg.type === '${t}'`), `client consumes ${t}`).toBe(true);
    }
  });

  test('4 no_orphaned_exports', () => {
    /** Public constants kept on purpose (named in the specs, read in tests or docs). */
    const ALLOWLIST: Record<string, string> = {
      // add `symbol: 'reason'` entries only with a reason
    };
    const src = files(join(WEB, 'src'), /\.(ts|tsx)$/);
    const users = [...src, ...files(join(WEB, 'tests'), /\.ts$/), ...files(join(WEB, 'e2e'), /\.ts$/)];
    const text = new Map(users.map((f) => [f, readFileSync(f, 'utf8')]));
    const orphans: string[] = [];
    for (const f of src) {
      const own = text.get(f)!;
      for (const m of own.matchAll(/^export (?:const|function|class|interface|type|enum)\s+(\w+)/gm)) {
        const name = m[1]!;
        if (name in ALLOWLIST) continue;
        const re = new RegExp(`\\b${name}\\b`);
        if (![...text].some(([g, t]) => g !== f && re.test(t))) orphans.push(`${relative(WEB, f)}: ${name}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  test('5 docs_exist_and_cover_the_brief', () => {
    for (const p of ['README.md', 'docs/architecture.md', 'docs/traffic-model.md', 'docs/demo.md', 'docs/performance.md']) {
      expect(existsSync(join(ROOT, p)), p).toBe(true);
    }
    const readme = read('README.md');
    for (const cmd of ['pnpm -C web build:wasm', 'pnpm -C web dev', 'pnpm -C web test', 'pnpm -C web e2e', 'cargo test']) {
      expect(readme, `README: ${cmd}`).toContain(cmd);
    }
    expect(readme).toMatch(/docs\/architecture\.md/);
    expect(readme).toMatch(/docs\/demo\.md/);
    const model = read('docs/traffic-model.md');
    for (const term of [/\bqueued\b/i, /\bincomplete\b/i, /\bunserved\b/i, /saturation flow/i, /gridlock/i, /demand/i]) expect(model).toMatch(term);
    const demo = read('docs/demo.md');
    for (const term of [/close the main bridge/i, /rewind|scrub/i, /branch/i, /compare side by side/i]) expect(demo).toMatch(term);
    const arch = read('docs/architecture.md');
    for (const term of [/web worker/i, /snapshot/i, /determinis/i, /lockstep/i]) expect(arch).toMatch(term);
  });

  test('6 performance_doc_cites_measured_timeline_numbers', () => {
    const doc = read('docs/performance.md');
    const start = doc.indexOf('## Timeline');
    expect(start, 'performance.md has a Timeline section').toBeGreaterThanOrEqual(0);
    const next = doc.indexOf('\n## ', start + 5);
    const section = doc.slice(start, next < 0 ? undefined : next);
    expect(section).toContain('timeline.json');
    const leaves: number[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'number') leaves.push(v);
      else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
    };
    walk(JSON.parse(read('web/perf-results/timeline.json')));
    // every number in the section's table rows is a measured value from the JSON (same decimals)
    const rows = section.split('\n').filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l));
    const numbers = rows.flatMap((l) => [...l.replace(/\*\*/g, '').matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)].map((m) => m[1]!));
    expect(numbers.length).toBeGreaterThan(5);
    const missing = numbers.filter((d) => {
      const k = d.includes('.') ? d.split('.')[1]!.length : 0;
      return !leaves.some((v) => v.toFixed(k) === d || (k === 0 && Math.round(v) === Number(d)));
    });
    expect(missing).toEqual([]);
  });

  test('8 readme_commands_are_real', () => {
    const readme = read('README.md');
    const scripts = Object.keys((JSON.parse(read('web/package.json')) as { scripts: Record<string, string> }).scripts);
    for (const m of readme.matchAll(/pnpm -C web ([\w:]+)/g)) {
      const s = m[1]!;
      if (s === 'exec' || s === 'install') continue;
      expect(scripts, `script ${s}`).toContain(s);
    }
    for (const m of readme.matchAll(/cargo [^\n`]*/g)) {
      const cmd = m[0];
      const test = /--test (\w+)/.exec(cmd);
      if (test) expect(existsSync(join(ROOT, 'crates/sim-core/tests', `${test[1]}.rs`)), cmd).toBe(true);
      const ex = /--example (\w+)/.exec(cmd);
      if (ex) expect(existsSync(join(ROOT, 'crates/sim-core/examples', `${ex[1]}.rs`)), cmd).toBe(true);
      const pkg = /-p ([\w-]+)/.exec(cmd);
      if (pkg) expect(existsSync(join(ROOT, 'crates', pkg[1]!)), cmd).toBe(true);
    }
  });

  test('9 epic_gate_deviation_list_complete', () => {
    const arch = read('docs/architecture.md');
    const devStart = arch.search(/^## Deviations/m);
    expect(devStart, 'architecture.md has a Deviations section').toBeGreaterThanOrEqual(0);
    const deviations = arch.slice(devStart);
    const titles: string[] = [];
    for (const ward of ['ward-003', 'ward-004']) {
      const w = read(`.wdd/wards/timeline/${ward}.md`);
      const s = w.search(/^## Deviations from T[34]/m);
      expect(s, `${ward} has deviations`).toBeGreaterThanOrEqual(0);
      const block = w.slice(s, w.indexOf('\n## ', s + 5));
      for (const m of block.matchAll(/^- \*\*(.+?)\*\*/gm)) titles.push(m[1]!.replace(/[.`]/g, '').trim());
    }
    expect(titles.length).toBeGreaterThanOrEqual(6);
    const plain = deviations.replace(/[`*]/g, '');
    for (const t of titles) expect(plain, `deviation "${t}" is in architecture.md`).toContain(t);
  });
});

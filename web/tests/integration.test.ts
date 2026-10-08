// Ward timeline-005, tests 3–6, 8, 9: wiring and delivery checks by static analysis of the sources.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

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

/** Source without comments (line and block); strings stay. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

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

/** A markdown section from its `## Title` heading (exact level) to the next heading of the same or a higher level. */
function section(doc: string, title: RegExp): string | null {
  const lines = doc.split('\n');
  const i = lines.findIndex((l) => /^## /.test(l) && title.test(l.slice(3)));
  if (i < 0) return null;
  const j = lines.findIndex((l, k) => k > i && /^#{1,2} /.test(l));
  return lines.slice(i, j < 0 ? undefined : j).join('\n');
}

describe('timeline-005 integration checks', () => {
  test('3 protocol_messages_are_wired', () => {
    const client = stripComments(read('web/src/sim/client.ts'));
    const host = stripComments(read('web/src/sim/host.ts'));
    const worker = stripComments(read('web/src/sim/worker.ts'));
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
    // the client's sending methods are all used by the UI (a message nobody can trigger is unwired too)
    const ui = files(join(WEB, 'src'), /\.tsx?$/)
      .filter((f) => !f.includes('/sim/'))
      .map((f) => stripComments(readFileSync(f, 'utf8')))
      .join('\n');
    const methods = [...client.matchAll(/^\s+(\w+):\s*\([^)]*\)\s*=>\s*send\(\{\s*type: '/gm)].map((m) => m[1]!);
    expect(methods.length, 'client send methods found').toBeGreaterThanOrEqual(8);
    for (const m of methods) expect(new RegExp(`\\.${m}\\(`).test(ui), `UI calls client.${m}`).toBe(true);
  });

  test('4 no_orphaned_exports', () => {
    /** Public symbols kept on purpose (named in the specs, read in tests or docs). */
    const ALLOWLIST: Record<string, string> = {
      // add `symbol: 'reason'` entries only with a reason
    };
    const src = files(join(WEB, 'src'), /\.(ts|tsx)$/);
    const users = [...src, ...files(join(WEB, 'tests'), /\.ts$/), ...files(join(WEB, 'e2e'), /\.ts$/)];
    const text = new Map(users.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));
    const noExt = (p: string) => p.replace(/\.(tsx?|js)$/, '').replace(/\/index$/, '');
    /** Every symbol each file imports, keyed by the resolved module it imports from. */
    const imported = new Map<string, Set<string>>();
    const namespaces: [string, string, string][] = []; // [importer, module, alias]
    const add = (mod: string, name: string) => {
      if (!imported.has(mod)) imported.set(mod, new Set());
      imported.get(mod)!.add(name);
    };
    for (const [f, t] of text) {
      const at = (spec: string) => (spec.startsWith('.') ? noExt(resolve(dirname(f), spec)) : spec);
      for (const m of t.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
        const clause = m[1]!;
        const mod = at(m[2]!);
        const ns = /\*\s+as\s+(\w+)/.exec(clause);
        if (ns) namespaces.push([f, mod, ns[1]!]);
        const named = /\{([^}]*)\}/.exec(clause);
        if (named)
          for (const part of named[1]!.split(',')) {
            const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim();
            if (name) add(mod, name);
          }
      }
    }
    const orphans: string[] = [];
    for (const f of src) {
      const own = text.get(f)!;
      const names = [
        ...[...own.matchAll(/^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+(\w+)/gm)].map((m) => m[1]!),
        ...[...own.matchAll(/^export\s+\{([^}]*)\}(?!\s*from)/gm)].flatMap((m) => m[1]!.split(',').map((p) => p.trim().split(/\s+as\s+/).pop()!.trim())),
      ].filter(Boolean);
      const mod = noExt(f); // `from './cities'` and `from './cities/index'` both name cities/index.ts
      for (const name of names) {
        if (name in ALLOWLIST) continue;
        const used =
          imported.get(mod)?.has(name) || namespaces.some(([g, m, alias]) => g !== f && m === mod && new RegExp(`\\b${alias}\\.${name}\\b`).test(text.get(g)!));
        if (!used) orphans.push(`${relative(WEB, f)}: ${name}`);
      }
    }
    expect(orphans).toEqual([]);
    for (const [name, reason] of Object.entries(ALLOWLIST)) expect(reason.trim().length, `allowlist reason for ${name}`).toBeGreaterThan(10);
  });

  test('5 docs_exist_and_cover_the_brief', () => {
    for (const p of ['README.md', 'docs/architecture.md', 'docs/traffic-model.md', 'docs/demo.md', 'docs/performance.md']) {
      expect(existsSync(join(ROOT, p)), p).toBe(true);
    }
    const readme = read('README.md');
    for (const cmd of ['pnpm -C web build:wasm', 'pnpm -C web dev', 'pnpm -C web test', 'pnpm -C web e2e', 'pnpm -C web e2e:perf', 'cargo test']) {
      expect(readme, `README: ${cmd}`).toContain(cmd);
    }
    for (const pre of [/\brust\b|\bcargo\b/i, /wasm-pack/, /\bnode\b/i, /\bpnpm\b/]) expect(readme, `README prerequisite ${pre}`).toMatch(pre);
    for (const p of [/\?city=three_bridges/, /\?demand=/]) expect(readme, `README URL parameter ${p}`).toMatch(p);
    for (const k of [/\bSpace\b/, /\bB\b/, /\bD\b/, /\bEsc\b/]) expect(readme, `README key ${k}`).toMatch(k);
    for (const d of ['architecture', 'traffic-model', 'demo', 'performance']) expect(readme).toContain(`docs/${d}.md`);
    const model = read('docs/traffic-model.md');
    // the three metric terms are defined: each is followed (same paragraph) by "means"/"is"/":" and an explanation
    for (const term of ['queued', 'incomplete', 'unserved']) {
      expect(model, `traffic-model.md defines "${term}"`).toMatch(new RegExp(`\\*\\*${term}\\*\\*[^\\n]*(?:means|is|:|=)[^\\n]{20,}`, 'i'));
    }
    for (const term of [/saturation flow/i, /gridlock/i, /demand/i, /hysteresis/i, /closure|closed/i]) expect(model).toMatch(term);
    const demo = read('docs/demo.md');
    for (const term of [/close the main bridge/i, /rewind|scrub/i, /branch/i, /compare side by side/i]) expect(demo).toMatch(term);
    const arch = read('docs/architecture.md');
    for (const term of [/web worker/i, /snapshot/i, /determinis/i, /lockstep/i]) expect(arch).toMatch(term);
    // "≤ 2 pages": the body before § Deviations stays under ~1100 words
    const body = arch.slice(0, Math.max(0, arch.search(/^## Deviations/m)) || undefined);
    expect(body.split(/\s+/).filter(Boolean).length, 'architecture.md ≤ 2 pages').toBeLessThanOrEqual(1100);
  });

  test('6 performance_doc_cites_measured_timeline_numbers', () => {
    const doc = read('docs/performance.md');
    const sec = section(doc, /^Timeline\b/);
    expect(sec, 'performance.md has a "## Timeline" section').not.toBeNull();
    expect(sec!).toContain('timeline.json');
    const json = JSON.parse(read('web/perf-results/timeline.json')) as Record<string, unknown>;
    const leaves: number[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'number') leaves.push(v);
      else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
    };
    walk(json);
    // every number in the section's prose and tables (units attached or not), outside code spans and link targets
    const plain = sec!
      .split('\n')
      .slice(1)
      .join('\n')
      .replace(/`[^`]*`/g, ' ')
      .replace(/\]\([^)]*\)/g, ']')
      .replace(/\*\*/g, '');
    const numbers = [...plain.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?!\d|\.\d)/g)].map((m) => m[1]!);
    expect(numbers.length).toBeGreaterThan(8);
    const missing = numbers.filter((d) => {
      const k = d.includes('.') ? d.split('.')[1]!.length : 0;
      // decimals: a measured value printed with that many decimals; integers: an integer leaf, exactly
      return !leaves.some((v) => (k > 0 ? v.toFixed(k) === d : Number.isInteger(v) && v === Number(d)));
    });
    expect(missing, 'numbers in § Timeline that are not values in timeline.json').toEqual([]);
    // and the headline measurements are cited (each with 1–3 decimals or as an exact integer)
    const get = (path: string) => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], json) as number;
    for (const path of ['seek.medianMs', 'seek.p95Ms', 'branch.ms', 'memory.totalMiB', 'single.tickMsMean', 'lockstep.tickMsMean', 'lockstepTickCostRatio']) {
      const v = get(path);
      expect(typeof v, `timeline.json ${path}`).toBe('number');
      const forms = Number.isInteger(v) ? [String(v)] : [1, 2, 3].map((k) => v.toFixed(k));
      expect(forms.some((s) => numbers.includes(s)), `§ Timeline cites ${path} (${v})`).toBe(true);
    }
  });

  test('8 readme_commands_are_real', () => {
    const readme = read('README.md');
    const scripts = Object.keys((JSON.parse(read('web/package.json')) as { scripts: Record<string, string> }).scripts);
    for (const m of readme.matchAll(/pnpm -C web ([\w:]+)/g)) {
      const s = m[1]!;
      if (s === 'exec' || s === 'install') continue;
      expect(scripts, `script ${s}`).toContain(s);
    }
    const crates = readdirSync(join(ROOT, 'crates'));
    for (const m of readme.matchAll(/cargo [^\n`]*/g)) {
      const cmd = m[0];
      const pkg = /-p ([\w-]+)/.exec(cmd)?.[1];
      if (pkg) expect(crates, cmd).toContain(pkg);
      const dirs = pkg ? [pkg] : crates;
      for (const [flag, sub] of [
        ['--test', 'tests'],
        ['--example', 'examples'],
        ['--bench', 'benches'],
      ] as const) {
        const target = new RegExp(`${flag} (\\w+)`).exec(cmd)?.[1];
        if (target) expect(dirs.some((c) => existsSync(join(ROOT, 'crates', c, sub, `${target}.rs`))), cmd).toBe(true);
      }
      // a test-name filter after the target names a test function that exists in that file
      const filter = /--test (\w+) (\w+)\s*$/.exec(cmd.trim());
      if (filter) {
        const file = dirs.map((c) => join(ROOT, 'crates', c, 'tests', `${filter[1]}.rs`)).find(existsSync)!;
        expect(readFileSync(file, 'utf8'), cmd).toMatch(new RegExp(`fn ${filter[2]}\\b`));
      }
    }
  });

  test('9 epic_gate_deviation_list_complete', () => {
    const arch = read('docs/architecture.md');
    const dev = section(arch, /^Deviations\b/);
    expect(dev, 'architecture.md has a "## Deviations" section').not.toBeNull();
    const clean = (s: string) => s.replace(/[`*]/g, '').replace(/\.\s*$/, '').trim();
    /** Lead texts of the section's list items and sub-headings, cleaned the same way as the titles. */
    const leads = dev!
      .split('\n')
      .filter((l) => /^\s*- |^#{3,} /.test(l))
      .map((l) => clean(l.replace(/^\s*- |^#{3,} /, '')));
    const titles: string[] = [];
    for (const ward of ['ward-003', 'ward-004']) {
      const w = read(`.wdd/wards/timeline/${ward}.md`);
      const block = section(w, /^Deviations from T[34]/);
      expect(block, `${ward} has deviations`).not.toBeNull();
      for (const m of block!.matchAll(/^- \*\*(.+?)\*\*/gm)) titles.push(clean(m[1]!));
    }
    expect(titles.length).toBeGreaterThanOrEqual(8);
    for (const t of titles) expect(leads.some((l) => l.startsWith(t)), `deviation "${t}" leads an item in § Deviations`).toBe(true);
    // the epic's Completion Criteria are each accounted for (a list item or sub-heading led by the label)
    const crit = section(read('.wdd/epics/timeline.md'), /^Completion Criteria\b/);
    expect(crit).not.toBeNull();
    const labels = [...crit!.matchAll(/^- \*\*(.+?):?\*\*/gm)].map((m) => clean(m[1]!.replace(/:$/, '')));
    expect(labels.length).toBeGreaterThanOrEqual(4);
    for (const l of labels) expect(leads.some((x) => x.toLowerCase().startsWith(l.toLowerCase())), `completion criterion "${l}" in § Deviations`).toBe(true);
  });
});

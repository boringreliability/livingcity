// Ward polish-001, tests 8–9: honest definitions in code comments and docs (static).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const ROOT = join(new URL('..', import.meta.url).pathname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('polish-001 docs and labels', () => {
  test('8 unserved_definition_is_documented', () => {
    const src = read('web/src/ui/MetricsStrip.tsx');
    const at = src.indexOf('const UNSERVED_TOOLTIP');
    expect(at).toBeGreaterThan(0);
    // the doc comment directly above the constant
    const before = src.slice(0, at);
    const open = before.lastIndexOf('/**');
    const close = before.lastIndexOf('*/');
    expect(open, 'a /** */ comment above UNSERVED_TOOLTIP').toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(open);
    expect(before.slice(close + 2).trim(), 'nothing between the comment and the constant').toBe('');
    const comment = before.slice(open, close);
    for (const term of [/no[ _]route/i, /stranded/i, /unreachable/i, /gridlock/i]) expect(comment, `comment names ${term}`).toMatch(term);
    // the docs define unserved with the same parts
    const model = read('docs/traffic-model.md');
    const line = model.split('\n').find((l) => /\*\*unserved\*\*/.test(l));
    expect(line, 'traffic-model.md has an **unserved** definition').toBeDefined();
    for (const term of [/no ?route/i, /stranded/i, /unreachable/i, /gridlock/i]) expect(line!, `traffic-model unserved names ${term}`).toMatch(term);
  });

  test('9 memory_deviation_matches_the_host', () => {
    const arch = read('docs/architecture.md');
    const item = arch.split('\n').find((l) => /^- \*\*Memory\.?\*\*/.test(l));
    expect(item, 'architecture.md has the Memory deviation').toBeDefined();
    expect(item!).not.toMatch(/two Bs/i);
    expect(item!).toMatch(/\bfreed?\b[^.]*\bbefore\b|\bbefore\b[^.]*\bbuil[dt]\b/i);
    expect(item!).toMatch(/A plus (one|a single) B/i);
    // and the host does it in that order: in `branch`, the old B is freed before `a.branch(` builds the new one
    const host = read('web/src/sim/host.ts');
    const start = host.indexOf('const branch = (');
    expect(start).toBeGreaterThan(0);
    const body = host.slice(start, host.indexOf('\n  };', start));
    const freeAt = body.search(/scenarios\[1\]\??\.free\??\.\(\)/);
    const buildAt = body.search(/\ba\.branch\(/);
    expect(freeAt, 'old B freed in branch()').toBeGreaterThan(0);
    expect(buildAt, 'new B built in branch()').toBeGreaterThan(0);
    expect(freeAt).toBeLessThan(buildAt);
  });
});

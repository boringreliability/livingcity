// Ward fonts-001, test 1: the UI and monospace fonts are bundled (same origin) and named first.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const WEB = new URL('..', import.meta.url).pathname;
const ROOT = join(WEB, '..');
const read = (p: string) => readFileSync(p, 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const at = css.search(new RegExp(`(^|\\n|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`));
  expect(at, `a ${selector} rule`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('fonts-001', () => {
  test('1 fonts_are_bundled', () => {
    const pkg = JSON.parse(read(join(WEB, 'package.json'))) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps['@fontsource-variable/inter'], 'Inter, exact version').toBe('5.3.0');
    expect(deps['@fontsource/jetbrains-mono'], 'JetBrains Mono, exact version').toBe('5.3.0');

    const entry = read(join(WEB, 'src/main.tsx'));
    expect(entry).toMatch(/^import ['"]@fontsource-variable\/inter(\/[^'"]*)?['"];?$/m);
    expect(entry).toMatch(/^import ['"]@fontsource\/jetbrains-mono(\/[^'"]*)?['"];?$/m);

    const css = read(join(WEB, 'src/styles.css'));
    const family = (decls: string) => /font-family:\s*([^;]+);/.exec(decls)?.[1]?.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')) ?? [];
    expect(family(rule(css, ':root'))[0], 'the root stack starts with the bundled UI font').toBe('Inter Variable');
    expect(family(rule(css, '.mono'))[0], '.mono starts with the bundled monospace font').toBe('JetBrains Mono');

    // a real production build: the font files are emitted next to the app, and nothing points elsewhere
    const out = mkdtempSync(join(tmpdir(), 'lc-fonts-'));
    try {
      execFileSync(join(WEB, 'node_modules/.bin/vite'), ['build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: WEB, encoding: 'utf8' });
      const assets = readdirSync(join(out, 'assets'));
      const woff2 = assets.filter((f) => f.endsWith('.woff2'));
      expect(woff2.some((f) => /^inter/i.test(f)), 'an Inter woff2 in dist/assets').toBe(true);
      expect(woff2.some((f) => /^jetbrains-mono/i.test(f)), 'a JetBrains Mono woff2 in dist/assets').toBe(true);
      const built = assets.filter((f) => f.endsWith('.css')).map((f) => read(join(out, 'assets', f))).join('\n');
      const faces = [...built.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
      expect(faces.some((f) => /font-family:\s*['"]?Inter Variable['"]?/.test(f)), '@font-face for Inter Variable').toBe(true);
      expect(faces.some((f) => /font-family:\s*['"]?JetBrains Mono['"]?/.test(f)), '@font-face for JetBrains Mono').toBe(true);
      const urls = faces.flatMap((f) => [...f.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]!));
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.filter((u) => /^(https?:)?\/\//i.test(u)), 'no font from another origin').toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }

    const readme = read(join(ROOT, 'README.md'));
    expect(readme).toMatch(/Inter/);
    expect(readme).toMatch(/JetBrains Mono/);
    expect(readme).toMatch(/OFL|SIL Open Font License/);
  }, 120_000);
});

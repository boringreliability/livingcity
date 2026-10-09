// Ward polish-004, tests 4 and 9: the guide only reads state; the demo doc and README match it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { GUIDE_STEPS } from '../src/ui/DemoGuide';

const ROOT = join(new URL('..', import.meta.url).pathname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('polish-004 static', () => {
  test('4 guide_never_drives_the_simulation', () => {
    expect([...GUIDE_STEPS]).toEqual(['Close the main bridge', 'Watch the queues', 'Pause and rewind', 'Try another decision', 'Compare side by side']);
    const src = read('web/src/ui/DemoGuide.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // no worker access at all
    expect(src).not.toMatch(/from ['"][^'"]*sim\/(client|host|worker)['"]/);
    expect(src).not.toMatch(/\b(postMessage|createSimClient|closeLink|openLink|setRunning|setSpeed|seek|branch|compare)\s*\(/);
    // its only function-typed prop is onHide (interface or type alias; methods or arrow types)
    const props = src.match(/(?:interface\s+\w*Props\s*|type\s+\w*Props\s*=\s*)\{([\s\S]*?)\n\}/);
    expect(props, 'a Props interface or type').not.toBeNull();
    const fns = [...props![1]!.matchAll(/^\s*(\w+)\??\s*(?:\(|:\s*(?:\([^)]*\)\s*=>|\(\)\s*=>|Function|\w*Callback))/gm)].map((m) => m[1]);
    expect(fns).toEqual(['onHide']);
  });

  test('9 demo_doc_matches_the_guide', () => {
    const demo = read('docs/demo.md');
    let at = -1;
    for (const t of GUIDE_STEPS) {
      const i = demo.toLowerCase().indexOf(t.toLowerCase(), at + 1);
      expect(i, `docs/demo.md names "${t}" after the previous step`).toBeGreaterThan(at);
      at = i;
    }
    const readme = read('README.md');
    expect(readme).toMatch(/demo guide/i);
    expect(readme).toMatch(/\bGuide\b[^\n]*(reopen|show|button)|(reopen|show)[^\n]*\bGuide\b/i);
  });
});

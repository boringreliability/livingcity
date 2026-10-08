// Ward city-005, test 17: the metrics strip shows `unserved` (not `unreachable`).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { MetricsStrip } from '../src/ui/MetricsStrip';

describe('test 17: metrics_strip_shows_unserved', () => {
  test('unserved is shown with its definition; unreachable is not', () => {
    // Given metrics where unserved and unreachable differ
    const html = renderToStaticMarkup(
      createElement(MetricsStrip, { simTimeS: 905, metrics: { active: 1700, completed: 40, queued: 12, unreachable: 3, unserved: 7 } }),
    );
    // Then the strip shows unserved = 7 with its tooltip
    expect(html).toContain('unserved ⓘ');
    expect(html).toMatch(/title="Trips the city could not serve: no route at the origin, stranded without a route, or removed after 10 minutes in gridlock"[^>]*>\s*<span class="label">unserved ⓘ<\/span>\s*<span class="value">7<\/span>/);
    // and not unreachable
    expect(html).not.toMatch(/unreachable/i);
    expect(html).not.toMatch(/<span class="value">3<\/span>/);
    // and sim time is still labelled as sim time
    expect(html).toContain('00:15:05');
  });
});

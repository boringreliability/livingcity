import type { ComparisonMessage } from '../sim/protocol';
import { simClock } from './TimelineBar';

/** "m:ss" of rounded seconds; "—" when undefined (NaN). */
function mss(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
}

/** Count Δ (B − A): "+n ▲", "−n ▼" or "0": the sign and a glyph, never a hue. */
function countDelta(d: number): string {
  return d > 0 ? `+${d} ▲` : d < 0 ? `−${-d} ▼` : '0';
}

/** Time Δ = round(B) − round(A) seconds: "+m:ss ▲", "−m:ss ▼", "0:00"; "—" if either is undefined. */
function timeDelta(a: number, b: number): string {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
  const d = Math.round(b) - Math.round(a);
  const m = mss(Math.abs(d));
  return d > 0 ? `+${m} ▲` : d < 0 ? `−${m} ▼` : '0:00';
}

interface Props {
  comparison: ComparisonMessage;
  /** The bridges' display names in landmark order (motion-003): crossing rows since the branch. */
  bridgeNames?: string[];
}

/**
 * A and B at the same sim time, over the same cohort (the demand trips created since the branch):
 * real window metrics from both simulations (contract T4), with incomplete trips always shown.
 */
export function ComparisonPanel({ comparison: c, bridgeNames = [] }: Props) {
  const { a, b } = c;
  const unserved = (w: Float64Array) => w[4]! + w[5]!;
  const rows: [string, string, string, string, string][] = [
    ['Generated', 'Trips created since the branch (identical demand in A and B)', String(a[2]), String(b[2]), countDelta(b[2]! - a[2]!)],
    ['Completed', 'Of those, arrived', String(a[3]), String(b[3]), countDelta(b[3]! - a[3]!)],
    ['Incomplete', 'Of those, still on their way or waiting: a scenario is not better just because its slow trips have not arrived', String(a[6]), String(b[6]), countDelta(b[6]! - a[6]!)],
    ['Unserved', 'Of those, removed: no route, or 10 minutes in gridlock', String(unserved(a)), String(unserved(b)), countDelta(unserved(b) - unserved(a))],
    ['Mean trip', 'Mean travel time of the completed ones', mss(a[7]!), mss(b[7]!), timeDelta(a[7]!, b[7]!)],
    ['p95 trip', '95th percentile travel time of the completed ones', mss(a[8]!), mss(b[8]!), timeDelta(a[8]!, b[8]!)],
  ];
  // crossings of each bridge (both directions) since the branch: the same window for A and B (motion-003)
  const x = c.crossings;
  if (x)
    bridgeNames.forEach((name, i) => {
      const [ca, cb] = [x.a[2 * i]! + x.a[2 * i + 1]!, x.b[2 * i]! + x.b[2 * i + 1]!];
      if (Number.isFinite(ca) && Number.isFinite(cb))
        rows.push([`Crossings · ${name}`, `Vehicles that crossed ${name} (both directions) since the branch`, String(ca), String(cb), countDelta(cb - ca)]);
    });
  return (
    <section className="panel comparison" aria-label="Comparison">
      <p className="comparison-when">
        <span className="mono">sim time {simClock(c.tick)} (both)</span>
        <span className="comparison-since">measured since {simClock(c.fromTick)} (branch)</span>
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">metric</span>
            </th>
            <th scope="col">A</th>
            <th scope="col">B</th>
            <th scope="col">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, title, va, vb, d]) => (
            <tr key={name}>
              <th scope="row" title={title}>
                {name}
              </th>
              <td>{va}</td>
              <td>{vb}</td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

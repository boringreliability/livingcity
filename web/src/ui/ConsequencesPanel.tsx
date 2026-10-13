import { interventionGlyph, interventionVerb, type CrossingRate, type InterventionEntry } from './consequences';
import { simClock } from './TimelineBar';

interface Props {
  /** The interventions at or before the position (summarizeInterventions). */
  entries: InterventionEntry[];
  /** Crossings per bridge per 10 sim min: now, and before the latest bridge closure. */
  rates: CrossingRate[];
  /** The tick of the bridge closure "before" refers to, or null. */
  closureTick: number | null;
  /** The most-queued links now. */
  queues: { link: number; queued: number }[];
  onSelectLink(link: number): void;
}

const rate = (r: number | null) => (r === null ? '—' : String(Math.round(r)));
/** The change now − before in the comparison's count format; "—" when either is unknown. */
function change(now: number | null, before: number | null): string {
  if (now === null || before === null) return '—';
  const d = Math.round(now) - Math.round(before);
  return d > 0 ? `+${d} ▲` : d < 0 ? `−${-d} ▼` : '0';
}
const span = (s: number | null) => (s === null ? 'unknown' : `${Math.round(s / 60)} sim min`);

/**
 * Consequences of an intervention (ward motion-003): what was changed and when, how the bridges are used
 * now compared with before the closure, and where traffic queues. Single view only, and worded as
 * observations of this scenario over time; the A/B comparison is the comparison panel's.
 */
export function ConsequencesPanel({ entries, rates, closureTick, queues, onSelectLink }: Props) {
  return (
    <section className="panel consequences" aria-label="Intervention">
      <h2>Intervention</h2>
      <ul className="consequence-log">
        {entries.map((e) => (
          <li key={`${e.tick}:${e.kind}:${e.links.join(',')}`}>
            <span aria-hidden="true">{interventionGlyph(e.kind)}</span> {interventionVerb(e.kind)} {e.label} · {simClock(e.tick)}
          </li>
        ))}
      </ul>
      {rates.length > 0 && (
        <table className="consequence-crossings">
          <caption>
            Crossings per 10 min (observed){closureTick !== null ? `: now and before the bridge closure at ${simClock(closureTick)}` : ': now'}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">bridge</span>
              </th>
              <th scope="col">now</th>
              <th scope="col">before</th>
              <th scope="col">change</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.name} title={`Measured over ${span(r.nowSpanS)} now and ${span(r.beforeSpanS)} before the closure`}>
                <th scope="row">{r.name}</th>
                <td>{rate(r.now)}</td>
                <td>{rate(r.before)}</td>
                <td>{change(r.now, r.before)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {queues.length > 0 && (
        <>
          <h3>Longest queues now</h3>
          <ul className="consequence-queues">
            {queues.map((q) => (
              <li key={q.link}>
                <button type="button" onClick={() => onSelectLink(q.link)}>
                  Link {q.link} · {q.queued} queued
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

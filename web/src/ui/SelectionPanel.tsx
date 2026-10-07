import type { LinkGeom } from '../render/geometry';
import type { LinkDetail } from '../sim/protocol';

/** Seconds as an integer or one decimal plus unit (pinned format, e.g. `57 s`, `57.5 s`). */
const secs = (x: number) => `${Math.round(x * 10) / 10} s`;

interface Props {
  link: LinkGeom;
  speedMps: number;
  vehicles: number;
  queued: number;
  closed: boolean;
  /** Live statistics from the simulation (null until the first frame after selecting). */
  detail: LinkDetail | null;
  onClose(): void;
  onReopen(): void;
}

export function SelectionPanel(p: Props) {
  return (
    <section className="panel selection" aria-label="Selected road">
      <h2>Link {p.link.id}</h2>
      <dl>
        <dt>lanes</dt>
        <dd>{p.link.lanes}</dd>
        <dt>speed limit</dt>
        <dd>{Math.round(p.speedMps * 3.6)} km/h</dd>
        <dt>length</dt>
        <dd>{Math.round(p.link.length)} m</dd>
        <dt>vehicles</dt>
        <dd>{p.vehicles}</dd>
        <dt>queued</dt>
        <dd>{p.queued}</dd>
        <dt>state</dt>
        <dd>{p.closed ? 'closed' : 'open'}</dd>
        {p.detail && (
          <>
            <dt>capacity</dt>
            <dd data-testid="link-capacity">{Math.round(p.detail.capacityVph)} veh/h</dd>
            <dt>travel time now</dt>
            <dd data-testid="link-cost">{secs(p.detail.costS)}</dd>
            <dt>at free flow</dt>
            <dd data-testid="link-freeflow">{secs(p.detail.freeFlowS)}</dd>
            <dt>exits</dt>
            <dd>{p.detail.exits}</dd>
          </>
        )}
      </dl>
      {p.closed ? (
        <button type="button" onClick={p.onReopen}>
          Reopen link
        </button>
      ) : (
        <button type="button" onClick={p.onClose}>
          Close link
        </button>
      )}
    </section>
  );
}

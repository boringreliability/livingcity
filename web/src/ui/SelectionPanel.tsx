import type { LinkGeom } from '../render/geometry';

interface Props {
  link: LinkGeom;
  speedMps: number;
  vehicles: number;
  queued: number;
  closed: boolean;
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

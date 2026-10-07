import type { TrackedGone, TrackedState, TrackedVehicle } from '../sim/protocol';

/** State as text plus a shape icon (never colour alone). */
const STATE_LABEL: Record<TrackedState, { icon: string; text: string }> = {
  waiting: { icon: '◷', text: 'waiting at origin' },
  driving: { icon: '▶', text: 'driving' },
  queued: { icon: '■', text: 'queued' },
  stranded: { icon: '⊘', text: 'stranded: no route on' },
  no_route: { icon: '⊘', text: 'no route' },
};

const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

interface Props {
  vehicle: TrackedVehicle | null;
  gone: TrackedGone | null;
  /** Zone name of a node, or `node <id>` for a plain junction. */
  placeName(node: number): string;
  following: boolean;
  onFollow(): void;
  onStopFollowing(): void;
  onDismiss(): void;
}

function goneText(g: TrackedGone): string {
  switch (g.outcome) {
    case 'completed':
      return `Arrived after ${clock(g.travelTimeS ?? 0)}`;
    case 'removed_unreachable':
      return 'Removed: no route';
    case 'removed_gridlock':
      return 'Removed: gridlock';
    default:
      return 'The trip ended';
  }
}

export function VehiclePanel(p: Props) {
  const v = p.vehicle;
  const trip = v?.tripId ?? p.gone?.tripId;
  return (
    <section className="panel vehicle" aria-label="Selected vehicle">
      <h2 data-testid="vehicle-title">
        {v ? `Trip #${v.tripId}: ${p.placeName(v.origin)} → ${p.placeName(v.dest)}` : `Trip #${trip ?? '?'}`}
      </h2>
      {v ? (
        <>
          <p className="state">
            <span aria-hidden="true" className="state-icon">
              {STATE_LABEL[v.state].icon}
            </span>{' '}
            {STATE_LABEL[v.state].text}
          </p>
          <dl>
            <dt>speed</dt>
            <dd>{Math.round(v.v * 3.6)} km/h</dd>
            <dt>on trip</dt>
            <dd>{clock(v.ageS)}</dd>
            <dt>road</dt>
            <dd>{v.link >= 0 ? `link ${v.link}` : '—'}</dd>
            <dt>route changes</dt>
            <dd>{v.routeSwitches}</dd>
          </dl>
          {v.blockedTicks > 0 && <p className="blocked">waiting for space {Math.round(v.blockedTicks / 2)} s</p>}
          {p.following ? (
            <button type="button" onClick={p.onStopFollowing}>
              Stop following
            </button>
          ) : (
            <button type="button" onClick={p.onFollow}>
              Follow
            </button>
          )}
        </>
      ) : (
        p.gone && (
          <>
            <p className="state">{goneText(p.gone)}</p>
            <button type="button" onClick={p.onDismiss}>
              Close
            </button>
          </>
        )
      )}
    </section>
  );
}

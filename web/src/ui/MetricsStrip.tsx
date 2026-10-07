function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

function minutes(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface Props {
  simTimeS: number;
  metrics: Record<string, number>;
}

/** Real values computed by the simulation; sim time is labelled as such. */
export function MetricsStrip({ simTimeS, metrics }: Props) {
  return (
    <section className="panel metrics" aria-label="Simulation metrics">
      <div className="metric simtime">
        <span className="label">sim time</span>
        <span className="value mono">{clock(simTimeS)}</span>
      </div>
      <div className="metric">
        <span className="label">active</span>
        <span className="value">{metrics['active'] ?? 0}</span>
      </div>
      <div className="metric">
        <span className="label">completed</span>
        <span className="value">{metrics['completed'] ?? 0}</span>
      </div>
      <div className="metric" title="Mean travel time of completed trips, including waiting at the origin">
        <span className="label">mean trip</span>
        <span className="value">{minutes(metrics['mean_travel_time_s'])}</span>
      </div>
      <div className="metric" title="Queued = vehicles on the road network moving slower than 2 m/s (stopped or crawling)">
        <span className="label">queued ⓘ</span>
        <span className="value">{metrics['queued'] ?? 0}</span>
      </div>
      <div className="metric" title="Trips without any route: waiting at their origin, stranded on a road, or removed">
        <span className="label">unreachable</span>
        <span className="value">{metrics['unreachable'] ?? 0}</span>
      </div>
    </section>
  );
}

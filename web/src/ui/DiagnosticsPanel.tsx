import { DT, type ClockStatus, type PerfStats } from '../sim/protocol';

export interface RenderStats {
  intervalMedianMs: number;
  intervalP95Ms: number;
  drawMedianMs: number;
  drawP95Ms: number;
  samples: number;
}

interface Props {
  perf: PerfStats | null;
  render: RenderStats;
  onNetwork: number;
  active: number;
  frameBytes: number;
  clock: ClockStatus | null;
}

/** Measured performance counters (contract C5): sim tick time and render time are shown separately. */
export function DiagnosticsPanel({ perf, render, onNetwork, active, frameBytes, clock }: Props) {
  const row = (label: string, testId: string, value: string, title?: string) => (
    <div className="diag-row" title={title}>
      <dt>{label}</dt>
      <dd data-testid={testId}>{value}</dd>
    </div>
  );
  const achieved = clock ? clock.achievedTicksPerS * DT : 0;
  return (
    <section className="panel diagnostics" aria-label="Diagnostics">
      <h2>Diagnostics</h2>
      <dl>
        {row('sim tick (median / p95)', 'diag-tick', `${(perf?.tickMsMedian ?? 0).toFixed(3)} / ${(perf?.tickMsP95 ?? 0).toFixed(3)} ms`,
          `Wall time per simulation tick over the last ${perf?.ticksMeasured ?? 0} ticks (timer step ${(perf?.timerResolutionMs ?? 0).toFixed(3)} ms)`)}
        {row('ticks measured', 'diag-ticks-measured', String(perf?.ticksMeasured ?? 0))}
        {row('frame encode', 'diag-encode', `${(perf?.encodeMs ?? 0).toFixed(2)} ms`)}
        {row('render interval (median / p95)', 'diag-render', `${render.intervalMedianMs.toFixed(1)} / ${render.intervalP95Ms.toFixed(1)} ms`,
          `Time between drawn pictures over the last ${render.samples} frames`)}
        {row('draw CPU (median / p95)', 'diag-draw', `${render.drawMedianMs.toFixed(1)} / ${render.drawP95Ms.toFixed(1)} ms`)}
        {row('vehicles (on network / active)', 'diag-vehicles', `${onNetwork} / ${active}`, 'Active also counts trips still waiting at their origin')}
        {row('frame size', 'diag-bytes', `${frameBytes} B`)}
        {row('speed', 'diag-speed', `${achieved.toFixed(1)}× of ${clock?.multiplier ?? 0}×`, 'Achieved vs. requested simulation speed')}
      </dl>
    </section>
  );
}

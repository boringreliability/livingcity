import { DT, type ClockStatus, type PerfStats } from '../sim/protocol';

export interface RenderStats {
  intervalMedianMs: number;
  intervalP95Ms: number;
  drawMedianMs: number;
  drawP95Ms: number;
  samples: number;
}

/** Presentation latency (ward motion-002): the sim tick each side last drew with (B: null outside the
 *  comparison) and how far A's picture trails its newest frame, in sim s and wall ms (0 while paused). */
export interface PresentationStats {
  tickA: number;
  tickB: number | null;
  lagS: number;
  lagMs: number;
}

interface Props {
  perf: PerfStats | null;
  render: RenderStats;
  onNetwork: number;
  active: number;
  frameBytes: number;
  clock: ClockStatus | null;
  /** Lockstep A + B: the tick cost is the pair's; the frame rows are A's. */
  comparing?: boolean;
  presentation?: PresentationStats;
}

/** Measured performance counters (contract C5): sim tick time and render time are shown separately. */
export function DiagnosticsPanel({ perf, render, onNetwork, active, frameBytes, clock, comparing = false, presentation }: Props) {
  const row = (label: string, testId: string, value: string, title?: string) => (
    <div className="diag-row" title={title}>
      <dt>{label}</dt>
      <dd data-testid={testId}>{value}</dd>
    </div>
  );
  const achieved = clock ? clock.achievedTicksPerS * DT : 0;
  return (
    <section className="panel diagnostics" aria-label="Diagnostics">
      <h2>
        Diagnostics
        {presentation && (
          // in the heading line: the panel keeps its height (its placement beside the legend is measured)
          <span
            className="diag-lag"
            data-testid="diag-lag"
            title={`Picture lag: the drawn picture trails the newest simulation frame by ${presentation.lagS.toFixed(2)} sim s; cars move smoothly between frames and are never drawn ahead of one`}
          >
            lag {presentation.lagMs.toFixed(0)} ms
          </span>
        )}
      </h2>
      <dl>
        {row(comparing ? 'sim tick, A + B (median / p95)' : 'sim tick (median / p95)', 'diag-tick', `${(perf?.tickMsMedian ?? 0).toFixed(3)} / ${(perf?.tickMsP95 ?? 0).toFixed(3)} ms`,
          `Wall time per simulation tick over the last ${perf?.ticksMeasured ?? 0} ticks (timer step ${(perf?.timerResolutionMs ?? 0).toFixed(3)} ms)`)}
        {row(comparing ? 'sim tick, A + B (mean)' : 'sim tick (mean)', 'diag-tick-mean', `${(perf?.tickMsMean ?? 0).toFixed(3)} ms`,
          'Total measured time ÷ ticks: unlike the percentiles, it resolves costs below the timer step')}
        {row('ticks measured', 'diag-ticks-measured', String(perf?.ticksMeasured ?? 0))}
        {row(comparing ? 'frame encode (A)' : 'frame encode', 'diag-encode', `${(perf?.encodeMs ?? 0).toFixed(2)} ms`)}
        {row('render interval (median / p95)', 'diag-render', `${render.intervalMedianMs.toFixed(1)} / ${render.intervalP95Ms.toFixed(1)} ms`,
          `Time between drawn pictures over the last ${render.samples} frames`)}
        {row('draw CPU (median / p95)', 'diag-draw', `${render.drawMedianMs.toFixed(1)} / ${render.drawP95Ms.toFixed(1)} ms`)}
        {row(comparing ? 'vehicles in A (on network / active)' : 'vehicles (on network / active)', 'diag-vehicles', `${onNetwork} / ${active}`, 'Active also counts trips still waiting at their origin')}
        {row(comparing ? 'frame size (A)' : 'frame size', 'diag-bytes', `${frameBytes} B`)}
        {row('speed', 'diag-speed', `${achieved.toFixed(1)}× of ${clock?.multiplier ?? 0}×`, 'Achieved vs. requested simulation speed')}
      </dl>
    </section>
  );
}

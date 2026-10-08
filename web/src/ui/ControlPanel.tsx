import type { ClockStatus } from '../sim/protocol';
import { DT } from '../sim/protocol';

export const SPEEDS = [1, 5, 20, 60] as const;

interface Props {
  running: boolean;
  speed: number;
  clock: ClockStatus | null;
  mainBridgeClosed: boolean;
  mainBridgePending: boolean;
  onToggleRunning(): void;
  onSpeed(speed: number): void;
  onToggleMainBridge(): void;
  /** Disable every control (e.g. when the city cannot be drawn). */
  disabled?: boolean;
  diagnosticsOpen: boolean;
  onToggleDiagnostics(): void;
  /** Demand scale from `?demand=` (1 = the normal city: no badge). */
  demandScale: number;
}

export function ControlPanel(p: Props) {
  const achieved = p.clock ? p.clock.achievedTicksPerS * DT : 0;
  const behind = !!p.clock?.behind;
  return (
    <section className="panel controls" aria-label="Simulation controls">
      <div className="row">
        <button type="button" className="primary" onClick={p.onToggleRunning} disabled={p.disabled}>
          {p.running ? 'Pause' : 'Play'}
        </button>
        <select aria-label="Speed" value={p.speed} onChange={(e) => p.onSpeed(Number(e.target.value))} disabled={p.disabled}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <span className="speed" data-testid="achieved-speed" title="Achieved simulation speed vs. the requested speed">
          {achieved.toFixed(1)}× of {p.speed}×
        </span>
        {/* compact (an icon) so the panel stays inside the top inset band */}
        <button
          type="button"
          className="diag-toggle"
          aria-label="Diagnostics"
          aria-expanded={p.diagnosticsOpen}
          onClick={p.onToggleDiagnostics}
          title="Diagnostics: measured performance (D)"
        >
          <span aria-hidden="true">≡</span>
        </button>
        {p.demandScale !== 1 && (
          <span className="stress" title="Demand multiplied for measurement (?demand=): a load test, not a forecast">
            stress test ×{p.demandScale}
          </span>
        )}
      </div>
      <div role="status" aria-live="polite" className="behind">
        {behind ? '⚠ Behind — the engine cannot keep up with this speed' : ''}
      </div>
      <button
        type="button"
        className={`bridge ${p.mainBridgeClosed ? 'closed' : ''}`}
        aria-label="Close the main bridge"
        aria-pressed={p.mainBridgeClosed}
        onClick={p.onToggleMainBridge}
        disabled={p.disabled}
      >
        <span aria-hidden="true" className="barrier-icon" />
        {p.mainBridgeClosed ? 'Main bridge closed — reopen' : 'Close the main bridge'}
        {p.mainBridgePending ? ' (pending)' : ''}
      </button>
    </section>
  );
}

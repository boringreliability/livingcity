import { useRef } from 'react';

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
  /** When set, the main-bridge action alone is disabled with this text as the reason. */
  bridgeDisabledReason?: string;
  /** While comparing the button acts on neither side: it shows no closed/open state of its own. */
  bridgeStateHidden?: boolean;
  diagnosticsOpen: boolean;
  onToggleDiagnostics(): void;
  /** Demand scale from `?demand=` (1 = the normal city: no badge). */
  demandScale: number;
}

export function ControlPanel(p: Props) {
  const achieved = p.clock ? p.clock.achievedTicksPerS * DT : 0;
  const behind = !!p.clock?.behind;
  const pointerPick = useRef(false);
  const closedShown = p.mainBridgeClosed && !p.bridgeStateHidden;
  return (
    <section className="panel controls" aria-label="Simulation controls">
      <div className="row">
        <button type="button" className="primary" onClick={p.onToggleRunning} disabled={p.disabled}>
          {p.running ? 'Pause' : 'Play'}
        </button>
        <select
          aria-label="Speed"
          value={p.speed}
          onPointerDown={() => (pointerPick.current = true)}
          onKeyDown={() => (pointerPick.current = false)}
          onChange={(e) => {
            p.onSpeed(Number(e.target.value));
            // a pointer pick gives focus back (Space/B stay shortcuts); a keyboard change keeps it
            if (pointerPick.current) e.currentTarget.blur();
            pointerPick.current = false;
          }}
          disabled={p.disabled}
        >
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
        className={`bridge ${closedShown ? 'closed' : ''}`}
        aria-label="Close the main bridge"
        aria-pressed={p.bridgeStateHidden ? undefined : p.mainBridgeClosed}
        onClick={p.onToggleMainBridge}
        disabled={p.disabled || !!p.bridgeDisabledReason}
        title={p.bridgeDisabledReason}
      >
        <span aria-hidden="true" className="barrier-icon" />
        {closedShown ? 'Main bridge closed — reopen' : 'Close the main bridge'}
        {p.mainBridgePending && !p.bridgeStateHidden ? ' (pending)' : ''}
      </button>
    </section>
  );
}

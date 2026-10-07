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
}

export function ControlPanel(p: Props) {
  const achieved = p.clock ? p.clock.achievedTicksPerS * DT : 0;
  const behind = !!p.clock?.behind;
  return (
    <section className="panel controls" aria-label="Simulation controls">
      <div className="row">
        <button type="button" className="primary" onClick={p.onToggleRunning}>
          {p.running ? 'Pause' : 'Play'}
        </button>
        <select aria-label="Speed" value={p.speed} onChange={(e) => p.onSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <span className="speed" data-testid="achieved-speed" title="Achieved simulation speed vs. the requested speed">
          {achieved.toFixed(1)}× of {p.speed}×
        </span>
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
      >
        <span aria-hidden="true" className="barrier-icon" />
        {p.mainBridgeClosed ? 'Main bridge closed — reopen' : 'Close the main bridge'}
        {p.mainBridgePending ? ' (pending)' : ''}
      </button>
    </section>
  );
}

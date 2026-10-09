import { simClock } from './TimelineBar';

interface Props {
  scenario: 0 | 1;
  branchTick: number;
  comparing: boolean;
  onView(scenario: 0 | 1): void;
  onDiscard(): void;
  onCompare(on: boolean): void;
}

const NOT_WHILE_COMPARING = 'Exit comparison to switch the viewed scenario';

/** The two scenarios (shown once B exists): which one is viewed, by text and pattern (never hue). */
export function ScenarioPanel({ scenario, branchTick, comparing, onView, onDiscard, onCompare }: Props) {
  return (
    <section className={`panel scenarios ${comparing ? 'compare-view' : `viewing-${scenario === 0 ? 'a' : 'b'}`}`} aria-label="Scenarios">
      <p className="scenario-label">{comparing ? 'Comparing A and B' : scenario === 0 ? 'Viewing A: original' : 'Viewing B: branch'}</p>
      <div className="row">
        <button type="button" aria-pressed={scenario === 0} onClick={() => onView(0)} disabled={comparing} title={comparing ? NOT_WHILE_COMPARING : undefined}>
          A: original
        </button>
        <button type="button" aria-pressed={scenario === 1} onClick={() => onView(1)} disabled={comparing} title={comparing ? NOT_WHILE_COMPARING : undefined}>
          B: branch from {simClock(branchTick)}
        </button>
      </div>
      <button type="button" className="compare" aria-pressed={comparing} onClick={() => onCompare(!comparing)}>
        Compare side by side
      </button>
      <button type="button" className="discard" onClick={onDiscard}>
        Discard branch
      </button>
    </section>
  );
}

interface ConfirmProps {
  onReplace(): void;
  onCancel(): void;
}

/** Inline confirmation (never a native dialog) before an intervention in A's past replaces B. */
export function ConfirmReplace({ onReplace, onCancel }: ConfirmProps) {
  return (
    <section className="panel confirm" aria-label="Confirm replacing the branch">
      <p>Replace the branch?</p>
      <p className="hint">This intervention in A's past starts a new branch B; the current B is lost.</p>
      <div className="row">
        {/* the primary choice takes focus when the confirmation opens */}
        <button type="button" className="primary" onClick={onReplace} autoFocus>
          Replace the branch
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

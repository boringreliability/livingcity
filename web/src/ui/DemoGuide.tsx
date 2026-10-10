/** The five demo steps, in order (ward polish-004). docs/demo.md names them in the same order. */
export const GUIDE_STEPS = ['Close the main bridge', 'Watch the queues', 'Pause and rewind', 'Try another decision', 'Compare side by side'] as const;

/** How to do each step (the current step's tooltip and screen-reader text). */
const HOW = [
  'Press the button, or B.',
  'Let it run a few sim minutes: queues build at the other bridges.',
  'Space pauses; drag the timeline or press ← to go back before the closure.',
  "Change a road there (B, or a road's Close link): a branch B starts from that moment.",
  'Press "Compare side by side" to see A and B at the same sim time.',
] as const;

interface DemoGuideProps {
  /** Per step (GUIDE_STEPS order): done by the user. */
  done: readonly boolean[];
  /** A hint for the current situation, or null. */
  hint: string | null;
  onHide: () => void;
}

/**
 * The first-run demo guide: a compact panel at the top of the right column. It only shows state: the
 * steps are ticked from what the user actually did in the sim; it sends nothing to the simulation.
 * A done step reads "✓" (text), never colour alone.
 */
export function DemoGuide({ done, hint, onHide }: DemoGuideProps) {
  const next = done.findIndex((d) => !d);
  const complete = next < 0;
  return (
    <section className="panel guide" aria-label="Demo guide">
      <div className="guide-head">
        <span className="guide-now" title={complete ? undefined : HOW[next]}>
          {complete ? 'Demo complete — hide with ×' : `${next + 1}. ${GUIDE_STEPS[next]}`}
          {!complete && <span className="sr-only">: {HOW[next]}</span>}
        </span>
        <button type="button" className="guide-hide" aria-label="Hide demo guide" title="Hide the demo guide (the ? (Guide) button shows it again)" onClick={onHide}>
          ×
        </button>
      </div>
      <ol className="guide-steps">
        {GUIDE_STEPS.map((title, i) => (
          <li key={title} className={done[i] ? 'done' : i === next ? 'now' : ''} title={title}>
            <span aria-hidden="true">{done[i] ? `✓${i + 1}` : i + 1}</span>
            <span className="sr-only">
              {title}
              {done[i] ? ' (done)' : ''}
            </span>
          </li>
        ))}
      </ol>
      {hint && <p className="guide-hint">{hint}</p>}
    </section>
  );
}

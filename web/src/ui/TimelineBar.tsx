import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

import { DT, type TimelineStatus } from '../sim/protocol';

/** One step of the arrow keys and the ±1 min buttons: 1 sim minute. */
export const STEP_TICKS = 120;
/** While dragging, at most one seek per this many ms (plus a final one on release). */
const DRAG_SEEK_MS = 100;

/** Sim time hh:mm:ss of a tick. */
export function simClock(tick: number): string {
  const s = Math.floor(tick * DT);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}

interface Props {
  timeline: TimelineStatus;
  /** The last requested position (a seek may still be on its way). */
  position: number;
  onSeek(tick: number): void;
}

/** The replay window of the viewed scenario: scrub it, jump in it, see its memory (contract T3). */
export function TimelineBar({ timeline, position, onSeek }: Props) {
  const { windowStartTick: lo, headTick: hi, branchTick, snapshotBytes, budgetBytes } = timeline;
  const span = Math.max(1, hi - lo);
  const frac = (t: number) => Math.min(1, Math.max(0, (t - lo) / span));
  const track = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ last: number; pending: number | null; timer: number | null } | null>(null);

  const seek = (tick: number) => {
    const t = Math.min(hi, Math.max(lo, Math.round(tick)));
    if (t !== position) onSeek(t);
  };
  const tickAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return lo + ((clientX - r.left) / Math.max(1, r.width)) * span;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = { ArrowLeft: position - STEP_TICKS, ArrowRight: position + STEP_TICKS, Home: lo, End: hi }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    seek(to);
  };

  // dragging: throttled seeks while moving, one final seek on release
  const flush = () => {
    const d = drag.current;
    if (!d || d.pending === null) return;
    seek(d.pending);
    d.pending = null;
    d.last = performance.now();
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { last: performance.now(), pending: null, timer: null };
    seek(tickAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.pending = tickAt(e.clientX);
    const wait = DRAG_SEEK_MS - (performance.now() - d.last);
    if (wait <= 0) flush();
    else if (d.timer === null)
      d.timer = window.setTimeout(() => {
        if (drag.current) drag.current.timer = null;
        flush();
      }, wait);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.timer !== null) window.clearTimeout(d.timer);
    d.pending = tickAt(e.clientX);
    flush();
    drag.current = null;
  };
  useEffect(() => () => {
    if (drag.current?.timer) window.clearTimeout(drag.current.timer);
  }, []);

  const mib = (snapshotBytes / 1048576).toFixed(1);
  const budget = Math.round(budgetBytes / 1048576);
  return (
    <section className="panel timeline" aria-label="Replay timeline">
      <div className="timeline-buttons">
        <button type="button" onClick={() => seek(lo)}>
          Jump to start
        </button>
        <button type="button" onClick={() => seek(position - STEP_TICKS)}>
          −1 min
        </button>
        <button type="button" onClick={() => seek(position + STEP_TICKS)}>
          +1 min
        </button>
        <button type="button" onClick={() => seek(hi)}>
          Live
        </button>
      </div>
      <span className="timeline-label mono" title="Oldest retained sim time">
        <span className="timeline-caption">sim time</span> {simClock(lo)}
      </span>
      <div
        ref={track}
        className="timeline-track"
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuenow={position}
        aria-valuetext={`sim time ${simClock(position)}`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="timeline-retained" />
        <div className="timeline-playhead" style={{ left: `${frac(position) * 100}%` }} />
        {branchTick >= lo && branchTick <= hi && (
          <div className="timeline-branch" style={{ left: `${frac(branchTick) * 100}%` }}>
            <span aria-hidden="true">◆</span> branch {simClock(branchTick)}
          </div>
        )}
      </div>
      <span className="timeline-label mono" title="Playhead">
        ▸ {simClock(position)}
      </span>
      <span className="timeline-label mono" title="Newest simulated sim time (head)">
        head {simClock(hi)}
      </span>
      <span className="timeline-memory" title="Snapshot memory of the viewed scenario; each scenario has its own budget">
        {mib} / {budget} MiB replay memory (per scenario)
      </span>
    </section>
  );
}

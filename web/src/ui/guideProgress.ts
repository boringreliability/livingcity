/**
 * Demo guide progress (ward polish-004): which of the five steps the user has actually done, read from
 * the frames only (sim ticks, never wall time). Steps stay done for the session.
 */
import type { FrameMessage } from '../sim/protocol';

/** Ticks the main bridge must stay closed while the sim runs for "Watch the queues" (3 sim min). */
const WATCH_TICKS = 360;

export interface GuideProgress {
  readonly done: readonly boolean[];
  /** The viewed scenario and tick where the main-bridge closure was first seen (closed since). */
  readonly closedSince: { scenario: number; tick: number } | null;
  /** A's head tick from A's last frame (for the speed hint while B is viewed). */
  readonly aHead: number | null;
  /** The viewed scenario and its position, from the last frame. */
  readonly view: { scenario: number; position: number } | null;
}

export const initialGuideProgress = (): GuideProgress => ({ done: [false, false, false, false, false], closedSince: null, aHead: null, view: null });

type GuideFrame = Pick<FrameMessage, 'scenario' | 'tick' | 'closed' | 'timeline' | 'clock'>;

/** The progress after one frame of the viewed scenario (the same object if nothing changed). */
export function advanceGuide(g: GuideProgress, f: GuideFrame, mainBridge: readonly number[]): GuideProgress {
  const closed = mainBridge.length > 0 && mainBridge.every((l) => f.closed.includes(l));
  const done = [...g.done];
  // 1: the main bridge is closed in the viewed scenario
  if (closed) done[0] = true;
  // 2: closed throughout for ≥ 3 sim minutes of ticks (a reopen, a scenario switch or a rewind restarts it)
  let since = g.closedSince;
  if (!closed) since = null;
  else if (!since || since.scenario !== f.scenario || f.tick < since.tick) since = { scenario: f.scenario, tick: f.tick };
  else if (f.tick - since.tick >= WATCH_TICKS) done[1] = true;
  // 3: A paused below its head, after the closure
  if (done[0] && f.scenario === 0 && !f.clock.running && f.timeline.positionTick < f.timeline.headTick) done[2] = true;
  // 4: a branch exists
  if (f.timeline.branchTick >= 0) done[3] = true;
  // 5: comparing with a branch
  if (f.timeline.compare === 1 && f.timeline.branchTick >= 0) done[4] = true;
  const aHead = f.scenario === 0 ? f.timeline.headTick : g.aHead;
  const view = { scenario: f.scenario, position: f.timeline.positionTick };
  const same =
    done.every((d, i) => d === g.done[i]) &&
    since?.tick === g.closedSince?.tick &&
    since?.scenario === g.closedSince?.scenario &&
    aHead === g.aHead &&
    view.scenario === g.view?.scenario &&
    view.position === g.view?.position;
  return same ? g : { done, closedSince: since, aHead, view };
}

/** The speed hint: B is viewed below A's head and the speed is under 60×. */
export function guideHint(g: GuideProgress, speed: number): string | null {
  if (!g.view || g.view.scenario !== 1 || g.aHead === null || g.view.position >= g.aHead || speed >= 60) return null;
  return 'Tip: 60× gets B to A’s time faster (+ or Speed)';
}

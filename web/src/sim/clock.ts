import type { ClockStatus } from './protocol';

/** Backlog cap: at most this many seconds of target ticks are owed. */
export const MAX_BACKLOG_S = 1;
/** Wall-clock budget per worker iteration (ms). */
export const ITERATION_BUDGET_MS = 8;

/**
 * Fixed-step pacing for the worker. Pure: wall time comes from `now()`.
 * Sim time is always executed ticks × DT; when the engine cannot keep up the
 * backlog is capped and `behind` is reported, ticks are never skipped.
 */
export class SimClock {
  constructor(_now: () => number) {
    throw new Error('not implemented');
  }

  setRunning(_running: boolean): void {
    throw new Error('not implemented');
  }

  /** Sim seconds per wall second (1 = real time). */
  setSpeed(_multiplier: number): void {
    throw new Error('not implemented');
  }

  /** Ticks to run now. */
  plan(): number {
    throw new Error('not implemented');
  }

  report(_ticks: number, _elapsedMs: number): void {
    throw new Error('not implemented');
  }

  status(): ClockStatus {
    throw new Error('not implemented');
  }
}

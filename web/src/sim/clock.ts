import { DT, type ClockStatus } from './protocol';

/** Backlog cap: at most this many seconds of target ticks are owed. */
export const MAX_BACKLOG_S = 1;
/** Wall-clock budget per worker iteration (ms). */
export const ITERATION_BUDGET_MS = 8;
/** Window for the achieved rate, the sticky cap event and the grace period (ms). */
const WINDOW_MS = 1000;
/** Below this share of the target, a sustained shortfall counts as behind. */
const BEHIND_RATIO = 0.9;
/** Batch limit before the first ms/tick measurement (e.g. a first plan after a stall). */
const UNMEASURED_BATCH_TICKS = 64;
/** Weight of the newest batch in the ms/tick estimate. */
const MS_PER_TICK_EMA = 0.2;

/**
 * Fixed-step pacing for the worker. Pure: wall time comes from `now()`.
 * Sim time is always executed ticks × DT; when the engine cannot keep up the
 * backlog is capped and `behind` is reported, ticks are never skipped.
 */
export class SimClock {
  private readonly now: () => number;
  private running = false;
  private multiplier = 1;
  /** Wall time up to which elapsed time has been credited. */
  private creditedUntil: number;
  private backlog = 0;
  private executedTicks = 0;
  /** Smoothed wall ms per tick; undefined until the first batch is measured. */
  private msPerTick: number | undefined;
  private lastCapEvent = Number.NEGATIVE_INFINITY;
  /** Start of the grace period for the shortfall criterion. */
  private graceStart = Number.NEGATIVE_INFINITY;
  /** After lowering the speed: clamps are not cap events until a plan ends below the cap. */
  private suppressCapEvents = false;
  private readonly reports: { t: number; ticks: number }[] = [];

  constructor(now: () => number) {
    this.now = now;
    this.creditedUntil = now();
  }

  setRunning(running: boolean): void {
    if (running === this.running) return; // no-op: no grace reset
    const t = this.now();
    this.running = running;
    this.creditedUntil = t;
    this.backlog = 0; // never catch up paused time
    if (running) this.graceStart = t;
  }

  /** Sim seconds per wall second (1 = real time); invalid values are ignored. */
  setSpeed(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    const t = this.now();
    if (this.running) {
      // Credit the time so far at the old speed; a clamp here is a real cap event.
      this.credit(t, !this.suppressCapEvents);
      this.multiplier = multiplier;
      if (this.backlog > this.cap()) {
        this.backlog = this.cap();
        this.suppressCapEvents = true;
      }
      this.graceStart = t;
    } else {
      this.multiplier = multiplier;
    }
  }

  /** Ticks to run now. */
  plan(): number {
    const t = this.now();
    if (!this.running) {
      this.creditedUntil = t;
      return 0;
    }
    this.credit(t, !this.suppressCapEvents);
    const n = Math.floor(this.backlog + 1e-9);
    // Without a measurement (or for free ticks) only the backlog limits the batch.
    const maxTicks =
      this.msPerTick !== undefined && this.msPerTick > 0
        ? Math.max(1, Math.floor(ITERATION_BUDGET_MS / this.msPerTick))
        : this.msPerTick === undefined
          ? UNMEASURED_BATCH_TICKS
          : Number.POSITIVE_INFINITY;
    return Math.min(n, maxTicks);
  }

  /**
   * Ticks run outside the pacing (the warm-up before `ready`): counted in sim time, but not in
   * the achieved rate, the backlog or the ms/tick estimate.
   */
  addUnpaced(ticks: number): void {
    this.executedTicks += Math.max(0, Math.floor(ticks));
  }

  /** A new world: sim time counts from its tick (`executedTicks` = tick, as frames require). */
  resetExecuted(tick: number): void {
    this.executedTicks = Math.max(0, Math.floor(tick));
  }

  /** Start pacing afresh from now (after the warm-up): no backlog for the time it took. */
  resync(): void {
    const t = this.now();
    this.creditedUntil = t;
    this.backlog = 0;
    if (this.running) this.graceStart = t;
  }

  report(ticks: number, elapsedMs: number): void {
    ticks = Math.max(0, Math.floor(ticks));
    this.executedTicks += ticks;
    this.backlog = Math.max(0, this.backlog - ticks);
    if (ticks > 0) {
      const sample = elapsedMs / ticks;
      this.msPerTick =
        this.msPerTick === undefined ? sample : this.msPerTick + MS_PER_TICK_EMA * (sample - this.msPerTick);
    }
    this.reports.push({ t: this.now(), ticks });
  }

  status(): ClockStatus {
    const t = this.now();
    while (this.reports.length > 0 && this.reports[0]!.t <= t - WINDOW_MS) this.reports.shift();
    const achieved = this.reports.reduce((sum, r) => sum + r.ticks, 0) / (WINDOW_MS / 1000);
    const target = this.targetTicksPerS();
    const capRecent = t - this.lastCapEvent < WINDOW_MS;
    const shortfall = t - this.graceStart >= WINDOW_MS && achieved < BEHIND_RATIO * target;
    return {
      running: this.running,
      multiplier: this.multiplier,
      targetTicksPerS: target,
      achievedTicksPerS: achieved,
      behind: this.running && (capRecent || shortfall),
      executedTicks: this.executedTicks,
      simTimeS: this.executedTicks * DT,
      backlogTicks: this.backlog,
    };
  }

  private targetTicksPerS(): number {
    return this.multiplier / DT;
  }

  private cap(): number {
    return MAX_BACKLOG_S * this.targetTicksPerS();
  }

  /** Add elapsed wall time to the backlog at the current speed, clamping at the cap. */
  private credit(t: number, clampIsEvent: boolean): void {
    // A clock that goes backwards credits nothing (never negative ticks).
    this.backlog += (Math.max(0, t - this.creditedUntil) / 1000) * this.targetTicksPerS();
    this.creditedUntil = Math.max(this.creditedUntil, t);
    if (this.backlog > this.cap()) {
      this.backlog = this.cap();
      if (clampIsEvent) this.lastCapEvent = t;
    } else {
      this.suppressCapEvents = false;
    }
  }
}

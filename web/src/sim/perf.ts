/**
 * Performance statistics (ward city-005, contract C5). Pure functions and small windows:
 * measurement never feeds back into the simulation.
 */

/** Nearest rank on a sorted copy: rank = max(1, ceil(p·n)), value = sorted[rank − 1]; 0 when empty. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1]!;
}

/**
 * Weighted nearest rank: the smallest value whose cumulative weight (ascending) reaches
 * ceil(p·W). Samples with a non-finite value or a weight ≤ 0 are ignored; 0 when empty.
 */
export function weightedPercentile(samples: readonly (readonly [number, number])[], p: number): number {
  const valid = samples.filter(([v, w]) => Number.isFinite(v) && Number.isFinite(w) && w > 0);
  if (valid.length === 0) return 0;
  const sorted = [...valid].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((acc, [, w]) => acc + w, 0);
  const rank = Math.max(Number.MIN_VALUE, Math.ceil(p * total));
  let cum = 0;
  for (const [v, w] of sorted) {
    cum += w;
    if (cum >= rank) return v;
  }
  return sorted.at(-1)![0];
}

/** Ticks covered by the tick-time window. */
export const TICK_WINDOW = 1000;

/** Per-tick wall time over the newest `TICK_WINDOW` ticks; one sample per batch, weighted by its ticks. */
export class TickWindow {
  private samples: [number, number][] = []; // [ms per tick, ticks], oldest first
  private total = 0;

  add(batchMs: number, ticks: number): void {
    if (!(ticks > 0) || !Number.isFinite(batchMs) || !Number.isFinite(ticks)) return;
    this.samples.push([batchMs / ticks, ticks]);
    this.total += ticks;
    // drop whole samples while the rest still covers the window
    while (this.samples.length > 1 && this.total - this.samples[0]![1] >= TICK_WINDOW) {
      this.total -= this.samples.shift()![1];
    }
  }

  /** Mean ms per tick over the window (Σ ms ÷ Σ ticks): meaningful even below the timer step. */
  mean(): number {
    const excess = Math.max(0, this.total - TICK_WINDOW);
    let ms = 0;
    let ticks = 0;
    this.samples.forEach(([v, w], i) => {
      const weight = i === 0 ? w - excess : w;
      ms += v * weight;
      ticks += weight;
    });
    return ticks > 0 ? ms / ticks : 0;
  }

  stats(): { median: number; p95: number; max: number; ticks: number } {
    if (this.samples.length === 0) return { median: 0, p95: 0, max: 0, ticks: 0 };
    // the oldest sample still inside the window is truncated to fill exactly TICK_WINDOW ticks
    const excess = Math.max(0, this.total - TICK_WINDOW);
    const window = this.samples.map(([v, w], i) => [v, i === 0 ? w - excess : w] as [number, number]);
    const ticks = window.reduce((acc, [, w]) => acc + w, 0);
    return {
      median: weightedPercentile(window, 0.5),
      p95: weightedPercentile(window, 0.95),
      max: Math.max(...window.filter(([, w]) => w > 0).map(([v]) => v)),
      ticks,
    };
  }
}

/** Render frames covered by the render windows. */
export const RENDER_WINDOW = 300;

/** The last `capacity` finite values. */
export class SampleWindow {
  private values: number[] = [];

  constructor(private readonly capacity: number) {}

  add(v: number): void {
    if (!Number.isFinite(v)) return;
    this.values.push(v);
    if (this.values.length > this.capacity) this.values.shift();
  }

  stats(): { median: number; p95: number; count: number } {
    return { median: percentile(this.values, 0.5), p95: percentile(this.values, 0.95), count: this.values.length };
  }
}

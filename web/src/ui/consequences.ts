/**
 * Consequences of an intervention (ward motion-003, contract M3): pure readings of real sim data for the
 * intervention summary, the timeline markers and the map pins. Single view: observations over time,
 * never a causal claim. A/B is compared in ComparisonPanel (matching cohorts, identical demand).
 *
 * RED STUB: the API only; every function throws until the ward's Gold phase implements it.
 */

/** The bridges of the city in landmark order (north, central, south), each with its two directions [W→E, E→W]. */
export interface BridgeNaming {
  bridges: { key: string; name: string; links: [number, number] }[];
}

/** One intervention as the summary and the timeline show it. */
export interface InterventionEntry {
  tick: number;
  kind: 'close' | 'open';
  /** "Main Bridge", "Main Bridge (W→E)" or "Link 12". */
  label: string;
  links: number[];
}

/**
 * The interventions at or before `positionTick`, from the command log (`[tick, kind 0 close / 1 open, link]`
 * triples): both directions of one bridge at the same tick and kind are one entry; in tick order.
 */
export function summarizeInterventions(log: ArrayLike<number>, positionTick: number, names: BridgeNaming): InterventionEntry[] {
  void log;
  void positionTick;
  void names;
  throw new Error('consequences: not implemented (motion-003 red)');
}

/** Crossings of one bridge (both directions), per 10 sim min: now, and in the 10 min before the latest closure. */
export interface CrossingRate {
  name: string;
  now: number | null;
  before: number | null;
  /** The measured spans (sim s) the rates are normalised from. */
  nowSpanS: number | null;
  beforeSpanS: number | null;
}

/** Rates from a frame's `bridgeFlow` (layout in protocol.ts `FrameMessage.bridgeFlow`). */
export function crossingRates(bridgeFlow: ArrayLike<number>, names: BridgeNaming): CrossingRate[] {
  void bridgeFlow;
  void names;
  throw new Error('consequences: not implemented (motion-003 red)');
}

/** The `n` links with the most queued vehicles (at least `min`), ties to the lower id. */
export function topQueues(linkQueued: ArrayLike<number>, n = 3, min = 3): { link: number; queued: number }[] {
  void linkQueued;
  void n;
  void min;
  throw new Error('consequences: not implemented (motion-003 red)');
}

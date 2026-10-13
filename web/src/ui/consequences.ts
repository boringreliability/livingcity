/**
 * Consequences of an intervention (ward motion-003, contract M3): pure readings of real sim data for the
 * intervention summary, the timeline markers and the map pins. Single view: observations over time,
 * never a causal claim. A/B is compared in ComparisonPanel (matching cohorts, identical demand).

 */

import { DT } from '../sim/protocol';

/** The landmark links in a `bridgeFlow` block (3 bridges × 2 directions), and its length. */
const LINKS = 6;
const BLOCK = 3 + 2 * LINKS;
/** Crossing rates are per 10 sim min. */
const RATE_TICKS = 600 / DT;

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
  const cmds: { tick: number; kind: 'close' | 'open'; link: number; at: number }[] = [];
  for (let i = 0; i + 2 < log.length; i += 3) {
    const tick = log[i]!;
    if (tick <= positionTick) cmds.push({ tick, kind: log[i + 1] === 1 ? 'open' : 'close', link: log[i + 2]!, at: i });
  }
  cmds.sort((a, b) => a.tick - b.tick || a.at - b.at); // in tick order, then log order
  const bridgeOf = (link: number) => names.bridges.findIndex((b) => b.links[0] === link || b.links[1] === link);
  const out: InterventionEntry[] = [];
  const used = new Set<number>();
  cmds.forEach((c, k) => {
    if (used.has(k)) return;
    used.add(k);
    const bi = bridgeOf(c.link);
    if (bi < 0) {
      out.push({ tick: c.tick, kind: c.kind, label: `Link ${c.link}`, links: [c.link] });
      return;
    }
    const b = names.bridges[bi]!;
    const other = b.links[0] === c.link ? b.links[1] : b.links[0];
    // the other direction at the same tick and kind: one entry for the whole bridge
    const pair = cmds.findIndex((d, j) => !used.has(j) && d.tick === c.tick && d.kind === c.kind && d.link === other);
    if (pair >= 0) {
      used.add(pair);
      out.push({ tick: c.tick, kind: c.kind, label: b.name, links: [...b.links] });
    } else {
      out.push({ tick: c.tick, kind: c.kind, label: `${b.name} (${c.link === b.links[0] ? 'W→E' : 'E→W'})`, links: [c.link] });
    }
  });
  return out;
}

/** "✕" for a closure, "○" for a reopening: the kind is carried by a glyph and a word, never by colour alone. */
export const interventionGlyph = (kind: InterventionEntry['kind']) => (kind === 'close' ? '✕' : '○');
export const interventionVerb = (kind: InterventionEntry['kind']) => (kind === 'close' ? 'Closed' : 'Reopened');

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
  if (bridgeFlow.length < 2 * BLOCK) return [];
  /** Block `k` (0 = now, 1 = before the closure): per bridge, the rate per 10 sim min and the span (sim s). */
  const read = (k: number, bridge: number): [number | null, number | null] => {
    const o = k * BLOCK;
    const refBase = bridgeFlow[o + 1]!;
    const fromBase = bridgeFlow[o + 2]!;
    const ticks = refBase - fromBase;
    if (!Number.isFinite(refBase) || !Number.isFinite(fromBase) || !(ticks > 0)) return [null, null];
    let n = 0;
    for (const d of [0, 1]) {
      const i = 2 * bridge + d;
      n += bridgeFlow[o + 3 + i]! - bridgeFlow[o + 3 + LINKS + i]!;
    }
    return [(n * RATE_TICKS) / ticks, ticks * DT];
  };
  return names.bridges.map((b, i) => {
    const [now, nowSpanS] = read(0, i);
    const [before, beforeSpanS] = read(1, i);
    return { name: b.name, now, before, nowSpanS, beforeSpanS };
  });
}

/** The `n` links with the most queued vehicles (at least `min`), ties to the lower id. */
export function topQueues(linkQueued: ArrayLike<number>, n = 3, min = 3): { link: number; queued: number }[] {
  const out: { link: number; queued: number }[] = [];
  for (let link = 0; link < linkQueued.length; link++) if (linkQueued[link]! >= min) out.push({ link, queued: linkQueued[link]! });
  return out.sort((a, b) => b.queued - a.queued || a.link - b.link).slice(0, n);
}

/**
 * Presentation (ward motion-002, contract M2): where and when cars are drawn.
 *
 * Authoritative state is the frame (link, s, v, lane, flags + trip ids). The picture shows a
 * presentation time `P` a little behind the newest frame, never ahead of it, and each car is
 * interpolated between the two retained frames around `P`, matched by trip id. A car on the same link
 * in both frames is drawn at most at the link's visual stop line; the junction curve is used only
 * while it moves onto the link it is on in the newer frame.
 *
 * RED STUB: the API only; every function throws until the ward's Gold phase implements it.
 */
import type { DecodedVehicles } from '../sim/frame';
import type { LinkGeom } from './geometry';
import type { DrawPose } from './motion';

/** The visual stop line sits this far before a link's end (at most half the link). */
export const STOP_M = 6;

/** Along-link coordinate (m) of `l`'s visual stop line. */
export function stopLine(l: LinkGeom): number {
  return l.length - Math.min(STOP_M, l.length / 2);
}

/** One authoritative frame as the presenter needs it. */
export interface PresentFrame {
  tick: number;
  scenario: 0 | 1;
  world: number;
  compare: boolean;
  vehicles: DecodedVehicles;
  tripIds: Uint32Array;
}

/** The clock state a frame arrived with. */
export interface PresentClockInput {
  running: boolean;
  multiplier: number;
  achievedTicksPerS: number;
  behind: boolean;
}

/** A car as drawn at the presentation time. */
export interface PresentedVehicle {
  tripId: number;
  /** Its record index in the newest frame (−1 if it is only in the older one: never returned). */
  record: number;
  link: number;
  /** Along-link coordinate as drawn (≤ the stop line unless moving onto `next`). */
  s: number;
  lane: number;
  /** The link it is moving onto right now, or NO_NEXT. */
  next: number;
  queued: boolean;
  pose: DrawPose;
}

/** The presentation time shared by A and B while comparing. */
export class PresentationClock {
  /** Presentation sim time (s) at wall time `nowMs`. */
  at(nowMs: number): number {
    void nowMs;
    throw new Error('presentation: not implemented (motion-002 red)');
  }
}

export class Presenter {
  constructor(links: readonly LinkGeom[], linkFrom: ArrayLike<number>, linkTo: ArrayLike<number>, clock?: PresentationClock) {
    void links;
    void linkFrom;
    void linkTo;
    void clock;
  }

  /** A frame arrived at wall time `nowMs`. */
  push(frame: PresentFrame, nowMs: number, clock: PresentClockInput): void {
    void frame;
    void nowMs;
    void clock;
    throw new Error('presentation: not implemented (motion-002 red)');
  }

  /** Advance to wall time `nowMs`; returns the presentation time `P` (sim seconds). */
  advance(nowMs: number): number {
    void nowMs;
    throw new Error('presentation: not implemented (motion-002 red)');
  }

  /** How far `P` trails the newest frame (sim seconds). */
  lagS(): number {
    throw new Error('presentation: not implemented (motion-002 red)');
  }

  /** Every car drawn at the current `P`. */
  vehicles(): PresentedVehicle[] {
    throw new Error('presentation: not implemented (motion-002 red)');
  }

  /** The car of `tripId` as drawn at the current `P`, or null. */
  vehicle(tripId: number): PresentedVehicle | null {
    void tripId;
    throw new Error('presentation: not implemented (motion-002 red)');
  }
}

/** The visual rule: a car at `s` on `link`, moving onto `next` (or NO_NEXT: not moving on). */
export function visualPose(links: readonly LinkGeom[], link: number, s: number, lane: number, next: number): DrawPose {
  void links;
  void link;
  void s;
  void lane;
  void next;
  throw new Error('presentation: not implemented (motion-002 red)');
}

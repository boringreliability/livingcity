/**
 * Messages between the UI thread and the simulation worker.
 *
 * Frame layout (`FrameMessage.vehicles`): `count` records of 4 little-endian
 * u32 words = 16 bytes each, ordered links → lanes → front first:
 *   word 0  link id
 *   word 1  s, metres along the link (f32 bits)
 *   word 2  v, m/s (f32 bits)
 *   word 3  flags: bit0 queued (v < 2 m/s), bit1 on a closed link,
 *           bit2 stranded (no route on), bits 8..15 lane index
 * There are no screen or world x/y coordinates: the renderer maps
 * (link, s, lane) onto the network geometry from `ReadyMessage.network`.
 * No JSON per frame: only typed arrays and plain numbers.
 */

/** Fixed simulation tick (s); mirrors `sim_core::params::DT`. */
export const DT = 0.5;
export const VEHICLE_RECORD_WORDS = 4;
export const VEHICLE_RECORD_BYTES = VEHICLE_RECORD_WORDS * 4;
export const FLAG_QUEUED = 1 << 0;
export const FLAG_ON_CLOSED_LINK = 1 << 1;
export const FLAG_STRANDED = 1 << 2;
export const FLAG_LANE_SHIFT = 8;

export type ToWorker =
  | { type: 'init'; demandSeed: number; behaviorSeed: number }
  | { type: 'setRunning'; running: boolean }
  | { type: 'setSpeed'; multiplier: number }
  | { type: 'command'; kind: 'close' | 'open'; link: number }
  | { type: 'returnBuffer'; buffer: ArrayBuffer };

export interface NetworkArrays {
  /** x0, y0, x1, y1, … in world metres. */
  nodeXy: Float32Array;
  nodeIsZone: Uint8Array;
  linkFrom: Uint32Array;
  linkTo: Uint32Array;
  linkLanes: Uint8Array;
  linkLength: Float32Array;
  linkSpeed: Float32Array;
}

/** Each bridge as [west→east, east→west] link ids. */
export interface Landmarks {
  north_bridge: [number, number];
  central_bridge: [number, number];
  south_bridge: [number, number];
}

export interface ZoneInfo {
  name: string;
  node: number;
  kind: 'residential' | 'workplace' | 'hospital';
}

export interface ClockStatus {
  running: boolean;
  multiplier: number;
  targetTicksPerS: number;
  /** Ticks actually executed per wall second over the last second. */
  achievedTicksPerS: number;
  /** The engine cannot keep up with the requested speed. */
  behind: boolean;
  executedTicks: number;
  /** Always `executedTicks × DT`: sim time never jumps. */
  simTimeS: number;
  backlogTicks: number;
}

export interface PerfStats {
  /** Wall ms per sim tick over the recent batches. */
  tickMsMedian: number;
  tickMsP95: number;
  lastBatchTicks: number;
  framesPerS: number;
}

export interface ReadyMessage {
  type: 'ready';
  network: NetworkArrays;
  landmarks: Landmarks;
  zones: ZoneInfo[];
  metricNames: string[];
}

export interface FrameMessage {
  type: 'frame';
  tick: number;
  simTimeS: number;
  count: number;
  vehicles: ArrayBuffer;
  linkCounts: Uint16Array;
  linkQueued: Uint16Array;
  closed: Uint32Array;
  metrics: Float64Array;
  clock: ClockStatus;
  perf: PerfStats;
}

export type FromWorker = ReadyMessage | FrameMessage | { type: 'error'; message: string };

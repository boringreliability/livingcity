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

/** Built-in cities the worker can build. */
export type CityName = 'river_city' | 'three_bridges';
export const DEFAULT_CITY: CityName = 'river_city';

/** `?city=` → a known city; anything else → the default. */
export function parseCityName(value: string | null | undefined): CityName {
  return value === 'three_bridges' || value === 'river_city' ? value : DEFAULT_CITY;
}

export type ToWorker =
  | { type: 'init'; demandSeed: number; behaviorSeed: number; city?: CityName }
  | { type: 'setRunning'; running: boolean }
  | { type: 'setSpeed'; multiplier: number }
  | { type: 'command'; kind: 'close' | 'open'; link: number }
  | { type: 'returnBuffer'; buffer: ArrayBuffer }
  /** Track the vehicle at `record` of the frame encoded at `frameTick` (resolved in the worker). */
  | { type: 'inspectVehicle'; frameTick: number; record: number }
  | { type: 'inspectVehicle'; clear: true }
  | { type: 'inspectLink'; link: number | null };

export interface NetworkArrays {
  /** x0, y0, x1, y1, … in world metres. */
  nodeXy: Float32Array;
  nodeIsZone: Uint8Array;
  linkFrom: Uint32Array;
  linkTo: Uint32Array;
  linkLanes: Uint8Array;
  linkLength: Float32Array;
  linkSpeed: Float32Array;
  /** Saturation flow per lane (veh/s); optional for hand-built networks. */
  linkSatFlow?: Float32Array;
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
  /** The built city's name as the sim reports it (`'unknown'` for sims without one). */
  city: string;
  /** River corridor `[west_x, east_x]` (m), from the sim; `[0, 0]` when unknown. */
  river: [number, number];
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
  /**
   * The inspected vehicle, its one-time `gone` notice, or null. At runtime the key is omitted
   * until the UI first sends `inspectVehicle`, so a session that never inspects keeps purely
   * numeric frames (core-004 payload rule). Consumers treat a missing key as null.
   */
  tracked: TrackedVehicle | TrackedGone | null;
  /** The inspected road, or null; omitted (read as null) until the UI first sends `inspectLink`. */
  linkDetail: LinkDetail | null;
}

export type TrackedState = 'waiting' | 'driving' | 'queued' | 'stranded' | 'no_route';

export interface TrackedVehicle {
  tripId: number;
  origin: number;
  dest: number;
  state: TrackedState;
  /** −1 while not on a link. */
  link: number;
  lane: number;
  s: number;
  v: number;
  ageS: number;
  routeSwitches: number;
  blockedTicks: number;
  /** Remaining route, current link first (empty while waiting or without a route). */
  route: Uint32Array;
}

export type TrackedOutcome = 'completed' | 'removed_unreachable' | 'removed_gridlock' | 'unknown';

export interface TrackedGone {
  gone: true;
  tripId: number;
  outcome: TrackedOutcome;
  travelTimeS: number | null;
}

export interface LinkDetail {
  link: number;
  vehicles: number;
  queued: number;
  costS: number;
  freeFlowS: number;
  exits: number;
  capacityVph: number;
}

/**
 * `Sim.vehicle_detail` layout: [found, trip_id, origin, dest, state, link, lane, s, v, age_s,
 * route_switches, blocked_ticks, route_len, …route_len link ids (remaining, current first)].
 * State codes: 0 waiting, 1 driving, 2 queued, 3 stranded, 4 no route.
 */
export const VEHICLE_DETAIL_HEADER = 13;
const STATES: TrackedState[] = ['waiting', 'driving', 'queued', 'stranded', 'no_route'];

export function decodeVehicleDetail(a: ArrayLike<number>): TrackedVehicle | null {
  if (a.length < VEHICLE_DETAIL_HEADER || a[0] !== 1) return null;
  const n = a[12]!;
  const route = new Uint32Array(n);
  for (let k = 0; k < n; k++) route[k] = a[VEHICLE_DETAIL_HEADER + k]!;
  return {
    tripId: a[1]!,
    origin: a[2]!,
    dest: a[3]!,
    state: STATES[a[4]!] ?? 'driving',
    link: a[5]!,
    lane: a[6]!,
    s: a[7]!,
    v: a[8]!,
    ageS: a[9]!,
    routeSwitches: a[10]!,
    blockedTicks: a[11]!,
    route,
  };
}

/** `Sim.trip_outcome` → outcome (code 0 = still live → null). */
export function decodeTripOutcome(tripId: number, a: ArrayLike<number>): TrackedGone | null {
  const outcomes: (TrackedOutcome | null)[] = [null, 'completed', 'removed_unreachable', 'removed_gridlock', 'unknown'];
  const outcome = outcomes[a[0]!] ?? 'unknown';
  if (outcome === null) return null;
  const t = a[1]!;
  return { gone: true, tripId, outcome, travelTimeS: Number.isFinite(t) ? t : null };
}

/** `Sim.link_detail` layout: [vehicles, queued, cost_s, free_flow_s, exits, capacity_vph]. */
export function decodeLinkDetail(link: number, a: ArrayLike<number>): LinkDetail {
  return {
    link,
    vehicles: a[0] ?? 0,
    queued: a[1] ?? 0,
    costS: a[2] ?? 0,
    freeFlowS: a[3] ?? 0,
    exits: a[4] ?? 0,
    capacityVph: a[5] ?? 0,
  };
}

export type FromWorker = ReadyMessage | FrameMessage | { type: 'error'; message: string };

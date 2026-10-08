import type { Landmarks, PerfStats, TimelineStatus } from '../sim/protocol';
import type { RenderStats } from './DiagnosticsPanel';

/** Read-only state exposed for end-to-end tests (`window.__livingcity`). */
export interface LivingCitySnapshot {
  /** The city the worker built (`ready.city`), null before ready. */
  city: string | null;
  tick: number;
  simTimeS: number;
  running: boolean;
  metrics: Record<string, number>;
  closed: number[];
  linkCounts: number[];
  landmarks: Landmarks | null;
  selectedLink: number | null;
  /** requestAnimationFrame draws so far (rendering is independent of ticks). */
  renderFrames: number;
  /** The tracked vehicle's trip (null if none or gone), its remaining route and state. */
  trackedTrip: number | null;
  trackedRoute: number[];
  trackedState: string | null;
  following: boolean;
  /** Vehicle records in the latest frame. */
  frameRecords: number;
  camera: { cx: number; cy: number; zoom: number };
  /** The `?demand=` scale in force (1 = the normal city). */
  demandScale: number;
  /** The viewed scenario (ward timeline-003). */
  scenario: 'A' | 'B';
  /** The viewed scenario's replay window, as the latest frame reports it. */
  timeline: TimelineStatus;
  /** The tick B was branched from, or null without a branch. */
  branchTick: number | null;
  /** A and B side by side (true once the layout and fit are applied: ward timeline-004). */
  compare: boolean;
  /** The committed frame pair's ticks and closed links while comparing. */
  sides: { a: { tick: number; closed: number[] }; b: { tick: number; closed: number[] } } | null;
  /** The camera each renderer last drew with (both sides while comparing). */
  drawnCameras: { a: { cx: number; cy: number; zoom: number }; b: { cx: number; cy: number; zoom: number } } | null;
}

export interface LivingCityDiagnostics {
  perf: PerfStats | null;
  render: RenderStats;
  frameBytes: number;
  onNetwork: number;
  active: number;
  achievedTicksPerS: number;
  targetTicksPerS: number;
  /** The app's own WebGL RENDERER string. */
  renderer: string;
}

/** Everything between `startPerfRecording` and `stopPerfRecording` (per frame / per rAF). */
export interface PerfRecording {
  /** [measured ms, ticks] per frame (`frameTickMs`, `frameTicks`). */
  ticks: [number, number][];
  renderIntervals: number[];
  drawMs: number[];
  onNetwork: number[];
  active: number[];
  waitingAtOrigin: number[];
  frames: number;
  wallMs: number;
  timerResolutionMs: number;
}

export interface LivingCityHook {
  snapshot(): LivingCitySnapshot;
  /** Screen (CSS px, page coordinates) of a link's drawn midpoint, or null if off-screen. */
  linkScreenCenter(link: number): [number, number] | null;
  /** Page coordinates of the point at fraction t along a link's drawn centreline (also off-screen); null for an unknown link. */
  linkScreenPoint(link: number, t: number): [number, number] | null;
  /** Page coordinates of record `record` of the latest frame (unextrapolated), or null. */
  vehicleScreenCenter(record: number): [number, number] | null;
  /** Page coordinates where the tracked vehicle is drawn now (as Follow uses), or null. */
  trackedScreenCenter(): [number, number] | null;
  /** What a click at page point (x, y) would select, without selecting. */
  pickAt(x: number, y: number): { vehicle: number | null; link: number | null; side: 'A' | 'B' };
  /** Test-only rendering switches. */
  setDebug(opts: { hideVehicles?: boolean }): void;
  /** The simulation's storage capacity of a link (lanes × max(1, floor(length / 7.5))). */
  linkCapacity(link: number): number;
  /** Links ending at `link`'s start node, without its reverse direction and zone connectors, ascending. */
  approachLinks(link: number): number[];
  /** Measured performance (diagnostics panel values). */
  diagnostics(): LivingCityDiagnostics;
  /** Record `record` of the latest frame, or null. */
  frameVehicle(record: number): { link: number; s: number; queued: boolean } | null;
  /** The latest comparison (plain arrays), or null outside the comparison. */
  comparison(): { tick: number; fromTick: number; a: number[]; b: number[] } | null;
  /** Like `linkScreenPoint`, on B's canvas (null when not comparing). */
  linkScreenPointB(link: number, t: number): [number, number] | null;
  startPerfRecording(): void;
  stopPerfRecording(): PerfRecording;
}

declare global {
  interface Window {
    __livingcity?: LivingCityHook;
  }
}

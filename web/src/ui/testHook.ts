import type { Landmarks } from '../sim/protocol';

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
  pickAt(x: number, y: number): { vehicle: number | null; link: number | null };
}

declare global {
  interface Window {
    __livingcity?: LivingCityHook;
  }
}

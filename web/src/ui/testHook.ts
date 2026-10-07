import type { Landmarks } from '../sim/protocol';

/** Read-only state exposed for end-to-end tests (`window.__livingcity`). */
export interface LivingCitySnapshot {
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
}

export interface LivingCityHook {
  snapshot(): LivingCitySnapshot;
  /** Screen (CSS px, page coordinates) of a link's drawn midpoint, or null if off-screen. */
  linkScreenCenter(link: number): [number, number] | null;
}

declare global {
  interface Window {
    __livingcity?: LivingCityHook;
  }
}

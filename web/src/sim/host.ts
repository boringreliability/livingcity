import type { FromWorker, ToWorker } from './protocol';

/** The subset of the wasm `Sim` the host uses (typed for testability). */
export interface SimLike {
  step(n: number): void;
  tick(): number;
  close_link(id: number): boolean;
  open_link(id: number): boolean;
  encode_frame(): number;
  frame_ptr(): number;
  frame_words(): number;
  link_counts(): Uint16Array;
  link_queued(): Uint16Array;
  metrics(): Float64Array;
  metric_names(): string[];
  closed_links(): Uint32Array;
  node_xy(): Float32Array;
  node_is_zone(): Uint8Array;
  link_from(): Uint32Array;
  link_to(): Uint32Array;
  link_lanes(): Uint8Array;
  link_length(): Float32Array;
  link_speed(): Float32Array;
  landmarks_json(): string;
  zones_json(): string;
}

export interface HostDeps {
  createSim(demandSeed: number, behaviorSeed: number): SimLike;
  /** The wasm linear memory (read the frame through it). */
  memory(): WebAssembly.Memory;
  post(msg: FromWorker, transfer: Transferable[]): void;
  now(): number;
}

export interface SimHost {
  handle(msg: ToWorker): void;
  /** One worker loop iteration: run planned ticks, maybe post a frame. */
  iterate(): void;
}

/** Minimum wall time between frames (ms). */
export const FRAME_INTERVAL_MS = 16;

export function createSimHost(_deps: HostDeps): SimHost {
  throw new Error('not implemented');
}

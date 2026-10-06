import { SimClock } from './clock';
import {
  DT,
  VEHICLE_RECORD_WORDS,
  type FrameMessage,
  type FromWorker,
  type Landmarks,
  type PerfStats,
  type ToWorker,
  type ZoneInfo,
} from './protocol';

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
/** Per-frame samples kept for the ms/tick percentiles. */
const PERF_SAMPLES = 64;

export function createSimHost(deps: HostDeps): SimHost {
  const clock = new SimClock(deps.now);
  let sim: SimLike | undefined;
  let lastPost = Number.NEGATIVE_INFINITY;
  /** Returned buffers; one is reused only if it fits the next frame exactly. */
  let pool: ArrayBuffer[] = [];
  // Browsers coarsen performance.now() (often to 0.1 ms) and a batch can be
  // faster than that, so ms/tick is sampled per frame from summed batch time.
  const tickMs: number[] = [];
  let lastBatchTicks = 0;
  let sinceFrameMs = 0;
  let sinceFrameTicks = 0;
  const frameTimes: number[] = [];

  const error = (message: string) => deps.post({ type: 'error', message }, []);

  const init = (demandSeed: number, behaviorSeed: number) => {
    try {
      sim = deps.createSim(demandSeed, behaviorSeed);
    } catch (e) {
      sim = undefined;
      error(`init failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    lastPost = Number.NEGATIVE_INFINITY;
    deps.post(
      {
        type: 'ready',
        network: {
          nodeXy: sim.node_xy(),
          nodeIsZone: sim.node_is_zone(),
          linkFrom: sim.link_from(),
          linkTo: sim.link_to(),
          linkLanes: sim.link_lanes(),
          linkLength: sim.link_length(),
          linkSpeed: sim.link_speed(),
        },
        landmarks: JSON.parse(sim.landmarks_json()) as Landmarks,
        zones: JSON.parse(sim.zones_json()) as ZoneInfo[],
        metricNames: sim.metric_names(),
      },
      [],
    );
  };

  const command = (kind: 'close' | 'open', link: number) => {
    if (!sim) {
      error(`command before init: ${kind} ${link}`);
      return;
    }
    const ok = kind === 'close' ? sim.close_link(link) : sim.open_link(link);
    if (!ok) error(`unknown link ${link}`);
  };

  const perf = (t: number): PerfStats => {
    while (frameTimes.length > 0 && frameTimes[0]! <= t - 1000) frameTimes.shift();
    const sorted = [...tickMs].sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!);
    return { tickMsMedian: pct(0.5), tickMsP95: pct(0.95), lastBatchTicks, framesPerS: frameTimes.length };
  };

  const postFrame = (s: SimLike, t: number) => {
    const count = s.encode_frame();
    const words = count * VEHICLE_RECORD_WORDS;
    const bytes = words * 4;
    const reuse = pool.find((b) => b.byteLength === bytes);
    pool = [];
    const vehicles = reuse ?? new ArrayBuffer(bytes);
    new Uint32Array(vehicles).set(new Uint32Array(deps.memory().buffer, s.frame_ptr(), words));
    frameTimes.push(t);
    if (sinceFrameTicks > 0) {
      tickMs.push(sinceFrameMs / sinceFrameTicks);
      if (tickMs.length > PERF_SAMPLES) tickMs.shift();
    }
    sinceFrameMs = 0;
    sinceFrameTicks = 0;
    const tick = s.tick();
    const msg: FrameMessage = {
      type: 'frame',
      tick,
      simTimeS: tick * DT,
      count,
      vehicles,
      linkCounts: s.link_counts(),
      linkQueued: s.link_queued(),
      closed: s.closed_links(),
      metrics: s.metrics(),
      clock: clock.status(),
      perf: perf(t),
    };
    deps.post(msg, [vehicles]);
  };

  return {
    handle(msg: ToWorker): void {
      try {
        switch (msg.type) {
          case 'init':
            init(msg.demandSeed, msg.behaviorSeed);
            break;
          case 'setRunning':
            clock.setRunning(msg.running);
            break;
          case 'setSpeed':
            clock.setSpeed(msg.multiplier);
            break;
          case 'command':
            command(msg.kind, msg.link);
            break;
          case 'returnBuffer':
            pool.push(msg.buffer);
            break;
        }
      } catch (e) {
        error(e instanceof Error ? e.message : String(e));
      }
    },

    iterate(): void {
      if (!sim) return;
      try {
        const n = clock.plan();
        let ms = 0;
        if (n > 0) {
          const t0 = deps.now();
          sim.step(n);
          ms = deps.now() - t0;
          sinceFrameMs += ms;
          sinceFrameTicks += n;
          lastBatchTicks = n;
        }
        clock.report(n, ms);
        const t = deps.now();
        if (t - lastPost >= FRAME_INTERVAL_MS) {
          postFrame(sim, t);
          lastPost = t;
        }
      } catch (e) {
        error(e instanceof Error ? e.message : String(e));
      }
    },
  };
}

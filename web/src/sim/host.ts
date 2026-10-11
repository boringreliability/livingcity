import { SimClock, WINDOW_MS } from './clock';
import { TickWindow } from './perf';
import {
  DT,
  VEHICLE_RECORD_WORDS,
  type FrameMessage,
  type FromWorker,
  type Landmarks,
  type PerfStats,
  DEFAULT_CITY,
  decodeLinkDetail,
  decodeTripOutcome,
  decodeVehicleDetail,
  type CityName,
  type LinkDetail,
  COMPARISON_INTERVAL_MS,
  NO_NEXT_LINK,
  REPLAY_BUDGET_BYTES,
  type TimelineStatus,
  type TrackedGone,
  type TrackedVehicle,
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
  /** Per record of the last encoded frame: next link or 0xFFFF (ward polish-003; optional for fakes). */
  next_links?(): Uint16Array;
  /** Test hook: panics inside wasm (ward polish-005; optional for fakes). */
  debug_trap?(): void;
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
  /** Optional (since epic city): older sims and test fakes may lack them. */
  city_name?(): string;
  river?(): Float64Array;
  /** Inspection (since city-003); optional so older fakes keep working. */
  trip_at_record?(frameTick: number, record: number): number;
  vehicle_detail?(tripId: number): Float64Array;
  trip_outcome?(tripId: number): Float64Array;
  link_detail?(link: number): Float64Array;
  link_sat_flow?(): Float32Array;
  /** Timeline (since timeline-003); optional so older fakes keep working. */
  seek?(tick: number): boolean;
  timeline_info?(): ArrayLike<number>;
  branch?(at: number): SimLike;
  forget_frames?(): void;
  window_metrics?(from: number): Float64Array;
  /** wasm-bindgen's explicit release (a dropped scenario must not wait for GC: 48 MiB each). */
  free?(): void;
}

interface HostDeps {
  /** `demandScale` is 1 unless the init asked for stress demand. */
  createSim(demandSeed: number, behaviorSeed: number, city: CityName, demandScale: number): SimLike;
  /** The wasm linear memory (read the frame through it). */
  memory(): WebAssembly.Memory;
  post(msg: FromWorker, transfer: Transferable[]): void;
  now(): number;
  /** The measurement clock for perf statistics only (default `now`); the pacing never reads it. */
  perfNow?(): number;
}

export interface SimHost {
  handle(msg: ToWorker): void;
  /** One worker loop iteration: run planned ticks, maybe post a frame. */
  iterate(): void;
}

/** Minimum wall time between frames (ms). */
export const FRAME_INTERVAL_MS = 16;
/** Returned buffers kept per side (motion-001). */
const POOL_MAX = 4;
/** No warm-up batch may block message handling longer than this (ms of `now`). */
const WARMUP_BATCH_MAX_MS = 100;
/**
 * A warm-up batch steps chunks of at most WARMUP_CHUNK_TICKS and stops once WARMUP_TARGET_MS
 * have passed, so it lasts at most 40 ms + one chunk, whatever the tick cost does meanwhile
 * (ticks get ~100× dearer as the empty city fills: Gold r1 M1). That stays within
 * WARMUP_BATCH_MAX_MS for any cost up to (100 − 40) / 32 ≈ 1.9 ms per tick.
 */
const WARMUP_TARGET_MS = 0.4 * WARMUP_BATCH_MAX_MS;
const WARMUP_CHUNK_TICKS = 32;

/** Smallest positive step of a clock: ≥ 3 positive steps, within 50 ms of its time or 100,000 reads; 0 if none. */
function timerResolution(read: () => number): number {
  let prev = read();
  const start = prev;
  let best = Number.POSITIVE_INFINITY;
  let seen = 0;
  for (let i = 0; i < 100_000 && seen < 3 && prev - start <= 50; i++) {
    const t = read();
    if (t > prev) {
      best = Math.min(best, t - prev);
      seen++;
    }
    prev = t;
  }
  return seen > 0 ? best : 0;
}

export function createSimHost(deps: HostDeps): SimHost {
  const clock = new SimClock(deps.now);
  const perfNow = deps.perfNow ?? deps.now;
  const timerResolutionMs = timerResolution(perfNow);
  let sim: SimLike | undefined;
  let halted = false;
  let linkCount = 0;
  let lastPost = Number.NEGATIVE_INFINITY;
  /** The inspected trip and road (contract C4). */
  let trackedTrip: number | null = null;
  let inspectedLink: number | null = null;
  /** The frame fields appear once inspection is used (absent before: numeric-only frames). */
  let vehicleInspectionUsed = false;
  /** Echoed in frames so the UI can tell which of its requests a frame already reflects. */
  let inspectSeq = 0;
  let linkInspectionUsed = false;
  /** Scenario A (index 0) and, after a branch, B (index 1); `sim` is the viewed one. */
  let scenarios: SimLike[] = [];
  let viewed: 0 | 1 = 0;
  let branchTick = -1;
  /** A and B advance in lockstep and are posted as (A, B) frame pairs (ward timeline-004). */
  let comparing = false;
  let lastComparison = Number.NEGATIVE_INFINITY;
  /** Returned buffers per side (motion-001): LIFO, at most POOL_MAX, reused only at the exact size. */
  const pools: [ArrayBuffer[], ArrayBuffer[]] = [[], []];
  /** Each side's world generation; buffers returned for an older one are dropped. */
  const worlds: [number, number] = [0, 0];
  /** A handled message (other than `returnBuffer`) is answered by a frame from the next iteration. */
  let dirty = false;
  /** While paused nothing is posted, except one settling frame once the achieved-rate window is empty. */
  let wasRunning = false;
  let settleAt: number | null = null;
  // Per-tick ms over the newest 1,000 ticks, one sample per batch (perf clock). Browsers coarsen
  // performance.now() (often to 0.1 ms): `timerResolutionMs` says how far the numbers can be trusted.
  let tickWindow = new TickWindow();
  let lastBatchTicks = 0;
  let sinceFrameMs = 0;
  let sinceFrameTicks = 0;
  let encodeMs = 0;
  const frameTimes: number[] = [];
  /** The warm-up still to run before `ready` (null when none), and commands received meanwhile. */
  let warmup: { remaining: number; ran: number } | null = null;
  let deferred: { kind: 'close' | 'open'; link: number }[] = [];

  const error = (message: string) => deps.post({ type: 'error', message }, []);
  const fatal = (message: string) => deps.post({ type: 'error', message, fatal: true }, []);
  /** Set by the `debugTrap` test hook: the next iteration traps inside wasm. */
  let trapNext = false;

  const init = (demandSeed: number, behaviorSeed: number, city: CityName, warmupS: number, demandScale: number) => {
    // a new world: nothing is inspected any more, and no older warm-up or command is pending
    trackedTrip = null;
    inspectedLink = null;
    warmup = null;
    deferred = [];
    tickWindow = new TickWindow();
    sinceFrameMs = 0;
    sinceFrameTicks = 0;
    for (const old of scenarios) old.free?.();
    scenarios = [];
    pools[0] = []; // buffers of the old world are not reused for the new one (k5)
    pools[1] = [];
    worlds[0]++;
    worlds[1]++;
    try {
      sim = deps.createSim(demandSeed, behaviorSeed, city, demandScale);
    } catch (e) {
      sim = undefined;
      fatal(`init failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    lastPost = Number.NEGATIVE_INFINITY;
    linkCount = sim.link_from().length;
    scenarios = [sim];
    viewed = 0;
    branchTick = -1;
    comparing = false;
    clock.reset(); // a new world: the whole clock afresh (f1)
    clock.resetExecuted(sim.tick());
    const ticks = Number.isFinite(warmupS) && warmupS > 0 ? Math.round(warmupS / DT) : 0;
    if (ticks > 0) warmup = { remaining: ticks, ran: 0 };
    else postReady(sim);
  };

  /** One bounded warm-up batch; at the end: clock in sync, deferred commands handed over, `ready`. */
  const warmStep = (s: SimLike, w: NonNullable<typeof warmup>) => {
    const t0 = deps.now();
    do {
      const n = Math.min(w.remaining, WARMUP_CHUNK_TICKS);
      s.step(n);
      w.remaining -= n;
      w.ran += n;
    } while (w.remaining > 0 && deps.now() - t0 < WARMUP_TARGET_MS);
    if (w.remaining > 0) return;
    warmup = null;
    clock.addUnpaced(w.ran);
    clock.resync();
    for (const c of deferred.splice(0)) command(c.kind, c.link);
    postReady(s);
  };

  const postReady = (s: SimLike) => {
    const river = typeof s.river === 'function' ? Array.from(s.river()) : [];
    deps.post(
      {
        type: 'ready',
        tick: s.tick(),
        city: typeof s.city_name === 'function' ? s.city_name() : 'unknown',
        river: river.length === 2 ? [river[0]!, river[1]!] : [0, 0],
        network: {
          nodeXy: s.node_xy(),
          nodeIsZone: s.node_is_zone(),
          linkFrom: s.link_from(),
          linkTo: s.link_to(),
          linkLanes: s.link_lanes(),
          linkLength: s.link_length(),
          linkSpeed: s.link_speed(),
          ...(typeof s.link_sat_flow === 'function' ? { linkSatFlow: s.link_sat_flow() } : {}),
        },
        landmarks: JSON.parse(s.landmarks_json()) as Landmarks,
        zones: JSON.parse(s.zones_json()) as ZoneInfo[],
        metricNames: s.metric_names(),
      },
      [],
    );
  };

  const command = (kind: 'close' | 'open', link: number) => {
    if (!sim) {
      error(halted ? `simulation halted; ignored ${kind} ${link}` : `command before init: ${kind} ${link}`);
      return;
    }
    // Validate here: wasm-bindgen coerces NaN/1.7/2^32+2 to valid u32 ids.
    if (kind !== 'close' && kind !== 'open') {
      error(`unknown command kind ${String(kind)}`);
      return;
    }
    if (!Number.isInteger(link) || link < 0 || link >= linkCount) {
      error(`unknown link ${link}`);
      return;
    }
    // during the warm-up commands wait: they apply after its last tick
    if (warmup) {
      deferred.push({ kind, link });
      return;
    }
    if (comparing) {
      error('interventions are off while comparing: exit the comparison to change roads');
      return;
    }
    if (viewed === 0 && typeof sim.timeline_info === 'function') {
      const st = timelineStatus(sim);
      if (st.positionTick < st.headTick) {
        error(`scenario A cannot be edited in its past (tick ${st.positionTick} < head ${st.headTick}): branch instead`);
        return;
      }
    }
    const ok = kind === 'close' ? sim.close_link(link) : sim.open_link(link);
    if (!ok) error(`unknown link ${link}`);
  };

  /** The viewed scenario's window (a sim without a timeline reports a window of its tick). */
  const timelineStatus = (s: SimLike): TimelineStatus => {
    if (typeof s.timeline_info !== 'function') {
      const t = s.tick();
      return { windowStartTick: t, headTick: t, positionTick: t, branchTick, snapshotBytes: 0, budgetBytes: REPLAY_BUDGET_BYTES, compare: 0 };
    }
    const i = s.timeline_info();
    const st = { windowStartTick: i[0]!, headTick: i[1]!, positionTick: i[2]!, branchTick, snapshotBytes: i[3]!, budgetBytes: i[4]!, compare: 0 };
    if (!comparing) return st;
    const [lo, hi] = sharedWindow();
    return { ...st, windowStartTick: lo, headTick: hi, compare: 1 };
  };

  /** While comparing: [max(window starts, branch tick), min(heads)]. */
  const sharedWindow = (): [number, number] => {
    const [a, b] = [scenarios[0]!.timeline_info!(), scenarios[1]!.timeline_info!()];
    return [Math.max(a[0]!, b[0]!, branchTick), Math.min(a[1]!, b[1]!)];
  };

  /** Post A's and B's frames at the same tick (one pair). */
  const postPair = (t: number) => {
    postFrame(scenarios[0]!, t, 0);
    postFrame(scenarios[1]!, t, 1);
    lastPost = t;
  };

  /** Both sides' window metrics from the branch tick, at the tick of the pair just posted. */
  const postComparison = (t: number) => {
    const [a, b] = [scenarios[0]!, scenarios[1]!];
    if (typeof a.window_metrics !== 'function' || typeof b.window_metrics !== 'function') return;
    deps.post(
      { type: 'comparison', tick: a.tick(), fromTick: branchTick, a: Float64Array.from(a.window_metrics(branchTick)), b: Float64Array.from(b.window_metrics(branchTick)) },
      [],
    );
    lastComparison = t;
  };

  /** After both sides jumped (entering compare, a seek): paused, fresh clock/perf, a pair at once. */
  const afterPairJump = () => {
    clock.setRunning(false);
    clock.resetExecuted(scenarios[0]!.tick());
    clock.resync();
    tickWindow = new TickWindow();
    sinceFrameMs = 0;
    sinceFrameTicks = 0;
    trackedTrip = null;
    const t = deps.now();
    postPair(t);
    postComparison(t);
  };

  const compare = (on: boolean) => {
    const s = ready('compare');
    if (!s) return;
    if (!on) {
      if (!comparing) return;
      comparing = false;
      if (viewed === 0) pools[1] = []; // B posts no frames until it is viewed or compared again (k5)
      const t = deps.now();
      postFrame(s, t);
      lastPost = t;
      return;
    }
    if (comparing) return;
    if (scenarios.length < 2) {
      error('compare needs a branch B');
      return;
    }
    const other = scenarios[viewed === 0 ? 1 : 0]!;
    const t = s.tick();
    const info = other.timeline_info?.();
    if (!info || t < branchTick || t < info[0]!) {
      error(`compare refused: tick ${t} is before the branch (${branchTick}) or the other scenario's window`);
      return;
    }
    // align the other scenario to the viewed position: a seek inside its window, else a forward step
    if (t <= info[1]!) other.seek!(t);
    else {
      if (other.tick() !== info[1]!) other.seek!(info[1]!);
      other.step(t - other.tick());
    }
    comparing = true;
    afterPairJump();
  };

  /** The timeline messages need a ready world (not during the warm-up). */
  const ready = (what: string): SimLike | undefined => {
    if (!sim || warmup) {
      error(`${what} before the city is ready`);
      return undefined;
    }
    return sim;
  };

  /** After the viewed position jumped (seek, branch, view switch): the clock, perf and
   * inspection start afresh at the new position, and a frame shows it at once. */
  const afterJump = (s: SimLike) => {
    clock.resetExecuted(s.tick());
    clock.resync();
    tickWindow = new TickWindow();
    sinceFrameMs = 0;
    sinceFrameTicks = 0;
    trackedTrip = null;
    const t = deps.now();
    postFrame(s, t);
    lastPost = t;
  };

  const seek = (tick: number) => {
    const s = ready('seek');
    if (!s) return;
    if (comparing) {
      const [lo, hi] = sharedWindow();
      if (!Number.isInteger(tick) || tick < lo || tick > hi) {
        error(`seek outside the shared replay window: tick ${tick} not in ${lo}…${hi}`);
        return;
      }
      scenarios[0]!.seek!(tick);
      scenarios[1]!.seek!(tick);
      afterPairJump();
      return;
    }
    if (typeof s.seek !== 'function' || !Number.isInteger(tick) || tick < 0 || !s.seek(tick)) {
      const st = timelineStatus(s);
      error(`seek outside the replay window: tick ${tick} not in ${st.windowStartTick}…${st.headTick}`);
      return;
    }
    clock.setRunning(false);
    afterJump(s);
  };

  const branch = (fromTick: number, then: { kind: 'close' | 'open'; link: number }[]) => {
    if (!ready('branch')) return;
    const a = scenarios[0]!;
    const info = a.timeline_info?.();
    // validated before anything is freed or built
    if (typeof a.branch !== 'function' || !info || !Number.isInteger(fromTick) || fromTick < info[0]! || fromTick > info[1]!) {
      error(`branch outside the replay window: tick ${fromTick} not in ${info?.[0] ?? '?'}…${info?.[1] ?? '?'}`);
      return;
    }
    // the replaced B goes first: A plus one B at most, also while replacing. Until the new B
    // exists the host points at A, so a failing branch never leaves it on a freed B (f6)
    sim = a;
    viewed = 0;
    branchTick = -1;
    comparing = false;
    scenarios[1]?.free?.();
    scenarios = [a];
    pools[1] = [];
    worlds[1]++;
    let b: SimLike;
    try {
      b = a.branch(fromTick);
    } catch (e) {
      clock.setRunning(false);
      afterJump(a);
      throw e; // reported as an error by handle()
    }
    scenarios = [a, b];
    viewed = 1;
    sim = b;
    branchTick = fromTick;
    for (const c of then) command(c.kind, c.link);
    clock.setRunning(false);
    afterJump(b);
  };

  const viewScenario = (scenario: 0 | 1) => {
    if (!ready('viewScenario')) return;
    if (comparing) {
      error('the viewed scenario cannot change while comparing');
      return;
    }
    const target = scenarios[scenario];
    if (!target || (scenario !== 0 && scenario !== 1)) {
      error(`no scenario ${String(scenario)}`);
      return;
    }
    clock.setRunning(false);
    viewed = scenario;
    sim = target;
    target.forget_frames?.(); // picks from the other scenario's frames must not resolve here
    afterJump(target);
  };

  const discardBranch = () => {
    if (!ready('discardBranch') || scenarios.length < 2) return;
    clock.setRunning(false);
    comparing = false;
    scenarios[1]!.free?.();
    scenarios = [scenarios[0]!];
    pools[1] = [];
    worlds[1]++;
    viewed = 0;
    branchTick = -1;
    sim = scenarios[0]!;
    afterJump(sim);
  };

  const inspectVehicle = (msg: Extract<ToWorker, { type: 'inspectVehicle' }>) => {
    if ('clear' in msg || !sim || typeof sim.trip_at_record !== 'function') {
      trackedTrip = null;
      return;
    }
    const { frameTick, record } = msg;
    if (!Number.isInteger(frameTick) || !Number.isInteger(record) || record < 0) {
      trackedTrip = null;
      return;
    }
    const trip = sim.trip_at_record(frameTick, record);
    // an unresolvable pick (frame no longer retained) keeps whatever is tracked now
    if (Number.isInteger(trip) && trip >= 0) trackedTrip = trip;
  };

  const inspectLink = (link: number | null) => {
    inspectedLink = link !== null && Number.isInteger(link) && link >= 0 && link < linkCount ? link : null;
  };

  /** At most one vehicle_detail (+ one trip_outcome once it is gone) and one link_detail per frame. */
  const tracked = (s: SimLike): TrackedVehicle | TrackedGone | null => {
    if (trackedTrip === null || typeof s.vehicle_detail !== 'function') return null;
    const trip = trackedTrip;
    const d = decodeVehicleDetail(s.vehicle_detail(trip));
    if (d) return d;
    trackedTrip = null;
    const outcome = typeof s.trip_outcome === 'function' ? decodeTripOutcome(trip, s.trip_outcome(trip)) : null;
    return outcome ?? { gone: true, tripId: trip, outcome: 'unknown', travelTimeS: null };
  };

  const linkDetail = (s: SimLike): LinkDetail | null =>
    inspectedLink === null || typeof s.link_detail !== 'function'
      ? null
      : decodeLinkDetail(inspectedLink, s.link_detail(inspectedLink));

  const perf = (t: number): PerfStats => {
    while (frameTimes.length > 0 && frameTimes[0]! <= t - 1000) frameTimes.shift();
    const w = tickWindow.stats();
    const p: PerfStats = {
      tickMsMedian: w.median,
      tickMsP95: w.p95,
      tickMsMax: w.max,
      tickMsMean: tickWindow.mean(),
      ticksMeasured: w.ticks,
      lastBatchTicks,
      framesPerS: frameTimes.length,
      encodeMs,
      frameTicks: sinceFrameTicks,
      frameTickMs: sinceFrameMs,
      timerResolutionMs,
    };
    sinceFrameMs = 0;
    sinceFrameTicks = 0;
    return p;
  };

  const postFrame = (s: SimLike, t: number, side: 0 | 1 = viewed) => {
    const e0 = perfNow();
    const count = s.encode_frame();
    const words = count * VEHICLE_RECORD_WORDS;
    const bytes = words * 4;
    // each side has its own pool (polish-005); the newest returned buffer of the exact size is taken out
    const pool = pools[side];
    let reuse: ArrayBuffer | undefined;
    for (let i = pool.length - 1; i >= 0; i--) {
      if (pool[i]!.byteLength === bytes) {
        reuse = pool.splice(i, 1)[0];
        break;
      }
    }
    const vehicles = reuse ?? new ArrayBuffer(bytes);
    new Uint32Array(vehicles).set(new Uint32Array(deps.memory().buffer, s.frame_ptr(), words));
    encodeMs = perfNow() - e0;
    frameTimes.push(t);
    const tick = s.tick();
    // `tracked` / `linkDetail` are omitted until inspection is used (see FrameMessage)
    const msg = {
      type: 'frame',
      tick,
      simTimeS: tick * DT,
      count,
      vehicles,
      // a fresh copy per frame (structured-cloned, 2 bytes per vehicle); fakes without it draw straight
      nextLinks: s.next_links?.() ?? new Uint16Array(count).fill(NO_NEXT_LINK),
      linkCounts: s.link_counts(),
      linkQueued: s.link_queued(),
      closed: s.closed_links(),
      metrics: s.metrics(),
      clock: clock.status(),
      perf: perf(t),
      scenario: side,
      world: worlds[side],
      timeline: timelineStatus(s),
      // no vehicle tracking and no host link detail while comparing (ward timeline-004)
      ...(vehicleInspectionUsed ? { tracked: comparing ? null : tracked(s), trackedSeq: inspectSeq } : {}),
      ...(linkInspectionUsed ? { linkDetail: comparing ? null : linkDetail(s) } : {}),
    } as FrameMessage;
    deps.post(msg, [vehicles]);
  };

  return {
    handle(msg: ToWorker): void {
      // every handled message (also an ignored or failing one) gets a frame from the next iteration;
      // a returned buffer is not a change (and must not ping-pong frames)
      if (msg.type !== 'returnBuffer') dirty = true;
      try {
        switch (msg.type) {
          case 'init':
            init(msg.demandSeed, msg.behaviorSeed, msg.city ?? DEFAULT_CITY, msg.warmupS ?? 0, msg.demandScale ?? 1);
            break;
          case 'setRunning':
            clock.setRunning(msg.running);
            // a pause while comparing shows the comparison at the paused tick
            if (comparing && !msg.running) postComparison(deps.now());
            break;
          case 'setSpeed':
            clock.setSpeed(msg.multiplier);
            break;
          case 'command':
            command(msg.kind, msg.link);
            break;
          case 'returnBuffer': {
            const side = msg.scenario === 1 || msg.scenario === 0 ? msg.scenario : viewed;
            // never a detached/empty buffer, never one of a replaced world (a missing tag = current)
            if (msg.buffer.byteLength > 0 && (msg.world === undefined || msg.world === worlds[side])) {
              pools[side].push(msg.buffer);
              if (pools[side].length > POOL_MAX) pools[side].shift(); // the oldest goes first
            }
            break;
          }
          case 'debugTrap':
            trapNext = true;
            break;
          case 'inspectVehicle':
            if (comparing) break; // vehicles are not picked while comparing
            vehicleInspectionUsed = true;
            if (typeof msg.seq === 'number' && Number.isFinite(msg.seq)) inspectSeq = msg.seq;
            inspectVehicle(msg);
            break;
          case 'inspectLink':
            linkInspectionUsed = true;
            inspectLink(msg.link);
            break;
          case 'seek':
            seek(msg.tick);
            break;
          case 'branch':
            branch(msg.fromTick, msg.then ?? []);
            break;
          case 'viewScenario':
            viewScenario(msg.scenario);
            break;
          case 'discardBranch':
            discardBranch();
            break;
          case 'compare':
            compare(msg.on);
            break;
        }
      } catch (e) {
        error(e instanceof Error ? e.message : String(e));
      }
    },

    iterate(): void {
      if (!sim) return;
      try {
        if (trapNext) {
          trapNext = false;
          sim?.debug_trap?.();
        }
        if (warmup) {
          warmStep(sim, warmup);
          return;
        }
        const n = clock.plan();
        let ms = 0;
        if (n > 0) {
          // the pacing reads `now`; the statistics read the measurement clock
          const t0 = deps.now();
          const p0 = perfNow();
          if (comparing) {
            // lockstep: both by the same n, timed as a pair (behind = the pair cannot keep up)
            scenarios[0]!.step(n);
            scenarios[1]!.step(n);
          } else sim.step(n);
          const pms = perfNow() - p0;
          ms = deps.now() - t0;
          tickWindow.add(pms, n);
          sinceFrameMs += pms;
          sinceFrameTicks += n;
          lastBatchTicks = n;
        }
        clock.report(n, ms);
        const t = deps.now();
        const running = clock.isRunning;
        if (wasRunning && !running) settleAt = t + WINDOW_MS + FRAME_INTERVAL_MS;
        if (running) settleAt = null;
        wasRunning = running;
        const settle = settleAt !== null && t >= settleAt;
        // running: as before, at most every 16 ms; paused: only when something changed, plus one
        // settling frame (the shown achieved speed reads 0) — no identical frames over and over (motion-001)
        if (dirty || settle || (running && t - lastPost >= FRAME_INTERVAL_MS)) {
          dirty = false;
          if (settle) settleAt = null;
          if (comparing) {
            postPair(t);
            if (n > 0 && t - lastComparison >= COMPARISON_INTERVAL_MS) postComparison(t);
          } else {
            postFrame(sim, t);
            lastPost = t;
          }
        }
      } catch (e) {
        // A wasm panic leaves the instance in an unknown state: halt, report once (fatal: only a restart helps).
        sim = undefined;
        halted = true;
        fatal(`simulation halted: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}

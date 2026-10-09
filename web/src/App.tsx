import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Camera } from './render/camera';
import { cityDecor, type CityDecor, type CityLabel } from './render/cities';
import { buildRoadGeometry, vehiclePosition, type RoadGeometry } from './render/geometry';
import { pickLink, pickVehicle, VEHICLE_PICK_MIN_ZOOM } from './render/picking';
import { COMPARE_FIT_INSETS, FIT_INSETS } from './render/layout';
import { CityRenderer, linkCapacity } from './render/renderer';
import { createSimClient, type SimClient } from './sim/client';
import { decodeVehicles, type DecodedVehicles } from './sim/frame';
import { RENDER_WINDOW, SampleWindow } from './sim/perf';
import {
  DT,
  FLAG_QUEUED,
  WARMUP_SIM_S,
  parseCityName,
  parseDemandScale,
  type ClockStatus,
  type ComparisonMessage,
  type FrameMessage,
  type PerfStats,
  type TimelineStatus,
  type LinkDetail,
  type ReadyMessage,
  type TrackedGone,
  type TrackedVehicle,
} from './sim/protocol';
import { ControlPanel, SPEEDS } from './ui/ControlPanel';
import { ComparisonPanel } from './ui/ComparisonPanel';
import { DiagnosticsPanel, type RenderStats } from './ui/DiagnosticsPanel';
import { MetricsStrip } from './ui/MetricsStrip';
import { SelectionPanel } from './ui/SelectionPanel';
import { Legend } from './ui/Legend';
import { ConfirmReplace, ScenarioPanel } from './ui/ScenarioPanel';
import { TimelineBar } from './ui/TimelineBar';
import { VehiclePanel } from './ui/VehiclePanel';
import type { LivingCitySnapshot, PerfRecording } from './ui/testHook';
import './styles.css';

const DEFAULT_SPEED = 20;
/** The diagnostics panel's render numbers refresh at this period (ms). */
const RENDER_STATS_REFRESH_MS = 500;
/** Wheel zoom: factor per 100 px of wheel delta (one notch ≈ 16 %). */
const WHEEL_FACTOR_PER_100PX = 1.16;
const CLICK_SLOP_PX = 4;
/** Why interventions are off while A and B are compared side by side (ward timeline-004). */
const NO_INTERVENTIONS_WHILE_COMPARING = 'Exit comparison to change roads';

/** What the UI shows of the latest frame (the vehicle buffer goes to the GPU and back). */
interface FrameView {
  tick: number;
  simTimeS: number;
  closed: number[];
  linkCounts: Uint16Array;
  linkQueued: Uint16Array;
  metrics: Record<string, number>;
  clock: ClockStatus;
  perf: PerfStats;
  frameBytes: number;
  scenario: 0 | 1;
  timeline: TimelineStatus;
}

type Intervention = { kind: 'close' | 'open'; link: number };

/** `?demand=` for stress measurements, read once (an invalid value falls back to 1 with a warning). */
const DEMAND = (() => {
  const raw = new URLSearchParams(window.location.search).get('demand');
  const parsed = parseDemandScale(raw);
  if (parsed.invalid) console.warn(`Ignoring ?demand=${raw}: the demand scale must be a number from 0.25 to 6; using 1.`);
  return parsed.scale;
})();

/** An in-progress perf recording (test hook): everything from start to stop. */
interface Recording extends Omit<PerfRecording, 'wallMs' | 'timerResolutionMs'> {
  startMs: number;
}

/** Below this width the scenario/confirm panels stack in the left column (styles.css mirrors it). */
const NARROW_QUERY = '(max-width: 959px)';

/** Focus the timeline slider (where focus goes when the panel holding it closes). */
const focusTimeline = () => document.querySelector<HTMLElement>('[role="slider"][aria-label="Timeline"]')?.focus();

const isInteractive = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA'].includes(t.tagName));

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camera = useRef(new Camera()).current;
  const renderer = useRef<CityRenderer | null>(null);
  const client = useRef<SimClient | null>(null);
  const geometry = useRef<RoadGeometry | null>(null);
  const readyRef = useRef<ReadyMessage | null>(null);
  const frameRef = useRef<FrameView | null>(null);
  const selectedRef = useRef<number | null>(null);
  const hoveredRef = useRef<number | null>(null);
  const renderFrames = useRef(0);
  /** A copy of the latest frame's records (the transferred buffer goes back to the worker). */
  const recordsRef = useRef<{ tick: number; vehicles: DecodedVehicles } | null>(null);
  const trackedRef = useRef<TrackedVehicle | null>(null);
  /** Sequence number of the last vehicle request (pick or clear). Frames echo the last one the
   * worker handled; tracking from frames older than our last request is stale and ignored. */
  const inspectSeqRef = useRef(0);
  const followingRef = useRef(false);
  /** The user moved the camera (pan, zoom, Follow) since the last fit: a resize then keeps the view. */
  const cameraTouched = useRef(false);
  /** Narrow windows: the scenario and confirm panels join the left column (no room between the side columns). */
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  /** Sim seconds per wall ms of the last drawn picture (0 while paused). */
  const simPerMsRef = useRef(0);
  /** Render-side measurement (C5): rAF intervals and draw CPU time over the last 300 frames. */
  // lazily created once (useRef(new …) would build and discard windows on every render)
  const [renderIntervals] = useState(() => ({ current: new SampleWindow(RENDER_WINDOW) }));
  const [drawTimes] = useState(() => ({ current: new SampleWindow(RENDER_WINDOW) }));
  const recordingRef = useRef<Recording | null>(null);
  /** Side by side (ward timeline-004): B's canvas and renderer exist only while comparing. */
  const canvasBRef = useRef<HTMLCanvasElement | null>(null);
  const rendererB = useRef<CityRenderer | null>(null);
  const decorRef = useRef<CityDecor | null>(null);
  /** B's latest frame view, and a copy of its records (replayed into a renderer created later). */
  const bFrameRef = useRef<FrameView | null>(null);
  const bRecordsRef = useRef<{ words: Uint32Array; count: number; tick: number; running: boolean; multiplier: number } | null>(null);
  /** An A frame waiting for its B partner (pairs are applied and drawn together). */
  const pendingPairA = useRef<FrameMessage | null>(null);
  /** The comparison layout is applied (canvases laid out, camera refitted): the hook's `compare`. */
  const [compareView, setCompareView] = useState(false);
  const compareViewRef = useRef(false);
  /** The scenario viewed in single view (kept while comparing). */
  const viewedRef = useRef<0 | 1>(0);
  const [comparison, setComparison] = useState<ComparisonMessage | null>(null);
  const comparisonRef = useRef<ComparisonMessage | null>(null);
  /** The side a road was picked on (always A outside the comparison). */
  const selectedSideRef = useRef<'A' | 'B'>('A');
  const [selectedSide, setSelectedSide] = useState<'A' | 'B'>('A');
  const drawnCams = useRef<{ a: { cx: number; cy: number; zoom: number }; b: { cx: number; cy: number; zoom: number } } | null>(null);
  const labelElsB = useRef<(HTMLSpanElement | null)[]>([]);
  const [diagOpen, setDiagOpen] = useState(false);
  /** The last requested seek target until a frame shows it (keys and interventions use it). */
  const pendingSeekRef = useRef<number | null>(null);
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  /** An intervention in A's past that would replace B, waiting for the user's confirmation. */
  const [confirmReplace, setConfirmReplace] = useState<{ then: Intervention[]; at: number; onBranched?: () => void } | null>(null);
  const confirmRef = useRef(confirmReplace);
  confirmRef.current = confirmReplace;
  const computeRenderStats = (): RenderStats => {
    const i = renderIntervals.current.stats();
    const d = drawTimes.current.stats();
    return { intervalMedianMs: i.median, intervalP95Ms: i.p95, drawMedianMs: d.median, drawP95Ms: d.p95, samples: i.count };
  };
  /** Render stats as shown: refreshed twice a second (readable; the panel and the hook show the same values). */
  const [renderStatsRef] = useState(() => ({ current: { at: Number.NEGATIVE_INFINITY, stats: computeRenderStats() } }));
  const renderStats = () => renderStatsRef.current.stats;

  const [ready, setReady] = useState<ReadyMessage | null>(null);
  const [frame, setFrame] = useState<FrameView | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  // The latest requested speed: a choice made before the worker is ready must survive `ready`.
  const speedRef = useRef(DEFAULT_SPEED);
  const [mainPending, setMainPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noGl, setNoGl] = useState(false);
  const [labels, setLabels] = useState<CityLabel[]>([]);
  const labelsRef = useRef<CityLabel[]>([]);
  /** The label elements, positioned on every animation frame (not only on sim frames). */
  const labelEls = useRef<(HTMLSpanElement | null)[]>([]);
  /**
   * Label placement: `gen` counts camera / label-set changes; each element remembers the
   * generation it was placed for, so a newly mounted (or remounted) element is always placed.
   */
  const labelCam = useRef({ labels: null as unknown, cx: NaN, cy: NaN, zoom: NaN, w: NaN, h: NaN, gen: 0 });
  const labelPlaced = useRef(new WeakMap<HTMLElement, number>());
  const placeLabel = (el: HTMLElement, l: CityLabel) => {
    labelPlaced.current.set(el, labelCam.current.gen);
    const [sx, sy] = camera.worldToScreen(l.x, l.y);
    el.style.left = `${sx}px`;
    el.style.top = `${sy}px`;
  };
  /** A label that would be cut at its layer's edge (a split-view half, the window) is hidden, never
   *  half-drawn. All reads first, then all writes: one layout for the batch, not one per label. */
  const hideCutLabels = (els: HTMLElement[]) => {
    const cut = els.map((el) => {
      const layer = el.parentElement?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return !!layer && (r.left < layer.left - 0.5 || r.right > layer.right + 0.5 || r.top < layer.top - 0.5 || r.bottom > layer.bottom + 0.5);
    });
    els.forEach((el, i) => (el.style.visibility = cut[i] ? 'hidden' : ''));
  };
  const [tracked, setTracked] = useState<TrackedVehicle | null>(null);
  const [gone, setGone] = useState<TrackedGone | null>(null);
  const [following, setFollowing] = useState(false);
  const [linkDetail, setLinkDetail] = useState<LinkDetail | null>(null);

  const central = ready?.landmarks.central_bridge;
  const mainClosedConfirmed = !!(central && frame && central.every((l) => frame.closed.includes(l)));
  const mainClosed = mainPending ?? mainClosedConfirmed;
  const running = frame?.clock.running ?? false;

  const pushLinkState = useCallback(() => {
    const f = frameRef.current;
    const onB = selectedSideRef.current === 'B';
    if (renderer.current && f) renderer.current.setLinkState(f.closed, onB ? null : selectedRef.current, hoveredRef.current, f.linkCounts);
    const fb = bFrameRef.current;
    if (rendererB.current && fb) rendererB.current.setLinkState(fb.closed, onB ? selectedRef.current : null, null, fb.linkCounts);
  }, []);

  const select = useCallback(
    (link: number | null, side: 'A' | 'B' = 'A') => {
      selectedRef.current = link;
      selectedSideRef.current = side;
      setSelectedSide(side);
      setSelected(link);
      setLinkDetail(null);
      client.current?.inspectLink(link);
      pushLinkState();
    },
    [pushLinkState],
  );

  const follow = useCallback((on: boolean) => {
    followingRef.current = on;
    if (on) cameraTouched.current = true; // Follow moves the camera: no refit on resize afterwards
    setFollowing(on);
  }, []);

  /** Stop inspecting the vehicle (also clears a `gone` notice). */
  const clearVehicle = useCallback(() => {
    client.current?.clearInspectedVehicle(++inspectSeqRef.current);
    trackedRef.current = null;
    renderer.current?.setTracked(null);
    setTracked(null);
    setGone(null);
    follow(false);
  }, [follow]);

  // Simulation client: ready → geometry + camera; frames → GPU + UI state.
  useEffect(() => {
    const canvas = canvasRef.current!;
    try {
      renderer.current = new CityRenderer(canvas);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // only a missing WebGL2 context is reported as such; anything else (e.g. a shader error) as is
      setError(msg.includes('WebGL2 is not available') ? 'WebGL2 is not available: this browser cannot draw the city.' : msg);
      setNoGl(true);
      return;
    }
    // the worker pre-simulates WARMUP_SIM_S before `ready`: the app opens on a living city
    const c = createSimClient(2026, 7, parseCityName(new URLSearchParams(window.location.search).get('city')), {
      warmupS: WARMUP_SIM_S,
      demandScale: DEMAND,
    });
    // requested at once (the host keeps them through the warm-up): the first frame already runs
    c.setSpeed(speedRef.current);
    c.setRunning(true);
    client.current = c;
    c.onError((m) => {
      setError(m);
      // a refused seek never arrives: stop waiting for it
      pendingSeekRef.current = null;
      setPendingSeek(null);
    });
    c.onComparison((m) => {
      comparisonRef.current = m;
      setComparison(m);
    });
    c.onReady((r) => {
      readyRef.current = r;
      const g = buildRoadGeometry(r.network);
      geometry.current = g;
      const decor = cityDecor(r, g);
      decorRef.current = decor;
      labelsRef.current = decor.labels;
      setLabels(decor.labels);
      renderer.current!.setNetwork(g, decor);
      camera.fitInsets(g.bounds, FIT_INSETS);
      cameraTouched.current = false;
      setReady(r);
      c.setSpeed(speedRef.current);
      c.setRunning(true);
    });
    /** B's half of a pair: its renderer (if already created) and its view. */
    const applyFrameB = (f: FrameMessage) => {
      const words = new Uint32Array(f.vehicles);
      bRecordsRef.current = { words: words.slice(0, f.count * 4), count: f.count, tick: f.tick, running: f.clock.running, multiplier: f.clock.multiplier };
      rendererB.current?.setFrame(words, f.count, performance.now(), f.tick, f.clock.running, f.clock.multiplier);
      c.returnBuffer(f.vehicles);
      const names = readyRef.current?.metricNames ?? [];
      const metrics: Record<string, number> = {};
      names.forEach((n, i) => (metrics[n] = f.metrics[i]!));
      bFrameRef.current = {
        tick: f.tick,
        simTimeS: f.simTimeS,
        closed: Array.from(f.closed),
        linkCounts: f.linkCounts,
        linkQueued: f.linkQueued,
        metrics,
        clock: f.clock,
        perf: f.perf,
        frameBytes: f.vehicles.byteLength,
        scenario: f.scenario,
        timeline: f.timeline,
      };
    };
    c.onFrame((f: FrameMessage) => {
      if (f.timeline.compare === 1) {
        // a pair: hold A until its B partner arrives, then apply and draw both together
        if (f.scenario === 0) {
          if (pendingPairA.current) c.returnBuffer(pendingPairA.current.vehicles);
          pendingPairA.current = f;
          return;
        }
        const a = pendingPairA.current;
        pendingPairA.current = null;
        if (!a || a.tick !== f.tick) {
          if (a) c.returnBuffer(a.vehicles);
          c.returnBuffer(f.vehicles);
          return;
        }
        applyFrameB(f);
        applyFrame(a);
        return;
      }
      if (pendingPairA.current) {
        c.returnBuffer(pendingPairA.current.vehicles);
        pendingPairA.current = null;
      }
      bFrameRef.current = null;
      bRecordsRef.current = null;
      comparisonRef.current = null;
      viewedRef.current = f.scenario;
      applyFrame(f);
    });
    function applyFrame(f: FrameMessage) {
      renderer.current?.setFrame(new Uint32Array(f.vehicles), f.count, performance.now(), f.tick, f.clock.running, f.clock.multiplier);
      // keep a copy for picking before the buffer goes back to the worker
      recordsRef.current = { tick: f.tick, vehicles: decodeVehicles(f.vehicles.slice(0), f.count) };
      if (f.trackedSeq !== undefined && f.trackedSeq < inspectSeqRef.current) {
        // built before the worker saw our latest pick/clear: its tracking data is stale
      } else if (f.tracked && 'gone' in f.tracked) {
        trackedRef.current = null;
        renderer.current?.setTracked(null);
        setTracked(null);
        setGone(f.tracked);
        followingRef.current = false;
        setFollowing(false);
      } else if (f.tracked) {
        trackedRef.current = f.tracked;
        renderer.current?.setTracked(f.tracked);
        setTracked(f.tracked);
        setGone(null);
      } else if (f.tracked === null && trackedRef.current) {
        // the worker tracks nothing (e.g. an unresolvable pick): never keep stale data on screen
        trackedRef.current = null;
        renderer.current?.setTracked(null);
        setTracked(null);
        followingRef.current = false;
        setFollowing(false);
      }
      setLinkDetail(f.linkDetail ?? null);
      const frameBytes = f.vehicles.byteLength;
      c.returnBuffer(f.vehicles); // uploaded: give the buffer back to the worker's pool
      const names = readyRef.current?.metricNames ?? [];
      const metrics: Record<string, number> = {};
      names.forEach((n, i) => (metrics[n] = f.metrics[i]!));
      const rec = recordingRef.current;
      if (rec) {
        rec.ticks.push([f.perf.frameTickMs, f.perf.frameTicks]);
        rec.onNetwork.push(metrics['on_network'] ?? 0);
        rec.active.push(metrics['active'] ?? 0);
        rec.waitingAtOrigin.push(metrics['waiting_at_origin'] ?? 0);
        rec.frames++;
      }
      const view: FrameView = {
        tick: f.tick,
        simTimeS: f.simTimeS,
        closed: Array.from(f.closed),
        linkCounts: f.linkCounts,
        linkQueued: f.linkQueued,
        metrics,
        clock: f.clock,
        perf: f.perf,
        frameBytes,
        scenario: f.scenario,
        timeline: f.timeline,
      };
      if (pendingSeekRef.current !== null && f.timeline.positionTick === pendingSeekRef.current) {
        pendingSeekRef.current = null;
        setPendingSeek(null);
      }
      frameRef.current = view;
      pushLinkState();
      setFrame(view);
    }
    return () => {
      c.dispose();
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [camera, pushLinkState]);

  const comparingNow = frame?.timeline.compare === 1;
  useLayoutEffect(() => {
    if (comparingNow === compareViewRef.current) return;
    const g = geometry.current;
    const d = decorRef.current;
    if (!g || !d) return;
    if (comparingNow) {
      const cb = canvasBRef.current;
      if (!cb) return;
      try {
        rendererB.current = new CityRenderer(cb);
      } catch {
        return;
      }
      rendererB.current.setNetwork(g, d);
      const b = bRecordsRef.current;
      if (b) rendererB.current.setFrame(b.words, b.count, performance.now(), b.tick, b.running, b.multiplier);
    } else {
      const rb = rendererB.current;
      rendererB.current = null;
      if (rb) {
        rb.dispose();
        rb.loseContext(); // never left for the browser to reclaim (it would drop the oldest: A's)
      }
      setComparison(null);
    }
    const r = canvasRef.current!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    camera.setViewport(r.width, r.height);
    renderer.current?.resize(r.width, r.height, dpr);
    rendererB.current?.resize(r.width, r.height, dpr);
    camera.fitInsets(g.bounds, comparingNow ? COMPARE_FIT_INSETS : FIT_INSETS);
    cameraTouched.current = false;
    selectedRef.current = null;
    selectedSideRef.current = 'A';
    hoveredRef.current = null;
    setSelected(null);
    setSelectedSide('A');
    pushLinkState();
    compareViewRef.current = comparingNow;
    setCompareView(comparingNow);
  }, [comparingNow, camera, pushLinkState]);

  // The pending main-bridge state clears once a frame confirms it.
  useEffect(() => {
    if (mainPending !== null && mainPending === mainClosedConfirmed) setMainPending(null);
  }, [mainPending, mainClosedConfirmed]);

  // Canvas size follows the window (CSS px) and devicePixelRatio (backing store).
  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      camera.setViewport(r.width, r.height);
      renderer.current?.resize(r.width, r.height, window.devicePixelRatio || 1);
      rendererB.current?.resize(r.width, r.height, window.devicePixelRatio || 1);
      // an untouched view keeps showing the whole city; a camera the user moved stays where it is
      const g = geometry.current;
      if (g && !cameraTouched.current) camera.fitInsets(g.bounds, compareViewRef.current ? COMPARE_FIT_INSETS : FIT_INSETS);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    // A DPR change (browser zoom, moving to another screen) does not resize the element: watch it directly.
    let mq: MediaQueryList | null = null;
    const watchDpr = () => {
      mq?.removeEventListener('change', onDpr);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener('change', onDpr);
    };
    const onDpr = () => {
      resize();
      watchDpr();
    };
    watchDpr();
    return () => {
      ro.disconnect();
      mq?.removeEventListener('change', onDpr);
    };
  }, [camera]);

  // Render loop: independent of the tick rate; extrapolates only while running.
  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
    const loop = (now: number) => {
      if (last !== null) {
        renderIntervals.current.add(now - last);
        recordingRef.current?.renderIntervals.push(now - last);
      }
      last = now;
      const f = frameRef.current;
      // Extrapolate at the requested speed; only when the engine is behind, at the achieved rate.
      // (The achieved rate is a 1-s window: right after Play it is still ~0, which made motion lurch.)
      const simPerMs =
        f && f.clock.running ? (f.clock.behind ? f.clock.achievedTicksPerS * DT : f.clock.multiplier) / 1000 : 0;
      simPerMsRef.current = simPerMs;
      if (followingRef.current) {
        const at = renderer.current?.trackedWorldPosition(now, simPerMs);
        if (at) [camera.cx, camera.cy] = at;
      }
      const d0 = performance.now();
      renderer.current?.draw(camera, now, simPerMs);
      const camA = { cx: camera.cx, cy: camera.cy, zoom: camera.zoom };
      if (rendererB.current) {
        rendererB.current.draw(camera, now, simPerMs);
        drawnCams.current = { a: camA, b: { cx: camera.cx, cy: camera.cy, zoom: camera.zoom } };
      } else drawnCams.current = null;
      const drawMs = performance.now() - d0;
      drawTimes.current.add(drawMs);
      recordingRef.current?.drawMs.push(drawMs);
      if (now - renderStatsRef.current.at >= RENDER_STATS_REFRESH_MS) renderStatsRef.current = { at: now, stats: computeRenderStats() };
      const cam = labelCam.current;
      const moved =
        cam.labels !== labelsRef.current || cam.cx !== camera.cx || cam.cy !== camera.cy || cam.zoom !== camera.zoom || cam.w !== camera.width || cam.h !== camera.height;
      if (moved) Object.assign(cam, { labels: labelsRef.current, cx: camera.cx, cy: camera.cy, zoom: camera.zoom, w: camera.width, h: camera.height, gen: cam.gen + 1 });
      const placed: HTMLElement[] = [];
      labelsRef.current.forEach((l, i) => {
        for (const el of [labelEls.current[i], labelElsB.current[i]]) {
          if (el && labelPlaced.current.get(el) !== cam.gen) {
            placeLabel(el, l);
            placed.push(el);
          }
        }
      });
      if (placed.length) hideCutLabels(placed);
      renderFrames.current++;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [camera]);

  const toggleRunning = useCallback(() => client.current?.setRunning(!(frameRef.current?.clock.running ?? false)), []);
  const changeSpeed = useCallback((s: number) => {
    speedRef.current = s;
    setSpeed(s);
    client.current?.setSpeed(s);
  }, []);
  /** The viewed scenario's position as the user last requested it (a seek may be on its way). */
  const currentPosition = useCallback(() => pendingSeekRef.current ?? frameRef.current?.timeline.positionTick ?? 0, []);

  /** Every jump (seek, view switch, discard, branch) drops what referred to the old position. */
  const forgetPosition = useCallback(() => {
    setMainPending(null);
    setConfirmReplace(null);
  }, []);

  const requestSeek = useCallback(
    (tick: number) => {
      forgetPosition();
      pendingSeekRef.current = tick;
      setPendingSeek(tick);
      client.current?.seek(tick);
    },
    [forgetPosition],
  );

  /**
   * Close/open roads in the viewed scenario (contract T3): at the head, or anywhere in B, an
   * ordinary command; in A's past, a branch B from the position (after confirming if B exists).
   * Returns whether the commands went to the viewed scenario directly.
   */
  const intervene = useCallback(
    (then: Intervention[], onApplied?: () => void) => {
      const f = frameRef.current;
      const c = client.current;
      if (!f || !c || compareViewRef.current || f.timeline.compare === 1) return; // off while comparing
      const pos = currentPosition();
      if (f.scenario === 0 && pos < f.timeline.headTick) {
        if (f.timeline.branchTick >= 0) {
          setConfirmReplace({ then, at: pos, ...(onApplied ? { onBranched: onApplied } : {}) });
        } else {
          forgetPosition();
          c.branch(pos, then);
          onApplied?.();
        }
        return;
      }
      for (const t of then) (t.kind === 'close' ? c.closeLink(t.link) : c.openLink(t.link));
      onApplied?.();
    },
    [currentPosition, forgetPosition],
  );

  const toggleMainBridge = useCallback(() => {
    const r = readyRef.current;
    const f = frameRef.current;
    if (!r || !client.current) return;
    const links = r.landmarks.central_bridge;
    const closedNow = mainPending ?? !!(f && links.every((l) => f.closed.includes(l)));
    // the pending cue also covers a branch: B shows "(pending)" until it runs the command
    intervene(
      links.map((link) => ({ kind: closedNow ? 'open' : 'close', link })),
      () => setMainPending(!closedNow),
    );
  }, [mainPending, intervene]);

  const goneRef = useRef<TrackedGone | null>(null);
  /** Origin/destination of the last tracked vehicle, so a `gone` notice keeps its names. */
  const lastTitleRef = useRef<{ origin: number; dest: number } | null>(null);
  if (tracked) lastTitleRef.current = { origin: tracked.origin, dest: tracked.dest };
  goneRef.current = gone;

  /** Canvas-local CSS px → the record a click would pick (only when zoomed in enough), else null. */
  const pickVehicleAt = useCallback(
    (x: number, y: number): number | null => {
      const r = recordsRef.current;
      const g = geometry.current;
      if (!r || !g || camera.zoom < VEHICLE_PICK_MIN_ZOOM || compareViewRef.current) return null;
      return pickVehicle(r.vehicles, g.links, camera, x, y, 8, renderer.current?.extrapolationS(performance.now(), simPerMsRef.current) ?? 0);
    },
    [camera],
  );

  /** World metres → page coordinates (CSS px), or null if outside the canvas. */
  const toPage = useCallback(
    (wx: number, wy: number): [number, number] | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const [sx, sy] = camera.worldToScreen(wx, wy);
      if (sx < 0 || sy < 0 || sx > camera.width || sy > camera.height) return null;
      const r = canvas.getBoundingClientRect();
      return [r.left + sx, r.top + sy];
    },
    [camera],
  );

  // Global shortcuts (ignored while focus is in a control).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const onButton = e.target instanceof HTMLElement && e.target.tagName === 'BUTTON';
      if (isInteractive(e.target) && !(e.key === 'Escape' && onButton)) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) toggleRunning(); // holding Space must not flicker play/pause
      } else if (e.key === 'b' || e.key === 'B') {
        if (!e.repeat) toggleMainBridge(); // holding B must not flicker the bridge
      } else if (e.key === 'd' || e.key === 'D') {
        if (!e.repeat) setDiagOpen((o) => !o);
      } else if (e.key === '+' || e.key === '=' || e.key === '-') {
        const i = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
        const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + (e.key === '-' ? -1 : 1)))]!;
        if (next !== speed) changeSpeed(next);
      } else if (e.key === 'Escape') {
        // innermost first: the confirmation (as Cancel), then the vehicle, then the road
        const inPanel = (sel: string) => e.target instanceof Element && !!e.target.closest(sel);
        if (confirmRef.current) {
          setConfirmReplace(null);
          focusTimeline();
        } else if (trackedRef.current || goneRef.current) {
          if (inPanel('section.vehicle')) focusTimeline(); // the panel holding focus goes away
          clearVehicle();
        } else {
          if (inPanel('section.selection')) focusTimeline();
          select(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRunning, toggleMainBridge, changeSpeed, select, clearVehicle, speed]);

  // A button clicked with the pointer gives its focus back, so the next Space/B is a shortcut, not a
  // second press of that button. Keyboard activation (detail 0) keeps focus for keyboard users.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const button = e.target instanceof Element ? e.target.closest('button') : null;
      if (button && e.detail > 0) button.blur();
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  // Pointer: drag pans, click selects, hover highlights, wheel zooms about the cursor.
  useEffect(() => {
    const canvasA = canvasRef.current!;
    const canvasB = compareView ? canvasBRef.current : null;
    let drag: { x: number; y: number; moved: boolean; canvas: HTMLCanvasElement } | null = null;
    const local = (e: MouseEvent): [number, number] => {
      const c = (e.currentTarget as HTMLCanvasElement | null) ?? drag?.canvas ?? canvasA;
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const sideOf = (e: Event): 'A' | 'B' => (e.currentTarget === canvasB && canvasB ? 'B' : 'A');
    const pick = (x: number, y: number) => (geometry.current ? pickLink(geometry.current.links, camera, x, y) : null);
    const pickVeh = (x: number, y: number) => pickVehicleAt(x, y);
    const down = (e: PointerEvent) => {
      const c = e.currentTarget as HTMLCanvasElement;
      drag = { x: e.clientX, y: e.clientY, moved: false, canvas: c };
      c.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (drag.moved || Math.hypot(dx, dy) > CLICK_SLOP_PX) {
          drag.moved = true;
          if (followingRef.current) follow(false); // a manual pan ends Follow
          camera.panBy(dx, dy);
          cameraTouched.current = true;
          drag.x = e.clientX;
          drag.y = e.clientY;
        }
        return;
      }
      if (compareViewRef.current) return; // no hover highlight while comparing
      const h = pick(...local(e));
      if (h !== hoveredRef.current) {
        hoveredRef.current = h;
        pushLinkState();
      }
    };
    const up = (e: PointerEvent) => {
      if (drag && !drag.moved) {
        const [x, y] = local(e);
        const v = pickVeh(x, y);
        const r = recordsRef.current;
        // a vehicle click tracks it (the road selection stays); otherwise a road click
        if (v !== null && r) client.current?.inspectVehicle(r.tick, v, ++inspectSeqRef.current);
        else select(pick(x, y), sideOf(e));
      }
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const [x, y] = local(e);
      camera.zoomAt(x, y, Math.pow(WHEEL_FACTOR_PER_100PX, -e.deltaY / 100));
      cameraTouched.current = true;
    };
    const canvases = canvasB ? [canvasA, canvasB] : [canvasA];
    for (const canvas of canvases) {
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('wheel', wheel, { passive: false });
    }
    return () => {
      for (const canvas of canvases) {
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('wheel', wheel);
      }
    };
  }, [camera, pushLinkState, select, follow, pickVehicleAt, compareView]);

  // Read-only hook for end-to-end tests.
  useEffect(() => {
    window.__livingcity = {
      snapshot: (): LivingCitySnapshot => {
        const f = frameRef.current;
        return {
          tick: f?.tick ?? 0,
          simTimeS: f?.simTimeS ?? 0,
          running: f?.clock.running ?? false,
          metrics: f?.metrics ?? {},
          closed: f?.closed ?? [],
          linkCounts: f ? Array.from(f.linkCounts) : [],
          landmarks: readyRef.current?.landmarks ?? null,
          city: readyRef.current?.city ?? null,
          selectedLink: selectedRef.current,
          renderFrames: renderFrames.current,
          trackedTrip: trackedRef.current?.tripId ?? null,
          trackedRoute: trackedRef.current ? Array.from(trackedRef.current.route) : [],
          trackedState: trackedRef.current?.state ?? null,
          following: followingRef.current,
          frameRecords: recordsRef.current?.vehicles.count ?? 0,
          camera: { cx: camera.cx, cy: camera.cy, zoom: camera.zoom },
          demandScale: DEMAND,
          scenario: viewedRef.current === 1 ? 'B' : 'A',
          timeline: f
            ? { ...f.timeline }
            : { windowStartTick: 0, headTick: 0, positionTick: 0, branchTick: -1, snapshotBytes: 0, budgetBytes: 0, compare: 0 },
          branchTick: f && f.timeline.branchTick >= 0 ? f.timeline.branchTick : null,
          compare: compareViewRef.current,
          sides:
            compareViewRef.current && f && bFrameRef.current
              ? { a: { tick: f.tick, closed: [...f.closed] }, b: { tick: bFrameRef.current.tick, closed: [...bFrameRef.current.closed] } }
              : null,
          drawnCameras: drawnCams.current ? { a: { ...drawnCams.current.a }, b: { ...drawnCams.current.b } } : null,
        };
      },
      comparison: () => {
        const m = comparisonRef.current;
        return m ? { tick: m.tick, fromTick: m.fromTick, a: Array.from(m.a), b: Array.from(m.b) } : null;
      },
      linkScreenPointB: (link: number, t: number) => {
        const l = geometry.current?.links[link];
        const canvas = canvasBRef.current;
        if (!l || !canvas || !compareViewRef.current) return null;
        const [sx, sy] = camera.worldToScreen(l.x0 + (l.x1 - l.x0) * t, l.y0 + (l.y1 - l.y0) * t);
        const r = canvas.getBoundingClientRect();
        return [r.left + sx, r.top + sy];
      },
      diagnostics: () => {
        const f = frameRef.current;
        return {
          perf: f?.perf ?? null,
          render: renderStats(),
          frameBytes: f?.frameBytes ?? 0,
          onNetwork: f?.metrics['on_network'] ?? 0,
          active: f?.metrics['active'] ?? 0,
          achievedTicksPerS: f?.clock.achievedTicksPerS ?? 0,
          targetTicksPerS: f?.clock.targetTicksPerS ?? 0,
          renderer: renderer.current?.rendererName() ?? 'none',
        };
      },
      frameVehicle: (record: number) => {
        const r = recordsRef.current;
        if (!r || !Number.isInteger(record) || record < 0 || record >= r.vehicles.count) return null;
        return { link: r.vehicles.link(record), s: r.vehicles.s(record), queued: (r.vehicles.flags(record) & FLAG_QUEUED) !== 0 };
      },
      startPerfRecording: () => {
        recordingRef.current = { ticks: [], renderIntervals: [], drawMs: [], onNetwork: [], active: [], waitingAtOrigin: [], frames: 0, startMs: performance.now() };
      },
      stopPerfRecording: (): PerfRecording => {
        const r = recordingRef.current ?? { ticks: [], renderIntervals: [], drawMs: [], onNetwork: [], active: [], waitingAtOrigin: [], frames: 0, startMs: performance.now() };
        recordingRef.current = null;
        const { startMs, ...rest } = r;
        return { ...rest, wallMs: performance.now() - startMs, timerResolutionMs: frameRef.current?.perf.timerResolutionMs ?? 0 };
      },
      linkScreenPoint: (link: number, t: number) => {
        // page coordinates even when off-screen (callers test the canvas themselves); null = unknown link
        const l = geometry.current?.links[link];
        const canvas = canvasRef.current;
        if (!l || !canvas) return null;
        const [sx, sy] = camera.worldToScreen(l.x0 + (l.x1 - l.x0) * t, l.y0 + (l.y1 - l.y0) * t);
        const r = canvas.getBoundingClientRect();
        return [r.left + sx, r.top + sy];
      },
      vehicleScreenCenter: (record: number) => {
        const r = recordsRef.current;
        const l = r && record >= 0 && record < r.vehicles.count ? geometry.current?.links[r.vehicles.link(record)] : undefined;
        if (!r || !l) return null;
        return toPage(...vehiclePosition(l, r.vehicles.s(record), r.vehicles.lane(record)));
      },
      trackedScreenCenter: () => {
        const at = renderer.current?.trackedWorldPosition(performance.now(), simPerMsRef.current);
        return at ? toPage(at[0], at[1]) : null;
      },
      setDebug: (opts: { hideVehicles?: boolean }) => {
        if (renderer.current && opts.hideVehicles !== undefined) renderer.current.hideVehicles = opts.hideVehicles;
      },
      linkCapacity: (link: number) => {
        const n = readyRef.current?.network;
        return n && link >= 0 && link < n.linkFrom.length ? linkCapacity(n.linkLanes[link]!, n.linkLength[link]!) : 0;
      },
      approachLinks: (link: number) => {
        const n = readyRef.current?.network;
        if (!n || link < 0 || link >= n.linkFrom.length) return [];
        const start = n.linkFrom[link]!;
        const out: number[] = [];
        for (let l = 0; l < n.linkFrom.length; l++) {
          if (n.linkTo[l] !== start) continue;
          if (n.linkFrom[l] === n.linkTo[link]) continue; // the reverse direction
          if (n.nodeIsZone[n.linkFrom[l]!]) continue; // zone connectors
          out.push(l);
        }
        return out;
      },
      pickAt: (x: number, y: number) => {
        const rb = compareViewRef.current ? canvasBRef.current?.getBoundingClientRect() : undefined;
        const onB = !!rb && x >= rb.left && x <= rb.right && y >= rb.top && y <= rb.bottom;
        const r = onB ? rb : canvasRef.current?.getBoundingClientRect();
        if (!r) return { vehicle: null, link: null, side: 'A' as const };
        const [lx, ly] = [x - r.left, y - r.top];
        const vehicle = pickVehicleAt(lx, ly);
        const link = vehicle === null && geometry.current ? pickLink(geometry.current.links, camera, lx, ly) : null;
        return { vehicle, link, side: onB ? ('B' as const) : ('A' as const) };
      },
      linkScreenCenter: (link: number) => {
        const l = geometry.current?.links[link];
        const canvas = canvasRef.current;
        if (!l || !canvas) return null;
        const [sx, sy] = camera.worldToScreen((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2);
        if (sx < 0 || sy < 0 || sx > camera.width || sy > camera.height) return null;
        const r = canvas.getBoundingClientRect();
        return [r.left + sx, r.top + sy];
      },
    };
    return () => {
      delete window.__livingcity;
    };
  }, [camera, pickVehicleAt, toPage]);

  const g = geometry.current;
  const sel = selected !== null && g ? g.links[selected] : undefined;
  /** The frame of the side the road was picked on (B's only while comparing). */
  const selFrame = selectedSide === 'B' && bFrameRef.current ? bFrameRef.current : frame;
  const focusSlider = focusTimeline;

  const scenarioPanels = (
    <>
        {frame && frame.timeline.branchTick >= 0 && (
          <ScenarioPanel
            scenario={viewedRef.current}
            branchTick={frame.timeline.branchTick}
            comparing={comparingNow}
            onCompare={(on) => {
              pendingSeekRef.current = null;
              setPendingSeek(null);
              forgetPosition();
              client.current?.compare(on);
            }}
            onView={(sc) => {
              pendingSeekRef.current = null;
              setPendingSeek(null);
              forgetPosition();
              client.current?.viewScenario(sc);
            }}
            onDiscard={() => {
              pendingSeekRef.current = null;
              setPendingSeek(null);
              forgetPosition();
              client.current?.discardBranch();
              // keep keyboard users in place: the discard button disappears
              document.querySelector<HTMLElement>('[role="slider"][aria-label="Timeline"]')?.focus();
            }}
          />
        )}
        {confirmReplace && (
          <ConfirmReplace
            onReplace={() => {
              const c = confirmRef.current;
              if (!c) return;
              setConfirmReplace(null);
              setMainPending(null);
              client.current?.branch(c.at, c.then); // the position the user intervened at
              c.onBranched?.();
              focusSlider();
            }}
            onCancel={() => {
              setConfirmReplace(null);
              focusSlider();
            }}
          />
        )}
    </>
  );

  return (
    <main className={`app${comparingNow ? ' comparing' : ''}`}>
      <h1 className="sr-only">Living City: traffic simulation</h1>
      <canvas ref={canvasRef} className="city" aria-label="City map" />
      {comparingNow && <canvas ref={canvasBRef} className="city city-b" aria-label="City map, branch B" />}
      {comparingNow && (
        <>
          <span className="side-label side-a">A: original</span>
          <span className="side-label side-b">B: branch</span>
        </>
      )}
      <div className="labels" aria-hidden="true">
        {labels.map((l, i) => (
          <span key={`${i}:${l.text}`} ref={(el) => {
            labelEls.current[i] = el;
            // the callback re-runs on every render; only a newly mounted element needs placing
            if (el && !labelPlaced.current.has(el)) {
              placeLabel(el, l);
              hideCutLabels([el]);
            }
          }} className={`zone ${l.kind}`}>
            <span className="zone-icon">{l.icon}</span> {l.text}
          </span>
        ))}
      </div>
      {comparingNow && (
        <div className="labels labels-b" aria-hidden="true">
          {labels.map((l, i) => (
            <span key={`b${i}:${l.text}`} ref={(el) => {
              labelElsB.current[i] = el;
              if (el && !labelPlaced.current.has(el)) {
              placeLabel(el, l);
              hideCutLabels([el]);
            }
            }} className={`zone ${l.kind}`}>
              <span className="zone-icon">{l.icon}</span> {l.text}
            </span>
          ))}
        </div>
      )}
      <div className="left-stack">
      <ControlPanel
        running={running}
        speed={speed}
        clock={frame?.clock ?? null}
        mainBridgeClosed={mainClosed}
        mainBridgePending={mainPending !== null}
        onToggleRunning={toggleRunning}
        onSpeed={changeSpeed}
        onToggleMainBridge={toggleMainBridge}
        disabled={noGl}
        {...(comparingNow ? { bridgeDisabledReason: NO_INTERVENTIONS_WHILE_COMPARING, bridgeStateHidden: true } : {})}
        diagnosticsOpen={diagOpen}
        onToggleDiagnostics={() => setDiagOpen((o) => !o)}
        demandScale={DEMAND}
      />
      {narrow && scenarioPanels}
      {diagOpen && (
        <DiagnosticsPanel
          comparing={comparingNow}
          perf={frame?.perf ?? null}
          render={renderStats()}
          onNetwork={frame?.metrics['on_network'] ?? 0}
          active={frame?.metrics['active'] ?? 0}
          frameBytes={frame?.frameBytes ?? 0}
          clock={frame?.clock ?? null}
        />
      )}
      </div>
      {!ready && !noGl && !error && (
        <p role="status" className="panel starting">
          Starting the city…
        </p>
      )}
      <div className="side">
        {sel && selFrame && ready && (
          <SelectionPanel
            link={sel}
            speedMps={ready.network.linkSpeed[sel.id]!}
            vehicles={selFrame.linkCounts[sel.id] ?? 0}
            queued={selFrame.linkQueued[sel.id] ?? 0}
            closed={selFrame.closed.includes(sel.id)}
            detail={!comparingNow && linkDetail && linkDetail.link === sel.id ? linkDetail : null}
            {...(comparingNow ? { side: selectedSide, actionsDisabled: NO_INTERVENTIONS_WHILE_COMPARING } : {})}
            onClose={() => intervene([{ kind: 'close', link: sel.id }])}
            onReopen={() => intervene([{ kind: 'open', link: sel.id }])}
          />
        )}
        {ready && (tracked || gone) && (
          <VehiclePanel
            vehicle={tracked}
            gone={gone}
            placeName={(node) => ready.zones.find((z) => z.node === node)?.name ?? `node ${node}`}
            lastTitle={lastTitleRef.current}
            following={following}
            onFollow={() => follow(true)}
            onStopFollowing={() => follow(false)}
            onDismiss={clearVehicle}
          />
        )}
      </div>
      {!comparingNow && <MetricsStrip simTimeS={frame?.simTimeS ?? 0} metrics={frame?.metrics ?? {}} />}
      {!comparingNow && <Legend />}
      {comparingNow && comparison && <ComparisonPanel comparison={comparison} />}
      {frame && <TimelineBar timeline={frame.timeline} position={pendingSeek ?? frame.timeline.positionTick} onSeek={requestSeek} />}
      <div className="center-stack">{!narrow && scenarioPanels}</div>
      {error && (
        <p role="alert" className="panel error">
          {error}
        </p>
      )}
    </main>
  );
}

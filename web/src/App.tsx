import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Camera } from './render/camera';
import { bridgeNaming, cityDecor, type CityDecor, type CityLabel } from './render/cities';
import { buildRoadGeometry, vehiclePosition, type RoadGeometry } from './render/geometry';
import { NO_NEXT } from './render/motion';
import { pickLink, pickPresentedVehicle, VEHICLE_PICK_MIN_ZOOM } from './render/picking';
import { clearances, PresentationClock, Presenter, stopLine, visualPose, type Clearances, type PresentFrame } from './render/presentation';
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
import { DiagnosticsPanel, type PresentationStats, type RenderStats } from './ui/DiagnosticsPanel';
import { MetricsStrip } from './ui/MetricsStrip';
import { SelectionPanel } from './ui/SelectionPanel';
import { Legend } from './ui/Legend';
import { nextStacked } from './ui/bottomBand';
import { ConfirmReplace, ScenarioPanel } from './ui/ScenarioPanel';
import { DemoGuide } from './ui/DemoGuide';
import { ConsequencesPanel } from './ui/ConsequencesPanel';
import { crossingRates, summarizeInterventions, topQueues, type BridgeNaming, type InterventionEntry } from './ui/consequences';
import { advanceGuide, guideHint, initialGuideProgress, type GuideProgress } from './ui/guideProgress';
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
  /** The command log as triples, and the bridge crossings (motion-003). */
  interventions: Float64Array;
  bridgeFlow: Float64Array;
}

type Intervention = { kind: 'close' | 'open'; link: number };

/** Where a queue pin may sit around its point: above, below, right, left (CSS transforms). */
const PIN_PLACES = ['translate(-50%, calc(-100% - 4px))', 'translate(-50%, 4px)', 'translate(4px, -50%)', 'translate(calc(-100% - 4px), -50%)'];

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

/** Remembered per viewer: the demo guide was hidden (ward polish-004). */
const GUIDE_HIDDEN_KEY = 'livingcity.guide.hidden';
function readGuideHidden(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_HIDDEN_KEY) === '1';
  } catch {
    return false; // storage unavailable: the guide shows on every visit
  }
}
function writeGuideHidden(hidden: boolean): void {
  try {
    window.localStorage.setItem(GUIDE_HIDDEN_KEY, hidden ? '1' : '0');
  } catch {
    // ignore: it just isn't remembered
  }
}

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
  const recordsRef = useRef<{ tick: number; vehicles: DecodedVehicles; next: Uint16Array } | null>(null);
  const trackedRef = useRef<TrackedVehicle | null>(null);
  /** Sequence number of the last vehicle request (pick or clear). Frames echo the last one the
   * worker handled; tracking from frames older than our last request is stale and ignored. */
  const inspectSeqRef = useRef(0);
  const followingRef = useRef(false);
  /** The user moved the camera (pan, zoom, Follow) since the last fit: a resize then keeps the view. */
  const cameraTouched = useRef(false);
  /** A fatal error (the simulation stopped): shown until the new world's first frame after "Restart simulation". */
  const [fatal, setFatal] = useState<string | null>(null);
  const fatalRef = useRef<string | null>(null);
  fatalRef.current = fatal;
  /** Restart clicked: the new worker is being made (the alert stays, its button waits). */
  const [restarting, setRestarting] = useState(false);
  /** Bumped by a restart: the client effect makes a new worker (and renderer). */
  const [generation, setGeneration] = useState(0);
  /** Demo guide: hidden by the viewer, and the steps done so far (from frames only). */
  const [guideHidden, setGuideHidden] = useState(readGuideHidden);
  const guideRef = useRef<GuideProgress>(initialGuideProgress());
  const [guide, setGuide] = useState<GuideProgress>(guideRef.current);
  const hideGuide = useCallback((hidden: boolean) => {
    setGuideHidden(hidden);
    writeGuideHidden(hidden);
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
  /** WebGL context creation and release are synchronous and wait for the GPU process: under load
   *  (SwiftShader, ?demand=5) each took 0.3–0.9 s on the main thread. So they stay off the switch's
   *  critical path (polish-006): a spare B renderer is made ahead of time on a detached canvas once a
   *  branch exists, and a left B renderer is released in a task after the first single-view draw. */
  const spareB = useRef<CityRenderer | null>(null);
  const releaseB = useRef<CityRenderer[]>([]);
  const housekeeping = useRef(false);
  /** The comparison as last drawn (the hook's `compare`): both sides drawn, or A alone. */
  const shownCompare = useRef(false);
  const decorRef = useRef<CityDecor | null>(null);
  /** The bridges' display names for this city (motion-003). */
  const namingRef = useRef<BridgeNaming | null>(null);
  /** B's latest frame view, and a copy of its records (replayed into a renderer created later). */
  const bFrameRef = useRef<FrameView | null>(null);
  const bRecordsRef = useRef<{ words: Uint32Array; count: number } | null>(null);
  /** Where cars are drawn (ward motion-002): A's and B's presenters share one presentation clock, so
   *  both sides show the same sim time while comparing; B's leaves the clock outside the comparison. */
  const presentRef = useRef<{ C: Clearances; a: Presenter; b: Presenter } | null>(null);
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
  const diagOpenRef = useRef(false);
  diagOpenRef.current = diagOpen;
  /** Re-renders the Diagnostics panel when the render stats refresh: while paused no worker frame
   *  arrives to do it (motion-001), and the panel must keep showing the live render numbers. */
  const [, setRenderStatsVersion] = useState(0);
  /** Frames received from the worker (both sides): the test hook's `framesReceived`. */
  const framesReceived = useRef(0);
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
  /** Presentation latency (motion-002): the sim time each side last drew with, and how far A's trails
   *  its newest frame, in sim s and in wall ms at the current rate (0 while paused). */
  const presentationStats = (): PresentationStats => {
    const P = presentRef.current;
    const lagS = P?.a.lagS() ?? 0;
    const rate = simPerMsRef.current;
    return {
      tickA: P ? P.a.time() / DT : 0,
      tickB: P && rendererB.current ? P.b.time() / DT : null,
      lagS,
      lagMs: rate > 0 ? lagS / rate : 0,
    };
  };

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
  const placeLabel = (el: HTMLElement, l: { x: number; y: number }) => {
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
  /** Map marks of motion-003 (bridge names, queue pins) by key: placed every animation frame, hidden when cut. */
  const marks = useRef(new Map<string, { el: HTMLElement; x: number; y: number }>());
  const markRef = (key: string, x: number, y: number) => (el: HTMLElement | null) => {
    if (!el) {
      marks.current.delete(key);
      return;
    }
    marks.current.set(key, { el, x, y });
    placeLabel(el, { x, y });
  };
  /**
   * Queue pins step aside from the labels (district names, bridge names, other pins) of their layer: the
   * first of four places around the pin's point that overlaps none (motion-003 Gold r1). The point itself,
   * and so the hooks, stay where the queue is.
   */
  const clearPins = () => {
    for (const layer of document.querySelectorAll<HTMLElement>('.labels')) {
      const shown = (e: HTMLElement) => e.style.visibility !== 'hidden';
      const taken = [...layer.querySelectorAll<HTMLElement>('.zone, .bridge-label')].filter(shown).map((e) => e.getBoundingClientRect());
      for (const pin of layer.querySelectorAll<HTMLElement>('.queue-pin')) {
        let chosen = PIN_PLACES[0]!;
        for (const place of PIN_PLACES) {
          pin.style.transform = place;
          const r = pin.getBoundingClientRect();
          if (!taken.some((t) => r.left < t.right && t.left < r.right && r.top < t.bottom && t.top < r.bottom)) {
            chosen = place;
            break;
          }
        }
        pin.style.transform = chosen;
        if (shown(pin)) taken.push(pin.getBoundingClientRect());
      }
    }
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

  /** A B renderer on a new detached canvas, with the network set and its backing store sized for
   *  B's half of the window (null when WebGL2 fails). */
  const makeBRenderer = (g: RoadGeometry, d: CityDecor): CityRenderer | null => {
    const cv = document.createElement('canvas');
    cv.className = 'city city-b';
    cv.setAttribute('aria-label', 'City map, branch B');
    try {
      const r = new CityRenderer(cv);
      r.setNetwork(g, d);
      const app = appBox();
      if (app) r.resize(app.width / 2, app.height, window.devicePixelRatio || 1);
      return r;
    } catch {
      return null;
    }
  };
  /** A's backing store is sized for the whole app area, also while A's canvas shows only the left
   *  half: resizing a WebGL drawing buffer waits for the GPU process (~0.3 s under load), so the
   *  compare switch never resizes it (A is drawn 2× wide-sampled while comparing). */
  const appBox = () => canvasRef.current?.parentElement?.getBoundingClientRect() ?? null;
  const release = (r: CityRenderer) => {
    r.dispose();
    r.loseContext();
  };
  /** After a draw: release left B renderers, then (a separate task, so input can come first) make a
   *  spare while a branch exists and B is not shown; drop the spare when there is no branch. */
  const scheduleHousekeeping = () => {
    if (housekeeping.current) return;
    const branched = (frameRef.current?.timeline.branchTick ?? -1) >= 0;
    const wantSpare = branched && !spareB.current && !compareViewRef.current && fatalRef.current === null;
    const dropSpare = !branched && spareB.current !== null;
    if (!releaseB.current.length && !wantSpare && !dropSpare) return;
    housekeeping.current = true;
    setTimeout(() => {
      for (const r of releaseB.current.splice(0)) release(r);
      if (!(frameRef.current && (frameRef.current.timeline.branchTick ?? -1) >= 0) && spareB.current) {
        release(spareB.current);
        spareB.current = null;
      }
      setTimeout(() => {
        housekeeping.current = false;
        const f = frameRef.current;
        const g = geometry.current;
        const d = decorRef.current;
        if (f && f.timeline.branchTick >= 0 && !spareB.current && !compareViewRef.current && fatalRef.current === null && g && d) {
          spareB.current = makeBRenderer(g, d);
        }
      }, 0);
    }, 0);
  };

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
    c.onError((m, isFatal) => {
      if (isFatal) {
        setFatal(m);
        return;
      }
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
      namingRef.current = bridgeNaming(r.city, r.landmarks);
      const C = clearances(g.links, r.network.linkFrom, r.network.linkTo);
      const clock = new PresentationClock();
      presentRef.current = {
        C,
        a: new Presenter(g.links, r.network.linkFrom, r.network.linkTo, clock, C),
        b: new Presenter(g.links, r.network.linkFrom, r.network.linkTo, clock, C),
      };
      renderer.current!.setPresenter(presentRef.current.a);
      camera.fitInsets(g.bounds, FIT_INSETS);
      cameraTouched.current = false;
      setReady(r);
      c.setSpeed(speedRef.current);
      c.setRunning(true);
    });
    /** The frame as the presenter needs it (it copies what it keeps: the buffer may go back afterwards). */
    const presentFrame = (f: FrameMessage): PresentFrame => ({
      tick: f.tick,
      scenario: f.scenario,
      world: f.world,
      epoch: f.epoch,
      compare: f.timeline.compare === 1,
      vehicles: decodeVehicles(f.vehicles, f.count),
      tripIds: f.tripIds,
    });
    /** B's half of a pair: its renderer (if already created) and its view. */
    const applyFrameB = (f: FrameMessage) => {
      const words = new Uint32Array(f.vehicles);
      bRecordsRef.current = { words: words.slice(0, f.count * 4), count: f.count };
      rendererB.current?.setFrame(words, f.count);
      presentRef.current?.b.push(presentFrame(f), performance.now(), f.clock);
      c.returnBuffer(f.vehicles, f.scenario);
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
        frameBytes: f.vehicles.byteLength + f.nextLinks.byteLength + f.tripIds.byteLength,
        scenario: f.scenario,
        timeline: f.timeline,
        interventions: f.interventions,
        bridgeFlow: f.bridgeFlow,
      };
    };
    c.onFrame((f: FrameMessage) => {
      framesReceived.current++;
      if (f.timeline.compare === 1) {
        // a pair: hold A until its B partner arrives, then apply and draw both together
        if (f.scenario === 0) {
          if (pendingPairA.current) c.returnBuffer(pendingPairA.current.vehicles, pendingPairA.current.scenario);
          pendingPairA.current = f;
          return;
        }
        const a = pendingPairA.current;
        pendingPairA.current = null;
        if (!a || a.tick !== f.tick) {
          if (a) c.returnBuffer(a.vehicles, a.scenario);
          c.returnBuffer(f.vehicles, f.scenario);
          return;
        }
        applyFrameB(f);
        applyFrame(a);
        return;
      }
      if (pendingPairA.current) {
        c.returnBuffer(pendingPairA.current.vehicles, pendingPairA.current.scenario);
        pendingPairA.current = null;
      }
      bFrameRef.current = null;
      bRecordsRef.current = null;
      presentRef.current?.b.release(); // outside the comparison B does not hold the shared clock
      comparisonRef.current = null;
      viewedRef.current = f.scenario;
      applyFrame(f);
    });
    function applyFrame(f: FrameMessage) {
      if (fatalRef.current !== null) {
        // the new world shows its first frame: the stopped one's alert can go now (k3)
        fatalRef.current = null;
        setFatal(null);
        setRestarting(false);
      }
      const g = advanceGuide(guideRef.current, f, readyRef.current?.landmarks.central_bridge ?? []);
      if (g !== guideRef.current) {
        guideRef.current = g;
        setGuide(g);
      }
      renderer.current?.setFrame(new Uint32Array(f.vehicles), f.count);
      presentRef.current?.a.push(presentFrame(f), performance.now(), f.clock);
      // keep a copy for the hooks before the buffer goes back to the worker
      recordsRef.current = { tick: f.tick, vehicles: decodeVehicles(f.vehicles.slice(0), f.count), next: f.nextLinks };
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
      const frameBytes = f.vehicles.byteLength + f.nextLinks.byteLength + f.tripIds.byteLength; // records + next links + trip ids
      c.returnBuffer(f.vehicles, f.scenario); // uploaded: give the buffer back to its side's pool
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
        interventions: f.interventions,
        bridgeFlow: f.bridgeFlow,
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
      // a new world has a new network: no B renderer of the old one is kept
      for (const r of releaseB.current.splice(0)) release(r);
      if (spareB.current) release(spareB.current);
      spareB.current = null;
    };
  }, [camera, pushLinkState, generation]);

  const comparingNow = frame?.timeline.compare === 1;

  // The bottom band (fonts-001): the legend sits beside the metrics only when they fit, measured from
  // the panels (re-checked on any size change of either, a window resize, and once the fonts load).
  const [legendStacked, setLegendStacked] = useState(false);
  useLayoutEffect(() => {
    if (comparingNow) return;
    const legend = document.querySelector<HTMLElement>('section.panel.legend');
    const metrics = document.querySelector<HTMLElement>('section.panel.metrics');
    if (!legend || !metrics) return;
    let live = true;
    const check = () => {
      if (!live) return;
      const gap = legend.getBoundingClientRect().left - metrics.getBoundingClientRect().right;
      setLegendStacked((s) => nextStacked(s, gap));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(legend);
    ro.observe(metrics);
    window.addEventListener('resize', check);
    void document.fonts?.ready.then(check);
    return () => {
      live = false;
      ro.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [comparingNow]);
  useLayoutEffect(() => {
    if (comparingNow === compareViewRef.current) return;
    const g = geometry.current;
    const d = decorRef.current;
    if (!g || !d) return;
    if (comparingNow) {
      const rb = spareB.current ?? makeBRenderer(g, d);
      spareB.current = null;
      if (!rb) return;
      // B's canvas sits right after A's (both absolutely placed; the order only stacks them)
      canvasRef.current!.after(rb.element);
      canvasBRef.current = rb.element;
      rendererB.current = rb;
      const b = bRecordsRef.current;
      if (b) rb.setFrame(b.words, b.count);
      rb.setPresenter(presentRef.current?.b ?? null);
    } else {
      const rb = rendererB.current;
      rendererB.current = null;
      canvasBRef.current = null;
      if (rb) {
        rb.element.remove();
        rb.dispose();
        // its context is released after the next draw (never left for the browser to reclaim: it
        // would drop the oldest, A's)
        releaseB.current.push(rb);
      }
      setComparison(null);
    }
    const r = canvasRef.current!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    camera.setViewport(r.width, r.height);
    const app = appBox() ?? r;
    renderer.current?.resize(app.width, app.height, dpr); // unchanged by the switch: no reallocation
    rendererB.current?.resize(r.width, r.height, dpr); // a spare is already this size
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
      const app = canvas.parentElement?.getBoundingClientRect() ?? r;
      renderer.current?.resize(app.width, app.height, window.devicePixelRatio || 1);
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
      // never faster than the requested speed: "behind" means slower, and right after Play the 1-s achieved
      // window still holds the previous speed's ticks (the clock keeps an overshoot until the next tick)
      const simPerMs =
        f && f.clock.running ? Math.min(f.clock.behind ? f.clock.achievedTicksPerS * DT : f.clock.multiplier, f.clock.multiplier) / 1000 : 0;
      simPerMsRef.current = simPerMs;
      const d0 = performance.now();
      // one presentation time for the picture (shared by A and B while comparing), then Follow and the
      // ring read the same presented state
      renderer.current?.advance(now);
      rendererB.current?.advance(now);
      if (followingRef.current) {
        const at = renderer.current?.trackedWorldPosition();
        if (at) [camera.cx, camera.cy] = at;
      }
      renderer.current?.draw(camera);
      const camA = { cx: camera.cx, cy: camera.cy, zoom: camera.zoom };
      if (rendererB.current) {
        rendererB.current.draw(camera);
        drawnCams.current = { a: camA, b: { cx: camera.cx, cy: camera.cy, zoom: camera.zoom } };
      } else drawnCams.current = null;
      shownCompare.current = compareViewRef.current && rendererB.current !== null;
      const drawMs = performance.now() - d0;
      drawTimes.current.add(drawMs);
      recordingRef.current?.drawMs.push(drawMs);
      if (now - renderStatsRef.current.at >= RENDER_STATS_REFRESH_MS) {
        renderStatsRef.current = { at: now, stats: computeRenderStats() };
        if (diagOpenRef.current) setRenderStatsVersion((v) => v + 1);
      }
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
      if (marks.current.size) {
        const els: HTMLElement[] = [];
        for (const m of marks.current.values()) {
          placeLabel(m.el, m);
          els.push(m.el);
        }
        clearPins();
        hideCutLabels(els);
      }
      renderFrames.current++;
      scheduleHousekeeping();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [camera]);

  /** A new world (k2): nothing of the dead one carries over: inspection, Follow, a pending seek or
   *  confirmation, the held pair, the comparison, guide progress. The alert stays until the first frame (k3). */
  const restart = useCallback(() => {
    setRestarting(true);
    setError(null);
    selectedRef.current = null;
    selectedSideRef.current = 'A';
    hoveredRef.current = null;
    setSelected(null);
    setSelectedSide('A');
    setLinkDetail(null);
    trackedRef.current = null;
    setTracked(null);
    setGone(null);
    followingRef.current = false;
    setFollowing(false);
    pendingSeekRef.current = null;
    setPendingSeek(null);
    setConfirmReplace(null);
    setMainPending(null);
    pendingPairA.current = null;
    bFrameRef.current = null;
    bRecordsRef.current = null;
    comparisonRef.current = null;
    setComparison(null);
    viewedRef.current = 0;
    guideRef.current = initialGuideProgress();
    setGuide(guideRef.current);
    setReady(null);
    setFrame(null);
    setGeneration((g) => g + 1);
  }, []);

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
      setError(null); // a new request: a refusal shown for an earlier one is stale
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
      setError(null);
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
      const p = presentRef.current?.a;
      if (!p || !recordsRef.current || camera.zoom < VEHICLE_PICK_MIN_ZOOM || compareViewRef.current) return null;
      return pickPresentedVehicle(p.vehicles(), camera, x, y, 8);
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
        if (inPanel('section.guide')) {
          // Esc in the demo guide hides it; focus goes to the Guide button that shows it again
          hideGuide(true);
          document.querySelector<HTMLElement>('button.guide-toggle')?.focus();
        } else if (confirmRef.current) {
          // closes from anywhere; only focus inside the panel (which goes away) moves to the slider (g1)
          if (inPanel('section.confirm')) focusTimeline();
          setConfirmReplace(null);
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
  }, [toggleRunning, toggleMainBridge, changeSpeed, select, clearVehicle, speed, hideGuide]);

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
        // a reader that sees the single view never then finds B's old context still alive: pending
        // releases settle right after this call (a microtask, so a caller's own timing is unaffected)
        if (releaseB.current.length) queueMicrotask(() => releaseB.current.splice(0).forEach(release));
        return {
          tick: f?.tick ?? 0,
          simTimeS: f?.simTimeS ?? 0,
          running: f?.clock.running ?? false,
          metrics: f?.metrics ?? {},
          closed: f?.closed ?? [],
          linkCounts: f ? Array.from(f.linkCounts) : [],
          linkQueued: f ? Array.from(f.linkQueued) : [],
          landmarks: readyRef.current?.landmarks ?? null,
          city: readyRef.current?.city ?? null,
          selectedLink: selectedRef.current,
          renderFrames: renderFrames.current,
          framesReceived: framesReceived.current,
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
          compare: compareViewRef.current && shownCompare.current,
          sides:
            compareViewRef.current && f && bFrameRef.current
              ? { a: { tick: f.tick, closed: [...f.closed] }, b: { tick: bFrameRef.current.tick, closed: [...bFrameRef.current.closed] } }
              : null,
          drawnCameras: drawnCams.current ? { a: { ...drawnCams.current.a }, b: { ...drawnCams.current.b } } : null,
        };
      },
      comparison: () => {
        const m = comparisonRef.current;
        if (!m) return null;
        const x = m.crossings;
        return { tick: m.tick, fromTick: m.fromTick, a: Array.from(m.a), b: Array.from(m.b), crossings: x ? { a: Array.from(x.a), b: Array.from(x.b), baseTick: x.baseTick } : null };
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
          presentation: presentationStats(),
        };
      },
      frameVehicle: (record: number) => {
        const r = recordsRef.current;
        if (!r || !Number.isInteger(record) || record < 0 || record >= r.vehicles.count) return null;
        const v = r.vehicles;
        return { link: v.link(record), s: v.s(record), queued: (v.flags(record) & FLAG_QUEUED) !== 0, lane: v.lane(record), next: r.next[record] ?? NO_NEXT };
      },
      interventions: () => {
        const f = frameRef.current;
        const n = namingRef.current;
        return f && n ? summarizeInterventions(f.interventions, f.tick, n) : [];
      },
      crossings: () => {
        const f = frameRef.current;
        const n = namingRef.current;
        return f && n && summarizeInterventions(f.interventions, f.tick, n).length ? crossingRates(f.bridgeFlow, n) : [];
      },
      queuePins: () => {
        const f = frameRef.current;
        const g = geometry.current;
        const canvas = canvasRef.current;
        if (!f || !g || !canvas) return [];
        const r = canvas.getBoundingClientRect();
        return topQueues(f.linkQueued).map(({ link, queued }) => {
          const l = g.links[link]!;
          const [sx, sy] = camera.worldToScreen(l.x1, l.y1);
          return { link, queued, page: [r.left + sx, r.top + sy] as [number, number] };
        });
      },
      bridgeLabels: () =>
        [...document.querySelectorAll<HTMLElement>('.labels:not(.labels-b) .bridge-label')].map((el) => {
          const b = el.getBoundingClientRect();
          return { name: el.textContent ?? '', page: [b.left + b.width / 2, b.top + b.height / 2] as [number, number], shown: el.style.visibility !== 'hidden' };
        }),
      linkInfo: (link: number) => {
        const l = geometry.current?.links[link];
        return l ? { length: l.length, lanes: l.lanes } : null;
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
        // where the record is drawn now (as presented: interpolated by trip, junction curve included)
        const v = renderer.current?.presented(record);
        return v ? toPage(v.pose.x, v.pose.y) : null;
      },
      vehicleDraw: (record: number) => {
        const g = geometry.current;
        const P = presentRef.current;
        const canvas = canvasRef.current;
        const v = renderer.current?.presented(record);
        const l = v ? g?.links[v.link] : undefined;
        if (!v || !l || !P || !canvas) return null;
        const { link, s, lane, next, pose } = v;
        const stop = stopLine(l, P.C);
        const straight = vehiclePosition(l, Math.min(s, l.length), Math.min(lane, l.lanes - 1));
        const rect = canvas.getBoundingClientRect();
        const page = (x: number, y: number): [number, number] => {
          const [sx, sy] = camera.worldToScreen(x, y);
          return [rect.left + sx, rect.top + sy];
        };
        return {
          link,
          s,
          lane,
          next,
          inBlend: next !== NO_NEXT && s > stop,
          world: [pose.x, pose.y] as [number, number],
          page: page(pose.x, pose.y),
          straightPage: page(...straight),
          length: l.length,
          stop,
        };
      },
      trackedDraw: () => {
        const d = renderer.current?.trackedDraw();
        const canvas = canvasRef.current;
        if (!d || !canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const [sx, sy] = camera.worldToScreen(d.world[0], d.world[1]);
        return { ...d, page: [rect.left + sx, rect.top + sy] as [number, number] };
      },
      debugTrap: () => client.current?.debugTrap(),
      drawAt: (link: number, s: number, lane: number, next: number) => {
        const g = geometry.current;
        const P = presentRef.current;
        if (!g || !P || !g.links[link]) return [NaN, NaN] as [number, number];
        const p = visualPose(g.links, P.C, link, s, lane, next);
        return [p.x, p.y] as [number, number];
      },
      trackedScreenCenter: () => {
        const at = renderer.current?.trackedWorldPosition();
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
  // consequences of an intervention (motion-003): from the viewed frame's command log and bridge crossings
  const naming = namingRef.current;
  const shownEntries = frame && naming ? summarizeInterventions(frame.interventions, frame.tick, naming) : [];
  /** The summary shows in the single view while no road or vehicle detail is open (the column keeps its
   *  pre-motion-003 layout then; Esc brings the summary back). */
  const showSummary = !comparingNow && shownEntries.length > 0 && !sel && !tracked && !gone;
  const allEntries = ((): (InterventionEntry & { side?: 'A' | 'B' })[] => {
    if (!frame || !naming) return [];
    const own = summarizeInterventions(frame.interventions, Infinity, naming);
    const fb = bFrameRef.current;
    if (!comparingNow || !fb) return own;
    // comparing: the shared history before the branch unlabelled, then A's and B's own interventions
    const at = frame.timeline.branchTick;
    const b = summarizeInterventions(fb.interventions, Infinity, naming).filter((e) => e.tick >= at);
    return [...own.map((e) => (e.tick >= at ? { ...e, side: 'A' as const } : e)), ...b.map((e) => ({ ...e, side: 'B' as const }))];
  })();
  const closureTick = frame && Number.isFinite(frame.bridgeFlow[15]) ? frame.bridgeFlow[15]! : null;
  /** Bridge names and queue pins on one label layer (A's or B's), from that side's frame. */
  const mapMarks = (side: 'a' | 'b', f: FrameView | null) => {
    if (!g || !naming) return null;
    return (
      <>
        {naming.bridges.map((b) => {
          const [p, q] = [g.links[b.links[0]], g.links[b.links[1]]];
          if (!p || !q) return null;
          const x = (p.x0 + p.x1 + q.x0 + q.x1) / 4;
          const y = (p.y0 + p.y1 + q.y0 + q.y1) / 4;
          return (
            <span key={`${side}:bridge:${b.key}`} ref={markRef(`${side}:bridge:${b.key}`, x, y)} className="bridge-label">
              {b.name}
            </span>
          );
        })}
        {f &&
          topQueues(f.linkQueued).map(({ link, queued }) => {
            const l = g.links[link]!;
            return (
              <span key={`${side}:pin:${link}`} ref={markRef(`${side}:pin:${link}`, l.x1, l.y1)} className="queue-pin" title={`Link ${link}: ${queued} queued`}>
                ▼ {queued}
              </span>
            );
          })}
      </>
    );
  };
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
            setError(null);
              pendingSeekRef.current = null;
              setPendingSeek(null);
              forgetPosition();
              client.current?.compare(on);
            }}
            onView={(sc) => {
            setError(null);
              pendingSeekRef.current = null;
              setPendingSeek(null);
              forgetPosition();
              client.current?.viewScenario(sc);
            }}
            onDiscard={() => {
            setError(null);
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
        {mapMarks('a', frame)}
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
          {mapMarks('b', bFrameRef.current)}
        </div>
      )}
      {fatal && (
        <div role="alert" className="panel error fatal">
          <span>The simulation stopped: {fatal}</span>
          <button type="button" onClick={restart} disabled={restarting}>
            {restarting ? 'Restarting…' : 'Restart simulation'}
          </button>
        </div>
      )}
      {/* Top band (ward polish-002): one grid in a fixed DOM order; CSS alone places the panels in a
          left and a centre column (or one column when narrow), so nothing remounts on a resize. */}
      <div className="top-band">
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
        guideShown={!guideHidden && !comparingNow}
        onToggleGuide={() => hideGuide(!guideHidden)}
        {...(comparingNow ? { guideDisabledReason: 'The demo guide steps aside while comparing' } : {})}
        {...(fatal !== null ? { haltedReason: 'The simulation stopped: restart it to continue' } : {})}
      />
      {scenarioPanels}
      {error && (
        <div role="alert" className="panel error">
          <span>{error}</span>
          {!noGl && (
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}
      {diagOpen && (
        <DiagnosticsPanel
          comparing={comparingNow}
          perf={frame?.perf ?? null}
          render={renderStats()}
          onNetwork={frame?.metrics['on_network'] ?? 0}
          active={frame?.metrics['active'] ?? 0}
          frameBytes={frame?.frameBytes ?? 0}
          clock={frame?.clock ?? null}
          presentation={presentationStats()}
        />
      )}
      </div>
      {!ready && !noGl && !error && (
        <p role="status" className="panel starting">
          Starting the city…
        </p>
      )}
      <div className="side">
        {/* the guide's band (≤ 100 px, above the roads) stays reserved while the intervention summary is shown,
            so hiding or showing the guide never moves the panels below it onto other roads (motion-003) */}
        {(() => {
          const showGuide = !!(ready && frame && !guideHidden && !comparingNow);
          const reserve = showSummary;
          if (!showGuide && !reserve) return null;
          return (
            <div className={reserve ? 'guide-slot reserved' : 'guide-slot'}>
              {showGuide && <DemoGuide done={guide.done} hint={guideHint(guide, speed)} onHide={() => hideGuide(true)} />}
            </div>
          );
        })()}
        {showSummary && frame && naming && (
          <ConsequencesPanel
            entries={shownEntries}
            rates={crossingRates(frame.bridgeFlow, naming)}
            closureTick={closureTick}
            queues={topQueues(frame.linkQueued)}
            onSelectLink={(link) => select(link)}
          />
        )}
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
      {!comparingNow && <Legend stacked={legendStacked} />}
      {comparingNow && comparison && <ComparisonPanel comparison={comparison} bridgeNames={naming?.bridges.map((b) => b.name) ?? []} />}
      {frame && <TimelineBar timeline={frame.timeline} position={pendingSeek ?? frame.timeline.positionTick} onSeek={requestSeek} interventions={allEntries} />}
    </main>
  );
}

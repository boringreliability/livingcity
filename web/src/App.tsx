import { useCallback, useEffect, useRef, useState } from 'react';

import { Camera } from './render/camera';
import { cityDecor, type CityLabel } from './render/cities';
import { buildRoadGeometry, vehiclePosition, type RoadGeometry } from './render/geometry';
import { pickLink, pickVehicle, VEHICLE_PICK_MIN_ZOOM } from './render/picking';
import { FIT_INSETS } from './render/layout';
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
  type FrameMessage,
  type PerfStats,
  type LinkDetail,
  type ReadyMessage,
  type TrackedGone,
  type TrackedVehicle,
} from './sim/protocol';
import { ControlPanel, SPEEDS } from './ui/ControlPanel';
import { DiagnosticsPanel, type RenderStats } from './ui/DiagnosticsPanel';
import { MetricsStrip } from './ui/MetricsStrip';
import { SelectionPanel } from './ui/SelectionPanel';
import { Legend } from './ui/Legend';
import { VehiclePanel } from './ui/VehiclePanel';
import type { LivingCitySnapshot, PerfRecording } from './ui/testHook';
import './styles.css';

const DEFAULT_SPEED = 20;
/** The diagnostics panel's render numbers refresh at this period (ms). */
const RENDER_STATS_REFRESH_MS = 500;
/** Wheel zoom: factor per 100 px of wheel delta (one notch ≈ 16 %). */
const WHEEL_FACTOR_PER_100PX = 1.16;
const CLICK_SLOP_PX = 4;

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
}

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
  /** Sim seconds per wall ms of the last drawn picture (0 while paused). */
  const simPerMsRef = useRef(0);
  /** Render-side measurement (C5): rAF intervals and draw CPU time over the last 300 frames. */
  // lazily created once (useRef(new …) would build and discard windows on every render)
  const [renderIntervals] = useState(() => ({ current: new SampleWindow(RENDER_WINDOW) }));
  const [drawTimes] = useState(() => ({ current: new SampleWindow(RENDER_WINDOW) }));
  const recordingRef = useRef<Recording | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
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
    if (renderer.current && f) renderer.current.setLinkState(f.closed, selectedRef.current, hoveredRef.current, f.linkCounts);
  }, []);

  const select = useCallback(
    (link: number | null) => {
      selectedRef.current = link;
      setSelected(link);
      setLinkDetail(null);
      client.current?.inspectLink(link);
      pushLinkState();
    },
    [pushLinkState],
  );

  const follow = useCallback((on: boolean) => {
    followingRef.current = on;
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
    client.current = c;
    c.onError(setError);
    c.onReady((r) => {
      readyRef.current = r;
      const g = buildRoadGeometry(r.network);
      geometry.current = g;
      const decor = cityDecor(r, g);
      labelsRef.current = decor.labels;
      setLabels(decor.labels);
      renderer.current!.setNetwork(g, decor);
      camera.fitInsets(g.bounds, FIT_INSETS);
      setReady(r);
      c.setSpeed(speedRef.current);
      c.setRunning(true);
    });
    c.onFrame((f: FrameMessage) => {
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
      };
      frameRef.current = view;
      pushLinkState();
      setFrame(view);
    });
    return () => {
      c.dispose();
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [camera, pushLinkState]);

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
      const drawMs = performance.now() - d0;
      drawTimes.current.add(drawMs);
      recordingRef.current?.drawMs.push(drawMs);
      if (now - renderStatsRef.current.at >= RENDER_STATS_REFRESH_MS) renderStatsRef.current = { at: now, stats: computeRenderStats() };
      const cam = labelCam.current;
      const moved =
        cam.labels !== labelsRef.current || cam.cx !== camera.cx || cam.cy !== camera.cy || cam.zoom !== camera.zoom || cam.w !== camera.width || cam.h !== camera.height;
      if (moved) Object.assign(cam, { labels: labelsRef.current, cx: camera.cx, cy: camera.cy, zoom: camera.zoom, w: camera.width, h: camera.height, gen: cam.gen + 1 });
      labelsRef.current.forEach((l, i) => {
        const el = labelEls.current[i];
        if (el && labelPlaced.current.get(el) !== cam.gen) placeLabel(el, l);
      });
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
  const toggleMainBridge = useCallback(() => {
    const r = readyRef.current;
    const f = frameRef.current;
    if (!r || !client.current) return;
    const links = r.landmarks.central_bridge;
    const closedNow = mainPending ?? !!(f && links.every((l) => f.closed.includes(l)));
    for (const l of links) (closedNow ? client.current.openLink(l) : client.current.closeLink(l));
    setMainPending(!closedNow);
  }, [mainPending]);

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
      if (!r || !g || camera.zoom < VEHICLE_PICK_MIN_ZOOM) return null;
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
        // first the vehicle, then the road
        if (trackedRef.current || goneRef.current) clearVehicle();
        else select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRunning, toggleMainBridge, changeSpeed, select, clearVehicle, speed]);

  // Pointer: drag pans, click selects, hover highlights, wheel zooms about the cursor.
  useEffect(() => {
    const canvas = canvasRef.current!;
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const local = (e: MouseEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const pick = (x: number, y: number) => (geometry.current ? pickLink(geometry.current.links, camera, x, y) : null);
    const pickVeh = (x: number, y: number) => pickVehicleAt(x, y);
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (drag.moved || Math.hypot(dx, dy) > CLICK_SLOP_PX) {
          drag.moved = true;
          if (followingRef.current) follow(false); // a manual pan ends Follow
          camera.panBy(dx, dy);
          drag.x = e.clientX;
          drag.y = e.clientY;
        }
        return;
      }
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
        else select(pick(x, y));
      }
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const [x, y] = local(e);
      camera.zoomAt(x, y, Math.pow(WHEEL_FACTOR_PER_100PX, -e.deltaY / 100));
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [camera, pushLinkState, select, follow, pickVehicleAt]);

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
        };
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
        const r = canvasRef.current?.getBoundingClientRect();
        if (!r) return { vehicle: null, link: null };
        const [lx, ly] = [x - r.left, y - r.top];
        const vehicle = pickVehicleAt(lx, ly);
        const link = vehicle === null && geometry.current ? pickLink(geometry.current.links, camera, lx, ly) : null;
        return { vehicle, link };
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

  return (
    <main className="app">
      <canvas ref={canvasRef} className="city" aria-label="City map" />
      <div className="labels" aria-hidden="true">
        {labels.map((l, i) => (
          <span key={`${i}:${l.text}`} ref={(el) => {
            labelEls.current[i] = el;
            // the callback re-runs on every render; only a newly mounted element needs placing
            if (el && !labelPlaced.current.has(el)) placeLabel(el, l);
          }} className={`zone ${l.kind}`}>
            <span className="zone-icon">{l.icon}</span> {l.text}
          </span>
        ))}
      </div>
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
        diagnosticsOpen={diagOpen}
        onToggleDiagnostics={() => setDiagOpen((o) => !o)}
        demandScale={DEMAND}
      />
      {diagOpen && (
        <DiagnosticsPanel
          perf={frame?.perf ?? null}
          render={renderStats()}
          onNetwork={frame?.metrics['on_network'] ?? 0}
          active={frame?.metrics['active'] ?? 0}
          frameBytes={frame?.frameBytes ?? 0}
          clock={frame?.clock ?? null}
        />
      )}
      {!ready && !noGl && !error && (
        <p role="status" className="panel starting">
          Starting the city…
        </p>
      )}
      <div className="side">
        {sel && frame && ready && (
          <SelectionPanel
            link={sel}
            speedMps={ready.network.linkSpeed[sel.id]!}
            vehicles={frame.linkCounts[sel.id] ?? 0}
            queued={frame.linkQueued[sel.id] ?? 0}
            closed={frame.closed.includes(sel.id)}
            detail={linkDetail && linkDetail.link === sel.id ? linkDetail : null}
            onClose={() => client.current?.closeLink(sel.id)}
            onReopen={() => client.current?.openLink(sel.id)}
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
      <MetricsStrip simTimeS={frame?.simTimeS ?? 0} metrics={frame?.metrics ?? {}} />
      <Legend />
      {error && (
        <p role="alert" className="panel error">
          {error}
        </p>
      )}
    </main>
  );
}

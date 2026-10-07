import { useCallback, useEffect, useRef, useState } from 'react';

import { Camera } from './render/camera';
import { riverDecor } from './render/decor';
import { buildRoadGeometry, type RoadGeometry } from './render/geometry';
import { pickLink } from './render/picking';
import { CityRenderer } from './render/renderer';
import { createSimClient, type SimClient } from './sim/client';
import { DT, parseCityName, type ClockStatus, type FrameMessage, type ReadyMessage } from './sim/protocol';
import { ControlPanel, SPEEDS } from './ui/ControlPanel';
import { MetricsStrip } from './ui/MetricsStrip';
import { SelectionPanel } from './ui/SelectionPanel';
import type { LivingCitySnapshot } from './ui/testHook';
import './styles.css';

const DEFAULT_SPEED = 20;
const FIT_PADDING_PX = 64;
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

  const [ready, setReady] = useState<ReadyMessage | null>(null);
  const [frame, setFrame] = useState<FrameView | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  // The latest requested speed: a choice made before the worker is ready must survive `ready`.
  const speedRef = useRef(DEFAULT_SPEED);
  const [mainPending, setMainPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const central = ready?.landmarks.central_bridge;
  const mainClosedConfirmed = !!(central && frame && central.every((l) => frame.closed.includes(l)));
  const mainClosed = mainPending ?? mainClosedConfirmed;
  const running = frame?.clock.running ?? false;

  const pushLinkState = useCallback(() => {
    const f = frameRef.current;
    if (renderer.current && f) renderer.current.setLinkState(f.closed, selectedRef.current, hoveredRef.current, f.linkQueued);
  }, []);

  const select = useCallback(
    (link: number | null) => {
      selectedRef.current = link;
      setSelected(link);
      pushLinkState();
    },
    [pushLinkState],
  );

  // Simulation client: ready → geometry + camera; frames → GPU + UI state.
  useEffect(() => {
    const canvas = canvasRef.current!;
    try {
      renderer.current = new CityRenderer(canvas);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const c = createSimClient(2026, 7, parseCityName(new URLSearchParams(window.location.search).get('city')));
    client.current = c;
    c.onError(setError);
    c.onReady((r) => {
      readyRef.current = r;
      const g = buildRoadGeometry(r.network);
      geometry.current = g;
      renderer.current!.setNetwork(g, riverDecor(r.network, g.bounds, r.river));
      camera.fit(g.bounds, FIT_PADDING_PX);
      setReady(r);
      c.setSpeed(speedRef.current);
      c.setRunning(true);
    });
    c.onFrame((f: FrameMessage) => {
      renderer.current?.setFrame(new Uint32Array(f.vehicles), f.count, performance.now());
      c.returnBuffer(f.vehicles); // uploaded: give the buffer back to the worker's pool
      const names = readyRef.current?.metricNames ?? [];
      const metrics: Record<string, number> = {};
      names.forEach((n, i) => (metrics[n] = f.metrics[i]!));
      const view: FrameView = {
        tick: f.tick,
        simTimeS: f.simTimeS,
        closed: Array.from(f.closed),
        linkCounts: f.linkCounts,
        linkQueued: f.linkQueued,
        metrics,
        clock: f.clock,
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
    const loop = (now: number) => {
      const f = frameRef.current;
      const simPerMs = f && f.clock.running ? (f.clock.achievedTicksPerS * DT) / 1000 : 0;
      renderer.current?.draw(camera, now, simPerMs);
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

  // Global shortcuts (ignored while focus is in a control).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isInteractive(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) toggleRunning(); // holding Space must not flicker play/pause
      } else if (e.key === 'b' || e.key === 'B') {
        toggleMainBridge();
      } else if (e.key === '+' || e.key === '=' || e.key === '-') {
        const i = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
        const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + (e.key === '-' ? -1 : 1)))]!;
        if (next !== speed) changeSpeed(next);
      } else if (e.key === 'Escape') {
        select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRunning, toggleMainBridge, changeSpeed, select, speed]);

  // Pointer: drag pans, click selects, hover highlights, wheel zooms about the cursor.
  useEffect(() => {
    const canvas = canvasRef.current!;
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const local = (e: MouseEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const pick = (x: number, y: number) => (geometry.current ? pickLink(geometry.current.links, camera, x, y) : null);
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
      if (drag && !drag.moved) select(pick(...local(e)));
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
  }, [camera, pushLinkState, select]);

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
        };
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
  }, [camera]);

  const g = geometry.current;
  const sel = selected !== null && g ? g.links[selected] : undefined;

  return (
    <main className="app">
      <canvas ref={canvasRef} className="city" aria-label="City map" />
      {ready && <ZoneLabels ready={ready} camera={camera} />}
      <ControlPanel
        running={running}
        speed={speed}
        clock={frame?.clock ?? null}
        mainBridgeClosed={mainClosed}
        mainBridgePending={mainPending !== null}
        onToggleRunning={toggleRunning}
        onSpeed={changeSpeed}
        onToggleMainBridge={toggleMainBridge}
      />
      {sel && frame && ready && (
        <SelectionPanel
          link={sel}
          speedMps={ready.network.linkSpeed[sel.id]!}
          vehicles={frame.linkCounts[sel.id] ?? 0}
          queued={frame.linkQueued[sel.id] ?? 0}
          closed={frame.closed.includes(sel.id)}
          onClose={() => client.current?.closeLink(sel.id)}
          onReopen={() => client.current?.openLink(sel.id)}
        />
      )}
      <MetricsStrip simTimeS={frame?.simTimeS ?? 0} metrics={frame?.metrics ?? {}} />
      {error && (
        <p role="alert" className="panel error">
          {error}
        </p>
      )}
    </main>
  );
}

/** District labels: HTML overlay that never intercepts the pointer; re-laid out on every React render. */
function ZoneLabels({ ready, camera }: { ready: ReadyMessage; camera: Camera }) {
  const xy = ready.network.nodeXy;
  return (
    <div className="labels" aria-hidden="true">
      {ready.zones.map((z) => {
        const [sx, sy] = camera.worldToScreen(xy[2 * z.node]!, xy[2 * z.node + 1]!);
        return (
          <span key={z.node} className={`zone ${z.kind}`} style={{ left: sx, top: sy }}>
            {z.name}
          </span>
        );
      })}
    </div>
  );
}

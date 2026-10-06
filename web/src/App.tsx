import { useEffect, useRef, useState } from 'react';

import { createSimClient, type SimClient } from './sim/client';
import { decodeVehicles } from './sim/frame';
import { FLAG_ON_CLOSED_LINK, type FrameMessage, type ReadyMessage } from './sim/protocol';

const SPEEDS = [1, 5, 20, 60, 300];

interface Readout {
  frame: FrameMessage;
  onClosed: number;
  /** Read before the buffer is transferred back (it is detached afterwards). */
  bytes: number;
}

/** Debug readout (core-004); replaced by the real UI in core-005. */
export function App() {
  const client = useRef<SimClient | null>(null);
  const [ready, setReady] = useState<ReadyMessage | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(20);

  useEffect(() => {
    const c = createSimClient(2026, 7);
    client.current = c;
    c.onReady((r) => {
      setReady(r);
      c.setSpeed(20);
      c.setRunning(true);
    });
    c.onError(setError);
    c.onFrame((f) => {
      const d = decodeVehicles(f.vehicles, f.count);
      let onClosed = 0;
      for (let i = 0; i < d.count; i++) if (d.flags(i) & FLAG_ON_CLOSED_LINK) onClosed++;
      setReadout({ frame: f, onClosed, bytes: f.vehicles.byteLength });
      c.returnBuffer(f.vehicles);
    });
    return () => c.dispose();
  }, []);

  const central = ready?.landmarks.central_bridge;
  const metric = (name: string) => {
    const i = ready?.metricNames.indexOf(name) ?? -1;
    return i >= 0 && readout ? readout.frame.metrics[i] : undefined;
  };
  const f = readout?.frame;
  const centralClosed = !!(central && f && Array.from(f.closed).includes(central[0]));

  return (
    <main style={{ fontFamily: 'ui-monospace, monospace', padding: 16, color: '#e6e8ec', background: '#111418', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 18 }}>Living City · worker bridge debug</h1>
      {error && <p role="alert">error: {error}</p>}
      {!f ? (
        <p>starting…</p>
      ) : (
        <dl data-testid="readout" style={{ display: 'grid', gridTemplateColumns: 'max-content auto', gap: '4px 16px' }}>
          <dt>tick</dt>
          <dd data-testid="tick">{f.tick}</dd>
          <dt>sim time</dt>
          <dd>{f.simTimeS.toFixed(0)} s (sim)</dd>
          <dt>active</dt>
          <dd data-testid="active">{metric('active')}</dd>
          <dt>on network / queued</dt>
          <dd>
            {f.count} / {metric('queued')}
          </dd>
          <dt>frame bytes</dt>
          <dd data-testid="bytes">{readout?.bytes}</dd>
          <dt>vehicles on closed links</dt>
          <dd data-testid="on-closed">{readout?.onClosed}</dd>
          <dt>sim ms/tick (median / p95)</dt>
          <dd>
            {f.perf.tickMsMedian.toFixed(3)} / {f.perf.tickMsP95.toFixed(3)}
          </dd>
          <dt>speed achieved / target</dt>
          <dd data-testid="speed">
            {(f.clock.achievedTicksPerS * 0.5).toFixed(1)}× / {f.clock.multiplier}× {f.clock.behind ? '— BEHIND' : ''}
          </dd>
          <dt>frames/s</dt>
          <dd>{f.perf.framesPerS}</dd>
        </dl>
      )}
      <p>
        <button
          disabled={!central}
          onClick={() => central && central.forEach((l) => (centralClosed ? client.current?.openLink(l) : client.current?.closeLink(l)))}
        >
          {centralClosed ? 'Reopen central bridge' : 'Close central bridge'}
        </button>{' '}
        <label>
          speed{' '}
          <select
            value={speed}
            onChange={(e) => {
              const s = Number(e.target.value);
              setSpeed(s);
              client.current?.setSpeed(s);
            }}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
      </p>
    </main>
  );
}

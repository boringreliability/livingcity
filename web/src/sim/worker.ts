/// <reference lib="webworker" />
// Simulation worker entry: owns the wasm sim and wires `createSimHost` to `self`.
import init, { Sim } from '../wasm/sim_wasm.js';
import { createSimHost, type SimHost, type SimLike } from './host';
import type { ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

/** Loop period (ms); frames are rate-limited separately by the host. */
const LOOP_MS = 4;

let host: SimHost | undefined;
const early: ToWorker[] = [];

self.onmessage = (e: MessageEvent<ToWorker>) => {
  if (host) host.handle(e.data);
  else early.push(e.data);
};

init()
  .then((wasm) => {
    const h = createSimHost({
      createSim: (d, b) => Sim.three_bridges(d, b) as unknown as SimLike,
      memory: () => wasm.memory,
      post: (msg, transfer) => self.postMessage(msg, transfer),
      now: () => performance.now(),
    });
    host = h;
    for (const msg of early.splice(0)) h.handle(msg);
    const loop = () => {
      h.iterate();
      setTimeout(loop, LOOP_MS);
    };
    loop();
  })
  .catch((e: unknown) => {
    self.postMessage({ type: 'error', message: `wasm load failed: ${e instanceof Error ? e.message : String(e)}` });
  });

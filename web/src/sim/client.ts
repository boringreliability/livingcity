import type { CityName, FrameMessage, FromWorker, ReadyMessage, ToWorker } from './protocol';

/** UI-side handle on the simulation worker. */
export interface SimClient {
  onReady(cb: (msg: ReadyMessage) => void): void;
  onFrame(cb: (msg: FrameMessage) => void): void;
  onError(cb: (message: string) => void): void;
  setRunning(running: boolean): void;
  setSpeed(multiplier: number): void;
  closeLink(link: number): void;
  openLink(link: number): void;
  /** Give a consumed vehicle buffer back to the worker's pool. */
  returnBuffer(buffer: ArrayBuffer): void;
  /** Track the vehicle at `record` of the frame encoded at `frameTick`. */
  /** `seq` is echoed back in frames (`trackedSeq`). */
  inspectVehicle(frameTick: number, record: number, seq?: number): void;
  clearInspectedVehicle(seq?: number): void;
  inspectLink(link: number | null): void;
  dispose(): void;
}

export function createSimClient(demandSeed: number, behaviorSeed: number, city?: CityName): SimClient {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const ready: ((m: ReadyMessage) => void)[] = [];
  const frame: ((m: FrameMessage) => void)[] = [];
  const errors: ((m: string) => void)[] = [];
  const send = (msg: ToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);

  worker.onerror = (e: ErrorEvent) => errors.forEach((cb) => cb(`worker error: ${e.message}`));
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data;
    if (msg.type === 'ready') ready.forEach((cb) => cb(msg));
    else if (msg.type === 'frame') frame.forEach((cb) => cb(msg));
    else errors.forEach((cb) => cb(msg.message));
  };
  send({ type: 'init', demandSeed, behaviorSeed, ...(city ? { city } : {}) });

  return {
    onReady: (cb) => void ready.push(cb),
    onFrame: (cb) => void frame.push(cb),
    onError: (cb) => void errors.push(cb),
    setRunning: (running) => send({ type: 'setRunning', running }),
    setSpeed: (multiplier) => send({ type: 'setSpeed', multiplier }),
    closeLink: (link) => send({ type: 'command', kind: 'close', link }),
    openLink: (link) => send({ type: 'command', kind: 'open', link }),
    returnBuffer: (buffer) => send({ type: 'returnBuffer', buffer }, [buffer]),
    inspectVehicle: (frameTick, record, seq) =>
      send({ type: 'inspectVehicle', frameTick, record, ...(seq === undefined ? {} : { seq }) }),
    clearInspectedVehicle: (seq) => send({ type: 'inspectVehicle', clear: true, ...(seq === undefined ? {} : { seq }) }),
    inspectLink: (link) => send({ type: 'inspectLink', link }),
    dispose: () => worker.terminate(),
  };
}

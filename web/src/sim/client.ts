import type { CityName, ComparisonMessage, FrameMessage, FromWorker, ReadyMessage, ToWorker } from './protocol';

/** UI-side handle on the simulation worker. */
export interface SimClient {
  onReady(cb: (msg: ReadyMessage) => void): void;
  onFrame(cb: (msg: FrameMessage) => void): void;
  onError(cb: (message: string) => void): void;
  onComparison(cb: (msg: ComparisonMessage) => void): void;
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
  /** Timeline (ward timeline-003): seek the viewed scenario, branch B from A, switch, discard B. */
  seek(tick: number): void;
  branch(fromTick: number, then: { kind: 'close' | 'open'; link: number }[]): void;
  viewScenario(scenario: 0 | 1): void;
  discardBranch(): void;
  compare(on: boolean): void;
  dispose(): void;
}

/** `warmupS`: sim seconds to pre-simulate before `ready`; `demandScale`: stress demand (measurement only). */
export function createSimClient(
  demandSeed: number,
  behaviorSeed: number,
  city?: CityName,
  opts: { warmupS?: number; demandScale?: number } = {},
): SimClient {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const ready: ((m: ReadyMessage) => void)[] = [];
  const frame: ((m: FrameMessage) => void)[] = [];
  const errors: ((m: string) => void)[] = [];
  const comparisons: ((m: ComparisonMessage) => void)[] = [];
  const send = (msg: ToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);

  worker.onerror = (e: ErrorEvent) => errors.forEach((cb) => cb(`worker error: ${e.message}`));
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data;
    if (msg.type === 'ready') ready.forEach((cb) => cb(msg));
    else if (msg.type === 'frame') frame.forEach((cb) => cb(msg));
    else if (msg.type === 'comparison') comparisons.forEach((cb) => cb(msg));
    else errors.forEach((cb) => cb(msg.message));
  };
  send({
    type: 'init',
    demandSeed,
    behaviorSeed,
    ...(city ? { city } : {}),
    ...(opts.warmupS ? { warmupS: opts.warmupS } : {}),
    ...(opts.demandScale !== undefined && opts.demandScale !== 1 ? { demandScale: opts.demandScale } : {}),
  });

  return {
    onReady: (cb) => void ready.push(cb),
    onFrame: (cb) => void frame.push(cb),
    onError: (cb) => void errors.push(cb),
    onComparison: (cb) => void comparisons.push(cb),
    setRunning: (running) => send({ type: 'setRunning', running }),
    setSpeed: (multiplier) => send({ type: 'setSpeed', multiplier }),
    closeLink: (link) => send({ type: 'command', kind: 'close', link }),
    openLink: (link) => send({ type: 'command', kind: 'open', link }),
    returnBuffer: (buffer) => send({ type: 'returnBuffer', buffer }, [buffer]),
    inspectVehicle: (frameTick, record, seq) =>
      send({ type: 'inspectVehicle', frameTick, record, ...(seq === undefined ? {} : { seq }) }),
    clearInspectedVehicle: (seq) => send({ type: 'inspectVehicle', clear: true, ...(seq === undefined ? {} : { seq }) }),
    inspectLink: (link) => send({ type: 'inspectLink', link }),
    seek: (tick) => send({ type: 'seek', tick }),
    branch: (fromTick, then) => send({ type: 'branch', fromTick, then }),
    viewScenario: (scenario) => send({ type: 'viewScenario', scenario }),
    discardBranch: () => send({ type: 'discardBranch' }),
    compare: (on) => send({ type: 'compare', on }),
    dispose: () => worker.terminate(),
  };
}

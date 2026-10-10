import type { CityName, ComparisonMessage, FrameMessage, FromWorker, ReadyMessage, ToWorker } from './protocol';

/** UI-side handle on the simulation worker. */
export interface SimClient {
  onReady(cb: (msg: ReadyMessage) => void): void;
  onFrame(cb: (msg: FrameMessage) => void): void;
  /** `fatal`: the simulation stopped; only a new client (restart) helps. */
  onError(cb: (message: string, fatal: boolean) => void): void;
  onComparison(cb: (msg: ComparisonMessage) => void): void;
  setRunning(running: boolean): void;
  setSpeed(multiplier: number): void;
  closeLink(link: number): void;
  openLink(link: number): void;
  /** Give a consumed vehicle buffer back to the worker's pool. */
  /** `scenario`: the side of the frame it came from (each side has its own pool in the worker). */
  returnBuffer(buffer: ArrayBuffer, scenario?: 0 | 1): void;
  /** Test hook: make the worker's next iteration trap inside wasm. */
  debugTrap(): void;
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
  const errors: ((m: string, fatal: boolean) => void)[] = [];
  const comparisons: ((m: ComparisonMessage) => void)[] = [];
  const send = (msg: ToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);

  worker.onerror = (e: ErrorEvent) => errors.forEach((cb) => cb(`worker error: ${e.message}`, true));
  worker.onmessageerror = () => errors.forEach((cb) => cb('worker message could not be read', true));
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data;
    if (msg.type === 'ready') ready.forEach((cb) => cb(msg));
    else if (msg.type === 'frame') frame.forEach((cb) => cb(msg));
    else if (msg.type === 'comparison') comparisons.forEach((cb) => cb(msg));
    else errors.forEach((cb) => cb(msg.message, msg.fatal === true));
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
    returnBuffer: (buffer, scenario) => send({ type: 'returnBuffer', buffer, scenario }, [buffer]),
    debugTrap: () => send({ type: 'debugTrap' }),
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

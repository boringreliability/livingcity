import type { FrameMessage, ReadyMessage } from './protocol';

/** UI-side handle on the simulation worker. */
export interface SimClient {
  onReady(cb: (msg: ReadyMessage) => void): void;
  onFrame(cb: (msg: FrameMessage) => void): void;
  setRunning(running: boolean): void;
  setSpeed(multiplier: number): void;
  closeLink(link: number): void;
  openLink(link: number): void;
  /** Give a consumed vehicle buffer back to the worker's pool. */
  returnBuffer(buffer: ArrayBuffer): void;
  dispose(): void;
}

export function createSimClient(_demandSeed: number, _behaviorSeed: number): SimClient {
  throw new Error('not implemented');
}

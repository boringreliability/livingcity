import { readFileSync } from 'node:fs';

import { initSync } from '../src/wasm/sim_wasm.js';

let memory: WebAssembly.Memory | undefined;

/** Instantiate the real wasm module once (Node: from the file's bytes). */
export function loadWasm(): WebAssembly.Memory {
  if (!memory) {
    const bytes = readFileSync(new URL('../src/wasm/sim_wasm_bg.wasm', import.meta.url));
    memory = initSync({ module: bytes }).memory;
  }
  return memory;
}

/** Typed views over a transferred vehicle buffer (no per-record objects). */
export interface DecodedVehicles {
  count: number;
  link: Uint32Array;
  s: Float32Array;
  v: Float32Array;
  flags: Uint32Array;
  /** Lane of record i (from flags bits 8..15). */
  lane(i: number): number;
}

export function decodeVehicles(_buffer: ArrayBuffer, _count: number): DecodedVehicles {
  throw new Error('not implemented');
}

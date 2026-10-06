/**
 * Accessors over a transferred vehicle buffer. The buffer keeps the protocol
 * layout (array of 4-word records), so it can be uploaded to the GPU as
 * instance attributes as is; decoding never copies or mutates it.
 */
export interface DecodedVehicles {
  count: number;
  /** The whole buffer as u32 words (record i at 4i … 4i+3). */
  words: Uint32Array;
  /** The same buffer as f32 (s at 4i+1, v at 4i+2). */
  floats: Float32Array;
  link(i: number): number;
  s(i: number): number;
  v(i: number): number;
  flags(i: number): number;
  lane(i: number): number;
}

export function decodeVehicles(_buffer: ArrayBuffer, _count: number): DecodedVehicles {
  throw new Error('not implemented');
}

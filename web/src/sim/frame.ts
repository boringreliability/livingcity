import { FLAG_LANE_SHIFT, VEHICLE_RECORD_WORDS } from './protocol';

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

export function decodeVehicles(buffer: ArrayBuffer, count: number): DecodedVehicles {
  const words = new Uint32Array(buffer, 0, count * VEHICLE_RECORD_WORDS);
  const floats = new Float32Array(buffer, 0, count * VEHICLE_RECORD_WORDS);
  const at = (i: number, k: number) => i * VEHICLE_RECORD_WORDS + k;
  return {
    count,
    words,
    floats,
    link: (i) => words[at(i, 0)]!,
    s: (i) => floats[at(i, 1)]!,
    v: (i) => floats[at(i, 2)]!,
    flags: (i) => words[at(i, 3)]!,
    lane: (i) => (words[at(i, 3)]! >>> FLAG_LANE_SHIFT) & 0xff,
  };
}

/**
 * The link table texture: 3 RGBA32F texels per link (ends; normal, width, lanes; length),
 * laid out 1024 links wide so any realistic network fits under MAX_TEXTURE_SIZE.
 * Row r of link i lives at (i mod 1024, r × ceil(n / 1024) + floor(i / 1024)).
 */
export const LINK_TEX_WIDTH = 1024;

/** Texel rows per table row (`ceil(n / 1024)`, at least 1). */
export const linkRows = (n: number): number => Math.max(1, Math.ceil(n / LINK_TEX_WIDTH));

export function linkTexel(i: number, row: number, n: number): [number, number] {
  return [i % LINK_TEX_WIDTH, row * linkRows(n) + Math.floor(i / LINK_TEX_WIDTH)];
}

/** The same mapping in GLSL (uses the uniform `u_linkRows`). */
export const LINK_TEXEL_GLSL = `
ivec2 linkTexel(int i, int row) {
  return ivec2(i % ${LINK_TEX_WIDTH}, row * u_linkRows + i / ${LINK_TEX_WIDTH});
}`;

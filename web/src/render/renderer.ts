import { VEHICLE_RECORD_BYTES, type TrackedVehicle } from '../sim/protocol';
import type { Camera } from './camera';
import type { CityDecor } from './cities';
import { LANE_WIDTH_M, vehiclePosition, type RoadGeometry } from './geometry';
import { NO_NEXT } from './motion';
import { visualS, type PresentedVehicle, type Presenter } from './presentation';
import { LINK_TEX_WIDTH, LINK_TEXEL_GLSL, linkRows, linkTexel } from './linkTable';

/*
 * WebGL2 city renderer. The simulation supplies (link, s, v, flags/lane) per
 * vehicle; the vertex shader maps them onto the drawn link geometry, so no
 * x/y ever comes from Rust. Rendering never feeds back into the simulation.
 */

/** Halo around the selected / hovered road, CSS px (drawn on top of every road). */
export const SELECTED_HALO_PX = 3;
export const HOVER_HALO_PX = 2;
/** Minimum on-screen vehicle size (length, width) in CSS px, per class: the shapes stay distinct. */
export const MOVING_MIN_PX = [5.0, 1.8] as const;
export const QUEUED_MIN_PX = [3.4, 3.4] as const;
/** Below this zoom (px/m) congestion also widens roads; above LOD_DETAIL lane marks and building outlines show. */
const LOD_OVERVIEW_PX_PER_M = 0.5;
const LOD_DETAIL_PX_PER_M = 2;
/** Congestion reaches its full look at this occupancy (vehicles ÷ capacity). */
const CONGESTION_FULL_AT = 0.5;
/** Closed roads: hatch stops this far short of each junction (CSS px), barriers at these fractions. */
const HATCH_JUNCTION_INSET_PX = 6;
const BARRIER_AT = [0.12, 0.88] as const;
/** The closure sign at a closed link's midpoint (CSS px): a white ring between dark rings, hatch inside. */
const GLYPH_INNER_PX = 4;
const GLYPH_OUTER_PX = 8;
/** Dash period of a hovered road's centre stroke (CSS px; 60 % drawn). */
const HOVER_DASH_PX = 10;
/** Bridge decks keep at least this on-screen width (CSS px), with a dark railing edge of RAILING_PX. */
const DECK_MIN_PX = 12;
const RAILING_PX = 1.5;

const COLORS = {
  background: [0.055, 0.067, 0.082],
  water: [0.075, 0.18, 0.27],
  bank: [0.11, 0.14, 0.16],
  park: [0.085, 0.115, 0.1],
  building: [0.09, 0.1, 0.12],
  outline: [0.16, 0.18, 0.21],
  deck: [0.17, 0.185, 0.21],
  pad: [0.14, 0.16, 0.19],
} as const;

const SOLID_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
uniform vec2 u_center;
uniform vec2 u_scale;
void main() { gl_Position = vec4((a_pos - u_center) * u_scale, 0.0, 1.0); }`;

const SOLID_FS = `#version 300 es
precision highp float;
uniform vec3 u_color;
out vec4 o;
void main() { o = vec4(u_color, 1.0); }`;

// Roads: one quad per link, extruded in the shader so roads keep a minimum on-screen width.
// Passes: 0 = every road except congested ones; 3 = congested roads (on top, widened at
// overview zoom); 1 = halo of the selected / hovered road; 2 = closed-road hatch (after the route).
const ROAD_VS = `#version 300 es
layout(location = 0) in vec2 a_center;
layout(location = 1) in vec2 a_normal;
layout(location = 2) in float a_side;
layout(location = 3) in float a_halfWidth;
layout(location = 4) in float a_along;
layout(location = 5) in float a_link;
layout(location = 6) in float a_lanes;
uniform vec2 u_center;
uniform vec2 u_scale;
uniform float u_pxPerM;
uniform int u_pass;
uniform int u_linkRows;
uniform sampler2D u_state;
uniform sampler2D u_links;
out float v_across;
out float v_along;
out float v_lanes;
out vec2 v_wpx;
flat out vec4 v_state;
flat out float v_occ;
${LINK_TEXEL_GLSL}
void main() {
  int l = int(a_link);
  vec4 st = texelFetch(u_state, ivec2(l % ${LINK_TEX_WIDTH}, l / ${LINK_TEX_WIDTH}), 0);
  bool closed = st.r > 0.5;
  bool highlighted = st.g > 0.5 || st.b > 0.5;
  float occ = clamp(st.a / ${CONGESTION_FULL_AT.toFixed(2)}, 0.0, 1.0);
  bool congested = occ > 0.05 && !closed;
  bool draw = u_pass == 0 ? !congested : u_pass == 3 ? congested : u_pass == 1 ? highlighted : closed;
  vec2 c = a_center;
  if (u_pass == 2) {
    // the hatch stops short of both junctions so the cross roads stay visible
    vec4 ends = texelFetch(u_links, linkTexel(l, 0), 0);
    vec2 d = ends.zw - ends.xy;
    float lenPx = length(d) * u_pxPerM;
    float inset = ${HATCH_JUNCTION_INSET_PX.toFixed(1)};
    if (lenPx < 2.0 * inset + 2.0) draw = false;
    c += normalize(d) * (a_along > 0.0 ? -inset : inset) / u_pxPerM;
  }
  if (!draw) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume: not drawn
    return;
  }
  // the hatch is at least 9 px wide; a closed road's halo starts from the same width so it stays visible
  float minPx = u_pass == 2 || (u_pass == 1 && closed) ? 9.0 : 2.5;
  float extraPx = u_pass == 3 && u_pxPerM < ${LOD_OVERVIEW_PX_PER_M.toFixed(2)} ? 3.0 * occ : 0.0;
  float core = max(a_halfWidth, 0.5 * minPx / u_pxPerM) + 0.5 * extraPx / u_pxPerM;
  float haloPx = u_pass == 1 ? (st.g > 0.5 ? ${SELECTED_HALO_PX.toFixed(1)} : ${HOVER_HALO_PX.toFixed(1)}) : 0.0;
  float hw = core + haloPx / u_pxPerM;
  vec2 p = c + a_normal * a_side * hw;
  gl_Position = vec4((p - u_center) * u_scale, 0.0, 1.0);
  v_across = a_side * hw / core; // ±1 at the road edge, beyond it in the halo
  v_along = a_along;
  v_lanes = a_lanes;
  v_wpx = p * u_pxPerM; // world position in CSS px: the hatch moves with the map
  v_state = st;
  v_occ = occ;
}`;

const ROAD_FS = `#version 300 es
precision highp float;
precision highp int;
in float v_across;
in float v_along;
in float v_lanes;
in vec2 v_wpx;
flat in vec4 v_state;
flat in float v_occ;
uniform float u_pxPerM;
uniform int u_pass;
out vec4 o;
void main() {
  if (u_pass == 2) {
    // closed: black/yellow diagonal hatch, period fixed in CSS px, anchored to the world
    float k = floor((v_wpx.x + v_wpx.y) / 5.0);
    o = vec4(mod(k, 2.0) < 1.0 ? vec3(0.95, 0.76, 0.16) : vec3(0.05, 0.05, 0.05), 1.0);
    return;
  }
  vec3 base = vec3(0.24, 0.27, 0.31);
  // congestion: a lighter, warmer surface (lightness, not hue alone)
  base = mix(base, vec3(0.66, 0.56, 0.38), v_occ * 0.85);
  // lane separators: dashed, only when zoomed in enough to read them
  if (v_lanes > 1.5 && u_pxPerM > 1.5) {
    float lanePos = (v_across * 0.5 + 0.5) * v_lanes;
    float edge = abs(fract(lanePos + 0.5) - 0.5);
    if (edge < 0.04 && fract(v_along / 6.0) < 0.5) base = mix(base, vec3(0.7), 0.6);
  }
  // halo (pass 1): white for the selected road, light grey for the hovered one — lightness, not hue
  if (abs(v_across) > 1.0) base = v_state.g > 0.5 ? vec3(1.0) : vec3(0.72);
  // hovered (not selected): a dashed light stroke along the centre — a shape congestion never makes
  else if (u_pass == 1 && v_state.g <= 0.5 && abs(v_across) < 0.45 && fract(v_along * u_pxPerM / ${HOVER_DASH_PX.toFixed(1)}) < 0.6) base = vec3(0.92);
  o = vec4(base, 1.0);
}`;

// Barriers across closed roads: bars sized in CSS px (near-white core, dark edge).
const BAR_VS = `#version 300 es
layout(location = 0) in vec2 a_center;
layout(location = 1) in vec2 a_dir;
layout(location = 2) in vec2 a_corner;
layout(location = 3) in float a_halfM;
uniform vec2 u_center;
uniform vec2 u_scale;
uniform float u_pxPerM;
out vec2 v_px;
flat out float v_halfLen;
flat out float v_glyph;
void main() {
  vec2 n = vec2(-a_dir.y, a_dir.x);
  // a_halfM < 0: the closure sign at the link's midpoint (a ring, drawn at every zoom; ward polish-003)
  v_glyph = a_halfM < 0.0 ? 1.0 : 0.0;
  float halfLen = a_halfM < 0.0 ? ${GLYPH_OUTER_PX.toFixed(1)} : max(a_halfM * u_pxPerM, 4.5) + 4.0;
  vec2 px = a_halfM < 0.0 ? a_corner * ${GLYPH_OUTER_PX.toFixed(1)} : vec2(a_corner.x * 3.0, a_corner.y * halfLen);
  vec2 p = a_center + (a_dir * px.x + n * px.y) / u_pxPerM;
  gl_Position = vec4((p - u_center) * u_scale, 0.0, 1.0);
  v_px = px;
  v_halfLen = halfLen;
}`;

const BAR_FS = `#version 300 es
precision highp float;
in vec2 v_px;
flat in float v_halfLen;
flat in float v_glyph;
out vec4 o;
void main() {
  if (v_glyph > 0.5) {
    // a white ring between dark rings; the hatch stays visible inside it
    float r = length(v_px);
    if (r < ${GLYPH_INNER_PX.toFixed(1)} || r > ${GLYPH_OUTER_PX.toFixed(1)}) discard;
    bool dark = r < ${GLYPH_INNER_PX.toFixed(1)} + 1.0 || r > ${GLYPH_OUTER_PX.toFixed(1)} - 1.0;
    o = vec4(dark ? vec3(0.04) : vec3(0.97), 1.0);
    return;
  }
  bool edge = abs(v_px.x) > 2.0 || abs(v_px.y) > v_halfLen - 1.0;
  o = vec4(edge ? vec3(0.04) : vec3(0.97), 1.0);
}`;

// Bridge decks: the deck quad widened to DECK_MIN_PX on screen, with a dark railing on both long edges.
const DECK_VS = `#version 300 es
layout(location = 0) in vec2 a_center;
layout(location = 1) in vec2 a_normal;
layout(location = 2) in float a_side;
layout(location = 3) in float a_halfM;
uniform vec2 u_center;
uniform vec2 u_scale;
uniform float u_pxPerM;
out float v_acrossPx;
flat out float v_halfPx;
void main() {
  float halfPx = max(a_halfM * u_pxPerM, ${(DECK_MIN_PX / 2).toFixed(1)});
  vec2 p = a_center + a_normal * a_side * (halfPx / u_pxPerM);
  gl_Position = vec4((p - u_center) * u_scale, 0.0, 1.0);
  v_acrossPx = a_side * halfPx;
  v_halfPx = halfPx;
}`;

const DECK_FS = `#version 300 es
precision highp float;
in float v_acrossPx;
flat in float v_halfPx;
out vec4 o;
void main() {
  // two-tone railing: a dark outer line (reads against water) and a mid-grey inner one (reads over land)
  float e = v_halfPx - abs(v_acrossPx);
  vec3 c = e < ${RAILING_PX.toFixed(1)} ? vec3(0.02, 0.022, 0.025) : e < ${(2 * RAILING_PX).toFixed(1)} ? vec3(0.42, 0.44, 0.47) : vec3(${COLORS.deck.map((c) => c.toFixed(3)).join(', ')});
  o = vec4(c, 1.0);
}`;

// Vehicles: instanced quads. Per instance the pose the presenter computed on the CPU (x, y, hx, hy:
// presentation.ts's visualPose of the presented car, ward motion-002) and the record's flags (the
// frame's AoS buffer, stride 16 bytes): the GPU draws exactly where the CPU rule says.
const VEH_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_pose;
layout(location = 4) in uint a_flags;
uniform vec2 u_center;
uniform vec2 u_scale;
uniform float u_pxPerM;
out vec2 v_local;
flat out uint v_flags;
flat out float v_band; // brake band length as a share of the vehicle (at least ~1.25 px)
void main() {
  vec2 p = a_pose.xy;
  vec2 dir = length(a_pose.zw) > 0.0 ? normalize(a_pose.zw) : vec2(1.0, 0.0);
  vec2 n = vec2(dir.y, -dir.x); // right-hand normal of the heading
  bool queued = (a_flags & 1u) != 0u;
  // queued: short and square; moving: long and slim — in metres when zoomed in, in CSS px when zoomed out
  vec2 size = queued ? vec2(3.6, 2.3) : vec2(4.4, 1.8);
  size = max(size, (queued ? vec2(${QUEUED_MIN_PX.map((x) => x.toFixed(1)).join(', ')}) : vec2(${MOVING_MIN_PX.map((x) => x.toFixed(1)).join(', ')})) / u_pxPerM);
  v_band = max(0.22, 1.25 / (size.x * u_pxPerM));
  vec2 local = a_corner * size;
  vec2 w = p - dir * (size.x * 0.5) + dir * local.x + n * local.y;
  gl_Position = vec4((w - u_center) * u_scale, 0.0, 1.0);
  v_local = a_corner;
  v_flags = a_flags;
}`;

const VEH_FS = `#version 300 es
precision highp float;
in vec2 v_local;
flat in uint v_flags;
flat in float v_band;
out vec4 o;
void main() {
  bool queued = (v_flags & 1u) != 0u;
  bool stranded = (v_flags & 4u) != 0u;
  vec3 c = queued ? vec3(0.96, 0.66, 0.2) : vec3(0.86, 0.9, 0.95);
  // v_local.x runs 0 (rear) → 1 (front) along the vehicle, v_local.y −0.5 → 0.5 across it
  if (queued && v_local.x < v_band) c = vec3(0.22, 0.1, 0.02); // brake band at the rear
  if (stranded && abs(v_local.x - 0.5) < 0.3 && abs(v_local.y) < 0.25) c = vec3(0.08); // hollow mark
  o = vec4(c, 1.0);
}`;

/** Tracked vehicle ring: radii in CSS px (screen space, independent of zoom). */
const RING_INNER_PX = 7;
const RING_OUTER_PX = 10;
const RING_EDGE_PX = 1.5;
/** Route highlight: dashed centre line width and dash period, CSS px. */
const ROUTE_WIDTH_PX = 3;
const ROUTE_DASH_PX = 12;

// Route highlight: a screen-space dashed line along the remaining route's link centrelines.
const ROUTE_VS = `#version 300 es
layout(location = 0) in vec2 a_center;
layout(location = 1) in vec2 a_normal;
layout(location = 2) in float a_side;
layout(location = 3) in float a_along;
uniform vec2 u_center;
uniform vec2 u_scale;
uniform float u_pxPerM;
out float v_alongPx;
out float v_across;
void main() {
  vec2 p = a_center + a_normal * a_side * (${(ROUTE_WIDTH_PX / 2 + 1).toFixed(1)} / u_pxPerM);
  gl_Position = vec4((p - u_center) * u_scale, 0.0, 1.0);
  v_alongPx = a_along * u_pxPerM;
  v_across = a_side;
}`;

const ROUTE_FS = `#version 300 es
precision highp float;
in float v_alongPx;
in float v_across;
out vec4 o;
void main() {
  if (fract(v_alongPx / ${ROUTE_DASH_PX.toFixed(1)}) > 0.6) discard;
  // near-white core with a dark 1 px edge (readable on light, congested roads too)
  float halfW = ${(ROUTE_WIDTH_PX / 2).toFixed(2)} / ${(ROUTE_WIDTH_PX / 2 + 1).toFixed(2)};
  o = vec4(abs(v_across) <= halfW ? vec3(0.97) : vec3(0.05), 1.0);
}`;

// Tracked ring: one quad around the vehicle, sized in CSS px.
const RING_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
uniform vec2 u_center;
uniform vec2 u_scale;
uniform float u_pxPerM;
uniform vec2 u_at;
out vec2 v_px;
void main() {
  float r = ${(RING_OUTER_PX + RING_EDGE_PX + 1).toFixed(1)};
  vec2 p = u_at + a_corner * (r / u_pxPerM);
  gl_Position = vec4((p - u_center) * u_scale, 0.0, 1.0);
  v_px = a_corner * r;
}`;

const RING_FS = `#version 300 es
precision highp float;
in vec2 v_px;
out vec4 o;
void main() {
  float d = length(v_px);
  if (d >= ${RING_INNER_PX.toFixed(1)} && d <= ${RING_OUTER_PX.toFixed(1)}) o = vec4(vec3(0.97), 1.0);
  else if (d > ${RING_OUTER_PX.toFixed(1)} && d <= ${(RING_OUTER_PX + RING_EDGE_PX).toFixed(1)}) o = vec4(vec3(0.04), 1.0);
  else if (d >= ${(RING_INNER_PX - RING_EDGE_PX).toFixed(1)} && d < ${RING_INNER_PX.toFixed(1)}) o = vec4(vec3(0.04), 1.0);
  else discard;
}`;

/** The simulation's storage capacity of a link: lanes × max(1, floor(length / 7.5 m)). */
export function linkCapacity(lanes: number, length: number): number {
  return lanes * Math.max(1, Math.floor(length / 7.5));
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  const shaders: WebGLShader[] = [];
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`);
    gl.attachShader(prog, sh);
    shaders.push(sh);
  }
  gl.linkProgram(prog);
  for (const sh of shaders) gl.deleteShader(sh); // flagged; freed with the program
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
  return prog;
}

interface Mesh {
  vao: WebGLVertexArrayObject;
  buf: WebGLBuffer;
  count: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

function uniforms(gl: WebGL2RenderingContext, prog: WebGLProgram, names: string[]): Uniforms {
  return Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)]));
}

export class CityRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly solid: WebGLProgram;
  private readonly road: WebGLProgram;
  private readonly veh: WebGLProgram;
  private readonly routeProg: WebGLProgram;
  private readonly ringProg: WebGLProgram;
  private readonly uRoute: Uniforms;
  private readonly uRing: Uniforms;
  private route: { vao: WebGLVertexArrayObject; buf: WebGLBuffer; count: number } | null = null;
  private ringVao: WebGLVertexArrayObject;
  private ringBuf: WebGLBuffer;
  private tracked: TrackedVehicle | null = null;
  private water: Mesh | null = null;
  private banks: Mesh | null = null;
  private parks: Mesh | null = null;
  private buildings: Mesh | null = null;
  private decks: Mesh | null = null;
  private pads: Mesh | null = null;
  /** GL_LINES: building outlines (detail zoom). */
  private outlines: Mesh | null = null;
  private roads: Mesh | null = null;
  private bars: Mesh | null = null;
  private barClosed: number[] = [];
  private readonly barProg: WebGLProgram;
  private readonly deckProg: WebGLProgram;
  private readonly uDeck: Uniforms;
  private linkRowsN = 1;
  /** Test-only: skip drawing vehicles (so road pixels can be measured). */
  hideVehicles = false;
  private vehVao: WebGLVertexArrayObject;
  private vehBuf: WebGLBuffer;
  private vehQuad: WebGLBuffer;
  private readonly uSolid: Uniforms;
  private readonly uRoad: Uniforms;
  private readonly uVeh: Uniforms;
  private readonly uBar: Uniforms;
  private vehCount = 0;
  private linkTex: WebGLTexture;
  private stateTex: WebGLTexture;
  private stateBytes = new Uint8Array(0);
  private geometry: RoadGeometry | null = null;
  /** Presented poses (x, y, hx, hy per record of the newest frame), uploaded once per animation frame. */
  private poseBuf: WebGLBuffer;
  private poses = new Float32Array(0);
  /** Records in the last frame; the drawn count is the presenter's (the same frame). */
  private frameCount = 0;
  /** Where cars are drawn (ward motion-002): interpolation by trip id at the presentation time. */
  private presenter: Presenter | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.solid = compile(gl, SOLID_VS, SOLID_FS);
    this.road = compile(gl, ROAD_VS, ROAD_FS);
    this.veh = compile(gl, VEH_VS, VEH_FS);
    this.uSolid = uniforms(gl, this.solid, ['u_center', 'u_scale', 'u_color']);
    this.uRoad = uniforms(gl, this.road, ['u_center', 'u_scale', 'u_pxPerM', 'u_pass', 'u_state', 'u_links', 'u_linkRows']);
    this.uVeh = uniforms(gl, this.veh, ['u_center', 'u_scale', 'u_pxPerM']);
    this.barProg = compile(gl, BAR_VS, BAR_FS);
    this.uBar = uniforms(gl, this.barProg, ['u_center', 'u_scale', 'u_pxPerM']);
    this.deckProg = compile(gl, DECK_VS, DECK_FS);
    this.uDeck = uniforms(gl, this.deckProg, ['u_center', 'u_scale', 'u_pxPerM']);
    this.linkTex = gl.createTexture()!;
    this.stateTex = gl.createTexture()!;
    for (const t of [this.linkTex, this.stateTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    // Vehicle VAO: a unit quad (per vertex) + the presented poses and the records' flags (per instance).
    this.vehVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vehVao);
    const quad = gl.createBuffer()!;
    this.vehQuad = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -0.5, 1, -0.5, 1, 0.5, 0, -0.5, 1, 0.5, 0, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.poseBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.poseBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    this.vehBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vehBuf);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, VEHICLE_RECORD_BYTES, 12);
    for (const loc of [1, 4]) gl.vertexAttribDivisor(loc, 1);
    gl.bindVertexArray(null);

    this.routeProg = compile(gl, ROUTE_VS, ROUTE_FS);
    this.ringProg = compile(gl, RING_VS, RING_FS);
    this.uRoute = uniforms(gl, this.routeProg, ['u_center', 'u_scale', 'u_pxPerM']);
    this.uRing = uniforms(gl, this.ringProg, ['u_center', 'u_scale', 'u_pxPerM', 'u_at']);
    this.ringVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.ringVao);
    this.ringBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ringBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private solidMesh(data: Float32Array): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, buf, count: data.length / 2 };
  }

  private deleteMesh(m: Mesh | null): void {
    if (!m) return;
    this.gl.deleteVertexArray(m.vao);
    this.gl.deleteBuffer(m.buf);
  }

  /** The GPU behind this context, as WebGL reports it (unmasked when the browser allows). */
  rendererName(): string {
    const gl = this.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  }

  /** The canvas this renderer draws into (a spare B renderer is made on a detached canvas). */
  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Release the WebGL context itself (a removed canvas must not count against the browser's limit). */
  loseContext(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  /** Free every GPU object (the canvas may be reused, e.g. React StrictMode remounts). */
  dispose(): void {
    const gl = this.gl;
    for (const m of this.allMeshes()) this.deleteMesh(m);
    this.water = this.banks = this.parks = this.buildings = this.decks = this.pads = null;
    this.outlines = this.roads = this.bars = null;
    gl.deleteVertexArray(this.vehVao);
    gl.deleteBuffer(this.vehBuf);
    gl.deleteBuffer(this.poseBuf);
    gl.deleteBuffer(this.vehQuad);
    gl.deleteTexture(this.linkTex);
    gl.deleteTexture(this.stateTex);
    if (this.route) {
      gl.deleteVertexArray(this.route.vao);
      gl.deleteBuffer(this.route.buf);
      this.route = null;
    }
    gl.deleteVertexArray(this.ringVao);
    gl.deleteBuffer(this.ringBuf);
    for (const p of [this.solid, this.road, this.veh, this.routeProg, this.ringProg, this.barProg, this.deckProg]) gl.deleteProgram(p);
  }

  private allMeshes(): (Mesh | null)[] {
    return [this.water, this.banks, this.parks, this.buildings, this.decks, this.pads, this.outlines, this.roads, this.bars];
  }

  setNetwork(geometry: RoadGeometry, decor: CityDecor): void {
    const gl = this.gl;
    this.geometry = geometry;
    for (const m of this.allMeshes()) this.deleteMesh(m);
    this.bars = null;
    this.barClosed = [];
    this.water = this.solidMesh(decor.water);
    this.banks = this.solidMesh(decor.banks);
    this.parks = this.solidMesh(decor.parks);
    this.buildings = this.solidMesh(decor.buildings);
    this.decks = this.deckMesh(decor.bridgeDecks);
    this.pads = this.solidMesh(decor.pads);
    // building outlines (shown at detail zoom)
    const ol: number[] = [];
    for (const [x0, y0, x1, y1] of decor.buildingBoxes) ol.push(x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0);
    this.outlines = this.solidMesh(new Float32Array(ol));

    // Road quads: center, normal, side, half width, along, link, lanes (9 floats per vertex).
    const v: number[] = [];
    for (const l of geometry.links) {
      const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
      const corner = (end: 0 | 1, side: number) => {
        v.push(end ? l.x1 : l.x0, end ? l.y1 : l.y0, l.nx, l.ny, side, l.width / 2, end ? len : 0, l.id, l.lanes);
      };
      corner(0, -1);
      corner(1, -1);
      corner(1, 1);
      corner(0, -1);
      corner(1, 1);
      corner(0, 1);
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const F = 4;
    const layout: [number, number, number][] = [
      [0, 2, 0],
      [1, 2, 2],
      [2, 1, 4],
      [3, 1, 5],
      [4, 1, 6],
      [5, 1, 7],
      [6, 1, 8],
    ];
    for (const [loc, size, off] of layout) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 9 * F, off * F);
    }
    gl.bindVertexArray(null);
    this.roads = { vao, buf, count: v.length / 9 };

    // Link table: 3 RGBA32F texels per link, 1024 links wide (see linkTable.ts).
    const n = geometry.links.length;
    const rows = linkRows(n);
    this.linkRowsN = rows;
    const table = new Float32Array(LINK_TEX_WIDTH * 3 * rows * 4);
    const put = (i: number, row: number, v: number[]) => {
      const [x, y] = linkTexel(i, row, n);
      table.set(v, (y * LINK_TEX_WIDTH + x) * 4);
    };
    geometry.links.forEach((l, i) => {
      put(i, 0, [l.x0, l.y0, l.x1, l.y1]);
      put(i, 1, [l.nx, l.ny, l.width, l.lanes]);
      put(i, 2, [l.length, 0, 0, 0]);
    });
    gl.bindTexture(gl.TEXTURE_2D, this.linkTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LINK_TEX_WIDTH, 3 * rows, 0, gl.RGBA, gl.FLOAT, table);
    // per-link state (closed, selected, hovered, occupancy): link i at (i mod 1024, floor(i / 1024))
    this.stateBytes = new Uint8Array(LINK_TEX_WIDTH * rows * 4);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, LINK_TEX_WIDTH, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.stateBytes);
  }

  /**
   * Upload one frame's records (the AoS buffer as is: the shader reads their flags). The caller pushes the
   * same frame to the presenter and may then return the buffer.
   */
  setFrame(words: Uint32Array, count: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vehBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(words.buffer, words.byteOffset, count * VEHICLE_RECORD_BYTES), gl.STREAM_DRAW);
    this.frameCount = count;
  }

  /** The presenter cars are drawn with (null: none drawn). */
  setPresenter(p: Presenter | null): void {
    this.presenter = p;
    this.vehCount = 0;
  }

  /**
   * Advance the presentation to `nowMs` and upload every car's presented pose; Follow, the ring and the
   * hooks then read the same state until the next call.
   */
  advance(nowMs: number): void {
    const p = this.presenter;
    if (!p || this.frameCount === 0) {
      this.vehCount = 0;
      return;
    }
    p.advance(nowMs);
    if (this.poses.length < this.frameCount * 4) this.poses = new Float32Array(Math.max(this.frameCount * 4, this.poses.length * 2));
    const n = Math.min(p.writePoses(this.poses), this.frameCount);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.poseBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.poses.subarray(0, n * 4), gl.STREAM_DRAW);
    this.vehCount = n;
  }

  /** `linkCounts`: vehicles per link; congestion is drawn by occupancy (vehicles ÷ capacity). */
  setLinkState(closed: ArrayLike<number>, selected: number | null, hovered: number | null, linkCounts: Uint16Array): void {
    const geometry = this.geometry;
    if (!geometry) return;
    const b = this.stateBytes;
    b.fill(0);
    for (let i = 0; i < closed.length; i++) b[closed[i]! * 4] = 255;
    if (selected !== null && selected < geometry.links.length) b[selected * 4 + 1] = 255;
    if (hovered !== null && hovered < geometry.links.length) b[hovered * 4 + 2] = 255;
    geometry.links.forEach((l, i) => {
      b[i * 4 + 3] = Math.min(255, Math.round((255 * (linkCounts[i] ?? 0)) / linkCapacity(l.lanes, l.length)));
    });
    this.uploadState();
    // Rebuild the barrier mesh only when the closed set changes.
    const prev = this.barClosed;
    let same = prev.length === closed.length;
    for (let i = 0; same && i < closed.length; i++) same = prev[i] === closed[i];
    if (!same) {
      this.barClosed = Array.from(closed);
      this.deleteMesh(this.bars);
      this.bars = this.barMesh(closed);
    }
  }

  /** The inspected vehicle (from the same frame as the last `setFrame`), or null. */
  setTracked(t: TrackedVehicle | null): void {
    const gl = this.gl;
    const sameRoute =
      !!t && !!this.tracked && t.route.length === this.tracked.route.length && t.route.every((l, i) => l === this.tracked!.route[i]);
    this.tracked = t;
    if (sameRoute) return;
    if (this.route) {
      gl.deleteVertexArray(this.route.vao);
      gl.deleteBuffer(this.route.buf);
      this.route = null;
    }
    const geometry = this.geometry;
    if (!t || !geometry || t.route.length === 0) return;
    // centre, normal, side, along (m) per vertex; one quad per remaining route link
    const v: number[] = [];
    let along = 0;
    for (const id of t.route) {
      const l = geometry.links[id];
      if (!l) continue;
      const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
      const c = (end: 0 | 1, side: number) =>
        v.push(end ? l.x1 : l.x0, end ? l.y1 : l.y0, l.nx, l.ny, side, along + (end ? len : 0));
      c(0, -1);
      c(1, -1);
      c(1, 1);
      c(0, -1);
      c(1, 1);
      c(0, 1);
      along += len;
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const F = 4;
    for (const [loc, size, off] of [
      [0, 2, 0],
      [1, 2, 2],
      [2, 1, 4],
      [3, 1, 5],
    ] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 6 * F, off * F);
    }
    gl.bindVertexArray(null);
    this.route = { vao, buf, count: v.length / 6 };
  }

  /** Record `record` of the newest frame as presented now (motion-002), or null. */
  presented(record: number): PresentedVehicle | null {
    return this.presenter?.record(record) ?? null;
  }

  /** The tracked vehicle as presented now (link, ŝ, lane, next and the lane it enters next on, world m). */
  trackedDraw(): { link: number; s: number; length: number; lane: number; next: number; nextLane: number; world: [number, number] } | null {
    const t = this.tracked;
    const links = this.geometry?.links;
    const p = this.presenter;
    if (!t || !links || !p || t.link < 0) return null;
    const v = p.vehicle(t.tripId);
    if (v) {
      const nl = v.next !== NO_NEXT ? links[v.next] : undefined;
      return { link: v.link, s: v.s, length: links[v.link]!.length, lane: v.lane, next: v.next, nextLane: nl ? Math.min(v.lane, nl.lanes - 1) : v.lane, world: [v.pose.x, v.pose.y] };
    }
    // not in the presented frames (yet): its frame position by the same visual rule
    const l = links[t.link];
    if (!l) return null;
    const s = visualS(l, p.clearances(), t.s);
    const [x, y] = vehiclePosition(l, Math.min(s, l.length), Math.min(t.lane, l.lanes - 1));
    return { link: t.link, s, length: l.length, lane: t.lane, next: NO_NEXT, nextLane: t.lane, world: [x, y] };
  }

  /** Where the tracked vehicle is drawn now (world m): Follow and the ring agree with the picture. */
  trackedWorldPosition(): [number, number] | null {
    return this.trackedDraw()?.world ?? null;
  }

  private uploadState(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LINK_TEX_WIDTH, this.linkRowsN, gl.RGBA, gl.UNSIGNED_BYTE, this.stateBytes);
  }

  /** Deck quads (c0, c1, c2, c0, c2, c3; long sides c0–c1, c3–c2) as centre line + half width. */
  private deckMesh(d: Float32Array): Mesh {
    const gl = this.gl;
    const v: number[] = []; // centre(2), normal(2), side(1), half width m(1)
    for (let i = 0; i + 12 <= d.length; i += 12) {
      const [x0, y0, x1, y1, x2, y2, x3, y3] = [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!, d[i + 4]!, d[i + 5]!, d[i + 10]!, d[i + 11]!];
      const half = Math.hypot(x0 - x3, y0 - y3) / 2;
      if (half === 0) continue;
      const [nx, ny] = [(x0 - x3) / (2 * half), (y0 - y3) / (2 * half)];
      const [ax, ay, bx, by] = [(x0 + x3) / 2, (y0 + y3) / 2, (x1 + x2) / 2, (y1 + y2) / 2];
      for (const [end, side] of [[0, 1], [1, 1], [1, -1], [0, 1], [1, -1], [0, -1]] as const) {
        v.push(end ? bx : ax, end ? by : ay, nx, ny, side, half);
      }
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const F = 4;
    for (const [loc, size, off] of [
      [0, 2, 0],
      [1, 2, 2],
      [2, 1, 4],
      [3, 1, 5],
    ] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 6 * F, off * F);
    }
    gl.bindVertexArray(null);
    return { vao, buf, count: v.length / 6 };
  }

  /** Barrier bars across each closed link (positions in world m; size in CSS px, in the shader). */
  private barMesh(closed: ArrayLike<number>): Mesh {
    const gl = this.gl;
    const v: number[] = []; // centre(2), dir(2), corner(2), half width m (1)
    const geometry = this.geometry!;
    for (let i = 0; i < closed.length; i++) {
      const l = geometry.links[closed[i]!];
      if (!l) continue;
      const dx = l.x1 - l.x0;
      const dy = l.y1 - l.y0;
      const len = Math.hypot(dx, dy) || 1;
      for (const t of BARRIER_AT) {
        const cx = l.x0 + dx * t;
        const cy = l.y0 + dy * t;
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]] as const) {
          v.push(cx, cy, dx / len, dy / len, a, b, l.width / 2);
        }
      }
      // the closure sign at the midpoint, visible at every zoom (half width −1 marks it for the shader)
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]] as const) {
        v.push(l.x0 + dx * 0.5, l.y0 + dy * 0.5, dx / len, dy / len, a, b, -1);
      }
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const F = 4;
    for (const [loc, size, off] of [
      [0, 2, 0],
      [1, 2, 2],
      [2, 2, 4],
      [3, 1, 6],
    ] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 7 * F, off * F);
    }
    gl.bindVertexArray(null);
    return { vao, buf, count: v.length / 7 };
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Draw one picture (cars where the last `advance` presented them). */
  draw(camera: Camera): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const bg = COLORS.background;
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.roads) return;
    const scale: [number, number] = [(2 * camera.zoom) / camera.width, (2 * camera.zoom) / camera.height];

    const uS = this.uSolid;
    gl.useProgram(this.solid);
    gl.uniform2f(uS['u_center']!, camera.cx, camera.cy);
    gl.uniform2f(uS['u_scale']!, ...scale);
    const color = uS['u_color']!;
    const fill = (mesh: Mesh | null, c: readonly number[], mode: number = gl.TRIANGLES) => {
      if (!mesh || mesh.count === 0) return;
      gl.uniform3f(color, c[0]!, c[1]!, c[2]!);
      gl.bindVertexArray(mesh.vao);
      gl.drawArrays(mode, 0, mesh.count);
    };
    fill(this.water, COLORS.water);
    fill(this.banks, COLORS.bank);
    fill(this.parks, COLORS.park);
    fill(this.buildings, COLORS.building);
    if (camera.zoom >= LOD_DETAIL_PX_PER_M) fill(this.outlines, COLORS.outline, gl.LINES);
    if (this.decks && this.decks.count > 0) {
      const uD = this.uDeck;
      gl.useProgram(this.deckProg);
      gl.uniform2f(uD['u_center']!, camera.cx, camera.cy);
      gl.uniform2f(uD['u_scale']!, ...scale);
      gl.uniform1f(uD['u_pxPerM']!, camera.zoom);
      gl.bindVertexArray(this.decks.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.decks.count);
      gl.useProgram(this.solid);
    }
    fill(this.pads, COLORS.pad);

    const uR = this.uRoad;
    gl.useProgram(this.road);
    gl.uniform2f(uR['u_center']!, camera.cx, camera.cy);
    gl.uniform2f(uR['u_scale']!, ...scale);
    gl.uniform1f(uR['u_pxPerM']!, camera.zoom);
    gl.uniform1i(uR['u_linkRows']!, this.linkRowsN);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.uniform1i(uR['u_state']!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.linkTex);
    gl.uniform1i(uR['u_links']!, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.roads.vao);
    // base roads, then congested ones on top, then the halo
    for (const pass of [0, 3, 1]) {
      gl.uniform1i(uR['u_pass']!, pass);
      gl.drawArrays(gl.TRIANGLES, 0, this.roads.count);
    }

    if (this.route) {
      const uRt = this.uRoute;
      gl.useProgram(this.routeProg);
      gl.uniform2f(uRt['u_center']!, camera.cx, camera.cy);
      gl.uniform2f(uRt['u_scale']!, ...scale);
      gl.uniform1f(uRt['u_pxPerM']!, camera.zoom);
      gl.bindVertexArray(this.route.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.route.count);
    }

    // closed roads on top of route and halo: hatch, then barriers
    gl.useProgram(this.road);
    gl.bindVertexArray(this.roads.vao);
    gl.uniform1i(uR['u_pass']!, 2);
    gl.drawArrays(gl.TRIANGLES, 0, this.roads.count);

    if (this.bars && this.bars.count > 0) {
      const uB = this.uBar;
      gl.useProgram(this.barProg);
      gl.uniform2f(uB['u_center']!, camera.cx, camera.cy);
      gl.uniform2f(uB['u_scale']!, ...scale);
      gl.uniform1f(uB['u_pxPerM']!, camera.zoom);
      gl.bindVertexArray(this.bars.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.bars.count);
    }

    if (this.vehCount > 0 && !this.hideVehicles) {
      const uV = this.uVeh;
      gl.useProgram(this.veh);
      gl.uniform2f(uV['u_center']!, camera.cx, camera.cy);
      gl.uniform2f(uV['u_scale']!, ...scale);
      gl.uniform1f(uV['u_pxPerM']!, camera.zoom);
      gl.bindVertexArray(this.vehVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.vehCount);
    }

    const at = this.trackedWorldPosition();
    if (at) {
      const uRg = this.uRing;
      gl.useProgram(this.ringProg);
      gl.uniform2f(uRg['u_center']!, camera.cx, camera.cy);
      gl.uniform2f(uRg['u_scale']!, ...scale);
      gl.uniform1f(uRg['u_pxPerM']!, camera.zoom);
      gl.uniform2f(uRg['u_at']!, at[0], at[1]);
      gl.bindVertexArray(this.ringVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindVertexArray(null);
  }
}

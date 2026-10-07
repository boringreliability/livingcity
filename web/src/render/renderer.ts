import { VEHICLE_RECORD_BYTES } from '../sim/protocol';
import type { Camera } from './camera';
import type { Decor } from './decor';
import { LANE_WIDTH_M, type RoadGeometry } from './geometry';

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

const COLORS = {
  background: [0.055, 0.067, 0.082],
  water: [0.075, 0.18, 0.27],
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

// Roads: one quad per link, extruded in the shader so roads keep a minimum
// on-screen width; closed roads are drawn wider with a screen-space hatch.
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
uniform int u_pass; // 0: every road, no halo; 1: only selected/hovered roads, with halo, on top
uniform sampler2D u_state;
out float v_across;
out float v_along;
out float v_lanes;
flat out float v_core; // share of the drawn half width that is road (the rest is the halo)
flat out vec4 v_state;
void main() {
  vec4 st = texelFetch(u_state, ivec2(int(a_link), 0), 0);
  bool highlighted = st.g > 0.5 || st.b > 0.5;
  if (u_pass == 1 && !highlighted) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume: not drawn
    return;
  }
  float minPx = st.r > 0.5 ? 9.0 : 2.5;
  float core = max(a_halfWidth, 0.5 * minPx / u_pxPerM);
  float haloPx = u_pass == 1 ? (st.g > 0.5 ? ${SELECTED_HALO_PX.toFixed(1)} : ${HOVER_HALO_PX.toFixed(1)}) : 0.0;
  float hw = core + haloPx / u_pxPerM;
  vec2 p = a_center + a_normal * a_side * hw;
  gl_Position = vec4((p - u_center) * u_scale, 0.0, 1.0);
  v_across = a_side * hw / core; // ±1 at the road edge, beyond it in the halo
  v_core = core / hw;
  v_along = a_along;
  v_lanes = a_lanes;
  v_state = st;
}`;

const ROAD_FS = `#version 300 es
precision highp float;
in float v_across;
in float v_along;
in float v_lanes;
flat in float v_core;
flat in vec4 v_state;
uniform float u_pxPerM;
uniform float u_dpr;
out vec4 o;
void main() {
  vec3 base = vec3(0.24, 0.27, 0.31);
  // congestion: lighter and warmer road surface (lightness, not hue alone)
  base = mix(base, vec3(0.62, 0.52, 0.34), clamp(v_state.a, 0.0, 1.0) * 0.8);
  // lane separators: dashed, only when zoomed in enough to read them
  if (v_lanes > 1.5 && u_pxPerM > 1.5) {
    float lanePos = (v_across * 0.5 + 0.5) * v_lanes;
    float edge = abs(fract(lanePos + 0.5) - 0.5);
    if (edge < 0.04 && fract(v_along / 6.0) < 0.5) base = mix(base, vec3(0.7), 0.6);
  }
  if (v_state.r > 0.5) {
    // closed: black/yellow diagonal hatch, fixed in screen pixels (legible at any zoom and in grayscale)
    float k = floor((gl_FragCoord.x + gl_FragCoord.y) / (5.0 * u_dpr));
    base = mod(k, 2.0) < 1.0 ? vec3(0.95, 0.76, 0.16) : vec3(0.05, 0.05, 0.05);
  }
  // halo (pass 1 only): white for the selected road, light grey for the hovered one — lightness, not hue
  if (abs(v_across) > 1.0) base = v_state.g > 0.5 ? vec3(1.0) : vec3(0.72);
  o = vec4(base, 1.0);
}`;

// Vehicles: instanced quads from the AoS frame buffer (stride 16 bytes).
const VEH_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in uint a_link;
layout(location = 2) in float a_s;
layout(location = 3) in float a_v;
layout(location = 4) in uint a_flags;
uniform vec2 u_center;
uniform vec2 u_scale;
uniform float u_pxPerM;
uniform float u_dtSim;
uniform sampler2D u_links;
out vec2 v_local;
flat out uint v_flags;
flat out float v_band; // brake band length as a share of the vehicle (at least ~1.25 px)
void main() {
  int l = int(a_link);
  vec4 ends = texelFetch(u_links, ivec2(l, 0), 0);  // x0, y0, x1, y1
  vec4 geo = texelFetch(u_links, ivec2(l, 1), 0);   // nx, ny, width, lanes
  float len = texelFetch(u_links, ivec2(l, 2), 0).x;
  float s = min(a_s + a_v * u_dtSim, len);
  vec2 n = geo.xy;
  vec2 dir = vec2(-n.y, n.x);
  float lane = float((a_flags >> 8u) & 255u);
  float lat = ((geo.w - 1.0) * 0.5 - lane) * ${LANE_WIDTH_M.toFixed(1)};
  vec2 p = mix(ends.xy, ends.zw, clamp(s / len, 0.0, 1.0)) + n * lat;
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

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`);
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
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
  private water: Mesh | null = null;
  private pads: Mesh | null = null;
  private roads: Mesh | null = null;
  private glyphs: Mesh | null = null;
  private glyphKey = '';
  private vehVao: WebGLVertexArrayObject;
  private vehBuf: WebGLBuffer;
  private vehQuad: WebGLBuffer;
  private readonly uSolid: Uniforms;
  private readonly uRoad: Uniforms;
  private readonly uVeh: Uniforms;
  private vehCount = 0;
  private linkTex: WebGLTexture;
  private stateTex: WebGLTexture;
  private stateBytes = new Uint8Array(0);
  private geometry: RoadGeometry | null = null;
  private frameAtMs = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.solid = compile(gl, SOLID_VS, SOLID_FS);
    this.road = compile(gl, ROAD_VS, ROAD_FS);
    this.veh = compile(gl, VEH_VS, VEH_FS);
    this.uSolid = uniforms(gl, this.solid, ['u_center', 'u_scale', 'u_color']);
    this.uRoad = uniforms(gl, this.road, ['u_center', 'u_scale', 'u_pxPerM', 'u_dpr', 'u_pass', 'u_state']);
    this.uVeh = uniforms(gl, this.veh, ['u_center', 'u_scale', 'u_pxPerM', 'u_dtSim', 'u_links']);
    this.linkTex = gl.createTexture()!;
    this.stateTex = gl.createTexture()!;
    for (const t of [this.linkTex, this.stateTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    // Vehicle VAO: a unit quad (per vertex) + the frame records (per instance).
    this.vehVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vehVao);
    const quad = gl.createBuffer()!;
    this.vehQuad = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -0.5, 1, -0.5, 1, 0.5, 0, -0.5, 1, 0.5, 0, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vehBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vehBuf);
    const stride = VEHICLE_RECORD_BYTES;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, stride, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 4);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, stride, 12);
    for (const loc of [1, 2, 3, 4]) gl.vertexAttribDivisor(loc, 1);
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

  /** Free every GPU object (the canvas may be reused, e.g. React StrictMode remounts). */
  dispose(): void {
    const gl = this.gl;
    for (const m of [this.water, this.pads, this.roads, this.glyphs]) this.deleteMesh(m);
    this.water = this.pads = this.roads = this.glyphs = null;
    gl.deleteVertexArray(this.vehVao);
    gl.deleteBuffer(this.vehBuf);
    gl.deleteBuffer(this.vehQuad);
    gl.deleteTexture(this.linkTex);
    gl.deleteTexture(this.stateTex);
    for (const p of [this.solid, this.road, this.veh]) gl.deleteProgram(p);
  }

  setNetwork(geometry: RoadGeometry, decor: Decor): void {
    const gl = this.gl;
    this.geometry = geometry;
    for (const m of [this.water, this.pads, this.roads]) this.deleteMesh(m);
    this.water = this.solidMesh(decor.water);
    this.pads = this.solidMesh(decor.pads);

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

    // Link table: 3 RGBA32F texels per link.
    const n = geometry.links.length;
    const table = new Float32Array(n * 3 * 4);
    geometry.links.forEach((l, i) => {
      table.set([l.x0, l.y0, l.x1, l.y1], i * 4);
      table.set([l.nx, l.ny, l.width, l.lanes], (n + i) * 4);
      table.set([l.length, 0, 0, 0], (2 * n + i) * 4);
    });
    gl.bindTexture(gl.TEXTURE_2D, this.linkTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 3, 0, gl.RGBA, gl.FLOAT, table);
    this.stateBytes = new Uint8Array(n * 4);
    this.uploadState();
  }

  /** Upload one frame's records (the AoS buffer as is). The caller may then return the buffer. */
  setFrame(words: Uint32Array, count: number, receivedAtMs: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vehBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(words.buffer, words.byteOffset, count * VEHICLE_RECORD_BYTES), gl.STREAM_DRAW);
    this.vehCount = count;
    this.frameAtMs = receivedAtMs;
  }

  setLinkState(closed: ArrayLike<number>, selected: number | null, hovered: number | null, linkQueued: Uint16Array): void {
    const geometry = this.geometry;
    if (!geometry) return;
    const b = this.stateBytes;
    b.fill(0);
    for (let i = 0; i < closed.length; i++) b[closed[i]! * 4] = 255;
    if (selected !== null && selected < geometry.links.length) b[selected * 4 + 1] = 255;
    if (hovered !== null && hovered < geometry.links.length) b[hovered * 4 + 2] = 255;
    geometry.links.forEach((l, i) => {
      const capacity = Math.max(1, (l.lanes * l.length) / 7.5);
      b[i * 4 + 3] = Math.min(255, Math.round((255 * (linkQueued[i] ?? 0)) / capacity));
    });
    this.uploadState();
    // Rebuild the static barrier glyphs only when the closed set changes.
    const key = Array.from(closed).join(',');
    if (key !== this.glyphKey) {
      this.glyphKey = key;
      this.deleteMesh(this.glyphs);
      this.glyphs = this.solidMesh(this.barrierGlyphs(closed));
    }
  }

  private uploadState(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.stateBytes.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.stateBytes);
  }

  /** Static barrier bars across both ends of each closed link. */
  private barrierGlyphs(closed: ArrayLike<number>): Float32Array {
    const out: number[] = [];
    const geometry = this.geometry!;
    for (let i = 0; i < closed.length; i++) {
      const l = geometry.links[closed[i]!];
      if (!l) continue;
      const dx = l.x1 - l.x0;
      const dy = l.y1 - l.y0;
      const len = Math.hypot(dx, dy) || 1;
      const [ux, uy] = [dx / len, dy / len];
      for (const t of [0.12, 0.88]) {
        const cx = l.x0 + dx * t;
        const cy = l.y0 + dy * t;
        const hw = l.width / 2 + 1.5;
        const ht = 1.2;
        const p = (a: number, b: number) => [cx + l.nx * a + ux * b, cy + l.ny * a + uy * b];
        const [p0, p1, p2, p3] = [p(-hw, -ht), p(hw, -ht), p(hw, ht), p(-hw, ht)];
        out.push(...p0!, ...p1!, ...p2!, ...p0!, ...p2!, ...p3!);
      }
    }
    return new Float32Array(out);
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.dpr = dpr;
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Draw one picture. `simSecondsPerMs` is 0 while paused (nothing moves). */
  draw(camera: Camera, nowMs: number, simSecondsPerMs: number): void {
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
    for (const [mesh, c] of [
      [this.water, COLORS.water],
      [this.pads, COLORS.pad],
    ] as const) {
      if (!mesh) continue;
      gl.uniform3f(color, c[0], c[1], c[2]);
      gl.bindVertexArray(mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }

    const uR = this.uRoad;
    gl.useProgram(this.road);
    gl.uniform2f(uR['u_center']!, camera.cx, camera.cy);
    gl.uniform2f(uR['u_scale']!, ...scale);
    gl.uniform1f(uR['u_pxPerM']!, camera.zoom);
    gl.uniform1f(uR['u_dpr']!, this.dpr);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.uniform1i(uR['u_state']!, 0);
    gl.bindVertexArray(this.roads.vao);
    gl.uniform1i(uR['u_pass']!, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.roads.count);
    // pass 1: the selected / hovered road again, with its halo, above the roads that cross it
    gl.uniform1i(uR['u_pass']!, 1);
    gl.drawArrays(gl.TRIANGLES, 0, this.roads.count);

    if (this.glyphs && this.glyphs.count > 0) {
      gl.useProgram(this.solid);
      gl.uniform3f(color, 0.97, 0.97, 0.97);
      gl.bindVertexArray(this.glyphs.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.glyphs.count);
    }

    if (this.vehCount > 0) {
      const uV = this.uVeh;
      gl.useProgram(this.veh);
      gl.uniform2f(uV['u_center']!, camera.cx, camera.cy);
      gl.uniform2f(uV['u_scale']!, ...scale);
      gl.uniform1f(uV['u_pxPerM']!, camera.zoom);
      const dtSim = Math.min(2, Math.max(0, (nowMs - this.frameAtMs) * simSecondsPerMs));
      gl.uniform1f(uV['u_dtSim']!, dtSim);
      gl.bindTexture(gl.TEXTURE_2D, this.linkTex);
      gl.uniform1i(uV['u_links']!, 0);
      gl.bindVertexArray(this.vehVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.vehCount);
    }
    gl.bindVertexArray(null);
  }
}

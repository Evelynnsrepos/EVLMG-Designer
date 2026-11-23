/**
 * GLSL for Adjustments and Liquify (Sketch Pro). Textures are uploaded without
 * flipping, so `uv` (0..1) has y = 0 at the top of the picture and `uv * size`
 * is the canvas pixel. Colours are premultiplied, as the GPU blends them.
 */

export const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() { uv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }`

const HEAD = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D src;
uniform vec2 size;
out vec4 o;
vec4 unpre(vec4 c) { return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec4 pre(vec3 c, float a) { return vec4(clamp(c, 0.0, 1.0) * a, a); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec4 at(vec2 p) { return texture(src, p / size); }
`

/** Draw the result to the visible canvas, upright. */
export const PRESENT = `${HEAD}
void main() { o = texture(src, vec2(uv.x, 1.0 - uv.y)); }`

export const HSB = `${HEAD}
uniform float hue, sat, bright;
vec3 rgb2hsv(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float d = mx - min(c.r, min(c.g, c.b));
  float h = 0.0;
  if (d > 0.0) {
    if (mx == c.r) h = mod((c.g - c.b) / d + 6.0, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
  }
  return vec3(h / 6.0, mx > 0.0 ? d / mx : 0.0, mx);
}
vec3 hsv2rgb(vec3 c) {
  vec3 k = mod(vec3(5.0, 3.0, 1.0) + c.x * 6.0, 6.0);
  return c.z - c.z * c.y * clamp(min(k, 4.0 - k), 0.0, 1.0);
}
void main() {
  vec4 c = unpre(texture(src, uv));
  vec3 h = rgb2hsv(c.rgb);
  h.x = fract(h.x + hue / 360.0 + 1.0);
  h.y = clamp(sat < 0.0 ? h.y * (1.0 + sat) : h.y + (1.0 - h.y) * sat * h.y, 0.0, 1.0);
  h.z = clamp(bright < 0.0 ? h.z * (1.0 + bright) : h.z + (1.0 - h.z) * bright, 0.0, 1.0);
  o = pre(hsv2rgb(h), c.a);
}`

/** Lookup tables: per channel (curves, colour balance) or by brightness (gradient map). */
export const LUT = `${HEAD}
uniform sampler2D lut;
uniform float byLuma, keepLum, amount;
// Channels are picked with .r/.g/.b: indexing a vector with a variable gave the wrong channel on Mesa (AMD, WebKitGTK).
vec3 lk(float v) { return texture(lut, vec2((v * 255.0 + 0.5) / 256.0, 0.5)).rgb; }
void main() {
  vec4 c = unpre(texture(src, uv));
  vec3 r;
  if (byLuma > 0.5) {
    r = mix(c.rgb, lk(luma(c.rgb)), amount);
  } else {
    r = vec3(lk(c.r).r, lk(c.g).g, lk(c.b).b);
    if (keepLum > 0.5) r = clamp(r + luma(c.rgb) - luma(r), 0.0, 1.0);
  }
  o = pre(r, c.a);
}`

/** Values to opacity: see cpu.ts valueAlpha. */
export const VALUE_ALPHA = `${HEAD}
uniform float amount, reach, soft, keep, kr, kg, kb;
float dist(float c, float k) { return c > k ? (c - k) / (1.0 - k) : c < k ? (k - c) / k : 0.0; }
void main() {
  vec4 c = unpre(texture(src, uv));
  vec3 k = vec3(kr, kg, kb);
  float t = clamp((max(dist(c.r, k.r), max(dist(c.g, k.g), dist(c.b, k.b))) - reach) / max(soft, 1e-4), 0.0, 1.0);
  vec3 un = keep > 0.5 || t <= 0.0 ? c.rgb : clamp(k + (c.rgb - k) / t, 0.0, 1.0);
  o = pre(mix(c.rgb, un, amount), c.a * mix(1.0, t, amount));
}`

/** One direction of a Gaussian blur (run twice). */
export const GAUSS = `${HEAD}
uniform vec2 dir;
uniform float sigma;
void main() {
  if (sigma < 0.3) { o = texture(src, uv); return; }
  float r = ceil(sigma * 3.0);
  float st = max(1.0, r / 48.0);
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (float i = -48.0; i <= 48.0; i++) {
    float x = i * st;
    if (abs(x) > r) continue;
    float w = exp(-x * x / (2.0 * sigma * sigma));
    acc += texture(src, uv + dir * x / size) * w;
    ws += w;
  }
  o = acc / ws;
}`

export const MOTION = `${HEAD}
uniform vec2 dir;
uniform float len;
void main() {
  vec4 acc = vec4(0.0);
  for (float i = 0.0; i < 64.0; i++) acc += texture(src, uv + dir * len * (i / 63.0 - 0.5) / size);
  o = acc / 64.0;
}`

export const ZOOM = `${HEAD}
uniform vec2 center;
uniform float amount;
void main() {
  vec4 acc = vec4(0.0);
  vec2 c = center / size;
  for (float i = 0.0; i < 64.0; i++) acc += texture(src, mix(uv, c, amount * 0.5 * i / 63.0));
  o = acc / 64.0;
}`

export const NOISE = `${HEAD}
uniform float amount, scale, octaves, kind, seed;
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec4 c = unpre(texture(src, uv));
  vec2 p = uv * size / scale + seed * 17.0;
  float n = 0.0, a = 0.5, t = 0.0;
  for (float i = 0.0; i < 6.0; i++) {
    if (i >= octaves) break;
    float v = vnoise(p);
    if (kind > 1.5) v = 1.0 - abs(2.0 * v - 1.0);
    else if (kind > 0.5) v = abs(2.0 * v - 1.0);
    n += v * a; t += a; a *= 0.5; p *= 2.03;
  }
  n /= t;
  vec3 ov = mix(2.0 * c.rgb * n, 1.0 - 2.0 * (1.0 - c.rgb) * (1.0 - n), step(0.5, c.rgb));
  o = pre(mix(c.rgb, ov, amount), c.a);
}`

/** Unsharp mask: the picture plus its difference from a blurred copy. */
export const SHARPEN = `${HEAD}
uniform sampler2D blur;
uniform float amount;
void main() {
  vec4 c = texture(src, uv);
  vec4 r = clamp(c + (c - texture(blur, uv)) * amount, 0.0, 1.0);
  r.a = c.a;
  o = vec4(min(r.rgb, vec3(r.a)), r.a);
}`

export const BRIGHT = `${HEAD}
uniform float threshold;
void main() {
  vec4 c = texture(src, uv);
  vec4 s = unpre(c);
  o = c * smoothstep(threshold - 0.1, threshold, luma(s.rgb));
}`

/** Screen the blurred glow over the picture (alpha too, so the glow spreads past edges). */
export const GLOW = `${HEAD}
uniform sampler2D blur;
uniform float amount;
void main() {
  vec4 c = texture(src, uv);
  vec4 g = clamp(texture(blur, uv) * amount, 0.0, 1.0);
  o = 1.0 - (1.0 - c) * (1.0 - g);
}`

export const GLITCH = `${HEAD}
uniform float kind, amount, seed;
void main() {
  vec2 p = uv * size;
  vec2 off = vec2(0.0);
  float split = 0.0;
  if (kind < 0.5) {
    vec2 b = floor(p / vec2(96.0, 24.0));
    float h = hash(b + seed);
    if (h < amount * 0.6) { off.x = (hash(b + seed + 3.1) - 0.5) * amount * 240.0; split = 6.0 * amount; }
  } else if (kind < 1.5) {
    off.x = sin(p.y * 0.03 + seed) * amount * 30.0 + (hash(vec2(floor(p.y / 4.0), seed)) - 0.5) * amount * 8.0;
    split = 4.0 * amount;
  } else if (kind < 2.5) {
    float band = floor(p.y / 3.0);
    float h = hash(vec2(band, seed));
    if (h > 1.0 - amount * 0.3) off.x = (hash(vec2(band, seed + 1.0)) - 0.5) * 120.0 * amount;
    split = 10.0 * amount;
  } else {
    float band = floor((p.x + p.y) / 48.0);
    float h = hash(vec2(band, seed));
    if (h < amount * 0.7) off = vec2(1.0, -1.0) * (hash(vec2(band, seed + 2.0)) - 0.5) * amount * 90.0;
    split = 3.0 * amount;
  }
  vec4 r = at(p + off + vec2(split, 0.0));
  vec4 g = at(p + off);
  vec4 b = at(p + off - vec2(split, 0.0));
  float a = max(r.a, max(g.a, b.a));
  vec3 col = vec3(r.r, g.g, b.b);
  if (kind > 1.5 && kind < 2.5) col += (hash(vec2(floor(p.y), seed + 5.0)) - 0.5) * 0.15 * amount * a;
  o = vec4(clamp(col, 0.0, a), a);
}`

/** Dots on a rotated grid: how much of this pixel a dot covers, the dot's size from the picture at its cell. */
export const HALFTONE = `${HEAD}
uniform float mode, cell;
mat2 rot(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }
// Coverage of a dot for channel value v (picked by fn) on a grid turned by angle.
vec4 cellColor(vec2 p, float ang, out float d) {
  vec2 q = rot(ang) * p;
  vec2 cc = (floor(q / cell) + 0.5) * cell;
  d = length(q - cc) / cell;
  return unpre(at(rot(-ang) * cc));
}
float dot1(float v, float d) {
  float r = sqrt(clamp(v, 0.0, 1.0)) * 0.72;
  return smoothstep(r + 0.06, r - 0.06, d);
}
vec4 cmyk(vec3 c) {
  float k = 1.0 - max(c.r, max(c.g, c.b));
  float n = max(1e-4, 1.0 - k);
  return vec4((1.0 - c.r - k) / n, (1.0 - c.g - k) / n, (1.0 - c.b - k) / n, k);
}
void main() {
  vec2 p = uv * size;
  float a = texture(src, uv).a;
  float d;
  vec3 col;
  if (mode < 0.5) {
    float cc = dot1(cmyk(cellColor(p, 0.2618, d).rgb).x, d);
    float mm = dot1(cmyk(cellColor(p, 1.309, d).rgb).y, d);
    float yy = dot1(cmyk(cellColor(p, 0.0, d).rgb).z, d);
    float kk = dot1(cmyk(cellColor(p, 0.7854, d).rgb).w, d);
    col = vec3(1.0 - cc, 1.0 - mm, 1.0 - yy) * (1.0 - kk);
  } else if (mode < 1.5) {
    float rr = dot1(cellColor(p, 0.2618, d).r, d);
    float gg = dot1(cellColor(p, 1.309, d).g, d);
    float bb = dot1(cellColor(p, 0.7854, d).b, d);
    col = vec3(rr, gg, bb);
  } else {
    col = vec3(1.0 - dot1(1.0 - luma(cellColor(p, 0.7854, d).rgb), d));
  }
  o = pre(col, a);
}`

export const CHROMA = `${HEAD}
uniform float mode, amount, angle;
uniform vec2 center;
void main() {
  vec2 p = uv * size;
  vec2 off = mode < 0.5 ? (p - center) / max(size.x, size.y) * amount * 2.0 : vec2(cos(angle), sin(angle)) * amount;
  vec4 r = at(p + off);
  vec4 g = at(p);
  vec4 b = at(p - off);
  float a = max(r.a, max(g.a, b.a));
  o = vec4(r.r, g.g, b.b, a);
}`

/** Liquify: each pixel takes its colour from where the displacement field points. */
export const WARP = `${HEAD}
uniform sampler2D field;
uniform float cellSize, amount;
vec2 fd(ivec2 i) {
  ivec2 n = textureSize(field, 0) - 1;
  return texelFetch(field, clamp(i, ivec2(0), n), 0).rg;
}
void main() {
  vec2 p = uv * size;
  vec2 g = p / cellSize;
  ivec2 i = ivec2(floor(g));
  vec2 f = fract(g);
  vec2 d = mix(mix(fd(i), fd(i + ivec2(1, 0)), f.x), mix(fd(i + ivec2(0, 1)), fd(i + ivec2(1, 1)), f.x), f.y);
  vec2 q = (p + d * amount) / size;
  o = q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0 ? vec4(0.0) : texture(src, q);
}`

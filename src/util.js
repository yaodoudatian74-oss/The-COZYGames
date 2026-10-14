// 数学・乱数・ノイズ・保存(すべて決定的)
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const angleLerp = (a, b, t) => a + (((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI) * t;

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 文字列/数値のシードから乱数関数を作る
export const rngFrom = (seed) => mulberry32(typeof seed === 'string' ? hashStr(seed) : seed);

export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 値ノイズ [-1,1]
export function vnoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * u, bot = c + (d - c) * u;
  return (top + (bot - top) * v) * 2 - 1;
}

export function fbm(x, y, seed = 0, oct = 4) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, y * f, seed + i * 31);
    n += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

// 配列からランダムに1つ
export const pickOf = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ---- 保存 (localStorage。使えない環境では何もしない) ----
const KEY = 'hidamari-island-v1';
export function loadSave() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function writeSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 保存できない環境は無視 */ }
}
export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* 無視 */ }
}

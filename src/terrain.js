// 地形の高さ場・川/湖/橋・村の配置。描画・当たり判定・植物配置はすべてここを参照する
import { fbm, smoothstep, lerp, clamp, rngFrom, pickOf } from './util.js';

export const HALF = 60; // 島は約 120 x 120 単位 (1単位 ≒ 1歩)
export const SEA_Y = 0;

export const LAKE = { x: -24, z: -18, r: 7 };
const RIVER = [[-22, -12], [-14, -4], [-8, 2], [-2, 6], [4, 8], [10, 16], [16, 26], [22, 38], [30, 50], [38, 60], [46, 70]];
export const BRIDGE = { x: 1, z: 7, len: 6.4, wid: 2.2 };
// 村の平地 (中心・半径・高さ)
export const PADS = [{ x: -20, z: 18, r: 12, h: 1.05 }];
export const PATH = [[-20, 18], [-30, 12], [-38, 8], [-18, 28], [-6, 22], [-6, 12], [-2, 4]];

const bump = (x, z, cx, cz, r) => Math.exp(-1.5 * ((x - cx) ** 2 + (z - cz) ** 2) / (r * r));

function segDist(x, z, a, b) {
  const abx = b[0] - a[0], abz = b[1] - a[1];
  const t = clamp(((x - a[0]) * abx + (z - a[1]) * abz) / (abx * abx + abz * abz), 0, 1);
  return Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t));
}
function polyDist(x, z, pts) {
  let d = 1e9;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, z, pts[i], pts[i + 1]));
  return d;
}
const riverDist = (x, z) => polyDist(x, z, RIVER);
export const pathDist = (x, z) => polyDist(x, z, PATH);

// 基本の高さ (水面 SEA_Y より低い所は水になる)
export function heightAt(x, z) {
  const warp = fbm(x * 0.03 + 4, z * 0.03 - 9, 3, 3) * 0.2;
  const r = Math.hypot((x / HALF) * 1.05, (z / HALF) * 1.12) + warp;
  const coast = smoothstep(1.0, 0.8, r);
  let g = 0.85 + fbm(x * 0.045, z * 0.045, 7, 4) * 1.3;
  g += 2.8 * bump(x, z, 26, -26, 15) + 0.9 * bump(x, z, -36, 34, 11);
  let h = -2.2 + (g + 2.2) * coast;
  h = lerp(h, -0.35, smoothstep(2.6, 0.9, riverDist(x, z)));
  h = lerp(h, -0.6, smoothstep(1.1, 0.6, Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r));
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r + 6) h = lerp(h, p.h, smoothstep(p.r + 6, p.r, d));
  }
  return h;
}

export function slopeAt(x, z) {
  const e = 0.5;
  const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return Math.hypot(dx, dz);
}

export function onBridge(x, z) {
  const dx = x - BRIDGE.x, dz = z - BRIDGE.z;
  // 川の流れ方向 (6,2) に直交する方向へ橋を架ける
  const ax = -0.316, az = 0.949, bx = 0.949, bz = 0.316;
  return Math.abs(dx * ax + dz * az) < BRIDGE.len / 2 && Math.abs(dx * bx + dz * bz) < BRIDGE.wid / 2;
}
export const BRIDGE_DECK_Y = 0.32;

// 水の種類: null=陸, 'sea' | 'river' | 'pond'
export function waterKindAt(x, z) {
  const h = heightAt(x, z);
  if (h >= 0 || onBridge(x, z)) return null;
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 1) return 'pond';
  if (riverDist(x, z) < 3.5 && Math.hypot(x, z) < 50) return 'river';
  return 'sea';
}

// 歩けるか。水・急な崖は不可。橋の上は可
export function walkable(x, z) {
  if (onBridge(x, z)) return true;
  if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) return false;
  if (heightAt(x, z) < 0.05) return false;
  return slopeAt(x, z) < 0.95;
}
export function groundY(x, z) {
  return onBridge(x, z) ? BRIDGE_DECK_Y : Math.max(heightAt(x, z), SEA_Y);
}

// 近くで平らな場所を探す (建物・物の設置用)
export function findSpot(x, z, maxR = 14) {
  for (let r = 0; r <= maxR; r += 1) {
    for (let k = 0; k < Math.max(8, r * 6); k++) {
      const a = (k / Math.max(8, r * 6)) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const h = heightAt(px, pz);
      if (h > 0.4 && h < 3 && slopeAt(px, pz) < 0.35 && !onBridge(px, pz)) return { x: px, z: pz, h };
    }
  }
  return { x, z, h: heightAt(x, z) };
}

// 村の建物(位置は findSpot で調整される)
export const HOUSE_SITES = [
  [-36, 20], [-12, 26], [-26, 30], [-10, 9], [-14, 2], [-34, 4], [-42, 16], [-22, 40], [-2, 30],
];
export const SHOP_SITE = [-30, 12];
export const PLAYER_HOUSE_SITE = [-14, 36];
export const PLAZA = { x: -20, z: 18 };

// 物語の場所 (最寄りの陸地を探す)
export function shardSites() {
  return {
    hill: findSpot(-36, -34, 16),
    lake: findSpot(LAKE.x + 6, LAKE.z - 2, 8),
    ruins: findSpot(12, -40, 16),
    lighthouse: findSpot(-48, -6, 16),
  };
}

// 植物・岩の配置 (乱数シード固定)
export function scatter(seed = 'island') {
  const rng = rngFrom(seed);
  const trees = [], rocks = [], flowers = [], grass = [];
  const avoid = (x, z) => {
    if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < 17) return true;
    if (polyDist(x, z, PATH) < 2.6) return true;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 2.5) return true;
    if (riverDist(x, z) < 3.2) return true;
    return false;
  };
  for (let i = 0; i < 9000 && trees.length < 150; i++) {
    const x = (rng() * 2 - 1) * (HALF - 3), z = (rng() * 2 - 1) * (HALF - 3);
    if (avoid(x, z) || !walkable(x, z)) continue;
    const h = heightAt(x, z);
    if (h < 0.6) continue;
    if (rng() < 0.55) {
      const kind = pickOf(rng, ['oak', 'oak', 'pine', 'pine', 'cherry', 'fruit']);
      trees.push({ x, z, kind, s: 0.8 + rng() * 0.5, ry: rng() * 6.28 });
    } else if (rng() < 0.7) {
      rocks.push({ x, z, s: 0.6 + rng() * 0.9, ry: rng() * 6.28 });
    }
  }
  // 草と花 (大量なので乱数で間引く)
  for (let i = 0; i < 40000 && grass.length < 26000; i++) {
    const x = (rng() * 2 - 1) * (HALF - 1), z = (rng() * 2 - 1) * (HALF - 1);
    const h = heightAt(x, z);
    if (h < 0.25 || slopeAt(x, z) > 0.45) continue; // 水辺・崖は除外 (歩ける条件を満たす)
    grass.push([x, h, z, rng(), rng()]);
    if (rng() < 0.035 && !avoid(x, z)) flowers.push([x, h, z, Math.floor(rng() * 5), rng()]);
  }
  return { trees, rocks, flowers, grass };
}

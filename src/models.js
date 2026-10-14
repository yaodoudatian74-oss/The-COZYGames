// 3Dモデル生成。外部アセットは使わず、プリミティブの組み立てと色の設計で作る
import * as THREE from 'three';
import { rngFrom, TAU } from './util.js';
import { infoOf, CROPS, BUG_WINGS } from './data.js';

export const WIND = { uTime: { value: 0 } };
const SKIN = [28, 62, 86];

// ---------- 共通 ----------
const GEO = {};
function geo(n) {
  if (GEO[n]) return GEO[n];
  const make = {
    sph: () => new THREE.SphereGeometry(1, 16, 12),
    box: () => new THREE.BoxGeometry(1, 1, 1),
    cyl: () => new THREE.CylinderGeometry(1, 1, 1, 14),
    cone: () => new THREE.ConeGeometry(1, 1, 14),
    ico1: () => new THREE.IcosahedronGeometry(1, 1),
    ico0: () => new THREE.IcosahedronGeometry(1, 0),
    disc: () => new THREE.CircleGeometry(1, 20),
    tor: () => new THREE.TorusGeometry(1, 0.06, 8, 24),
  }[n];
  return (GEO[n] = make());
}

export function col(c) {
  if (c && c.isColor) return c;
  if (typeof c === 'string') return new THREE.Color(c);
  return new THREE.Color().setHSL(c[0] / 360, c[1] / 100, c[2] / 100, THREE.SRGBColorSpace);
}

const MATS = new Map();
export function mat(c, o = {}) {
  if (Object.keys(o).length) return new THREE.MeshLambertMaterial({ color: col(c), ...o });
  const key = typeof c === 'string' ? c : c.join(',');
  let m = MATS.get(key);
  if (!m) { m = new THREE.MeshLambertMaterial({ color: col(c) }); MATS.set(key, m); }
  return m;
}

// 草木などが風で揺れる素材 (頂点の高さに応じて揺れる)
const WMATS = new Map();
export function windMat(c, amp = 0.04, speed = 1.3) {
  const key = (typeof c === 'string' ? c : c.join(',')) + '|' + amp + '|' + speed;
  if (WMATS.has(key)) return WMATS.get(key);
  const m = new THREE.MeshLambertMaterial({ color: col(c) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WIND.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float wph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
#else
  float wph = modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.23;
#endif
  float wy = max(position.y, 0.0);
  transformed.x += sin(uTime * ${speed.toFixed(2)} + wph) * ${amp.toFixed(3)} * wy;
  transformed.z += cos(uTime * ${(speed * 0.7).toFixed(2)} + wph * 1.3) * ${(amp * 0.5).toFixed(3)} * wy;`);
  };
  m.customProgramCacheKey = () => 'wind' + key;
  WMATS.set(key, m);
  return m;
}

// 形を1つ置く。s は一様倍率、sx/sy/sz は個別倍率
export function P(parent, shape, c, o = {}) {
  const material = c && c.isMaterial ? c : mat(c, o.m || {});
  const m = new THREE.Mesh(geo(shape), material);
  m.position.set(o.x || 0, o.y || 0, o.z || 0);
  const s = o.s ?? 1;
  m.scale.set((o.sx ?? 1) * s, (o.sy ?? 1) * s, (o.sz ?? 1) * s);
  m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  m.castShadow = o.cast !== false;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---------- キャラクター ----------
// look: { outfit, pants, shoe, hair, hat }
export function makePlayer(look) {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const legL = pivot(body, -0.12, 0.34, 0), legR = pivot(body, 0.12, 0.34, 0);
  for (const l of [legL, legR]) {
    P(l, 'cyl', look.pants, { y: -0.15, sx: 0.09, sy: 0.3, sz: 0.09 });
    P(l, 'sph', look.shoe, { y: -0.32, z: 0.03, sx: 0.11, sy: 0.07, sz: 0.15 });
  }
  P(body, 'cyl', look.outfit, { y: 0.6, sx: 0.26, sy: 0.5, sz: 0.22 });
  P(body, 'sph', look.outfit, { y: 0.85, sx: 0.26, sy: 0.12, sz: 0.22 });
  P(body, 'sph', look.outfit, { y: 0.36, sx: 0.26, sy: 0.1, sz: 0.22 });
  const armL = pivot(body, -0.33, 0.8, 0), armR = pivot(body, 0.33, 0.8, 0);
  for (const a of [armL, armR]) {
    P(a, 'cyl', look.outfit, { y: -0.2, sx: 0.075, sy: 0.4, sz: 0.075 });
    P(a, 'sph', SKIN, { y: -0.44, s: 0.09 });
  }
  const head = pivot(body, 0, 1.12, 0);
  P(head, 'sph', SKIN, { sx: 0.4, sy: 0.38, sz: 0.4 });
  P(head, 'sph', look.hair, { y: 0.07, z: -0.03, sx: 0.43, sy: 0.36, sz: 0.44 });
  P(head, 'sph', look.hair, { y: 0.16, z: 0.22, sx: 0.26, sy: 0.12, sz: 0.14 });
  for (const sx of [-1, 1]) {
    P(head, 'sph', [28, 20, 12], { x: 0.15 * sx, y: -0.02, z: 0.37, sx: 0.055, sy: 0.075, sz: 0.03 });
    P(head, 'sph', [0, 0, 100], { x: 0.135 * sx, y: 0.01, z: 0.395, s: 0.02, cast: false });
    P(head, 'disc', [352, 80, 80], { x: 0.25 * sx, y: -0.1, z: 0.335, s: 0.07, m: { transparent: true, opacity: 0.55 } });
  }
  P(head, 'box', [10, 30, 20], { y: -0.13, z: 0.39, sx: 0.05, sy: 0.02, sz: 0.02 });
  if (look.hat) {
    P(head, 'cyl', [40, 60, 70], { y: 0.3, sx: 0.5, sy: 0.04, sz: 0.5 });
    P(head, 'cone', [40, 60, 70], { y: 0.46, sx: 0.28, sy: 0.22, sz: 0.28 });
  }
  return { root, body, head, legL, legR, armL, armR };
}

// 動物の住民
export function makeVillager(v) {
  const root = new THREE.Group();
  const fur = v.fur, belly = v.belly;
  const sp = v.species;
  const body = pivot(root, 0, 0, 0);
  if (sp === 'penguin') {
    P(body, 'sph', fur, { y: 0.62, sx: 0.36, sy: 0.46, sz: 0.32 });
    P(body, 'sph', belly, { y: 0.56, z: 0.14, sx: 0.24, sy: 0.36, sz: 0.2 });
  } else if (sp === 'sheep') {
    P(body, 'sph', belly, { y: 0.62, sx: 0.44, sy: 0.4, sz: 0.4 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      P(body, 'sph', belly, { x: Math.cos(a) * 0.36, y: 0.62 + Math.sin(i * 2.1) * 0.12, z: Math.sin(a) * 0.3, s: 0.2 });
    }
  } else {
    P(body, 'sph', fur, { y: 0.62, sx: 0.4, sy: 0.4, sz: 0.36 });
    P(body, 'sph', belly, { y: 0.52, z: 0.16, sx: 0.26, sy: 0.26, sz: 0.2 });
  }
  const legL = pivot(body, -0.15, 0.22, 0), legR = pivot(body, 0.15, 0.22, 0);
  for (const l of [legL, legR]) {
    P(l, 'cyl', sp === 'penguin' ? [28, 90, 70] : fur, { y: -0.1, sx: 0.08, sy: 0.2, sz: 0.08 });
    P(l, 'sph', [28, 80, 60], { y: -0.2, z: 0.04, sx: 0.12, sy: 0.05, sz: 0.14 });
  }
  const armL = pivot(body, -0.4, 0.7, 0), armR = pivot(body, 0.4, 0.7, 0);
  for (const a of [armL, armR]) P(a, 'cyl', sp === 'penguin' ? fur : fur, { y: -0.16, sx: 0.09, sy: 0.32, sz: 0.09, rz: sp === 'penguin' ? 0.4 : 0.1 });
  const head = pivot(body, 0, 1.2, 0);
  const faceCol = sp === 'sheep' ? [30, 8, 35] : fur;
  P(head, 'sph', faceCol, { sx: 0.42, sy: 0.38, sz: 0.38 });
  if (sp !== 'penguin') P(head, 'sph', belly, { y: -0.1, z: 0.3, sx: 0.2, sy: 0.14, sz: 0.14 });
  for (const sx of [-1, 1]) {
    if (sp === 'owl') {
      P(head, 'sph', [0, 0, 100], { x: 0.17 * sx, y: 0.03, z: 0.3, sx: 0.14, sy: 0.14, sz: 0.06 });
      P(head, 'sph', [30, 20, 10], { x: 0.17 * sx, y: 0.03, z: 0.35, s: 0.07 });
    } else {
      P(head, 'sph', [28, 20, 12], { x: 0.15 * sx, y: 0.04, z: 0.34, sx: 0.06, sy: 0.08, sz: 0.04 });
      P(head, 'sph', [0, 0, 100], { x: 0.13 * sx, y: 0.06, z: 0.37, s: 0.02, cast: false });
    }
    // 耳
    switch (sp) {
      case 'rabbit': P(head, 'sph', fur, { x: 0.15 * sx, y: 0.55, z: -0.02, sx: 0.1, sy: 0.3, sz: 0.05, rz: -0.1 * sx }); P(head, 'sph', [350, 40, 86], { x: 0.15 * sx, y: 0.55, z: 0.02, sx: 0.05, sy: 0.22, sz: 0.02 }); break;
      case 'cat': case 'fox': P(head, 'cone', fur, { x: 0.22 * sx, y: 0.4, sx: 0.14, sy: 0.22, sz: 0.12, rz: -0.2 * sx }); break;
      case 'bear': case 'mouse': P(head, 'sph', sp === 'mouse' ? belly : fur, { x: 0.3 * sx, y: 0.3, sx: sp === 'mouse' ? 0.2 : 0.14, sy: sp === 'mouse' ? 0.2 : 0.14, sz: 0.1 }); break;
      case 'dog': P(head, 'box', [28, 30, 40], { x: 0.4 * sx, y: 0.0, sx: 0.12, sy: 0.3, sz: 0.2, rz: 0.25 * sx }); break;
      case 'owl': P(head, 'cone', fur, { x: 0.16 * sx, y: 0.46, sx: 0.07, sy: 0.16, sz: 0.07, rz: -0.4 * sx }); break;
      case 'hedgehog': P(head, 'cone', fur, { x: 0.2 * sx, y: 0.3, sx: 0.08, sy: 0.12, sz: 0.08 }); break;
      default: break;
    }
  }
  if (sp === 'owl') P(head, 'cone', [40, 90, 60], { y: -0.04, z: 0.38, sx: 0.07, sy: 0.1, sz: 0.07, rx: Math.PI / 2 });
  if (sp === 'penguin') P(head, 'cone', [36, 90, 62], { y: -0.02, z: 0.4, sx: 0.07, sy: 0.12, sz: 0.07, rx: Math.PI / 2 });
  if (sp === 'hedgehog') {
    P(head, 'cone', [30, 40, 30], { y: -0.02, z: 0.36, sx: 0.12, sy: 0.22, sz: 0.12, rx: Math.PI / 2 });
    for (let i = 0; i < 9; i++) P(body, 'cone', [30, 40, 26], { x: -0.3 + i * 0.075, y: 0.92 - Math.abs(i - 4) * 0.02, z: -0.2, sx: 0.05, sy: 0.22, sz: 0.05, rx: -0.7 });
  }
  // しっぽ
  if (sp === 'rabbit') P(body, 'sph', [0, 0, 98], { y: 0.5, z: -0.36, s: 0.1 });
  if (sp === 'fox') { P(body, 'sph', fur, { y: 0.52, z: -0.44, sx: 0.12, sy: 0.12, sz: 0.3, rx: -0.4 }); P(body, 'sph', [0, 0, 98], { y: 0.46, z: -0.6, s: 0.08 }); }
  if (sp === 'cat') P(body, 'cyl', fur, { y: 0.6, z: -0.42, sx: 0.035, sy: 0.6, sz: 0.035, rx: 0.9 });
  if (sp === 'mouse') P(body, 'cyl', [0, 0, 80], { y: 0.45, z: -0.42, sx: 0.015, sy: 0.7, sz: 0.015, rx: 1.3 });
  if (sp === 'bear') P(body, 'sph', belly, { y: 0.3, z: 0.34, s: 0.1 });
  return { root, body, head, legL, legR, armL, armR };
}

// 歩き・待機のアニメーション
export function animateChar(c, moving, t, speed = 1) {
  const ph = t * 9 * speed;
  const k = moving ? 1 : 0;
  c.legL.rotation.x = Math.sin(ph) * 0.7 * k;
  c.legR.rotation.x = -Math.sin(ph) * 0.7 * k;
  const idle = Math.sin(t * 1.7) * 0.05 * (1 - k);
  c.armL.rotation.x = -Math.sin(ph) * 0.6 * k + idle;
  c.armR.rotation.x = Math.sin(ph) * 0.6 * k - idle;
  c.body.position.y = moving ? Math.abs(Math.sin(ph)) * 0.04 : Math.sin(t * 2.2) * 0.01;
  c.head.rotation.z = Math.sin(t * 0.9) * 0.03 * (1 - k);
}

// ---------- 季節の草木 ----------
const TRUNK = mat([24, 40, 34]);
const FOLIAGE = {
  leaf: [0, 1, 2].map(() => windMat([110, 50, 50], 0.035, 1.2)),
  blossom: windMat([330, 65, 86], 0.03, 1.4),
  pine: windMat([150, 40, 30], 0.02, 1.0),
};
const FRUIT = mat([0, 75, 52]);
const SEASON_COL = {
  spring: { leaf: [[98, 58, 60], [110, 50, 52], [90, 60, 66]], blossom: [336, 70, 86], pine: [150, 40, 30] },
  summer: { leaf: [[122, 52, 40], [112, 55, 46], [136, 48, 36]], blossom: [120, 50, 40], pine: [152, 42, 26] },
  autumn: { leaf: [[26, 78, 52], [40, 80, 54], [6, 70, 44]], blossom: [22, 80, 52], pine: [120, 30, 26] },
  winter: { leaf: [[150, 22, 92], [200, 18, 94], [220, 14, 86]], blossom: [200, 20, 94], pine: [200, 20, 70] },
};
export function setSeasonColors(season) {
  const p = SEASON_COL[season];
  FOLIAGE.leaf.forEach((m, i) => m.color.copy(col(p.leaf[i])));
  FOLIAGE.blossom.color.copy(col(p.blossom));
  FOLIAGE.pine.color.copy(col(p.pine));
}
setSeasonColors('spring');

export function treeModel(kind, rng) {
  const g = new THREE.Group();
  if (kind === 'pine') {
    P(g, 'cyl', TRUNK, { y: 0.4, sx: 0.12, sy: 0.8, sz: 0.12 });
    for (let i = 0; i < 4; i++) P(g, 'cone', FOLIAGE.pine, { y: 0.9 + i * 0.5, sx: 0.95 - i * 0.2, sy: 0.9 - i * 0.05, sz: 0.95 - i * 0.2 });
    return g;
  }
  P(g, 'cyl', TRUNK, { y: 0.7, sx: 0.15, sy: 1.4, sz: 0.15, rz: (rng() - 0.5) * 0.12 });
  const n = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU, r = rng() * 0.6;
    const m = kind === 'cherry' ? FOLIAGE.blossom : FOLIAGE.leaf[i % 3];
    P(g, 'ico1', m, { x: Math.cos(a) * r, y: 1.9 + rng() * 0.7, z: Math.sin(a) * r, s: 0.5 + rng() * 0.35 });
  }
  if (kind === 'fruit') {
    for (let i = 0; i < 5; i++) {
      const a = rng() * TAU;
      P(g, 'sph', FRUIT, { x: Math.cos(a) * 0.55, y: 1.7 + rng() * 0.6, z: Math.sin(a) * 0.55, s: 0.09 });
    }
  }
  return g;
}

export function rockModel(rng) {
  const g = new THREE.Group();
  const c = [30 + rng() * 10, 6 + rng() * 6, 55 + rng() * 15];
  P(g, 'ico0', c, { y: 0.25, sx: 0.5 + rng() * 0.4, sy: 0.35 + rng() * 0.25, sz: 0.45 + rng() * 0.4, ry: rng() * 3 });
  if (rng() > 0.5) P(g, 'ico0', [c[0], c[1], c[2] + 8], { x: 0.35, y: 0.12, sx: 0.25, sy: 0.2, sz: 0.25 });
  return g;
}

// ---------- 家具 (25種。単位マス中心、床が y=0) ----------
const WOOD = [26, 42, 48], WOOD_L = [34, 48, 66], METAL = [210, 8, 72], WHITE = [40, 14, 94];
const FURN = [
  (g, c, a) => { // ベッド
    P(g, 'box', WOOD, { y: 0.18, sx: 1.9, sy: 0.36, sz: 0.95 });
    P(g, 'box', WHITE, { y: 0.46, sx: 1.84, sy: 0.2, sz: 0.88 });
    P(g, 'box', c, { x: 0.22, y: 0.6, sx: 1.1, sy: 0.14, sz: 0.9 });
    P(g, 'box', WOOD, { x: -0.92, y: 0.5, sx: 0.14, sy: 0.9, sz: 0.98 });
    P(g, 'sph', WHITE, { x: -0.6, y: 0.62, sx: 0.22, sy: 0.12, sz: 0.3 });
  },
  (g, c, a) => { // ソファ
    P(g, 'box', c, { y: 0.25, sx: 1.9, sy: 0.5, sz: 0.9 });
    P(g, 'box', c, { y: 0.62, z: -0.36, sx: 1.9, sy: 0.5, sz: 0.22 });
    P(g, 'box', c, { x: -0.97, y: 0.45, sx: 0.12, sy: 0.5, sz: 0.9 });
    P(g, 'box', c, { x: 0.97, y: 0.45, sx: 0.12, sy: 0.5, sz: 0.9 });
    P(g, 'box', a, { x: -0.45, y: 0.56, z: 0.04, sx: 0.6, sy: 0.14, sz: 0.6 });
    P(g, 'box', a, { x: 0.45, y: 0.56, z: 0.04, sx: 0.6, sy: 0.14, sz: 0.6 });
  },
  (g, c) => { // イス
    for (const x of [-0.3, 0.3]) for (const z of [-0.3, 0.3]) P(g, 'cyl', WOOD, { x, y: 0.25, z, sx: 0.04, sy: 0.5, sz: 0.04 });
    P(g, 'box', c, { y: 0.5, sx: 0.7, sy: 0.08, sz: 0.7 });
    P(g, 'box', c, { y: 0.86, z: -0.32, sx: 0.7, sy: 0.6, sz: 0.07 });
  },
  (g, c) => { // テーブル
    P(g, 'box', WOOD_L, { y: 0.9, sx: 1.8, sy: 0.08, sz: 0.9 });
    for (const x of [-0.82, 0.82]) for (const z of [-0.38, 0.38]) P(g, 'box', WOOD, { x, y: 0.43, z, sx: 0.08, sy: 0.86, sz: 0.08 });
    P(g, 'box', c, { y: 0.95, sx: 1.6, sy: 0.02, sz: 0.7 });
  },
  (g, c) => { // つくえ
    P(g, 'box', c, { y: 0.8, sx: 0.9, sy: 0.07, sz: 0.55 });
    for (const x of [-0.4, 0.4]) for (const z of [-0.22, 0.22]) P(g, 'box', WOOD, { x, y: 0.4, z, sx: 0.06, sy: 0.8, sz: 0.06 });
    P(g, 'box', WOOD_L, { x: 0.2, y: 0.55, z: 0.02, sx: 0.4, sy: 0.25, sz: 0.5 });
  },
  (g, c) => { // 本だな
    P(g, 'box', WOOD, { z: -0.46, y: 0.9, sx: 0.9, sy: 1.8, sz: 0.08 });
    for (const x of [-0.44, 0.44]) P(g, 'box', c, { x, y: 0.9, sx: 0.06, sy: 1.8, sz: 0.4 });
    const rng = rngFrom('hon' + c.join());
    for (const y of [0.3, 0.9, 1.5]) {
      P(g, 'box', c, { y: y + 0.03, sx: 0.9, sy: 0.05, sz: 0.4 });
      for (let i = 0; i < 6; i++) {
        const hc = [(c[0] + i * 40) % 360, 55, 50 + rng() * 20];
        P(g, 'box', hc, { x: -0.36 + i * 0.13, y: y + 0.17, sx: 0.09, sy: 0.22 + rng() * 0.08, sz: 0.3 });
      }
    }
  },
  (g, c) => { // タンス
    P(g, 'box', WOOD, { y: 0.8, sx: 0.9, sy: 1.6, sz: 0.5 });
    P(g, 'box', c, { y: 1.62, sx: 0.96, sy: 0.05, sz: 0.56 });
    for (const x of [-0.22, 0.22]) {
      P(g, 'box', c, { x, y: 0.8, z: 0.26, sx: 0.42, sy: 1.4, sz: 0.02 });
      P(g, 'sph', METAL, { x: x * 0.2, y: 0.8, z: 0.29, s: 0.03 });
    }
  },
  (g, c, a) => { // ランプ
    P(g, 'cyl', METAL, { y: 0.02, sx: 0.2, sy: 0.04, sz: 0.2 });
    P(g, 'cyl', METAL, { y: 0.45, sx: 0.03, sy: 0.9, sz: 0.03 });
    P(g, 'cone', c, { y: 1.1, sx: 0.3, sy: 0.35, sz: 0.3, m: { emissive: col(c), emissiveIntensity: 0.25 } });
  },
  (g) => { // 鉢植え
    P(g, 'cyl', [18, 55, 52], { y: 0.13, sx: 0.18, sy: 0.25, sz: 0.18 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      P(g, 'sph', [116, 55, 42 + (i % 2) * 8], { x: Math.cos(a) * 0.12, y: 0.42 + (i % 3) * 0.06, z: Math.sin(a) * 0.12, s: 0.15 });
    }
  },
  (g, c, a) => { // ラグ
    P(g, 'box', c, { y: 0.015, sx: 1.9, sy: 0.03, sz: 1.9 });
    P(g, 'box', a, { y: 0.03, sx: 1.4, sy: 0.03, sz: 1.4 });
    P(g, 'box', c, { y: 0.045, sx: 0.8, sy: 0.02, sz: 0.8 });
  },
  (g, c) => { // 掛け時計 (置き時計)
    P(g, 'box', WOOD, { y: 0.45, sx: 0.5, sy: 0.9, sz: 0.4 });
    P(g, 'cyl', c, { y: 0.98, z: 0.21, sx: 0.24, sy: 0.04, sz: 0.24, rx: Math.PI / 2 });
    P(g, 'box', [0, 0, 20], { y: 0.99, z: 0.25, sx: 0.02, sy: 0.18, sz: 0.01 });
    P(g, 'box', [0, 0, 20], { x: 0.07, y: 0.98, z: 0.25, sx: 0.12, sy: 0.02, sz: 0.01 });
  },
  (g) => { // テレビ
    P(g, 'box', [0, 0, 14], { y: 0.92, z: -0.02, sx: 1.7, sy: 1.05, sz: 0.1 });
    P(g, 'box', [210, 80, 60], { y: 0.92, z: 0.04, sx: 1.56, sy: 0.9, sz: 0.02 });
    P(g, 'box', WOOD, { y: 0.1, sx: 0.8, sy: 0.2, sz: 0.4 });
  },
  (g, c) => { // ピアノ
    P(g, 'box', c, { y: 0.7, sx: 1.7, sy: 1.0, sz: 0.6 });
    P(g, 'box', c, { y: 1.22, z: -0.04, sx: 1.7, sy: 0.06, sz: 0.52 });
    P(g, 'box', WHITE, { y: 0.5, z: 0.34, sx: 1.2, sy: 0.04, sz: 0.12 });
    for (const x of [-0.8, 0.8]) P(g, 'box', WOOD, { x, y: 0.2, sx: 0.08, sy: 0.4, sz: 0.5 });
  },
  (g, c) => { // れいぞうこ
    P(g, 'box', c, { y: 0.9, sx: 0.9, sy: 1.8, sz: 0.8 });
    P(g, 'box', [0, 0, 80], { y: 1.1, z: 0.41, sx: 0.9, sy: 0.02, sz: 0.02 });
    P(g, 'box', METAL, { x: 0.3, y: 1.4, z: 0.42, sx: 0.05, sy: 0.4, sz: 0.05 });
  },
  (g, c) => { // バスタブ
    P(g, 'box', WHITE, { y: 0.3, sx: 1.9, sy: 0.6, sz: 0.9 });
    P(g, 'box', c, { y: 0.52, sx: 1.7, sy: 0.04, sz: 0.7 });
    P(g, 'box', [200, 70, 70], { y: 0.5, sx: 1.6, sy: 0.02, sz: 0.6 });
  },
  (g, c, a) => { // こたつ
    for (const x of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) P(g, 'box', WOOD, { x, y: 0.22, z, sx: 0.08, sy: 0.44, sz: 0.08 });
    P(g, 'box', WOOD_L, { y: 0.46, sx: 1.1, sy: 0.06, sz: 1.1 });
    P(g, 'box', c, { y: 0.5, sx: 1.5, sy: 0.14, sz: 1.5 });
    P(g, 'box', a, { y: 0.575, sx: 0.6, sy: 0.02, sz: 0.6 });
  },
  (g, c) => { // 宝箱
    P(g, 'box', WOOD, { y: 0.25, sx: 0.9, sy: 0.5, sz: 0.6 });
    P(g, 'cyl', c, { y: 0.5, sx: 0.3, sy: 0.9, sz: 0.3, rz: Math.PI / 2 });
    P(g, 'box', METAL, { y: 0.42, z: 0.31, sx: 0.12, sy: 0.14, sz: 0.04 });
  },
  (g, c, a) => { // クッション
    P(g, 'sph', c, { y: 0.14, sx: 0.36, sy: 0.14, sz: 0.36 });
    P(g, 'sph', a, { y: 0.23, sx: 0.12, sy: 0.05, sz: 0.12 });
  },
  (g, c) => { // ちょうちん
    P(g, 'cyl', WOOD, { y: 1.5, sx: 0.02, sy: 0.9, sz: 0.02 });
    P(g, 'sph', c, { y: 1.1, sx: 0.3, sy: 0.38, sz: 0.3, m: { emissive: col(c), emissiveIntensity: 0.45 } });
    P(g, 'cyl', WOOD, { y: 1.42, sx: 0.1, sy: 0.04, sz: 0.1 });
    P(g, 'cyl', WOOD, { y: 0.78, sx: 0.1, sy: 0.04, sz: 0.1 });
  },
  (g, c) => { // 姿見
    P(g, 'box', c, { y: 0.9, sx: 0.8, sy: 1.7, sz: 0.08 });
    P(g, 'box', [200, 30, 88], { y: 0.9, z: 0.05, sx: 0.66, sy: 1.5, sz: 0.04 });
    P(g, 'box', WOOD, { y: 0.05, z: -0.1, sx: 0.5, sy: 0.1, sz: 0.5 });
  },
  (g, c) => { // 丸いす
    P(g, 'cyl', c, { y: 0.5, sx: 0.3, sy: 0.1, sz: 0.3 });
    P(g, 'cyl', WOOD_L, { y: 0.25, sx: 0.05, sy: 0.5, sz: 0.05 });
    P(g, 'cyl', WOOD_L, { y: 0.02, sx: 0.2, sy: 0.04, sz: 0.2 });
  },
  (g, c, a) => { // 暖炉
    P(g, 'box', [25, 10, 58], { y: 0.55, sx: 1.9, sy: 1.1, sz: 0.8 });
    P(g, 'box', [25, 10, 30], { y: 0.2, z: 0.41, sx: 0.9, sy: 0.3, sz: 0.04 });
    P(g, 'sph', a, { y: 0.25, z: 0.36, sx: 0.2, sy: 0.25, sz: 0.15, m: { emissive: col([24, 90, 55]), emissiveIntensity: 0.8 } });
    P(g, 'box', WOOD_L, { y: 1.15, sx: 2.0, sy: 0.1, sz: 0.9 });
  },
  (g, c) => { // キャビネット
    P(g, 'box', c, { y: 0.45, sx: 1.85, sy: 0.9, sz: 0.7 });
    for (let i = 0; i < 4; i++) {
      P(g, 'box', [c[0], c[1], c[2] - 4], { x: 0, y: 0.1 + i * 0.2, z: 0.36, sx: 1.7, sy: 0.18, sz: 0.02 });
      P(g, 'sph', METAL, { x: 0, y: 0.1 + i * 0.2, z: 0.38, s: 0.025 });
    }
  },
  (g) => { // 観葉植物
    P(g, 'cyl', [18, 55, 52], { y: 0.18, sx: 0.25, sy: 0.35, sz: 0.25 });
    P(g, 'cyl', WOOD, { y: 0.7, sx: 0.03, sy: 0.7, sz: 0.03 });
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4;
      P(g, 'sph', [120 + i * 3, 55, 40], { x: Math.cos(a) * 0.14, y: 0.95 + (i % 3) * 0.16, z: Math.sin(a) * 0.14, sx: 0.26, sy: 0.1, sz: 0.14, ry: a, rz: 0.5 });
    }
  },
  (g, c, a) => { // 花びん
    P(g, 'cyl', c, { y: 0.2, sx: 0.16, sy: 0.4, sz: 0.16 });
    P(g, 'cyl', c, { y: 0.5, sx: 0.07, sy: 0.2, sz: 0.07 });
    for (let i = 0; i < 5; i++) {
      const x = Math.cos(i * 1.3) * 0.1, z = Math.sin(i * 1.3) * 0.1;
      P(g, 'sph', i % 2 ? a : WHITE, { x, y: 0.7 + (i % 3) * 0.07, z, s: 0.08 });
    }
  },
];

export function furnitureModel(info) {
  const g = new THREE.Group();
  const c = info.color;
  const a = [(c[0] + 150) % 360, 60, 62];
  FURN[info.kind](g, c, a);
  return g;
}

// ---------- 魚 ----------
// [長さ, 高さ, しっぽの大きさ, 厚み]
const FISH_BODY = [
  [1.0, 0.46, 1.0, 0.3], [0.8, 0.5, 0.9, 0.32], [0.92, 0.3, 1.1, 0.3], [0.95, 0.32, 1.0, 0.3], [0.9, 0.26, 1.0, 0.28],
  [0.95, 0.24, 0.9, 0.28], [0.9, 0.16, 0.7, 0.22], [1.1, 0.36, 0.9, 0.3], [0.9, 0.22, 1.0, 0.28], [1.4, 0.18, 0.7, 0.2],
  [0.6, 0.4, 0.9, 0.34], [0.42, 0.18, 1.0, 0.3], [0.6, 0.3, 0.8, 0.3], [0.7, 0.5, 0.6, 0.1], [0.9, 0.5, 1.1, 0.32],
  [0.8, 0.3, 1.0, 0.3], [0.95, 0.28, 1.1, 0.28], [1.2, 0.36, 1.5, 0.3], [0.95, 0.12, 1.3, 0.1], [0.8, 0.16, 0.9, 0.22],
];
export function fishModel(info) {
  const [L, H, T, K] = FISH_BODY[info.sp];
  const g = new THREE.Group();
  const c = info.color;
  const c2 = info.pat === 3 ? [(c[0] + 30) % 360, c[1], Math.min(95, c[2] + 22)] : [c[0], c[1] * 0.5, Math.min(96, c[2] + 26)];
  const fin = [c[0], c[1], Math.max(10, c[2] - 12)];
  const th = H * K;
  P(g, 'sph', c, { sx: L / 2, sy: H / 2, sz: th });
  P(g, 'sph', c2, { y: -H * 0.22, sx: L * 0.38, sy: H * 0.22, sz: th * 0.9 });
  P(g, 'sph', fin, { x: -L / 2 - 0.02, sx: 0.14 * T, sy: H * 0.4 * T, sz: H * 0.05 });
  P(g, 'sph', fin, { y: H * 0.5, x: -0.02, sx: L * 0.16, sy: H * 0.3, sz: 0.03 });
  P(g, 'sph', fin, { x: L * 0.14, y: -H * 0.06, z: th * 0.9, sx: 0.08, sy: 0.03, sz: 0.1, ry: 0.4 });
  for (const s of [-1, 1]) P(g, 'sph', [0, 0, 100], { x: L * 0.36, y: H * 0.12, z: th * 0.85 * s, s: H * 0.14 });
  for (const s of [-1, 1]) P(g, 'sph', [0, 0, 8], { x: L * 0.38, y: H * 0.12, z: th * 0.92 * s, s: H * 0.07 });
  if (info.pat === 1) {
    for (let i = 0; i < 3; i++) P(g, 'box', [c[0], c[1], Math.max(8, c[2] - 30)], { x: -0.12 * L + i * 0.14 * L, sx: 0.04, sy: H * 0.8, sz: th * 1.02 });
  } else if (info.pat === 2) {
    const rng = rngFrom(info.id);
    for (let i = 0; i < 6; i++) P(g, 'sph', c2, { x: (rng() - 0.5) * L * 0.6, y: (rng() - 0.5) * H * 0.4, z: th * 1.02, s: H * 0.1 });
  }
  return g;
}

// ---------- 虫 ----------
// [長さ, 高さ, 足の数]
const BUG_BODY = [
  [0.28, 0.12, 6], [0.34, 0.14, 6], [0.36, 0.14, 6], [0.42, 0.3, 6], [0.4, 0.22, 6], [0.42, 0.22, 6], [0.2, 0.18, 6],
  [0.5, 0.1, 6], [0.6, 0.1, 6], [0.3, 0.18, 6], [0.3, 0.18, 6], [0.32, 0.2, 6], [0.4, 0.14, 6], [0.3, 0.16, 6],
  [0.24, 0.15, 6], [0.3, 0.22, 6], [0.3, 0.14, 6], [0.26, 0.14, 6], [0.32, 0.2, 6], [0.3, 0.16, 6], [0.26, 0.16, 6],
  [0.28, 0.2, 14], [0.24, 0.16, 6], [0.3, 0.2, 8], [0.4, 0.14, 6],
];
export function bugModel(info) {
  const [len, h, legs] = BUG_BODY[info.sp];
  const wings = BUG_WINGS[info.sp];
  const g = new THREE.Group();
  const c = info.color;
  const dark = [c[0], c[1], Math.max(8, c[2] * 0.35)];
  const acc = [(c[0] + 170) % 360, 65, 60];
  P(g, 'sph', c, { x: -len * 0.2, y: h * 0.5, sx: len * 0.45, sy: h * 0.5, sz: h * 0.42 });
  P(g, 'sph', dark, { x: len * 0.22, y: h * 0.5, sx: len * 0.22, sy: h * 0.48, sz: h * 0.4 });
  P(g, 'sph', dark, { x: len * 0.5, y: h * 0.5, sx: h * 0.45, sy: h * 0.45, sz: h * 0.45 });
  for (const s of [-1, 1]) P(g, 'sph', [0, 0, 100], { x: len * 0.56, y: h * 0.6, z: h * 0.2 * s, s: h * 0.14 });
  for (let i = 0; i < legs; i++) {
    const side = i % 2 ? 1 : -1, row = Math.floor(i / 2);
    const x = len * (0.2 - row * 0.2 + (legs > 6 ? 0.1 : 0)) + (row - 1) * 0.02;
    P(g, 'cyl', dark, { x, y: h * 0.2, z: side * h * 0.45, sx: 0.012, sy: h * 1.1, sz: 0.012, rz: 0.9 * side, rx: 0.4 * side, cast: false });
  }
  for (const s of [-1, 1]) {
    P(g, 'cyl', dark, { x: len * 0.56, y: h * 1.1, z: s * 0.05, sx: 0.008, sy: 0.3, sz: 0.008, rz: -1.0, rx: 0.3 * s, cast: false });
  }
  if (info.sp === 3) P(g, 'cone', dark, { x: len * 0.7, y: h * 0.6, sx: 0.04, sy: 0.22, sz: 0.04, rz: -Math.PI / 2 });
  if (info.sp === 4 || info.sp === 5) for (const s of [-1, 1]) P(g, 'cone', dark, { x: len * 0.7, y: h * 0.5, z: s * 0.08, sx: 0.03, sy: 0.2, sz: 0.03, rz: -Math.PI / 2 });
  if (info.sp === 6) for (let i = 0; i < 4; i++) P(g, 'sph', [0, 85, 45], { x: -len * 0.35 + (i % 2) * 0.2, y: h * 1.0, z: (i < 2 ? -1 : 1) * h * 0.22, s: h * 0.2 });
  if (info.sp === 22) P(g, 'sph', [40, 10, 96], { x: -len * 0.2, y: h * 0.55, sx: len * 0.5, sy: h * 0.5, sz: h * 0.5 });
  if (wings === 1) {
    for (const s of [-1, 1]) {
      P(g, 'sph', c, { x: len * 0.18, y: h * 1.0, z: s * h * 1.1, sx: len * 0.7, sy: 0.02, sz: h * 1.5, rx: -0.35 * s, ry: 0.1 });
      P(g, 'sph', acc, { x: len * 0.14, y: h * 1.0, z: s * h * 1.2, sx: len * 0.35, sy: 0.025, sz: h * 0.9, rx: -0.35 * s });
      P(g, 'sph', c, { x: -len * 0.25, y: h * 1.0, z: s * h * 0.9, sx: len * 0.4, sy: 0.02, sz: h * 0.9, rx: -0.2 * s });
    }
  } else if (wings === 2) {
    P(g, 'sph', c, { x: -len * 0.1, y: h * 0.62, sx: len * 0.52, sy: h * 0.42, sz: h * 0.44 });
    P(g, 'box', dark, { x: -len * 0.1, y: h * 1.02, sx: 0.02, sy: 0.02, sz: h * 0.8 });
  } else if (wings === 3) {
    for (const s of [-1, 1]) {
      P(g, 'sph', [200, 40, 96], { x: len * 0.1, y: h * 1.2, z: s * h * 1.25, sx: len * 0.5, sy: 0.01, sz: h * 1.1, m: { transparent: true, opacity: 0.45 } });
      P(g, 'sph', [200, 40, 96], { x: -len * 0.3, y: h * 1.1, z: s * h * 1.0, sx: len * 0.35, sy: 0.01, sz: h * 0.8, m: { transparent: true, opacity: 0.4 } });
    }
  } else if (wings === 4) {
    for (const s of [-1, 1]) P(g, 'sph', [200, 30, 96], { x: 0, y: h * 1.0, z: s * h * 0.6, sx: len * 0.4, sy: 0.01, sz: h * 0.5, m: { transparent: true, opacity: 0.55 } });
  }
  if (info.sp === 0) for (let i = 0; i < 2; i++) P(g, 'sph', acc, { x: len * 0.2, y: h * 0.9, z: (i ? 1 : -1) * h * 1.6, sx: 0.2, sy: 0.02, sz: 0.2 });
  return g;
}

// ---------- 料理 ----------
export function dishModel(info) {
  const g = new THREE.Group();
  const c = info.color, gar = info.garnish;
  P(g, 'cyl', [0, 0, 96], { y: 0.025, sx: 0.42, sy: 0.05, sz: 0.42 });
  const k = info.type % 5;
  if (k === 0) { // おにぎり系: 球に海苔
    P(g, 'sph', [0, 0, 98], { y: 0.14, sx: 0.22, sy: 0.18, sz: 0.2 });
    P(g, 'box', [120, 40, 14], { y: 0.12, z: 0.2, sx: 0.14, sy: 0.14, sz: 0.04 });
  } else if (k === 1) { // 汁物: 器
    P(g, 'cyl', [0, 0, 96], { y: 0.12, sx: 0.28, sy: 0.14, sz: 0.28 });
    P(g, 'cyl', c, { y: 0.2, sx: 0.24, sy: 0.02, sz: 0.24 });
  } else if (k === 2) { // 層
    [0, 1, 2].forEach((i) => P(g, 'cyl', i === 1 ? gar : c, { y: 0.08 + i * 0.06, sx: 0.3 - i * 0.04, sy: 0.06, sz: 0.3 - i * 0.04 }));
  } else if (k === 3) { // こんもり
    P(g, 'sph', c, { y: 0.1, sx: 0.26, sy: 0.14, sz: 0.26 });
  } else { // 板状
    P(g, 'box', c, { y: 0.1, sx: 0.36, sy: 0.1, sz: 0.26 });
  }
  const rng = rngFrom(info.id);
  for (let i = 0; i < 3 + (info.type % 3); i++) {
    P(g, 'sph', gar, { x: (rng() - 0.5) * 0.3, y: 0.2 + rng() * 0.05, z: (rng() - 0.5) * 0.2, s: 0.05 + rng() * 0.03 });
  }
  return g;
}

// ---------- 農作物 (成長段階 0-4) ----------
export function cropModel(info, stage) {
  const g = new THREE.Group();
  P(g, 'sph', [28, 45, 30], { y: 0, sx: 0.36, sy: 0.07, sz: 0.36 });
  if (stage <= 0) { P(g, 'sph', [28, 40, 36], { y: 0.07, s: 0.05 }); return g; }
  const k = [0, 0.4, 0.65, 0.9, 1][stage];
  const leaf = [110, 55, 40 + (info.light - 52) * 0.2];
  const fruit = [info.hue, 72, info.light];
  const rng = rngFrom(info.id + stage);
  switch (info.family) {
    case 'root': {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        P(g, 'sph', leaf, { x: Math.cos(a) * 0.13 * k, y: 0.1 * k + 0.03, z: Math.sin(a) * 0.13 * k, sx: 0.11 * k, sy: 0.03, sz: 0.07 * k, ry: -a, rx: 0.25 });
      }
      if (stage >= 3) P(g, 'sph', fruit, { y: 0.06, sx: 0.12 * k, sy: 0.1 * k, sz: 0.12 * k });
      break;
    }
    case 'bush': {
      for (let i = 0; i < 7; i++) P(g, 'sph', leaf, { x: (rng() - 0.5) * 0.3 * k, y: 0.14 * k, z: (rng() - 0.5) * 0.3 * k, s: 0.13 * k });
      if (stage >= 3) for (let i = 0; i < 5; i++) P(g, 'sph', fruit, { x: (rng() - 0.5) * 0.26, y: 0.2 * k + rng() * 0.08, z: (rng() - 0.5) * 0.26, s: 0.05 + 0.02 * (stage === 4) });
      break;
    }
    case 'vine': {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU;
        P(g, 'cyl', leaf, { x: Math.cos(a) * 0.12, y: 0.22 * k, z: Math.sin(a) * 0.12, sx: 0.02, sy: 0.44 * k, sz: 0.02, rz: 0.2 * Math.cos(a), rx: -0.2 * Math.sin(a) });
        P(g, 'sph', leaf, { x: Math.cos(a) * 0.2, y: 0.42 * k, z: Math.sin(a) * 0.2, sx: 0.14 * k, sy: 0.05, sz: 0.1 * k });
      }
      if (stage >= 3) for (let i = 0; i < 3; i++) P(g, 'sph', fruit, { x: Math.cos(i * 2.1) * 0.22, y: 0.14 + (i % 2) * 0.05, z: Math.sin(i * 2.1) * 0.22, s: 0.07 + 0.02 * (stage === 4) });
      break;
    }
    case 'stalk': {
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * 0.09, z = (rng() - 0.5) * 0.12;
        P(g, 'cyl', leaf, { x, y: 0.36 * k, z, sx: 0.025, sy: 0.72 * k, sz: 0.025 });
        P(g, 'sph', leaf, { x: x + 0.05, y: 0.28 * k, z, sx: 0.1 * k, sy: 0.02, sz: 0.05 * k, rz: -0.5 });
        if (stage >= 3) P(g, 'cyl', fruit, { x, y: 0.74 * k, z, sx: 0.05, sy: 0.14, sz: 0.05 });
      }
      break;
    }
    default: { // mush
      P(g, 'cyl', [40, 20, 92], { y: 0.12 * k, sx: 0.05, sy: 0.24 * k, sz: 0.05 });
      P(g, 'sph', fruit, { y: 0.25 * k, sx: 0.17 * k, sy: 0.09 * k, sz: 0.17 * k });
      if (stage >= 3) for (let i = 0; i < 3; i++) P(g, 'sph', fruit, { x: (i - 1) * 0.17, y: 0.1, z: 0.05, sx: 0.07, sy: 0.04, sz: 0.07 });
    }
  }
  return g;
}

// ---------- 建物・場所 ----------
export function houseModel(wall, roof, w = 1.6, d = 1.6, h = 1.1) {
  const g = new THREE.Group();
  P(g, 'box', wall, { y: h / 2, sx: w, sy: h, sz: d });
  P(g, 'cone', roof, { y: h + 0.45, sx: Math.max(w, d) * 0.78, sy: 0.9, sz: Math.max(w, d) * 0.78, ry: Math.PI / 4 });
  P(g, 'box', [28, 45, 40], { y: 0.36, z: d / 2 + 0.01, sx: 0.36, sy: 0.72, sz: 0.04 });
  for (const sx of [-1, 1]) P(g, 'box', [200, 70, 88], { x: sx * w * 0.3, y: h * 0.6, z: d / 2 + 0.01, sx: 0.3, sy: 0.3, sz: 0.04 });
  return g;
}

export function shopModel() {
  const g = new THREE.Group();
  P(g, 'box', [38, 40, 92], { y: 0.7, sx: 2.6, sy: 1.4, sz: 2 });
  P(g, 'cone', [6, 70, 52], { y: 1.95, sx: 2.3, sy: 0.9, sz: 2.3, ry: Math.PI / 4 });
  P(g, 'box', WOOD_L, { y: 0.5, z: 1.2, sx: 2.2, sy: 0.08, sz: 0.6 });
  for (let i = 0; i < 6; i++) P(g, 'box', i % 2 ? [350, 70, 80] : [0, 0, 100], { x: -1.25 + i * 0.5, y: 1.48, z: 1.3, sx: 0.5, sy: 0.3, sz: 0.1 });
  P(g, 'box', [28, 45, 40], { y: 0.42, z: 1.01, sx: 0.36, sy: 0.84, sz: 0.04 });
  const items = [[50, 80, 70], [210, 60, 60], [340, 70, 80]];
  items.forEach((c, i) => P(g, 'sph', c, { x: -0.8 + i * 0.8, y: 0.66, z: 1.2, s: 0.1 }));
  return g;
}

export function lighthouseModel() {
  const g = new THREE.Group();
  const bands = [[0.9, 0.5, [0, 0, 98]], [0.78, 0.5, [4, 80, 56]], [0.66, 0.5, [0, 0, 98]], [0.56, 0.5, [4, 80, 56]]];
  let y = 0;
  for (const [r, hh, c] of bands) { P(g, 'cyl', c, { y: y + hh / 2, sx: r, sy: hh, sz: r }); y += hh; }
  P(g, 'cyl', [48, 60, 90], { y: y + 0.2, sx: 0.56, sy: 0.4, sz: 0.56 });
  P(g, 'sph', [50, 90, 80], { y: y + 0.42, sx: 0.4, sy: 0.3, sz: 0.4, m: { emissive: col([50, 100, 70]), emissiveIntensity: 0.9 } });
  P(g, 'cone', [4, 70, 50], { y: y + 0.9, sx: 0.55, sy: 0.5, sz: 0.55 });
  return g;
}

export function shardModel() {
  const g = new THREE.Group();
  const c = [190, 90, 72];
  P(g, 'ico0', c, { y: 0.55, sx: 0.22, sy: 0.4, sz: 0.22, m: { emissive: col([190, 90, 45]), emissiveIntensity: 1 } });
  P(g, 'sph', c, { y: 0.55, s: 0.5, m: { transparent: true, opacity: 0.18, emissive: col(c), emissiveIntensity: 0.6 }, cast: false });
  return g;
}

export function stoneModel(rng) {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.7 + (rng() - 0.5) * 0.2, h = 1.4 + rng() * 1.0;
    P(g, 'box', [30, 8, 60 + rng() * 10], { x, y: h / 2, sx: 0.5, sy: h, sz: 0.5, rz: (rng() - 0.5) * 0.2 });
  }
  P(g, 'box', [30, 8, 50], { y: 0.12, sx: 4.2, sy: 0.24, sz: 1.8 });
  return g;
}

export function bridgeModel(len, wid) {
  const g = new THREE.Group();
  P(g, 'box', [28, 40, 46], { y: 0.12, sx: len, sy: 0.24, sz: wid });
  for (const s of [-1, 1]) P(g, 'box', [28, 40, 40], { z: s * (wid / 2 - 0.05), y: 0.5, sx: len, sy: 0.08, sz: 0.1 });
  for (let i = 0; i < 6; i++) P(g, 'box', [28, 40, 56], { x: -len / 2 + 0.6 + i * ((len - 1.2) / 5), y: 0.3, sx: 0.2, sy: 0.5, sz: wid * 0.9 });
  return g;
}

export function stoveModel() {
  const g = new THREE.Group();
  P(g, 'box', [30, 8, 40], { y: 0.5, sx: 0.95, sy: 1.0, sz: 0.9 });
  P(g, 'box', [30, 8, 22], { y: 1.02, sx: 0.95, sy: 0.04, sz: 0.9 });
  for (const x of [-0.22, 0.22]) for (const z of [-0.2, 0.2]) P(g, 'cyl', [30, 8, 14], { x, y: 1.06, z, sx: 0.14, sy: 0.02, sz: 0.14 });
  P(g, 'box', [220, 10, 30], { y: 0.7, z: 0.46, sx: 0.5, sy: 0.14, sz: 0.02 });
  P(g, 'box', [200, 10, 80], { y: 1.3, z: -0.4, sx: 0.9, sy: 0.6, sz: 0.1 });
  return g;
}

export function signModel() {
  const g = new THREE.Group();
  P(g, 'cyl', [28, 40, 40], { y: 0.5, sx: 0.05, sy: 1, sz: 0.05 });
  P(g, 'box', [36, 60, 96], { y: 1.0, sx: 0.7, sy: 0.4, sz: 0.06 });
  return g;
}

// 室内の部屋 (幅 w, 奥行き d の左奥側の壁だけを高く作る)
export function roomWalls(w, d, wallCol, floorCol) {
  const g = new THREE.Group();
  P(g, 'box', floorCol, { x: w / 2, y: -0.05, z: d / 2, sx: w, sy: 0.1, sz: d });
  P(g, 'box', wallCol, { x: w / 2, y: 1.6, z: -0.1, sx: w, sy: 3.2, sz: 0.2 });
  P(g, 'box', wallCol, { x: -0.1, y: 1.6, z: d / 2, sx: 0.2, sy: 3.2, sz: d });
  P(g, 'box', [200, 60, 90], { x: 3, y: 1.9, z: -0.02, sx: 1.4, sy: 0.9, sz: 0.04, m: { emissive: col([200, 60, 60]), emissiveIntensity: 0.3 } });
  P(g, 'box', [200, 60, 90], { x: 8.5, y: 1.9, z: -0.02, sx: 1.4, sy: 0.9, sz: 0.04, m: { emissive: col([200, 60, 60]), emissiveIntensity: 0.3 } });
  return g;
}

// ---------- アイテムの3Dモデル (図鑑・店・ゴースト表示用) ----------
// 道具の見本 (つりざお・虫あみ・ほうちょう)
function toolModel(kind) {
  const g = new THREE.Group();
  const wood = [28, 50, 52];
  if (kind === 'rod') {
    P(g, 'cyl', wood, { y: 0.45, z: 0, sx: 0.025, sy: 0.9, sz: 0.025, rx: 0.5 });
    P(g, 'cyl', [0, 0, 92], { y: 0.5, z: 0.25, sx: 0.006, sy: 0.7, sz: 0.006, rx: 0.2 });
    P(g, 'sph', [350, 70, 60], { y: 0.14, z: 0.45, s: 0.05 });
  } else if (kind === 'net') {
    P(g, 'cyl', wood, { y: 0.35, sx: 0.03, sy: 0.7, sz: 0.03 });
    P(g, 'tor', [0, 0, 90], { y: 0.78, sx: 0.28, sy: 0.28, sz: 0.28, rx: Math.PI / 2 });
    P(g, 'sph', [200, 20, 92], { y: 0.78, sx: 0.26, sy: 0.04, sz: 0.26 });
  } else {
    P(g, 'box', [0, 0, 80], { y: 0.5, sx: 0.09, sy: 0.02, sz: 0.5 });
    P(g, 'box', wood, { y: 0.14, sx: 0.1, sy: 0.12, sz: 0.2 });
  }
  return g;
}

export function itemModel(key) {
  const info = infoOf(key);
  switch (info.cat) {
    case 'furn': return furnitureModel(info);
    case 'fish': return fishModel(info);
    case 'bug': return bugModel(info);
    case 'dish': return dishModel(info);
    case 'crop': return cropModel(info, 4);
    case 'tool': return toolModel(info.tool);
    case 'seed': {
      // ふくろ入りのたね: 作物の色の粒を盛る
      const crop = CROPS[info.seedOf];
      const g = new THREE.Group();
      P(g, 'sph', [30, 55, 52], { y: 0.14, sx: 0.22, sy: 0.16, sz: 0.2 });
      const rng = rngFrom('seed' + info.seedOf);
      for (let i = 0; i < 9; i++) {
        P(g, 'sph', [crop.hue, 60, 46 + rng() * 14], { x: (rng() - 0.5) * 0.3, y: 0.3 + rng() * 0.05, z: (rng() - 0.5) * 0.24, s: 0.05 });
      }
      return g;
    }
    default: return new THREE.Group();
  }
}

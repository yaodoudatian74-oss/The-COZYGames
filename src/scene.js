// 描画の中核: レンダラ・空・光・地形・水・植生・建物・室内
import * as THREE from 'three';
import * as M from './models.js';
import {
  HALF, heightAt, slopeAt, scatter, findSpot, shardSites, pathDist, HOUSE_SITES, SHOP_SITE,
  PLAYER_HOUSE_SITE, PLAZA, BRIDGE, BRIDGE_DECK_Y, LAKE,
} from './terrain.js';
import { rngFrom, clamp, lerp, vnoise } from './util.js';
import { col } from './models.js';
import { CROPS } from './data.js';

export const INT_OFF = { x: 400, z: 400 }; // 室内は島から遠く離れた場所に作る
export const ROOM = { w: 12, d: 8 };

export let renderer = null;
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
export const outdoor = new THREE.Group();
export const interior = new THREE.Group();
interior.position.set(INT_OFF.x, 0, INT_OFF.z);
scene.add(outdoor, interior);
export const world = { trees: [], rocks: [], houses: [], shop: null, home: null, lighthouse: null, shards: [], lamps: [] };

// ---------- 季節と色 ----------
const TERRAIN_PAL = {
  spring: { grass: [96, 70, 62], light: [92, 78, 74], dark: [108, 62, 52], rock: [30, 14, 52], sand: [44, 60, 80], path: [34, 36, 66], under: [34, 34, 36] },
  summer: { grass: [112, 68, 52], light: [104, 76, 62], dark: [122, 62, 42], rock: [30, 14, 50], sand: [44, 66, 82], path: [36, 38, 66], under: [34, 34, 36] },
  autumn: { grass: [74, 50, 52], light: [60, 60, 60], dark: [90, 42, 40], rock: [28, 16, 48], sand: [40, 58, 78], path: [34, 36, 62], under: [30, 30, 36] },
  winter: { grass: [200, 26, 90], light: [200, 30, 96], dark: [214, 26, 80], rock: [210, 10, 60], sand: [40, 26, 86], path: [36, 22, 74], under: [210, 30, 40] },
};
const FLOWER_PAL = {
  spring: [[330, 80, 86], [52, 95, 74], [0, 0, 100], [280, 60, 85], [12, 80, 80]],
  summer: [[48, 98, 62], [350, 80, 70], [0, 0, 100], [205, 85, 75], [290, 70, 74]],
  autumn: [[28, 90, 60], [12, 75, 55], [45, 90, 62], [0, 0, 98], [300, 40, 60]],
  winter: [[200, 50, 97], [0, 0, 100], [215, 40, 90], [195, 50, 95], [200, 20, 88]],
};
const SKY = [ // [時刻, 空の上, 地平線, 光の色]
  [0, '#101c44', '#24345e', '#8aa0e0'], [4.5, '#1f2f66', '#3e4a7e', '#8aa0e0'], [6, '#7fb8f0', '#ffc9a0', '#ffb27a'],
  [8, '#8fd0f5', '#e6f6ff', '#fff0d8'], [12, '#5ab3f0', '#cdeefd', '#fff6e6'], [16, '#6ea6e0', '#fbe7c8', '#ffe0b0'],
  [18, '#5a6fb8', '#ffb388', '#ffa870'], [19.5, '#2a2f6a', '#e77a7a', '#ff8a7a'], [21, '#141c40', '#3a3c6c', '#8aa0e0'],
  [24, '#101c44', '#24345e', '#8aa0e0'],
];
const skyColors = SKY.map(([h, t, hz, s]) => [h, new THREE.Color(t), new THREE.Color(hz), new THREE.Color(s)]);
function skyAt(hour) {
  for (let i = 0; i < skyColors.length - 1; i++) {
    const a = skyColors[i], b = skyColors[i + 1];
    if (hour >= a[0] && hour <= b[0]) {
      const t = (hour - a[0]) / (b[0] - a[0]);
      return { top: a[1].clone().lerp(b[1], t), hz: a[2].clone().lerp(b[2], t), sun: a[3].clone().lerp(b[3], t) };
    }
  }
  return { top: skyColors[0][1], hz: skyColors[0][2], sun: skyColors[0][3] };
}

// ---------- 地面の模様テクスチャ (草の筋) ----------
function detailTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 1024, 1024);
  const r = rngFrom('ground-tex');
  // 草の筋 (細かく、濃淡つき)
  for (let i = 0; i < 26000; i++) {
    const x = r() * 1024, y = r() * 1024, l = 3 + r() * 9, a = -Math.PI / 2 + (r() - 0.5) * 1.1;
    g.strokeStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.24)';
    g.lineWidth = 0.8 + r() * 0.9;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // 小さな土の粒と、ところどころの濃い草むら
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(60,40,20,0.12)' : 'rgba(255,255,255,0.12)';
    g.fillRect(r() * 1024, r() * 1024, 1 + r() * 2, 1 + r() * 2);
  }
  for (let i = 0; i < 40; i++) {
    const x = r() * 1024, y = r() * 1024, rad = 30 + r() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(0,0,0,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(HALF / 3, HALF / 3);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let terrainMesh, terrainKind, terrainTint, grassMesh, grassTint, flowerMesh, flowerTint;
let skyMat, dome, sun, hemi, stars, lighthouseLamp = null;
const clouds = [], shardMeshes = [];
const state = { lighthouseOn: false };
let season = 'spring';
let ghost = null;

function buildTerrain(sc) {
  const geom = new THREE.PlaneGeometry(HALF * 2, HALF * 2, HALF * 2, HALF * 2);
  geom.rotateX(-Math.PI / 2);
  const pos = geom.attributes.position;
  const n = pos.count;
  terrainKind = new Uint8Array(n); terrainTint = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
  }
  geom.computeVertexNormals();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
    const slope = slopeAt(x, z);
    const pd = pathDist(x, z);
    let kind = 3;
    if (h < -0.05) kind = 0;
    else if (h < 0.35) kind = 1;
    else if (slope > 0.8) kind = 2;
    else if (pd < 1.2) kind = 4;
    terrainKind[i] = kind;
    terrainTint[i] = 0.5 + 0.5 * vnoise(x * 0.12 + 3, z * 0.12 - 5, 17);
  }
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const tex = detailTexture();
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, map: tex, gradientMap: M.TOON_GRAD });
  terrainMesh = new THREE.Mesh(geom, mat);
  terrainMesh.receiveShadow = true;
  sc.add(terrainMesh);
  recolorTerrain();
}

function recolorTerrain() {
  const P = TERRAIN_PAL[season];
  const attr = terrainMesh.geometry.attributes.color;
  const c = new THREE.Color();
  for (let i = 0; i < terrainKind.length; i++) {
    const k = terrainKind[i], t = terrainTint[i];
    let hsl;
    if (k === 0) hsl = P.under;
    else if (k === 1) hsl = P.sand;
    else if (k === 2) hsl = P.rock;
    else if (k === 4) hsl = P.path;
    else hsl = t > 0.5 ? P.light : P.dark;
    c.copy(col(hsl));
    attr.setXYZ(i, c.r, c.g, c.b);
  }
  attr.needsUpdate = true;
}

function buildWater(sc) {
  const geom = new THREE.PlaneGeometry(260, 260, 130, 130);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshToonMaterial({ color: col([204, 72, 52]), gradientMap: M.TOON_GRAD, transparent: true, opacity: 0.8, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = M.WIND.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec2 vWP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y += sin(position.x * 0.35 + uTime * 1.5) * 0.035 + cos(position.z * 0.45 - uTime * 1.2) * 0.03;
        vWP = position.xz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec2 vWP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wv = sin(vWP.x * 1.6 + uTime * 2.0) * sin(vWP.y * 1.4 - uTime * 1.6);
        diffuseColor.rgb += vec3(0.05, 0.07, 0.07) * smoothstep(0.6, 1.0, wv);`);
  };
  waterMesh = new THREE.Mesh(geom, mat);
  waterMesh.renderOrder = 2;
  sc.add(waterMesh);
  // 海底 (島の外側の見えない部分を埋める)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: col([212, 60, 30]) }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -2.8;
  sc.add(floor);
}

function buildScatter(sc) {
  const S = scatter('island');
  const rng = rngFrom('models');
  for (const t of S.trees) {
    const g = M.treeModel(t.kind, rng);
    g.position.set(t.x, heightAt(t.x, t.z) - 0.05, t.z);
    g.rotation.y = t.ry;
    g.scale.setScalar(t.s);
    sc.add(g);
    world.trees.push({ x: t.x, z: t.z, kind: t.kind, obj: g, hp: 3 });
  }
  for (const r of S.rocks) {
    const g = M.rockModel(rng);
    g.position.set(r.x, heightAt(r.x, r.z) - 0.05, r.z);
    g.rotation.y = r.ry;
    g.scale.setScalar(r.s);
    sc.add(g);
    world.rocks.push({ x: r.x, z: r.z, obj: g, hp: 3 });
  }
  // 草: 細長い三角形を大量にインスタンス化
  // 葉: 根元が広く、先がすぼまる湾曲した形 (5頂点・3段)
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.07, 0, 0, 0.07, 0, 0,
    -0.055, 0.2, 0.01, 0.055, 0.2, 0.01,
    -0.03, 0.38, 0.03, 0.03, 0.38, 0.03,
    0.0, 0.5, 0.05,
  ], 3));
  blade.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6]);
  blade.computeVertexNormals();
  const gMat = M.windMat([0, 0, 100], 0.07, 2.0);
  gMat.side = THREE.DoubleSide;
  grassMesh = new THREE.InstancedMesh(blade, gMat, S.grass.length);
  grassMesh.castShadow = false;
  grassMesh.receiveShadow = false;
  grassTint = new Float32Array(S.grass.length);
  const dm = new THREE.Object3D();
  S.grass.forEach(([x, h, z, a, b], i) => {
    dm.position.set(x, h - 0.02, z);
    dm.rotation.set(0, a * 6.28, 0);
    dm.scale.set(0.9 + b * 0.5, 0.55 + a * 0.5, 0.9 + b * 0.4);
    dm.updateMatrix();
    grassMesh.setMatrixAt(i, dm.matrix);
    grassTint[i] = a;
  });
  sc.add(grassMesh);
  // 小石・小さなきのこ (地面に細かく散らす)
  const pebble = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.07, 0), M.mat([0, 0, 100]), 1400);
  const cap = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), M.mat([0, 0, 100]), 260);
  const stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.025, 0.08, 6), M.mat([40, 20, 92]), 260);
  const pr = rngFrom('pebbles');
  const sm = new THREE.Object3D();
  const pl = S.grass.filter((_, i) => i % 19 === 0).slice(0, 1400);
  pl.forEach(([x, h, z], i) => {
    sm.position.set(x + (pr() - 0.5) * 0.6, h + 0.03, z + (pr() - 0.5) * 0.6);
    sm.rotation.set(pr() * 3, pr() * 3, pr() * 3);
    sm.scale.setScalar(0.6 + pr() * 0.9);
    sm.updateMatrix();
    pebble.setMatrixAt(i, sm.matrix);
    pebble.setColorAt(i, col([30 + pr() * 20, 6 + pr() * 10, 55 + pr() * 20]));
  });
  pebble.count = pl.length;
  const shrooms = S.grass.filter((_, i) => i % 97 === 0).slice(0, 260);
  shrooms.forEach(([x, h, z], i) => {
    sm.position.set(x, h + 0.04, z);
    sm.rotation.set(0, pr() * 6, 0);
    sm.scale.setScalar(0.8 + pr() * 0.6);
    sm.updateMatrix();
    stem.setMatrixAt(i, sm.matrix);
    sm.position.y += 0.06;
    sm.updateMatrix();
    cap.setMatrixAt(i, sm.matrix);
    cap.setColorAt(i, col(i % 2 ? [4, 72, 56] : [40, 40, 96]));
  });
  cap.count = shrooms.length; stem.count = shrooms.length;
  for (const m of [pebble, cap, stem]) { m.castShadow = false; m.receiveShadow = true; sc.add(m); }
  // 花
  const fl = new THREE.SphereGeometry(0.08, 6, 5);
  flowerCount = S.flowers.length;
  flowerMesh = new THREE.InstancedMesh(fl, M.windMat([0, 0, 100], 0.02, 1.5), flowerCount);
  flowerMesh.castShadow = false;
  flowerTint = new Float32Array(flowerCount);
  S.flowers.forEach(([x, h, z, k, b], i) => {
    dm.position.set(x, h + 0.2, z);
    dm.rotation.set(0, 0, 0);
    dm.scale.set(1, 1, 1);
    dm.updateMatrix();
    flowerMesh.setMatrixAt(i, dm.matrix);
    flowerTint[i] = k + b * 0.1;
  });
  sc.add(flowerMesh);
  recolorPlants();
}

function recolorPlants() {
  const pal = FLOWER_PAL[season];
  const c = new THREE.Color();
  const grassPal = TERRAIN_PAL[season].light;
  for (let i = 0; i < grassMesh.count; i++) {
    const hsl = grassTint[i] > 0.5 ? grassPal : TERRAIN_PAL[season].dark;
    c.copy(col([hsl[0], hsl[1] * 0.9, hsl[2] + (grassTint[i] - 0.5) * 12]));
    grassMesh.setColorAt(i, c);
  }
  grassMesh.instanceColor.needsUpdate = true;
  for (let i = 0; i < flowerMesh.count; i++) {
    c.copy(col(pal[Math.floor(flowerTint[i] * 5) % pal.length]));
    flowerMesh.setColorAt(i, c);
  }
  flowerMesh.instanceColor.needsUpdate = true;
}

function houseColors(i) {
  const walls = [[30, 40, 88], [350, 50, 88], [200, 40, 86], [48, 60, 84], [120, 30, 84], [280, 30, 88], [16, 50, 84], [170, 30, 84], [60, 40, 86]];
  const roofs = [[6, 60, 46], [210, 40, 42], [28, 50, 38], [340, 50, 44], [150, 30, 36], [260, 35, 40], [20, 55, 40], [190, 30, 36], [10, 60, 48]];
  return [walls[i % walls.length], roofs[i % roofs.length]];
}

function faceTo(x, z, tx, tz) { return Math.atan2(tx - x, tz - z); }

function buildVillage(sc) {
  HOUSE_SITES.forEach(([x, z], i) => {
    const s = findSpot(x, z, 10);
    const [wall, roof] = houseColors(i);
    const g = M.houseModel(wall, roof, 1.8, 1.6, 1.2);
    const rot = faceTo(s.x, s.z, PLAZA.x, PLAZA.z);
    g.position.set(s.x, s.h - 0.05, s.z);
    g.rotation.y = rot;
    sc.add(g);
    world.houses.push({ x: s.x, z: s.z, rot });
    // 窓の明かり (夜に点く)
  });
  const sp = findSpot(SHOP_SITE[0], SHOP_SITE[1], 10);
  const shop = M.shopModel();
  world.shop = { x: sp.x, z: sp.z, rot: faceTo(sp.x, sp.z, PLAZA.x, PLAZA.z) };
  shop.position.set(sp.x, sp.h - 0.05, sp.z);
  shop.rotation.y = world.shop.rot;
  sc.add(shop);
  const shopLamp = new THREE.PointLight(0xffc27a, 0, 8, 1.5);
  shopLamp.position.set(sp.x, sp.h + 2, sp.z);
  sc.add(shopLamp);
  world.lamps.push(shopLamp);

  const hp = findSpot(PLAYER_HOUSE_SITE[0], PLAYER_HOUSE_SITE[1], 10);
  const home = M.houseModel([36, 30, 92], [350, 55, 46], 2.0, 1.8, 1.3);
  home.scale.setScalar(2); // 主人公の家は大きく (玄関の位置は game.js の homeDoor と合わせる)
  home.position.set(hp.x, hp.h - 0.05, hp.z);
  world.home = { x: hp.x, z: hp.z, rot: faceTo(hp.x, hp.z, PLAZA.x, PLAZA.z) };
  home.rotation.y = world.home.rot;
  sc.add(home);
  // 主人公の家の看板 (家の前に立つ。広場の方を向く)
  const board = new THREE.Group();
  M.P(board, 'cyl', [28, 45, 40], { y: 0.7, sx: 0.05, sy: 1.4, sz: 0.05 });
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 96;
  const g2 = cv.getContext('2d');
  g2.fillStyle = '#fff6e0'; g2.fillRect(0, 0, 256, 96);
  g2.strokeStyle = '#6b4a2b'; g2.lineWidth = 8; g2.strokeRect(4, 4, 248, 88);
  g2.fillStyle = '#4a3019'; g2.font = 'bold 44px sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
  g2.fillText('マイホーム', 128, 50);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.56), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
  boardMesh.position.set(0, 1.45, 0);
  board.add(boardMesh);
  board.position.set(hp.x + Math.sin(world.home.rot) * 4.2, hp.h - 0.05, hp.z + Math.cos(world.home.rot) * 4.2);
  board.rotation.y = world.home.rot;
  sc.add(board);

  const sign = M.signModel();
  sign.position.set(PLAZA.x + 3, heightAt(PLAZA.x + 3, PLAZA.z + 3), PLAZA.z + 3);
  sc.add(sign);

  // 橋
  const bridge = M.bridgeModel(BRIDGE.len, BRIDGE.wid);
  bridge.position.set(BRIDGE.x, BRIDGE_DECK_Y - 0.12, BRIDGE.z);
  bridge.rotation.y = Math.atan2(-0.949, -0.316);
  sc.add(bridge);

  // 灯台・遺跡・丘の祠・湖の光
  const sites = shardSites();
  const lh = findSpot(-48, -6, 16);
  const light = M.lighthouseModel();
  light.position.set(lh.x, lh.h - 0.2, lh.z);
  sc.add(light);
  world.lighthouse = { x: lh.x, z: lh.z, y: lh.h };
  lighthouseLamp = new THREE.PointLight(0xfff2b0, 0, 60, 1.2);
  lighthouseLamp.position.set(lh.x, lh.h + 4.8, lh.z);
  sc.add(lighthouseLamp);

  const ruin = M.stoneModel(rngFrom('ruin'));
  ruin.position.set(sites.ruins.x, sites.ruins.h - 0.1, sites.ruins.z);
  sc.add(ruin);
  const hill = M.stoneModel(rngFrom('hill'));
  hill.position.set(sites.hill.x, sites.hill.h - 0.1, sites.hill.z);
  sc.add(hill);
  const cherry = M.treeModel('cherry', rngFrom('cherry'));
  cherry.position.set(sites.hill.x + 2.2, sites.hill.h - 0.1, sites.hill.z - 1.5);
  cherry.scale.setScalar(1.3);
  sc.add(cherry);
  world.trees.push({ x: sites.hill.x + 2.2, z: sites.hill.z - 1.5, kind: 'cherry', story: true });

  // 物語のかけら (出現時のみ表示)
  const place = {
    hill: sites.hill, lake: sites.lake, ruins: sites.ruins, lighthouse: { x: lh.x + 1.6, z: lh.z + 1.4, h: lh.h },
  };
  ['hill', 'lake', 'ruins', 'lighthouse'].forEach((k, c) => {
    const p = place[k];
    const g = M.shardModel();
    g.position.set(p.x, (p.h ?? heightAt(p.x, p.z)) + 0.05, p.z);
    g.visible = false;
    sc.add(g);
    shardMeshes[c] = g;
    world.shards[c] = { x: p.x, z: p.z };
  });
}

// ---------- 室内 ----------
let interiorFixed = [];
const furnMeshes = new Map();

function buildInterior() {
  const room = M.roomWalls(ROOM.w, ROOM.d, [36, 36, 94], [28, 46, 64]);
  interior.add(room);
  // 部屋の外側の地面 (空が抜けないように)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), M.mat([96, 26, 46]));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(ROOM.w / 2, -0.12, ROOM.d / 2);
  ground.receiveShadow = true;
  interior.add(ground);
  // 固定の家具: ベッド・かまど
  const bed = M.itemModel('furn:0');
  bed.position.set(2, 0, 1.5);
  interior.add(bed);
  const stove = M.stoveModel();
  stove.position.set(10.5, 0, 1.5);
  interior.add(stove);
  const rug = M.itemModel('furn:' + (9 * 20 + 9));
  rug.position.set(5, 0, 4);
  interior.add(rug);
  interiorFixed = [{ kind: 'bed', x: 1.5, z: 1.5 }, { kind: 'stove', x: 10.5, z: 1.5 }];
}

// ---------- 空・光 ----------
function buildSky(sc) {
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, bottom: { value: new THREE.Color('#24345e') } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main(){ float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, smoothstep(0.0, 0.5, h)) : mix(horizon, bottom, smoothstep(0.0, -0.25, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
  dome.renderOrder = -1;
  sc.add(dome);
  const sg = new THREE.BufferGeometry();
  const r = rngFrom('stars');
  const arr = [];
  for (let i = 0; i < 600; i++) {
    const th = r() * Math.PI * 2, ph = Math.acos(r() * 0.95 + 0.05);
    arr.push(300 * Math.sin(ph) * Math.cos(th), 300 * Math.cos(ph), 300 * Math.sin(ph) * Math.sin(th));
  }
  sg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  sc.add(stars);
  // 雲
  const cr = rngFrom('clouds');
  for (let i = 0; i < 12; i++) {
    const g = new THREE.Group();
    const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(3 + cr() * 2, 12, 8), cm);
      s.position.set((k - 1.5) * 3.2 + cr() * 2, cr() * 1.2, cr() * 2);
      s.scale.y = 0.6;
      s.castShadow = false;
      g.add(s);
    }
    g.position.set((cr() - 0.5) * 320, 48 + cr() * 14, (cr() - 0.5) * 320);
    g.userData.speed = 0.8 + cr() * 1.2;
    sc.add(g);
    clouds.push(g);
  }
}

function buildLights(sc) {
  hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a7a50, 0.9);
  sc.add(hemi);
  sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc2 = sun.shadow.camera;
  sc2.left = -42; sc2.right = 42; sc2.top = 42; sc2.bottom = -42; sc2.near = 2; sc2.far = 220;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  sc.add(sun, sun.target);
}

// ---------- 初期化 ----------
export function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // 画面の細かさ (ピクセル密度) を上げて、スマホでもくっきり見せる。重い端末では上限で抑える
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene.fog = new THREE.Fog(0xffffff, 90, 230);
  buildSky(scene);
  buildLights(scene);
  buildTerrain(outdoor);
  buildWater(outdoor);
  buildScatter(outdoor);
  buildVillage(outdoor);
  buildInterior();
  setSeason(season);
  resize();
}

export function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

export function setSeason(s) {
  season = s;
  M.setSeasonColors(s);
  if (terrainMesh) { recolorTerrain(); recolorPlants(); }
}

// ---------- 毎フレーム更新 ----------
export function update(dt, time, hour, focus, inside) {
  M.WIND.uTime.value = time;
  outdoor.visible = !inside;
  interior.visible = inside;
  // 太陽・月
  const a = ((hour - 6) / 24) * Math.PI * 2;
  const sinA = Math.sin(a), cosA = Math.cos(a);
  const sky = skyAt(hour);
  const day = clamp((sinA + 0.1) * 3, 0, 1);
  const dirX = sinA > -0.05 ? cosA : -cosA;
  const dirY = sinA > -0.05 ? sinA : -sinA;
  const sunTarget = inside ? { x: focus.x, y: 1, z: focus.z } : { x: focus.x, y: 0.5, z: focus.z };
  sun.position.set(focus.x + dirX * 80, focus.y + Math.max(dirY, 0.05) * 80, focus.z + 30);
  if (inside) sun.position.set(focus.x + 10, 20, focus.z + 14);
  sun.target.position.set(sunTarget.x, sunTarget.y, sunTarget.z);
  sun.target.updateMatrixWorld();
  sun.intensity = inside ? 0.8 : (sinA > -0.05 ? 1.5 * clamp(sinA * 2.2 + 0.2, 0, 1) : 0.25);
  sun.color.copy(col([0, 0, 100])).lerp(sky.sun, 0.7);
  hemi.intensity = inside ? 1.4 : lerp(0.5, 1.25, day);
  hemi.color.copy(sky.top).lerp(new THREE.Color(0xffffff), 0.5);
  hemi.groundColor.copy(sky.hz).multiplyScalar(0.55);
  skyMat.uniforms.top.value.copy(sky.top);
  skyMat.uniforms.horizon.value.copy(sky.hz);
  skyMat.uniforms.bottom.value.copy(sky.hz).lerp(sky.top, 0.3);
  scene.fog.color.copy(sky.hz);
  scene.fog.near = inside ? 25 : 90;
  scene.fog.far = inside ? 60 : 230;
  const night = 1 - day;
  stars.material.opacity = clamp((night - 0.35) * 2, 0, 0.9);
  stars.position.set(focus.x, 0, focus.z);
  for (const l of world.lamps) l.intensity = night * 1.3;
  if (lighthouseLamp) lighthouseLamp.intensity = (state.lighthouseOn ? 1 : 0) * (0.5 + night * 2.2);
  // 雲
  for (const c of clouds) {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > focus.x + 180) c.position.x -= 360;
  }
  // 物語のかけら
  shardMeshes.forEach((g, c) => {
    if (g && g.visible) { g.rotation.y += dt * 1.2; g.position.y += Math.sin(time * 2 + c) * 0.002; }
  });
  dome.position.copy(focus);
  renderer.render(scene, camera);
}

// ---------- 外部から使う操作 ----------
// 開始し直すとき: 前回の家具・畑の表示を消し、かけらと灯台を初期状態に戻す
export function resetWorldObjects() {
  for (const o of furnMeshes.values()) o.parent?.remove(o);
  furnMeshes.clear();
  for (const g of plotGroups.values()) outdoor.remove(g);
  plotGroups.clear();
  shardMeshes.forEach((g) => { if (g) g.visible = false; });
  state.lighthouseOn = false;
}
// 畑の表示をすべて消す (畑の番号が詰まるので作り直すとき用)
export function clearPlots() {
  for (const g of plotGroups.values()) outdoor.remove(g);
  plotGroups.clear();
}
export function setShardVisible(c, on) { if (shardMeshes[c]) shardMeshes[c].visible = on; }
export function setLighthouse(on) { state.lighthouseOn = on; }

// 畑: plot = { x, z, crop (作物番号 or null), stage (0-4) }
const plotGroups = new Map();
export function setPlot(i, plot) {
  let g = plotGroups.get(i);
  if (!g) {
    g = new THREE.Group();
    outdoor.add(g);
    plotGroups.set(i, g);
  }
  g.position.set(plot.x, heightAt(plot.x, plot.z) + 0.02, plot.z);
  while (g.children.length) g.remove(g.children[0]);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.08, 16), M.mat([26, 46, 34]));
  soil.position.y = 0.02;
  soil.receiveShadow = true;
  g.add(soil);
  if (plot.crop != null) g.add(M.cropModel(CROPS[plot.crop], plot.stage));
}

// 家具を置く。cell.outdoor が true なら外 (草の上)、false なら家の中
export function placeFurniture(id, entry, cell) {
  const { x, z, rot } = entry;
  const obj = M.itemModel(entry.key);
  const [w, d] = footprint(cell.fp, rot);
  if (cell.outdoor) {
    const cx = x + w / 2, cz = z + d / 2;
    obj.position.set(cx, Math.max(heightAt(cx, cz), 0), cz);
    outdoor.add(obj);
  } else {
    obj.position.set(x + w / 2, 0, z + d / 2); // 部屋は interior 側でずれているので、ここは部屋の中の座標
    interior.add(obj);
  }
  obj.rotation.y = -rot * Math.PI / 2;
  furnMeshes.set(id, obj);
}
const footprint = (fp, rot) => (rot % 2 === 1 ? [fp[1], fp[0]] : [fp[0], fp[1]]);
export function removeFurniture(id) {
  const o = furnMeshes.get(id);
  if (o) { o.parent?.remove(o); furnMeshes.delete(id); }
}
// 配置中の半透明の見本 (outdoorMode で外か家の中かを決める)
export function setGhost(key, cell, valid, outdoorMode = false) {
  if (!cell) { if (ghost) ghost.visible = false; return; }
  if (!ghost || ghost.userData.key !== key) {
    ghost?.parent?.remove(ghost);
    ghost = M.itemModel(key);
    ghost.userData.key = key;
    ghost.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.castShadow = false; } });
  }
  const parent = outdoorMode ? outdoor : interior;
  if (ghost.parent !== parent) { ghost.parent?.remove(ghost); parent.add(ghost); }
  ghost.visible = true;
  const [w, d] = footprint(cell.fp, cell.rot);
  if (outdoorMode) {
    const cx = cell.x + w / 2, cz = cell.z + d / 2;
    ghost.position.set(cx, Math.max(heightAt(cx, cz), 0), cz);
  } else {
    ghost.position.set(cell.x + w / 2, 0, cell.z + d / 2);
  }
  ghost.rotation.y = -cell.rot * Math.PI / 2;
  ghost.traverse((o) => { if (o.isMesh) o.material.color.setRGB(1, valid ? 1 : 0.4, valid ? 1 : 0.4); });
}

export function spawnVisual(key, x, z) {
  const g = M.itemModel(key);
  g.position.set(x, heightAt(x, z), z);
  g.scale.setScalar(1.7);
  scene.add(g);
  return g;
}
export function removeVisual(obj) { if (obj) scene.remove(obj); }


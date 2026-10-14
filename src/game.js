// ゲームの進行とシステム: 時間・移動・釣り・虫取り・畑・料理・店・家具配置・住民・物語・保存
import {
  CHAPTERS, SHARD_NAMES, VILLAGERS, FISH, BUGS, DISHES, CROPS, FURNITURE, SEASON_NAMES, BUG_WINGS, TOOL, ORES, WOODS,
  seasonOf, yearOf, dayInSeason, inSeason, infoOf, tagsOf,
} from './data.js';
import { loadSave, writeSave, clamp, angleLerp } from './util.js';
import * as T from './terrain.js';
import * as S from './scene.js';
import { makePlayer, makeVillager, animateChar } from './models.js';
import { se } from './audio.js';

// 鉱石・木材を重み付きで選ぶ (レアなほど出にくい)
function pickWeighted(list) {
  let tot = 0;
  const w = list.map((x) => { const v = 1 + (4 - x.rare) * 1.2; tot += v; return v; });
  let r = Math.random() * tot;
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}
// 岩・木を消す (翌々日に戻る)
function takeDown(kind, i) {
  const e = S.world[kind][i];
  e.obj.visible = false;
  e.broken = true;
  rt.st.gone[kind][i] = rt.st.day + 2;
  buildObstacles();
}

export const DAY_SEC = 240; // 実時間240秒 = ゲーム内1日
export const POCKET_MAX = 60;
const SEASON_KEYS = ['spring', 'summer', 'autumn', 'winter'];
const OFF = S.INT_OFF, ROOM = S.ROOM;
const FIXED_CELLS = [[1, 1], [2, 1], [10, 1]]; // ベッド2マス・かまど

// 画面側が差し替える通知先
export const hooks = {
  toast: () => {}, say: () => {}, open: () => {}, prompt: () => {}, bite: () => {}, refresh: () => {}, saved: () => {},
};

export const rt = {
  st: null, player: null, villagers: [], bugs: [], obstacles: [], fishing: null, placing: null,
  modal: false, paused: false, spawnT: 1, shakeCd: 0, autosaveT: 0, lastPrompt: null, nextId: 1, frame: 0, target: null,
};

export function newState() {
  return {
    day: 1, hour: 6, money: 500, pocket: { [TOOL.rod]: 1, [TOOL.net]: 1, [TOOL.knife]: 1, [TOOL.pick]: 1, [TOOL.axe]: 1, [TOOL.shovel]: 1 }, disc: {},
    gone: { trees: {}, rocks: {} }, stats: { fish: 0, bugs: 0, cooked: 0, crops: 0, sold: 0 },
    chapter: 0, shardReady: [false, false, false, false], shardTaken: [false, false, false, false],
    plots: [], house: [], friend: {}, talked: {}, pos: { x: -20, z: 23, ry: 0 }, inside: false, lighthouseOn: false,
  };
}

// ---------- 表示用の情報 ----------
export const isDay = () => rt.st.hour >= 4.5 && rt.st.hour < 17.5;
export const curSeason = () => seasonOf(rt.st.day);
export function dateText() {
  const d = rt.st.day;
  return `${SEASON_NAMES[seasonOf(d)]} ${dayInSeason(d)}日目 ・ ${yearOf(d)}年目`;
}
export function clockText() {
  const h = Math.floor(rt.st.hour) % 24, m = Math.floor((rt.st.hour % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function goalText() {
  const c = CHAPTERS[rt.st.chapter];
  if (!c) return 'ひかりのかけらを すべて集めた。灯台が島を照らしている。';
  return `第${rt.st.chapter + 1}章「${c.title}」… ${c.goal}`;
}
export function goalProgress() {
  const s = rt.st, c = s.chapter;
  const ch = CHAPTERS[c];
  if (!ch) return 1;
  const cur = c === 0 ? Object.keys(s.disc).length : c === 1 ? s.stats.fish : c === 2 ? s.stats.bugs : s.stats.cooked;
  return clamp(cur / ch.target, 0, 1);
}
export const countOf = (key) => rt.st.pocket[key] || 0;
export const pocketKinds = () => Object.keys(rt.st.pocket);
export const canAdd = (key) => rt.st.pocket[key] != null || Object.keys(rt.st.pocket).length < POCKET_MAX;

// 季節・時間に合うか
const available = (mask, time, day) => inSeason(mask, seasonOf(rt.st.day)) && (time === 'a' || (time === 'd') === day);

// ---------- 所持品 ----------
export function addItem(key, n = 1, quiet = false) {
  const p = rt.st.pocket;
  if (!canAdd(key)) { if (!quiet) hooks.toast('ポーチがいっぱいです'); return false; }
  p[key] = (p[key] || 0) + n;
  const cat = key.split(':')[0];
  if (cat !== 'seed') rt.st.disc[key] = true;
  return true;
}
export function removeItem(key, n = 1) {
  const p = rt.st.pocket;
  p[key] = (p[key] || 0) - n;
  if (p[key] <= 0) delete p[key];
}

export const hasTool = (k) => countOf(k) > 0;
function needTool(k, msg) {
  if (hasTool(k)) return true;
  hooks.toast(msg);
  return false;
}

export function buy(key) {
  const info = infoOf(key), s = rt.st;
  if (info.cat === 'tool' && hasTool(key)) return hooks.toast('もう持っています');
  if (s.money < info.price) return hooks.toast('お金がたりないみたい');
  if (!addItem(key, 1)) return;
  s.money -= info.price;
  se.coin();
  hooks.toast(`${info.name}を かった（${info.price}コイン）`);
  hooks.refresh();
}
export function sell(key, n = 1) {
  const info = infoOf(key), s = rt.st;
  if (info.cat === 'tool') return hooks.toast('道具は売れません');
  const have = countOf(key);
  if (!have) return;
  n = Math.min(n, have);
  const unit = info.cat === 'furn' ? Math.round(info.price / 2) : info.price;
  removeItem(key, n);
  s.money += unit * n;
  s.stats.sold += n;
  se.coin();
  hooks.toast(`${info.name} x${n} を うった（+${unit * n}コイン）`);
  hooks.refresh();
}

// ---------- 料理 ----------
// 必要な材料がポーチにあるか。あれば使う材料一覧を返す
export function recipeIngredients(d) {
  const need = DISHES[d].tags;
  const left = { ...rt.st.pocket };
  const used = [];
  for (const tag of need) {
    const key = Object.keys(left).find((k) => left[k] > 0 && tagsOf(k).includes(tag));
    if (!key) return null;
    left[key] -= 1;
    used.push(key);
  }
  return used;
}
export function cook(d) {
  const used = recipeIngredients(d);
  if (!used) return hooks.toast('材料がたりない');
  if (!hasTool(TOOL.knife)) return hooks.toast('ほうちょうが ひつようです（モコのお店で かえます）');
  if (!canAdd(`dish:${d}`)) return hooks.toast('ポーチがいっぱいです');
  used.forEach((k) => removeItem(k, 1));
  addItem(`dish:${d}`, 1);
  rt.st.stats.cooked += 1;
  se.pop();
  hooks.toast(`${DISHES[d].name}が できあがった！`);
  checkStory();
  hooks.refresh();
}

// ---------- 物語 ----------
export function checkStory() {
  const s = rt.st, c = s.chapter;
  const ch = CHAPTERS[c];
  if (!ch || s.shardReady[c]) return;
  const disc = Object.keys(s.disc).length;
  if (ch.check(s, disc)) {
    s.shardReady[c] = true;
    S.setShardVisible(c, true);
    hooks.toast(`${SHARD_NAMES[ch.shard]}に「ひかりのかけら」があらわれた！`);
  }
}

function takeShard(c) {
  const s = rt.st;
  s.shardTaken[c] = true;
  s.shardReady[c] = true;
  S.setShardVisible(c, false);
  addItem('seed:' + (c * 20), 1, true); // 記念の種 (かけらのお礼)
  s.money += 300;
  s.chapter = c + 1;
  if (c === 3) {
    s.lighthouseOn = true;
    S.setLighthouse(true);
    hooks.say('ホロウ', ['かけらが すべてそろった。灯台の光が、島の季節をまた一つにしてくれた。', 'ありがとう。これからも、この島で好きに暮らしていってくれ。']);
  } else {
    const next = CHAPTERS[c + 1];
    hooks.say('ホロウ', ['ひかりのかけらを、たしかに受け取った。', next.intro]);
  }
  hooks.toast(`ひかりのかけらを手に入れた！（+300コイン）`);
  persist();
  hooks.refresh();
}

// ---------- 住民 ----------
export function talk(v) {
  const s = rt.st, d = v.data;
  v.face = 4;
  if (d.shop) return openShop();
  const lines = [];
  if (d.story && s.chapter < 4) lines.push(d.story[Math.min(s.chapter, 3)]);
  lines.push(d.talk[(s.day + d.name.length) % d.talk.length]);
  if (s.talked[d.id] !== s.day) {
    s.talked[d.id] = s.day;
    s.friend[d.id] = Math.min(100, (s.friend[d.id] || 0) + 5);
  }
  hooks.say(d.name, lines);
}
export function openShop() { hooks.open('shop'); }

function createVillagers() {
  rt.villagers.forEach((v) => S.scene.remove(v.rig.root));
  rt.villagers = VILLAGERS.map((data) => {
    const rig = makeVillager(data);
    S.scene.add(rig.root);
    const h = data.shop ? S.world.shop : S.world.houses[data.home % S.world.houses.length];
    const front = data.shop ? 2.4 : 1.8;
    const x = h.x + Math.sin(h.rot) * front, z = h.z + Math.cos(h.rot) * front;
    return { data, rig, x, z, home: { x: h.x, z: h.z }, tx: x, tz: z, wait: Math.random() * 3, face: 0, ry: h.rot };
  });
}

// ---------- 家の出入り・家具 ----------
export function homeDoor(out = 0) {
  const h = S.world.home;
  const dx = Math.sin(h.rot), dz = Math.cos(h.rot);
  return { x: h.x + dx * (1.4 + out), z: h.z + dz * (1.4 + out), dx, dz };
}

const cellsOf = (key, x, z, rot) => {
  const fp = FURNITURE[Number(key.split(':')[1])].fp;
  const sw = rot % 2 === 1;
  const w = sw ? fp[1] : fp[0], d = sw ? fp[0] : fp[1];
  const out = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([x + i, z + j]);
  return out;
};
function occupancy() {
  const set = new Set(FIXED_CELLS.map(([x, z]) => `${x},${z}`));
  for (const e of rt.st.house) for (const [x, z] of cellsOf(e.key, e.x, e.z, e.rot)) set.add(`${x},${z}`);
  return set;
}
function roomCellsOK(cells, occ) {
  return cells.every(([x, z]) => x >= 0 && z >= 0 && x < ROOM.w && z < ROOM.d && !occ.has(`${x},${z}`));
}

export function startPlacing(key) {
  if (!rt.st.inside) return hooks.toast('おうちの中で おけるよ');
  rt.placing = { key, rot: 0 };
  hooks.toast('Spaceでおく・Rでまわす・Escでやめる');
  hooks.refresh();
}
function placingCell() {
  const p = rt.st.pos;
  const fx = p.x + Math.sin(p.ry) * 1.3 - OFF.x, fz = p.z + Math.cos(p.ry) * 1.3 - OFF.z;
  return { x: Math.floor(fx), z: Math.floor(fz) };
}
function placeFurnitureHere() {
  const pl = rt.placing, s = rt.st;
  if (!countOf(pl.key)) { rt.placing = null; return hooks.toast('もう おけるものがない'); }
  const c = placingCell();
  const cells = cellsOf(pl.key, c.x, c.z, pl.rot);
  if (!roomCellsOK(cells, occupancy())) return hooks.toast('ここには おけない');
  const entry = { id: 'h' + rt.nextId++, key: pl.key, x: c.x, z: c.z, rot: pl.rot };
  s.house.push(entry);
  removeItem(pl.key, 1);
  S.placeFurniture(entry.id, entry, { fp: FURNITURE[Number(pl.key.split(':')[1])].fp });
  rt.placing = null; // 1つおいたら配置モードを終える
  se.place();
  hooks.toast('おいた！');
  hooks.refresh();
}
function pickupFurnitureHere() {
  const c = placingCell();
  const idx = rt.st.house.findIndex((e) => cellsOf(e.key, e.x, e.z, e.rot).some(([x, z]) => x === c.x && z === c.z));
  if (idx < 0) return false;
  const [e] = rt.st.house.splice(idx, 1);
  S.removeFurniture(e.id);
  addItem(e.key, 1);
  hooks.toast(`${infoOf(e.key).name}を しまった`);
  return true;
}

// ---------- 畑 ----------
function plotView(p) { return { x: p.x, z: p.z, crop: p.crop, stage: p.stage || 0 }; }
function refreshPlots() { rt.st.plots.forEach((p, i) => S.setPlot(i, plotView(p))); }

function plotAt(x, z, r = 1.3) {
  let best = -1, bd = r;
  rt.st.plots.forEach((p, i) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = i; } });
  return best;
}
function plotLabel(i) {
  const p = rt.st.plots[i];
  if (p.crop != null) {
    if (p.grow >= CROPS[p.crop].growDays) return 'しゅうかく';
    return p.watered ? null : 'みずをあげる';
  }
  return 'たねをまく';
}
// まくたねを選ぶ (ポーチから)。選んだたねが無くなったら最初のたねに戻る
export function selectSeed(key) {
  rt.seedKey = key;
  hooks.toast(`${infoOf(key).name}を まく用にえらんだ`);
}
function plotAct(i) {
  const s = rt.st, p = s.plots[i];
  if (p.crop != null) {
    const c = CROPS[p.crop];
    if (p.grow >= c.growDays) {
      if (!addItem(c.id, 1)) return;
      if (Math.random() < 0.5) addItem('seed:' + p.crop, 1, true);
      p.crop = null; p.grow = 0; p.stage = 0; p.watered = false;
      s.stats.crops += 1;
      se.coin();
      hooks.toast(`${c.name}を しゅうかくした！`);
      checkStory();
    } else if (!p.watered) {
      p.watered = true;
      hooks.toast('みずをあげた');
    } else {
      hooks.toast('すくすく育っている');
    }
  } else {
    const key = (rt.seedKey && countOf(rt.seedKey) ? rt.seedKey : null) || pocketKinds().find((k) => k.startsWith('seed:'));
    if (!key) return hooks.toast('まく たねが ない（モコのお店で買えるよ）');
    const ci = Number(key.split(':')[1]);
    removeItem(key, 1);
    p.crop = ci; p.grow = 0; p.stage = 0; p.watered = true;
    const warm = inSeason(CROPS[ci].mask, curSeason());
    hooks.toast(`${CROPS[ci].name}のたねを まいた${warm ? '' : '（今の季節は育ちにくい）'}`);
  }
  S.setPlot(i, plotView(p));
  hooks.refresh();
}
function dig(x, z) {
  if (rt.st.plots.length >= 40) return hooks.toast('これ以上は たがやせない');
  rt.st.plots.push({ x, z, crop: null, grow: 0, stage: 0, watered: false });
  se.dig();
  refreshPlots();
  hooks.toast(hasTool(TOOL.shovel) ? '土をたがやした（いらない畑は、スコップで畑の真ん中に立って「ならす」）' : '土をたがやした（スコップがあれば消せます）');
}

// ---------- 釣り ----------
function pickFish(kind) {
  const day = isDay();
  let pool = FISH.filter((f) => f.loc === kind && available(f.mask, f.time, day));
  if (!pool.length) pool = FISH.filter((f) => f.loc === kind && Math.random() < 0.3);
  if (!pool.length) return null;
  let tot = 0;
  const w = pool.map((f) => { const v = 1 + (4 - f.rare) * 1.4; tot += v; return v; });
  let r = Math.random() * tot;
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}
function startFishing(kind) {
  if (!needTool(TOOL.rod, 'つりざおが ひつようです（モコのお店で かえます）')) return;
  rt.fishing = { phase: 'wait', t: 0, wait: 2 + Math.random() * 3, kind };
  hooks.toast('つりを はじめた…（うきが沈んだら A！）');
}
function fishAct() {
  const f = rt.fishing;
  rt.fishing = null;
  hooks.bite(false);
  if (f.phase !== 'bite') return hooks.toast('つりを やめた');
  const fish = pickFish(f.kind);
  if (!fish) return hooks.toast('ゴミが つれた…');
  if (addItem(fish.id, 1)) {
    se.catch();
    rt.st.stats.fish += 1;
    hooks.toast(`${fish.name}が つれた！`);
    checkStory();
  }
  hooks.refresh();
}

// ---------- 虫 ----------
function bugOk(b, day) { return available(b.mask, b.time, day); }
function spawnBug() {
  const s = rt.st, p = s.pos, day = isDay();
  const eligible = [];
  for (let si = 0; si < 25; si++) {
    const ref = BUGS[si * 16];
    if (bugOk(ref, day)) eligible.push(si);
  }
  if (!eligible.length) return;
  for (let tries = 0; tries < 16; tries++) {
    const a = Math.random() * Math.PI * 2, r = 9 + Math.random() * 13;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (!T.walkable(x, z) || (T.waterKindAt(x, z) && Math.random() < 0.9)) continue;
    const near = (kind) => (kind === 'water' ? T.waterKindAt(x, z) != null : S.world.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 4));
    const hab = near('water') ? 'water' : near('tree') ? 'tree' : Math.random() < 0.5 ? 'flower' : 'ground';
    let pool = eligible.filter((si) => BUGS[si * 16].habitat === hab);
    if (!pool.length) pool = eligible;
    const si = pool[Math.floor(Math.random() * pool.length)];
    const ci = Math.floor(Math.random() * 16);
    const key = `bug:${si * 16 + ci}`;
    const obj = S.spawnVisual(key, x, z);
    rt.bugs.push({ key, info: BUGS[si * 16 + ci], obj, x, z, tx: x, tz: z, wait: 1, flee: 0 });
    return;
  }
}
function updateBugs(dt) {
  const s = rt.st, p = s.pos;
  rt.spawnT -= dt;
  if (rt.spawnT <= 0 && !s.inside && rt.bugs.length < 12) { rt.spawnT = 1.2 + Math.random() * 2; spawnBug(); }
  const day = isDay();
  for (let i = rt.bugs.length - 1; i >= 0; i--) {
    const b = rt.bugs[i];
    const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz);
    if (d > 42 || (rt.frame % 60 === 0 && !bugOk(b.info, day))) { S.removeVisual(b.obj); rt.bugs.splice(i, 1); continue; }
    let sp = 0.7, dirx = b.tx - b.x, dirz = b.tz - b.z;
    if (b.flee > 0 || d < 3.2) {
      b.flee = Math.max(b.flee, 0.6);
      dirx = dx; dirz = dz; sp = b.info.fast ? 4.2 : 2.8;
    } else if (b.wait > 0) {
      b.wait -= dt; sp = 0;
    } else if (Math.hypot(dirx, dirz) < 0.2) {
      b.wait = 1 + Math.random() * 2;
      const a = Math.random() * Math.PI * 2;
      b.tx = b.x + Math.cos(a) * 2.5; b.tz = b.z + Math.sin(a) * 2.5;
    }
    b.flee = Math.max(0, b.flee - dt);
    const len = Math.hypot(dirx, dirz) || 1;
    const nx = b.x + (dirx / len) * sp * dt, nz = b.z + (dirz / len) * sp * dt;
    if (sp > 0 && T.walkable(nx, nz)) { b.x = nx; b.z = nz; } else if (sp > 0) { b.tx = b.x; b.tz = b.z; }
    const hy = T.groundY(b.x, b.z);
    const fly = [1, 3, 4].includes(BUG_WINGS[b.info.sp]);
    b.obj.position.set(b.x, hy + (fly ? 0.45 + Math.sin(performance.now() / 180 + i) * 0.12 : 0.04), b.z);
    if (sp > 0) b.obj.rotation.y = Math.atan2(dirx, dirz);
  }
}
function bugAct(b) {
  const s = rt.st;
  if (!needTool(TOOL.net, '虫あみが ひつようです（モコのお店で かえます）')) return;
  const ok = Math.random() < (b.info.fast ? 0.45 : 0.8);
  if (!ok) { b.flee = 2; return hooks.toast('にげられた…'); }
  if (!addItem(b.key, 1)) return;
  S.removeVisual(b.obj);
  rt.bugs.splice(rt.bugs.indexOf(b), 1);
  s.stats.bugs += 1;
  se.catch();
  hooks.toast(`${b.info.name}を つかまえた！`);
  checkStory();
  hooks.refresh();
}
function shakeTree() {
  if (rt.shakeCd > 0) return hooks.toast('もう ゆれない…');
  rt.shakeCd = 2;
  const day = isDay();
  const pool = BUGS.filter((b) => b.habitat === 'tree' && bugOk(b, day));
  if (!pool.length || Math.random() < 0.6) return hooks.toast('ざわざわ…。なにも落ちてこなかった');
  const b = pool[Math.floor(Math.random() * pool.length)];
  if (addItem(b.id, 1)) hooks.toast(`${b.name}が おちてきた！`);
  hooks.refresh();
}

// ---------- 近くの対象 ----------
function nearestVillager(r) {
  const p = rt.st.pos;
  let best = null, bd = r;
  for (const v of rt.villagers) { const d = Math.hypot(v.x - p.x, v.z - p.z); if (d < bd) { bd = d; best = v; } }
  return best;
}
const front = (d = 1.3) => { const p = rt.st.pos; return { x: p.x + Math.sin(p.ry) * d, z: p.z + Math.cos(p.ry) * d }; };
const dist = (x, z) => Math.hypot(rt.st.pos.x - x, rt.st.pos.z - z);
function nearestBug(r) {
  const p = rt.st.pos;
  let best = null, bd = r;
  for (const b of rt.bugs) { const d = Math.hypot(b.x - p.x, b.z - p.z); if (d < bd) { bd = d; best = b; } }
  return best;
}

// 近くにある、壊れていない岩・木の番号 (無ければ -1)。飾りの木は対象外
function nearestIdx(kind, f, r) {
  let best = -1, bd = r;
  S.world[kind].forEach((e, i) => {
    if (e.broken || e.story) return;
    const d = Math.hypot(e.x - f.x, e.z - f.z);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
function mineRock(i) {
  if (!needTool(TOOL.pick, 'つるはしが ひつようです（モコのお店で かえます）')) return;
  const r = S.world.rocks[i];
  r.hp = (r.hp ?? 3) - 1;
  se.dig();
  if (r.hp > 0) return hooks.toast('カンッ！');
  const n = 1 + (Math.random() < 0.4 ? 1 : 0);
  const got = [];
  for (let k = 0; k < n; k++) {
    const ore = pickWeighted(ORES);
    if (addItem(ore.id, 1)) got.push(ore.name);
  }
  takeDown('rocks', i);
  rt.st.stats.mined += 1;
  se.catch();
  hooks.toast(got.length ? `岩がくずれた！ ${got.join('・')}` : '岩がくずれた…（ポーチがいっぱい）');
  checkStory();
  hooks.refresh();
}
// 空の畑をスコップでならす (作物が植わっている畑は消せない)
function levelPlot(i) {
  if (!needTool(TOOL.shovel, 'スコップが ひつようです（モコのお店で かえます）')) return;
  const p = rt.st.plots[i];
  if (p.crop != null) return hooks.toast('作物を先にしゅうかくしてね');
  rt.st.plots.splice(i, 1);
  S.clearPlots();
  refreshPlots();
  se.dig();
  hooks.toast('畑をならした');
  hooks.refresh();
}
function chopTree(i) {
  if (!needTool(TOOL.axe, 'おのが ひつようです（モコのお店で かえます）')) return;
  const t = S.world.trees[i];
  t.hp = (t.hp ?? 3) - 1;
  se.dig();
  if (Math.random() < 0.7) { const w = pickWeighted(WOODS); addItem(w.id, 1, true); }
  if (t.hp > 0) return hooks.toast('カン、カン…');
  let extra = 0;
  for (let k = 0; k < 2; k++) { const w = pickWeighted(WOODS); if (addItem(w.id, 1)) extra += 1; }
  takeDown('trees', i);
  rt.st.stats.chopped += 1;
  se.catch();
  hooks.toast(`木が たおれた！（木材を ${extra + 1}こ ほどゲット）`);
  hooks.refresh();
}
// 今押せる行動 { label, act } を返す
export function findTarget() {
  const s = rt.st;
  if (rt.placing) return { label: 'おく', act: placeFurnitureHere };
  if (rt.fishing) return { label: rt.fishing.phase === 'bite' ? 'つる！' : 'やめる', act: fishAct };
  const f = front(1.3);
  const v = nearestVillager(2.4);
  if (v) return { label: v.data.shop ? 'みせてもらう' : 'はなす', act: () => talk(v) };
  if (s.inside) {
    const lx = s.pos.x - OFF.x, lz = s.pos.z - OFF.z;
    const fx = f.x - OFF.x, fz = f.z - OFF.z;
    if (Math.hypot(lx - 2, lz - 1.5) < 2.2) return { label: 'ねる', act: sleep };
    if (Math.hypot(lx - 10.5, lz - 1.5) < 2.2) return { label: 'りょうり', act: () => (hasTool(TOOL.knife) ? hooks.open('cook') : hooks.toast('ほうちょうが ひつようです（モコのお店で かえます）')) };
    if (lz > 6.8 && Math.abs(lx - 5.5) < 2.2) return { label: 'そとへ', act: exitHouse };
    if (s.house.some((e) => cellsOf(e.key, e.x, e.z, e.rot).some(([x, z]) => x === Math.floor(fx) && z === Math.floor(fz)))) {
      return { label: 'ひろう', act: pickupFurnitureHere };
    }
    return null;
  }
  const b = nearestBug(2.3);
  if (b) return { label: 'あみでとる', act: () => bugAct(b) };
  for (let c = 0; c < 4; c++) {
    const sh = S.world.shards[c];
    if (s.shardReady[c] && !s.shardTaken[c] && sh && Math.hypot(sh.x - s.pos.x, sh.z - s.pos.z) < 2.6) {
      return { label: 'ひかりを ひろう', act: () => takeShard(c) };
    }
  }
  const door = homeDoor();
  if (Math.hypot(door.x - s.pos.x, door.z - s.pos.z) < 2.2) return { label: 'いえに はいる', act: enterHouse };
  const sh = S.world.shop;
  if (sh && Math.hypot(sh.x - s.pos.x, sh.z - s.pos.z) < 3.2) return { label: 'お店', act: openShop };
  const sign = { x: T.PLAZA.x + 3, z: T.PLAZA.z + 3 };
  if (Math.hypot(sign.x - s.pos.x, sign.z - s.pos.z) < 2.2) return { label: 'かんばん', act: () => hooks.say('かんばん', ['ひだまり島へ ようこそ。', 'あさの はじまりは、いつも まちの広場から。']) };
  // 畑の真ん中に立ってスコップを持っていると「ならす」(空の畑のみ)
  const here = plotAt(s.pos.x, s.pos.z, 0.9);
  if (here >= 0 && hasTool(TOOL.shovel) && rt.st.plots[here].crop == null) return { label: 'ならす', act: () => levelPlot(here) };
  const pi = plotAt(f.x, f.z);
  // 種を持っていなければ、前の空の畑はスコップで消せるように「ならす」を出す
  if (pi >= 0 && hasTool(TOOL.shovel) && rt.st.plots[pi].crop == null && !pocketKinds().some((k) => k.startsWith('seed:'))) return { label: 'ならす', act: () => levelPlot(pi) };
  if (pi >= 0) {
    const l = plotLabel(pi);
    if (l) return { label: l, act: () => plotAct(pi) };
  }
  // 岩 (つるはし) と木 (おの)
  const ri = nearestIdx('rocks', f, 2.0);
  if (ri >= 0) return { label: 'ほる', act: () => mineRock(ri) };
  if (hasTool(TOOL.axe)) {
    const ti = nearestIdx('trees', f, 1.9);
    if (ti >= 0) return { label: 'きる', act: () => chopTree(ti) };
  }
  if (rt.shakeCd <= 0) {
    const t = S.world.trees.find((tr) => Math.hypot(tr.x - f.x, tr.z - f.z) < 1.9);
    if (t) return { label: 'ゆらす', act: shakeTree };
  }
  const wk = T.waterKindAt(f.x, f.z);
  if (wk) return { label: 'つる', act: () => startFishing(wk) };
  if (T.walkable(f.x, f.z) && plotAt(f.x, f.z, 1.2) < 0 && rt.st.plots.length < 40) return { label: 'たがやす', act: () => dig(f.x, f.z) };
  return null;
}

function enterHouse() {
  const s = rt.st;
  s.inside = true;
  s.pos = { x: OFF.x + 5.5, z: OFF.z + 6.4, ry: Math.PI };
  hooks.toast('おかえりなさい');
  persist();
}
function exitHouse() {
  const s = rt.st;
  s.inside = false;
  const d = homeDoor(0.9);
  s.pos = { x: d.x, z: d.z, ry: Math.atan2(d.dx, d.dz) };
  persist();
}

function sleep() {
  hooks.say('……', ['おやすみなさい。', '（ぐっすり眠った）']);
  nextDay();
}

// ---------- 日の進行 ----------
function nextDay() {
  const s = rt.st;
  const prevSeason = seasonOf(s.day);
  s.day += 1;
  s.hour = 6;
  for (const p of s.plots) {
    if (p.crop == null) continue;
    const c = CROPS[p.crop];
    if (p.watered && inSeason(c.mask, seasonOf(s.day))) p.grow += 1;
    p.watered = false;
    p.stage = p.grow >= c.growDays ? 4 : Math.min(3, Math.floor((p.grow / c.growDays) * 4));
  }
  refreshPlots();
  const ns = seasonOf(s.day);
  if (ns !== prevSeason) {
    S.setSeason(SEASON_KEYS[ns]);
    hooks.toast(`${SEASON_NAMES[ns]}になりました`);
  } else {
    hooks.toast(`${dateText()}の朝`);
  }
  rt.bugs.forEach((b) => S.removeVisual(b.obj));
  rt.bugs = [];
  // 岩と木を戻す (消してから2日経ったもの)
  for (const kind of ['trees', 'rocks']) {
    for (const [i, day] of Object.entries(rt.st.gone[kind])) {
      if (s.day >= day) { const e = S.world[kind][Number(i)]; e.obj.visible = true; e.broken = false; e.hp = 3; delete rt.st.gone[kind][i]; }
    }
  }
  buildObstacles();
  persist();
  hooks.refresh();
}

function persist() {
  if (!rt.st) return;
  writeSave({ v: 1, state: rt.st });
  hooks.saved();
}

// ---------- 移動 ----------
function walkableAt(x, z) {
  if (rt.st.inside) {
    const lx = x - OFF.x, lz = z - OFF.z;
    if (lx < 0.5 || lz < 0.5 || lx > ROOM.w - 0.5 || lz > ROOM.d - 0.3) return false;
    return !(OCC.has(`${Math.floor(lx)},${Math.floor(lz)}`));
  }
  if (!T.walkable(x, z)) return false;
  for (const o of rt.obstacles) if ((o.x - x) ** 2 + (o.z - z) ** 2 < o.r * o.r) return false;
  return true;
}
let OCC = new Set();

function moveBy(dx, dz) {
  const p = rt.st.pos;
  const margin = 0.22;
  const ok = (x, z) => walkableAt(x, z) && walkableAt(x + margin, z + margin) && walkableAt(x - margin, z - margin) && walkableAt(x + margin, z - margin) && walkableAt(x - margin, z + margin);
  if (ok(p.x + dx, p.z)) p.x += dx;
  if (ok(p.x, p.z + dz)) p.z += dz;
}

function buildObstacles() {
  const o = [];
  for (const t of S.world.trees) if (!t.broken) o.push({ x: t.x, z: t.z, r: t.story ? 1.0 : 0.6 });
  for (const r of S.world.rocks) if (!r.broken) o.push({ x: r.x, z: r.z, r: 0.7 });
  for (const h of S.world.houses) o.push({ x: h.x, z: h.z, r: 1.7 });
  if (S.world.shop) o.push({ x: S.world.shop.x, z: S.world.shop.z, r: 2.0 });
  if (S.world.home) o.push({ x: S.world.home.x, z: S.world.home.z, r: 2.0 });
  if (S.world.lighthouse) o.push({ x: S.world.lighthouse.x, z: S.world.lighthouse.z, r: 2.0 });
  rt.obstacles = o;
}

// ---------- 開始・毎フレーム ----------
export function start(fresh) {
  // 前回の表示物を片付ける (タイトルから開き直した場合)
  if (rt.player) S.scene.remove(rt.player.root);
  rt.bugs.forEach((b) => S.removeVisual(b.obj));
  rt.bugs = [];
  rt.fishing = null;
  rt.placing = null;
  hooks.bite(false);
  S.resetWorldObjects();
  const saved = fresh ? null : loadSave();
  rt.st = saved?.state ?? newState();
  if (!rt.st.plots) rt.st.plots = [];
  // 道具を持っていない古いセーブには、初期の道具を渡す
  for (const k of [TOOL.rod, TOOL.net, TOOL.knife, TOOL.pick, TOOL.axe, TOOL.shovel]) if (!rt.st.pocket[k]) rt.st.pocket[k] = 1;
  rt.st.gone ??= { trees: {}, rocks: {} };
  rt.st.stats.mined ??= 0;
  rt.st.stats.chopped ??= 0;
  // 切った木・掘った岩の状態を反映する
  for (const kind of ['trees', 'rocks']) {
    for (const [i, day] of Object.entries(rt.st.gone[kind])) {
      const e = S.world[kind][Number(i)];
      if (e && day > rt.st.day) { e.obj.visible = false; e.broken = true; } else delete rt.st.gone[kind][i];
    }
  }
  if (!rt.st.house) rt.st.house = [];
  rt.player = makePlayer({ outfit: [200, 60, 72], pants: [220, 30, 42], shoe: [24, 40, 32], hair: [24, 45, 36], hat: true });
  S.scene.add(rt.player.root);
  buildObstacles();
  createVillagers();
  rt.st.house.forEach((e) => S.placeFurniture(e.id, e, { fp: FURNITURE[Number(e.key.split(':')[1])].fp }));
  rt.st.shardReady.forEach((ready, c) => { if (ready && !rt.st.shardTaken[c]) S.setShardVisible(c, true); });
  if (rt.st.lighthouseOn) S.setLighthouse(true);
  S.setSeason(SEASON_KEYS[seasonOf(rt.st.day)]);
  refreshPlots();
  OCC = occupancy();
  rt.frame = 0;
  return rt.st;
}

export function setModal(v) { rt.modal = v; }

export function update(dt, input, camYaw) {
  const s = rt.st;
  if (!s) return;
  rt.frame++;
  if (!rt.paused) {
    s.hour += (dt * 24) / DAY_SEC;
    if (s.hour >= 30) { hooks.toast('夜ふかししすぎた…。おやすみ。'); nextDay(); }
  }
  rt.shakeCd = Math.max(0, rt.shakeCd - dt);
  OCC = s.inside ? occupancy() : OCC;
  // 移動 (カメラの向きを基準に)
  const mx = rt.modal || rt.fishing ? 0 : input.mx, my = rt.modal || rt.fishing ? 0 : input.my;
  const mag = Math.min(1, Math.hypot(mx, my));
  if (mag > 0.05) {
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let dx = rx * mx + fx * my, dz = rz * mx + fz * my;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const speed = (input.run ? 6.4 : 4.0) * mag * dt;
    moveBy(dx * speed, dz * speed);
    s.pos.ry = angleLerp(s.pos.ry, Math.atan2(dx, dz), Math.min(1, dt * 12));
  }
  // 配置モード
  if (rt.placing) {
    const c = placingCell();
    const cells = cellsOf(rt.placing.key, c.x, c.z, rt.placing.rot);
    const valid = roomCellsOK(cells, OCC) && countOf(rt.placing.key) > 0;
    S.setGhost(rt.placing.key, { x: c.x, z: c.z, rot: rt.placing.rot, fp: FURNITURE[Number(rt.placing.key.split(':')[1])].fp }, valid);
  } else S.setGhost(null, null, false);
  // つり
  const f = rt.fishing;
  if (f) {
    f.t += dt;
    if (f.phase === 'wait' && f.t >= f.wait) { f.phase = 'bite'; f.t = 0; hooks.bite(true); se.bite(); }
    else if (f.phase === 'bite' && f.t > 1.4) { rt.fishing = null; hooks.bite(false); hooks.toast('にげられた…'); }
  }
  // 虫・住民
  if (!s.inside) updateBugs(dt);
  else { for (const b of rt.bugs) S.removeVisual(b.obj); rt.bugs = []; }
  for (const v of rt.villagers) updateVillager(v, dt);
  // プレイヤーの見た目
  const pl = rt.player;
  pl.root.position.set(s.pos.x, s.inside ? 0 : T.groundY(s.pos.x, s.pos.z), s.pos.z);
  pl.root.rotation.y = s.pos.ry;
  animateChar(pl, mag > 0.05 && !rt.fishing, performance.now() / 1000);
  // 自動保存
  rt.autosaveT += dt;
  if (rt.autosaveT > 20) { rt.autosaveT = 0; persist(); }
  // 操作表示
  const tg = findTarget();
  const label = tg ? tg.label : null;
  if (label !== rt.lastPrompt) { rt.lastPrompt = label; hooks.prompt(label); }
  rt.target = tg;
}

function updateVillager(v, dt) {
  const s = rt.st;
  v.face = Math.max(0, v.face - dt);
  if (v.face > 0) {
    const want = Math.atan2(s.pos.x - v.x, s.pos.z - v.z);
    v.ry = angleLerp(v.ry, want, Math.min(1, dt * 6));
    animateChar(v.rig, false, performance.now() / 1000);
  } else if (v.wait > 0) {
    v.wait -= dt;
    animateChar(v.rig, false, performance.now() / 1000);
  } else {
    const dx = v.tx - v.x, dz = v.tz - v.z, d = Math.hypot(dx, dz);
    if (d < 0.15) {
      v.wait = 2 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 3;
      const tx = v.home.x + Math.cos(a) * r, tz = v.home.z + Math.sin(a) * r;
      if (T.walkable(tx, tz)) { v.tx = tx; v.tz = tz; }
    } else {
      const sp = 0.9 * dt;
      const nx = v.x + (dx / d) * sp, nz = v.z + (dz / d) * sp;
      if (T.walkable(nx, nz)) { v.x = nx; v.z = nz; v.ry = angleLerp(v.ry, Math.atan2(dx, dz), Math.min(1, dt * 8)); }
      else { v.tx = v.x; v.tz = v.z; }
    }
    animateChar(v.rig, d >= 0.15, performance.now() / 1000, 0.8);
  }
  v.rig.root.position.set(v.x, T.groundY(v.x, v.z), v.z);
  v.rig.root.rotation.y = v.ry;
}

// 物語の最初の一言
export function openingLines() {
  return CHAPTERS[0].intro;
}

// 画面表示用の一覧
export function villagerList() { return VILLAGERS; }
export function discoveredCount(cat) {
  return Object.keys(rt.st.disc).filter((k) => k.startsWith(cat + ':')).length;
}
export function saveNow() { persist(); }
export { FISH, BUGS, DISHES, CROPS, FURNITURE };

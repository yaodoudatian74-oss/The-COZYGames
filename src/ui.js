// 画面のUI (DOM)。3Dアイコンは同じモデルから描いて画像にする
import * as THREE from 'three';
import { itemModel } from './models.js';
import {
  FISH, BUGS, DISHES, CROPS, FURNITURE, CHAPTERS, SHARD_NAMES, VILLAGERS, TOOLS, describe, infoOf,
} from './data.js';
import * as G from './game.js';
import { setMuted, isMuted } from './audio.js';

const $ = (id) => document.getElementById(id);
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ---------- 3Dアイコン (遅延生成) ----------
let tr = null, tsc = null, tcam = null;
const thumbCache = new Map();
function thumbRenderer() {
  if (tr) return;
  const canvas = document.createElement('canvas');
  tr = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  tr.setPixelRatio(1);
  tr.setSize(192, 192, false);
  tsc = new THREE.Scene();
  tcam = new THREE.PerspectiveCamera(26, 1, 0.05, 60);
  tsc.add(new THREE.HemisphereLight(0xffffff, 0xa09080, 1.8));
  const d = new THREE.DirectionalLight(0xffffff, 1.5);
  d.position.set(3, 6, 4);
  tsc.add(d);
}
export function thumbURL(key) {
  if (thumbCache.has(key)) return thumbCache.get(key);
  thumbRenderer();
  const obj = itemModel(key);
  tsc.add(obj);
  const sph = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sph.radius, 0.25);
  const dist = (r / Math.sin((tcam.fov * Math.PI) / 360)) * 1.08;
  tcam.position.set(sph.center.x + dist * 0.55, sph.center.y + dist * 0.5, sph.center.z + dist * 0.8);
  tcam.lookAt(sph.center);
  tr.render(tsc, tcam);
  const url = tr.domElement.toDataURL('image/png');
  tsc.remove(obj);
  thumbCache.set(key, url);
  return url;
}
const io = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target;
      io.unobserve(img);
      try { img.src = thumbURL(img.dataset.key); } catch { img.classList.add('noimg'); }
    }
  }, { rootMargin: '150px' })
  : null;
export function thumb(key) {
  const img = h('img', { class: 'thumb', 'data-key': key, alt: '' });
  if (io) io.observe(img);
  else { try { img.src = thumbURL(key); } catch { /* 3D描画不可 */ } }
  return img;
}

// ---------- 会話 ----------
const dlg = { queue: [], text: '', timer: null, idx: 0, lines: [], name: '', done: null, typing: false };
export function say(name, lines, done) {
  dlg.name = name;
  dlg.lines = lines.slice();
  dlg.idx = 0;
  dlg.done = done || null;
  $('dialog').classList.remove('hidden');
  G.setModal(true);
  typeLine();
}
function typeLine() {
  const line = dlg.lines[dlg.idx] ?? '';
  $('dl-name').textContent = dlg.name;
  $('dl-text').textContent = '';
  dlg.typing = true;
  clearInterval(dlg.timer);
  let i = 0;
  dlg.timer = setInterval(() => {
    i += 1;
    $('dl-text').textContent = line.slice(0, i);
    if (i >= line.length) { clearInterval(dlg.timer); dlg.typing = false; }
  }, 28);
}
// 送り操作: 文字送り中なら全文表示、それ以外は次の行へ。最後で閉じる
export function advanceDialog() {
  if (dlg.typing) {
    clearInterval(dlg.timer);
    $('dl-text').textContent = dlg.lines[dlg.idx];
    dlg.typing = false;
    return;
  }
  dlg.idx += 1;
  if (dlg.idx < dlg.lines.length) return typeLine();
  $('dialog').classList.add('hidden');
  G.setModal(false);
  const cb = dlg.done;
  dlg.done = null;
  if (cb) cb();
}
export const dialogOpen = () => !$('dialog').classList.contains('hidden');

// ---------- 通知・HUD ----------
export function toast(msg) {
  const el = h('div', { class: 'toast' }, msg);
  $('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2300);
  setTimeout(() => el.remove(), 2800);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}
export function setPrompt(label) {
  const btn = $('act');
  btn.classList.toggle('hidden', !label);
  $('act-label').textContent = label || '';
}
export function setBite(on) { $('bite').classList.toggle('hidden', !on); }
export function refreshHud() {
  const s = G.rt.st;
  if (!s) return;
  $('hud-date').textContent = G.dateText();
  $('hud-clock').textContent = G.clockText();
  $('hud-money').textContent = `${s.money.toLocaleString('ja-JP')} コイン`;
  $('hud-goal').textContent = G.goalText();
  $('hud-bar').style.width = `${Math.round(G.goalProgress() * 100)}%`;
  $('place-hint').classList.toggle('hidden', !G.rt.placing);
  $('btn-rot').classList.toggle('hidden', !G.rt.placing);
  $('btn-cancel').classList.toggle('hidden', !G.rt.placing);
}

// ---------- パネル ----------
let panelKind = null, panelData = null;
export function openPanel(kind, data) {
  panelKind = kind;
  panelData = data || null;
  $('panel').classList.remove('hidden');
  G.setModal(true);
  renderPanel();
}
export function closePanel() {
  if (!panelKind) return;
  panelKind = null;
  $('panel').classList.add('hidden');
  G.setModal(dialogOpen());
  G.saveNow();
}
export const panelOpen = () => !!panelKind;
export function togglePanel(kind) {
  if (panelKind === kind) closePanel();
  else if (!panelKind && !dialogOpen()) openPanel(kind);
}

function renderPanel() {
  const body = $('panel-body');
  const scroll = body.scrollTop;
  body.replaceChildren();
  const titles = { pocket: 'ポーチ', notebook: 'ひだまりノート', shop: 'モコのお店', cook: 'りょうり', menu: 'メニュー' };
  $('panel-title').textContent = titles[panelKind] || '';
  ({ pocket: pocketPanel, notebook: notebookPanel, shop: shopPanel, cook: cookPanel, menu: menuPanel })[panelKind](body);
  body.scrollTop = scroll;
}

function pocketPanel(body) {
  const s = G.rt.st;
  const keys = G.pocketKinds();
  body.append(h('div', { class: 'note' }, `${keys.length} / 60 しゅるい　・　所持金 ${s.money.toLocaleString('ja-JP')} コイン`));
  if (!keys.length) body.append(h('div', { class: 'empty' }, 'ポーチは空っぽです。'));
  const grid = h('div', { class: 'grid' });
  for (const k of keys) {
    const info = infoOf(k);
    const card = h('button', { class: 'card' + (panelData === k ? ' sel' : ''), onclick: () => { panelData = k; renderPanel(); } },
      thumb(k), h('div', { class: 'name' }, info.name), h('div', { class: 'cnt' }, `x${G.countOf(k)}`));
    grid.append(card);
  }
  body.append(grid);
  if (panelData && G.countOf(panelData)) {
    const info = infoOf(panelData);
    const actions = h('div', { class: 'actions' },
      h('div', { class: 'detail-name' }, info.name),
      h('div', { class: 'note' }, `ねだん ${info.price} コイン　${describe(info)}`),
      h('button', { class: 'btn', onclick: () => { G.sell(panelData, 1); } }, 'うる（1こ）'),
      info.cat === 'furn' && G.rt.st.inside ? h('button', { class: 'btn primary', onclick: () => { closePanel(); G.startPlacing(panelData); } }, 'おく') : null,
      info.cat === 'seed' ? h('button', { class: 'btn primary', onclick: () => G.selectSeed(panelData) }, 'まく用にえらぶ') : null,
    );
    body.append(actions);
  }
}

const NB_TABS = [['fish', '魚', FISH], ['bug', '虫', BUGS], ['dish', '料理', DISHES], ['crop', '農作物', CROPS], ['furn', '家具', FURNITURE], ['story', 'ストーリー'], ['friend', 'なかま']];
let nbTab = 'fish';
function notebookPanel(body) {
  const tabs = h('div', { class: 'tabs' });
  for (const [k, label] of NB_TABS) {
    tabs.append(h('button', { class: 'tab' + (nbTab === k ? ' on' : ''), onclick: () => { nbTab = k; panelData = null; renderPanel(); } }, label));
  }
  body.append(tabs);
  if (nbTab === 'story') return storyTab(body);
  if (nbTab === 'friend') return friendTab(body);
  const [, label, list] = NB_TABS.find((t) => t[0] === nbTab);
  const got = list.filter((x) => G.rt.st.disc[x.id]).length;
  body.append(h('div', { class: 'note' }, `${label}の図鑑　${got} / ${list.length}`));
  const grid = h('div', { class: 'grid' });
  for (const x of list) {
    const known = !!G.rt.st.disc[x.id];
    grid.append(h('button', { class: 'card' + (panelData === x.id ? ' sel' : ''), onclick: () => { panelData = x.id; renderPanel(); } },
      known ? thumb(x.id) : h('div', { class: 'unknown' }, '？'), h('div', { class: 'name' }, known ? x.name : '？？？')));
  }
  body.append(grid);
  if (panelData && G.rt.st.disc[panelData]) {
    const info = infoOf(panelData);
    body.append(h('div', { class: 'actions' },
      h('div', { class: 'detail-name' }, info.name),
      h('div', { class: 'note' }, `ねだん ${info.price} コイン　${describe(info)}`)));
  }
}
function storyTab(body) {
  const s = G.rt.st;
  body.append(h('div', { class: 'note' }, `ひかりのかけら ${s.shardTaken.filter(Boolean).length} / 4　・　灯台: ${s.lighthouseOn ? '点灯中' : 'まだ暗い'}`));
  CHAPTERS.forEach((ch, i) => {
    const state = s.shardTaken[i] ? 'done' : i === s.chapter ? 'now' : 'lock';
    body.append(h('div', { class: `story ${state}` },
      h('div', { class: 'story-title' }, `第${i + 1}章　${ch.title}`, h('span', { class: 'tag' }, state === 'done' ? 'クリア' : state === 'now' ? '進行中' : '未開放')),
      state === 'lock' ? h('div', { class: 'note' }, '（前の章をクリアすると読めます）') : h('div', {}, ch.intro),
      state === 'now' ? h('div', { class: 'note' }, `目標: ${ch.goal}　${s.shardReady[i] ? '→ ' + SHARD_NAMES[ch.shard] + 'へ行こう' : ''}`) : null,
    ));
  });
  if (G.rt.st.chapter >= 4) body.append(h('div', { class: 'story done' }, h('div', { class: 'story-title' }, 'エピローグ'), '灯台の光がひだまり島を照らしている。季節は、ようやく正しくめぐっている。島での暮らしは、まだまだ続く。'));
}
function friendTab(body) {
  const s = G.rt.st;
  for (const v of VILLAGERS) {
    const f = s.friend[v.id] || 0;
    const hearts = Math.round(f / 20);
    body.append(h('div', { class: 'friend' },
      h('div', { class: 'fname' }, `${v.name}`, h('span', { class: 'note' }, `　${v.job}`)),
      h('div', { class: 'hearts' }, '♥'.repeat(hearts) + '♡'.repeat(5 - hearts), h('span', { class: 'note' }, `　なかよし度 ${f}`)),
    ));
  }
}

function shopPanel(body) {
  const tabs = h('div', { class: 'tabs' });
  const mode = panelData === 'sell' ? 'sell' : 'buy';
  tabs.append(
    h('button', { class: 'tab' + (mode === 'buy' ? ' on' : ''), onclick: () => { panelData = 'buy'; renderPanel(); } }, 'かう'),
    h('button', { class: 'tab' + (mode === 'sell' ? ' on' : ''), onclick: () => { panelData = 'sell'; renderPanel(); } }, 'うる'),
  );
  body.append(tabs, h('div', { class: 'note' }, `所持金 ${G.rt.st.money.toLocaleString('ja-JP')} コイン`));
  const grid = h('div', { class: 'grid' });
  if (mode === 'sell') {
    const keys = G.pocketKinds();
    if (!keys.length) body.append(h('div', { class: 'empty' }, 'うれるものがありません。'));
    for (const k of keys) {
      const info = infoOf(k);
      const unit = info.cat === 'furn' ? Math.round(info.price / 2) : info.price;
      grid.append(h('button', { class: 'card', onclick: () => G.sell(k, 1) }, thumb(k), h('div', { class: 'name' }, info.name),
        h('div', { class: 'cnt' }, `x${G.countOf(k)}　${unit}コイン`)));
    }
  } else {
    // たね20種 (各作物の基本品種) と 家具500
    // 各作物の基本品種 (20種) のたね
    const seeds = CROPS.filter((_, i) => i % 20 === 0).map((c) => `seed:${c.kind * 20}`);
    const list = [...TOOLS.map((t) => t.id), ...seeds, ...FURNITURE.map((f) => f.id)];
    for (const k of list) {
      const info = infoOf(k);
      grid.append(h('button', { class: 'card', onclick: () => G.buy(k) }, thumb(k), h('div', { class: 'name' }, info.name),
        h('div', { class: 'cnt' }, `${info.price} コイン`)));
    }
  }
  body.append(grid);
}

function cookPanel(body) {
  const only = panelData !== 'all';
  body.append(h('div', { class: 'tabs' },
    h('button', { class: 'tab' + (only ? ' on' : ''), onclick: () => { panelData = null; renderPanel(); } }, 'つくれるもの'),
    h('button', { class: 'tab' + (!only ? ' on' : ''), onclick: () => { panelData = 'all'; renderPanel(); } }, 'すべて'),
  ));
  body.append(h('div', { class: 'note' }, 'ポーチの材料（魚・虫・野菜・果物・穀物・ハーブ）を使って料理します。'));
  const grid = h('div', { class: 'grid' });
  let shown = 0;
  DISHES.forEach((d, i) => {
    const can = !!G.recipeIngredients(i);
    if (only && !can) return;
    shown++;
    grid.append(h('button', { class: 'card' + (can ? '' : ' dim'), onclick: () => G.cook(i) },
      G.rt.st.disc[d.id] ? thumb(d.id) : h('div', { class: 'unknown' }, '？'),
      h('div', { class: 'name' }, G.rt.st.disc[d.id] ? d.name : '？？？'),
      h('div', { class: 'cnt' }, d.tags.map((t) => ({ fish: '魚', bug: '虫', veg: '野菜', fruit: '果物', grain: '穀物', herb: 'ハーブ' })[t]).join('＋'))));
  });
  if (!shown) body.append(h('div', { class: 'empty' }, '今つくれる料理はありません。材料を集めましょう。'));
  body.append(grid);
}

function menuPanel(body) {
  body.append(
    h('div', { class: 'note' }, `${G.dateText()}　・　${G.rt.st.money.toLocaleString('ja-JP')} コイン`),
    h('button', { class: 'btn primary wide', onclick: () => { G.saveNow(); toast('セーブしました'); } }, 'セーブする'),
    h('button', { class: 'btn wide', onclick: () => { setMuted(!isMuted()); renderPanel(); } }, `おと: ${isMuted() ? 'OFF' : 'ON'}`),
    h('button', { class: 'btn wide', onclick: () => { G.saveNow(); closePanel(); showTitle(true); } }, 'タイトルへもどる'),
    h('div', { class: 'note' }, '操作: 移動 WASD/矢印 ・ 決定 Space/Enter ・ カメラ Q/E かマウスドラッグ ・ ポーチ P ・ ノート N ・ 走る Shift ・ 家具をまわす R'),
  );
}

// ---------- タイトル ----------
export function showTitle(show) {
  $('title').classList.toggle('hidden', !show);
  $('hud').classList.toggle('hidden', show);
  if (show) {
    G.setModal(true);
    $('btn-continue').disabled = !hasSave();
  }
}
// 確認ダイアログが使えない環境(埋め込み表示など)では、そのまま進める
function safeConfirm(msg) {
  try { return confirm(msg); } catch { return true; }
}
function hasSave() {
  try { return !!localStorage.getItem('hidamari-island-v1'); } catch { return false; }
}

// 入力状態 (main.js が読む)
export const uiInput = { mx: 0, my: 0, actionCount: 0, cancel: false, rotate: false, run: false, dialogTap: false };

export function init(onStart) {
  hooks();
  $('btn-new').onclick = () => {
    if (hasSave() && !safeConfirm('新しく始めると、いまのセーブデータは消えます。よろしいですか？')) return;
    onStart(true);
  };
  $('btn-continue').onclick = () => onStart(false);
  $('btn-pocket').onclick = () => togglePanel('pocket');
  $('btn-note').onclick = () => togglePanel('notebook');
  $('btn-menu').onclick = () => togglePanel('menu');
  $('panel-close').onclick = () => closePanel();
  $('act').addEventListener('pointerdown', (e) => { e.preventDefault(); uiInput.actionCount += 1; });
  $('dialog').addEventListener('pointerdown', (e) => { e.preventDefault(); uiInput.dialogTap = true; });
  $('btn-rot').addEventListener('pointerdown', (e) => { e.preventDefault(); uiInput.rotate = true; });
  $('btn-cancel').addEventListener('pointerdown', (e) => { e.preventDefault(); uiInput.cancel = true; });
  // バーチャルパッド
  const joy = $('joy'), knob = $('joy-knob');
  let jid = null, cx = 0, cy = 0;
  const jr = () => joy.getBoundingClientRect();
  joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); const r = jr(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; });
  joy.addEventListener('pointermove', (e) => {
    if (e.pointerId !== jid) return;
    const dx = e.clientX - cx, dy = e.clientY - cy, max = jr().width / 2;
    const d = Math.min(max, Math.hypot(dx, dy)), a = Math.atan2(dy, dx);
    const kx = Math.cos(a) * d, ky = Math.sin(a) * d;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
    uiInput.mx = kx / max;
    uiInput.my = -ky / max;
  });
  const endJoy = () => { jid = null; knob.style.transform = ''; uiInput.mx = 0; uiInput.my = 0; };
  joy.addEventListener('pointerup', endJoy);
  joy.addEventListener('pointercancel', endJoy);
  window.addEventListener('resize', () => refreshHud());
}

let saveTimer = null;
function hooks() {
  G.hooks.toast = toast;
  G.hooks.say = say;
  G.hooks.open = (kind) => { if (kind === 'shop') openPanel('shop'); else if (kind === 'cook') openPanel('cook'); else openPanel(kind); };
  G.hooks.prompt = setPrompt;
  G.hooks.bite = setBite;
  G.hooks.saved = () => {
    const el = $('save-note');
    el.classList.remove('hidden');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => el.classList.add('hidden'), 1600);
  };
  G.hooks.refresh = () => { refreshHud(); if (panelKind) renderPanel(); };
}

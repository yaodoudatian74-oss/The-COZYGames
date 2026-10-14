// 起動・入力・カメラ・ゲームループ
import * as S from './scene.js';
import * as G from './game.js';
import * as UI from './ui.js';
import { CHAPTERS } from './data.js';
import { audioInit, audioTick } from './audio.js';
import { clamp, lerp, angleLerp } from './util.js';
import * as T from './terrain.js';

const PLAZA = T.PLAZA;

const canvas = document.getElementById('gl');
S.init(canvas);

const cam = { yaw: 0.2, pitch: 0.5, dist: 9.5, focus: { x: PLAZA.x, y: 1.2, z: PLAZA.z }, wasInside: false };
const keys = new Set();
// 決定操作は押した回数を数える (低速な端末でも押し損ねないように)
let pendingActions = 0;
let keyRotate = false, keyCancel = false, keyPocket = false, keyNote = false, keyMenu = false;
let started = false, last = performance.now(), clock = 0, hudT = 0;

// ---------- キーボード ----------
const GAME_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'space'];
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (GAME_KEYS.includes(k)) e.preventDefault();
  if (!started) return;
  if (e.repeat) return;
  keys.add(k);
  if (k === ' ' || k === 'enter') pendingActions++;
  if (k === 'r') keyRotate = true;
  if (k === 'escape' || k === 'x' || k === 'backspace') keyCancel = true;
  if (k === 'p') keyPocket = true;
  if (k === 'n') keyNote = true;
  if (k === 'm') keyMenu = true;
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// ---------- マウス・タッチでカメラ ----------
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  cam.yaw -= (e.clientX - drag.x) * 0.006;
  cam.pitch = clamp(cam.pitch + (e.clientY - drag.y) * 0.004, 0.15, 1.2);
  drag.x = e.clientX; drag.y = e.clientY;
});
window.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const max = G.rt.st?.inside ? 10 : 16;
  cam.dist = clamp(cam.dist + e.deltaY * 0.01, 4, max);
}, { passive: false });

// ---------- 開始 ----------
function onStart(fresh) {
  audioInit();
  G.start(fresh);
  started = true;
  UI.showTitle(false);
  UI.refreshHud();
  if (fresh) UI.say('……', [CHAPTERS[0].intro]);
  else UI.toast(`${G.dateText()}に もどってきた`);
}
UI.init(onStart);
UI.showTitle(true);

// ---------- ループ ----------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;

  if (started) {
    const st = G.rt.st;
    const ui = UI.uiInput;
    // 入力の合成
    let mx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let my = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    mx = clamp(mx + ui.mx, -1, 1);
    my = clamp(my + ui.my, -1, 1);
    const run = keys.has('shift') || ui.run;
    if (keys.has('q')) cam.yaw += dt * 2.2;
    if (keys.has('e')) cam.yaw -= dt * 2.2;

    // ボタン操作 (キーボードとタッチを合わせる)
    pendingActions = Math.min(pendingActions + ui.actionCount, 4);
    ui.actionCount = 0;
    const press = pendingActions > 0;
    if (press) pendingActions--;
    const rot = keyRotate || ui.rotate;
    const cancel = keyCancel || ui.cancel;
    const dialogTap = ui.dialogTap;
    keyRotate = keyCancel = false;
    ui.rotate = ui.cancel = ui.dialogTap = false;
    if (keyPocket) { keyPocket = false; UI.togglePanel('pocket'); }
    if (keyNote) { keyNote = false; UI.togglePanel('notebook'); }
    if (keyMenu) { keyMenu = false; UI.togglePanel('menu'); }

    if (UI.dialogOpen()) {
      if (press || dialogTap) UI.advanceDialog();
    } else if (UI.panelOpen()) {
      if (cancel) UI.closePanel();
    } else {
      if (cancel && G.rt.placing) { G.rt.placing = null; UI.toast('おくのを やめた'); }
      if (rot && G.rt.placing) G.rt.placing.rot = (G.rt.placing.rot + 1) % 4;
      if (press) {
        const t = G.findTarget();
        if (t) t.act();
      }
    }

    G.update(dt, { mx, my, run }, cam.yaw);
    audioTick(dt, G.isDay(), G.curSeason());

    // カメラ: 室内に入ったら部屋の正面側へ向けなおす
    if (st.inside !== cam.wasInside) {
      cam.wasInside = st.inside;
      if (st.inside) cam.yaw = Math.PI * 0.25;
    }
    const dist = st.inside ? Math.min(cam.dist, 8) : cam.dist;
    const k = 1 - Math.exp(-dt * 10);
    cam.focus.x = lerp(cam.focus.x, st.pos.x, k);
    cam.focus.y = lerp(cam.focus.y, 1.1, k);
    cam.focus.z = lerp(cam.focus.z, st.pos.z, k);
    S.camera.position.set(
      cam.focus.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * dist,
      cam.focus.y + Math.sin(cam.pitch) * dist,
      cam.focus.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * dist,
    );
    S.camera.lookAt(cam.focus.x, cam.focus.y, cam.focus.z);
    S.update(dt, clock, st.hour, cam.focus, st.inside);

    hudT -= dt;
    if (hudT <= 0) { hudT = 0.5; UI.refreshHud(); }
  } else {
    // タイトル画面の背景: ゆっくり回る島
    cam.yaw += dt * 0.05;
    const f = { x: PLAZA.x, y: 1.5, z: PLAZA.z };
    S.camera.position.set(f.x + Math.sin(cam.yaw) * 22, f.y + 11, f.z + Math.cos(cam.yaw) * 22);
    S.camera.lookAt(f.x, f.y, f.z);
    S.update(dt, clock, 10, f, false);
  }
}
window.addEventListener('resize', () => S.resize());
requestAnimationFrame(frame);

// テスト用の窓口 (QAスクリプトから状態を読む)
window.__game = { G, S, UI, T, cam };

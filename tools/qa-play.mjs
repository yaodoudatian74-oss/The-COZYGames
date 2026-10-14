// 主要システムを実際に操作して確認する: 釣り・畑・家・家具配置・料理・睡眠・店・保存と再開
// 状態が変わるまで待つ方式 (描画が遅い環境でも安定して動くように)
// 使い方: node tools/qa-play.mjs [出力フォルダ]
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'qa-shots'));
fs.mkdirSync(out, { recursive: true });
const url = 'file://' + path.join(root, 'dist', 'index.html');
const results = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('dialog', (d) => d.accept());

const ev = (fn, arg) => page.evaluate(fn, arg);
const press = async (k = 'Space') => { await page.keyboard.press(k); await page.waitForTimeout(120); };
const sleep = (ms) => page.waitForTimeout(ms);
// ゲーム時間を進める (描画が遅い環境でもロジックは実時間に依存させない)
const advance = (seconds) => ev((sec) => { const { G } = window.__game; for (let t = 0; t < sec; t += 0.05) G.update(0.05, { mx: 0, my: 0, run: false }, 0); }, seconds);
// 条件を満たすまで待つ (最大 timeout ms)
async function until(fn, timeout = 20000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await ev(fn, arg)) return true;
    await sleep(150);
  }
  return false;
}

await page.goto(url, { waitUntil: 'load' });
await until(() => document.getElementById('btn-new') && !document.getElementById('title').classList.contains('hidden'), 60000);
const fps = await ev(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
console.log(`描画速度(ヘッドレス): 約 ${fps} fps`);
await page.click('#btn-new');
await until(() => !!window.__game.G.rt.st, 30000);
await sleep(400);
check('ゲーム開始', await ev(() => !!window.__game.G.rt.st));
// 冒頭の会話を閉じる
for (let i = 0; i < 3; i++) { await until(() => document.getElementById('dialog').classList.contains('hidden'), 1500).catch(() => {}); await press(); }
await until(() => document.getElementById('dialog').classList.contains('hidden'), 15000);
await sleep(300);

// 所持品を用意
await ev(() => {
  const G = window.__game.G;
  G.addItem('fish:0', 3, true); G.addItem('fish:12', 2, true);
  G.addItem('bug:0', 2, true); G.addItem('seed:0', 4, true); G.addItem('seed:220', 2, true);
  G.addItem('seed:20', 3, true); G.selectSeed('seed:20'); // 春に育つダイコン
  G.addItem('crop:220', 3, true); G.addItem('furn:0', 1, true); G.addItem('furn:20', 1, true);
  G.rt.st.money = 5000;
});

// --- 釣り ---
const spot = await ev(() => {
  const T = window.__game.T;
  const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  for (let cx = -50; cx <= 50; cx += 1) for (let cz = -40; cz <= 40; cz += 1) {
    if (!T.walkable(cx, cz) || T.waterKindAt(cx, cz)) continue;
    for (const ry of dirs) {
      if (T.waterKindAt(cx + Math.sin(ry) * 1.3, cz + Math.cos(ry) * 1.3) === 'river') return { x: cx, z: cz, ry };
    }
  }
  return null;
});
check('川辺の立ち位置が見つかる', !!spot);
if (spot) {
  await ev((s) => { window.__game.G.rt.st.pos = { x: s.x, z: s.z, ry: s.ry }; }, spot);
  await sleep(200);
  await until(() => window.__game.G.findTarget()?.label === 'つる', 5000);
  check('水を向くと「つる」が出る', (await ev(() => window.__game.G.findTarget()?.label)) === 'つる');
  await press();
  check('つりを始める', await until(() => !!window.__game.G.rt.fishing, 3000));
  // 当たりが来るまでゲーム時間を進める (当たりの窓を過ぎないよう1ステップずつ)
  await ev(() => { const { G } = window.__game; for (let i = 0; i < 400 && G.rt.fishing && G.rt.fishing.phase !== 'bite'; i++) G.update(0.05, { mx: 0, my: 0, run: false }, 0); });
  check('うきが沈む(当たり)', (await ev(() => window.__game.G.rt.fishing?.phase)) === 'bite');
  await page.screenshot({ path: path.join(out, 'p1-fishing-bite.png') });
  const before = await ev(() => window.__game.G.rt.st.stats.fish);
  await press();
  const got = await until((b) => window.__game.G.rt.st.stats.fish > b, 5000, before);
  check('釣り上げで魚が増える', got, `${before} -> ${await ev(() => window.__game.G.rt.st.stats.fish)}`);
}

// --- 畑 ---
await ev(() => { window.__game.G.rt.st.pos = { x: -14, z: 18, ry: 0 }; });
// 空き地へ移動して「たがやす」を出す
let found = false;
for (let i = 0; i < 12 && !found; i++) {
  found = await until(() => window.__game.G.findTarget()?.label === 'たがやす', 800);
  if (!found) await ev(() => { window.__game.G.rt.st.pos.x += 1.6; });
}
check('空き地で「たがやす」が出る', found);
await press();
check('畑ができる', await until(() => window.__game.G.rt.st.plots.length === 1, 4000));
check('畑の前で「たねをまく」', await until(() => window.__game.G.findTarget()?.label === 'たねをまく', 4000));
await press();
check('たねをまくと作物が植わる', await until(() => window.__game.G.rt.st.plots[0]?.crop != null, 4000));
await ev(() => { window.__game.G.rt.st.hour = 29.9; });
await advance(1);
const grew = await ev(() => window.__game.G.rt.st.day === 2);
const plot = await ev(() => window.__game.G.rt.st.plots[0]);
check('翌日になり作物が育つ', grew && plot.grow >= 1, `day=${await ev(() => window.__game.G.rt.st.day)} grow=${plot.grow} stage=${plot.stage}`);
await page.screenshot({ path: path.join(out, 'p2-farm.png') });

// --- 家に入って家具を置く ---
await ev(() => { const G = window.__game.G; const d = G.homeDoor(0); G.rt.st.pos = { x: d.x, z: d.z, ry: 0 }; });
check('玄関で「いえに はいる」', await until(() => window.__game.G.findTarget()?.label === 'いえに はいる', 4000));
await press();
check('家の中に入る', await until(() => window.__game.G.rt.st.inside === true, 4000));
await sleep(300);
await ev(() => window.__game.G.startPlacing('furn:0'));
await sleep(200);
await press();
check('家具を置ける', await until(() => window.__game.G.rt.st.house.length === 1, 4000), `house=${await ev(() => window.__game.G.rt.st.house.length)}`);
await ev(() => { window.__game.G.rt.st.pos = { x: 400 + 8.5, z: 400 + 5.4, ry: Math.PI }; });
await sleep(200);
await ev(() => window.__game.G.startPlacing('furn:20'));
await press('r');
await sleep(200);
await page.screenshot({ path: path.join(out, 'p3-placing.png') });
await press();
check('2つ目も置ける(回転つき)', await until(() => window.__game.G.rt.st.house.length === 2, 4000), `house=${await ev(() => window.__game.G.rt.st.house.length)}`);
await sleep(300);
await page.screenshot({ path: path.join(out, 'p4-interior.png') });

// --- 料理 ---
await ev(() => { window.__game.G.rt.st.pos = { x: 400 + 10.5, z: 400 + 2.6, ry: Math.PI }; });
check('かまどで「りょうり」', await until(() => window.__game.G.findTarget()?.label === 'りょうり', 4000));
await press();
check('料理パネルが開く', await until(() => !document.getElementById('panel').classList.contains('hidden'), 4000));
await page.screenshot({ path: path.join(out, 'p5-cook.png') });
const c0 = await ev(() => window.__game.G.rt.st.stats.cooked);
await ev(() => window.__game.G.cook(0));
check('料理ができる', (await ev(() => window.__game.G.rt.st.stats.cooked)) === c0 + 1);
await ev(() => window.__game.UI.closePanel());
await sleep(200);

// --- 睡眠 ---
await ev(() => { window.__game.G.rt.st.pos = { x: 400 + 2, z: 400 + 2.3, ry: 0 }; });
check('ベッドで「ねる」', await until(() => window.__game.G.findTarget()?.label === 'ねる', 4000));
await press();
check('寝ると翌日になる', await until(() => window.__game.G.rt.st.day === 3, 6000), `day=${await ev(() => window.__game.G.rt.st.day)}`);
await until(() => document.getElementById('dialog').classList.contains('hidden'), 6000);

// --- 店 ---
await ev(() => { const G = window.__game.G; const sh = window.__game.S.world.shop; G.rt.st.inside = false; G.rt.st.pos = { x: sh.x, z: sh.z + 2.6, ry: 0 }; });
await sleep(300);
const m0 = await ev(() => window.__game.G.rt.st.money);
await ev(() => window.__game.G.buy('furn:40'));
const m1 = await ev(() => window.__game.G.rt.st.money);
check('店で買い物ができる', m1 < m0, `${m0} -> ${m1}`);
await ev(() => window.__game.G.hooks.open('shop'));
await sleep(2500);
await page.screenshot({ path: path.join(out, 'p6-shop-furniture.png') });
await ev(() => window.__game.UI.closePanel());

// --- 保存と再開 ---
await ev(() => window.__game.G.saveNow());
const saved = await ev(() => JSON.parse(localStorage.getItem('hidamari-island-v1') || 'null')?.state?.day);
check('セーブされる', saved === 3, `saved day=${saved}`);
await page.reload({ waitUntil: 'load' });
await until(() => !document.getElementById('btn-continue').disabled, 60000);
await page.click('#btn-continue');
await until(() => !!window.__game.G.rt.st, 30000);
const r = await ev(() => ({ day: window.__game.G.rt.st.day, house: window.__game.G.rt.st.house.length, plots: window.__game.G.rt.st.plots.length, fish: window.__game.G.rt.st.stats.fish }));
check('つづきから再開できる', r.day === 3 && r.house === 2 && r.plots === 1, JSON.stringify(r));
await sleep(800);
await page.screenshot({ path: path.join(out, 'p7-resumed.png') });

check('コンソールエラーなし', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n結果: ${results.length - failed} / ${results.length} 合格`);
await browser.close();
process.exit(failed ? 1 : 0);

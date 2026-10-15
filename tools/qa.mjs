// ブラウザでの動作確認: 起動 → タイトル → ゲーム開始 → 移動 → パネル → スクショ
// 使い方: node tools/qa.mjs [出力フォルダ]
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'qa-shots'));
fs.mkdirSync(out, { recursive: true });
const url = 'file://' + path.join(root, 'dist', 'index.html');

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 5).join('\n')}`));

const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(out, '01-title.png') });
console.log('title ok', Date.now() - t0, 'ms');

// 新しく始める (confirm は無い想定だが念のため自動承認)
page.on('dialog', (d) => d.accept());
await page.click('#btn-new');
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(out, '02-intro-dialog.png') });

// 会話を送る
for (let i = 0; i < 4; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(300); }
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(out, '03-game-plaza.png') });

const info = await page.evaluate(() => {
  const g = window.__game?.G;
  if (!g || !g.rt.st) return { started: false };
  return {
    started: true,
    day: g.rt.st.day, hour: +g.rt.st.hour.toFixed(2), pos: g.rt.st.pos,
    villagers: g.rt.villagers.length, trees: window.__game.S.world.trees.length,
    houses: window.__game.S.world.houses.length, bugs: g.rt.bugs.length,
  };
});
console.log('state', JSON.stringify(info));

// 歩く (2秒)
await page.keyboard.down('w');
await page.waitForTimeout(1600);
await page.keyboard.up('w');
await page.keyboard.down('d');
await page.waitForTimeout(700);
await page.keyboard.up('d');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, '04-walk.png') });
const pos2 = await page.evaluate(() => window.__game.G.rt.st.pos);
console.log('moved to', JSON.stringify(pos2));

// ノート (図鑑) とポーチ
await page.click('#btn-note');
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(out, '05-notebook.png') });
await page.click('#panel-close');
await page.waitForTimeout(200);
await page.click('#btn-pocket');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, '06-pocket.png') });
await page.click('#panel-close');

// 店を開く (ショップ: 家具カタログ)
await page.evaluate(() => window.__game.G.hooks.open('shop'));
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(out, '07-shop.png') });
await page.evaluate(() => window.__game.UI.closePanel && window.__game.UI.closePanel());

console.log('errors:', errors.length);
for (const e of errors.slice(0, 30)) console.log(e);
await browser.close();

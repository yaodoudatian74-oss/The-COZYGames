// データの件数と一意性を検証する (ブラウザ不要)
import * as D from '../src/data.js';

const lists = { 家具: D.FURNITURE, 魚: D.FISH, 虫: D.BUGS, 料理: D.DISHES, 農作物: D.CROPS, 鉱石: D.ORES, 木材: D.WOODS };
const expect = { 家具: 1200, 魚: 1000, 虫: 1000, 料理: 1000, 農作物: 1000, 鉱石: 400, 木材: 400 };
let ok = true;
for (const [name, list] of Object.entries(lists)) {
  const ids = new Set(list.map((x) => x.id));
  const names = new Set(list.map((x) => x.name));
  const good = list.length === expect[name] && ids.size === list.length && names.size === list.length;
  console.log(`${good ? 'OK ' : 'NG '} ${name}: ${list.length}件 (期待 ${expect[name]}) 一意なID ${ids.size} / 一意な名前 ${names.size}`);
  console.log(`      例: ${list[0].name} ... ${list[list.length - 1].name}`);
  if (!good) {
    ok = false;
    const dup = list.filter((x, i) => list.findIndex((y) => y.name === x.name) !== i).slice(0, 8).map((x) => x.name);
    if (dup.length) console.log('      重複名:', dup);
  }
}
const sp = D.FISH.filter((f) => f.loc === 'sea').length, rv = D.FISH.filter((f) => f.loc === 'river').length, pd = D.FISH.filter((f) => f.loc === 'pond').length;
console.log(`      魚の生息地: 海 ${sp} / 川 ${rv} / 池 ${pd}`);
console.log(ok ? 'ALL OK' : 'FAILED');
process.exit(ok ? 0 : 1);

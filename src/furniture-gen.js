// 新しい家具の組み合わせ生成: 脚・本体・天板・飾り・大きさ の部品を組み合わせて、形の違う家具を作る
import { rngFrom } from './util.js';

export const PARTS = {
  legs: ['4本脚', 'まるい1本脚', 'そり脚', '角脚', '台座', '細い4本脚', 'ベースつき', '脚なし'],
  body: ['はこ型', 'ひきだし付き', '本だな風', 'まるい柱', 'まるみのある', 'アーチ型', 'とびら付き', 'オープン'],
  top: ['平らな天板', '丸い天板', 'クッション天板', '2段天板', '天板なし', 'とんがり屋根'],
  decor: ['シンプル', '丸い取っ手', '植木のせ', 'ランプのせ', '本のせ', 'クッションのせ', '花びんのせ', 'ミラー風'],
  size: [
    { n: 'ちいさめ', w: 0.9, h: 0.8 },
    { n: 'ふつう', w: 1.2, h: 1.0 },
    { n: '大きめ', w: 1.6, h: 1.25 },
  ],
};

// 組み合わせを全部作り、決まった順番で count 個を選ぶ (同じ組み合わせは一つだけ)
export function genCombos(count) {
  const all = [];
  for (let l = 0; l < PARTS.legs.length; l++)
    for (let b = 0; b < PARTS.body.length; b++)
      for (let t = 0; t < PARTS.top.length; t++)
        for (let d = 0; d < PARTS.decor.length; d++)
          for (let s = 0; s < PARTS.size.length; s++) all.push([l, b, t, d, s]);
  const rng = rngFrom('furniture-gen');
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, count);
}

// 家具の情報を作る。colors は [名前, [h,s,l]] の並び
export function genFurniture(count, startIndex, colors) {
  return genCombos(count).map(([l, b, t, d, s], i) => {
    const ci = (l * 7 + b * 5 + t * 3 + d * 11 + s * 13) % colors.length;
    const ai = (ci * 17 + 9) % colors.length;
    const sz = PARTS.size[s];
    return {
      cat: 'furn',
      id: `furn:${startIndex + i}`,
      name: `${sz.n}${PARTS.body[b]}の${PARTS.legs[l]}・${PARTS.top[t]}・${PARTS.decor[d]}`,
      kind: -1,
      gen: { legs: l, body: b, top: t, decor: d, size: s },
      color: colors[ci][1],
      accent: colors[ai][1],
      fp: [s === 2 ? 2 : 1, 1],
      price: Math.round((150 + b * 40 + t * 30 + d * 25) * sz.w * sz.h),
    };
  });
}

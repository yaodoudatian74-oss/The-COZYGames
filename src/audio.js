// 効果音とBGM・鳥の声 (Web Audio で手続き生成。音源ファイルは使わない)
let ctx = null, master = null, musicBus = null, muted = false, step = 0, musicT = 0, birdT = 2;
const SCALE = [0, 2, 4, 7, 9]; // 長調ペンタトニック
const SEASON_SHIFT = [0, 2, -2, -5]; // 季節で音の高さを変える (半音)

export function audioInit() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.7;
    musicBus.connect(master);
  } catch {
    ctx = null; // 音が使えない環境では無音で進む
  }
}
export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.6;
}
export const isMuted = () => muted;

function tone(freq, dur, type = 'sine', vol = 0.2, when = 0, dest = master) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}
const sweep = (f0, f1, dur, vol, when = 0) => {
  if (!ctx || muted) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
};

// 効果音
export const se = {
  pop: () => tone(880, 0.12, 'triangle', 0.18),
  catch: () => { tone(660, 0.1, 'triangle', 0.2); tone(990, 0.18, 'triangle', 0.2, 0.09); tone(1320, 0.25, 'sine', 0.2, 0.18); },
  bite: () => { tone(520, 0.12, 'square', 0.08); tone(520, 0.12, 'square', 0.08, 0.16); },
  dig: () => tone(140, 0.14, 'sawtooth', 0.05),
  coin: () => { tone(1200, 0.08, 'sine', 0.15); tone(1600, 0.12, 'sine', 0.15, 0.07); },
  place: () => tone(300, 0.15, 'triangle', 0.2),
  talk: () => tone(420 + Math.random() * 120, 0.06, 'square', 0.03),
};

// 毎フレーム: BGMの音符と鳥の声
export function audioTick(dt, day, season) {
  if (!ctx || muted) return;
  const shift = SEASON_SHIFT[season] ?? 0;
  musicT -= dt;
  if (musicT <= 0) {
    musicT = 0.55;
    const deg = SCALE[(step * 3 + (step >> 2)) % SCALE.length];
    const oct = step % 8 < 4 ? 0 : 12;
    const freq = 262 * Math.pow(2, (deg + oct + shift) / 12);
    if (step % 2 === 0 || Math.random() < 0.4) tone(freq, 1.8, 'sine', 0.05, 0, musicBus);
    if (step % 8 === 0) tone((262 * Math.pow(2, (shift) / 12)) / 2, 2.6, 'triangle', 0.045, 0, musicBus);
    step++;
  }
  birdT -= dt;
  if (birdT <= 0 && day) {
    birdT = 3 + Math.random() * 6;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) sweep(2200 + Math.random() * 600, 3200 + Math.random() * 800, 0.12, 0.025, i * 0.18);
  }
}

// 天気と季節の粒子 (雨・雪・桜の花びら・落ち葉・蛍)。島の周りだけに出して軽く保つ
import * as THREE from 'three';
import { rngFrom } from './util.js';

export const WEATHER_NAMES = { sun: '晴れ', cloud: 'くもり', rain: '雨', snow: '雪', fog: '霧' };

function points(count, size, color, opacity, rng) {
  const geo = new THREE.BufferGeometry();
  const base = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    base[i * 3] = (rng() - 0.5) * 70;
    base[i * 3 + 1] = rng() * 30;
    base[i * 3 + 2] = (rng() - 0.5) * 70;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(base), 3));
  const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  p.visible = false;
  p.userData.base = base;
  return p;
}

// 雨: 細い線の粒
function rainLines(count, rng) {
  const geo = new THREE.BufferGeometry();
  const base = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const x = (rng() - 0.5) * 60, y = rng() * 26, z = (rng() - 0.5) * 60;
    base.set([x, y, z, x, y + 0.9, z], i * 6);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(base), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xbfdcff, transparent: true, opacity: 0.55, depthWrite: false });
  const l = new THREE.LineSegments(geo, mat);
  l.frustumCulled = false;
  l.visible = false;
  l.userData.base = base;
  return l;
}

export function createWeather(parent) {
  const rng = rngFrom('weather');
  const rain = rainLines(900, rng);
  const snow = points(900, 0.13, 0xffffff, 0.9, rng);
  const petals = points(260, 0.22, 0xffb7c8, 0.95, rng);
  const leaves = points(200, 0.26, 0xd9822b, 0.95, rng);
  const fireflies = points(60, 0.16, 0xf6ff8a, 0.9, rng);
  const all = { rain, snow, petals, leaves, fireflies };
  for (const o of Object.values(all)) parent.add(o);
  let kind = 'sun', season = 0, weatherRain = false;

  // 季節と天気から、今見せる粒子を決める
  function apply() {
    rain.visible = kind === 'rain';
    snow.visible = kind === 'snow' || (season === 3 && kind === 'cloud');
    petals.visible = season === 0 && kind !== 'rain' && kind !== 'snow';
    leaves.visible = season === 2 && kind !== 'rain' && kind !== 'snow';
  }

  return {
    set(newKind, newSeason) {
      kind = newKind;
      season = newSeason;
      weatherRain = kind === 'rain' || kind === 'snow';
      apply();
    },
    isWet: () => weatherRain,
    update(dt, focus, time, night, summer) {
      fireflies.visible = summer && night > 0.5;
      const move = (obj, fall, sway) => {
        const b = obj.userData.base;
        const arr = obj.geometry.attributes.position.array;
        const isLine = obj.isLineSegments;
        const n = isLine ? b.length / 6 : b.length / 3;
        for (let i = 0; i < n; i++) {
          const k = isLine ? i * 6 : i * 3;
          const ox = b[k], oy = b[k + 1], oz = b[k + 2];
          const y = oy - fall * dt * ((i % 7) + 4) * 0.25;
          b[k + 1] = y < 0 ? y + 30 : y;
          const dx = Math.sin(time * 1.3 + i) * sway;
          const dz = Math.cos(time * 1.1 + i * 0.7) * sway;
          arr[k] = focus.x + ox + dx;
          arr[k + 1] = b[k + 1];
          arr[k + 2] = focus.z + oz + dz;
          if (isLine) {
            arr[k + 3] = arr[k];
            arr[k + 4] = arr[k + 1] + 0.9;
            arr[k + 5] = arr[k + 2];
          }
        }
        obj.geometry.attributes.position.needsUpdate = true;
      };
      if (rain.visible) move(rain, 26, 0.2);
      if (snow.visible) move(snow, 2.2, 0.8);
      if (petals.visible) move(petals, 1.2, 1.2);
      if (leaves.visible) move(leaves, 1.6, 1.6);
      if (fireflies.visible) move(fireflies, 0.0, 2.2);
    },
  };
}

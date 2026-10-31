// Distances on the water, shared by the river traffic and the spills: how far each water tile is from the
// shore, and how far along the rivers from the Point (which way is downstream). Computed once per map.

import type { GameMap } from "../core/map";
import { Terrain } from "../core/terrain";

export interface WaterFields { shore: Uint8Array; down: Float32Array }
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const cache = new WeakMap<GameMap, WaterFields>();

export function waterFields(m: GameMap): WaterFields {
  const have = cache.get(m);
  if (have) return have;
  const n = m.width * m.height;
  const shore = new Uint8Array(n);
  const q = new Int32Array(n); let h = 0, t = 0;
  const d = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (m.terrain[i] !== Terrain.Water) { d[i] = 0; q[t++] = i; }
  while (h < t) {
    const i = q[h++], x = i % m.width, y = (i / m.width) | 0;
    for (const [dx, dy] of DIR4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue; const j = ny * m.width + nx; if (d[j] < 0) { d[j] = d[i] + 1; q[t++] = j; } }
  }
  for (let i = 0; i < n; i++) shore[i] = Math.min(255, Math.max(0, d[i]));
  const down = new Float32Array(n).fill(-1);
  const p = m.landmarks.find((l) => l.name.startsWith("The Point"));
  if (p) {
    let s = -1, bd = Infinity;
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) { const j = (p.y + dy) * m.width + p.x + dx; if (m.terrain[j] === Terrain.Water && Math.hypot(dx, dy) < bd) { bd = Math.hypot(dx, dy); s = j; } }
    h = 0; t = 0;
    if (s >= 0) { down[s] = 0; q[t++] = s; }
    while (h < t) {
      const i = q[h++], x = i % m.width, y = (i / m.width) | 0;
      for (const [dx, dy] of DIR4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue; const j = ny * m.width + nx; if (down[j] < 0 && m.terrain[j] === Terrain.Water) { down[j] = down[i] + 1; q[t++] = j; } }
    }
  }
  const f = { shore, down };
  cache.set(m, f);
  return f;
}

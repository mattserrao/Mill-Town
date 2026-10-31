// 2:1 isometric projection. World pixel space at zoom 1.
// Tile (x, y) top-face diamond: top vertex at (sx, sy), width TW, height TH.

import type { GameMap } from "../core/map";

export const TW = 32;
export const TH = 16;
export const LEVEL_PX = 4; // pixels per height level (10 m)

export function tileToWorld(x: number, y: number, level: number): { sx: number; sy: number } {
  return { sx: (x - y) * (TW / 2), sy: (x + y) * (TH / 2) - level * LEVEL_PX };
}

/** Ground-plane inverse (level 0), fractional tile coords. */
export function worldToGround(wx: number, wy: number): { x: number; y: number } {
  const a = wx / (TW / 2), b = wy / (TH / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Front-most tile under a world-space point, accounting for terrain height. */
export function pickTile(m: GameMap, wx: number, wy: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  for (let L = m.maxLevel; L >= 0; L--) {
    const g = worldToGround(wx, wy + L * LEVEL_PX);
    const x = Math.floor(g.x), y = Math.floor(g.y);
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
    if (m.level[y * m.width + x] === L) {
      if (!best || x + y > best.x + best.y) best = { x, y };
    }
  }
  return best;
}

export interface Camera {
  /** world-space point at the top-left of the canvas */
  x: number;
  y: number;
  zoom: number;
}

export const ZOOMS = [0.25, 0.5, 1, 2, 3, 4];

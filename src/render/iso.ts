// Hex projection: flat-top hexagons squashed 2:1 (the old isometric tilt), see core/hex.ts for the lattice.
// World pixel space at zoom 1: cell (x, y) centre -> (CW * x, RH * (y + x / 2) - (h - BASE_M) * ZPX)

import { type GameMap, cornerH, inBounds } from "../core/map";
import { CW, HEX_CORNERS, HEX6, RH, cellAt } from "../core/hex";

/** the sprite grid: house, plant and prop sprites are still authored on a 64 x 32 isometric diamond */
export const TW = 64;
export const TH = 32;
export const HW = TW / 2;
export const HH = TH / 2;
/** screen pixels per metre of height at zoom 1 (mild exaggeration, SimCity-style) */
export const ZPX = 1.15;
export const BASE_M = 200;

export function project(x: number, y: number, h: number): [number, number] {
  const a = x - 0.5, b = y - 0.5;
  return [a * CW, (b + a / 2) * RH - (h - BASE_M) * ZPX];
}

/** the continuous cell position (fx, fy) under world point (wx, wy) on the plane at height h */
export function unproject(wx: number, wy: number, h: number): [number, number] {
  const a = wx / CW, b = (wy + (h - BASE_M) * ZPX) / RH - a / 2;
  return [a + 0.5, b + 0.5];
}

/** height at a fractional position (piecewise linear over the triangles between neighbouring cell centres) */
export function heightAt(m: GameMap, fx: number, fy: number): number {
  const W = m.width, H = m.height;
  const a = fx - 0.5, b = fy - 0.5;
  const i = Math.max(0, Math.min(W - 2, Math.floor(a))), j = Math.max(0, Math.min(H - 2, Math.floor(b)));
  const u = Math.max(0, Math.min(1, a - i)), v = Math.max(0, Math.min(1, b - j));
  const h = m.vert;
  const h00 = h[j * W + i], h10 = h[j * W + i + 1], h01 = h[(j + 1) * W + i], h11 = h[(j + 1) * W + i + 1];
  return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

/** screen-space corners of a hexagon top, east first then anticlockwise (see HEX_CORNERS) */
export function tileCorners(m: GameMap, x: number, y: number): [number, number][] {
  return HEX_CORNERS.map(([dx, dy], k) => project(x + 0.5 + dx, y + 0.5 + dy, cornerH(m, x, y, k)));
}

function inTri(px: number, py: number, a: [number, number], b: [number, number], c: [number, number]) {
  const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
  const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
  const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Front-most cell whose top surface contains the world-space point. */
export function pickTile(m: GameMap, wx: number, wy: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = -Infinity;
  const seen = new Set<number>();
  for (let h = m.maxHeight; h >= m.minHeight - 10; h -= 6) {
    const [fx, fy] = unproject(wx, wy, h);
    const [cx, cy] = cellAt(fx, fy);
    for (let n = -1; n < 6; n++) {
      const x = n < 0 ? cx : cx + HEX6[n][0], y = n < 0 ? cy : cy + HEX6[n][1];
      if (!inBounds(m, x, y)) continue;
      const k = y * m.width + x;
      if (seen.has(k)) continue;
      seen.add(k);
      const c = project(x + 0.5, y + 0.5, m.vert[k]);
      const cs = tileCorners(m, x, y);
      let hit = false;
      for (let q = 0; q < 6 && !hit; q++) hit = inTri(wx, wy, c, cs[q], cs[(q + 1) % 6]);
      const d = 2 * y + x;
      if (hit && d > bestD) { best = { x, y }; bestD = d; }
    }
  }
  return best;
}

export interface Camera {
  x: number; // world px at canvas left
  y: number; // world px at canvas top
  zoom: number;
}

/** zoom steps (device pixels per world pixel). Below 0.25 the sprites fell apart into speckle, so 0.25 is the floor. */
export const ZOOMS = [0.25, 0.375, 0.5, 0.75, 1, 1.5, 2];

/** A screen-space rectangle in canvas pixels. */
export interface ScreenRect { x: number; y: number; w: number; h: number }

/**
 * Boxes of the place-name labels drawn this frame (cleared by Renderer.draw, filled by drawLabels).
 * Overlays that draw their own labels on top (districts, supply chain, rivals) steer clear of them
 * where they can.
 */
export const placeLabelRects: ScreenRect[] = [];

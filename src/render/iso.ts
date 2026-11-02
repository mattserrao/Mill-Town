// 2:1 isometric projection with continuous terrain height.
// World pixel space at zoom 1: tile (x, y) corner -> ((x - y) * 32, (x + y) * 16 - (h - BASE_M) * ZPX)

import { type GameMap, vh } from "../core/map";

export const TW = 64;
export const TH = 32;
export const HW = TW / 2;
export const HH = TH / 2;
/** screen pixels per metre of height at zoom 1 (mild exaggeration, SimCity-style) */
export const ZPX = 1.15;
export const BASE_M = 200;

export function project(x: number, y: number, h: number): [number, number] {
  return [(x - y) * HW, (x + y) * HH - (h - BASE_M) * ZPX];
}

/** height at fractional tile position (bilinear over the tile's corners) */
export function heightAt(m: GameMap, fx: number, fy: number): number {
  const x = Math.max(0, Math.min(m.width - 1, Math.floor(fx)));
  const y = Math.max(0, Math.min(m.height - 1, Math.floor(fy)));
  const u = Math.max(0, Math.min(1, fx - x)), v = Math.max(0, Math.min(1, fy - y));
  const a = vh(m, x, y), b = vh(m, x + 1, y), c = vh(m, x, y + 1), d = vh(m, x + 1, y + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** screen-space corners of a tile top: [top, right, bottom, left] */
export function tileCorners(m: GameMap, x: number, y: number): [number, number][] {
  return [
    project(x, y, vh(m, x, y)),
    project(x + 1, y, vh(m, x + 1, y)),
    project(x + 1, y + 1, vh(m, x + 1, y + 1)),
    project(x, y + 1, vh(m, x, y + 1)),
  ];
}

function inTri(px: number, py: number, a: [number, number], b: [number, number], c: [number, number]) {
  const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
  const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
  const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Front-most tile whose top surface contains the world-space point. */
export function pickTile(m: GameMap, wx: number, wy: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  const seen = new Set<number>();
  for (let h = m.maxHeight; h >= m.minHeight - 10; h -= 6) {
    const yy = wy + (h - BASE_M) * ZPX;
    const a = wx / HW, b = yy / HH;
    const gx = Math.floor((a + b) / 2), gy = Math.floor((b - a) / 2);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = gx + dx, y = gy + dy;
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
      const k = y * m.width + x;
      if (seen.has(k)) continue;
      seen.add(k);
      const [t, r, bt, l] = tileCorners(m, x, y);
      if (inTri(wx, wy, t, r, l) || inTri(wx, wy, l, r, bt)) {
        if (!best || x + y > best.x + best.y) best = { x, y };
      }
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

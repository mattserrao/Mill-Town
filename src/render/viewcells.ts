// Screen → hex cell helpers shared by the movers, smoke, audio and app code.
import { cellAt, depthOf } from "../core/hex";
import { BASE_M, unproject, ZPX } from "./iso";
import type { Camera } from "./iso";

/** the cell under world point (wx, wy) on the plane at height h (default: typical ground, 260 m) */
export function cellUnder(wx: number, wy: number, h = 260): [number, number] {
  const [fx, fy] = unproject(wx, wy, h);
  return cellAt(fx, fy);
}

/** axial bounding box of the cells under the screen, widened by a margin (callers clamp to the map) */
export function viewBox(cam: Camera, cw: number, ch: number, lo = 6, hi = 12) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [px, py] of [[0, 0], [cw, 0], [cw, ch], [0, ch]]) {
    const [fx, fy] = unproject(cam.x + px / cam.zoom, cam.y + py / cam.zoom, 260);
    x0 = Math.min(x0, fx); x1 = Math.max(x1, fx); y0 = Math.min(y0, fy); y1 = Math.max(y1, fy);
  }
  // the 2:1 squash and the shear: tall sprites and the terrain relief reach further down the screen
  return { x0: Math.floor(x0) - lo, x1: Math.ceil(x1) + hi, y0: Math.floor(y0) - lo, y1: Math.ceil(y1) + hi };
}
void BASE_M; void ZPX;

// ---- axial ⇄ ground-frame vectors. Movement and positions live in axial cell coordinates (sheared); anything with
// a length, a heading or a perpendicular (boats, trains, vehicles' facing, smoke drift) is done in the orthonormal
// ground frame, in units of one neighbour step: gx right, gy down (before the 2:1 squash).
const KX = Math.sqrt(3) / 2;
export const gvec = (dx: number, dy: number): [number, number] => [KX * dx, dy + dx / 2];
export const avec = (gx: number, gy: number): [number, number] => { const dx = gx / KX; return [dx, gy - dx / 2]; };
/** unit ground vector of an axial vector (zero stays zero) */
export function gunit(dx: number, dy: number): [number, number] {
  const [a, b] = gvec(dx, dy), l = Math.hypot(a, b);
  return l < 1e-9 ? [0, 0] : [a / l, b / l];
}
/** length (in neighbour steps) of an axial vector */
export const hyp = (dx: number, dy: number) => { const [a, b] = gvec(dx, dy); return Math.hypot(a, b); };
/** the old four isometric facings (0 down-right, 1 down-left, 2 up-left, 3 up-right) nearest a ground-frame heading */
export function facingG(gx: number, gy: number): 0 | 1 | 2 | 3 {
  const d0 = gx + gy, d1 = -gx + gy;
  return Math.abs(d0) >= Math.abs(d1) ? (d0 >= 0 ? 0 : 2) : (d1 >= 0 ? 1 : 3);
}
/** painter's depth of a continuous position, comparable with Renderer.occluded()'s tile depth */
export const cellDepth = (fx: number, fy: number) => { const [x, y] = cellAt(fx, fy); return depthOf(x, y); };
/** sort key: larger = nearer */
export const sortKey = (fx: number, fy: number) => 2 * fy + fx;

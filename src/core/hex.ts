// The hex lattice (v0.29 test branch).
//
// Cells are flat-top hexagons stored in AXIAL coordinates: a cell is (x, y) = (q, r), and every per-cell array is
// still indexed y * width + x. The six neighbours of a cell are at the fixed offsets in HEX6 (no row parity), so a
// "box" of x0..x1 × y0..y1 cells is a rhombus on the screen: footprints, 4×4 blocks and summed-area tables keep
// working as they were, they are just sheared.
//
// Continuous positions keep the old idiom: the centre of cell (x, y) is (x + 0.5, y + 0.5) and a point inside it
// is (x + u, y + v). The plane is linear in (fx, fy):
//
//     screen x = CW * (fx - 0.5)
//     screen y = RH * ((fy - 0.5) + (fx - 0.5) / 2)  -  height term
//
// The 2:1 squash of the old isometric view is kept: a hexagon is 2S wide and √3·S / 2 · 2 = RH · 2 tall on screen.

/** hex circumradius on the unsquashed ground plane (px at zoom 1). A cell has the same area as the old 30 m tile. */
export const HEX_S = 28;
/** screen px between neighbouring columns */
export const CW = 1.5 * HEX_S;
/** screen px of one row step (half the squashed flat-to-flat height) */
export const RH = (Math.sqrt(3) * HEX_S) / 2;
/** hexagon width / height on screen */
export const HEX_W = 2 * HEX_S;
export const HEX_H = 2 * RH;
/** ground-plane distance between two neighbouring centres (px) */
export const HEX_STEP = Math.sqrt(3) * HEX_S;
/** metres between neighbouring cell centres: the cell has the area of a 30 m square */
export const HEX_STEP_M = Math.sqrt((2 * 900) / Math.sqrt(3));

/** the six neighbours (dx, dy) in axial coordinates, anticlockwise from lower-right: ↘ ↗ ↑ ↖ ↙ ↓ */
export const HEX6: readonly (readonly [number, number])[] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
/** neighbour index of the opposite side */
export const opposite = (k: number) => (k + 3) % 6;
/**
 * The six corners of a cell as (dx, dy) offsets from its centre, in axial units. Corner k lies between
 * neighbours k and k + 1: 0 east, 1 north-east, 2 north-west, 3 west, 4 south-west, 5 south-east.
 */
export const HEX_CORNERS: readonly (readonly [number, number])[] = [
  [2 / 3, -1 / 3], [1 / 3, -2 / 3], [-1 / 3, -1 / 3], [-2 / 3, 1 / 3], [-1 / 3, 2 / 3], [1 / 3, 1 / 3],
];
/** midpoints of the six edges (dx, dy), toward each neighbour */
export const HEX_EDGES: readonly (readonly [number, number])[] = HEX6.map(([a, b]) => [a / 2, b / 2] as const);

/** ground-plane offset (in units of one neighbour step) of an axial offset (dx, dy) */
export function groundOf(dx: number, dy: number): [number, number] {
  // X = 1.5 S dx ; Y = √3 S (dy + dx / 2) ; both divided by the step √3 S
  return [(1.5 * dx) / Math.sqrt(3), dy + dx / 2];
}
/** distance, in neighbour steps, for an axial offset */
export function stepDist(dx: number, dy: number): number {
  const [gx, gy] = groundOf(dx, dy);
  return Math.hypot(gx, gy);
}
/** hex distance (whole steps) between two cells */
export function hexDist(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx + dy));
}

/** which cell contains the continuous point (fx, fy)? (cube rounding) */
export function cellAt(fx: number, fy: number): [number, number] {
  const a = fx - 0.5, b = fy - 0.5;
  let rq = Math.round(a), rr = Math.round(b);
  const rs = Math.round(-a - b);
  const dq = Math.abs(rq - a), dr = Math.abs(rr - b), ds = Math.abs(rs - (-a - b));
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

/** painter's depth of a cell: larger = nearer the viewer (monotone in screen y, ties by x) */
export const depthOf = (x: number, y: number) => 2 * y + x;

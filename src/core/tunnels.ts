// Tunnels through Mount Washington (scenery for now: portals on the hillside, opening on their real dates).
//
// Portals are in tile coordinates. The city-side portals sit at the foot of the hill's face where their bridge or
// street lands (the Fort Pitt Tunnel at the Fort Pitt Bridge, the Liberty Tubes at the Liberty Bridge, the trolley
// tunnel at Station Square, the Wabash above the old Wabash Bridge); the far portals are placed along each bore's
// real bearing and length (30 m tiles). Positions are approximate to a tile or two.

export interface Tunnel {
  id: string;
  name: string;
  kind: "road" | "rail" | "trolley";
  /** city-side portal and far portal, tile coordinates */
  a: [number, number];
  b: [number, number];
  opened: number;
  /** last year in use (left standing, portals boarded up) */
  closed?: number;
  /** side-by-side bores */
  bores: 1 | 2;
  /** the city-side portal opens straight onto its bridge (no approach road drawn there) */
  bridged?: boolean;
  /** facade: stone (1900s–20s), brick, or poured concrete (postwar) */
  look: "stone" | "brick" | "concrete";
}

export const TUNNELS: Tunnel[] = [
  // Wabash Pittsburgh Terminal Railway, Gould's line into downtown; passenger service ended 1931, freight 1946
  { id: "wabash", name: "Wabash Tunnel", kind: "rail", a: [201, 153], b: [175, 178], opened: 1903, closed: 1946, bores: 1, look: "stone" },
  // Pittsburgh Railways' streetcars to the South Hills
  { id: "transit", name: "Mount Washington Transit Tunnel", kind: "trolley", a: [214, 166], b: [227, 196], opened: 1904, bores: 1, look: "brick" },
  // the Liberty Tubes: twin road bores to the South Hills, then the longest tunnels built for cars
  { id: "liberty", name: "Liberty Tunnels", kind: "road", a: [238.2, 171.0], b: [204.8, 216.5], opened: 1924, bores: 2, look: "stone", bridged: true },
  // the Parkway West's last link, a year after the Fort Pitt Bridge
  { id: "fortpitt", name: "Fort Pitt Tunnel", kind: "road", a: [195.6, 146.6], b: [163.6, 165.6], opened: 1960, bores: 2, look: "concrete", bridged: true },
];

export const tunnelsIn = (year: number) => TUNNELS.filter((t) => t.opened <= year);

/** which way a portal opens (out of the hill), squared to the tile grid */
export type Face = "x+" | "x-" | "y+" | "y-";
export const FACE_D: Record<Face, [number, number]> = { "x+": [1, 0], "x-": [-1, 0], "y+": [0, 1], "y-": [0, -1] };

export interface Portal {
  t: Tunnel;
  /** city-side (a) or far (b) end */
  city: boolean;
  x: number;
  y: number;
  face: Face;
  /** tiles of the approach cutting in front of the portal, nearest first */
  approach: number[];
}

const cache = new WeakMap<object, Portal[]>();

/**
 * Seat each portal in the hillside: square its face to the grid, then slide it a few tiles along the bore to the
 * foot of the steepest rise, so it stands where the hill really climbs behind it (the portals' lat/lon put them a
 * tile or two off on a 30 m grid). A portal that opens onto its bridge stays at the bridge's end.
 */
export function portals(m: { width: number; height: number; elevation: Float32Array; terrain: Uint8Array }): Portal[] {
  const hit = cache.get(m);
  if (hit) return hit;
  const W = m.width, H = m.height;
  const el = (x: number, y: number) => m.elevation[Math.max(0, Math.min(H - 1, Math.floor(y))) * W + Math.max(0, Math.min(W - 1, Math.floor(x)))];
  const out: Portal[] = [];
  for (const t of TUNNELS) {
    const L = Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]), dx = (t.b[0] - t.a[0]) / L, dy = (t.b[1] - t.a[1]) / L;
    // the city portal: the foot of the steepest rise near its given position along the bore
    const city = seat(t.a[0], t.a[1], dx, dy);
    // the far portal: where the bore comes out in the next valley — over the crest, the first place the ground
    // stops falling (the lat/lon of the far ends are rougher than the city ends, and this keeps them in a hillside)
    const e0 = el(city.x + 0.5, city.y + 0.5);
    let fx = t.b[0], fy = t.b[1], crest = -Infinity;
    for (let s = 2; s < L * 1.6; s += 0.5) {
      const x = city.x + 0.5 + dx * s, y = city.y + 0.5 + dy * s, e = el(x, y);
      crest = Math.max(crest, e);
      if (s > L * 0.6 && crest > e0 + 30 && e < crest - 20 && el(x + dx * 1.5, y + dy * 1.5) >= e - 0.5) { fx = x; fy = y; break; }
    }
    const far = seat(fx, fy, -dx, -dy);
    out.push(portal(t, true, city, t.a), portal(t, false, far, null));
  }
  cache.set(m, out);
  return out;

  function seat(px: number, py: number, dx: number, dy: number) {
    const face: Face = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "x-" : "x+") : (dy > 0 ? "y-" : "y+");
    const [ox, oy] = FACE_D[face];
    let bx = Math.floor(px), by = Math.floor(py), best = -Infinity;
    for (let k = -5; k <= 5; k++) {
      const x = Math.floor(px + dx * k), y = Math.floor(py + dy * k);
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2 || m.terrain[y * W + x] === 0 || m.terrain[(y + oy) * W + x + ox] === 0) continue;
      // the hill two tiles behind the portal against the ground in front of it
      const rise = el(x - ox * 2, y - oy * 2) - el(x + ox, y + oy);
      const score = rise - Math.abs(k) * 1.2;
      if (score > best) { best = score; bx = x; by = y; }
    }
    // a portal opens downhill: square its face to the fall of the ground where it stands (the bore can bend in
    // the cutting), which on Mount Washington's north face means away from the camera, hidden by the hill
    const gx = el(bx + 1.5, by + 0.5) - el(bx - 0.5, by + 0.5), gy = el(bx + 0.5, by + 1.5) - el(bx + 0.5, by - 0.5);
    const down: Face = Math.abs(gx) >= Math.abs(gy) ? (gx < 0 ? "x+" : "x-") : (gy < 0 ? "y+" : "y-");
    return { x: bx, y: by, face: Math.hypot(gx, gy) > 3 ? down : face };
  }
  function portal(t: Tunnel, isCity: boolean, s: { x: number; y: number; face: Face }, reach: [number, number] | null): Portal {
    const [ox, oy] = FACE_D[s.face];
    // the cutting runs out a few tiles, and on to the bridge where the portal opens onto one
    const n = reach ? Math.max(2, Math.ceil(Math.abs((reach[0] - s.x) * ox + (reach[1] - s.y) * oy))) : 2;
    const approach: number[] = [];
    for (let k = 1; k <= Math.min(n, 6); k++) { const x = s.x + ox * k, y = s.y + oy * k; if (x >= 0 && y >= 0 && x < W && y < H && m.terrain[y * W + x] !== 0) approach.push(y * W + x); }
    return { t, city: isCity, x: s.x, y: s.y, face: s.face, approach };
  }
}

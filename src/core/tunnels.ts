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

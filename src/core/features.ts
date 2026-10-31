// Hand-placed historic features that aren't in the USGS data. Positions approximate.

import type { GameMap } from "./map";

export interface Incline { id: number; name: string; year: number; lower: [number, number]; upper: [number, number] }

/** [lat, lon] of lower and upper stations */
export const INCLINES: Incline[] = [
  { id: 1, name: "Monongahela Incline", year: 1870, lower: [40.4318, -80.0056], upper: [40.4302, -80.0089] },
  { id: 2, name: "Duquesne Incline", year: 1877, lower: [40.4398, -80.0182], upper: [40.4381, -80.0205] },
];

/** The Diamond (Market Square), site of the market house */
export const DIAMOND: [number, number] = [40.4407, -80.0024];

export function latLonToTile(m: GameMap, lat: number, lon: number): [number, number] {
  const b = m.bounds;
  return [Math.floor(((lon - b.west) / (b.east - b.west)) * m.width), Math.floor(((b.north - lat) / (b.north - b.south)) * m.height)];
}

/** Tiles along a straight line between two tile positions (inclusive). */
export function tileLine(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let k = 0; k <= n; k++) {
    const p: [number, number] = [Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n)];
    if (!out.length || out[out.length - 1][0] !== p[0] || out[out.length - 1][1] !== p[1]) out.push(p);
  }
  return out;
}

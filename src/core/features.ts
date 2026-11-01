// Hand-placed historic features that aren't in the USGS data. Positions and dates approximate.

import type { GameMap } from "./map";

export interface Incline { id: number; name: string; year: number; lower: [number, number]; upper: [number, number] }

/** [lat, lon] of lower and upper stations */
export const INCLINES: Incline[] = [
  { id: 1, name: "Monongahela Incline", year: 1870, lower: [40.4318, -80.0058], upper: [40.4303, -80.0062] },
  { id: 2, name: "Mount Oliver Incline", year: 1872, lower: [40.4268, -79.9826], upper: [40.4228, -79.9836] },
  { id: 3, name: "Duquesne Incline", year: 1877, lower: [40.4398, -80.0182], upper: [40.4381, -80.0205] },
  { id: 4, name: "Penn Incline", year: 1884, lower: [40.4512, -79.9858], upper: [40.4478, -79.9822] },
  { id: 5, name: "Troy Hill Incline", year: 1888, lower: [40.4570, -79.9905], upper: [40.4600, -79.9885] },
  { id: 6, name: "Nunnery Hill Incline", year: 1888, lower: [40.4555, -80.0135], upper: [40.4590, -80.0150] },
  { id: 7, name: "Knoxville Incline", year: 1890, lower: [40.4245, -79.9915], upper: [40.4195, -79.9905] },
];

/** Public parks, laid out in their year (approximate centre and extent). */
export const PARKS: { name: string; lat: number; lon: number; radiusM: number; year: number }[] = [
  { name: "Allegheny Commons", lat: 40.4528, lon: -80.0072, radiusM: 330, year: 1867 },
  { name: "Schenley Park", lat: 40.4345, lon: -79.9455, radiusM: 850, year: 1889 },
  { name: "Highland Park", lat: 40.4740, lon: -79.9150, radiusM: 600, year: 1893 },
  { name: "Riverview Park", lat: 40.4710, lon: -80.0150, radiusM: 500, year: 1894 },
  { name: "Frick Park", lat: 40.4330, lon: -79.9060, radiusM: 650, year: 1927 },
  { name: "South Park", lat: 40.3000, lon: -80.0000, radiusM: 900, year: 1927 },
  { name: "Point State Park", lat: 40.4418, lon: -80.0105, radiusM: 220, year: 1974 },
];

/** The Diamond (Market Square), site of the market house */
export const DIAMOND: [number, number] = [40.4407, -80.0024];

/**
 * Hillside neighbourhoods that filled in as the mills grew. Each opens in `year` and grows most
 * strongly until `peak`; `radiusM` bounds where its houses go. Steep lots are allowed inside.
 */
export interface Hillside { name: string; lat: number; lon: number; radiusM: number; year: number; peak: number; weight: number }

export const HILLSIDES: Hillside[] = [
  { name: "Troy Hill", lat: 40.4600, lon: -79.9880, radiusM: 550, year: 1855, peak: 1890, weight: 1.0 },
  { name: "Spring Hill", lat: 40.4640, lon: -79.9960, radiusM: 600, year: 1865, peak: 1900, weight: 0.8 },
  { name: "Mt. Washington", lat: 40.4300, lon: -80.0080, radiusM: 900, year: 1870, peak: 1905, weight: 1.6 },
  { name: "Duquesne Heights", lat: 40.4365, lon: -80.0215, radiusM: 500, year: 1877, peak: 1910, weight: 0.7 },
  { name: "South Side Slopes", lat: 40.4215, lon: -79.9770, radiusM: 1000, year: 1870, peak: 1910, weight: 1.8 },
  { name: "Arlington", lat: 40.4150, lon: -79.9700, radiusM: 700, year: 1880, peak: 1915, weight: 0.9 },
  { name: "Polish Hill", lat: 40.4555, lon: -79.9655, radiusM: 450, year: 1885, peak: 1905, weight: 0.8 },
  { name: "Hill District", lat: 40.4450, lon: -79.9820, radiusM: 900, year: 1860, peak: 1910, weight: 1.6 },
  { name: "Greenfield", lat: 40.4230, lon: -79.9380, radiusM: 700, year: 1890, peak: 1925, weight: 1.0 },
  { name: "Homestead Hilltop (Munhall)", lat: 40.4010, lon: -79.9050, radiusM: 800, year: 1885, peak: 1915, weight: 1.2 },
  { name: "North Braddock", lat: 40.4010, lon: -79.8560, radiusM: 700, year: 1885, peak: 1915, weight: 1.0 },
  { name: "Duquesne hillside", lat: 40.3790, lon: -79.8560, radiusM: 600, year: 1890, peak: 1920, weight: 0.8 },
  { name: "McKeesport hills", lat: 40.3460, lon: -79.8520, radiusM: 900, year: 1885, peak: 1920, weight: 1.1 },
  { name: "Clairton hillside", lat: 40.2960, lon: -79.8800, radiusM: 700, year: 1903, peak: 1925, weight: 0.8 },
];

/**
 * Population of the mapped area by year (Pittsburgh, Allegheny City and the Mon valley towns),
 * rounded from census figures; the game grows the towns toward it.
 */
export const REGION_POP: [number, number][] = [
  [1850, 85000], [1860, 120000], [1870, 170000], [1880, 260000], [1890, 360000], [1900, 450000],
  [1910, 560000], [1920, 640000], [1930, 700000], [1950, 720000], [1960, 700000], [1985, 560000],
];

export function regionTarget(year: number): number {
  for (let k = 1; k < REGION_POP.length; k++) {
    const [y1, p1] = REGION_POP[k], [y0, p0] = REGION_POP[k - 1];
    if (year <= y1) return p0 + ((p1 - p0) * (year - y0)) / (y1 - y0);
  }
  return REGION_POP[REGION_POP.length - 1][1];
}

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

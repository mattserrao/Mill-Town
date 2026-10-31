// English units for everything the player reads (the model works in metres internally).

import { fmt } from "./text";
const FT = 3.28084;

/** feet, e.g. "790 ft" */
export const feet = (metres: number) => `${fmt(metres * FT)} ft`;
/** a distance: feet under a quarter mile, otherwise miles ("1.4 mi") */
export function distance(metres: number): string {
  const ft = metres * FT;
  if (ft < 1320) return `${fmt(Math.round(ft / 10) * 10)} ft`;
  const mi = ft / 5280;
  return `${mi < 10 ? mi.toFixed(1) : fmt(mi)} mi`;
}
/** miles as a number */
export const miles = (metres: number) => (metres * FT) / 5280;

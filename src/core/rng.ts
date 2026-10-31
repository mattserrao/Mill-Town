// Deterministic, seedable RNG. Same seed => same town, same rivals, same events.

export function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  private a: number;
  constructor(seed: string | number) {
    this.a = hashSeed(seed);
  }
  /** float in [0, 1) */
  next(): number {
    let t = (this.a = (this.a + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** independent child stream, so adding a feature doesn't reshuffle everything else */
  fork(label: string): Rng {
    return new Rng(`${this.a}:${label}`);
  }
}

/** Stateless per-tile noise in [0,1): stable for (seed, x, y, channel). */
export function tileNoise(seed: number, x: number, y: number, channel = 0): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(channel, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise (bilinear over a coarse lattice), [0,1). */
export function valueNoise(seed: number, x: number, y: number, scale: number, channel = 0): number {
  const fx = x / scale, fy = y / scale;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const n00 = tileNoise(seed, x0, y0, channel), n10 = tileNoise(seed, x0 + 1, y0, channel);
  const n01 = tileNoise(seed, x0, y0 + 1, channel), n11 = tileNoise(seed, x0 + 1, y0 + 1, channel);
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
}

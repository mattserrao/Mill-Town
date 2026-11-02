import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { STYLES } from "../src/audio/music";
import { SONGS, SONGS_BY_FAMILY } from "../src/audio/songs";

const root = new URL("../public/audio/", import.meta.url);

describe("audio", () => {
  test("every style has songs; tune songs have a form", () => {
    for (const id of Object.keys(STYLES)) expect(SONGS_BY_FAMILY[id]?.length, id).toBeGreaterThan(0);
    const tuned = SONGS.filter((s) => s.tune);
    expect(tuned.length).toBeGreaterThan(60);
    for (const s of tuned) {
      expect(s.tune!.notes.length, s.id).toBeGreaterThan(8);
      expect(s.tune!.chords.length, s.id).toBeGreaterThan(0);
      expect(s.style.meter, s.id).toBe(s.tune!.beatsPerBar);
    }
  });

  test("every sampled note file exists and is credited", () => {
    const src = readFileSync(new URL("../src/audio/sampler.ts", import.meta.url), "utf8");
    const block = src.slice(src.indexOf("const ROOTS"), src.indexOf("};", src.indexOf("const ROOTS")));
    const credits = readFileSync(new URL("CREDITS.md", root), "utf8");
    for (const m of block.matchAll(/(\w+): \[([\d, ]+)\]/g)) {
      for (const n of m[2].split(",").map((x) => x.trim())) expect(existsSync(new URL(`inst/${m[1]}/${n}.mp3`, root)), `${m[1]}/${n}`).toBe(true);
    }
    expect(credits).toMatch(/FluidR3/);
  });

  test("every ambience file exists and is credited", () => {
    const credits = readFileSync(new URL("CREDITS.md", root), "utf8");
    for (const f of readdirSync(new URL("amb/", root))) expect(credits.includes(f), f).toBe(true);
  });
});

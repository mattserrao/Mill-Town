import { describe, expect, it } from "vitest";
import { parseAbc } from "../src/audio/abc";
import { STYLES } from "../src/audio/music";
import { TUNES } from "../src/audio/tunes";

describe("tune book", () => {
  it("has unique ids and known families", () => {
    const ids = new Set<string>();
    for (const t of TUNES) {
      expect(ids.has(t.id), t.id).toBe(false);
      ids.add(t.id);
      expect(STYLES[t.family], `${t.id}: ${t.family}`).toBeDefined();
    }
  });

  for (const t of TUNES) {
    it(`${t.id} parses into whole bars`, () => {
      const p = parseAbc(t.abc);
      const mood = !!STYLES[t.family]?.atmospheric;
      // the pickup and the last (short) bar aside, bars are whole
      const inner = p.bars.slice(1, -1);
      const full = inner.filter((b) => Math.abs(b.len - p.beatsPerBar) < 1e-6).length;
      expect(full / inner.length, `${t.id}: bar lengths ${p.bars.map((b) => b.len).join(",")}`).toBeGreaterThanOrEqual(0.9);
      const whole = p.length / p.beatsPerBar;
      expect(Math.abs(whole - Math.round(whole)), `${t.id}: total ${p.length}`).toBeLessThanOrEqual(1);
      expect(p.bars.length, t.id).toBeGreaterThanOrEqual(mood ? 8 : 16);
      expect(p.chords.length, `${t.id}: chords`).toBeGreaterThanOrEqual(p.bars.length / 2);
      for (const n of p.notes) {
        expect(n.midi, t.id).toBeGreaterThanOrEqual(45);
        expect(n.midi, t.id).toBeLessThanOrEqual(96);
        expect(n.dur, t.id).toBeGreaterThan(0);
      }
    });
  }
});

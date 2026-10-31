// Draws the map back-to-front in 2:1 iso. Render-on-demand (no continuous loop).

import type { GameState } from "../core/game";
import type { GameMap } from "../core/map";
import { Terrain } from "../core/terrain";
import { Use } from "../core/town";
import { tileNoise } from "../core/rng";
import { type Camera, LEVEL_PX, TH, TW, tileToWorld, worldToGround } from "./iso";
import { type BuildingKind, type Sprites, VARIANTS } from "./sprites";

export type OverlayFn = ((i: number) => [number, number, number, number] | null) | null;

export interface RenderOptions {
  overlay: OverlayFn;
  labels: boolean;
  grid: boolean;
  hover: { x: number; y: number } | null;
  selected: { x: number; y: number } | null;
  /** footprint preview for founding a company */
  footprint: { x: number; y: number; size: number; ok: boolean } | null;
}

const EDGE_DEPTH = 3; // levels of "diorama" base under the map edge

export class Renderer {
  private shade: Uint8Array;
  private variant: Uint8Array;
  private overview: { canvas: HTMLCanvasElement; ox: number; oy: number; key: string } | null = null;

  constructor(private sprites: Sprites, private map: GameMap) {
    const n = map.width * map.height;
    this.shade = new Uint8Array(n);
    this.variant = new Uint8Array(n);
    const e = (x: number, y: number) =>
      map.elevation[Math.min(map.height - 1, Math.max(0, y)) * map.width + Math.min(map.width - 1, Math.max(0, x))];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      // light from the north-west: slopes rising toward the viewer (south-east) are lit
      const dz = (e(x + 1, y) - e(x - 1, y)) + (e(x, y + 1) - e(x, y - 1));
      this.shade[i] = dz > 14 ? 0 : dz > 5 ? 1 : dz > -5 ? 2 : dz > -14 ? 3 : 4;
      this.variant[i] = Math.floor(tileNoise(99, x, y) * VARIANTS);
    }
  }

  /** World-space bounds of the whole map (for camera limits and the overview). */
  worldBounds() {
    const m = this.map;
    const left = tileToWorld(0, m.height, 0).sx;
    const right = tileToWorld(m.width, 0, 0).sx;
    const top = -m.maxLevel * LEVEL_PX - 60;
    const bottom = tileToWorld(m.width, m.height, 0).sy + EDGE_DEPTH * LEVEL_PX + 8;
    return { left, right, top, bottom };
  }

  invalidate() {
    this.overview = null;
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, opt: RenderOptions) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1b1d22";
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;

    if (cam.zoom < 0.5) {
      this.drawOverview(ctx, cam, g, opt);
    } else {
      ctx.setTransform(cam.zoom, 0, 0, cam.zoom, Math.round(-cam.x * cam.zoom), Math.round(-cam.y * cam.zoom));
      this.drawTiles(ctx, g, opt, cam.x, cam.y, cam.x + cw / cam.zoom, cam.y + ch / cam.zoom, true);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (opt.labels) this.drawLabels(ctx, cam);
  }

  private drawOverview(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, opt: RenderOptions) {
    const key = `${g.turn}|${opt.overlay ? "o" : ""}|${opt.grid}`;
    if (!this.overview || this.overview.key !== key) {
      const b = this.worldBounds();
      const s = 0.25;
      const c = document.createElement("canvas");
      c.width = Math.ceil((b.right - b.left) * s);
      c.height = Math.ceil((b.bottom - b.top) * s);
      const octx = c.getContext("2d")!;
      octx.imageSmoothingEnabled = false;
      octx.setTransform(s, 0, 0, s, -b.left * s, -b.top * s);
      this.drawTiles(octx, g, { ...opt, hover: null, selected: null, footprint: null }, b.left, b.top, b.right, b.bottom, false);
      this.overview = { canvas: c, ox: b.left, oy: b.top, key };
    }
    const o = this.overview;
    const k = cam.zoom / 0.25;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(o.canvas, Math.round((o.ox - cam.x) * cam.zoom), Math.round((o.oy - cam.y) * cam.zoom), o.canvas.width * k, o.canvas.height * k);
    // live markers on top of the cached image
    ctx.setTransform(cam.zoom, 0, 0, cam.zoom, Math.round(-cam.x * cam.zoom), Math.round(-cam.y * cam.zoom));
    this.drawMarkers(ctx, opt);
  }

  private drawTiles(ctx: CanvasRenderingContext2D, g: GameState, opt: RenderOptions,
    x0: number, y0: number, x1: number, y1: number, markers: boolean) {
    const m = this.map, w = g.world, sp = this.sprites;
    const W = m.width, H = m.height;
    const margin = m.maxLevel * LEVEL_PX + 60;
    // diagonal range (x+y) whose rows intersect the view
    const dMin = Math.max(0, Math.floor((y0 - 40) / (TH / 2)) - 1);
    const dMax = Math.min(W + H - 2, Math.ceil((y1 + margin) / (TH / 2)) + 1);
    const levelOf = (x: number, y: number) => m.level[y * W + x];

    for (let d = dMin; d <= dMax; d++) {
      const xs = Math.max(0, d - H + 1), xe = Math.min(W - 1, d);
      for (let x = xs; x <= xe; x++) {
        const y = d - x;
        const i = y * W + x;
        const L = m.level[i];
        const { sx, sy } = tileToWorld(x, y, L);
        if (sx + TW / 2 < x0 || sx - TW / 2 > x1) continue;
        if (sy - 60 > y1 || sy + TH + (L + EDGE_DEPTH) * LEVEL_PX < y0) continue;
        const left = sx - TW / 2;
        const t = m.terrain[i];
        const isWater = t === Terrain.Water;

        // side faces: drop toward the neighbour in front (y+1 = left face, x+1 = right face)
        const lN = y + 1 < H ? levelOf(x, y + 1) : -EDGE_DEPTH;
        const rN = x + 1 < W ? levelOf(x + 1, y) : -EDGE_DEPTH;
        if (L > lN) ctx.drawImage(sp.face("left", L - lN, isWater ? "water" : "earth"), left, sy);
        if (L > rN) ctx.drawImage(sp.face("right", L - rN, isWater ? "water" : "earth"), left, sy);

        // top surface
        const use = w.use[i];
        const sh = this.shade[i], v = this.variant[i];
        if (use === Use.Farm) ctx.drawImage(sp.farm[sh][v], left, sy);
        else ctx.drawImage(sp.top[t][isWater ? 2 : sh][v], left, sy);

        // roads
        if (w.road[i]) {
          let mask = 0;
          if (x > 0 && w.road[i - 1]) mask |= 1;
          if (x < W - 1 && w.road[i + 1]) mask |= 2;
          if (y > 0 && w.road[i - W]) mask |= 4;
          if (y < H - 1 && w.road[i + W]) mask |= 8;
          ctx.drawImage(w.road[i] === 2 ? sp.bridge[mask] : sp.road[mask], left, sy);
        }

        // soot from the works
        const pol = w.pollution[i];
        if (pol > 0.02 && !isWater) diamond(ctx, sx, sy, `rgba(52,44,38,${Math.min(0.55, pol * 0.6).toFixed(3)})`);

        if (opt.overlay) {
          const c = opt.overlay(i);
          if (c) diamond(ctx, sx, sy, `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`);
        }
        if (opt.grid) gridLines(ctx, sx, sy);

        // buildings
        const kind = this.buildingFor(g, x, y, i);
        if (kind) {
          const b = sp.building[kind][(v + (x & 1)) & 3];
          ctx.drawImage(b, left, sy - sp.buildingAnchorY);
        }
      }
    }
    if (markers) this.drawMarkers(ctx, opt);
  }

  private buildingFor(g: GameState, x: number, y: number, i: number): BuildingKind | null {
    const w = g.world;
    switch (w.use[i]) {
      case Use.Forest: return "forest";
      case Use.Cottage: return "cottage";
      case Use.Houses: return "houses";
      case Use.Rowhouses: return "rowhouses";
      case Use.Civic: return "civic";
      case Use.Farm: return w.pop[i] > 0 ? "farmhouse" : null;
      case Use.Industry:
      case Use.Rival: {
        const pre = w.use[i] === Use.Industry ? "works" : "rival";
        let ox = x, oy = y, fp = 3;
        if (w.use[i] === Use.Industry && g.company) { ox = g.company.x; oy = g.company.y; fp = g.company.footprint; }
        else {
          const r = g.rivals.find((r) => x >= r.x && y >= r.y && x < r.x + r.footprint && y < r.y + r.footprint);
          if (r) { ox = r.x; oy = r.y; fp = r.footprint; }
        }
        const lx = x - ox, ly = y - oy;
        if (lx === fp - 1 && ly === 0) return `${pre}_stack` as BuildingKind;
        if ((lx + ly) % 3 === 1 && lx > 0) return `${pre}_furnace` as BuildingKind;
        return `${pre}_shed` as BuildingKind;
      }
    }
    return null;
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, opt: RenderOptions) {
    const m = this.map;
    if (opt.footprint) {
      const f = opt.footprint;
      for (let dy = 0; dy < f.size; dy++) for (let dx = 0; dx < f.size; dx++) {
        const x = f.x + dx, y = f.y + dy;
        if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
        const { sx, sy } = tileToWorld(x, y, m.level[y * m.width + x]);
        diamond(ctx, sx, sy, f.ok ? "rgba(90,220,120,0.45)" : "rgba(230,70,60,0.45)");
      }
    }
    for (const [p, col] of [[opt.hover, "rgba(255,255,255,0.9)"], [opt.selected, "rgba(255,214,90,1)"]] as const) {
      if (!p) continue;
      const { sx, sy } = tileToWorld(p.x, p.y, m.level[p.y * m.width + p.x]);
      outline(ctx, sx, sy, col);
    }
  }

  private drawLabels(ctx: CanvasRenderingContext2D, cam: Camera) {
    const m = this.map;
    ctx.font = cam.zoom >= 1 ? "bold 12px ui-monospace, monospace" : "bold 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    for (const lm of m.landmarks) {
      if (lm.kind === "historic_site" && cam.zoom < 1) continue;
      const { sx, sy } = tileToWorld(lm.x, lm.y, m.level[lm.y * m.width + lm.x]);
      const px = Math.round((sx - cam.x) * cam.zoom), py = Math.round((sy - cam.y) * cam.zoom) - 10;
      if (px < -100 || py < -20 || px > ctx.canvas.width + 100 || py > ctx.canvas.height + 20) continue;
      const text = lm.name;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(text, px, py);
      ctx.fillStyle = lm.kind === "historic_site" ? "#ffcf6e" : lm.kind === "hill" ? "#cfe3a0" : "#ffffff";
      ctx.fillText(text, px, py);
    }
  }

  /** Visible tile range helper for other UI (e.g. minimap viewport). */
  viewGround(cam: Camera, cw: number, ch: number) {
    const pts = [[0, 0], [cw, 0], [cw, ch], [0, ch]].map(([px, py]) =>
      worldToGround(cam.x + px / cam.zoom, cam.y + py / cam.zoom));
    return pts;
  }
}

function diamond(ctx: CanvasRenderingContext2D, sx: number, sy: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + TW / 2, sy + TH / 2);
  ctx.lineTo(sx, sy + TH);
  ctx.lineTo(sx - TW / 2, sy + TH / 2);
  ctx.closePath();
  ctx.fill();
}

function outline(ctx: CanvasRenderingContext2D, sx: number, sy: number, stroke: string) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx, sy + 0.5);
  ctx.lineTo(sx + TW / 2 - 0.5, sy + TH / 2);
  ctx.lineTo(sx, sy + TH - 0.5);
  ctx.lineTo(sx - TW / 2 + 0.5, sy + TH / 2);
  ctx.closePath();
  ctx.stroke();
}

function gridLines(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(sx - TW / 2, sy + TH / 2);
  ctx.lineTo(sx, sy);
  ctx.lineTo(sx + TW / 2, sy + TH / 2);
  ctx.stroke();
}


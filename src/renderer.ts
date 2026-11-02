import { clamp, hash3 } from "./math";
import { TURTLE_NODES, TURTLE_SHAPES, TURTLE_KINDS, TURTLE_TINTS, type TurtleShape } from "./species";
import type { TurtleAgent, FishAgent, TurtleWorld } from "./world";

export const ALPHA_LEVELS = 6;
export const AMBIENT_ALPHAS = [0.3, 0.45, 0.6, 0.75, 0.9];
export const ACCENTS = ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"];
export const SKIN_RAMP = ":;t%SX8#@";
export const FIN_GLYPHS = "%;tS:";
export const RIDGE_GLYPHS = "@8%";
export const EDGE_HEAVY = ":;";
export const EDGE_LIGHT = ".',`";
export const MARK_GLYPHS = "#%@";

export const FLAG_BODY = 1;
export const FLAG_EDGE = 2;
export const FLAG_FIN = 3;
export const FLAG_RIDGE = 4;
export const FLAG_EYE = 5;
export const FLAG_MARK = 6;
export const FLAG_WHITE_PATCH = 7;
export const FLAG_WHITE_SPOT = 8;

export const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];

export class BaseAsciiRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bg: HTMLCanvasElement;
  kinds: string[];
  tints: Record<string, [number, number, number]>;
  dpr = 1;
  width = 0;
  height = 0;
  cols = 0;
  rows = 0;
  cw = 8;
  ch = 12;
  font = "";
  cellFlag: Uint8Array = new Uint8Array(0);
  cellShade: Float32Array = new Float32Array(0);
  cellKey: Uint32Array = new Uint32Array(0);
  cellDepth: Float32Array = new Float32Array(0);
  cellKind: Uint8Array = new Uint8Array(0);
  ambientStamp: Uint32Array = new Uint32Array(0);
  ambientBuckets: number[][] = [];
  ambientGlyph = ".";
  ambientGlyphs: string[] | null = null;
  hitFlag = 0;
  hitShade = 0;
  hitDist = 0;
  hitS = 0;
  hitV = 0;

  constructor(canvas: HTMLCanvasElement, kinds: string[], tints: Record<string, [number, number, number]>) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.bg = document.createElement("canvas");
    this.kinds = kinds;
    this.tints = tints;
    for (let i = 0; i < AMBIENT_ALPHAS.length; i++) this.ambientBuckets.push([]);
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);

    const baseCw = clamp(Math.round(width / 135), 7, 10);
    this.cw = baseCw;
    this.ch = Math.round(baseCw * 1.5);
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);

    const n = this.cols * this.rows;
    if (this.cellFlag.length < n) {
      this.cellFlag = new Uint8Array(n);
      this.cellShade = new Float32Array(n);
      this.cellKey = new Uint32Array(n);
      this.cellDepth = new Float32Array(n);
      this.cellKind = new Uint8Array(n);
      this.ambientStamp = new Uint32Array(n);
    }

    const fs = Math.round(this.ch * 0.95);
    this.font = `600 ${fs}px "Geist Mono", "SF Mono", Monaco, Consolas, monospace`;

    this.renderBackgroundGrid();
  }

  renderBackgroundGrid() {
    const { bg, width, height, dpr, cw, ch, cols, rows } = this;
    bg.width = Math.round(width * dpr);
    bg.height = Math.round(height * dpr);
    const bctx = bg.getContext("2d")!;
    bctx.scale(dpr, dpr);
    bctx.fillStyle = "#fafbfe";
    bctx.fillRect(0, 0, width, height);

    bctx.font = this.font;
    bctx.textAlign = "center";
    bctx.textBaseline = "middle";

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw + cw / 2;
        const y = r * ch + ch / 2 + 1;
        const h = hash3(c, r, 101);
        if (h < 0.04) {
          bctx.fillStyle = "rgba(148, 163, 184, 0.40)";
          bctx.fillText("·", x, y);
        } else if (h < 0.09) {
          bctx.fillStyle = "rgba(203, 213, 225, 0.35)";
          bctx.fillText(".", x, y);
        }
      }
    }
  }

  cellIndex(x: number, y: number): number {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return -1;
    return r * this.cols + c;
  }
}

export class TurtleRenderer extends BaseAsciiRenderer {
  spine = new Float32Array(TURTLE_NODES * 2);
  arc = new Float32Array(TURTLE_NODES);
  arcTotal = 0;
  curShape: TurtleShape = TURTLE_SHAPES.loggerhead;

  constructor(canvas: HTMLCanvasElement) {
    super(canvas, TURTLE_KINDS, TURTLE_TINTS);
    this.ambientGlyphs = ["·", ".", "°", "*"];
  }

  sampleTurtle(px: number, py: number, t: TurtleAgent): boolean {
    const { spine, arc, curShape: shape } = this;
    const L = t.length;
    let best = Infinity;
    let bestS = 0;
    let bestSign = 1;

    for (let k = 0; k < TURTLE_NODES - 1; k++) {
      const ax = spine[k * 2], ay = spine[k * 2 + 1];
      const bx = spine[(k + 1) * 2], by = spine[(k + 1) * 2 + 1];
      const abx = bx - ax, aby = by - ay;
      const ab2 = abx * abx + aby * aby || 1e-6;
      const apx = px - ax, apy = py - ay;
      const u = clamp((apx * abx + apy * aby) / ab2, 0, 1);
      const qx = ax + abx * u, qy = ay + aby * u;
      const d2 = (px - qx) ** 2 + (py - qy) ** 2;
      if (d2 < best) {
        best = d2;
        const sAlong = (arc[k] + Math.sqrt(ab2) * u) / this.arcTotal;
        bestS = clamp(sAlong, 0, 1);
        const cross = abx * apy - aby * apx;
        bestSign = cross >= 0 ? 1 : -1;
      }
    }

    const dist = Math.sqrt(best);
    this.hitDist = dist;
    this.hitS = bestS;
    this.hitV = dist * bestSign;

    const s = bestS;
    const a = dist;

    // 1. Head & Beak
    if (s <= 0.18) {
      const headEnd = 0.13;
      if (s <= headEnd) {
        const pHead = s / headEnd;
        let headW = shape.beakSharp
          ? L * 0.075 * Math.sqrt(pHead) * (1 - 0.15 * pHead)
          : L * (shape.headScale || 0.11) * Math.sin(Math.pow(pHead, 0.62) * Math.PI * 0.88);
        if (a <= headW) {
          if (s >= 0.040 && s <= 0.078 && a >= headW * 0.58) {
            this.hitFlag = FLAG_EYE;
            this.hitShade = 0;
          } else {
            this.hitFlag = FLAG_MARK;
            this.hitShade = 0.74 - 0.22 * (a / (headW || 1));
          }
          return true;
        }
      }
      const neckW = L * 0.065;
      if (s > 0.09 && s <= 0.18 && a <= neckW) {
        this.hitFlag = FLAG_MARK;
        this.hitShade = 0.62;
        return true;
      }
    }

    // 2. Carapace / Shell
    const shellStart = 0.18;
    const shellEnd = 0.78;
    let curShellHalfW = 0;
    if (s >= shellStart && s <= shellEnd) {
      const pShell = (s - shellStart) / (shellEnd - shellStart);
      const maxShellW = L * (shape.shellWidth || 0.30);

      let shellProf: number;
      if (shape.scuteType === "ridley") {
        shellProf = Math.sin(Math.pow(pShell, 0.72) * Math.PI);
      } else if (shape.scuteType === "loggerhead") {
        shellProf = Math.sin(Math.pow(pShell, 0.65) * Math.PI) * (1 - 0.18 * pShell);
      } else {
        shellProf = Math.sin(Math.pow(pShell, 0.74) * Math.PI) * (1 - 0.14 * pShell);
      }

      let serration = 0;
      if (shape.serratedMargin && pShell > 0.65) {
        serration = 0.03 * Math.sin(pShell * 36) * ((pShell - 0.65) / 0.35);
      }

      const halfW = maxShellW * (shellProf + serration);
      curShellHalfW = halfW;
      if (a <= halfW) {
        const rShell = a / (halfW || 1);

        if (rShell < 0.10) {
          this.hitFlag = FLAG_RIDGE;
          this.hitShade = 0.95;
          return true;
        }
        if (rShell > 0.85) {
          this.hitFlag = FLAG_RIDGE;
          this.hitShade = 0.65;
          return true;
        }
        const scuteU = pShell * 4.6;
        const scuteV = rShell * 2.6;
        const du = Math.abs(scuteU - Math.round(scuteU));
        const dv = Math.abs(scuteV - Math.round(scuteV));
        if (Math.min(du, dv) < 0.09) {
          this.hitFlag = FLAG_RIDGE;
          this.hitShade = 0.85;
          return true;
        }
        if (shape.scuteType === "hawksbill" && hash3(Math.round(scuteU), Math.round(scuteV), t.id) > 0.30) {
          this.hitFlag = FLAG_WHITE_SPOT;
          this.hitShade = 0.92;
          return true;
        }
        this.hitFlag = FLAG_BODY;
        this.hitShade = 0.72 - rShell * 0.22;
        return true;
      }
    }

    // 3. Articulated Front Flippers
    const sShoulder = 0.22;
    const strokeSin = Math.sin(t.strokeCycle);
    const strokeCos = Math.cos(t.strokeCycle);
    const aMin = Math.max(L * 0.08, curShellHalfW * 0.96);

    const isLeft = bestSign > 0;
    const activity = isLeft ? (t.flipperLeftActivity ?? 1.0) : (t.flipperRightActivity ?? 1.0);
    const activeExt = (strokeSin < 0) ? (1.0 + 0.20 * (-strokeSin)) : (1.0 - 0.58 * Math.pow(strokeSin, 1.25));
    const activeSweep = (strokeSin < 0) ? (-0.15 * (-strokeSin)) : (0.28 * Math.pow(strokeSin, 1.15));
    const extension = 0.48 + activity * (activeExt - 0.48);
    const strokeSweep = 0.10 + activity * (activeSweep - 0.10);

    const bank = clamp(t.turn * 1.1, -0.35, 0.35) * bestSign;
    const baseSpan = L * (shape.flipperSpan || 0.49);
    const curSpan = baseSpan * extension * (1 + bank * 0.35);
    const aMax = aMin + curSpan;

    if (a >= aMin && a <= aMax) {
      const spanProg = (a - aMin) / curSpan;
      const baseSweep = 0.10 * Math.pow(spanProg, 1.3);
      const sweepAmp = strokeSweep * Math.pow(spanProg, 1.1);
      const bladeLag = -0.06 * strokeCos * Math.pow(spanProg, 1.4);
      const flipperAxisS = sShoulder + baseSweep + sweepAmp + bladeLag;
      const flipperChord = 0.046 + 0.050 * Math.sin(spanProg * Math.PI) * (1 - 0.20 * spanProg);
      const ds = Math.abs(s - flipperAxisS);

      if (ds <= flipperChord) {
        this.hitFlag = FLAG_FIN;
        const edgeShade = 1 - (ds / flipperChord);
        this.hitShade = 0.60 + edgeShade * 0.18 - spanProg * 0.15 + strokeCos * 0.10 * spanProg;
        return true;
      }
    }

    // 4. Rear Flippers
    const rearRootS = 0.70;
    const rearMinA = Math.max(L * 0.05, curShellHalfW * 0.96);
    const rearMaxA = L * 0.28;
    if (a >= rearMinA && a <= rearMaxA && s >= 0.62 && s <= 0.94) {
      const rearSpanProg = (a - rearMinA) / (rearMaxA - rearMinA);
      const rudderAngle = -t.turn * 0.45 * bestSign;
      const rearAxisS = rearRootS + rearSpanProg * 0.14 + rudderAngle * 0.08;
      const rearChord = 0.080 * (1 - 0.35 * rearSpanProg) + 0.02;
      if (Math.abs(s - rearAxisS) <= rearChord) {
        this.hitFlag = FLAG_FIN;
        this.hitShade = 0.58 - rearSpanProg * 0.18;
        return true;
      }
    }

    // 5. Short Tail
    if (s >= 0.76 && s <= 0.90) {
      const tailProg = (s - 0.76) / 0.14;
      const tailW = L * 0.030 * (1 - tailProg);
      if (a <= tailW) {
        this.hitFlag = FLAG_MARK;
        this.hitShade = 0.55;
        return true;
      }
    }

    return false;
  }

  rasterizeTurtles(turtles: TurtleAgent[], t: number) {
    const { cellFlag, cellShade, cellKey, cellDepth, cellKind, spine, arc, cw, ch, cols, rows } = this;
    cellFlag.fill(0);

    for (let tIdx = 0; tIdx < turtles.length; tIdx++) {
      const turtle = turtles[tIdx];
      const L = turtle.length;
      const n = turtle.nodes;
      const swim = clamp(turtle.speed / 26, 0.4, 1.4);
      const shape = TURTLE_SHAPES[turtle.kind] || TURTLE_SHAPES.loggerhead;
      this.curShape = shape;
      const kindIndex = Math.max(0, TURTLE_KINDS.indexOf(turtle.kind));

      for (let k = 0; k < TURTLE_NODES; k++) {
        const s = k / (TURTLE_NODES - 1);
        const prev = Math.max(0, k - 1);
        const next = Math.min(TURTLE_NODES - 1, k + 1);
        let tx = n[prev * 2] - n[next * 2];
        let ty = n[prev * 2 + 1] - n[next * 2 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        const amp = L * 0.015 * Math.pow(s, 2.2) * swim;
        const off = amp * Math.sin(turtle.phase - s * 3.8);
        spine[k * 2] = n[k * 2] - ty * off;
        spine[k * 2 + 1] = n[k * 2 + 1] + tx * off;
      }

      arc[0] = 0;
      for (let k = 1; k < TURTLE_NODES; k++) {
        arc[k] = arc[k - 1] + Math.hypot(spine[k * 2] - spine[(k - 1) * 2], spine[k * 2 + 1] - spine[(k - 1) * 2 + 1]);
      }
      this.arcTotal = arc[TURTLE_NODES - 1] || 1;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k < TURTLE_NODES; k++) {
        minX = Math.min(minX, spine[k * 2]);
        maxX = Math.max(maxX, spine[k * 2]);
        minY = Math.min(minY, spine[k * 2 + 1]);
        maxY = Math.max(maxY, spine[k * 2 + 1]);
      }
      const reach = L * 0.58;
      const c0 = Math.max(0, Math.floor((minX - reach) / cw));
      const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
      const r0 = Math.max(0, Math.floor((minY - reach) / ch));
      const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));
      if (c0 > c1 || r0 > r1) continue;

      const skipBeyond = reach + Math.hypot(cw, ch);

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const x = c * cw;
          const y = r * ch;
          const centerHit = this.sampleTurtle(x + cw / 2, y + ch / 2, turtle);
          if (!centerHit && this.hitDist > skipBeyond) continue;
          const flag = this.hitFlag;
          const shade = this.hitShade;
          const s = this.hitS;
          const v = this.hitV;

          let hits = centerHit ? 1 : 0;
          for (let k = 0; k < SUBSAMPLES.length; k += 2) {
            if (this.sampleTurtle(x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch, turtle)) hits++;
          }
          if (hits === 0) continue;
          const coverage = hits / 5;

          const i = r * cols + c;
          const key = (hash3(Math.round(s * 48), Math.round(v / (cw * 0.8)), turtle.id) * 4294967295) >>> 0;
          cellKey[i] = key;
          cellDepth[i] = turtle.depth;
          cellKind[i] = kindIndex;

          if (centerHit && coverage >= 0.6) {
            cellFlag[i] = flag;
            const flicker = (hash3(c, r, Math.floor(t * 6)) - 0.5) * 0.05;
            cellShade[i] = clamp(shade + flicker, 0, 1);
          } else {
            cellFlag[i] = FLAG_EDGE;
            cellShade[i] = coverage;
          }
        }
      }
    }
  }

  render(world: TurtleWorld) {
    const { ctx, bg, width, height, dpr } = this;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.drawImage(bg, 0, 0, width, height);

    this.rasterizeTurtles(world.turtles, world.time);

    // Ambient fish
    for (const b of this.ambientBuckets) b.length = 0;
    const { cellFlag, ambientStamp, ambientBuckets, cols } = this;
    const frame = ((world.time * 60) | 0) + 1;
    for (const f of world.fish) {
      const i = this.cellIndex(f.x, f.y);
      if (i < 0 || ambientStamp[i] === frame || cellFlag[i]) continue;
      ambientStamp[i] = frame;
      const v = 0.3 + (0.4 * (f.depth - 0.55)) / 0.45;
      ambientBuckets[clamp(Math.floor(v * AMBIENT_ALPHAS.length), 0, AMBIENT_ALPHAS.length - 1)].push(i);
    }
    this.drawAmbient();

    // Turtle Cells
    this.drawTurtleCells(world.time);

    ctx.restore();
  }

  drawAmbient() {
    const { ctx, cw, ch, cols, ambientBuckets, ambientGlyphs } = this;
    for (let b = 0; b < ambientBuckets.length; b++) {
      const bucket = ambientBuckets[b];
      if (!bucket.length) continue;
      const a = AMBIENT_ALPHAS[b];
      ctx.fillStyle = `rgba(51, 65, 85, ${a * 0.75})`;
      for (const i of bucket) {
        const chGlyph = ambientGlyphs ? ambientGlyphs[(i + b) % ambientGlyphs.length] : "·";
        ctx.fillText(chGlyph, (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
      }
    }
  }

  drawTurtleCells(t: number) {
    const { ctx, cols, rows, cw, ch, cellFlag, cellShade, cellKey, cellDepth, cellKind } = this;
    const n = cols * rows;

    for (let i = 0; i < n; i++) {
      const flag = cellFlag[i];
      if (!flag) continue;
      const col = i % cols;
      const row = (i / cols) | 0;
      const x = col * cw;
      const y = row * ch;
      const key = cellKey[i];
      const shade = cellShade[i];
      const dim = 0.78 + 0.22 * cellDepth[i];
      const kindName = TURTLE_KINDS[cellKind[i]] || TURTLE_KINDS[0];
      const shape = TURTLE_SHAPES[kindName] || TURTLE_SHAPES.loggerhead;

      if (flag === FLAG_EDGE) {
        const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
        const glyph = set[(key >>> 8) % set.length];
        ctx.fillStyle = "rgba(71, 85, 105, 0.70)";
        ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
        continue;
      }

      let lum: number;
      let glyph: string;
      let tr: number, tg: number, tb: number;

      if (flag === FLAG_WHITE_SPOT) {
        lum = (240 - shade * 20) * dim;
        glyph = "o";
        [tr, tg, tb] = [1, 1, 1];
      } else if (flag === FLAG_RIDGE) {
        lum = 42 * dim;
        glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
        [tr, tg, tb] = shape.shellTint || shape.tint;
      } else if (flag === FLAG_BODY) {
        lum = (122 - shade * 38) * dim;
        const jitter = ((key >>> 4) % 3) - 1;
        glyph = SKIN_RAMP[clamp(Math.floor(shade * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
        [tr, tg, tb] = shape.shellTint || shape.tint;
      } else {
        lum = (222 - shade * 32) * dim;
        if (flag === FLAG_FIN) {
          const FLIP_GLYPHS = "%;tS~";
          glyph = FLIP_GLYPHS[(key >>> 8) % FLIP_GLYPHS.length];
        } else {
          const jitter = ((key >>> 4) % 3) - 1;
          glyph = SKIN_RAMP[clamp(Math.floor(shade * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
        }
        [tr, tg, tb] = shape.skinTint || shape.tint;
      }

      const r = clamp(Math.round(lum * tr), 0, 255);
      const g = clamp(Math.round(lum * tg), 0, 255);
      const b = clamp(Math.round(lum * tb), 0, 255);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);

      let glyphColor: string;
      if (flag === FLAG_EYE) glyphColor = "#ffffff";
      else if (flag === FLAG_RIDGE) glyphColor = "#fef08a";
      else if (flag === FLAG_BODY) glyphColor = `rgb(${Math.min(255, r + 55)}, ${Math.min(255, g + 55)}, ${Math.min(255, b + 45)})`;
      else glyphColor = `rgb(${Math.max(0, Math.round(r * 0.40))}, ${Math.max(0, Math.round(g * 0.40))}, ${Math.max(0, Math.round(b * 0.35))})`;

      ctx.fillStyle = glyphColor;
      ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
    }
  }
}

// ASCII Sea Turtles Engine — Standalone Canvas Component
// Created by Lazaro Guerrero Losada • Open Source (MIT)
// Inspired by stackedlol/ascii-sharks

(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    const exports = factory();
    root.TurtleEngine = exports.TurtleEngine;
    root.TurtleWorld = exports.TurtleWorld;
    root.TurtleRenderer = exports.TurtleRenderer;
    root.TURTLE_SHAPES = exports.TURTLE_SHAPES;
    root.DEFAULT_TURTLES = exports.DEFAULT_TURTLES;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";


  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function angleDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  function hash3(x, y, z) {
    let h =
      Math.imul(x | 0, 374761393) ^
      Math.imul(y | 0, 668265263) ^
      Math.imul(z | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const K1 = 1 / 260;
  const K2 = 1 / 310;
  const K3 = 1 / 190;
  const CURRENT_SCALE = 3400;

  function flowCurrent(x, y, t, out) {
    const a = x * K1 + t * 0.07;
    const b = y * K2 - t * 0.05;
    const c = (x + y) * K3 + t * 0.11;
    out.x = (-K2 * Math.sin(a) * Math.sin(b) + 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
    out.y = (-K1 * Math.cos(a) * Math.cos(b) - 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
    return out;
  }

  // Exact same ASCII constants & palette as sharks.js
  const ALPHA_LEVELS = 6;
  const AMBIENT_ALPHAS = [0.3, 0.45, 0.6, 0.75, 0.9];
  const ACCENTS = ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"];
  const SKIN_RAMP = ":;t%SX8#@";
  const FIN_GLYPHS = "%;tS:";
  const RIDGE_GLYPHS = "@8%";
  const EDGE_HEAVY = ":;";
  const EDGE_LIGHT = ".',`";
  const MARK_GLYPHS = "#%@";

  const FLAG_BODY = 1;
  const FLAG_EDGE = 2;
  const FLAG_FIN = 3;
  const FLAG_RIDGE = 4;
  const FLAG_EYE = 5;
  const FLAG_MARK = 6;
  const FLAG_WHITE_PATCH = 7;
  const FLAG_WHITE_SPOT = 8;

  const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];
  const STEP = 1 / 60;
  const MAX_STEPS = 4;

  // ── SHARED BASE ASCII RENDERER ───────────────────────────────────────────

  class BaseAsciiRenderer {
    constructor(canvas, kinds, tints) {
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("2D canvas unavailable");
      this.canvas = canvas;
      this.ctx = ctx;
      this.bg = document.createElement("canvas");
      this.kinds = kinds;
      this.tints = tints;

      this.dpr = 1;
      this.width = 0;
      this.height = 0;
      this.cw = 12;
      this.ch = 18;
      this.cols = 0;
      this.rows = 0;
      this.fontFamily = "ui-monospace, Menlo, monospace";

      this.energy = new Float32Array(0);
      this.energyTmp = new Float32Array(0);
      this.heat = new Float32Array(0);
      this.dotStyles = [];

      this.cellFlag = new Uint8Array(0);
      this.cellShade = new Float32Array(0);
      this.cellKey = new Uint32Array(0);
      this.cellDepth = new Float32Array(0);
      this.cellKind = new Uint8Array(0);

      this.ambientStamp = new Uint32Array(0);
      this.frameId = 0;
      this.ambientBuckets = AMBIENT_ALPHAS.map(() => []);
      this.ambientGlyph = "-";

      this.hitFlag = 0;
      this.hitShade = 0;
      this.hitS = 0;
      this.hitV = 0;
      this.hitDist = 0;

      for (let l = 0; l < ALPHA_LEVELS; l++) {
        const a = (0.35 * (l + 1)) / ALPHA_LEVELS;
        this.dotStyles.push(`rgba(14, 165, 233, ${a.toFixed(3)})`);
      }
    }

    get cellWidth() { return this.cw; }
    get cellHeight() { return this.ch; }

    setFontFamily(family) {
      if (family) this.fontFamily = family;
    }

    resize(width, height, dpr) {
      const prevCols = this.cols;
      const prevRows = this.rows;
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.cw = clamp(Math.round(width / 124), 8, 13);
      this.ch = Math.round(this.cw * 1.45);
      this.cols = Math.ceil(width / this.cw);
      this.rows = Math.ceil(height / this.ch);

      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.bg.width = this.canvas.width;
      this.bg.height = this.canvas.height;

      const n = this.cols * this.rows;
      if (this.cols !== prevCols || this.rows !== prevRows) {
        this.energy = new Float32Array(n);
        this.energyTmp = new Float32Array(n);
        this.heat = new Float32Array(n);
        this.cellFlag = new Uint8Array(n);
        this.cellShade = new Float32Array(n);
        this.cellKey = new Uint32Array(n);
        this.cellDepth = new Float32Array(n);
        this.cellKind = new Uint8Array(n);
        this.ambientStamp = new Uint32Array(n);
      }

      this.paintBackground();
    }

    paintBackground() {
      const g = this.bg.getContext("2d");
      if (!g) return;
      const { width: W, height: H, dpr, cw, ch } = this;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#fafbfe";
      g.fillRect(0, 0, W, H);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.strokeStyle = "rgba(0, 0, 0, 0.035)";
      g.lineWidth = 1;
      g.beginPath();
      for (let c = 0; c <= Math.ceil(W / cw); c++) {
        const x = Math.round(c * cw * dpr) + 0.5;
        g.moveTo(x, 0);
        g.lineTo(x, H * dpr);
      }
      for (let r = 0; r <= Math.ceil(H / ch); r++) {
        const y = Math.round(r * ch * dpr) + 0.5;
        g.moveTo(0, y);
        g.lineTo(W * dpr, y);
      }
      g.stroke();
    }

    cellIndex(x, y) {
      const c = Math.floor(x / this.cw);
      const r = Math.floor(y / this.ch);
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
      return r * this.cols + c;
    }

    stamp(field, x, y, radius, amount) {
      const c0 = Math.floor(x / this.cw);
      const r0 = Math.floor(y / this.ch);
      for (let r = r0 - radius; r <= r0 + radius; r++) {
        for (let c = c0 - radius; c <= c0 + radius; c++) {
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const d = Math.hypot(c - c0, (r - r0) * 1.4);
          if (d > radius + 0.5) continue;
          const i = r * this.cols + c;
          field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
        }
      }
    }

    consumeEvents(world) {
      for (const e of world.events) {
        if (e.kind === "eat" || e.kind === "divide") {
          this.stamp(this.heat, e.x, e.y, e.kind === "divide" ? 3 : 2, 1);
          this.stamp(this.energy, e.x, e.y, e.kind === "divide" ? 5 : 3, 1.0);
        } else if (e.kind === "pulse") {
          this.stamp(this.energy, e.x, e.y, 4, 0.7);
        } else {
          this.stamp(this.energy, e.x, e.y, 6, 1.4);
        }
      }
      world.events.length = 0;
    }

    diffuse(dt) {
      const { cols, rows, energy, energyTmp: tmp, heat } = this;
      const decay = Math.exp(-dt * 1.5);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const l = c > 0 ? energy[i - 1] : energy[i];
          const rt = c < cols - 1 ? energy[i + 1] : energy[i];
          const u = r > 0 ? energy[i - cols] : energy[i];
          const d = r < rows - 1 ? energy[i + cols] : energy[i];
          tmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * decay;
        }
      }
      this.energy = tmp;
      this.energyTmp = energy;
      const heatDecay = Math.exp(-dt * 2.2);
      for (let i = 0; i < heat.length; i++) heat[i] *= heatDecay;
    }

    drawDots() {
      const { ctx, cols, rows, cw, ch, energy, cellFlag } = this;
      const n = cols * rows;
      for (let i = 0; i < n; i++) {
        const e = energy[i];
        if (cellFlag[i] || e < 0.42) continue;
        const col = i % cols;
        const row = (i / cols) | 0;
        const level = clamp(Math.floor((e - 0.42) * 6), 0, ALPHA_LEVELS - 1);
        ctx.fillStyle = this.dotStyles[level];
        const size = Math.max(2, Math.round(cw * 0.22));
        ctx.fillRect(
          Math.round(col * cw + cw * 0.66 - size / 2),
          Math.round(row * ch + ch * 0.64 - size / 2),
          size,
          size
        );
      }
    }

    drawHeat() {
      const { ctx, heat, cols, cw, ch } = this;
      for (let i = 0; i < heat.length; i++) {
        const h = heat[i];
        if (h < 0.08) continue;
        const col = i % cols;
        const row = (i / cols) | 0;
        ctx.fillStyle = h > 0.5 ? `rgba(255,120,60,${h.toFixed(2)})` : `rgba(220,40,40,${(h * 1.6).toFixed(2)})`;
        ctx.fillText(h > 0.6 ? "*" : "·", col * cw + cw / 2, row * ch + ch / 2 + 1);
      }
    }

    markAmbient(particles) {
      const { ambientStamp, ambientBuckets, cellFlag } = this;
      const frame = ++this.frameId;
      for (const bucket of ambientBuckets) bucket.length = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (const p of particles) {
          if (!p.alive || (p.depth > 0.78 ? 0 : 1) !== pass) continue;
          const i = this.cellIndex(p.x, p.y);
          if (i < 0 || ambientStamp[i] === frame || cellFlag[i]) continue;
          ambientStamp[i] = frame;
          const glint = clamp(Math.abs(p.turn || 0) / 3.5, 0, 1);
          const v = 0.3 + (0.4 * (p.depth - 0.55)) / 0.45 + 0.3 * Math.max(glint, p.alarm || 0);
          ambientBuckets[clamp(Math.floor(v * AMBIENT_ALPHAS.length), 0, AMBIENT_ALPHAS.length - 1)].push(i);
        }
      }
    }

    drawAmbient(customGlyphs) {
      const { ctx, cw, ch, cols, ambientBuckets } = this;
      for (let b = 0; b < ambientBuckets.length; b++) {
        const bucket = ambientBuckets[b];
        if (!bucket.length) continue;
        const a = AMBIENT_ALPHAS[b];
        ctx.fillStyle = `rgba(51, 65, 85, ${a * 0.75})`;
        for (const i of bucket) {
          const chGlyph = customGlyphs ? customGlyphs[(i + b) % customGlyphs.length] : this.ambientGlyph;
          ctx.fillText(chGlyph, (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
        }
      }
    }

    drawCells(t) {
      const { ctx, cols, rows, cw, ch, cellFlag, cellShade, cellKey, cellDepth, cellKind, kinds, tints } = this;
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
        const kindName = kinds[cellKind[i]] || kinds[0];
        const [tr, tg, tb] = tints[kindName] || [0.94, 0.97, 1.03];

        const tick = Math.floor(t * 2.4 + (key % 997) / 97);
        const roll = hash3(key, tick, 7);

        if (flag === FLAG_EDGE) {
          const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          const glyph = set[(key >>> 8) % set.length];
          ctx.fillStyle = roll < 0.07 ? ACCENTS[key % ACCENTS.length] : "rgba(100, 116, 139, 0.65)";
          ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
          continue;
        }

        let bgLevel;
        let glyph;
        if (flag === FLAG_RIDGE) {
          bgLevel = 100;
          glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
        } else if (flag === FLAG_EYE) {
          bgLevel = 36;
          glyph = "o";
        } else if (flag === FLAG_MARK) {
          bgLevel = 115;
          glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length];
        } else if (flag === FLAG_FIN) {
          bgLevel = 190 - shade * 65;
          glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length];
        } else {
          bgLevel = 224 - shade * 105;
          const jitter = ((key >>> 4) % 3) - 1;
          glyph = SKIN_RAMP[clamp(Math.floor(shade * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
        }

        bgLevel *= dim;
        const r = Math.min(255, Math.round(bgLevel * tr));
        const g = Math.min(255, Math.round(bgLevel * tg));
        const b = Math.min(255, Math.round(bgLevel * tb + 3));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);

        let glyphColor;
        if (flag === FLAG_EYE) {
          glyphColor = "#ffffff";
        } else if (flag === FLAG_MARK) {
          glyphColor = "#0f172a";
        } else if (roll < 0.08) {
          glyphColor = ACCENTS[key % ACCENTS.length];
        } else if (roll < 0.12) {
          glyphColor = "#ffffff";
        } else if (bgLevel < 138) {
          glyphColor = "#f8fafc";
        } else {
          glyphColor = "#1e293b";
        }
        ctx.fillStyle = glyphColor;
        ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
      }
    }
  }

  // ── SHARED ENGINE LOOP WRAPPER ───────────────────────────────────────────

  class BaseLoopEngine {
    constructor(canvas, world, renderer) {
      this.canvas = canvas;
      this.world = world;
      this.renderer = renderer;
      this.renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
      this.raf = 0;
      this.last = 0;
      this.acc = 0;
      this.disposed = false;

      this.onResize = () => this.resize();
      window.addEventListener("pointermove", this.onPointerMove, { passive: true });
      window.addEventListener("pointerdown", this.onPointerDown, { passive: true });
      document.documentElement.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("blur", this.onPointerLeave);
      window.addEventListener("resize", this.onResize);

      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(canvas);

      this.resize();
      this.schedule();
    }

    destroy() {
      this.disposed = true;
      cancelAnimationFrame(this.raf);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerdown", this.onPointerDown);
      document.documentElement.removeEventListener("pointerleave", this.onPointerLeave);
      window.removeEventListener("pointerleave", this.onPointerLeave);
      window.removeEventListener("blur", this.onPointerLeave);
      window.removeEventListener("resize", this.onResize);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width > 10 ? rect.width : window.innerWidth;
      const h = rect.height > 10 ? rect.height : window.innerHeight;
      if (w < 1 || h < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.renderer.resize(w, h, dpr);
      this.world.resize(w, h, this.renderer.cellWidth, this.renderer.cellHeight);
    }

    schedule() {
      cancelAnimationFrame(this.raf);
      if (this.disposed) return;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }

    frame = (now) => {
      if (this.disposed) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS) {
        this.world.step(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS) this.acc = 0;
      this.renderer.render(this.world, dt);
      this.raf = requestAnimationFrame(this.frame);
    };

    toLocal(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      return { x, y, inside };
    }

    onPointerMove = (e) => {
      const { x, y, inside } = this.toLocal(e);
      const p = this.world.pointer;
      p.x = x;
      p.y = y;
      p.active = inside;
    };

    onPointerDown = (e) => {
      if (
        e.target &&
        e.target !== this.canvas &&
        e.target.closest &&
        e.target.closest(".focus-card, .modal-backdrop, .floating-pill, button, input, select, a")
      ) {
        return;
      }
      const { x, y, inside } = this.toLocal(e);
      if (inside) this.world.splash(x, y);
    };

    onPointerLeave = () => {
      this.world.pointer.active = false;
    };
  }


  const TURTLE_NODES = 16;
  const TURTLE_SHAPES = {
    loggerhead: {
      carapaceRatio: 0.62,
      shellWidth: 0.31, // Broad, sturdy heart carapace
      headScale: 0.12,
      beakSharp: false,
      flipperSpan: 0.49, // Balanced hydrofoil pectoral flippers
      palette: "reddish_brown",
      shellTint: [0.42, 0.18, 0.08], // Deep dark burnt terracotta shell
      skinTint: [0.90, 0.70, 0.40],  // Light warm golden-tan flippers & head
      tint: [0.42, 0.18, 0.08],
      scuteType: "loggerhead",
    },
    greenturtle: {
      carapaceRatio: 0.65,
      shellWidth: 0.29, // Smooth rounded teardrop oval
      headScale: 0.11,
      beakSharp: false,
      flipperSpan: 0.52, // Graceful oceanic flipper wings
      palette: "olive_green",
      shellTint: [0.15, 0.30, 0.12], // Deep dark forest / pine-olive shell
      skinTint: [0.55, 0.78, 0.45],  // Luminous light sage-jade flippers & head
      tint: [0.15, 0.30, 0.12],
      scuteType: "green",
    },
    olive_ridley: {
      carapaceRatio: 0.58,
      shellWidth: 0.33, // Broadest, nearly circular shell
      headScale: 0.11,
      beakSharp: false,
      flipperSpan: 0.46,
      palette: "slate_olive",
      shellTint: [0.22, 0.28, 0.22], // Deep dark charcoal-olive shell
      skinTint: [0.65, 0.74, 0.62],  // Pale light olive-slate flippers & head
      tint: [0.22, 0.28, 0.22],
      scuteType: "ridley",
    },
    hawksbill: {
      carapaceRatio: 0.64,
      shellWidth: 0.28, // Distinctive amber tortoiseshell with jagged posterior scutes
      headScale: 0.11,
      beakSharp: true,
      serratedMargin: true,
      flipperSpan: 0.49,
      palette: "tortoiseshell",
      shellTint: [0.34, 0.18, 0.06], // Deep dark mahogany tortoiseshell with amber scutes
      skinTint: [0.88, 0.70, 0.34],  // Bright golden-amber flippers & head
      tint: [0.34, 0.18, 0.06],
      scuteType: "hawksbill",
    },
  };
  const TURTLE_KINDS = Object.keys(TURTLE_SHAPES);
  const TURTLE_TINTS = {};
  for (const k of TURTLE_KINDS) TURTLE_TINTS[k] = TURTLE_SHAPES[k].tint;

  const DEFAULT_TURTLES = [
    { kind: "loggerhead", size: 0.94 },
    { kind: "greenturtle", size: 0.90 },
    { kind: "hawksbill", size: 0.84 },
    { kind: "olive_ridley", size: 0.78 },
  ];

  class TurtleWorld {
    constructor(specs = DEFAULT_TURTLES) {
      this.specs = specs;
      this.width = 0;
      this.height = 0;
      this.time = 0;
      this.turtles = [];
      this.fish = [];
      this.events = [];
      this.pointer = { x: 0, y: 0, active: false };
      this.tmp = { x: 0, y: 0 };
    }

    resize(width, height) {
      const first = this.width === 0;
      this.width = width;
      this.height = height;
      if (first || this.turtles.length === 0) {
        this.seed();
        return;
      }
      for (const f of this.fish) {
        f.x = clamp(f.x, 0, width);
        f.y = clamp(f.y, 0, height);
      }
    }

    seed() {
      const { width: W, height: H } = this;
      const minSide = Math.min(W, H) || 600;
      const baseLen = clamp(minSide * 0.28, 140, 220);
      const count = this.specs.length;

      // Clear, purposeful straight-line oceanic transect headings (NO CIRCLES!)
      const baseHeadings = [
        0.18,              // Swimming East-Northeast (~10 deg)
        Math.PI - 0.22,    // Swimming West-Northwest (~167 deg)
        Math.PI * 0.52,    // Swimming South-Southeast (~94 deg)
        -Math.PI * 0.48,   // Swimming North-Northwest (~-86 deg)
      ];

      this.turtles = [];
      for (let i = 0; i < count; i++) {
        const spec = this.specs[i];
        const L = baseLen * (spec.size || 1.0);

        // Distribute spawn positions cleanly across screen quadrants
        const qx = (i % 2 === 0 ? W * 0.26 : W * 0.74) + rand(-W * 0.08, W * 0.08);
        const qy = (i < 2 ? H * 0.28 : H * 0.72) + rand(-H * 0.08, H * 0.08);
        const heading = baseHeadings[i % baseHeadings.length] + rand(-0.12, 0.12);

        const nodes = new Float32Array(TURTLE_NODES * 2);
        const seg = L / (TURTLE_NODES - 1);
        for (let k = 0; k < TURTLE_NODES; k++) {
          nodes[k * 2] = qx - Math.cos(heading) * seg * k;
          nodes[k * 2 + 1] = qy - Math.sin(heading) * seg * k;
        }

        this.turtles.push({
          id: i,
          kind: spec.kind,
          length: L,
          nodes,
          heading,
          targetHeading: heading, // Locked onto straight cruising path
          turn: 0,
          isTurning: false,
          turnCooldown: 0,
          destX: qx + Math.cos(heading) * 350,
          destY: qy + Math.sin(heading) * 350,
          openSpaceTimer: rand(6, 14),
          isPivoting: false,
          pivotDir: 1,
          pivotTimer: 0,
          pivotX: 0,
          pivotY: 0,
          isWaiting: false,
          waitTimer: 0,
          flipperLeftActivity: 1.0,
          flipperRightActivity: 1.0,
          targetLeft: 1.0,
          targetRight: 1.0,
          depth: rand(0.55, 0.95),
          phase: rand(0, TAU),
          strokeCycle: (i * (TAU / count)) + rand(0, 0.6), // Staggered swimming strokes!
          speed: 22,
          alarm: 0,
          fleeX: 0,
          fleeY: 0,
        });
      }

      // Small companion reef fish
      this.fish = [];
      const fishCount = clamp(Math.round((W * H) / 36000), 22, 55);
      for (let i = 0; i < fishCount; i++) {
        this.fish.push({
          x: rand(20, W - 20),
          y: rand(20, H - 20),
          vx: rand(-22, 22),
          vy: rand(-22, 22),
          size: rand(0.75, 1.3),
          depth: rand(0.35, 0.85),
          alarm: 0,
          turn: 0,
          escortId: i % this.turtles.length,
          escortSide: Math.random() < 0.5 ? -1 : 1,
          escortDist: rand(0.35, 0.85),
        });
      }
    }

    splash(x, y) {
      this.events.push({ kind: "pulse", x, y });
      for (const t of this.turtles) {
        const hx = t.nodes[0];
        const hy = t.nodes[1];
        const d = Math.hypot(hx - x, hy - y);
        if (d < t.length * 1.6 && d > 1e-3) {
          t.alarm = Math.max(t.alarm, clamp(1.4 - d / (t.length * 1.6), 0, 1.2));
          t.fleeX = x;
          t.fleeY = y;
        }
      }
    }

    getEmptiestOceanTarget(turtleIndex) {
      const { turtles, width: W, height: H } = this;
      const ti = turtles[turtleIndex];
      const hx = ti.nodes[0];
      const hy = ti.nodes[1];

      // Candidate waypoints distributed across open ocean avoiding boundary margin
      const candidates = [
        [W * 0.22, H * 0.24], [W * 0.50, H * 0.20], [W * 0.78, H * 0.24],
        [W * 0.20, H * 0.50], [W * 0.50, H * 0.50], [W * 0.80, H * 0.50],
        [W * 0.22, H * 0.76], [W * 0.50, H * 0.80], [W * 0.78, H * 0.76],
        [W * 0.35, H * 0.35], [W * 0.65, H * 0.35],
        [W * 0.35, H * 0.65], [W * 0.65, H * 0.65],
      ];

      let bestScore = -1e9;
      let bestTarget = [W * 0.5, H * 0.5];

      for (let c = 0; c < candidates.length; c++) {
        const [cx, cy] = candidates[c];
        let minOtherDist = 1e9;

        for (let j = 0; j < turtles.length; j++) {
          if (j === turtleIndex) continue;
          const tj = turtles[j];
          const dPos = Math.hypot(cx - tj.nodes[0], cy - tj.nodes[1]);
          const dDest = Math.hypot(cx - (tj.destX || tj.nodes[0]), cy - (tj.destY || tj.nodes[1]));

          // Heavy penalty if another turtle is already targeting or occupying this area
          const destPenalty = dDest < 260 ? 320 : 0;
          const effDist = Math.min(dPos, dDest) - destPenalty;
          if (effDist < minOtherDist) {
            minOtherDist = effDist;
          }
        }

        // Bearing penalty: encourage forward or sweeping natural turns rather than spinning backwards
        const bearing = Math.atan2(cy - hy, cx - hx);
        const turnDiff = Math.abs(angleDiff(ti.heading, bearing));
        const turnPenalty = (turnDiff / Math.PI) * 130;

        const score = minOtherDist - turnPenalty;
        if (score > bestScore) {
          bestScore = score;
          bestTarget = [cx, cy];
        }
      }

      ti.destX = bestTarget[0];
      ti.destY = bestTarget[1];
      return bestTarget;
    }

    step(dt) {
      this.time += dt;
      this.stepTurtles(dt);
      this.stepFish(dt);
    }

    stepTurtles(dt) {
      const { turtles, width: W, height: H, pointer } = this;
      const pad = 120; // Margin from screen boundaries for straight transect turns
      const N = turtles.length;

      // ── 1. PREDICTIVE LOOKAHEAD & MARITIME CROSSING (LONG RANGE 200..480px) ──
      // Early course correction during swimming with differential single-flipper paddling!
      // Rules:
      //  A. Head-on: both alter course to starboard (+0.25 rad) with left-flipper bias.
      //  B. Crossing: "la que esté por la izquierda cede el paso" — the turtle on the left
      //     yields and alters heading to pass behind; the turtle on the right maintains course.
      for (let i = 0; i < N; i++) {
        const ti = turtles[i];
        if (ti.turnCooldown > 0 || ti.isPivoting || ti.isWaiting) continue;
        const hxi = ti.nodes[0];
        const hyi = ti.nodes[1];
        const fxi = Math.cos(ti.heading);
        const fyi = Math.sin(ti.heading);
        const nxi = -fyi;
        const nyi = fxi;
        const spdi = Math.max(ti.speed, 20);

        for (let j = i + 1; j < N; j++) {
          const tj = turtles[j];
          if (tj.turnCooldown > 0 || tj.isPivoting || tj.isWaiting) continue;
          const hxj = tj.nodes[0];
          const hyj = tj.nodes[1];
          const fxj = Math.cos(tj.heading);
          const fyj = Math.sin(tj.heading);
          const spdj = Math.max(tj.speed, 20);

          const dx = hxj - hxi;
          const dy = hyj - hyi;
          const dist = Math.hypot(dx, dy);

          if (dist < 180 || dist > 480) continue;

          // Relative velocity vector: V_rel = V_i - V_j
          const vxi = fxi * spdi;
          const vyi = fyi * spdi;
          const vxj = fxj * spdj;
          const vyj = fyj * spdj;
          const rvx = vxi - vxj;
          const rvy = vyi - vyj;
          const rv2 = rvx * rvx + rvy * rvy;
          if (rv2 < 10) continue;

          // Time to closest point of approach (t_cpa)
          const tCpa = (dx * rvx + dy * rvy) / rv2;
          if (tCpa <= 0.8 || tCpa >= 5.5) continue; // Not approaching or too far in future

          // Distance at closest approach (d_cpa)
          const cpaDist = Math.hypot(dx - rvx * tCpa, dy - rvy * tCpa);
          const collisionRange = (ti.length + tj.length) * 0.65;
          if (cpaDist >= collisionRange) continue; // Paths clear safely

          // Paths will intersect!
          const headingDot = fxi * fxj + fyi * fyj;

          if (headingDot < -0.55) {
            // ── CASE A: HEAD-ON ENCOUNTER (Van de frente) ──
            // Both turtles steer towards open ocean, biasing single-flipper turn:
            const toCenterXi = (W * 0.5) - hxi;
            const toCenterYi = (H * 0.5) - hyi;
            const centerAngleI = Math.atan2(toCenterYi, toCenterXi);
            const inSignI = angleDiff(ti.heading, centerAngleI) >= 0 ? 1 : -1;
            ti.targetHeading = ti.heading + inSignI * 0.22;
            ti.targetLeft = inSignI > 0 ? 1.0 : 0.40;
            ti.targetRight = inSignI > 0 ? 0.40 : 1.0;
            ti.isTurning = true;
            ti.turnCooldown = 4.5;

            const toCenterXj = (W * 0.5) - hxj;
            const toCenterYj = (H * 0.5) - hyj;
            const centerAngleJ = Math.atan2(toCenterYj, toCenterXj);
            const inSignJ = angleDiff(tj.heading, centerAngleJ) >= 0 ? 1 : -1;
            tj.targetHeading = tj.heading + inSignJ * 0.22;
            tj.targetLeft = inSignJ > 0 ? 1.0 : 0.40;
            tj.targetRight = inSignJ > 0 ? 0.40 : 1.0;
            tj.isTurning = true;
            tj.turnCooldown = 4.5;
          } else {
            // ── CASE B: CROSSING TRAJECTORIES (Se van a cruzar) ──
            // User rule: "la que esté por la izquierda sea la que debe ceder el paso"
            const sideI = dx * nxi + dy * nyi; // > 0 means tj is to the left of ti
            if (sideI > 0) {
              // tj is to the left of ti -> tj MUST YIELD and pass behind ti
              tj.targetHeading = tj.heading - 0.28;
              tj.targetLeft = 0.40;
              tj.targetRight = 1.0;
              tj.isTurning = true;
              tj.turnCooldown = 4.5;
            } else {
              // ti is to the left of tj -> ti MUST YIELD and pass behind tj
              ti.targetHeading = ti.heading - 0.28;
              ti.targetLeft = 0.40;
              ti.targetRight = 1.0;
              ti.isTurning = true;
              ti.turnCooldown = 4.5;
            }
          }
        }
      }

      // ── 1b. TANDEM DISSOLUTION & SLIPSTREAM PEEL-OFF (SEEKING OPEN OCEAN) ──
      // User rule: "eviten estar mucho rato juntas, q se crucen no pasa nada, pero q vayan juntas tampoco"
      // If two turtles swim in the same general direction (headingDot > 0.40) within 240px:
      //  A. Slipstream trailing ("una conducia a la otra"): follower peels off to open water.
      //  B. Side-by-side: fan apart into separate open sectors.
      for (let i = 0; i < N; i++) {
        const ti = turtles[i];
        if (ti.isPivoting || ti.isWaiting) continue;
        const hxi = ti.nodes[0];
        const hyi = ti.nodes[1];
        const fxi = Math.cos(ti.heading);
        const fyi = Math.sin(ti.heading);
        const nxi = -fyi;
        const nyi = fxi;

        for (let j = i + 1; j < N; j++) {
          const tj = turtles[j];
          if (tj.isPivoting || tj.isWaiting) continue;
          const hxj = tj.nodes[0];
          const hyj = tj.nodes[1];
          const fxj = Math.cos(tj.heading);
          const fyj = Math.sin(tj.heading);

          const dx = hxj - hxi;
          const dy = hyj - hyi;
          const dist = Math.hypot(dx, dy);
          if (dist > 240) continue;

          const headingDot = fxi * fxj + fyi * fyj;
          if (headingDot <= 0.40) continue; // Crossing or diverging paths are completely natural ("q se crucen no pasa nada")

          // Relative longitudinal & lateral coordinates in ti's frame
          const fwdI = dx * fxi + dy * fyi;
          const latI = dx * nxi + dy * nyi; // > 0 means tj is to the left of ti

          if (fwdI > 30 && Math.abs(latI) < 70) {
            // CASE A1: ti is trailing directly behind tj ("slipstream tailgating")
            // Follower ti must peel off towards open water
            if (ti.turnCooldown <= 0) {
              const peelDir = latI >= 0 ? -1 : 1;
              ti.targetHeading = ti.heading + peelDir * 0.44;
              ti.targetLeft = peelDir > 0 ? 1.0 : 0.40;
              ti.targetRight = peelDir > 0 ? 0.40 : 1.0;
              ti.isTurning = true;
              ti.turnCooldown = 3.5;
            }
          } else if (fwdI < -30 && Math.abs(latI) < 70) {
            // CASE A2: tj is trailing directly behind ti
            // Follower tj must peel off towards open water
            if (tj.turnCooldown <= 0) {
              const nxj = -fyj;
              const nyj = fxj;
              const latJ = (-dx) * nxj + (-dy) * nyj;
              const peelDir = latJ >= 0 ? -1 : 1;
              tj.targetHeading = tj.heading + peelDir * 0.44;
              tj.targetLeft = peelDir > 0 ? 1.0 : 0.40;
              tj.targetRight = peelDir > 0 ? 0.40 : 1.0;
              tj.isTurning = true;
              tj.turnCooldown = 3.5;
            }
          } else {
            // CASE B: Side-by-side or oblique parallel cruise
            // Fan apart smoothly: ti turns right/left away from tj, tj turns opposite
            const peel = 0.38;
            if (latI >= 0) {
              // tj is to the left: ti steers right, tj steers left
              if (ti.turnCooldown <= 0) {
                ti.targetHeading = ti.heading - peel;
                ti.targetLeft = 0.40;
                ti.targetRight = 1.0;
                ti.isTurning = true;
                ti.turnCooldown = 3.0;
              }
              if (tj.turnCooldown <= 0) {
                tj.targetHeading = tj.heading + peel;
                tj.targetLeft = 1.0;
                tj.targetRight = 0.40;
                tj.isTurning = true;
                tj.turnCooldown = 3.0;
              }
            } else {
              // tj is to the right: ti steers left, tj steers right
              if (ti.turnCooldown <= 0) {
                ti.targetHeading = ti.heading + peel;
                ti.targetLeft = 1.0;
                ti.targetRight = 0.40;
                ti.isTurning = true;
                ti.turnCooldown = 3.0;
              }
              if (tj.turnCooldown <= 0) {
                tj.targetHeading = tj.heading - peel;
                tj.targetLeft = 0.40;
                tj.targetRight = 1.0;
                tj.isTurning = true;
                tj.turnCooldown = 3.0;
              }
            }
          }
        }
      }

      // ── 2. INDIVIDUAL TURTLE NAVIGATION & PROTOCOL ──
      for (let i = 0; i < N; i++) {
        const t = turtles[i];
        const nodes = t.nodes;
        const L = t.length;
        const hx = nodes[0];
        const hy = nodes[1];

        t.turnCooldown -= dt;

        // Boundary detection: Initiate a smooth turn towards the emptiest open ocean sector!
        const nearEdge = (hx < pad || hx > W - pad || hy < pad || hy > H - pad);
        if (nearEdge && t.turnCooldown <= 0 && !t.isTurning && !t.isPivoting && !t.isWaiting) {
          const [targetX, targetY] = this.getEmptiestOceanTarget(i);
          t.targetHeading = Math.atan2(targetY - hy, targetX - hx) + rand(-0.08, 0.08);
          t.isTurning = true;
          t.turnCooldown = 5.0;
        }

        // Periodic open ocean exploration: seek out unpopulated "espacios en blanco"
        t.openSpaceTimer -= dt;
        if (t.openSpaceTimer <= 0 && !nearEdge && !t.isTurning && !t.isPivoting && !t.isWaiting && t.turnCooldown <= 0) {
          const [targetX, targetY] = this.getEmptiestOceanTarget(i);
          const newHeading = Math.atan2(targetY - hy, targetX - hx);
          // Only adjust if it's a calm bearing correction (< 65 deg) to keep cruising paths straight
          if (Math.abs(angleDiff(t.heading, newHeading)) < 1.15) {
            t.targetHeading = newHeading;
            t.isTurning = true;
            t.turnCooldown = 4.5;
          }
          t.openSpaceTimer = rand(14, 22);
        }

        // Click splash fleeing response
        if (t.alarm > 0.02) {
          t.alarm *= Math.exp(-dt * 1.5);
          const fx = hx - t.fleeX;
          const fy = hy - t.fleeY;
          t.targetHeading = Math.atan2(fy, fx);
          t.isTurning = true;
          t.isPivoting = false;
          t.isWaiting = false;
          t.pivotTimer = 0;
          t.targetLeft = 1.0;
          t.targetRight = 1.0;
        }

        // Pointer avoidance
        if (pointer.active) {
          const pdx = hx - pointer.x;
          const pdy = hy - pointer.y;
          const pd = Math.hypot(pdx, pdy);
          if (pd < L * 0.85 + 45 && pd > 1e-3) {
            t.targetHeading = Math.atan2(pdy, pdx);
            t.isTurning = true;
          }
        }

        // ── 3. CLOSE-QUARTERS DETECTION WITH HYSTERESIS & DEBOUNCE ──
        const fx = Math.cos(t.heading);
        const fy = Math.sin(t.heading);
        const nx = -fy;
        const ny = fx;

        // Danger reach: threshold to enter close avoidance / pivot
        const dangerReach = L * 0.82 + 18;
        const dangerHalfWidth = L * 0.35 + 10;
        // Clear reach: threshold with hysteresis to exit pivot or waiting
        const clearReach = L * 0.98 + 22;
        const clearHalfWidth = L * 0.38 + 15;

        let obstacleDetected = false;
        let blockLat = 0;
        let blockOther = null;

        for (let j = 0; j < N; j++) {
          if (i === j) continue;
          const other = turtles[j];

          for (const idx of [0, 6, 12]) {
            const px = other.nodes[idx * 2];
            const py = other.nodes[idx * 2 + 1];
            const dx = px - hx;
            const dy = py - hy;
            const fwd = dx * fx + dy * fy;
            const lat = dx * nx + dy * ny;

            const reachLimit = (t.isPivoting || t.isWaiting) ? clearReach : dangerReach;
            const widthLimit = (t.isPivoting || t.isWaiting) ? clearHalfWidth : dangerHalfWidth;

            if (fwd > 0 && fwd < reachLimit && Math.abs(lat) < widthLimit) {
              obstacleDetected = true;
              blockLat = lat;
              blockOther = other;
              break;
            }
          }
          if (obstacleDetected) break;
        }

        // ── 4. EDGE-TRAPPED PROTOCOL ("para afuera no puede ir, y para adentro está la otra") ──
        const edgeDist = Math.min(hx, W - hx, hy, H - hy);
        const isNearWall = edgeDist < 65; // ACTUALLY touching or very close to wall
        let isTrappedAtEdge = false;

        if (obstacleDetected && isNearWall && blockOther) {
          const otherEdgeDist = Math.min(
            blockOther.nodes[0], W - blockOther.nodes[0],
            blockOther.nodes[1], H - blockOther.nodes[1]
          );
          // Strict hierarchy: Only wait if THIS turtle is genuinely closer to the wall than the other
          if (edgeDist < otherEdgeDist - 12) {
            const desiredPivotDir = blockLat >= 0 ? -1 : 1;
            const testHeading = t.heading + desiredPivotDir * 0.40;
            const testX = hx + Math.cos(testHeading) * 75;
            const testY = hy + Math.sin(testHeading) * 75;
            const testEdgeDist = Math.min(testX, W - testX, testY, H - testY);

            // If turning away from obstacle points into or stays pinned to the boundary:
            if (testEdgeDist < 35 || testEdgeDist < edgeDist) {
              isTrappedAtEdge = true;
            }
          }
        }

        // Safety timeout: max 2.8s waiting so a turtle NEVER stays stuck forever!
        if (isTrappedAtEdge && t.waitTimer < 2.8) {
          t.isWaiting = true;
          t.waitTimer += dt;
          t.isPivoting = false;
          t.pivotTimer = 0;

          // The other turtle (in open water) MUST NOT WAIT; it steers away with wide clearance!
          if (blockOther) {
            blockOther.isWaiting = false;
            blockOther.waitTimer = 0;

            const otherFx = Math.cos(blockOther.heading);
            const otherFy = Math.sin(blockOther.heading);
            const otherNx = -otherFy;
            const otherNy = otherFx;
            const relX = hx - blockOther.nodes[0];
            const relY = hy - blockOther.nodes[1];
            const latFromOther = relX * otherNx + relY * otherNy;
            const passDir = latFromOther >= 0 ? -1 : 1;

            blockOther.targetHeading = blockOther.heading + passDir * 0.35;
            blockOther.isTurning = true;
            blockOther.turnCooldown = 3.0;
            blockOther.targetLeft = passDir > 0 ? 1.0 : 0.40;
            blockOther.targetRight = passDir > 0 ? 0.40 : 1.0;
            blockOther.speed = Math.max(blockOther.speed, 22);
          }
        } else {
          // If not trapped, or if wait timer exceeded 2.8s, break wait state and resume!
          if (t.isWaiting) {
            t.isWaiting = false;
            t.waitTimer = 0;
            t.targetLeft = 1.0;
            t.targetRight = 1.0;
            t.turnCooldown = 2.5;
            const [targetX, targetY] = this.getEmptiestOceanTarget(i);
            t.targetHeading = Math.atan2(targetY - hy, targetX - hx);
            t.isTurning = true;
          }
        }

        // ── 5. FLIPPER PIVOT / WAIT / CRUISE STATE MACHINE ──
        if (t.isWaiting) {
          // Pinned turtle waits calmly, flippers relaxed, speed smoothly drops to 0
          t.speed = Math.max(0, t.speed - dt * 32);
          t.strokeCycle += dt * 0.35;
          t.targetLeft = 0.20;
          t.targetRight = 0.20;
          t.turn = 0;

          const moveFx = Math.cos(t.heading);
          const moveFy = Math.sin(t.heading);
          nodes[0] += moveFx * t.speed * dt;
          nodes[1] += moveFy * t.speed * dt;

          const seg = L / (TURTLE_NODES - 1);
          let prevAngle = t.heading + Math.PI;
          for (let k = 1; k < TURTLE_NODES; k++) {
            const px = nodes[(k - 1) * 2];
            const py = nodes[(k - 1) * 2 + 1];
            let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);
            const maxBend = k <= 1 ? 0.15 : (k <= 12 ? 0.038 : 0.14);
            angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);
            nodes[k * 2] = px + Math.cos(angle) * seg;
            nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
            prevAngle = angle;
          }
        } else if (obstacleDetected && !t.isPivoting) {
          // Normal open-water avoidance: steer smoothly around the obstacle!
          t.isPivoting = true;
          t.pivotTimer = 2.0; // Commit to turning maneuver for 2.0s

          if (Math.abs(blockLat) < 12) {
            const toCenterX = (W * 0.5) - hx;
            const toCenterY = (H * 0.5) - hy;
            const toCenterLat = toCenterX * nx + toCenterY * ny;
            t.pivotDir = toCenterLat >= 0 ? 1 : -1;
          } else {
            t.pivotDir = blockLat >= 0 ? -1 : 1; // Steer AWAY from obstacle!
          }

          if (t.pivotDir > 0) {
            // Turning RIGHT: paddle with LEFT flipper, brake with RIGHT flipper!
            t.targetLeft = 1.0;
            t.targetRight = 0.15;
          } else {
            // Turning LEFT: paddle with RIGHT flipper, brake with LEFT flipper!
            t.targetLeft = 0.15;
            t.targetRight = 1.0;
          }
        }

        if (t.isPivoting) {
          t.pivotTimer -= dt;

          // 1. Angular turning rate: calm and stately (~10.3 deg/s, never fast!)
          const rotSpeed = 0.18; // ~10.3 deg/s
          const dTheta = t.pivotDir * rotSpeed * dt;
          t.heading += dTheta;
          t.targetHeading = t.heading;
          t.turn = dTheta / dt;

          // 2. Stroke cycle: paddling with single active flipper
          t.strokeCycle += dt * 1.5;
          const strokeCos = Math.cos(t.strokeCycle);

          // 3. User rule: "un giro no puede ser mas rapido que la velocidad punta, porque el giro es con una aleta,
          //    por lo que como maximo es la mitad, ya que hacia adelante usa dos."
          // Cruising peak speed was ~42 px/s, so single-flipper peak is strictly half (~20 px/s):
          const isPowerStroke = strokeCos > 0.05;
          const thrustPower = isPowerStroke ? Math.pow(strokeCos, 1.4) : 0;
          const turnBaseSpeed = 6 + L * 0.015;
          const turnPeakSpeed = turnBaseSpeed + 12; // max ~20 px/s
          const targetSpeed = turnBaseSpeed + thrustPower * (turnPeakSpeed - turnBaseSpeed);
          t.speed += (targetSpeed - t.speed) * Math.min(1, dt * 5.0);

          // 4. PURE FORWARD TRANSLATION ALONG HEADING — ZERO BACKWARD MOTION!
          const moveFx = Math.cos(t.heading);
          const moveFy = Math.sin(t.heading);
          nodes[0] += moveFx * t.speed * dt;
          nodes[1] += moveFy * t.speed * dt;

          // 5. Kinematic follow-the-leader spine: body naturally sweeps along the arc!
          const seg = L / (TURTLE_NODES - 1);
          let prevAngle = t.heading + Math.PI;
          for (let k = 1; k < TURTLE_NODES; k++) {
            const px = nodes[(k - 1) * 2];
            const py = nodes[(k - 1) * 2 + 1];
            let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);
            const maxBend = k <= 1 ? 0.15 : (k <= 12 ? 0.038 : 0.14);
            angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);
            nodes[k * 2] = px + Math.cos(angle) * seg;
            nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
            prevAngle = angle;
          }

          // Exit condition: timer expired AND forward path has opened up!
          if (t.pivotTimer <= 0 && !obstacleDetected) {
            t.isPivoting = false;
            t.targetLeft = 1.0;
            t.targetRight = 1.0;
            t.turnCooldown = 2.0; // Grace period before any new turn
          }
        } else if (!t.isWaiting) {
          // ── 6. REGULAR STRAIGHT-LINE CRUISING & PROPULSION ──
          const diff = angleDiff(t.heading, t.targetHeading);
          if (Math.abs(diff) > 0.02) {
            // Calm turn rate: max 0.16 * dt (~9 deg/s)
            const maxTurn = 0.16 * dt;
            const step = clamp(diff, -maxTurn, maxTurn);
            t.heading += step;
            t.turn = step / dt;
            // Trim flippers for turn
            if (step > 0.005) {
              t.targetLeft = 1.0;
              t.targetRight = 0.45;
            } else if (step < -0.005) {
              t.targetLeft = 0.45;
              t.targetRight = 1.0;
            } else {
              t.targetLeft = 1.0;
              t.targetRight = 1.0;
            }
          } else {
            t.heading = t.targetHeading;
            t.turn = 0;
            t.isTurning = false;
            t.targetLeft = 1.0;
            t.targetRight = 1.0;
          }

          t.strokeCycle += dt * (2.1 + (t.alarm > 0.1 ? 1.4 : 0));
          const strokeSin = Math.sin(t.strokeCycle);
          const strokeCos = Math.cos(t.strokeCycle);

          // Power stroke occurs during backward sweep & flipper contraction ("recoger las aletas"):
          // strokeCos > 0 is when the flipper sweeps backward towards the carapace.
          const isPowerStroke = strokeCos > 0.05;
          const thrustPower = isPowerStroke ? Math.pow(strokeCos, 1.4) : 0;

          // Low glide speed during recovery / expansion, surging forward when collecting flippers!
          const baseGlideSpeed = 8 + L * 0.02;
          const peakThrustSpeed = baseGlideSpeed + 34 + (t.alarm > 0.1 ? 16 : 0);
          const targetSpeed = baseGlideSpeed + thrustPower * (peakThrustSpeed - baseGlideSpeed);
          const accelRate = isPowerStroke ? 6.5 : 1.8;
          t.speed += (targetSpeed - t.speed) * Math.min(1, dt * accelRate);

          // Purely forward translation along heading
          const moveFx = Math.cos(t.heading);
          const moveFy = Math.sin(t.heading);
          nodes[0] += moveFx * t.speed * dt;
          nodes[1] += moveFy * t.speed * dt;

          // Kinematic follow-the-leader spine: zero lateral drift
          const seg = L / (TURTLE_NODES - 1);
          let prevAngle = t.heading + Math.PI;

          for (let k = 1; k < TURTLE_NODES; k++) {
            const px = nodes[(k - 1) * 2];
            const py = nodes[(k - 1) * 2 + 1];
            let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);

            const maxBend = k <= 1 ? 0.15 : (k <= 12 ? 0.038 : 0.14);
            angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);

            nodes[k * 2] = px + Math.cos(angle) * seg;
            nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
            prevAngle = angle;
          }
        }

        // ── 6. CONTINUOUS FLIPPER MUSCLE BLENDING (ZERO FLICKERING!) ──
        // Smoothly lerps activity to eliminate any sudden visual popping
        t.flipperLeftActivity += (t.targetLeft - t.flipperLeftActivity) * Math.min(1, dt * 5.0);
        t.flipperRightActivity += (t.targetRight - t.flipperRightActivity) * Math.min(1, dt * 5.0);
      }

      // ── 7. RIGID CARAPACE SEPARATION CUSHION (ZERO OVERLAP / "NUNCA SE COMEN") ──
      for (let i = 0; i < N; i++) {
        const ti = turtles[i];
        const cxi = ti.nodes[6 * 2];
        const cyi = ti.nodes[6 * 2 + 1];
        const radI = ti.length * 0.28;

        for (let j = i + 1; j < N; j++) {
          const tj = turtles[j];
          const cxj = tj.nodes[6 * 2];
          const cyj = tj.nodes[6 * 2 + 1];
          const radJ = tj.length * 0.28;

          const dx = cxj - cxi;
          const dy = cyj - cyi;
          const dist = Math.hypot(dx, dy) || 1e-3;
          const minDist = radI + radJ + 14; // Solid shell clearance

          if (dist < minDist) {
            const overlap = minDist - dist;
            const nx = dx / dist;
            const ny = dy / dist;

            // If one turtle is waiting, the moving turtle absorbs the displacement; otherwise share 50/50
            const pushI = tj.isWaiting ? 1.0 : (ti.isWaiting ? 0.0 : 0.5);
            const pushJ = ti.isWaiting ? 1.0 : (tj.isWaiting ? 0.0 : 0.5);

            for (let k = 0; k < TURTLE_NODES; k++) {
              ti.nodes[k * 2] -= nx * overlap * pushI;
              ti.nodes[k * 2 + 1] -= ny * overlap * pushI;
              tj.nodes[k * 2] += nx * overlap * pushJ;
              tj.nodes[k * 2 + 1] += ny * overlap * pushJ;
            }
          }
        }
      }
    }

    stepFish(dt) {
      const { fish, turtles, pointer, width: W, height: H, time, tmp: cur } = this;
      const calm = Math.exp(-dt * 0.8);
      for (const f of fish) {
        f.alarm *= calm;
        flowCurrent(f.x, f.y, time, cur);
        let ax = cur.x * 0.5 + (Math.random() - 0.5) * 30;
        let ay = cur.y * 0.5 + (Math.random() - 0.5) * 30 - f.vy * 0.5;

        if (f.escortId >= 0 && f.escortId < turtles.length && f.alarm < 0.3) {
          const t = turtles[f.escortId];
          const fx = Math.cos(t.heading);
          const fy = Math.sin(t.heading);
          const nx = -fy;
          const ny = fx;
          const tx = t.nodes[6] - fx * t.length * 0.1 + nx * f.escortSide * t.length * f.escortDist * 0.4;
          const ty = t.nodes[7] - fy * t.length * 0.1 + ny * f.escortSide * t.length * f.escortDist * 0.4;
          ax += (tx - f.x) * 1.6 + (fx * t.speed - f.vx) * 2.0;
          ay += (ty - f.y) * 1.6 + (fy * t.speed - f.vy) * 2.0;
        }

        if (pointer.active) {
          const dx = f.x - pointer.x;
          const dy = f.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < 130 && d > 1e-3) {
            const w = (1 - d / 130) ** 2;
            ax += (dx / d) * 850 * w;
            ay += (dy / d) * 850 * w;
            f.alarm = Math.max(f.alarm, w);
          }
        }

        const mPad = 32;
        if (f.x < mPad) ax += (mPad - f.x) * 5;
        else if (f.x > W - mPad) ax -= (f.x - (W - mPad)) * 5;
        if (f.y < mPad) ay += (mPad - f.y) * 5;
        else if (f.y > H - mPad) ay -= (f.y - (H - mPad)) * 5;

        const before = Math.atan2(f.vy, f.vx);
        f.vx += ax * dt;
        f.vy += ay * dt;
        const spd = Math.hypot(f.vx, f.vy) || 1;
        const maxSpd = 55 * (1 + f.alarm * 1.3);
        if (spd > maxSpd) {
          f.vx *= maxSpd / spd;
          f.vy *= maxSpd / spd;
        } else if (spd < 16) {
          f.vx *= 16 / spd;
          f.vy *= 16 / spd;
        }
        f.turn = angleDiff(before, Math.atan2(f.vy, f.vx)) / dt;
        f.x = clamp(f.x + f.vx * dt, -30, W + 30);
        f.y = clamp(f.y + f.vy * dt, -30, H + 30);
      }
    }
  }

  class TurtleRenderer extends BaseAsciiRenderer {
    constructor(canvas) {
      super(canvas, TURTLE_KINDS, TURTLE_TINTS);
      this.ambientGlyph = "·";
      this.spine = new Float32Array(TURTLE_NODES * 2);
      this.arc = new Float32Array(TURTLE_NODES);
      this.arcTotal = 1;
      this.curTurtle = null;
      this.curShape = TURTLE_SHAPES.loggerhead;
    }

    render(world, dt) {
      const { ctx, dpr, cols, ch } = this;
      if (cols === 0) return;
      const t = world.time;

      this.consumeEvents(world);
      this.rasterizeTurtles(world.turtles, t);
      this.depositWake(world);
      this.diffuse(dt);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.markAmbient(world.fish);
      this.drawDots();

      ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      this.drawHeat();
      this.drawAmbient();
      this.drawTurtleCells(t);
    }

    depositWake(world) {
      const { energy } = this;
      for (const f of world.fish) {
        const i = this.cellIndex(f.x, f.y);
        if (i >= 0) energy[i] = Math.min(1.5, energy[i] + 0.01 + f.alarm * 0.02);
      }
      for (const t of world.turtles) {
        const i = this.cellIndex(t.nodes[0], t.nodes[1]);
        if (i >= 0) energy[i] = Math.min(1.5, energy[i] + 0.035);

        // Power stroke deposits wake vortices at flipper tips during backward thrust
        const strokeCos = Math.cos(t.strokeCycle);
        if (strokeCos > 0.15) {
          const L = t.length;
          const fx = Math.cos(t.heading);
          const fy = Math.sin(t.heading);
          const nx = -fy;
          const ny = fx;
          const shape = TURTLE_SHAPES[t.kind] || TURTLE_SHAPES.loggerhead;
          const strokeSin = Math.sin(t.strokeCycle);
          const extension = (strokeSin < 0) ? (1.0 + 0.20 * (-strokeSin)) : (1.0 - 0.58 * Math.pow(strokeSin, 1.25));
          const span = L * (shape.flipperSpan || 0.49) * extension;
          const tipS = (0.22 + 0.10 + 0.28 * Math.pow(Math.max(0, strokeSin), 1.15)) * L;

          const leftAct = t.flipperLeftActivity ?? 1.0;
          const rightAct = t.flipperRightActivity ?? 1.0;

          // Left tip
          if (leftAct > 0.25) {
            const lx = t.nodes[0] - fx * tipS + nx * span;
            const ly = t.nodes[1] - fy * tipS + ny * span;
            const li = this.cellIndex(lx, ly);
            if (li >= 0) energy[li] = Math.min(1.6, energy[li] + 0.045 * strokeCos * leftAct);
          }

          // Right tip
          if (rightAct > 0.25) {
            const rx = t.nodes[0] - fx * tipS - nx * span;
            const ry = t.nodes[1] - fy * tipS - ny * span;
            const ri = this.cellIndex(rx, ry);
            if (ri >= 0) energy[ri] = Math.min(1.6, energy[ri] + 0.045 * strokeCos * rightAct);
          }
        }
      }
    }

    sampleTurtle(px, py) {
      const { spine, arc, curTurtle: t, curShape: shape } = this;
      const L = this.arcTotal;
      const N = TURTLE_NODES;

      let best = Infinity;
      let bestS = 0;
      let bestSign = 1;

      for (let k = 0; k < N - 1; k++) {
        const ax = spine[k * 2];
        const ay = spine[k * 2 + 1];
        const bx = spine[(k + 1) * 2];
        const by = spine[(k + 1) * 2 + 1];
        const abx = bx - ax;
        const aby = by - ay;
        const ab2 = abx * abx + aby * aby || 1e-6;
        const apx = px - ax;
        const apy = py - ay;
        const param = clamp((apx * abx + apy * aby) / ab2, 0, 1);
        const qx = ax + abx * param;
        const qy = ay + aby * param;
        const d2 = (px - qx) ** 2 + (py - qy) ** 2;
        if (d2 < best) {
          best = d2;
          const sAlong = (arc[k] + Math.sqrt(ab2) * param) / this.arcTotal;
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

      // ── 1. HEAD & BEAK (s from 0 to 0.18, lighter skin tint) ──
      if (s <= 0.18) {
        const headEnd = 0.13;
        if (s <= headEnd) {
          const pHead = s / headEnd; // 0 at snout tip, 1 at skull base
          let headW;
          if (shape.beakSharp) {
            headW = L * 0.075 * Math.sqrt(pHead) * (1 - 0.15 * pHead);
          } else {
            headW = L * (shape.headScale || 0.11) * Math.sin(Math.pow(pHead, 0.62) * Math.PI * 0.88);
          }
          if (a <= headW) {
            if (s >= 0.040 && s <= 0.078 && a >= headW * 0.58) {
              this.hitFlag = FLAG_EYE;
              this.hitShade = 0;
            } else {
              this.hitFlag = FLAG_MARK; // Head (lighter skin tint!)
              this.hitShade = 0.74 - 0.22 * (a / (headW || 1));
            }
            return true;
          }
        }
        // Neck connecting head to shell
        const neckW = L * 0.065;
        if (s > 0.09 && s <= 0.18 && a <= neckW) {
          this.hitFlag = FLAG_MARK; // Neck (lighter skin tint!)
          this.hitShade = 0.62;
          return true;
        }
      }

      // ── 2. CARAPACE / SHELL (s from 0.18 to 0.78, narrow streamlined dark dome) ──
      const shellStart = 0.18;
      const shellEnd = 0.78;
      let curShellHalfW = 0;
      if (s >= shellStart && s <= shellEnd) {
        const pShell = (s - shellStart) / (shellEnd - shellStart); // 0 at anterior nuchal notch, 1 at posterior
        // Broad, natural carapace dome
        const maxShellW = L * (shape.shellWidth || 0.30);

        let shellProf;
        if (shape.scuteType === "ridley") {
          shellProf = Math.sin(Math.pow(pShell, 0.72) * Math.PI);
        } else if (shape.scuteType === "loggerhead") {
          shellProf = Math.sin(Math.pow(pShell, 0.65) * Math.PI) * (1 - 0.18 * pShell);
        } else {
          // Green / Hawksbill: elegant elongated teardrop oval
          shellProf = Math.sin(Math.pow(pShell, 0.74) * Math.PI) * (1 - 0.14 * pShell);
        }

        let serration = 0;
        if (shape.serratedMargin && pShell > 0.65) {
          serration = 0.03 * Math.sin(pShell * 36) * ((pShell - 0.65) / 0.35);
        }

        const halfW = maxShellW * (shellProf + serration);
        curShellHalfW = halfW;
        if (a <= halfW) {
          const rShell = a / (halfW || 1); // 0 at spine ridge, 1 at outer rim

          // Vertebral ridge (keel)
          if (rShell < 0.10) {
            this.hitFlag = FLAG_RIDGE;
            this.hitShade = 0.95;
            return true;
          }

          // Marginal scutes rim
          if (rShell > 0.85) {
            this.hitFlag = FLAG_RIDGE;
            this.hitShade = 0.65;
            return true;
          }

          // Scute seams
          const scuteU = pShell * 4.6;
          const scuteV = rShell * 2.6;
          const du = Math.abs(scuteU - Math.round(scuteU));
          const dv = Math.abs(scuteV - Math.round(scuteV));
          if (Math.min(du, dv) < 0.09) {
            this.hitFlag = FLAG_RIDGE;
            this.hitShade = 0.85;
            return true;
          }

          // Hawksbill golden tortoiseshell marbling
          if (shape.scuteType === "hawksbill" && hash3(Math.round(scuteU), Math.round(scuteV), t.id) > 0.30) {
            this.hitFlag = FLAG_WHITE_SPOT;
            this.hitShade = 0.92;
            return true;
          }

          // Carapace body (uses dark shellTint!)
          this.hitFlag = FLAG_BODY;
          this.hitShade = 0.72 - rShell * 0.22;
          return true;
        }
      }

      // ── 3. ARTICULATED FRONT FLIPPERS (PECTORAL WINGS - Estiramiento y Encogimiento) ──
      const sShoulder = 0.22;
      const strokeSin = Math.sin(t.strokeCycle);
      const strokeCos = Math.cos(t.strokeCycle);
      const aMin = Math.max(L * 0.08, curShellHalfW * 0.96);

      // Smooth continuous flipper activity (0 = anchored brake, 1 = full power stroke):
      // bestSign > 0 is LEFT flipper; bestSign < 0 is RIGHT flipper.
      const isLeft = bestSign > 0;
      const activity = isLeft ? (t.flipperLeftActivity ?? 1.0) : (t.flipperRightActivity ?? 1.0);

      // Active stroke: reaches forward & stretches wide on recovery, pulls back & contracts on power stroke
      const activeExt = (strokeSin < 0) ? (1.0 + 0.20 * (-strokeSin)) : (1.0 - 0.58 * Math.pow(strokeSin, 1.25));
      const activeSweep = (strokeSin < 0) ? (-0.15 * (-strokeSin)) : (0.28 * Math.pow(strokeSin, 1.15));

      // Continuous interpolation between anchored flipper brake and active flapping:
      const extension = 0.48 + activity * (activeExt - 0.48);
      const strokeSweep = 0.10 + activity * (activeSweep - 0.10);

      // Banking into turns: outer flipper extends wider, inner flipper tucks/brakes
      const bank = clamp(t.turn * 1.1, -0.35, 0.35) * bestSign;
      const baseSpan = L * (shape.flipperSpan || 0.49);
      const curSpan = baseSpan * extension * (1 + bank * 0.35);
      const aMax = aMin + curSpan;

      if (a >= aMin && a <= aMax) {
        const spanProg = (a - aMin) / curSpan; // 0 at shoulder, 1 at wingtip

        // Natural hydrofoil backward sweep + stroke sweep
        const baseSweep = 0.10 * Math.pow(spanProg, 1.3);
        const sweepAmp = strokeSweep * Math.pow(spanProg, 1.1);

        // Blade lag: flexible wingtip flexes with water resistance
        const bladeLag = -0.06 * strokeCos * Math.pow(spanProg, 1.4);

        const flipperAxisS = sShoulder + baseSweep + sweepAmp + bladeLag;

        // Hydrodynamic tapered blade chord
        const flipperChord = 0.046 + 0.050 * Math.sin(spanProg * Math.PI) * (1 - 0.20 * spanProg);
        const ds = Math.abs(s - flipperAxisS);

        if (ds <= flipperChord) {
          this.hitFlag = FLAG_FIN; // Flippers (uses lighter skinTint!)
          // Dynamic shading: highlights the leading edge and blade curvature
          const edgeShade = 1 - (ds / flipperChord);
          this.hitShade = 0.60 + edgeShade * 0.18 - spanProg * 0.15 + strokeCos * 0.10 * spanProg;
          return true;
        }
      }

      // ── 4. REAR FLIPPERS (PELVIC STEERING RUDDERS) ──
      const rearRootS = 0.70;
      const rearMinA = Math.max(L * 0.05, curShellHalfW * 0.96);
      const rearMaxA = L * 0.28;
      if (a >= rearMinA && a <= rearMaxA && s >= 0.62 && s <= 0.94) {
        const rearSpanProg = (a - rearMinA) / (rearMaxA - rearMinA);
        // Tilts dynamically into turns like an airplane rudder!
        const rudderAngle = -t.turn * 0.45 * bestSign;
        const rearAxisS = rearRootS + rearSpanProg * 0.14 + rudderAngle * 0.08;
        const rearChord = 0.080 * (1 - 0.35 * rearSpanProg) + 0.02;
        if (Math.abs(s - rearAxisS) <= rearChord) {
          this.hitFlag = FLAG_FIN; // Rear flipper paddles (lighter skinTint)
          this.hitShade = 0.58 - rearSpanProg * 0.18;
          return true;
        }
      }

      // ── 5. SHORT TAIL ──
      if (s >= 0.76 && s <= 0.90) {
        const tailProg = (s - 0.76) / 0.14;
        const tailW = L * 0.030 * (1 - tailProg);
        if (a <= tailW) {
          this.hitFlag = FLAG_MARK; // Tail (lighter skinTint)
          this.hitShade = 0.55;
          return true;
        }
      }

      return false;
    }

    rasterizeTurtles(turtles, t) {
      const { cellFlag, cellShade, cellKey, cellDepth, cellKind, cols, rows, cw, ch, kinds } = this;
      cellFlag.fill(0);

      for (let mIdx = 0; mIdx < turtles.length; mIdx++) {
        const turtle = turtles[mIdx];
        this.curTurtle = turtle;
        const kindIndex = Math.max(0, kinds.indexOf(turtle.kind));
        this.curShape = TURTLE_SHAPES[turtle.kind] || TURTLE_SHAPES.loggerhead;

        const L = turtle.length;
        const spine = this.spine;
        const nodes = turtle.nodes;
        for (let k = 0; k < TURTLE_NODES * 2; k++) spine[k] = nodes[k];

        let acc = 0;
        this.arc[0] = 0;
        for (let k = 0; k < TURTLE_NODES - 1; k++) {
          const dx = spine[(k + 1) * 2] - spine[k * 2];
          const dy = spine[(k + 1) * 2 + 1] - spine[k * 2 + 1];
          acc += Math.hypot(dx, dy);
          this.arc[k + 1] = acc;
        }
        this.arcTotal = acc || turtle.length;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let k = 0; k < TURTLE_NODES; k++) {
          minX = Math.min(minX, spine[k * 2]);
          maxX = Math.max(maxX, spine[k * 2]);
          minY = Math.min(minY, spine[k * 2 + 1]);
          maxY = Math.max(maxY, spine[k * 2 + 1]);
        }
        const reach = L * ((this.curShape.flipperSpan || 0.52) * 1.45 + 0.12) + 24;
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
            const centerHit = this.sampleTurtle(x + cw / 2, y + ch / 2);
            if (!centerHit && this.hitDist > skipBeyond) continue;
            const flag = this.hitFlag;
            const shade = this.hitShade;
            const s = this.hitS;
            const v = this.hitV;

            let hits = centerHit ? 1 : 0;
            for (let k = 0; k < SUBSAMPLES.length; k += 2) {
              if (this.sampleTurtle(x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch)) hits++;
            }
            if (hits === 0) continue;
            const coverage = hits / 5;

            const i = r * cols + c;
            const key = (hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), turtle.id) * 4294967295) >>> 0;
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

    drawTurtleCells(t) {
      const { ctx, cols, rows, cw, ch, cellFlag, cellShade, cellKey, cellDepth, cellKind, kinds } = this;
      const HAWKSBILL_MARBLE_GLYPHS = "%#*@S";
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
        const dim = 0.85 + 0.15 * cellDepth[i];
        const kindName = kinds[cellKind[i]] || "loggerhead";
        const shape = TURTLE_SHAPES[kindName] || TURTLE_SHAPES.loggerhead;

        if (flag === FLAG_EDGE) {
          const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          const glyph = set[(key >>> 8) % set.length];
          const [sr, sg, sb] = shape.skinTint || shape.tint;
          ctx.fillStyle = `rgba(${Math.round(45 * sr)}, ${Math.round(50 * sg)}, ${Math.round(55 * sb)}, 0.65)`;
          ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
          continue;
        }

        if (flag === FLAG_WHITE_SPOT) {
          // Hawksbill golden tortoiseshell scute infill
          const lum = Math.round(225 * dim);
          ctx.fillStyle = `rgb(${Math.min(255, Math.round(lum * 1.15))}, ${Math.min(255, Math.round(lum * 0.82))}, ${Math.round(lum * 0.28)})`;
          ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
          const glyph = HAWKSBILL_MARBLE_GLYPHS[(key >>> 5) % HAWKSBILL_MARBLE_GLYPHS.length];
          ctx.fillStyle = "#3e2205";
          ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
          continue;
        }

        let lum;
        let glyph;
        let tr, tg, tb;

        if (flag === FLAG_EYE) {
          lum = 22;
          glyph = "o";
          [tr, tg, tb] = [1, 1, 1];
        } else if (flag === FLAG_RIDGE) {
          // Dark scute seams & vertebral keel
          lum = 42 * dim;
          glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
          [tr, tg, tb] = shape.shellTint || shape.tint;
        } else if (flag === FLAG_BODY) {
          // ── CARAPACE / SHELL (Distinctly darker armored dome as requested!) ──
          lum = (122 - shade * 38) * dim;
          const jitter = ((key >>> 4) % 3) - 1;
          glyph = SKIN_RAMP[clamp(Math.floor(shade * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
          [tr, tg, tb] = shape.shellTint || shape.tint;
        } else {
          // ── APPENDAGES: LARGE PROMINENT FLIPPERS & HEAD (Lighter, bright, highly recognizable!) ──
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

        let glyphColor;
        if (flag === FLAG_EYE) {
          glyphColor = "#ffffff";
        } else if (flag === FLAG_RIDGE) {
          glyphColor = "#fef08a"; // Soft golden scute seam line
        } else if (flag === FLAG_BODY) {
          // Subtle warm texture on dark shell
          glyphColor = `rgb(${Math.min(255, r + 55)}, ${Math.min(255, g + 55)}, ${Math.min(255, b + 45)})`;
        } else {
          // High contrast dark slate glyph text on lighter flippers & head
          glyphColor = `rgb(${Math.max(0, Math.round(r * 0.40))}, ${Math.max(0, Math.round(g * 0.40))}, ${Math.max(0, Math.round(b * 0.35))})`;
        }

        ctx.fillStyle = glyphColor;
        ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
      }
    }
  }

  class TurtleEngine extends BaseLoopEngine {
    constructor(canvas, specs) {
      const world = new TurtleWorld(specs);
      const renderer = new TurtleRenderer(canvas);
      super(canvas, world, renderer);
    }
  }



  return {
    TurtleEngine,
    TurtleWorld,
    TurtleRenderer,
    TURTLE_SHAPES,
    DEFAULT_TURTLES,
  };
});

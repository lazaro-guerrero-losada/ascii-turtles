import { TAU, clamp, rand, randInt, angleDiff, flowCurrent } from "./math";
import { TURTLE_NODES, DEFAULT_TURTLES, type TurtleSpec } from "./species";

export interface TurtleAgent {
  id: number;
  kind: string;
  length: number;
  nodes: Float32Array;
  heading: number;
  targetHeading: number;
  turn: number;
  isTurning: boolean;
  turnCooldown: number;
  destX: number;
  destY: number;
  openSpaceTimer: number;
  isPivoting: boolean;
  pivotDir: number;
  pivotTimer: number;
  pivotX: number;
  pivotY: number;
  isWaiting: boolean;
  waitTimer: number;
  flipperLeftActivity: number;
  flipperRightActivity: number;
  targetLeft: number;
  targetRight: number;
  depth: number;
  phase: number;
  strokeCycle: number;
  speed: number;
  alarm: number;
  fleeX: number;
  fleeY: number;
}

export interface FishAgent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  depth: number;
  alarm: number;
  turn: number;
  escortId: number;
  escortSide: number;
  escortDist: number;
}

export interface RippleEvent {
  kind: string;
  x: number;
  y: number;
}

export class TurtleWorld {
  specs: TurtleSpec[];
  width: number = 0;
  height: number = 0;
  time: number = 0;
  turtles: TurtleAgent[] = [];
  fish: FishAgent[] = [];
  events: RippleEvent[] = [];
  pointer = { x: 0, y: 0, active: false };
  tmp = { x: 0, y: 0 };

  constructor(specs: TurtleSpec[] = DEFAULT_TURTLES) {
    this.specs = specs;
  }

  resize(width: number, height: number) {
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

    const baseHeadings = [
      0.18,              // East-Northeast
      Math.PI - 0.22,    // West-Northwest
      Math.PI * 0.52,    // South-Southeast
      -Math.PI * 0.48,   // North-Northwest
    ];

    this.turtles = [];
    for (let i = 0; i < count; i++) {
      const spec = this.specs[i];
      const L = baseLen * (spec.size || 1.0);

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
        targetHeading: heading,
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
        strokeCycle: (i * (TAU / count)) + rand(0, 0.6),
        speed: 22,
        alarm: 0,
        fleeX: 0,
        fleeY: 0,
      });
    }

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

  splash(x: number, y: number) {
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

  getEmptiestOceanTarget(turtleIndex: number): [number, number] {
    const { turtles, width: W, height: H } = this;
    const ti = turtles[turtleIndex];
    const hx = ti.nodes[0];
    const hy = ti.nodes[1];

    const candidates = [
      [W * 0.20, H * 0.22], [W * 0.50, H * 0.18], [W * 0.80, H * 0.22],
      [W * 0.18, H * 0.50], [W * 0.50, H * 0.50], [W * 0.82, H * 0.50],
      [W * 0.20, H * 0.78], [W * 0.50, H * 0.82], [W * 0.80, H * 0.78],
      [W * 0.35, H * 0.35], [W * 0.65, H * 0.35],
      [W * 0.35, H * 0.65], [W * 0.65, H * 0.65],
    ];

    let bestScore = -1e9;
    let bestTarget: [number, number] = [W * 0.5, H * 0.5];

    for (let c = 0; c < candidates.length; c++) {
      const [cx, cy] = candidates[c];
      let minOtherDist = 1e9;

      for (let j = 0; j < turtles.length; j++) {
        if (j === turtleIndex) continue;
        const tj = turtles[j];
        const dPos = Math.hypot(cx - tj.nodes[0], cy - tj.nodes[1]);
        const dDest = Math.hypot(cx - tj.destX, cy - tj.destY);
        const destPenalty = dDest < 260 ? 300 : 0;
        const effDist = Math.min(dPos, dDest) - destPenalty;
        if (effDist < minOtherDist) minOtherDist = effDist;
      }

      const bearing = Math.atan2(cy - hy, cx - hx);
      const turnDiff = Math.abs(angleDiff(ti.heading, bearing));
      const turnPenalty = (turnDiff / Math.PI) * 140;

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

  step(dt: number) {
    this.time += dt;
    this.stepTurtles(dt);
    this.stepFish(dt);
  }

  stepTurtles(dt: number) {
    const { turtles, width: W, height: H, pointer } = this;
    const pad = 110;
    const N = turtles.length;

    // A. Maritime crossing lookahead
    for (let i = 0; i < N; i++) {
      const ti = turtles[i];
      if (ti.turnCooldown > 0 || ti.isPivoting || ti.isWaiting) continue;
      const hxi = ti.nodes[0], hyi = ti.nodes[1];
      const fxi = Math.cos(ti.heading), fyi = Math.sin(ti.heading);
      const nxi = -fyi, nyi = fxi;
      const spdi = Math.max(ti.speed, 18);

      for (let j = i + 1; j < N; j++) {
        const tj = turtles[j];
        if (tj.turnCooldown > 0 || tj.isPivoting || tj.isWaiting) continue;
        const hxj = tj.nodes[0], hyj = tj.nodes[1];
        const fxj = Math.cos(tj.heading), fyj = Math.sin(tj.heading);
        const spdj = Math.max(tj.speed, 18);

        const dx = hxj - hxi, dy = hyj - hyi;
        const dist = Math.hypot(dx, dy);
        if (dist < 120 || dist > 460) continue;

        const rvx = fxi * spdi - fxj * spdj;
        const rvy = fyi * spdi - fyj * spdj;
        const rv2 = rvx * rvx + rvy * rvy;
        if (rv2 < 10) continue;

        const tCpa = (dx * rvx + dy * rvy) / rv2;
        if (tCpa <= 0.8 || tCpa >= 5.0) continue;

        const cpaDist = Math.hypot(dx - rvx * tCpa, dy - rvy * tCpa);
        if (cpaDist >= (ti.length + tj.length) * 0.65) continue;

        const headingDot = fxi * fxj + fyi * fyj;
        if (headingDot < -0.55) {
          ti.targetHeading = ti.heading + 0.22;
          tj.targetHeading = tj.heading + 0.22;
          ti.isTurning = true; tj.isTurning = true;
          ti.turnCooldown = 4.0; tj.turnCooldown = 4.0;
        } else {
          const sideI = dx * nxi + dy * nyi;
          if (sideI > 0) {
            tj.targetHeading = tj.heading - 0.26;
            tj.isTurning = true; tj.turnCooldown = 4.0;
          } else {
            ti.targetHeading = ti.heading - 0.26;
            ti.isTurning = true; ti.turnCooldown = 4.0;
          }
        }
      }
    }

    // B. Tandem dissolution
    for (let i = 0; i < N; i++) {
      const ti = turtles[i];
      if (ti.isPivoting || ti.isWaiting) continue;
      const hxi = ti.nodes[0], hyi = ti.nodes[1];
      const fxi = Math.cos(ti.heading), fyi = Math.sin(ti.heading);
      const nxi = -fyi, nyi = fxi;

      for (let j = i + 1; j < N; j++) {
        const tj = turtles[j];
        if (tj.isPivoting || tj.isWaiting) continue;
        const dx = tj.nodes[0] - hxi, dy = tj.nodes[1] - hyi;
        const dist = Math.hypot(dx, dy);
        if (dist > 220) continue;

        const headingDot = fxi * Math.cos(tj.heading) + fyi * Math.sin(tj.heading);
        if (headingDot <= 0.40) continue;

        const latI = dx * nxi + dy * nyi;
        const peel = 0.38;
        if (latI >= 0) {
          if (ti.turnCooldown <= 0) { ti.targetHeading = ti.heading - peel; ti.isTurning = true; ti.turnCooldown = 3.0; }
          if (tj.turnCooldown <= 0) { tj.targetHeading = tj.heading + peel; tj.isTurning = true; tj.turnCooldown = 3.0; }
        } else {
          if (ti.turnCooldown <= 0) { ti.targetHeading = ti.heading + peel; ti.isTurning = true; ti.turnCooldown = 3.0; }
          if (tj.turnCooldown <= 0) { tj.targetHeading = tj.heading - peel; tj.isTurning = true; tj.turnCooldown = 3.0; }
        }
      }
    }

    // C. Kinematics & individual steering
    for (let i = 0; i < N; i++) {
      const t = turtles[i];
      const nodes = t.nodes;
      const L = t.length;
      const hx = nodes[0], hy = nodes[1];

      t.turnCooldown -= dt;

      // Wall avoidance
      const nearEdge = (hx < pad || hx > W - pad || hy < pad || hy > H - pad);
      if (nearEdge && t.turnCooldown <= 0 && !t.isTurning && !t.isWaiting && !t.isPivoting) {
        const [targetX, targetY] = this.getEmptiestOceanTarget(i);
        t.targetHeading = Math.atan2(targetY - hy, targetX - hx) + rand(-0.06, 0.06);
        t.isTurning = true;
        t.turnCooldown = 5.0;
      }

      // Open ocean exploration
      t.openSpaceTimer -= dt;
      if (t.openSpaceTimer <= 0 && !nearEdge && !t.isTurning && !t.isPivoting && t.turnCooldown <= 0) {
        const [targetX, targetY] = this.getEmptiestOceanTarget(i);
        const newHeading = Math.atan2(targetY - hy, targetX - hx);
        if (Math.abs(angleDiff(t.heading, newHeading)) < 1.15) {
          t.targetHeading = newHeading;
          t.isTurning = true;
          t.turnCooldown = 4.5;
        }
        t.openSpaceTimer = rand(12, 20);
      }

      // Pointer avoidance
      if (pointer.active) {
        const pdx = hx - pointer.x, pdy = hy - pointer.y;
        const pd = Math.hypot(pdx, pdy);
        if (pd < L * 0.85 + 40 && pd > 1e-3) {
          t.targetHeading = Math.atan2(pdy, pdx);
          t.isTurning = true;
        }
      }

      // Smooth turning
      const diff = angleDiff(t.heading, t.targetHeading);
      if (Math.abs(diff) > 0.02) {
        const maxTurn = 0.16 * dt;
        const step = clamp(diff, -maxTurn, maxTurn);
        t.heading += step;
        t.turn = step / dt;
        if (step > 0.005) { t.targetLeft = 1.0; t.targetRight = 0.45; }
        else if (step < -0.005) { t.targetLeft = 0.45; t.targetRight = 1.0; }
      } else {
        t.heading = t.targetHeading;
        t.turn = 0;
        t.isTurning = false;
        t.targetLeft = 1.0;
        t.targetRight = 1.0;
      }

      // Locomotion & flipper stroke
      t.strokeCycle += dt * (2.1 + (t.alarm > 0.1 ? 1.4 : 0));
      const strokeCos = Math.cos(t.strokeCycle);
      const isPowerStroke = strokeCos > 0.05;
      const thrustPower = isPowerStroke ? Math.pow(strokeCos, 1.4) : 0;
      const baseGlide = 8 + L * 0.02;
      const peakThrust = baseGlide + 32;
      const targetSpeed = baseGlide + thrustPower * (peakThrust - baseGlide);
      t.speed += (targetSpeed - t.speed) * Math.min(1, dt * (isPowerStroke ? 6.5 : 1.8));
      t.flipperLeftActivity += (t.targetLeft - t.flipperLeftActivity) * Math.min(1, dt * 5.0);
      t.flipperRightActivity += (t.targetRight - t.flipperRightActivity) * Math.min(1, dt * 5.0);

      nodes[0] += Math.cos(t.heading) * t.speed * dt;
      nodes[1] += Math.sin(t.heading) * t.speed * dt;

      // Kinematic follow spine
      const seg = L / (TURTLE_NODES - 1);
      let prevAngle = t.heading + Math.PI;
      for (let k = 1; k < TURTLE_NODES; k++) {
        const px = nodes[(k - 1) * 2], py = nodes[(k - 1) * 2 + 1];
        let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);
        const maxBend = k <= 1 ? 0.15 : (k <= 9 ? 0.038 : 0.14);
        angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);
        nodes[k * 2] = px + Math.cos(angle) * seg;
        nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
        prevAngle = angle;
      }
    }

    // D. Rigid Carapace separation
    for (let i = 0; i < N; i++) {
      const ti = turtles[i];
      const cxi = ti.nodes[5 * 2], cyi = ti.nodes[5 * 2 + 1];
      const radI = ti.length * 0.28;

      for (let j = i + 1; j < N; j++) {
        const tj = turtles[j];
        const cxj = tj.nodes[5 * 2], cyj = tj.nodes[5 * 2 + 1];
        const radJ = tj.length * 0.28;

        const dx = cxj - cxi, dy = cyj - cyi;
        const dist = Math.hypot(dx, dy) || 1e-3;
        const minDist = radI + radJ + 16;
        if (dist < minDist) {
          const overlap = minDist - dist;
          const nx = dx / dist, ny = dy / dist;
          for (let k = 0; k < TURTLE_NODES; k++) {
            ti.nodes[k * 2] -= nx * overlap * 0.5;
            ti.nodes[k * 2 + 1] -= ny * overlap * 0.5;
            tj.nodes[k * 2] += nx * overlap * 0.5;
            tj.nodes[k * 2 + 1] += ny * overlap * 0.5;
          }
        }
      }
    }
  }

  stepFish(dt: number) {
    const { fish, turtles, pointer, width: W, height: H } = this;
    if (fish.length === 0) return;
    const ptrActive = pointer.active;
    const px = pointer.x, py = pointer.y;

    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      if (f.escortId >= 0 && f.escortId < turtles.length && f.alarm < 0.3) {
        const t = turtles[f.escortId];
        const lead = t.length * f.escortDist;
        const side = t.length * 0.38 * f.escortSide;
        const fx = Math.cos(t.heading), fy = Math.sin(t.heading);
        const tx = t.nodes[0] - fx * lead - fy * side;
        const ty = t.nodes[1] - fy * lead + fx * side;
        f.vx += (tx - f.x) * dt * 2.8;
        f.vy += (ty - f.y) * dt * 2.8;
      }

      if (ptrActive) {
        const dx = f.x - px, dy = f.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < 14400 && d2 > 1e-3) {
          const d = Math.sqrt(d2);
          const str = (1 - d / 120) * 160;
          f.vx += (dx / d) * str;
          f.vy += (dy / d) * str;
          f.alarm = 1.0;
        }
      }

      f.alarm = Math.max(0, f.alarm - dt * 0.9);
      const spd = Math.hypot(f.vx, f.vy);
      const maxSpd = 35 + f.alarm * 70;
      if (spd > maxSpd) {
        f.vx = (f.vx / spd) * maxSpd;
        f.vy = (f.vy / spd) * maxSpd;
      }

      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= Math.pow(0.85, dt * 60);
      f.vy *= Math.pow(0.85, dt * 60);

      const margin = 15;
      if (f.x < margin) { f.x = margin; f.vx = Math.abs(f.vx) * 0.8; }
      else if (f.x > W - margin) { f.x = W - margin; f.vx = -Math.abs(f.vx) * 0.8; }
      if (f.y < margin) { f.y = margin; f.vy = Math.abs(f.vy) * 0.8; }
      else if (f.y > H - margin) { f.y = H - margin; f.vy = -Math.abs(f.vy) * 0.8; }
    }
  }
}

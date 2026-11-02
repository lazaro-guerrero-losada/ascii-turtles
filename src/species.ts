export interface TurtleShape {
  carapaceRatio: number;
  shellWidth: number;
  headScale: number;
  beakSharp: boolean;
  serratedMargin?: boolean;
  flipperSpan: number;
  palette: string;
  shellTint: [number, number, number];
  skinTint: [number, number, number];
  tint: [number, number, number];
  scuteType: "loggerhead" | "green" | "ridley" | "hawksbill";
}

export interface TurtleSpec {
  kind: string;
  size?: number;
}

export const TURTLE_NODES = 16;

export const TURTLE_SHAPES: Record<string, TurtleShape> = {
  loggerhead: {
    carapaceRatio: 0.62,
    shellWidth: 0.31,
    headScale: 0.12,
    beakSharp: false,
    flipperSpan: 0.49,
    palette: "reddish_brown",
    shellTint: [0.42, 0.18, 0.08], // Deep dark burnt terracotta shell
    skinTint: [0.90, 0.70, 0.40],  // Light warm golden-tan flippers & head
    tint: [0.42, 0.18, 0.08],
    scuteType: "loggerhead",
  },
  greenturtle: {
    carapaceRatio: 0.65,
    shellWidth: 0.29,
    headScale: 0.11,
    beakSharp: false,
    flipperSpan: 0.52,
    palette: "olive_green",
    shellTint: [0.15, 0.30, 0.12], // Deep dark forest / pine-olive shell
    skinTint: [0.55, 0.78, 0.45],  // Luminous light sage-jade flippers & head
    tint: [0.15, 0.30, 0.12],
    scuteType: "green",
  },
  olive_ridley: {
    carapaceRatio: 0.58,
    shellWidth: 0.33,
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
    shellWidth: 0.28,
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

export const TURTLE_KINDS = Object.keys(TURTLE_SHAPES);

export const TURTLE_TINTS: Record<string, [number, number, number]> = {};
for (const k of TURTLE_KINDS) TURTLE_TINTS[k] = TURTLE_SHAPES[k].tint;

export const DEFAULT_TURTLES: TurtleSpec[] = [
  { kind: "loggerhead", size: 0.94 },
  { kind: "greenturtle", size: 0.90 },
  { kind: "hawksbill", size: 0.84 },
  { kind: "olive_ridley", size: 0.78 },
];

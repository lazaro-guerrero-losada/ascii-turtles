import { TurtleEngine, TURTLE_KINDS, type TurtleSpec } from "./src";

declare global {
  interface Window {
    __TURTLE_DEMO__?: boolean;
  }
}

if (!window.__TURTLE_DEMO__) {
  window.__TURTLE_DEMO__ = true;
  const kinds = new URLSearchParams(location.search).get("turtles")?.split(",").filter(Boolean);
  const turtles: TurtleSpec[] | undefined = kinds?.map((kind, i) => ({
    kind: TURTLE_KINDS.includes(kind) ? kind : "loggerhead",
    size: 1 - i * 0.1,
  }));

  const canvas = document.querySelector<HTMLCanvasElement>("canvas");
  if (canvas) {
    new TurtleEngine(canvas, turtles);
  }
}

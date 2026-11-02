"use client";

import { useEffect, useRef } from "react";
import { TurtleEngine } from "./engine";
import type { TurtleSpec } from "./species";

/** Glyphs come from the canvas's font-family, so give it (or a parent) a monospace font. */
export function AsciiTurtles({ className, turtles }: { className?: string; turtles?: TurtleSpec[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new TurtleEngine(canvas, turtles);
    return () => engine.destroy();
    // The roster is fixed for the life of the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={`ascii-turtles ${className ?? ""}`} />;
}

import { sleep, humanDelay } from "./timing";

type Point = { x: number; y: number };

export async function humanMouse(from: Point, to: Point, el: Element): Promise<void> {
  const steps = 10 + Math.floor(Math.random() * 8);
  const ctrl1: Point = {
    x: from.x + (to.x - from.x) * 0.3 + jitter(40),
    y: from.y + (to.y - from.y) * 0.3 + jitter(40),
  };
  const ctrl2: Point = {
    x: from.x + (to.x - from.x) * 0.7 + jitter(40),
    y: from.y + (to.y - from.y) * 0.7 + jitter(40),
  };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = bezier(from, ctrl1, ctrl2, to, t);
    el.dispatchEvent(new MouseEvent("mousemove", { clientX: p.x, clientY: p.y, bubbles: true }));
    await sleep(humanDelay(15, 0.7));
  }
}

function bezier(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y,
  };
}

function jitter(amt: number): number {
  return (Math.random() - 0.5) * amt;
}

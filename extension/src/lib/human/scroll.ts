import { sleep, humanDelay } from "./timing";

export async function humanScroll(el: Element | Window, deltaY: number): Promise<void> {
  const steps = 8;
  const per = deltaY / steps;
  for (let i = 0; i < steps; i++) {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: per, bubbles: true }));
    if (el === window || el instanceof Window) {
      window.scrollBy(0, per);
    } else {
      (el as Element).scrollBy?.(0, per);
    }
    await sleep(humanDelay(40));
  }
}

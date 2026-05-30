import { humanDelay, sleep, uniform } from "./timing";

const TYPO_CHANCE = 0.05;
const KEYBOARD_NEIGHBORS: Record<string, string> = {
  a: "sq", s: "ad", d: "sf", f: "dg", g: "fh", h: "gj", j: "hk", k: "jl", l: "k",
  q: "wa", w: "qe", e: "wr", r: "et", t: "ry", y: "tu", u: "yi", i: "uo", o: "ip", p: "o",
  z: "xa", x: "zc", c: "xv", v: "cb", b: "vn", n: "bm", m: "n",
};

export async function humanType(el: HTMLElement, text: string): Promise<void> {
  await focusEl(el);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (Math.random() < TYPO_CHANCE && KEYBOARD_NEIGHBORS[ch.toLowerCase()]) {
      const wrong = pickChar(KEYBOARD_NEIGHBORS[ch.toLowerCase()]);
      await insertChar(el, wrong);
      await sleep(humanDelay(120));
      await deleteChar(el);
      await sleep(humanDelay(80));
    }
    await insertChar(el, ch);
    await sleep(humanDelay(100));
    if (ch === " " && Math.random() < 0.15) await sleep(uniform(200, 800));
  }
}

function pickChar(s: string): string {
  return s[Math.floor(Math.random() * s.length)];
}

async function focusEl(el: HTMLElement): Promise<void> {
  el.focus();
  await sleep(humanDelay(60));
}

async function insertChar(el: HTMLElement, ch: string): Promise<void> {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.value += ch;
    el.dispatchEvent(new InputEvent("input", { data: ch, inputType: "insertText", bubbles: true }));
  } else if (el.isContentEditable) {
    document.execCommand("insertText", false, ch);
  }
}

async function deleteChar(el: HTMLElement): Promise<void> {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.value = el.value.slice(0, -1);
    el.dispatchEvent(new InputEvent("input", { inputType: "deleteContentBackward", bubbles: true }));
  } else if (el.isContentEditable) {
    document.execCommand("delete");
  }
}

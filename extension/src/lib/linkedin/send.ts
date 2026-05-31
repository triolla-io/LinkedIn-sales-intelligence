import { humanPause, sleep } from "../human/timing";

// LinkedIn's messaging compose page accepts a profile URL as recipient
// This bypasses the profile page DOM entirely
export function getComposeUrl(linkedinUrl: string): string {
  return `https://www.linkedin.com/messaging/compose/?to=${encodeURIComponent(linkedinUrl)}`;
}

export async function sendMessage(text: string): Promise<{ sentAt: string; conversationUrl: string }> {
  if (location.href.includes("/checkpoint/")) {
    throw withCode(new Error("LinkedIn checkpoint detected"), "checkpoint");
  }

  await humanPause(2000, 4000);

  // Find the compose input — LinkedIn messaging page uses an <input> element
  const composeInput = await waitForInput(8_000);
  if (!composeInput) throw withCode(new Error("Compose input not found"), "selector_missing");

  // Type text into the React-controlled input
  await typeIntoInput(composeInput, text);
  await sleep(800);

  // Find and click send
  const sendBtn = await waitForSendButton(5_000);
  if (!sendBtn) throw withCode(new Error("Send button not found"), "selector_missing");
  if (sendBtn.disabled || sendBtn.getAttribute("aria-disabled") === "true") {
    throw withCode(new Error("Send button disabled — text did not enter input"), "selector_missing");
  }

  sendBtn.click();
  await humanPause(1500, 2500);
  return { sentAt: new Date().toISOString(), conversationUrl: location.href };
}

async function typeIntoInput(input: HTMLInputElement, text: string): Promise<void> {
  input.focus();
  await sleep(200);

  // React input: use nativeInputValueSetter to bypass React's synthetic event proxy
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (nativeSetter) {
    nativeSetter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(300);
    if (input.value === text) return;
  }

  // Fallback: execCommand
  input.select();
  document.execCommand("insertText", false, text);
  await sleep(200);

  // Last resort: direct value set
  if (!input.value) {
    input.value = text;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

async function waitForInput(timeoutMs: number): Promise<HTMLInputElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Look for the message compose input by common aria-labels and placeholders
    const candidates = Array.from(document.querySelectorAll("input")) as HTMLInputElement[];
    for (const input of candidates) {
      const r = input.getBoundingClientRect();
      const label = (input.getAttribute("aria-label") ?? "").toLowerCase();
      const placeholder = (input.placeholder ?? "").toLowerCase();
      const isVisible = r.height > 10 && r.width > 100;
      const isCompose = label.includes("message") || label.includes("write") || label.includes("type") ||
        placeholder.includes("message") || placeholder.includes("write") || placeholder.includes("type") ||
        label.includes("הקלד") || placeholder.includes("הקלד");
      if (isVisible && isCompose) return input;
    }
    // Fallback: any visible input that's not search
    for (const input of candidates) {
      const r = input.getBoundingClientRect();
      const label = (input.getAttribute("aria-label") ?? "").toLowerCase();
      const placeholder = (input.placeholder ?? "").toLowerCase();
      const isSearch = label.includes("search") || placeholder.includes("search");
      if (r.height > 10 && r.width > 100 && !isSearch) return input;
    }
    await sleep(300);
  }
  return null;
}

async function waitForSendButton(timeoutMs: number): Promise<HTMLButtonElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
    for (const btn of btns) {
      const r = btn.getBoundingClientRect();
      const label = (btn.getAttribute("aria-label") ?? "").toLowerCase();
      const text = (btn.textContent ?? "").toLowerCase();
      if (r.height > 0 && r.width > 0 && (label.includes("send") || text === "send")) return btn;
    }
    await sleep(300);
  }
  return null;
}

function withCode(err: Error, code: string): Error & { code: string } {
  (err as Error & { code: string }).code = code;
  return err as Error & { code: string };
}

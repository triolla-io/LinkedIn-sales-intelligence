import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Mock human timing functions to avoid 30s delays in tests
vi.mock("../../src/lib/human/timing", () => ({
  humanPause: vi.fn().mockResolvedValue(undefined),
  humanDelay: vi.fn().mockReturnValue(0),
  sleep: vi.fn().mockResolvedValue(undefined),
  uniform: vi.fn().mockReturnValue(0),
}));

// Mock humanType to just set the value directly
vi.mock("../../src/lib/human/type", () => ({
  humanType: vi.fn().mockImplementation(async (el: HTMLElement, text: string) => {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      el.value = text;
    } else if (el.isContentEditable) {
      el.textContent = text;
    }
  }),
}));

describe("sendMessage on profile fixture", () => {
  beforeEach(async () => {
    vi.resetModules();
    const html = readFileSync(join(__dirname, "../fixtures/profile.html"), "utf-8");
    document.body.innerHTML = html;
    Object.defineProperty(window, "location", {
      value: { href: "https://www.linkedin.com/in/test" },
      writable: true,
    });
  });

  it("finds Message button, injects editor, types text, clicks Send, returns sentAt", async () => {
    // When Message button is clicked, inject compose pane into DOM
    const msgBtn = document.querySelector('button[aria-label^="Message"]') as HTMLButtonElement;
    msgBtn.addEventListener("click", () => {
      const editor = document.createElement("div");
      editor.className = "msg-form__contenteditable";
      editor.setAttribute("contenteditable", "true");
      editor.tabIndex = 0;
      const sendBtn = document.createElement("button");
      sendBtn.className = "msg-form__send-button";
      document.body.appendChild(editor);
      document.body.appendChild(sendBtn);
    });

    const { sendMessage } = await import("../../src/lib/linkedin/send");
    const result = await sendMessage("Hello from test");
    expect(result.sentAt).toBeTruthy();
    expect(result.conversationUrl).toBeTruthy();
  });

  it("throws not_messageable if Message button not found", async () => {
    document.body.innerHTML = "<p>No message button here</p>";
    vi.useFakeTimers();
    try {
      const { sendMessage } = await import("../../src/lib/linkedin/send");
      const promise = sendMessage("hi");
      // Attach rejection handler immediately to prevent unhandled rejection warning
      const caught = promise.catch((e) => e);
      // advance past the 15s waitFor timeout
      await vi.runAllTimersAsync();
      const err = await caught;
      expect(err).toMatchObject({ code: "not_messageable" });
    } finally {
      vi.useRealTimers();
    }
  });
});

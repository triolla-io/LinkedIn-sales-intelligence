// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { commentDiag, revealCommentBox, typeIntoComment } from "../src/lib/comment-dom";

describe("commentDiag", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("reports the editor when it is already open and clicks nothing", () => {
    document.body.innerHTML = `
      <div class="comments-comment-box">
        <div class="ql-editor" contenteditable="true" role="textbox"></div>
      </div>
      <button aria-label="תגובה">תגובה</button>`;
    let clicked = false;
    document.querySelector("button")!.addEventListener("click", () => {
      clicked = true;
    });

    expect(commentDiag()).toEqual({
      editorFound: true,
      commentButtonFound: false,
      href: location.href,
      readyState: document.readyState,
    });
    expect(clicked).toBe(false);
  });

  it("reports the hidden editor + hebrew comment button without clicking; revealCommentBox clicks once", () => {
    document.body.innerHTML = `<button aria-label="תגובה">תגובה</button>`;
    let clickCount = 0;
    document.querySelector("button")!.addEventListener("click", () => {
      clickCount++;
    });

    const diag = commentDiag();
    expect(diag).toEqual({
      editorFound: false,
      commentButtonFound: true,
      href: location.href,
      readyState: document.readyState,
    });
    expect(clickCount).toBe(0);

    const result = revealCommentBox();
    expect(result).toEqual({ clicked: true });
    expect(clickCount).toBe(1);
  });

  it("finds an english Comment button too (aria-label variant)", () => {
    document.body.innerHTML = `<button aria-label="Comment on Dana's post">Comment</button>`;
    expect(commentDiag().commentButtonFound).toBe(true);
  });

  it("does not match a button whose aria-label merely contains a comment count", () => {
    document.body.innerHTML = `<button aria-label="42 comments">42</button>`;
    const diag = commentDiag();
    expect(diag.commentButtonFound).toBe(false);
  });
});

describe("typeIntoComment", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("puts the text into the editor, fires an input event, and returns ok:true with matching length", () => {
    document.body.innerHTML = `
      <div class="comments-comment-box">
        <div class="ql-editor" contenteditable="true" role="textbox"></div>
      </div>`;
    let inputFired = false;
    const editor = document.querySelector<HTMLElement>(".ql-editor")!;
    editor.addEventListener("input", () => {
      inputFired = true;
    });

    const text = "סחטיין על הפוסט";
    const r = typeIntoComment(text);

    expect(r.ok).toBe(true);
    expect(r.length).toBe(text.length);
    expect(inputFired).toBe(true);
  });

  it("returns ok:false, length:0 when there is no editor", () => {
    document.body.innerHTML = "<div></div>";
    expect(typeIntoComment("x")).toEqual({ ok: false, length: 0 });
  });

  it("finds and fills an editor rendered inside an open shadow root", () => {
    document.body.innerHTML = `<div id="shadow-host"></div>`;
    const host = document.getElementById("shadow-host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <div class="comments-comment-box">
        <div class="ql-editor" contenteditable="true" role="textbox"></div>
      </div>`;
    const editor = shadow.querySelector<HTMLElement>(".ql-editor")!;
    let inputFired = false;
    editor.addEventListener("input", () => {
      inputFired = true;
    });

    const text = "תגובה בתוך שאדו רוט";
    const r = typeIntoComment(text);

    expect(r.ok).toBe(true);
    expect(r.length).toBe(text.length);
    expect(inputFired).toBe(true);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readRecentPosts } from "../src/lib/posts-dom";

function fixture(): string {
  return `
  <main>
    <div data-urn="urn:li:activity:7365000000000000001" class="feed-shared-update-v2">
      <span class="update-components-actor__sub-description">3d • <!-- --></span>
      <div class="update-components-text">הפוסט הראשון שלי על פינטק בישראל</div>
    </div>
    <div data-urn="urn:li:activity:7365000000000000002" class="feed-shared-update-v2">
      <span class="update-components-actor__sub-description">1w</span>
      <div class="update-components-text">   </div><!-- empty text → skipped -->
    </div>
    <div data-id="urn:li:activity:7365000000000000003" class="feed-shared-update-v2">
      <div class="update-components-text">פוסט שמזוהה דרך data-id</div>
    </div>
    <div data-urn="urn:li:activity:7365000000000000001" class="feed-shared-update-v2">
      <div class="update-components-text">כפילות של הראשון</div>
    </div>
  </main>`;
}

describe("readRecentPosts", () => {
  beforeEach(() => {
    document.body.innerHTML = fixture();
  });

  it("extracts urn, text and relative time, skipping empty and duplicate posts", () => {
    const { posts } = readRecentPosts(10);
    expect(posts).toEqual([
      {
        urn: "urn:li:activity:7365000000000000001",
        text: "הפוסט הראשון שלי על פינטק בישראל",
        postedAgoText: "3d •",
      },
      {
        urn: "urn:li:activity:7365000000000000003",
        text: "פוסט שמזוהה דרך data-id",
        postedAgoText: null,
      },
    ]);
  });

  it("honors the limit", () => {
    const { posts } = readRecentPosts(1);
    expect(posts).toHaveLength(1);
  });

  it("keeps only the outermost container on a repost-with-commentary, ignoring the nested original post's urn", () => {
    document.body.innerHTML = `
    <main>
      <div data-urn="urn:li:activity:100" class="feed-shared-update-v2">
        <div class="update-components-text">הוספתי תגובה לפוסט הזה</div>
        <div data-urn="urn:li:activity:200" class="feed-shared-update-v2">
          <div class="update-components-text">הפוסט המקורי של מישהו אחר</div>
        </div>
      </div>
    </main>`;
    const { posts } = readRecentPosts(10);
    expect(posts).toHaveLength(1);
    expect(posts[0].urn).toBe("urn:li:activity:100");
    expect(posts.some((p) => p.urn === "urn:li:activity:200")).toBe(false);
  });

  it("pierces an open shadow root to find a post container rendered inside it", () => {
    document.body.innerHTML = `<main><div id="shadow-host"></div></main>`;
    const host = document.getElementById("shadow-host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <div data-urn="urn:li:activity:300" class="feed-shared-update-v2">
        <span class="update-components-actor__sub-description">2h</span>
        <div class="update-components-text">פוסט בתוך שאדו רוט</div>
      </div>`;
    const { posts } = readRecentPosts(10);
    expect(posts).toEqual([
      {
        urn: "urn:li:activity:300",
        text: "פוסט בתוך שאדו רוט",
        postedAgoText: "2h",
      },
    ]);
  });
});

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
});

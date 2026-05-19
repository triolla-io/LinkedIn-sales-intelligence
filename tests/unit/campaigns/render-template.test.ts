import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/campaigns/render-template";

const ctx = {
  recipient: { firstName: "Alice", lastName: "Cohen", company: "Acme", title: "CTO" },
  sender:    { firstName: "Daniel", lastName: "Levi",  company: "Triolla", title: "CEO" },
};

describe("renderTemplate", () => {
  it("substitutes recipient variables", () => {
    expect(renderTemplate("Hi {{firstName}} at {{company}}", ctx).body)
      .toBe("Hi Alice at Acme");
  });
  it("substitutes sender variables", () => {
    expect(renderTemplate("From {{senderFirstName}} ({{senderCompany}})", ctx).body)
      .toBe("From Daniel (Triolla)");
  });
  it("applies default fallback when value missing", () => {
    const ctx2 = { ...ctx, recipient: { ...ctx.recipient, firstName: null } };
    expect(renderTemplate("Hi {{firstName|there}}", ctx2).body).toBe("Hi there");
  });
  it("returns missing variable list when no fallback and no value", () => {
    const ctx2 = { ...ctx, recipient: { ...ctx.recipient, firstName: null } };
    const res = renderTemplate("Hi {{firstName}}", ctx2);
    expect(res.body).toBe("");
    expect(res.missing).toEqual(["firstName"]);
  });
  it("treats missing sender variables as empty (no skip)", () => {
    const ctx2 = { ...ctx, sender: { ...ctx.sender, title: null } };
    const res = renderTemplate("Best, {{senderFirstName}} {{senderTitle}}", ctx2);
    expect(res.body).toBe("Best, Daniel ");
    expect(res.missing).toEqual([]);
  });
});

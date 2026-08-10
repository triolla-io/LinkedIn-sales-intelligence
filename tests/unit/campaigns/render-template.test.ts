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
  it("renders best-effort (empty substitution) when no fallback and no value — never blocks a send", () => {
    // Policy: missing template variables must NEVER cause a skip; the message
    // always sends with the variable rendered as "" (see commit 14e4b69).
    const ctx2 = { ...ctx, recipient: { ...ctx.recipient, firstName: null } };
    const res = renderTemplate("Hi {{firstName}}", ctx2);
    expect(res.body).toBe("Hi ");
    expect(res.missing).toEqual([]);
  });
  it("treats missing sender variables as empty (no skip)", () => {
    const ctx2 = { ...ctx, sender: { ...ctx.sender, title: null } };
    const res = renderTemplate("Best, {{senderFirstName}} {{senderTitle}}", ctx2);
    expect(res.body).toBe("Best, Daniel ");
    expect(res.missing).toEqual([]);
  });

  it("substitutes hebrewFirstName when present", () => {
    const ctxHebrew = {
      ...ctx,
      recipient: { ...ctx.recipient, hebrewFirstName: "אליס" },
    };
    expect(renderTemplate("שלום {{hebrewFirstName}}", ctxHebrew).body)
      .toBe("שלום אליס");
  });

  it("falls back to firstName when hebrewFirstName is null", () => {
    const ctxNoHebrew = {
      ...ctx,
      recipient: { ...ctx.recipient, hebrewFirstName: null },
    };
    expect(renderTemplate("שלום {{hebrewFirstName}}", ctxNoHebrew).body)
      .toBe("שלום Alice");
  });
});

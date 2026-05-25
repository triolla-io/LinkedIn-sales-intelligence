export type RenderContext = {
  recipient: {
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    title: string | null;
    hebrewFirstName?: string | null;
  };
  sender: { firstName: string | null; lastName: string | null; company: string | null; title: string | null };
};

const RECIPIENT_VARS = ["firstName", "lastName", "company", "title", "hebrewFirstName"] as const;
const SENDER_VARS    = ["senderFirstName", "senderLastName", "senderCompany", "senderTitle"] as const;

export function renderTemplate(template: string, ctx: RenderContext): { body: string; missing: string[] } {
  const body = template.replace(/\{\{([a-zA-Z]+)(?:\|([^}]*))?\}\}/g, (_m, name, fallback) => {
    const value = lookup(name, ctx);
    if (value !== null && value !== "") return value;
    if (fallback !== undefined) return fallback;
    return "";
  });
  return { body, missing: [] };
}

function lookup(name: string, ctx: RenderContext): string | null {
  switch (name) {
    case "firstName":       return ctx.recipient.firstName;
    case "lastName":        return ctx.recipient.lastName;
    case "company":         return ctx.recipient.company;
    case "title":           return ctx.recipient.title;
    case "hebrewFirstName": return ctx.recipient.hebrewFirstName ?? ctx.recipient.firstName;
    case "senderFirstName": return ctx.sender.firstName;
    case "senderLastName":  return ctx.sender.lastName;
    case "senderCompany":   return ctx.sender.company;
    case "senderTitle":     return ctx.sender.title;
    default:                return null;
  }
}

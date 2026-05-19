export function renderTemplate(
  body: string,
  contact: { fullName: string; currentTitle?: string | null; currentCompany?: string | null }
): { rendered: string; unknownPlaceholders: string[] } {
  const firstName = contact.fullName.split(" ")[0] ?? contact.fullName;
  const known: Record<string, string> = {
    "{first_name}": firstName,
    "{company}": contact.currentCompany ?? "",
    "{title}": contact.currentTitle ?? "",
  };
  let rendered = body;
  for (const [placeholder, value] of Object.entries(known)) {
    rendered = rendered.replaceAll(placeholder, value);
  }
  const remaining = [...rendered.matchAll(/\{[^}]+\}/g)].map((m) => m[0]);
  return { rendered, unknownPlaceholders: [...new Set(remaining)] };
}

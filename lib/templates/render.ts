export function renderTemplate(
  body: string,
  contact: { fullName: string; currentTitle?: string | null; currentCompany?: string | null }
): { rendered: string; unknownPlaceholders: string[] } {
  const firstName = contact.fullName.split(" ")[0] ?? contact.fullName;
  const lastName = contact.fullName.split(" ").slice(1).join(" ");
  const values: Record<string, string> = {
    firstName,
    first_name: firstName,
    lastName,
    last_name: lastName,
    company: contact.currentCompany ?? "",
    title: contact.currentTitle ?? "",
  };

  // Support both {{firstName}} and {first_name} syntax
  let rendered = body.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => values[key.trim()] ?? `{{${key}}}`);
  rendered = rendered.replace(/\{([^{}]+)\}/g, (_, key: string) => values[key.trim()] ?? `{${key}}`);

  const remaining = [
    ...[...rendered.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]),
    ...[...rendered.matchAll(/\{[^{}]+\}/g)].map((m) => m[0]),
  ];
  return { rendered, unknownPlaceholders: [...new Set(remaining)] };
}

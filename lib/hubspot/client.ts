const HUBSPOT_BASE = "https://api.hubapi.com";

function normalizeLinkedinUrl(url: string): string {
  return url.toLowerCase().replace(/\/$/, "").replace(/^http:/, "https:");
}

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.HUBSPOT_API_KEY ?? ""}`,
  };
}

async function searchByProperty(
  property: string,
  value: string
): Promise<{ email?: string; phone?: string } | null> {
  const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [{ propertyName: property, operator: "EQ", value }],
        },
      ],
      properties: ["email", "phone", "hs_linkedin_profile_url"],
      limit: 1,
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const contact = data.results?.[0]?.properties;
  if (!contact) return null;

  const email = contact.email || undefined;
  const phone = contact.phone || undefined;
  if (!email && !phone) return null;

  return { email, phone };
}

export async function lookupContact(params: {
  linkedinUrl: string;
  fullName: string;
  company?: string;
}): Promise<{ email?: string; phone?: string } | null> {
  if (!process.env.HUBSPOT_API_KEY) return null;

  try {
    // 1. Try LinkedIn URL
    if (params.linkedinUrl) {
      const byLinkedin = await searchByProperty(
        "hs_linkedin_profile_url",
        normalizeLinkedinUrl(params.linkedinUrl)
      );
      if (byLinkedin) return byLinkedin;
    }

    // 2. Fallback: name + company
    const nameParts = params.fullName.trim().split(/\s+/);
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ");

    if (!firstName) return null;

    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: "firstname", operator: "EQ", value: firstName },
              ...(lastName
                ? [{ propertyName: "lastname", operator: "EQ", value: lastName }]
                : []),
              ...(params.company
                ? [{ propertyName: "company", operator: "EQ", value: params.company }]
                : []),
            ],
          },
        ],
        properties: ["email", "phone"],
        limit: 1,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const contact = data.results?.[0]?.properties;
    if (!contact) return null;

    const email = contact.email || undefined;
    const phone = contact.phone || undefined;
    if (!email && !phone) return null;

    return { email, phone };
  } catch (error) {
    console.error("[hubspot] lookupContact failed silently", error);
    return null;
  }
}

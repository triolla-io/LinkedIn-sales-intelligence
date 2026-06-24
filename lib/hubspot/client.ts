import { toIsraeliE164, isIsraeliMobile } from "@/lib/phone/normalize";

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

// HubSpot has a single untyped `phone` field. Keep it only when it normalizes
// to an Israeli mobile (05X); drop landline (02/03/04/08/09) and VoIP (07X).
function acceptMobilePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const e164 = toIsraeliE164(raw);
  return e164 && isIsraeliMobile(e164) ? e164 : undefined;
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
  const phone = acceptMobilePhone(contact.phone || undefined);
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
    const phone = acceptMobilePhone(contact.phone || undefined);
    if (!email && !phone) return null;

    return { email, phone };
  } catch (error) {
    console.error("[hubspot] lookupContact failed silently", error);
    return null;
  }
}

const LEAD_SOURCE_VALUE = "Triolla Sales Intelligence";

async function findContactId(linkedinUrl: string, email?: string | null): Promise<string | null> {
  const search = async (propertyName: string, value: string) => {
    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName, operator: "EQ", value }] }],
        properties: ["email"],
        limit: 1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.results?.[0]?.id ?? null;
  };

  if (linkedinUrl) {
    const byUrl = await search("hs_linkedin_profile_url", normalizeLinkedinUrl(linkedinUrl));
    if (byUrl) return byUrl;
  }
  if (email) {
    const byEmail = await search("email", email);
    if (byEmail) return byEmail;
  }
  return null;
}

export async function upsertContact(params: {
  linkedinUrl: string;
  email?: string | null;
  mobilePhone?: string | null;
  company?: string | null;
  industry?: string | null;
  companySize?: number | null;
}): Promise<{ ok: boolean; hubspotId?: string }> {
  if (!process.env.HUBSPOT_API_KEY) return { ok: false };

  try {
    const properties: Record<string, string | number> = {};
    if (params.email) properties.email = params.email;
    if (params.mobilePhone) properties.mobilephone = params.mobilePhone;
    if (params.company) properties.company = params.company;
    if (params.industry) properties.industry = params.industry;
    if (params.companySize != null) properties.numemployees = params.companySize;
    if (params.linkedinUrl) {
      properties.hs_linkedin_profile_url = normalizeLinkedinUrl(params.linkedinUrl);
    }

    const existingId = await findContactId(params.linkedinUrl, params.email);

    if (existingId) {
      const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts/${existingId}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ properties }),
      });
      if (!res.ok) return { ok: false };
      return { ok: true, hubspotId: existingId };
    }

    // Create: tag the source so CRM users can filter Triolla-originated records.
    properties.lead_source = LEAD_SOURCE_VALUE;
    const res = await fetch(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, hubspotId: data.id };
  } catch (error) {
    console.error("[hubspot] upsertContact failed silently", error);
    return { ok: false };
  }
}

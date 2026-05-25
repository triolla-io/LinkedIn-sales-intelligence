const APOLLO_HEADERS = () => ({
  "Content-Type": "application/json",
  "X-Api-Key": process.env.APOLLO_API_KEY ?? "",
});

export async function matchOrganization(name: string): Promise<{
  staffCount: number | null;
  industry: string | null;
  website: string | null;
  description: string | null;
}> {
  const empty = { staffCount: null, industry: null, website: null, description: null };

  // Step 1: search by name to get domain
  const searchRes = await fetch("https://api.apollo.io/v1/mixed_companies/search", {
    method: "POST",
    headers: APOLLO_HEADERS(),
    body: JSON.stringify({ q_organization_name: name, page: 1, per_page: 1 }),
  });
  if (!searchRes.ok) return empty;
  const searchData = await searchRes.json();
  const account = searchData.accounts?.[0];
  const domain = account?.primary_domain || account?.domain || account?.website_url?.replace(/^https?:\/\//, "").split("/")[0];
  if (!domain) return empty;

  // Step 2: enrich by domain to get full company data
  const enrichRes = await fetch("https://api.apollo.io/v1/organizations/enrich", {
    method: "POST",
    headers: APOLLO_HEADERS(),
    body: JSON.stringify({ domain }),
  });
  if (enrichRes.status === 422 || enrichRes.status === 404) return empty;
  if (enrichRes.status === 429) throw new Error("Apollo rate limit");
  if (!enrichRes.ok) return empty;

  const enrichData = await enrichRes.json();
  const org = enrichData.organization;
  if (!org) return empty;

  return {
    staffCount: org.estimated_num_employees ?? null,
    industry: org.industry ?? null,
    website: org.website_url ?? null,
    description: org.short_description ?? null,
  };
}

export async function matchPerson(input: {
  name: string;
  company?: string;
  linkedinUrl?: string;
}): Promise<{ email?: string; phone?: string; companySize?: number; currentCompany?: string; industry?: string; raw: unknown }> {
  const url = "https://api.apollo.io/v1/people/match";
  const body = JSON.stringify({
    name: input.name,
    organization_name: input.company,
    linkedin_url: input.linkedinUrl,
    reveal_personal_emails: true,
  });

  const delays = [1000, 2000, 4000];
  let attempt = 0;

  while (true) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": process.env.APOLLO_API_KEY ?? "",
      },
      body,
    });

    if (res.status === 404) {
      return { raw: null };
    }

    if (res.status === 429) {
      if (attempt < delays.length) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        attempt++;
        continue;
      }
      throw new Error(`429: rate limit exceeded after ${attempt} retries`);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }

    const data = await res.json();
    const person = data.person;

    // Guard against Apollo returning a completely different person.
    // Compare normalized name tokens — if there's zero overlap, discard.
    if (person && input.name) {
      const normalize = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9֐-׿ ]/g, "").split(/\s+/).filter(Boolean);
      const inputTokens = new Set(normalize(input.name));
      const returnedName: string =
        [person.first_name, person.last_name].filter(Boolean).join(" ") || person.name || "";
      const returnedTokens = normalize(returnedName);
      const hasOverlap = returnedTokens.some((t) => inputTokens.has(t));
      if (returnedName && !hasOverlap) {
        return { raw: data };
      }
    }

    const contact = person?.contact;
    const org = person?.organization;
    const phones: { sanitized_number?: string; type?: string }[] = [
      ...(person?.phone_numbers ?? []),
      ...(contact?.phone_numbers ?? []),
    ];
    const seen = new Set<string>();
    const uniquePhones = phones.filter((p) => {
      if (!p.sanitized_number || seen.has(p.sanitized_number)) return false;
      seen.add(p.sanitized_number);
      return true;
    });
    const phone =
      uniquePhones.find((p) => p.type === "work_direct")?.sanitized_number ??
      uniquePhones.find((p) => p.type === "work")?.sanitized_number ??
      uniquePhones.find((p) => p.type === "other")?.sanitized_number ??
      uniquePhones.find((p) => p.type === "mobile")?.sanitized_number ??
      uniquePhones[0]?.sanitized_number;
    const email = person?.email ?? contact?.email ?? undefined;
    return {
      email,
      phone,
      companySize: org?.estimated_num_employees ?? undefined,
      currentCompany: org?.name ?? undefined,
      industry: org?.industry ?? undefined,
      raw: data,
    };
  }
}

/**
 * Fire-and-forget: sends a second Apollo people/match request with
 * reveal_phone_number: true and our webhook_url. Apollo calls us back
 * asynchronously (usually within 2–5 minutes) with mobile phone data.
 *
 * Errors are silently ignored — this is best-effort.
 */
export function requestMobileReveal(input: {
  name: string;
  company?: string;
  linkedinUrl?: string;
  webhookUrl: string;
}): void {
  const body = JSON.stringify({
    name: input.name,
    organization_name: input.company,
    linkedin_url: input.linkedinUrl,
    reveal_phone_number: true,
    webhook_url: input.webhookUrl,
  });

  fetch("https://api.apollo.io/v1/people/match", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.APOLLO_API_KEY ?? "",
    },
    body,
  }).catch(() => {
    // fire-and-forget — ignore errors
  });
}

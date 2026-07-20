import { toIsraeliE164 } from "@/lib/phone/normalize";

/**
 * Apollo sometimes returns Israeli numbers with a "+1" prefix instead of "+972"
 * (e.g. "+10506463464"). Delegate to the canonical normalizer, which repairs
 * that and emits E.164. Falls back to the raw value if it can't be parsed, so we
 * never drop a number we don't understand.
 */
export function normalizeApolloPhone(phone: string | undefined): string | undefined {
  if (!phone) return phone;
  return toIsraeliE164(phone) ?? phone;
}

const APOLLO_HEADERS = () => ({
  "Content-Type": "application/json",
  "X-Api-Key": process.env.APOLLO_API_KEY ?? "",
});

/**
 * Derive the genuinely-current role from an Apollo people/match response.
 *
 * Apollo's top-level `person.title` / `person.organization.name` can point at a
 * STALE role: a contact who never closed an old position on LinkedIn (end_date
 * null) can have multiple `current: true` employments, and Apollo may surface
 * the wrong one. This mis-flagged Paz Romano as "moving to" his 2015 yacht-club
 * role instead of his 2025 startup. So prefer `employment_history`, taking the
 * current entry with the latest `start_date`. Falls back to the top-level
 * fields when no employment history is present.
 */
export function deriveCurrentRole(raw: unknown): { title: string | null; company: string | null } {
  const person = (raw as { person?: Record<string, unknown> } | null)?.person;
  if (!person) return { title: null, company: null };

  const history = Array.isArray(person.employment_history)
    ? (person.employment_history as Array<Record<string, unknown>>)
    : [];
  const current = history.filter((e) => e.current === true);

  if (current.length > 0) {
    // Latest start_date wins; null/missing start_date sorts oldest. ISO
    // "YYYY-MM-DD" strings compare correctly lexicographically.
    const best = current.reduce((a, b) =>
      String(b.start_date ?? "") > String(a.start_date ?? "") ? b : a
    );
    return {
      title: (best.title as string) ?? null,
      company: (best.organization_name as string) ?? null,
    };
  }

  const org = person.organization as { name?: string } | undefined;
  return {
    title: (person.title as string) ?? null,
    company: org?.name ?? null,
  };
}

async function matchOrganization(name: string): Promise<{
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
}): Promise<{ email?: string; phone?: string; companySize?: number; currentTitle?: string; currentCompany?: string; industry?: string; raw: unknown }> {
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
    // Only callable business/mobile numbers — never home/other/landline.
    // If the person has only a private (home/other) number, leave phone empty.
    const rawPhone =
      uniquePhones.find((p) => p.type === "work_direct")?.sanitized_number ??
      uniquePhones.find((p) => p.type === "work")?.sanitized_number ??
      uniquePhones.find((p) => p.type === "mobile")?.sanitized_number;
    const phone = normalizeApolloPhone(rawPhone);
    const email = person?.email ?? contact?.email ?? undefined;
    // Derive the true current role from employment_history — org?.name alone can
    // be a stale position (see deriveCurrentRole). Fall back to org?.name.
    const derived = deriveCurrentRole(data);
    return {
      email,
      phone,
      companySize: org?.estimated_num_employees ?? undefined,
      currentTitle: derived.title ?? undefined,
      currentCompany: derived.company ?? org?.name ?? undefined,
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
function requestMobileReveal(input: {
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

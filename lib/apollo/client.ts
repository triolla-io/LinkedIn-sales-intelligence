export async function matchOrganization(name: string): Promise<{
  staffCount: number | null;
  industry: string | null;
  website: string | null;
  description: string | null;
}> {
  const res = await fetch("https://api.apollo.io/v1/organizations/enrich", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.APOLLO_API_KEY}`,
    },
    body: JSON.stringify({ name }),
  });

  if (res.status === 404 || res.status === 422) {
    return { staffCount: null, industry: null, website: null, description: null };
  }
  if (res.status === 429) throw new Error("Apollo rate limit");
  if (!res.ok) throw new Error(`Apollo org enrich ${res.status}`);

  const data = await res.json();
  const org = data.organization;
  if (!org) return { staffCount: null, industry: null, website: null, description: null };

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
    reveal_phone_number: true,
  });

  const delays = [1000, 2000, 4000];
  let attempt = 0;

  while (true) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.APOLLO_API_KEY}`,
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
    const org = person?.organization;
    return {
      email: person?.email ?? undefined,
      phone: person?.phone_numbers?.[0]?.sanitized_number ?? undefined,
      companySize: org?.estimated_num_employees ?? undefined,
      currentCompany: org?.name ?? undefined,
      industry: org?.industry ?? undefined,
      raw: data,
    };
  }
}

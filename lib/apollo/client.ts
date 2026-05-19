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

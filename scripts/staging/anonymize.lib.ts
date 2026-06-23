const E164 = /^\+[1-9]\d{6,14}$/;

export function anonymizeEmail(contactId: string): string {
  return `ariel+${contactId}@triolla.io`;
}

export function anonymizePhone(testPhone: string): string {
  if (!E164.test(testPhone)) {
    throw new Error(`STAGING_TEST_PHONE must be E.164 (e.g. +972500000000), got: ${testPhone}`);
  }
  return testPhone;
}

export function pickLinkedinUrl(index: number, pool: string[]): string {
  return pool[index % pool.length];
}

export function parsePool(raw: string | undefined): string[] {
  const items = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (items.length === 0) throw new Error("LinkedIn test-profile pool is empty");
  return items;
}

export function assertStagingDatabase(databaseUrl: string, confirmFlag: string | undefined): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(`Refusing to run: DATABASE_URL is not a valid URL and cannot be verified as staging`);
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!/staging/i.test(dbName)) {
    throw new Error(`Refusing to run: DATABASE_URL db name "${dbName}" does not contain "staging"`);
  }
  if (confirmFlag !== "1") {
    throw new Error("Refusing to run: set STAGING_ANONYMIZE_CONFIRM=1 to confirm");
  }
}

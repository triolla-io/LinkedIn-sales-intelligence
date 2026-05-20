export type ContactSnapshot = {
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  companySize: number | null;
};

export type IncomingContact = ContactSnapshot & { linkedinUrn: string };

export type ContactDiff = {
  added: string[];      // linkedinUrns in incoming but not in existing
  updated: string[];    // in both, but at least one field changed
  removed: string[];    // in existing but not in incoming
  unchanged: string[];  // in both, identical
};

function isSameSnapshot(a: ContactSnapshot, b: ContactSnapshot): boolean {
  return (
    (a.fullName ?? "") === (b.fullName ?? "") &&
    (a.currentTitle ?? "") === (b.currentTitle ?? "") &&
    (a.currentCompany ?? "") === (b.currentCompany ?? "") &&
    (a.companySize ?? null) === (b.companySize ?? null)
  );
}

export function diffContacts(
  existing: Map<string, ContactSnapshot>,
  incoming: IncomingContact[],
): ContactDiff {
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const incomingUrns = new Set<string>();

  for (const c of incoming) {
    incomingUrns.add(c.linkedinUrn);
    const prev = existing.get(c.linkedinUrn);
    if (!prev) {
      added.push(c.linkedinUrn);
    } else if (isSameSnapshot(prev, c)) {
      unchanged.push(c.linkedinUrn);
    } else {
      updated.push(c.linkedinUrn);
    }
  }

  const removed = [...existing.keys()].filter((urn) => !incomingUrns.has(urn));

  return { added, updated, removed, unchanged };
}

/**
 * What "בהכנה" means for one person, derived from rows that already exist.
 *
 * The rule this file enforces: a preparation that cannot progress SAYS SO. Every dead
 * end — an employer we could not match, research that failed, research or axis-building
 * that simply stopped — ends in `failed: true` with a sentence the user can act on.
 * An indefinite spinner is the outcome being ruled out: it looks identical to work in
 * progress, so nobody ever retries and the person silently never enters a scan.
 *
 * Pure and prisma-free: imported by the people API, never by a component.
 */

/** How long a stage may sit without progress before it is called stuck, not slow. */
export const PREP_STALL_MINUTES = 20;

export type PrepStageKey = "added" | "company" | "axes" | "scan";

export type PrepStage = {
  key: PrepStageKey;
  state: "done" | "running" | "waiting" | "failed";
  /** Hebrew, screen-ready. This file is the only place the copy lives. */
  detail: string;
};

export type PrepStatus = {
  /** The person is modelled and will be scanned — the card graduates to a normal one. */
  ready: boolean;
  /** Something needs the user. The UI shows the reason and a retry. */
  failed: boolean;
  stages: PrepStage[];
};

export type EmployerStatus = "PENDING_RESEARCH" | "ACTIVE" | "RESEARCH_FAILED";

export function derivePrepStatus(input: {
  radarAddedAt: Date | null;
  hasEmployer: boolean;
  employerStatus: EmployerStatus | null;
  employerError: string | null;
  axisCount: number;
  hasProfile: boolean;
  nextScanLabel: string;
  now: Date;
}): PrepStatus {
  // A person added before this column existed has no clock to measure, so they are never
  // reported as stuck — an old row is not a stalled one.
  const stalled =
    input.radarAddedAt != null &&
    input.now.getTime() - input.radarAddedAt.getTime() > PREP_STALL_MINUTES * 60_000;

  const added: PrepStage = { key: "added", state: "done", detail: "נוסף למעקב" };

  let company: PrepStage;
  if (!input.hasEmployer) {
    company = {
      key: "company",
      state: "failed",
      detail: "לא זוהתה חברה למעקב — אפשר להוסיף אותה ידנית",
    };
  } else if (input.employerStatus === "RESEARCH_FAILED") {
    company = {
      key: "company",
      state: "failed",
      detail: input.employerError
        ? `המחקר על החברה נכשל: ${input.employerError}`
        : "המחקר על החברה נכשל",
    };
  } else if (input.employerStatus === "ACTIVE") {
    company = { key: "company", state: "done", detail: "המערכת קראה על החברה" };
  } else if (stalled) {
    company = { key: "company", state: "failed", detail: "המחקר על החברה נתקע — נסי שוב" };
  } else {
    company = { key: "company", state: "running", detail: "המערכת קוראת על החברה" };
  }

  const companyDone = company.state === "done";
  const modelled = input.hasProfile && input.axisCount > 0;

  let axes: PrepStage;
  if (modelled) {
    axes = {
      key: "axes",
      state: "done",
      detail: `${input.axisCount} תחומי עניין נבנו`,
    };
  } else if (!companyDone) {
    axes = { key: "axes", state: "waiting", detail: "ממתין למידע על החברה" };
  } else if (stalled) {
    // Covers both "no profile" and "a profile with zero axes": either way nothing will
    // ever be found for this person, and saying "בהכנה" forever would hide that.
    axes = {
      key: "axes",
      state: "failed",
      detail: input.hasProfile
        ? "לא נמצאו תחומי עניין לאדם הזה — נסי שוב"
        : "בניית תחומי העניין נתקעה — נסי שוב",
    };
  } else {
    axes = { key: "axes", state: "running", detail: "נבנים תחומי העניין שלו" };
  }

  const scan: PrepStage = modelled
    ? { key: "scan", state: "waiting", detail: `ייכנס לסריקה הקרובה · ${input.nextScanLabel}` }
    : { key: "scan", state: "waiting", detail: "ייכנס לסריקה אחרי שהתחומים ייבנו" };

  const stages = [added, company, axes, scan];
  return {
    ready: modelled,
    failed: stages.some((s) => s.state === "failed"),
    stages,
  };
}

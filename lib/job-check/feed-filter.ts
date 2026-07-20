export type FeedFilter = "all" | "company" | "role" | "pending";

export type FilterableChange = {
  changeType: "COMPANY_MOVE" | "PROMOTION" | "TITLE_CHANGE" | null;
  status: "PENDING_REVIEW" | "APPROVED" | "SENT";
};

const VALID: FeedFilter[] = ["all", "company", "role", "pending"];

export function parseFeedFilter(param: string | null | undefined): FeedFilter {
  return VALID.includes(param as FeedFilter) ? (param as FeedFilter) : "all";
}

export function matchesFilter(change: FilterableChange, filter: FeedFilter): boolean {
  switch (filter) {
    case "company":
      return change.changeType === "COMPANY_MOVE";
    case "role":
      return change.changeType === "PROMOTION" || change.changeType === "TITLE_CHANGE";
    case "pending":
      return change.status === "PENDING_REVIEW";
    case "all":
    default:
      return true;
  }
}

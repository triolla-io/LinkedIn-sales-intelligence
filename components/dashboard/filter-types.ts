export type Filters = {
  seniority: string[];
  function: string[];
  q: string;
  titleSearch: string[];
  industry: string[];
  companySizeBuckets: string[];
  hasEmail?: boolean;
  hasPhone?: boolean;
  listId?: string;
};

export const DEFAULT_FILTERS: Filters = {
  seniority: [],
  function: [],
  q: "",
  titleSearch: [],
  industry: [],
  companySizeBuckets: [],
  listId: undefined,
};

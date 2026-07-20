export type NewsResult = {
  title: string;
  url: string;
  snippet: string;
  source: string; // provider tag: "tavily" | "serper" | "gnews"
  publishedAt: string | null;
};

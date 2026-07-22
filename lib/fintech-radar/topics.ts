/** Static fintech topic queries for the daily radar. Each string is a single
 *  Tavily/GNews query. Keep broad but fintech-scoped; volume stays inside free tiers. */
export const FINTECH_TOPICS: string[] = [
  'fintech (funding OR raises OR "Series A" OR "Series B" OR acquires OR acquisition)',
  'stablecoin OR "digital dollar" OR "crypto payments"',
  '"embedded finance" OR "banking as a service" OR BaaS',
  '"open banking" OR "open finance"',
  'payments (launch OR partnership OR infrastructure)',
  '"AI in finance" OR "AI agent" (payments OR banking OR lending)',
  'fintech (lending OR "buy now pay later" OR BNPL)',
  'regtech OR (compliance fintech regulation)',
  'wealthtech OR insurtech',
  'neobank OR "digital bank" (launch OR funding)',
];

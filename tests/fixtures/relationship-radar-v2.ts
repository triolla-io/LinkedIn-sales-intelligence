/**
 * Real output from the first person-first Tech Radar run in production, 2026-08-20.
 *
 * These are not invented examples. Every string here was written by the live v1
 * pipeline for six hand-marked contacts, and each one demonstrates a specific defect
 * that Plans 2-4 exist to fix. They are the acceptance criteria's evidence: a fix
 * that cannot turn these inputs into the right outputs is not the fix.
 *
 * Do not "clean up" the Hebrew. The garbling is part of the fixture.
 */

/**
 * Defect (1): a pure cloud-vendor capability launch. The v1 triage scored this as a
 * top item because it IS a launch — which is exactly what the inverted filter must
 * stop rewarding. There is no research angle, no trend, no third-party analysis:
 * AWS announced its own feature on its own blog.
 */
export const VENDOR_LAUNCH_ITEM = {
  technology: "DynamoDB Real-Time Vector Search",
  vendor: "Amazon",
  publisher: "aws.amazon.com",
  title: "Amazon DynamoDB תומך בחיפוש וקטורי בזמן אמת בכל קנה מידה",
  summary:
    "Amazon הוסיפה יכולת חיפוש וקטורי מובנית ל-DynamoDB, המאפשרת אחסון וקטורי embedding לצד נתונים תפעוליים וביצוע חיפושי דמיון ישירים בבסיס הנתונים ללא העתקה לשירות נפרד. החיפוש פועל בעיכוב של מילישניות בודדות עם recall של 99% ומעלה, ללא צורך בניהול שרתים או תחזוקה.",
  categories: ["vector search", "database", "data infrastructure", "embeddings", "real-time retrieval"],
  url: "https://aws.amazon.com/blogs/aws/amazon-dynamodb-now-supports-real-time-vector-search-at-any-scale/",
  publishedAt: "2026-08-05T07:00:00Z",
} as const;

/**
 * Defect (3): the mailing-list scenario. One item, one company, three founders — and
 * the SAME `fitRationale`, byte for byte, for all three. The rationale is a property
 * of the company, so it cannot distinguish a CEO from a COO from a VP-R&D. Three
 * drafts went out that differ only in phrasing noise.
 */
export const SHARED_COMPANY_RATIONALE =
  "מחפשים לשפר את מנוע ההמלצות והדירוג הדינמי של התוכן לכל משתמש בין מיליוני אוהדים בספורטים שונים, וחיפוש וקטורי בזמן אמת ב-DynamoDB מאפשר התאמה מהירה של תוכן רלוונטי ללא עיכוב.";

export const THREE_FOUNDERS_ONE_COMPANY = [
  { contactId: "c-ami", fullName: "Ami Serkis", hebrewFirstName: "עמי", currentTitle: "Co-Founder & Ceo" },
  { contactId: "c-ori", fullName: "Ori Bar-Shavit", hebrewFirstName: "אורי", currentTitle: "COO" },
  { contactId: "c-roy", fullName: "Roy Hayumi", hebrewFirstName: "רוי", currentTitle: "Co-Founder & VP-R&D" },
] as const;

export const COMPANY_365SCORES = { trackedCompanyId: "tc-365scores", name: "365Scores" } as const;

/**
 * Defect (2) and (4): the drafts themselves. All eleven carried the v1 adoption
 * suggestion; several also carried Hebrew garbling the prompt never asked for.
 */
export const V1_DRAFTS = [
  // The three near-identical ones. Same item, same company, three recipients.
  "היי עמי, ראיתי את DynamoDB Real-Time Vector Search של אמזון, שמאפשר חיפוש וקטורי בזמן אמת בקנה מידה ענק. אולי תוכלו לשלב את זה במנוע ההמלצות והדירוג הדינמי של התוכן אצלכם.",
  "היי אורי, ראיתי את חיפוש הווקטור בזמן אמת של DynamoDB. זה מאפשר התאמת תוכן בקצב שלא היה אפשרי קודם. אולי תוכלו לשלב את זה במנוע ההמלצות והדירוג הדינמי אצלכם.",
  "היי רוי, ראיתי את DynamoDB Real-Time Vector Search של אמזון שמחפשת וקטורים בקנה מידה ענק בלא עיכוב. אולי תוכלו לשלב את זה במנוע ההמלצות והדירוג הדינמי של התוכן אצלכם.",
  // Doubled possessive: "שלכם אצלכם".
  "היי עמי, ראיתי שירות חדש של Genius Sports לאימות נתונים והסדרים בשוקי ניבוי. אולי תוכלו לשלב את זה בנתונים הספורטיביים החיים שלכם אצלכם.",
  // Doubled possessive AND a Hebrew prefix glued to Latin words: "שProtoPie", "לprototyping", "וhandoff".
  "היי אסף, ראיתי שProtoPie הוציאו תמיכה native ב-MCP שמחברת ישירות לprototyping וhandoff. אולי תוכלו לשלב את זה בתהליך ה-Design System Creation שלכם אצלכם.",
  "היי אביגיל, ראיתי את wisepot של NSSOL שמנהל מחזור חיים של מודלים אופטימיזציה מתמטיים. אולי תוכלו לשלב את זה בלוגיסטיקה ושרשרת אספקה בין בתי הזיקוק אצלכם.",
  "היי אופיר, ראיתי מערכת ג'ל חדשה של Halliburton שמנקה צינורות תת-ימיים בלי להשפיע על הייצור בשדות סמוכים. אולי תוכלו לשלב את זה בניקוי צינורות בשדות הצפון אצלכם.",
] as const;

/**
 * What the v2 register is supposed to produce, for a different item and recipient than
 * V1_DRAFTS — this is not a before/after pair with any single V1 entry. Hand-written
 * target. Models the sender's real voice, not the quiet "נתקלתי... חשבתי עליך" register:
 * a rhetorical-question opener, 2-3 sentences on what the article itself says, then one
 * sentence anchoring why it touches THIS reader by name.
 */
export const V2_TARGET_DRAFT = `היי אופיר, ראית את זה?
מחקר חדש על CO2-EOR מראה שהזרקת פחמן דו-חמצני מחזירה לחיים שדות שכולם כבר הספידו. יש שם מספרים מהשטח שממש מפתיעים — קצב שאיבה שעלה בעשרות אחוזים בשדות שנחשבו גמורים. וזה נוגע ישר בשאלה כמה עוד אפשר לסחוט מהשדות הבוגרים שבתיק של דלק!
https://example.com/co2-eor`;

import type { Seniority, Function as PrismaFunction } from "@/lib/generated/prisma/client";

export function shouldSkipSeed(existingContactCount: number, force: boolean): boolean {
  return existingContactCount > 0 && !force;
}

type ContactSeed = {
  ownerId: string;
  linkedinUrn: string;
  linkedinUrl: string;
  fullName: string;
  hebrewFirstName: string | null;
  currentTitle: string;
  currentCompany: string;
  companySize: number | null;
  seniority: Seniority;
  function: PrismaFunction;
  industry: string;
  email: string | null;
  phone: string | null;
  lastSyncedAt: Date;
  enrichedAt: Date | null;
  enrichmentSource: string | null;
};

const RAW_CONTACTS: Omit<ContactSeed, "ownerId" | "lastSyncedAt" | "enrichedAt" | "enrichmentSource">[] = [
  { linkedinUrn: "urn:li:seed:matan-cohen", linkedinUrl: "https://www.linkedin.com/in/matan-cohen", fullName: "Matan Cohen", hebrewFirstName: "מתן", currentTitle: "VP Product", currentCompany: "Wix", companySize: 6000, seniority: "VP", function: "PRODUCT", industry: "SaaS", email: "matan.cohen@wix.com", phone: null },
  { linkedinUrn: "urn:li:seed:noa-levy", linkedinUrl: "https://www.linkedin.com/in/noa-levy", fullName: "Noa Levy", hebrewFirstName: "נועה", currentTitle: "Head of Engineering", currentCompany: "monday.com", companySize: 1800, seniority: "DIRECTOR", function: "ENGINEERING", industry: "SaaS", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:yoav-shamir", linkedinUrl: "https://www.linkedin.com/in/yoav-shamir", fullName: "Yoav Shamir", hebrewFirstName: "יואב", currentTitle: "Director of Sales", currentCompany: "Fiverr", companySize: 900, seniority: "DIRECTOR", function: "SALES", industry: "E-commerce", email: "yoav.shamir@fiverr.com", phone: "0521234567" },
  { linkedinUrn: "urn:li:seed:tamar-katz", linkedinUrl: "https://www.linkedin.com/in/tamar-katz", fullName: "Tamar Katz", hebrewFirstName: "תמר", currentTitle: "CTO", currentCompany: "Dazz", companySize: 120, seniority: "C_LEVEL", function: "ENGINEERING", industry: "Cyber", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:gil-peretz", linkedinUrl: "https://www.linkedin.com/in/gil-peretz", fullName: "Gil Peretz", hebrewFirstName: "גיל", currentTitle: "Engineering Manager", currentCompany: "Similarweb", companySize: 800, seniority: "MANAGER", function: "ENGINEERING", industry: "SaaS", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:shira-ben-david", linkedinUrl: "https://www.linkedin.com/in/shira-ben-david", fullName: "Shira Ben-David", hebrewFirstName: "שירה", currentTitle: "VP Marketing", currentCompany: "AppsFlyer", companySize: 1000, seniority: "VP", function: "MARKETING", industry: "SaaS", email: "shira@appsflyer.com", phone: null },
  { linkedinUrn: "urn:li:seed:oren-mizrahi", linkedinUrl: "https://www.linkedin.com/in/oren-mizrahi", fullName: "Oren Mizrahi", hebrewFirstName: "אורן", currentTitle: "Senior Product Manager", currentCompany: "Incredibuild", companySize: 200, seniority: "IC", function: "PRODUCT", industry: "DevTools", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:maya-solomon", linkedinUrl: "https://www.linkedin.com/in/maya-solomon", fullName: "Maya Solomon", hebrewFirstName: "מאיה", currentTitle: "HR Director", currentCompany: "Playtika", companySize: 3800, seniority: "DIRECTOR", function: "HR", industry: "Gaming", email: "maya.solomon@playtika.com", phone: null },
  { linkedinUrn: "urn:li:seed:amir-goldstein", linkedinUrl: "https://www.linkedin.com/in/amir-goldstein", fullName: "Amir Goldstein", hebrewFirstName: "אמיר", currentTitle: "CEO", currentCompany: "Finout", companySize: 45, seniority: "C_LEVEL", function: "OTHER", industry: "FinTech", email: "amir@finout.io", phone: "0541111222" },
  { linkedinUrn: "urn:li:seed:dani-shapiro", linkedinUrl: "https://www.linkedin.com/in/dani-shapiro", fullName: "Dani Shapiro", hebrewFirstName: "דני", currentTitle: "Senior Software Engineer", currentCompany: "Outbrain", companySize: 900, seniority: "IC", function: "ENGINEERING", industry: "AdTech", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:ron-bar", linkedinUrl: "https://www.linkedin.com/in/ron-bar", fullName: "Ron Bar", hebrewFirstName: "רון", currentTitle: "Head of Sales", currentCompany: "Zerto", companySize: 400, seniority: "DIRECTOR", function: "SALES", industry: "Cyber", email: "ron.bar@zerto.com", phone: null },
  { linkedinUrn: "urn:li:seed:liron-cohen", linkedinUrl: "https://www.linkedin.com/in/liron-cohen", fullName: "Liron Cohen", hebrewFirstName: "לירון", currentTitle: "COO", currentCompany: "Papaya Global", companySize: 600, seniority: "C_LEVEL", function: "OPERATIONS", industry: "HR-Tech", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:daniel-avraham", linkedinUrl: "https://www.linkedin.com/in/daniel-avraham", fullName: "Daniel Avraham", hebrewFirstName: "דניאל", currentTitle: "VP Engineering", currentCompany: "Tipalti", companySize: 1200, seniority: "VP", function: "ENGINEERING", industry: "FinTech", email: "daniel.avraham@tipalti.com", phone: null },
  { linkedinUrn: "urn:li:seed:sarah-green", linkedinUrl: "https://www.linkedin.com/in/sarah-green-il", fullName: "Sarah Green", hebrewFirstName: null, currentTitle: "Product Lead", currentCompany: "Gett", companySize: 300, seniority: "DIRECTOR", function: "PRODUCT", industry: "Mobility", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:eyal-rozenberg", linkedinUrl: "https://www.linkedin.com/in/eyal-rozenberg", fullName: "Eyal Rozenberg", hebrewFirstName: "אייל", currentTitle: "Marketing Manager", currentCompany: "WalkMe", companySize: 700, seniority: "MANAGER", function: "MARKETING", industry: "SaaS", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:anna-petrov", linkedinUrl: "https://www.linkedin.com/in/anna-petrov-il", fullName: "Anna Petrov", hebrewFirstName: null, currentTitle: "Data Scientist", currentCompany: "Veritas", companySize: 8000, seniority: "IC", function: "ENGINEERING", industry: "Cyber", email: "anna.petrov@veritas.com", phone: null },
  { linkedinUrn: "urn:li:seed:itay-barak", linkedinUrl: "https://www.linkedin.com/in/itay-barak", fullName: "Itay Barak", hebrewFirstName: "איתי", currentTitle: "VP R&D", currentCompany: "Cybereason", companySize: 500, seniority: "VP", function: "ENGINEERING", industry: "Cyber", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:michal-levi", linkedinUrl: "https://www.linkedin.com/in/michal-levi", fullName: "Michal Levi", hebrewFirstName: "מיכל", currentTitle: "Talent Acquisition Manager", currentCompany: "Amdocs", companySize: 25000, seniority: "MANAGER", function: "HR", industry: "Telecom", email: "michal.levi@amdocs.com", phone: "0538887766" },
  { linkedinUrn: "urn:li:seed:yuval-nachum", linkedinUrl: "https://www.linkedin.com/in/yuval-nachum", fullName: "Yuval Nachum", hebrewFirstName: "יובל", currentTitle: "CFO", currentCompany: "Moovit", companySize: 350, seniority: "C_LEVEL", function: "FINANCE", industry: "Mobility", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:nir-amit", linkedinUrl: "https://www.linkedin.com/in/nir-amit", fullName: "Nir Amit", hebrewFirstName: "ניר", currentTitle: "Backend Engineer", currentCompany: "eToro", companySize: 1500, seniority: "IC", function: "ENGINEERING", industry: "FinTech", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:ofir-ben-moshe", linkedinUrl: "https://www.linkedin.com/in/ofir-ben-moshe", fullName: "Ofir Ben-Moshe", hebrewFirstName: "אופיר", currentTitle: "Director of Product", currentCompany: "Taboola", companySize: 1700, seniority: "DIRECTOR", function: "PRODUCT", industry: "AdTech", email: "ofir@taboola.com", phone: null },
  { linkedinUrn: "urn:li:seed:hila-dagan", linkedinUrl: "https://www.linkedin.com/in/hila-dagan", fullName: "Hila Dagan", hebrewFirstName: "הילה", currentTitle: "Sales Development Rep", currentCompany: "CrowdStrike", companySize: 5000, seniority: "IC", function: "SALES", industry: "Cyber", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:tom-friedman", linkedinUrl: "https://www.linkedin.com/in/tom-friedman-il", fullName: "Tom Friedman", hebrewFirstName: "תום", currentTitle: "Engineering Team Lead", currentCompany: "Riskified", companySize: 600, seniority: "MANAGER", function: "ENGINEERING", industry: "FinTech", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:yael-shimoni", linkedinUrl: "https://www.linkedin.com/in/yael-shimoni", fullName: "Yael Shimoni", hebrewFirstName: "יעל", currentTitle: "Head of Product", currentCompany: "Lemonade", companySize: 800, seniority: "DIRECTOR", function: "PRODUCT", industry: "InsurTech", email: "yael@lemonade.com", phone: null },
  { linkedinUrn: "urn:li:seed:barak-cohen", linkedinUrl: "https://www.linkedin.com/in/barak-cohen-tech", fullName: "Barak Cohen", hebrewFirstName: "ברק", currentTitle: "CRO", currentCompany: "Snyk", companySize: 1200, seniority: "C_LEVEL", function: "SALES", industry: "Cyber", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:rotem-gross", linkedinUrl: "https://www.linkedin.com/in/rotem-gross", fullName: "Rotem Gross", hebrewFirstName: "רותם", currentTitle: "UX Designer", currentCompany: "Elementor", companySize: 300, seniority: "IC", function: "PRODUCT", industry: "SaaS", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:alex-berlin", linkedinUrl: "https://www.linkedin.com/in/alex-berlin-il", fullName: "Alex Berlin", hebrewFirstName: null, currentTitle: "VP Finance", currentCompany: "ironSource", companySize: 1600, seniority: "VP", function: "FINANCE", industry: "AdTech", email: "alex.berlin@is.com", phone: null },
  { linkedinUrn: "urn:li:seed:neta-hazan", linkedinUrl: "https://www.linkedin.com/in/neta-hazan", fullName: "Neta Hazan", hebrewFirstName: "נטע", currentTitle: "People Operations Manager", currentCompany: "OwnBackup", companySize: 500, seniority: "MANAGER", function: "HR", industry: "SaaS", email: null, phone: null },
  { linkedinUrn: "urn:li:seed:eran-oz", linkedinUrl: "https://www.linkedin.com/in/eran-oz", fullName: "Eran Oz", hebrewFirstName: "ערן", currentTitle: "Senior Account Executive", currentCompany: "Armis", companySize: 700, seniority: "IC", function: "SALES", industry: "Cyber", email: "eran.oz@armis.com", phone: "0529988776" },
  { linkedinUrn: "urn:li:seed:gali-mor", linkedinUrl: "https://www.linkedin.com/in/gali-mor", fullName: "Gali Mor", hebrewFirstName: "גלי", currentTitle: "Head of Marketing", currentCompany: "BigPanda", companySize: 200, seniority: "DIRECTOR", function: "MARKETING", industry: "SaaS", email: null, phone: null },
];

export function buildContacts(ownerId: string): ContactSeed[] {
  const now = new Date();
  return RAW_CONTACTS.map((raw) => ({
    ...raw,
    ownerId,
    lastSyncedAt: now,
    enrichedAt: raw.email ? now : null,
    enrichmentSource: raw.email ? "hubspot" : null,
  }));
}

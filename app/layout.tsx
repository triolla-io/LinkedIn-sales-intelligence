import type { Metadata } from "next";
import { Assistant, Frank_Ruhl_Libre, Geist_Mono } from "next/font/google";
import "./globals.css";
import { StagingBanner } from "@/components/staging-banner";

// גוף הממשק — Assistant: פנים עברית ניטרלית, קריאה בצפיפות גבוהה
const assistant = Assistant({
  variable: "--font-assistant",
  subsets: ["latin", "hebrew"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// תצוגה — Frank Ruhl Libre: הסריף שנותן לפתיח הנרטיבי קול של מכתב, לא של מערכת
const frankRuhl = Frank_Ruhl_Libre({
  variable: "--font-frank-ruhl",
  subsets: ["latin", "hebrew"],
  weight: ["500", "700", "800", "900"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "LeadFlow",
  description: "פלטפורמת מכירות חכמה",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${assistant.variable} ${frankRuhl.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <StagingBanner />
        {children}
      </body>
    </html>
  );
}

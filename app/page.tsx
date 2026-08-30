import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Linked",
  description: "Linked — פלטפורמת מכירות חכמה",
};

export default function Home() {
  redirect("/dashboard");
}

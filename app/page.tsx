import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LinkedIn Sales Intelligence",
  description: "LinkedIn Sales Intelligence platform",
};

export default function Home() {
  redirect("/dashboard");
}

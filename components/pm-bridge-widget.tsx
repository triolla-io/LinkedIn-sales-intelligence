"use client";

// The widget bundle is vendored rather than installed from GitHub Packages —
// see vendor/pmbridge-react/README.md for why.
import { PmBridge } from "@/vendor/pmbridge-react";
import "@/vendor/pmbridge-react/styles.css";

async function getToken(): Promise<string> {
  const res = await fetch("/api/pmb-token");
  if (!res.ok) throw new Error("token mint failed");
  return res.text();
}

export function PmBridgeWidget() {
  return <PmBridge boxUrl="https://pmbridge.triolla.io" getToken={getToken} />;
}

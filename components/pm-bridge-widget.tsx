"use client";

import { PmBridge } from "@triolla-io/pmbridge-react";
import "@triolla-io/pmbridge-react/styles.css";

async function getToken(): Promise<string> {
  const res = await fetch("/api/pmb-token");
  if (!res.ok) throw new Error("token mint failed");
  return res.text();
}

export function PmBridgeWidget() {
  return <PmBridge boxUrl="https://pmbridge.triolla.io" getToken={getToken} />;
}

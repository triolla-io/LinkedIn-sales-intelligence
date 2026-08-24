import { Suspense } from "react";
import { RadarShell } from "./radar-shell";

export default function RadarPage() {
  // useSearchParams in the shell requires a Suspense boundary at the page level.
  return (
    <Suspense fallback={null}>
      <RadarShell />
    </Suspense>
  );
}

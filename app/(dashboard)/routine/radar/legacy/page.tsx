import { RadarReview } from "../radar-review";

/**
 * The pre-redesign debug screen, alive until the decisions tab ships — the pilot lives
 * on debugging, and there must be no window without it. Deleted in the same deploy that
 * brings up the decisions tab, not before.
 */
export default function RadarLegacyPage() {
  return <RadarReview />;
}

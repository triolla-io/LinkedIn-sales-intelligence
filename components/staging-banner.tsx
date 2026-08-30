export function StagingBanner() {
  if (process.env.APP_ENV !== "staging") return null;
  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[9999] bg-[var(--warning)] text-ink text-center text-sm font-semibold py-1"
    >
      STAGING — test environment. Sends are rerouted; no real customers are contacted.
    </div>
  );
}

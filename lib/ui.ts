/**
 * Shared UI class tokens for the Linked dashboard.
 *
 * One source of truth for the warm-neutral + brand-blue design system so pages
 * don't re-hardcode hex. Compose with `cn()` when adding per-use classes.
 *
 * Palette: page bg #f6f5f3 (body default) · card white · lines #e7e4dd/#dcd8d0
 * · ink #1a1917 · muted #6b6866 / #9b9895 · brand #1585ff (hover #0a70e0).
 */
export const ui = {
  /** Floating white card that lifts off the #f6f5f3 background. */
  card: "bg-white border border-[#e7e4dd] rounded-2xl shadow-[0_1px_2px_rgba(17,17,16,0.04),0_4px_12px_-4px_rgba(17,17,16,0.06)]",

  /** Crisp white form field with a faint recessed feel; blue only on focus. */
  input:
    "w-full bg-white border border-[#dcd8d0] rounded-lg px-3 py-2 text-sm text-[#1a1917] placeholder-[#b8b4ae] shadow-[inset_0_1px_2px_rgba(17,17,16,0.03)] focus:outline-none focus:ring-2 focus:ring-[#1585ff]/15 focus:border-[#1585ff] transition disabled:cursor-not-allowed disabled:bg-[#f4f2ee] disabled:text-[#9b9895]",

  /** Field label above an input. */
  label: "block text-xs font-medium text-[#6b6866] mb-1",

  /** Card / section heading. */
  sectionTitle: "text-sm font-semibold text-[#1a1917]",

  /** Primary action. */
  btnPrimary:
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#1585ff] rounded-lg shadow-[0_1px_2px_rgba(21,133,255,0.4)] hover:bg-[#0a70e0] transition-[background-color,transform] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",

  /** Secondary (bordered) action. */
  btnSecondary:
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-[#1a1917] bg-white border border-[#e7e4dd] rounded-lg hover:bg-[#f6f5f2] transition-colors disabled:opacity-50",

  /** Ghost / tertiary action. */
  btnGhost:
    "inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm text-[#6b6866] hover:bg-[#f3f2ef] rounded-lg transition-colors disabled:opacity-50",

  /** Small neutral pill / chip. */
  chip: "inline-flex items-center gap-1 text-[11px] text-[#6b6866] bg-[#f3f2ef] rounded-full px-2 py-0.5",
} as const;

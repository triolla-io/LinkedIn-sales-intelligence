"use client";

import { DAY_LETTERS_HE, formatSendWindowHe } from "@/lib/prospecting/send-window";

export type SendWindow = {
  sendDays: number[];
  sendHoursStart: number;
  sendHoursEnd: number;
  sendMinutesStart: number;
  sendMinutesEnd: number;
};

const STEP_MIN = 30;
const fmtMod = (mod: number) => `${String(Math.floor(mod / 60)).padStart(2, "0")}:${String(mod % 60).padStart(2, "0")}`;

/** The window as minute-of-day bounds — the selects operate in this space. */
function toMod(w: SendWindow): { start: number; end: number } {
  return {
    start: w.sendHoursStart * 60 + w.sendMinutesStart,
    end: w.sendHoursEnd * 60 + w.sendMinutesEnd,
  };
}

function withBounds(w: SendWindow, start: number, end: number): SendWindow {
  return {
    ...w,
    sendHoursStart: Math.floor(start / 60),
    sendMinutesStart: start % 60,
    sendHoursEnd: Math.floor(end / 60),
    sendMinutesEnd: end % 60,
  };
}

/**
 * Google-Calendar-style recurrence picker: 7 circular day chips (Sun-Sat, RTL)
 * + half-hour-step time-range selects + a live Hebrew summary. Invalid states
 * are unreachable: the last active day can't be untoggled and end-time options
 * always start after the chosen start time.
 */
export function SendWindowPicker({
  value,
  onChange,
  compact = false,
}: {
  value: SendWindow;
  onChange: (next: SendWindow) => void;
  compact?: boolean;
}) {
  const { sendDays } = value;
  const { start, end } = toMod(value);
  // 00:00 … 23:30 in half-hour steps; end options run from start+30 min up to 24:00.
  const startOptions = Array.from({ length: (24 * 60) / STEP_MIN }, (_, i) => i * STEP_MIN);
  const endOptions = startOptions.filter((mod) => mod > start).concat(24 * 60);

  function toggleDay(day: number) {
    const active = sendDays.includes(day);
    if (active && sendDays.length === 1) return; // keep at least one day
    const next = active ? sendDays.filter((d) => d !== day) : [...sendDays, day].sort((a, b) => a - b);
    onChange({ ...value, sendDays: next });
  }

  function onStartChange(nextStart: number) {
    onChange(withBounds(value, nextStart, Math.max(end, nextStart + STEP_MIN)));
  }

  function onEndChange(nextEnd: number) {
    onChange(withBounds(value, start, nextEnd));
  }

  if (compact) {
    return (
      <div dir="rtl" className="flex flex-col gap-1.5">
        <span className="block text-xs font-medium text-[var(--muted)]">ימי שליחה</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex gap-1" role="group" aria-label="ימי שליחה">
            {DAY_LETTERS_HE.map((letter, day) => {
              const active = sendDays.includes(day);
              const isLast = active && sendDays.length === 1;
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={active}
                  title={isLast ? "חייב להישאר לפחות יום אחד" : undefined}
                  onClick={() => toggleDay(day)}
                  className={`size-7 rounded-full text-[11px] font-medium transition-all ${
                    active
                      ? `bg-[var(--accent)] text-white shadow-sm ${isLast ? "cursor-default" : "hover:bg-[var(--accent-strong)]"}`
                      : "bg-[var(--surface-secondary)] text-[var(--muted)] hover:bg-[var(--line)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {letter}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-[var(--faint)] mx-0.5">·</span>
          <select
            aria-label="שעת התחלה"
            value={start}
            onChange={(e) => onStartChange(Number(e.target.value))}
            className="bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-1.5 py-1 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
          >
            {startOptions.map((mod) => (
              <option key={mod} value={mod}>{fmtMod(mod)}</option>
            ))}
          </select>
          <span className="text-xs text-[var(--faint)]">—</span>
          <select
            aria-label="שעת סיום"
            value={end}
            onChange={(e) => onEndChange(Number(e.target.value))}
            className="bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-1.5 py-1 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
          >
            {endOptions.map((mod) => (
              <option key={mod} value={mod}>{fmtMod(mod)}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-2.5">
      <div>
        <span className="block text-xs font-medium text-[var(--muted)] mb-1.5">ימי שליחה</span>
        <div className="flex gap-1.5" role="group" aria-label="ימי שליחה">
          {DAY_LETTERS_HE.map((letter, day) => {
            const active = sendDays.includes(day);
            const isLast = active && sendDays.length === 1;
            return (
              <button
                key={day}
                type="button"
                aria-pressed={active}
                title={isLast ? "חייב להישאר לפחות יום אחד" : undefined}
                onClick={() => toggleDay(day)}
                className={`size-8 rounded-full text-xs font-medium transition-all ${
                  active
                    ? `bg-[var(--accent)] text-white shadow-sm ${isLast ? "cursor-default" : "hover:bg-[var(--accent-strong)]"}`
                    : "bg-[var(--surface-secondary)] text-[var(--muted)] hover:bg-[var(--line)] hover:text-[var(--foreground)]"
                }`}
              >
                {letter}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-[var(--muted)]">בין השעות</span>
        <select
          aria-label="שעת התחלה"
          value={start}
          onChange={(e) => onStartChange(Number(e.target.value))}
          className="bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-2 py-1.5 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
        >
          {startOptions.map((mod) => (
            <option key={mod} value={mod}>
              {fmtMod(mod)}
            </option>
          ))}
        </select>
        <span className="text-xs text-[var(--faint)]">—</span>
        <select
          aria-label="שעת סיום"
          value={end}
          onChange={(e) => onEndChange(Number(e.target.value))}
          className="bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-2 py-1.5 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
        >
          {endOptions.map((mod) => (
            <option key={mod} value={mod}>
              {fmtMod(mod)}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-[var(--faint)]">
        {formatSendWindowHe(sendDays, value.sendHoursStart, value.sendHoursEnd, value.sendMinutesStart, value.sendMinutesEnd)}
      </p>
    </div>
  );
}

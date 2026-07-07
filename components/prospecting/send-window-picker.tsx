"use client";

import { DAY_LETTERS_HE, formatSendWindowHe } from "@/lib/prospecting/send-window";

export type SendWindow = { sendDays: number[]; sendHoursStart: number; sendHoursEnd: number };

const fmtHour = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Google-Calendar-style recurrence picker: 7 circular day chips (Sun-Sat, RTL)
 * + whole-hour range selects + a live Hebrew summary. Invalid states are
 * unreachable: the last active day can't be untoggled and end-hour options
 * always start after the chosen start hour.
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
  const { sendDays, sendHoursStart, sendHoursEnd } = value;

  function toggleDay(day: number) {
    const active = sendDays.includes(day);
    if (active && sendDays.length === 1) return; // keep at least one day
    const next = active ? sendDays.filter((d) => d !== day) : [...sendDays, day].sort((a, b) => a - b);
    onChange({ ...value, sendDays: next });
  }

  if (compact) {
    return (
      <div dir="rtl" className="flex flex-col gap-1.5">
        <span className="block text-xs font-medium text-[#6b6866]">ימי שליחה</span>
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
                      ? `bg-[#1585ff] text-white shadow-sm ${isLast ? "cursor-default" : "hover:bg-[#0a70e0]"}`
                      : "bg-[#f3f2ef] text-[#6b6866] hover:bg-[#e9e7e3] hover:text-[#111110]"
                  }`}
                >
                  {letter}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-[#9b9895] mx-0.5">·</span>
          <select
            aria-label="שעת התחלה"
            value={sendHoursStart}
            onChange={(e) => {
              const start = Number(e.target.value);
              onChange({ ...value, sendHoursStart: start, sendHoursEnd: Math.max(sendHoursEnd, start + 1) });
            }}
            className="bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-1.5 py-1 text-xs text-[#111110] focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{fmtHour(h)}</option>
            ))}
          </select>
          <span className="text-xs text-[#9b9895]">—</span>
          <select
            aria-label="שעת סיום"
            value={sendHoursEnd}
            onChange={(e) => onChange({ ...value, sendHoursEnd: Number(e.target.value) })}
            className="bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-1.5 py-1 text-xs text-[#111110] focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors"
          >
            {Array.from({ length: 24 - sendHoursStart }, (_, i) => sendHoursStart + 1 + i).map((h) => (
              <option key={h} value={h}>{fmtHour(h)}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-2.5">
      <div>
        <span className="block text-xs font-medium text-[#6b6866] mb-1.5">ימי שליחה</span>
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
                    ? `bg-[#1585ff] text-white shadow-sm ${isLast ? "cursor-default" : "hover:bg-[#0a70e0]"}`
                    : "bg-[#f3f2ef] text-[#6b6866] hover:bg-[#e9e7e3] hover:text-[#111110]"
                }`}
              >
                {letter}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-[#6b6866]">בין השעות</span>
        <select
          aria-label="שעת התחלה"
          value={sendHoursStart}
          onChange={(e) => {
            const start = Number(e.target.value);
            onChange({ ...value, sendHoursStart: start, sendHoursEnd: Math.max(sendHoursEnd, start + 1) });
          }}
          className="bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-2 py-1.5 text-sm text-[#111110] focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors"
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {fmtHour(h)}
            </option>
          ))}
        </select>
        <span className="text-xs text-[#9b9895]">—</span>
        <select
          aria-label="שעת סיום"
          value={sendHoursEnd}
          onChange={(e) => onChange({ ...value, sendHoursEnd: Number(e.target.value) })}
          className="bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-2 py-1.5 text-sm text-[#111110] focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors"
        >
          {Array.from({ length: 24 - sendHoursStart }, (_, i) => sendHoursStart + 1 + i).map((h) => (
            <option key={h} value={h}>
              {fmtHour(h)}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-[#9b9895]">{formatSendWindowHe(sendDays, sendHoursStart, sendHoursEnd)}</p>
    </div>
  );
}

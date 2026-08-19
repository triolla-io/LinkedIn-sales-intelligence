"use client";

import { useState } from "react";
import {
  Modal,
  ModalBackdrop,
  ModalContainer,
  ModalDialog,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from "@heroui/react";
import { Building2, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { CompaniesInput } from "@/components/prospecting/companies-input";
import { parseCompanyLines } from "@/lib/prospecting/company-lines";
import { ERROR_CODE_LABELS } from "@/lib/prospecting/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";

export type CompanyTargetRow = {
  id: string;
  name: string;
  nameHebrew: string | null;
  linkedinUrl: string | null;
  linkedinSlug: string | null;
  linkedinCompanyId: string | null;
  resolvedName: string | null;
  status:
    | "PENDING"
    | "RESOLVING"
    | "READY"
    | "SEARCHING"
    | "DONE"
    | "FAILED"
    | "REMOVED";
  discoveredCount: number;
  /** People LinkedIn returned for this company, whether or not they held a searched role. */
  scannedCount: number;
  sentCount: number;
  error: string | null;
};

const TARGET_STATUS: Record<
  CompanyTargetRow["status"],
  { label: string; cls: string; pulse?: boolean }
> = {
  PENDING: { label: "ממתין", cls: "bg-[#f3f2ef] text-[#6b6866]" },
  RESOLVING: {
    label: "מזהה חברה",
    cls: "bg-[#e6f4ff] text-[#1585ff]",
    pulse: true,
  },
  READY: { label: "זוהתה", cls: "bg-[#e6f4ff] text-[#1585ff]" },
  SEARCHING: {
    label: "מחפש אנשים",
    cls: "bg-[#fff8e6] text-[#b45309]",
    pulse: true,
  },
  DONE: { label: "הושלם", cls: "bg-[#e6faf0] text-[#059669]" },
  FAILED: { label: "נכשל", cls: "bg-[#fff3f3] text-[#dc2626]" },
  REMOVED: { label: "הוסר", cls: "bg-[#f3f2ef] text-[#9b9895]" },
};

const TERMINAL: CompanyTargetRow["status"][] = ["DONE", "FAILED", "REMOVED"];

/** Filter groups shown as clickable chips in the card header. */
type StatusGroup = "DONE" | "FAILED" | "ACTIVE" | "REMOVED";

function statusGroup(status: CompanyTargetRow["status"]): StatusGroup {
  if (status === "DONE") return "DONE";
  if (status === "FAILED") return "FAILED";
  if (status === "REMOVED") return "REMOVED";
  return "ACTIVE"; // PENDING / RESOLVING / READY / SEARCHING
}

const GROUP_CHIPS: { key: StatusGroup; label: string; cls: string }[] = [
  { key: "DONE", label: "הושלמו", cls: "bg-[#e6faf0] text-[#059669]" },
  { key: "FAILED", label: "נכשלו", cls: "bg-[#fff3f3] text-[#dc2626]" },
  { key: "ACTIVE", label: "בתהליך", cls: "bg-[#e6f4ff] text-[#1585ff]" },
  { key: "REMOVED", label: "הוסרו", cls: "bg-[#f3f2ef] text-[#9b9895]" },
];

function matchUrl(t: CompanyTargetRow): string | null {
  if (t.linkedinSlug)
    return `https://www.linkedin.com/company/${t.linkedinSlug}`;
  return t.linkedinUrl;
}

export function CompanyTargetsCard({
  runId,
  targets,
  onChanged,
}: {
  runId: string;
  targets: CompanyTargetRow[];
  onChanged: () => void;
}) {
  const [removing, setRemoving] = useState<CompanyTargetRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addText, setAddText] = useState("");
  const [addFile, setAddFile] = useState<File | null>(null);
  const [groupFilter, setGroupFilter] = useState<StatusGroup | null>(null);

  const processed = targets.filter((t) => TERMINAL.includes(t.status)).length;
  const pct =
    targets.length > 0 ? Math.round((processed / targets.length) * 100) : 0;
  const groupCounts = targets.reduce(
    (acc, t) => {
      acc[statusGroup(t.status)]++;
      return acc;
    },
    { DONE: 0, FAILED: 0, ACTIVE: 0, REMOVED: 0 } as Record<StatusGroup, number>,
  );
  const visibleTargets = groupFilter
    ? targets.filter((t) => statusGroup(t.status) === groupFilter)
    : targets;

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/prospecting/runs/${runId}/companies/${removing.id}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("הסרת החברה נכשלה");
        return;
      }
      toast.success(
        `${removing.name} הוסרה`,
        data.cancelled > 0
          ? `${data.cancelled} אנשים שטרם נשלחו בוטלו`
          : undefined,
      );
      setRemoving(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd() {
    const companies = parseCompanyLines(addText);
    if (companies.length === 0 && !addFile) {
      toast.error("נדרשת לפחות חברה אחת");
      return;
    }
    setBusy(true);
    try {
      let added = 0;
      let skipped = 0;
      if (companies.length > 0) {
        const res = await fetch(`/api/prospecting/runs/${runId}/companies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companies }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(
            "הוספת החברות נכשלה",
            typeof data.error === "string" ? data.error : undefined,
          );
          return;
        }
        added += data.added ?? 0;
        skipped += (data.skippedExisting ?? 0) + (data.skippedInvalid ?? 0);
      }
      if (addFile) {
        const form = new FormData();
        form.append("file", addFile);
        const res = await fetch(`/api/prospecting/runs/${runId}/companies`, {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(
            "העלאת הקובץ נכשלה",
            typeof data.error === "string" ? data.error : undefined,
          );
          return;
        }
        added += data.added ?? 0;
        skipped += (data.skippedExisting ?? 0) + (data.skippedInvalid ?? 0);
      }
      toast.success(
        `${added} חברות נוספו`,
        skipped > 0
          ? `${skipped} שורות דולגו (כפולות או לא תקינות)`
          : undefined,
      );
      setAddText("");
      setAddFile(null);
      setAddOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="bg-white border border-[#e5e3df] rounded-xl overflow-hidden"
      dir="rtl"
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#f3f2ef]">
        <Building2 className="w-4 h-4 text-[#6b6866] shrink-0" />
        <h2 className="text-sm font-medium text-[#111110]">חברות</h2>
        <span className="text-xs text-[#9b9895] tabular-nums">
          עובדו {processed}/{targets.length}
        </span>
        {/* Truthful breakdown — each chip filters the table below. */}
        <div className="flex flex-wrap gap-1.5">
          {GROUP_CHIPS.filter((c) => groupCounts[c.key] > 0).map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() =>
                setGroupFilter(groupFilter === c.key ? null : c.key)
              }
              className={cn(
                "text-xs px-2.5 py-1 rounded-full transition-shadow cursor-pointer tabular-nums",
                c.cls,
                groupFilter === c.key
                  ? "ring-2 ring-[#1585ff] ring-offset-1"
                  : "hover:ring-1 hover:ring-[#c8c5c2]",
              )}
            >
              {c.label} {groupCounts[c.key]}
            </button>
          ))}
          {groupFilter && (
            <button
              type="button"
              onClick={() => setGroupFilter(null)}
              className="text-xs text-[#1585ff] hover:underline cursor-pointer px-1"
            >
              הצג הכל
            </button>
          )}
        </div>
        <div
          className="flex-1 min-w-24 h-1.5 bg-[#f3f2ef] rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-[#1585ff] rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1585ff] hover:text-[#0a70e0] px-2.5 py-2 rounded-md hover:bg-[#e6f4ff] transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          הוסף חברות
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right text-xs text-[#9b9895] border-b border-[#f3f2ef]">
              <th className="px-4 py-2 font-medium">חברה</th>
              <th className="px-4 py-2 font-medium">התאמה בלינקדאין</th>
              <th className="px-4 py-2 font-medium">סטטוס</th>
              <th className="px-4 py-2 font-medium">נמצאו</th>
              <th className="px-4 py-2 font-medium">נשלחו</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f3f2ef]">
            {visibleTargets.map((t, i) => {
              const st = TARGET_STATUS[t.status];
              const url = matchUrl(t);
              const removed = t.status === "REMOVED";
              return (
                <tr
                  key={t.id}
                  className={cn(
                    "animate-in fade-in slide-in-from-bottom-1 duration-300 fill-mode-backwards",
                    removed && "opacity-50",
                  )}
                  style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                >
                  <td className="px-4 py-2.5">
                    <div
                      className={cn(
                        "text-[#111110]",
                        removed && "line-through",
                      )}
                    >
                      {t.name}
                    </div>
                    {t.nameHebrew && t.nameHebrew !== t.name && (
                      <div className="text-xs text-[#9b9895]">
                        {t.nameHebrew}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#1585ff] hover:underline"
                        dir="ltr"
                      >
                        {t.resolvedName ?? t.linkedinSlug ?? "לינקדאין"}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-[#c8c5c2]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      title={
                        t.status === "FAILED" && t.error
                          ? (ERROR_CODE_LABELS[t.error] ?? t.error)
                          : undefined
                      }
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                        st.cls,
                        st.pulse && "animate-pulse",
                      )}
                    >
                      {st.label}
                    </span>
                    {t.status === "FAILED" && t.error && (
                      <div className="text-[10px] text-[#dc2626] mt-0.5">
                        {ERROR_CODE_LABELS[t.error] ?? t.error}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-[#111110]">
                    {t.discoveredCount}
                    {/* A bare "0" hid the real story: people WERE returned, none held the role. */}
                    {t.discoveredCount === 0 && t.scannedCount > 0 && (
                      <div className="text-[10px] text-[#9b9895]">
                        {t.scannedCount} נסרקו
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-[#111110]">
                    {t.sentCount}
                  </td>
                  <td className="px-4 py-2.5 text-left">
                    {!removed && (
                      <button
                        type="button"
                        aria-label={`הסר את ${t.name}`}
                        onClick={() => setRemoving(t)}
                        className="p-2 rounded-md text-[#9b9895] hover:text-[#dc2626] hover:bg-[#fff3f3] transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {visibleTargets.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-sm text-[#9b9895]"
                >
                  {targets.length === 0
                    ? "אין חברות עדיין — הוסף חברות כדי להתחיל"
                    : `אין חברות בסטטוס "${GROUP_CHIPS.find((c) => c.key === groupFilter)?.label ?? ""}"`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Remove confirmation */}
      <Modal
        isOpen={removing !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setRemoving(null);
        }}
      >
        <ModalBackdrop>
          <ModalContainer>
            <ModalDialog>
              <ModalHeader>הסרת חברה</ModalHeader>
              <ModalBody>
                <p className="text-sm text-foreground" dir="rtl">
                  להסיר את <b>{removing?.name}</b> מהרוטינה? בקשות חברות שטרם
                  נשלחו לאנשי החברה יבוטלו. בקשות שכבר נשלחו לא יושפעו.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="ghost"
                  onPress={() => setRemoving(null)}
                  isDisabled={busy}
                >
                  ביטול
                </Button>
                <Button
                  variant="danger"
                  onPress={confirmRemove}
                  isDisabled={busy}
                >
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "הסר חברה"
                  )}
                </Button>
              </ModalFooter>
            </ModalDialog>
          </ModalContainer>
        </ModalBackdrop>
      </Modal>

      {/* Add companies */}
      <Modal
        isOpen={addOpen}
        onOpenChange={(open: boolean) => {
          if (!open) setAddOpen(false);
        }}
      >
        <ModalBackdrop>
          <ModalContainer>
            <ModalDialog>
              <ModalHeader>הוספת חברות</ModalHeader>
              <ModalBody>
                <CompaniesInput
                  value={addText}
                  onChange={setAddText}
                  file={addFile}
                  onFileChange={setAddFile}
                  disabled={busy}
                />
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="ghost"
                  onPress={() => setAddOpen(false)}
                  isDisabled={busy}
                >
                  ביטול
                </Button>
                <Button variant="primary" onPress={submitAdd} isDisabled={busy}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "הוסף"}
                </Button>
              </ModalFooter>
            </ModalDialog>
          </ModalContainer>
        </ModalBackdrop>
      </Modal>
    </div>
  );
}

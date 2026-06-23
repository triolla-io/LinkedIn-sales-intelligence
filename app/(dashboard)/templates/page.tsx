"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { textToEmailHtml } from "@/lib/email/render";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import { FileText, Plus, Trash2, Edit2, RefreshCw, Zap } from "lucide-react";

interface Template {
  id: string;
  name: string;
  body: string;
  createdAt: string;
}

const VARIABLE_CHIPS = ["{{firstName}}", "{{hebrewFirstName}}", "{{lastName}}", "{{company}}", "{{title}}"];

function HighlightedBody({ text }: { text: string }) {
  type Seg = { pos: number; content: string; isVar: boolean };
  const segments: Seg[] = [];
  let pos = 0;
  const re = /({{[^}]+}})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > pos) segments.push({ pos, content: text.slice(pos, m.index), isVar: false });
    segments.push({ pos: m.index, content: m[0], isVar: true });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) segments.push({ pos, content: text.slice(pos), isVar: false });
  return (
    <>
      {segments.map(({ pos: p, content, isVar }) =>
        isVar ? (
          <span key={p} className="text-amber-600 font-mono bg-amber-50 px-1 rounded text-xs">
            {content}
          </span>
        ) : (
          <span key={p}>{content}</span>
        )
      )}
    </>
  );
}

interface TemplateFormProps {
  initial?: { name: string; body: string };
  onSubmit: (data: { name: string; body: string }) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}

type FormState = { name: string; body: string; loading: boolean; error: string | null };

function TemplateForm({ initial, onSubmit, onCancel, submitLabel }: TemplateFormProps) {
  const [formState, formDispatch] = useReducer(
    (s: FormState, action: Partial<FormState>) => ({ ...s, ...action }),
    { name: initial?.name ?? "", body: initial?.body ?? "", loading: false, error: null }
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [signature, setSignature] = useState<string>("");
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings/signature");
        const data = await res.json();
        setSignature(data.signature ?? "");
      } catch {}
    })();
  }, []);

  const SAMPLE: Record<string, string> = {
    firstName: "ארי",
    hebrewFirstName: "ארי",
    lastName: "לוי",
    company: "Acme",
    title: "מנכ״ל",
    senderFirstName: "ישראל",
    senderLastName: "ישראלי",
    senderCompany: "Triolla",
    senderTitle: "מנהל מכירות",
  };
  const previewText = formState.body.replace(/\{\{([a-zA-Z]+)(?:\|([^}]*))?\}\}/g, (_m, name, fallback) =>
    SAMPLE[name] ?? (fallback ?? "")
  );
  const previewHtml = `${textToEmailHtml(previewText)}${
    signature.trim() ? `<div><br></div><div><br></div>${signature}` : ""
  }`;

  function insertChip(chip: string) {
    const ta = textareaRef.current;
    if (!ta) { formDispatch({ body: formState.body + chip }); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    formDispatch({ body: formState.body.slice(0, start) + chip + formState.body.slice(end) });
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + chip.length;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formState.name.trim() || !formState.body.trim()) {
      formDispatch({ error: "שם וגוף ההודעה הם שדות חובה" });
      return;
    }
    formDispatch({ loading: true, error: null });
    try {
      await onSubmit({ name: formState.name, body: formState.body });
    } catch {
      formDispatch({ error: "שמירת הטמפלט נכשלה" });
    } finally {
      formDispatch({ loading: false });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="template-name" className="block text-[11px] font-semibold text-[#9b9895] uppercase tracking-widest mb-2">
          שם
        </label>
        <input
          id="template-name"
          type="text"
          value={formState.name}
          onChange={(e) => formDispatch({ name: e.target.value })}
          placeholder="למשל: יצירת קשר ראשונה"
          className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-lg px-3 py-2.5 text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff] focus:ring-1 focus:ring-[#1585ff]/20 transition-colors"
        />
      </div>
      <div>
        <label htmlFor="template-body" className="block text-[11px] font-semibold text-[#9b9895] uppercase tracking-widest mb-2">
          גוף ההודעה
        </label>
        <textarea
          id="template-body"
          ref={textareaRef}
          value={formState.body}
          onChange={(e) => formDispatch({ body: e.target.value })}
          rows={8}
          placeholder={"שלום {{firstName}},\n\nשמתי לב שאתה ב-{{company}}..."}
          className="w-full bg-white border border-[#e5e3df] rounded-lg px-4 py-3 text-[#111110] placeholder-[#c8c5c2] resize-none focus:outline-none focus:border-[#1585ff] focus:ring-1 focus:ring-[#1585ff]/20 transition-colors"
          style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: "14px", lineHeight: 1.5, color: "#222222" }}
          dir="auto"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {VARIABLE_CHIPS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertChip(v)}
              className="text-[10px] font-mono text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <p className="text-[11px] font-semibold text-[#9b9895] uppercase tracking-widest mb-2">תצוגה מקדימה</p>
          <div className="border border-[#e5e3df] rounded-lg px-4 py-3 bg-[#fafaf9]">
            <div
              dir="auto"
              style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: "14px", lineHeight: 1.5, color: "#222222" }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
      </div>
      {formState.error && (
        <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg border border-red-200">
          {formState.error}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={formState.loading}
          className="flex items-center gap-2 px-4 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0a70e0] disabled:opacity-60 transition-colors"
        >
          {formState.loading ? <RefreshCw className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-[#6b6866] hover:text-[#111110] hover:bg-[#f3f2ef] rounded-lg transition-colors"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}

type PageState = {
  templates: Template[];
  loading: boolean;
  showCreate: boolean;
  editingId: string | null;
  deletingId: string | null;
};

export default function TemplatesPage() {
  const [state, dispatch] = useReducer(
    (s: PageState, action: Partial<PageState>) => ({ ...s, ...action }),
    {
      templates: [],
      loading: true,
      showCreate: false,
      editingId: null,
      deletingId: null,
    }
  );
  const initialFetch = useRef(true);

  async function fetchTemplates() {
    if (initialFetch.current) dispatch({ loading: true });
    try {
      const res = await fetch("/api/templates");
      if (res.ok) {
        const data = await res.json();
        dispatch({ templates: data });
      }
    } catch {}
    finally {
      if (initialFetch.current) {
        dispatch({ loading: false });
        initialFetch.current = false;
      }
    }
  }

  useAutoRefresh(fetchTemplates, 30_000);

  async function handleCreate(data: { name: string; body: string }) {
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to create");
    dispatch({ showCreate: false });
    await fetchTemplates();
  }

  async function handleEdit(id: string, data: { name: string; body: string }) {
    const res = await fetch(`/api/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to update");
    dispatch({ editingId: null });
    await fetchTemplates();
  }

  async function handleDelete(id: string) {
    dispatch({ deletingId: id });
    try {
      await fetch(`/api/templates/${id}`, { method: "DELETE" });
      dispatch({ templates: state.templates.filter((t) => t.id !== id) });
    } catch {}
    finally {
      dispatch({ deletingId: null });
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-[#111110] tracking-tight">טמפלטים</h1>
          <p className="text-sm text-[#6b6866] mt-1">
            תבניות הודעות לפניות הניתנות לשימוש חוזר עם משתנים אישיים
          </p>
        </div>
        {!state.showCreate && (
          <button
            type="button"
            onClick={() => dispatch({ showCreate: true })}
            className="flex items-center gap-2 px-4 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0a70e0] transition-colors shrink-0"
          >
            <Plus className="size-4" />
            טמפלט חדש
          </button>
        )}
      </div>

      {/* Create form */}
      {state.showCreate && (
        <div className="bg-white border border-[#1585ff]/30 rounded-xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 bg-[#1585ff] rounded-full" />
            <h3 className="text-sm font-semibold text-[#111110]">טמפלט חדש</h3>
          </div>
          <TemplateForm
            onSubmit={handleCreate}
            onCancel={() => dispatch({ showCreate: false })}
            submitLabel="צור טמפלט"
          />
        </div>
      )}

      {/* Loading skeletons */}
      {state.loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="bg-white border border-[#e5e3df] rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-[#e5e3df] rounded w-36 mb-3" />
              <div className="h-3 bg-[#f3f2ef] rounded w-full mb-2" />
              <div className="h-3 bg-[#f3f2ef] rounded w-4/5 mb-2" />
              <div className="h-3 bg-[#f3f2ef] rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : state.templates.length === 0 && !state.showCreate ? (
        /* Empty state */
        <div className="bg-white border border-[#e5e3df] rounded-xl p-16 text-center">
          <div className="size-12 bg-[#f3f2ef] border border-[#e5e3df] rounded-xl flex items-center justify-center mx-auto mb-4">
            <FileText className="size-5 text-[#9b9895]" />
          </div>
          <p className="text-[#111110] font-medium mb-1">אין טמפלטים עדיין</p>
          <p className="text-[#6b6866] text-sm mb-5">
            צור תבניות הודעות לפניות הניתנות לשימוש חוזר עם משתנים אישיים
          </p>
          <button
            type="button"
            onClick={() => dispatch({ showCreate: true })}
            className="text-sm text-[#1585ff] hover:text-[#0a70e0] transition-colors"
          >
            ← צור את הטמפלט הראשון שלך
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {state.templates.map((template) => (
            <div
              key={template.id}
              className="bg-white border border-[#e5e3df] rounded-xl p-5 group hover:border-[#9b9895] transition-colors"
            >
              {state.editingId === template.id ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-4 bg-amber-500 rounded-full" />
                    <h3 className="text-sm font-semibold text-[#111110]">עריכת טמפלט</h3>
                  </div>
                  <TemplateForm
                    initial={{ name: template.name, body: template.body }}
                    onSubmit={(data) => handleEdit(template.id, data)}
                    onCancel={() => dispatch({ editingId: null })}
                    submitLabel="שמור שינויים"
                  />
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-medium text-[#111110] text-sm">{template.name}</h3>
                      <p className="text-[10px] text-[#9b9895] mt-0.5 font-mono uppercase tracking-wider">
                        {new Date(template.createdAt).toLocaleDateString("he-IL", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => dispatch({ editingId: template.id })}
                        aria-label={`ערוך טמפלט ${template.name}`}
                        className="p-1.5 text-[#9b9895] hover:text-[#111110] hover:bg-[#f3f2ef] rounded-md transition-colors"
                        title="ערוך"
                      >
                        <Edit2 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(template.id)}
                        disabled={state.deletingId === template.id}
                        aria-label={`מחק טמפלט ${template.name}`}
                        className="p-1.5 text-[#9b9895] hover:text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                        title="מחק"
                      >
                        {state.deletingId === template.id ? (
                          <RefreshCw className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-[#6b6866] font-mono leading-relaxed whitespace-pre-wrap line-clamp-4">
                    <HighlightedBody text={template.body} />
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

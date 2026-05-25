"use client";

import { useState } from "react";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import { FileText, Plus, Trash2, Edit2, RefreshCw, Zap } from "lucide-react";

interface Template {
  id: string;
  name: string;
  body: string;
  createdAt: string;
}

const VARIABLE_CHIPS = ["{{firstName}}", "{{lastName}}", "{{company}}", "{{title}}"];

function HighlightedBody({ text }: { text: string }) {
  const parts = text.split(/({{[^}]+}})/g);
  return (
    <>
      {parts.map((part, i) =>
        /^{{[^}]+}}$/.test(part) ? (
          <span key={i} className="text-amber-600 font-mono bg-amber-50 px-1 rounded text-xs">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
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

function TemplateForm({ initial, onSubmit, onCancel, submitLabel }: TemplateFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !body.trim()) {
      setError("שם וגוף ההודעה הם שדות חובה");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onSubmit({ name, body });
    } catch {
      setError("שמירת הטמפלט נכשלה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-[11px] font-semibold text-[#9b9895] uppercase tracking-widest mb-2">
          שם
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="למשל: יצירת קשר ראשונה"
          className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-lg px-3 py-2.5 text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff] focus:ring-1 focus:ring-[#1585ff]/20 transition-colors"
        />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-[#9b9895] uppercase tracking-widest mb-2">
          גוף ההודעה
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder={"שלום {{firstName}},\n\nשמתי לב שאתה ב-{{company}}..."}
          className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-lg px-3 py-2.5 text-sm text-[#111110] placeholder-[#c8c5c2] resize-none focus:outline-none focus:border-[#1585ff] focus:ring-1 focus:ring-[#1585ff]/20 transition-colors font-mono leading-relaxed"
          dir="rtl"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {VARIABLE_CHIPS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setBody((b) => b + v)}
              className="text-[10px] font-mono text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg border border-red-200">
          {error}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0a70e0] disabled:opacity-60 transition-colors"
        >
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
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

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function fetchTemplates() {
    setLoading(true);
    try {
      const res = await fetch("/api/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch {}
    finally {
      setLoading(false);
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
    setShowCreate(false);
    await fetchTemplates();
  }

  async function handleEdit(id: string, data: { name: string; body: string }) {
    const res = await fetch(`/api/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to update");
    setEditingId(null);
    await fetchTemplates();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetch(`/api/templates/${id}`, { method: "DELETE" });
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch {}
    finally {
      setDeletingId(null);
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
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0a70e0] transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            טמפלט חדש
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white border border-[#1585ff]/30 rounded-xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 bg-[#1585ff] rounded-full" />
            <h3 className="text-sm font-semibold text-[#111110]">טמפלט חדש</h3>
          </div>
          <TemplateForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            submitLabel="צור טמפלט"
          />
        </div>
      )}

      {/* Loading skeletons */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white border border-[#e5e3df] rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-[#e5e3df] rounded w-36 mb-3" />
              <div className="h-3 bg-[#f3f2ef] rounded w-full mb-2" />
              <div className="h-3 bg-[#f3f2ef] rounded w-4/5 mb-2" />
              <div className="h-3 bg-[#f3f2ef] rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 && !showCreate ? (
        /* Empty state */
        <div className="bg-white border border-[#e5e3df] rounded-xl p-16 text-center">
          <div className="w-12 h-12 bg-[#f3f2ef] border border-[#e5e3df] rounded-xl flex items-center justify-center mx-auto mb-4">
            <FileText className="w-5 h-5 text-[#9b9895]" />
          </div>
          <p className="text-[#111110] font-medium mb-1">אין טמפלטים עדיין</p>
          <p className="text-[#6b6866] text-sm mb-5">
            צור תבניות הודעות לפניות הניתנות לשימוש חוזר עם משתנים אישיים
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm text-[#1585ff] hover:text-[#0a70e0] transition-colors"
          >
            ← צור את הטמפלט הראשון שלך
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((template) => (
            <div
              key={template.id}
              className="bg-white border border-[#e5e3df] rounded-xl p-5 group hover:border-[#9b9895] transition-colors"
            >
              {editingId === template.id ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-4 bg-amber-500 rounded-full" />
                    <h3 className="text-sm font-semibold text-[#111110]">עריכת טמפלט</h3>
                  </div>
                  <TemplateForm
                    initial={{ name: template.name, body: template.body }}
                    onSubmit={(data) => handleEdit(template.id, data)}
                    onCancel={() => setEditingId(null)}
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
                        onClick={() => setEditingId(template.id)}
                        className="p-1.5 text-[#9b9895] hover:text-[#111110] hover:bg-[#f3f2ef] rounded-md transition-colors"
                        title="ערוך"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(template.id)}
                        disabled={deletingId === template.id}
                        className="p-1.5 text-[#9b9895] hover:text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                        title="מחק"
                      >
                        {deletingId === template.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
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

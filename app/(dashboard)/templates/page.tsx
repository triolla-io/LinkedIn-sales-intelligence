"use client";

import { useEffect, useState } from "react";
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
          <span key={i} className="text-[#f0a928] font-mono bg-[#f0a928]/10 px-1 rounded text-xs">
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
      setError("Name and body are required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onSubmit({ name, body });
    } catch {
      setError("Failed to save template");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-[11px] font-semibold text-[#5b7fa6] uppercase tracking-widest mb-2">
          Template Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Initial Outreach"
          className="w-full bg-[#07101c] border border-[#1a2d40] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#2d4a62] focus:outline-none focus:border-[#1585ff] focus:ring-1 focus:ring-[#1585ff]/20 transition-colors"
        />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-[#5b7fa6] uppercase tracking-widest mb-2">
          Message Body
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder={"Hi {{firstName}},\n\nI noticed you're at {{company}}..."}
          className="w-full bg-[#07101c] border border-[#1a2d40] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#2d4a62] resize-none focus:outline-none focus:border-[#1585ff] focus:ring-1 focus:ring-[#1585ff]/20 transition-colors font-mono leading-relaxed"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {VARIABLE_CHIPS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setBody((b) => b + v)}
              className="text-[10px] font-mono text-[#f0a928] bg-[#f0a928]/10 border border-[#f0a928]/20 px-2 py-0.5 rounded hover:bg-[#f0a928]/20 transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg border border-red-400/20">
          {error}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#1070d9] disabled:opacity-60 transition-colors"
        >
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-[#5b7fa6] hover:text-white hover:bg-[#152030] rounded-lg transition-colors"
        >
          Cancel
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

  useEffect(() => {
    fetchTemplates();
  }, []);

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
          <h1 className="text-2xl font-semibold text-white tracking-tight">Templates</h1>
          <p className="text-sm text-[#5b7fa6] mt-1">
            Reusable outreach templates with personalization variables
          </p>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#1070d9] transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            New Template
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-[#0a1422] border border-[#1585ff]/30 rounded-xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 bg-[#1585ff] rounded-full" />
            <h3 className="text-sm font-semibold text-white">New Template</h3>
          </div>
          <TemplateForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            submitLabel="Create Template"
          />
        </div>
      )}

      {/* Loading skeletons */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-[#0a1422] border border-[#1a2d40] rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-[#152030] rounded w-36 mb-3" />
              <div className="h-3 bg-[#0f1e2e] rounded w-full mb-2" />
              <div className="h-3 bg-[#0f1e2e] rounded w-4/5 mb-2" />
              <div className="h-3 bg-[#0f1e2e] rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 && !showCreate ? (
        /* Empty state */
        <div className="bg-[#0a1422] border border-[#1a2d40] rounded-xl p-16 text-center">
          <div className="w-12 h-12 bg-[#0f1e2e] border border-[#1a2d40] rounded-xl flex items-center justify-center mx-auto mb-4">
            <FileText className="w-5 h-5 text-[#3d5a73]" />
          </div>
          <p className="text-white font-medium mb-1">No templates yet</p>
          <p className="text-[#5b7fa6] text-sm mb-5">
            Create reusable outreach templates with personalization variables
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm text-[#1585ff] hover:text-[#4da3ff] transition-colors"
          >
            Create your first template →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((template) => (
            <div
              key={template.id}
              className="bg-[#0a1422] border border-[#1a2d40] rounded-xl p-5 group hover:border-[#1f3a52] transition-colors"
            >
              {editingId === template.id ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-4 bg-[#f0a928] rounded-full" />
                    <h3 className="text-sm font-semibold text-white">Editing Template</h3>
                  </div>
                  <TemplateForm
                    initial={{ name: template.name, body: template.body }}
                    onSubmit={(data) => handleEdit(template.id, data)}
                    onCancel={() => setEditingId(null)}
                    submitLabel="Save Changes"
                  />
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-medium text-white text-sm">{template.name}</h3>
                      <p className="text-[10px] text-[#3d5a73] mt-0.5 font-mono uppercase tracking-wider">
                        {new Date(template.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditingId(template.id)}
                        className="p-1.5 text-[#5b7fa6] hover:text-white hover:bg-[#152030] rounded-md transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(template.id)}
                        disabled={deletingId === template.id}
                        className="p-1.5 text-[#5b7fa6] hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors disabled:opacity-50"
                        title="Delete"
                      >
                        {deletingId === template.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-[#8ba3b8] font-mono leading-relaxed whitespace-pre-wrap line-clamp-4">
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

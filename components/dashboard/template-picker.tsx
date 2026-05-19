"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";

interface Template {
  id: string;
  name: string;
  body: string;
}

interface TemplatePickerProps {
  onSelect: (template: Template) => void;
}

export default function TemplatePicker({ onSelect }: TemplatePickerProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((data) => setTemplates(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = templates.find((t) => t.id === selectedId);

  function handleSelect(template: Template) {
    setSelectedId(template.id);
    onSelect(template);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !loading && setOpen((o) => !o)}
        disabled={loading}
        className="w-full flex items-center justify-between bg-[#07101c] border border-[#1a2d40] rounded-lg px-3 py-2.5 text-sm text-left focus:outline-none focus:border-[#1585ff] hover:border-[#1f3a52] disabled:opacity-50 transition-colors"
      >
        <span className={selected ? "text-white" : "text-[#3d5a73]"}>
          {loading ? "Loading templates…" : selected ? selected.name : "Select a template…"}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[#3d5a73] transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#0a1422] border border-[#1a2d40] rounded-lg shadow-2xl z-50 overflow-hidden">
          {templates.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[#5b7fa6] text-center">No templates yet</p>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelect(t)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#152030] transition-colors ${
                  t.id === selectedId ? "bg-[#152030]" : ""
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-[#1585ff] shrink-0" />
                <span className="text-sm text-white">{t.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

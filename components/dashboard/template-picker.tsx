"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

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

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((data) => {
        setTemplates(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setSelectedId(id);
    const template = templates.find((t) => t.id === id);
    if (template) onSelect(template);
  }

  return (
    <div className="relative">
      <select
        value={selectedId}
        onChange={handleChange}
        disabled={loading}
        className="w-full appearance-none border border-gray-300 rounded-md px-3 py-2 pr-8 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
      >
        <option value="">{loading ? "Loading templates..." : "Select a template..."}</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
    </div>
  );
}

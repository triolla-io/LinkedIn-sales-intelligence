"use client";

import { useEffect, useRef, useReducer } from "react";
import { RefreshCw, Check } from "lucide-react";

type State = { html: string; loading: boolean; saving: boolean; saved: boolean; error: string | null };

export default function SignatureSettingsPage() {
  const editorRef = useRef<HTMLDivElement>(null);
  const [state, dispatch] = useReducer(
    (s: State, a: Partial<State>) => ({ ...s, ...a }),
    { html: "", loading: true, saving: false, saved: false, error: null }
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings/signature");
        if (!res.ok) throw new Error();
        const data = await res.json();
        const html = data.signature ?? "";
        if (editorRef.current) editorRef.current.innerHTML = html;
        dispatch({ html, loading: false });
      } catch {
        dispatch({ loading: false, error: "טעינת החתימה נכשלה" });
      }
    })();
  }, []);

  function onInput() {
    dispatch({ html: editorRef.current?.innerHTML ?? "", saved: false });
  }

  async function save() {
    dispatch({ saving: true, error: null, saved: false });
    try {
      const res = await fetch("/api/settings/signature", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: state.html }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const clean = data.signature ?? "";
      if (editorRef.current) editorRef.current.innerHTML = clean;
      dispatch({ html: clean, saving: false, saved: true });
    } catch {
      dispatch({ saving: false, error: "שמירת החתימה נכשלה" });
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold text-[#111110] tracking-tight">חתימת אימייל</h1>
      <p className="text-sm text-[#6b6866] mt-1 mb-6">
        העתק את החתימה שלך מ-Gmail (כולל לוגו ואייקונים) והדבק אותה כאן. החתימה תתווסף אוטומטית לכל אימייל פנייה.
      </p>

      <label htmlFor="signature-editor" className="block text-[11px] font-semibold text-[#9b9895] uppercase tracking-widest mb-2">
        החתימה שלך
      </label>
      <div
        id="signature-editor"
        ref={editorRef}
        contentEditable={!state.loading}
        suppressContentEditableWarning
        onInput={onInput}
        dir="auto"
        className="min-h-32 w-full bg-white border border-[#e5e3df] rounded-lg px-4 py-3 focus:outline-none focus:border-[#1585ff] focus:ring-1 focus:ring-[#1585ff]/20 transition-colors"
        style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: "14px", lineHeight: 1.5, color: "#222222" }}
      />

      <label htmlFor="signature-preview" className="block text-[11px] font-semibold text-[#9b9895] uppercase tracking-widest mt-6 mb-2">
        תצוגה מקדימה
      </label>
      <div id="signature-preview" className="border border-[#e5e3df] rounded-lg px-4 py-3 bg-[#fafaf9]">
        <div
          dir="auto"
          style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: "14px", lineHeight: 1.5, color: "#222222" }}
          dangerouslySetInnerHTML={{ __html: state.html }}
        />
      </div>

      {state.error && (
        <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg border border-red-200 mt-4">{state.error}</p>
      )}

      <div className="flex items-center gap-3 mt-5">
        <button
          type="button"
          onClick={save}
          disabled={state.saving || state.loading}
          className="flex items-center gap-2 px-4 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0a70e0] disabled:opacity-60 transition-colors"
        >
          {state.saving ? <RefreshCw className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          שמור חתימה
        </button>
        {state.saved && <span className="text-xs text-green-600">נשמר ✓</span>}
      </div>
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import useSWR from "swr";

type WaStatus =
  | "CONNECTED"
  | "QR_PENDING"
  | "DISCONNECTED"
  | "LOADING"
  // The QR was actually scanned and WhatsApp is confirming the link.
  | "LINKING"
  // The QR expired unscanned and a fresh one is on its way. NOT a scan.
  | "REFRESHING"
  | "SERVICE_UNAVAILABLE";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** SSE payloads arrive as text; a malformed frame must not throw inside an
 *  event listener and leave the card wedged. Returns null when unusable. */
function parseEventData(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { data } = parsed as { data?: unknown };
    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}

export function WhatsAppConnectCard() {
  const [status, setStatus] = useState<WaStatus>("LOADING");
  const [phone, setPhone] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const streamStartedRef = useRef(false);
  function clearEsRef() { esRef.current = null; }

  function openStream() {
    if (esRef.current) return;
    const es = new EventSource("/api/whatsapp/qr");
    esRef.current = es;

    es.addEventListener("qr", (e) => {
      const data = parseEventData(e.data);
      if (data === null) return;
      setStatus("QR_PENDING");
      setQr(data);
    });

    es.addEventListener("connected", (e) => {
      const data = parseEventData(e.data);
      if (data === null) return;
      setStatus("CONNECTED");
      setPhone(data);
      setQr(null);
      es.close();
      esRef.current = null;
    });

    es.addEventListener("disconnected", (e) => {
      const data = parseEventData(e.data);
      if (data === null) return;
      if (data === "pairing") {
        // Scanned for real — WhatsApp closes the socket to finish the link.
        setQr(null);
        setStatus("LINKING");
      } else if (data === "reconnecting") {
        // Code expired without being scanned; keep the user waiting for a new
        // one instead of telling them they scanned it.
        setQr(null);
        setStatus("REFRESHING");
      } else {
        es.close();
        esRef.current = null;
        setStatus("DISCONNECTED");
      }
    });

    const onErr = () => {
      setStatus("SERVICE_UNAVAILABLE");
      es.close();
      esRef.current = null;
    };
    es.addEventListener("error", onErr);
    es.onerror = onErr;
  }

  const { data: statusData, error: statusError } = useSWR<{ status: WaStatus; phone?: string }>(
    "/api/whatsapp/status",
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  useEffect(() => {
    if (!statusData && !statusError) return;
    if (streamStartedRef.current) return;
    streamStartedRef.current = true;

    if (statusError || statusData?.status === "DISCONNECTED" || statusData?.status === "QR_PENDING") {
      setStatus("DISCONNECTED");
      openStream();
    } else if (statusData) {
      setStatus(statusData.status);
      if (statusData.phone) setPhone(statusData.phone);
    }
    const es = esRef.current;
    return () => { es?.close(); clearEsRef(); };
  }, [statusData, statusError]);

  async function handleDisconnect() {
    setDisconnecting(true);
    await fetch("/api/whatsapp/disconnect", { method: "POST" });
    setPhone(null);
    setQr(null);
    setDisconnecting(false);
    setStatus("DISCONNECTED");
    openStream();
  }

  if (status === "LOADING") {
    return (
      <div className="rounded-xl border border-[#e5e3df] bg-white p-6">
        <p className="text-sm text-[#9b9895]">בדיקת חיבור…</p>
      </div>
    );
  }

  if (status === "SERVICE_UNAVAILABLE") {
    return (
      <div className="rounded-xl border border-[#e5e3df] bg-white p-6">
        <div className="flex items-center gap-3">
          <span className="size-2.5 rounded-full bg-red-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#111110]">שירות WhatsApp לא זמין</p>
            <p className="text-xs text-[#9b9895] mt-0.5">שירות WhatsApp אינו פעיל. בדוק את הגדרות ההפצה שלך.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setStatus("DISCONNECTED"); openStream(); }}
          className="mt-4 rounded-lg border border-[#e5e3df] px-3 py-1.5 text-sm text-[#6b6866] hover:text-[#111110] hover:border-[#9b9895] transition-colors"
        >
          נסה שוב
        </button>
      </div>
    );
  }

  if (status === "CONNECTED") {
    return (
      <div className="rounded-xl border border-[#e5e3df] bg-white p-6">
        <div className="flex items-center gap-3">
          <span className="size-2.5 rounded-full bg-green-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#111110]">WhatsApp מחובר</p>
            {phone && <p className="text-xs text-[#9b9895] mt-0.5">{phone}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="mt-4 rounded-lg border border-[#e5e3df] px-3 py-1.5 text-sm text-[#6b6866] hover:text-[#111110] hover:border-[#9b9895] transition-colors disabled:opacity-50"
        >
          {disconnecting ? "ניתוק…" : "נתק"}
        </button>
      </div>
    );
  }

  if (status === "LINKING") {
    return (
      <div className="rounded-xl border border-[#e5e3df] bg-white p-6">
        <div className="flex items-center gap-3">
          <svg className="animate-spin size-4 text-[#6b6866] shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-[#111110]">מקשרת התקן…</p>
            <p className="text-xs text-[#9b9895] mt-0.5">הקוד נסרק{" - "}ממתינה לאישור WhatsApp</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#e5e3df] bg-white p-6">
      <h2 className="text-base font-semibold text-[#111110]">חיבור WhatsApp</h2>
      <p className="mt-1 text-sm text-[#9b9895]">
        סרוק את קוד ה-QR עם WhatsApp בטלפון שלך כדי לחבר את הנתון האישי שלך.
      </p>
      <ol className="mt-3 text-sm text-[#6b6866] list-decimal list-inside space-y-1">
        <li>פתח את WhatsApp בטלפון שלך</li>
        <li>הקש על תפריט (⋮) → התקנים מקושרים → קשר התקן</li>
        <li>סרוק את הקוד למטה</li>
      </ol>

      <div className="mt-5 flex justify-center">
        {status === "QR_PENDING" && qr ? (
          <Image
            src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qr)}`}
            alt="WhatsApp QR code"
            width={220}
            height={220}
            unoptimized
            className="rounded-lg border border-[#e5e3df]"
          />
        ) : (
          <div className="size-[220px] rounded-lg border border-[#e5e3df] bg-[#f8f7f5] flex items-center justify-center">
            <p className="text-xs text-[#9b9895]">
              {status === "REFRESHING" ? "הקוד פג — מרעננת קוד חדש…" : "ממתינה ל-QR…"}
            </p>
          </div>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-[#9b9895]">QR מתחדש באופן אוטומטי כל ~20 שניות</p>
    </div>
  );
}

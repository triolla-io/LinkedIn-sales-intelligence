"use client";
import { useEffect, useState } from "react";

type WaStatus = "CONNECTED" | "QR_PENDING" | "DISCONNECTED" | "LOADING" | "SERVICE_UNAVAILABLE";

export function WhatsAppConnectCard() {
  const [status, setStatus] = useState<WaStatus>("LOADING");
  const [phone, setPhone] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    fetch("/api/whatsapp/status")
      .then((r) => r.json())
      .then((d: { status: WaStatus; phone?: string }) => {
        setStatus(d.status);
        if (d.phone) setPhone(d.phone);
      })
      .catch(() => setStatus("DISCONNECTED"));
  }, []);

  useEffect(() => {
    if (status !== "DISCONNECTED") return;

    const es = new EventSource("/api/whatsapp/qr");

    es.addEventListener("qr", (e) => {
      const { data } = JSON.parse(e.data) as { data: string };
      setStatus("QR_PENDING");
      setQr(data);
    });

    es.addEventListener("connected", (e) => {
      const { data } = JSON.parse(e.data) as { data: string };
      setStatus("CONNECTED");
      setPhone(data);
      setQr(null);
      es.close();
    });

    es.addEventListener("disconnected", () => {
      setStatus("DISCONNECTED");
      es.close();
    });

    es.addEventListener("error", () => {
      setStatus("SERVICE_UNAVAILABLE");
      es.close();
    });

    es.onerror = () => {
      setStatus("SERVICE_UNAVAILABLE");
      es.close();
    };

    return () => es.close();
  }, [status]);

  async function handleDisconnect() {
    setDisconnecting(true);
    await fetch("/api/whatsapp/disconnect", { method: "POST" });
    setStatus("DISCONNECTED");
    setPhone(null);
    setQr(null);
    setDisconnecting(false);
  }

  if (status === "LOADING") {
    return (
      <div className="rounded-xl border border-[#e5e3df] bg-white p-6">
        <p className="text-sm text-[#9b9895]">Checking connection…</p>
      </div>
    );
  }

  if (status === "SERVICE_UNAVAILABLE") {
    return (
      <div className="rounded-xl border border-[#e5e3df] bg-white p-6">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#111110]">WhatsApp service unavailable</p>
            <p className="text-xs text-[#9b9895] mt-0.5">The WhatsApp service is not running. Check your deployment configuration.</p>
          </div>
        </div>
        <button
          onClick={() => setStatus("DISCONNECTED")}
          className="mt-4 rounded-lg border border-[#e5e3df] px-3 py-1.5 text-sm text-[#6b6866] hover:text-[#111110] hover:border-[#9b9895] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (status === "CONNECTED") {
    return (
      <div className="rounded-xl border border-[#e5e3df] bg-white p-6">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#111110]">WhatsApp connected</p>
            {phone && <p className="text-xs text-[#9b9895] mt-0.5">{phone}</p>}
          </div>
        </div>
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="mt-4 rounded-lg border border-[#e5e3df] px-3 py-1.5 text-sm text-[#6b6866] hover:text-[#111110] hover:border-[#9b9895] transition-colors disabled:opacity-50"
        >
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#e5e3df] bg-white p-6">
      <h2 className="text-base font-semibold text-[#111110]">Connect WhatsApp</h2>
      <p className="mt-1 text-sm text-[#9b9895]">
        Scan the QR code with WhatsApp on your phone to connect your personal number.
      </p>
      <ol className="mt-3 text-sm text-[#6b6866] list-decimal list-inside space-y-1">
        <li>Open WhatsApp on your phone</li>
        <li>Tap Menu (⋮) → Linked Devices → Link a Device</li>
        <li>Scan the code below</li>
      </ol>

      <div className="mt-5 flex justify-center">
        {status === "QR_PENDING" && qr ? (
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qr)}`}
            alt="WhatsApp QR code"
            className="w-[220px] h-[220px] rounded-lg border border-[#e5e3df]"
          />
        ) : (
          <div className="w-[220px] h-[220px] rounded-lg border border-[#e5e3df] bg-[#f8f7f5] flex items-center justify-center">
            <p className="text-xs text-[#9b9895]">Waiting for QR…</p>
          </div>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-[#9b9895]">QR refreshes automatically every ~20 seconds</p>
    </div>
  );
}

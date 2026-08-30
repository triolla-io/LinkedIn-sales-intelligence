import { WhatsAppConnectCard } from "@/components/dashboard/whatsapp-connect-card";

export default function WhatsAppConnectPage() {
  return (
    <div className="max-w-lg mx-auto py-10 px-4">
      <h1 className="text-xl font-semibold text-[var(--foreground)] mb-6">WhatsApp</h1>
      <WhatsAppConnectCard />
    </div>
  );
}

import { WhatsAppConnectCard } from "@/components/dashboard/whatsapp-connect-card";

export default function WhatsAppSettingsPage() {
  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-semibold text-[#111110] mb-6">WhatsApp</h1>
      <WhatsAppConnectCard />
    </div>
  );
}

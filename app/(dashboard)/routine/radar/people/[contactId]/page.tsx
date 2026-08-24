import { PersonPage } from "./person-page";

export default async function RadarPersonPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;
  return <PersonPage contactId={contactId} />;
}

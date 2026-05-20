import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

export const POST = withTenant(async (_req, { effectiveUserId }) => {
  const total = await prisma.contact.count({
    where: {
      ownerId: effectiveUserId,
      OR: [{ location: null }, { industry: null }, { companySize: null }],
    },
  });

  if (total === 0) {
    return { queued: 0 };
  }

  await inngest.send({
    name: "profiles.enrich",
    data: { userId: effectiveUserId, total },
  });

  return { queued: total };
});

export const GET = withTenant(async (_req, { effectiveUserId }) => {
  const missing = await prisma.contact.count({
    where: {
      ownerId: effectiveUserId,
      OR: [{ location: null }, { industry: null }, { companySize: null }],
    },
  });
  return { missing };
});

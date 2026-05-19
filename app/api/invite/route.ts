import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { Resend } from "resend";
import crypto from "crypto";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const POST = withTenant(async (req: NextRequest, ctx) => {
  // Only admins can invite
  const me = await prisma.user.findUnique({
    where: { id: ctx.effectiveUserId },
    select: { role: true, orgId: true, name: true, org: { select: { name: true } } },
  });
  if (!me || (me.role !== "ADMIN" && me.role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { email } = await req.json() as { email: string };
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  // Check if user already exists in org
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
  }

  // Delete any previous unused invite for this email
  await prisma.invite.deleteMany({ where: { orgId: me.orgId, email, usedAt: null } });

  // Create invite token (expires in 7 days)
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.invite.create({
    data: { orgId: me.orgId, email, token, expiresAt },
  });

  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const inviteUrl = `${appUrl}/accept-invite?token=${token}`;

  if (resend) {
    await resend.emails.send({
      from: `${me.org.name} via LinkedIn SI <onboarding@resend.dev>`,
      to: email,
      subject: `${me.name} invited you to join ${me.org.name} on LinkedIn SI`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
          <h2 style="margin-bottom:8px">You've been invited</h2>
          <p style="color:#555;margin-bottom:24px">
            ${me.name} has invited you to join <strong>${me.org.name}</strong> on LinkedIn SI —
            a sales intelligence dashboard for your LinkedIn network.
          </p>
          <a href="${inviteUrl}"
             style="display:inline-block;background:#1585ff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Accept invitation
          </a>
          <p style="color:#aaa;font-size:12px;margin-top:24px">
            This link expires in 7 days. If you didn't expect this email, you can ignore it.
          </p>
        </div>
      `,
    });
  }

  return NextResponse.json({ ok: true, inviteUrl: resend ? null : inviteUrl });
});

import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { hashToken, SESSION_COOKIE } from "@/server/auth/session";
import { cookies } from "next/headers";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge, KeyValue } from "@/components/ui/misc";
import { dateTime } from "@/lib/format";
import { ChangePasswordForm, SignOutOthers } from "./account-forms";

export const metadata: Metadata = { title: "Account & security" };

export default async function AccountPage() {
  const user = await requireUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const [u, sessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true, name: true, role: true, lastLoginAt: true, passwordChangedAt: true, createdAt: true } }),
    prisma.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } }),
  ]);
  const current = token ? hashToken(token) : null;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Your account" />
        <CardContent>
          <KeyValue
            items={[
              ["Name", u.name],
              ["Email", u.email],
              ["Role", u.role === "OWNER" ? "Owner" : "Staff"],
              ["Last sign-in", dateTime(u.lastLoginAt)],
              ["Password changed", dateTime(u.passwordChangedAt)],
              ["Member since", dateTime(u.createdAt)],
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader title="Change password" description="Other devices are signed out after a change." />
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Active sessions" description="Sessions expire after 30 days of inactivity." actions={sessions.length > 1 ? <SignOutOthers /> : undefined} />
        <ul className="divide-y divide-border">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate">{s.userAgent ?? "Unknown device"}</p>
                <p className="text-xs text-muted-foreground">
                  Signed in {dateTime(s.createdAt)}
                  {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                </p>
              </div>
              {s.id === current && <Badge tone="success">This device</Badge>}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Forgotten password?" />
        <CardContent className="text-sm text-muted-foreground">
          PrintForge does not send emails, so recovery is done on the server: run <code className="rounded bg-muted px-1 py-0.5">npm run user:reset-password -- owner@example.com</code> (or the Docker equivalent in the README). It sets a new password and signs out all sessions.
        </CardContent>
      </Card>
    </div>
  );
}

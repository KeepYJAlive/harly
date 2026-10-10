import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import {
  isPortalEnabled,
  PORTAL_SESSION_COOKIE,
  resolvePortalSession,
} from "@/lib/portal-auth";
import { PortalShell } from "@/features/portal/PortalShellServer";
import { listPortalSchedulingRequests } from "@/features/interviews/scheduling-data";
import { CandidateSchedulingPage } from "@/features/interviews/CandidateSchedulingPage";

export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ applicationId: string; requestId: string }>;
}) {
  const { applicationId, requestId } = await params;
  const token = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = token ? await resolvePortalSession(token) : null;
  if (!session) redirect("/portal/login" as Route);
  if (!(await isPortalEnabled(session.workspaceId))) notFound();
  const requests = await listPortalSchedulingRequests(session, applicationId);
  const request = requests.find((r) => r.id === requestId);
  if (!request) notFound();
  return (
    <PortalShell>
      <CandidateSchedulingPage request={request} />
    </PortalShell>
  );
}

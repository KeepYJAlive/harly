import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";

import { PortalAssessmentLaunchScreen } from "@/features/assessments/PortalAssessmentLaunchScreen";
import { getPortalAssessmentAssignment } from "@/features/assessments/portal-data";
import { PortalShell } from "@/features/portal/PortalShellServer";
import { PORTAL_SESSION_COOKIE, resolvePortalSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

export default async function StartPortalAssessmentPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const parsed = z.uuid().safeParse((await params).assignmentId);
  if (!parsed.success) notFound();

  const token = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  if (!token) redirect("/portal/login" as Route);
  const session = await resolvePortalSession(token);
  if (!session) redirect("/portal/login" as Route);

  // This page intentionally resolves through candidate/application scope. The
  // API repeats the same check immediately before creating the LTI launch.
  const assignment = await getPortalAssessmentAssignment({
    assignmentId: parsed.data,
    organizationId: session.workspaceId,
    candidateId: session.candidateId,
  });
  if (!assignment) notFound();

  return (
    <PortalShell>
      <PortalAssessmentLaunchScreen
        assessmentName={assignment.assessmentName}
        actionUrl={`/api/portal/assessments/${assignment.id}/launch`}
      />
    </PortalShell>
  );
}

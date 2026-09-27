import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  applications,
  db,
  ltiAssessmentAttempts,
  ltiRegistrations,
} from "@harly/db";

import { createOpaqueToken, hashOpaqueToken } from "@/lib/lti/tokens";
import { getHarlyPublicOrigin } from "@/lib/public-origin";
import {
  PORTAL_SESSION_COOKIE,
  resolvePortalSession,
} from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const { attemptId } = await params;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(PORTAL_SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.redirect(new URL("/portal/login", getHarlyPublicOrigin()));
  }
  const session = await resolvePortalSession(sessionToken);
  if (!session) {
    return NextResponse.redirect(new URL("/portal/login", getHarlyPublicOrigin()));
  }

  const [attempt] = await db
    .select({
      id: ltiAssessmentAttempts.id,
      workspaceId: ltiAssessmentAttempts.workspaceId,
      candidateId: ltiAssessmentAttempts.candidateId,
      applicationId: ltiAssessmentAttempts.applicationId,
      targetLinkUri: ltiAssessmentAttempts.targetLinkUri,
      status: ltiAssessmentAttempts.status,
      clientId: ltiRegistrations.clientId,
      deploymentId: ltiRegistrations.deploymentId,
      oidcInitiationUrl: ltiRegistrations.oidcInitiationUrl,
      registrationEnabled: ltiRegistrations.enabled,
    })
    .from(ltiAssessmentAttempts)
    .innerJoin(
      ltiRegistrations,
      eq(ltiRegistrations.id, ltiAssessmentAttempts.registrationId),
    )
    .innerJoin(
      applications,
      and(
        eq(applications.id, ltiAssessmentAttempts.applicationId),
        eq(applications.candidateId, ltiAssessmentAttempts.candidateId),
        eq(applications.workspaceId, ltiAssessmentAttempts.workspaceId),
      ),
    )
    .where(eq(ltiAssessmentAttempts.id, attemptId))
    .limit(1);

  if (
    !attempt ||
    !attempt.registrationEnabled ||
    attempt.workspaceId !== session.workspaceId ||
    attempt.candidateId !== session.candidateId
  ) {
    return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
  }
  if (attempt.status === "completed") {
    return NextResponse.redirect(
      new URL(`/portal/applications/${attempt.applicationId}`, getHarlyPublicOrigin()),
    );
  }

  const loginHint = createOpaqueToken();
  await db
    .update(ltiAssessmentAttempts)
    .set({
      loginHintHash: hashOpaqueToken(loginHint),
      status: "in_progress",
      launchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(ltiAssessmentAttempts.id, attempt.id));

  const initiationUrl = new URL(attempt.oidcInitiationUrl);
  initiationUrl.searchParams.set("iss", getHarlyPublicOrigin());
  initiationUrl.searchParams.set("login_hint", loginHint);
  initiationUrl.searchParams.set("target_link_uri", attempt.targetLinkUri);
  initiationUrl.searchParams.set("lti_message_hint", attempt.id);
  initiationUrl.searchParams.set("client_id", attempt.clientId);
  initiationUrl.searchParams.set("lti_deployment_id", attempt.deploymentId);

  const response = NextResponse.redirect(initiationUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

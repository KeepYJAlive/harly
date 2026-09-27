import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  applications,
  candidates,
  db,
  jobs,
  ltiAssessmentAttempts,
  ltiRegistrations,
} from "@harly/db";

import {
  AGS_SCORE_SCOPE,
  LTI_CLAIM,
  LTI_LEARNER_ROLE,
  LTI_RESOURCE_LINK_MESSAGE,
  LTI_VERSION,
} from "@/lib/lti/constants";
import { getLtiRegistrationConfigById } from "@/lib/lti/config";
import { signRs256Jwt } from "@/lib/lti/jwt";
import { opaqueTokenMatches } from "@/lib/lti/tokens";
import { getHarlyPublicOrigin } from "@/lib/public-origin";

export const dynamic = "force-dynamic";

const authorizationSchema = z.object({
  scope: z.string().max(1_000).refine((value) => value.split(/\s+/).includes("openid")),
  response_type: z.literal("id_token"),
  response_mode: z.literal("form_post"),
  client_id: z.string().min(1).max(500),
  redirect_uri: z.string().url().max(2_000),
  login_hint: z.string().min(20).max(500),
  lti_message_hint: z.string().uuid(),
  nonce: z.string().min(1).max(500),
  state: z.string().min(1).max(2_000),
  prompt: z.literal("none").optional(),
});

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function protocolError(message: string, status = 400): Response {
  return Response.json(
    { error: "invalid_request", error_description: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = authorizationSchema.safeParse(params);
  if (!parsed.success) {
    return protocolError(parsed.error.issues[0]?.message ?? "Invalid authorization request.");
  }

  const input = parsed.data;
  const [attempt] = await db
    .select({
      id: ltiAssessmentAttempts.id,
      registrationId: ltiAssessmentAttempts.registrationId,
      applicationId: ltiAssessmentAttempts.applicationId,
      candidateId: ltiAssessmentAttempts.candidateId,
      subject: ltiAssessmentAttempts.subject,
      loginHintHash: ltiAssessmentAttempts.loginHintHash,
      title: ltiAssessmentAttempts.title,
      targetLinkUri: ltiAssessmentAttempts.targetLinkUri,
      clientId: ltiRegistrations.clientId,
      deploymentId: ltiRegistrations.deploymentId,
      enabled: ltiRegistrations.enabled,
      firstName: candidates.firstName,
      lastName: candidates.lastName,
      email: candidates.email,
      jobId: jobs.id,
      jobTitle: jobs.title,
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
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(eq(ltiAssessmentAttempts.id, input.lti_message_hint))
    .limit(1);

  if (!attempt || !attempt.enabled) return protocolError("Unknown LTI launch.", 404);
  if (attempt.clientId !== input.client_id) return protocolError("Client ID does not match.");
  if (!attempt.loginHintHash || !opaqueTokenMatches(input.login_hint, attempt.loginHintHash)) {
    return protocolError("Login hint is invalid or expired.", 401);
  }
  if (input.redirect_uri !== attempt.targetLinkUri) {
    return protocolError("Redirect URI does not match the assigned TAO delivery.");
  }

  const registration = await getLtiRegistrationConfigById(attempt.registrationId);
  if (!registration) return protocolError("LTI signing configuration is unavailable.", 503);

  const origin = getHarlyPublicOrigin();
  const now = Math.floor(Date.now() / 1_000);
  const lineitem = `${origin}/api/lti/ags/lineitems/${attempt.id}`;
  const idToken = signRs256Jwt({
    privateKeyPem: registration.privateKeyPem,
    keyId: registration.keyId,
    payload: {
      iss: origin,
      aud: registration.clientId,
      iat: now,
      exp: now + 300,
      nonce: input.nonce,
      sub: attempt.subject,
      name: `${attempt.firstName} ${attempt.lastName}`.trim(),
      given_name: attempt.firstName,
      family_name: attempt.lastName,
      email: attempt.email,
      [LTI_CLAIM.version]: LTI_VERSION,
      [LTI_CLAIM.messageType]: LTI_RESOURCE_LINK_MESSAGE,
      [LTI_CLAIM.deploymentId]: registration.deploymentId,
      [LTI_CLAIM.targetLinkUri]: attempt.targetLinkUri,
      [LTI_CLAIM.resourceLink]: { id: attempt.id, title: attempt.title },
      [LTI_CLAIM.roles]: [LTI_LEARNER_ROLE],
      [LTI_CLAIM.context]: {
        id: attempt.jobId,
        label: attempt.jobTitle,
        title: attempt.jobTitle,
      },
      [LTI_CLAIM.agsEndpoint]: {
        scope: [AGS_SCORE_SCOPE],
        lineitem,
      },
    },
  });

  await db
    .update(ltiAssessmentAttempts)
    .set({ status: "in_progress", launchedAt: new Date(), updatedAt: new Date() })
    .where(eq(ltiAssessmentAttempts.id, attempt.id));

  const action = htmlEscape(input.redirect_uri);
  const body = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Opening assessment…</title></head>
  <body>
    <form id="lti-launch" method="post" action="${action}">
      <input type="hidden" name="id_token" value="${htmlEscape(idToken)}">
      <input type="hidden" name="state" value="${htmlEscape(input.state)}">
      <noscript><button type="submit">Open assessment</button></noscript>
    </form>
    <script>document.getElementById("lti-launch").submit();</script>
  </body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'unsafe-inline'; form-action ${new URL(input.redirect_uri).origin}`,
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    },
  });
}

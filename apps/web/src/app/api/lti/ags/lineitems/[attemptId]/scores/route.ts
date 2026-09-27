import { revalidatePath } from "next/cache";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";

import {
  activityEvents,
  db,
  ltiAccessTokens,
  ltiAssessmentAttempts,
} from "@harly/db";

import {
  AGS_SCORE_SCOPE,
  LTI_ACTIVITY_PROGRESS,
  LTI_GRADING_PROGRESS,
  LTI_SCORE_MEDIA_TYPE,
} from "@/lib/lti/constants";
import { hashOpaqueToken } from "@/lib/lti/tokens";
import { logAuditEvent } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const scoreSchema = z
  .object({
    timestamp: z.string().refine((value) => Number.isFinite(Date.parse(value)), {
      message: "timestamp must be an ISO date-time.",
    }),
    scoreGiven: z.number().finite().optional(),
    scoreMaximum: z.number().finite().positive().optional(),
    comment: z.string().max(10_000).optional(),
    activityProgress: z.enum(LTI_ACTIVITY_PROGRESS),
    gradingProgress: z.enum(LTI_GRADING_PROGRESS),
    userId: z.string().min(1).max(500),
    scoringUserId: z.string().max(500).optional(),
    submission: z
      .object({
        startedAt: z.string().optional(),
        submittedAt: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if ((value.scoreGiven === undefined) !== (value.scoreMaximum === undefined)) {
      context.addIssue({
        code: "custom",
        message: "scoreGiven and scoreMaximum must be supplied together.",
      });
    }
    if (value.gradingProgress === "FullyGraded" && value.scoreGiven === undefined) {
      context.addIssue({
        code: "custom",
        message: "A fully graded result must contain a score.",
      });
    }
  });

function errorResponse(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const { attemptId } = await params;
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith(LTI_SCORE_MEDIA_TYPE)) {
    return errorResponse(`Content-Type must be ${LTI_SCORE_MEDIA_TYPE}.`, 415);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match?.[1] || match[1].length > 1_000) {
    return errorResponse("A bearer token is required.", 401);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return errorResponse("Could not read the score payload.", 400);
  }
  if (rawBody.length > 65_536) return errorResponse("Score payload is too large.", 413);

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return errorResponse("Score payload must be valid JSON.", 400);
  }
  const parsed = scoreSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? "Invalid score payload.", 400);
  }

  const [authorized] = await db
    .select({
      tokenScope: ltiAccessTokens.scope,
      registrationId: ltiAccessTokens.registrationId,
      attemptRegistrationId: ltiAssessmentAttempts.registrationId,
      workspaceId: ltiAssessmentAttempts.workspaceId,
      applicationId: ltiAssessmentAttempts.applicationId,
      candidateId: ltiAssessmentAttempts.candidateId,
      subject: ltiAssessmentAttempts.subject,
      previousStatus: ltiAssessmentAttempts.status,
    })
    .from(ltiAccessTokens)
    .innerJoin(
      ltiAssessmentAttempts,
      eq(ltiAssessmentAttempts.id, attemptId),
    )
    .where(
      and(
        eq(ltiAccessTokens.tokenHash, hashOpaqueToken(match[1])),
        gt(ltiAccessTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (
    !authorized ||
    authorized.registrationId !== authorized.attemptRegistrationId ||
    !authorized.tokenScope.split(/\s+/).includes(AGS_SCORE_SCOPE)
  ) {
    return errorResponse("Bearer token is invalid or expired.", 401);
  }
  if (parsed.data.userId !== authorized.subject) {
    return errorResponse("Score userId does not match the launched candidate.", 400);
  }

  const scoreTimestamp = new Date(parsed.data.timestamp);
  if (scoreTimestamp.getTime() > Date.now() + 5 * 60_000) {
    return errorResponse("Score timestamp cannot be in the future.", 400);
  }

  const finalScore =
    parsed.data.activityProgress === "Completed" &&
    parsed.data.gradingProgress === "FullyGraded";
  const failed = parsed.data.gradingProgress === "Failed";
  const normalizedScore =
    parsed.data.scoreGiven !== undefined && parsed.data.scoreMaximum !== undefined
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((parsed.data.scoreGiven / parsed.data.scoreMaximum) * 100),
          ),
        )
      : null;

  const [updated] = await db
    .update(ltiAssessmentAttempts)
    .set({
      status: finalScore ? "completed" : failed ? "failed" : "in_progress",
      scoreGiven: parsed.data.scoreGiven ?? null,
      scoreMaximum: parsed.data.scoreMaximum ?? null,
      normalizedScore,
      activityProgress: parsed.data.activityProgress,
      gradingProgress: parsed.data.gradingProgress,
      lastScorePayload: parsed.data,
      lastScoreAt: scoreTimestamp,
      completedAt: finalScore ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ltiAssessmentAttempts.id, attemptId),
        or(
          isNull(ltiAssessmentAttempts.lastScoreAt),
          lte(ltiAssessmentAttempts.lastScoreAt, scoreTimestamp),
        ),
      ),
    )
    .returning({ id: ltiAssessmentAttempts.id });

  // AGS score updates are idempotent. An older out-of-order update is accepted
  // but cannot overwrite the newer result already shown in Harly.
  if (!updated) return new Response(null, { status: 204 });

  if (finalScore && authorized.previousStatus !== "completed") {
    await db.insert(activityEvents).values({
      workspaceId: authorized.workspaceId,
      actorId: null,
      entityType: "application",
      entityId: authorized.applicationId,
      type: "assessment.completed",
      metadata: {
        assessmentId: attemptId,
        provider: "tao",
        score: normalizedScore,
        scoreGiven: parsed.data.scoreGiven,
        scoreMaximum: parsed.data.scoreMaximum,
      },
    });
    await logAuditEvent({
      workspaceId: authorized.workspaceId,
      action: "assessment.score_received",
      resourceType: "lti_assessment",
      resourceId: attemptId,
      metadata: {
        applicationId: authorized.applicationId,
        candidateId: authorized.candidateId,
        normalizedScore,
        provider: "tao",
      },
    });
  }

  revalidatePath(`/dashboard/candidates/${authorized.candidateId}`);
  revalidatePath(`/portal/applications/${authorized.applicationId}`);
  return new Response(null, { status: 204 });
}

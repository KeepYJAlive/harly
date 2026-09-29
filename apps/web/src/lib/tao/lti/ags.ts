import "server-only";

import { and, eq, isNull, lt, or } from "drizzle-orm";
import {
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
} from "jose";
import { z } from "zod";

import {
  activityEvents,
  applications,
  assessmentAssignments,
  db,
  taoLtiSigningKeys,
  workspaceSettings,
} from "@harly/db";

import { logAuditEvent } from "@/lib/audit-log";
import { getHarlyPublicOrigin } from "@/lib/public-origin";
import { LTI_AGS_SCORE_SCOPE } from "./claims";
import { createLtiSubject } from "./identity";

export const AGS_SCORE_CONTENT_TYPE = "application/vnd.ims.lis.v1.score+json";
const AGS_CLOCK_TOLERANCE_MS = 5 * 60_000;

const activityProgressSchema = z.enum([
  "Initialized",
  "Started",
  "InProgress",
  "Submitted",
  "Completed",
]);
const gradingProgressSchema = z.enum([
  "FullyGraded",
  "Pending",
  "PendingManual",
  "Failed",
  "NotReady",
]);

export const taoAgsScoreSchema = z
  .object({
    userId: z.string().trim().min(1).max(255),
    scoreGiven: z.number().finite().nonnegative().nullable(),
    scoreMaximum: z.number().finite().positive().optional(),
    timestamp: z.iso.datetime({ offset: true }),
    activityProgress: activityProgressSchema,
    gradingProgress: gradingProgressSchema,
    scoringUserId: z.string().trim().min(1).max(255).optional(),
    comment: z.string().max(10_000).optional(),
    submission: z
      .object({
        startedAt: z.iso.datetime({ offset: true }).optional(),
        submittedAt: z.iso.datetime({ offset: true }).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (value.scoreGiven !== null && value.scoreMaximum === undefined) {
      context.addIssue({
        code: "custom",
        path: ["scoreMaximum"],
        message: "scoreMaximum is required when scoreGiven is numeric.",
      });
    }
  });

export type TaoAgsScore = z.infer<typeof taoAgsScoreSchema>;

export class TaoAgsError extends Error {
  constructor(
    public readonly status: 400 | 401 | 404,
    message: string,
  ) {
    super(message);
  }
}

type TaoAgsRegistration = {
  organizationId: string;
  clientId: string;
};

function readClientId(token: string) {
  const header = decodeProtectedHeader(token);
  const payload = decodeJwt(token);
  if (
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    !header.kid ||
    typeof payload.client_id !== "string" ||
    !payload.client_id
  ) {
    throw new Error("Access token header or client is invalid.");
  }
  return { kid: header.kid, clientId: payload.client_id };
}

/** Validate the short-lived access token issued by Harly's LTI token route. */
export async function verifyTaoAgsAccessToken(
  token: string,
  database: typeof db = db,
): Promise<TaoAgsRegistration> {
  if (!token || token.length > 16_384) {
    throw new TaoAgsError(401, "The access token is invalid.");
  }

  try {
    const { kid, clientId } = readClientId(token);
    const [registration] = await database
      .select({
        organizationId: workspaceSettings.organizationId,
        clientId: workspaceSettings.taoClientId,
        enabled: workspaceSettings.taoEnabled,
      })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.taoClientId, clientId))
      .limit(1);
    if (!registration?.enabled || registration.clientId !== clientId) {
      throw new Error("Registration is unavailable.");
    }

    const [key] = await database
      .select({ publicJwk: taoLtiSigningKeys.publicJwk })
      .from(taoLtiSigningKeys)
      .where(
        and(
          eq(taoLtiSigningKeys.organizationId, registration.organizationId),
          eq(taoLtiSigningKeys.kid, kid),
        ),
      )
      .limit(1);
    const publicJwk = key?.publicJwk as JWK | undefined;
    if (
      !publicJwk ||
      publicJwk.kty !== "RSA" ||
      publicJwk.kid !== kid ||
      "d" in publicJwk
    ) {
      throw new Error("Signing key is unavailable.");
    }

    const publicOrigin = getHarlyPublicOrigin();
    const { payload } = await jwtVerify(
      token,
      await importJWK(publicJwk, "RS256"),
      {
        algorithms: ["RS256"],
        issuer: publicOrigin,
        audience: publicOrigin,
        requiredClaims: ["iss", "sub", "aud", "exp", "iat", "jti"],
        maxTokenAge: 300,
        clockTolerance: 5,
      },
    );
    const scopes =
      typeof payload.scope === "string"
        ? payload.scope.split(/\s+/).filter(Boolean)
        : [];
    if (
      payload.sub !== clientId ||
      payload.client_id !== clientId ||
      scopes.length !== 1 ||
      scopes[0] !== LTI_AGS_SCORE_SCOPE
    ) {
      throw new Error("Access token claims are invalid.");
    }
    return { organizationId: registration.organizationId, clientId };
  } catch (error) {
    if (error instanceof TaoAgsError) throw error;
    throw new TaoAgsError(401, "The access token is invalid.");
  }
}

function nextAssignmentStatus(
  current: typeof assessmentAssignments.$inferSelect.status,
  progress: TaoAgsScore["activityProgress"],
) {
  if (["cancelled", "expired", "error", "completed"].includes(current)) {
    return current;
  }
  if (progress === "Completed") return "completed" as const;
  if (["Started", "InProgress", "Submitted"].includes(progress)) {
    return "started" as const;
  }
  return current;
}

export async function recordTaoAgsScore(input: {
  assignmentId: string;
  accessToken: string;
  score: unknown;
  database?: typeof db;
}) {
  const database = input.database ?? db;
  const registration = await verifyTaoAgsAccessToken(
    input.accessToken,
    database,
  );
  const parsed = taoAgsScoreSchema.safeParse(input.score);
  if (!parsed.success) {
    throw new TaoAgsError(400, "The AGS score payload is invalid.");
  }

  const [assignment] = await database
    .select({
      id: assessmentAssignments.id,
      applicationId: assessmentAssignments.applicationId,
      status: assessmentAssignments.status,
      startedAt: assessmentAssignments.startedAt,
      completedAt: assessmentAssignments.completedAt,
      resultReceivedAt: assessmentAssignments.resultReceivedAt,
    })
    .from(assessmentAssignments)
    .innerJoin(
      applications,
      and(
        eq(applications.id, assessmentAssignments.applicationId),
        eq(applications.workspaceId, assessmentAssignments.organizationId),
        eq(applications.jobId, assessmentAssignments.jobId),
      ),
    )
    .where(
      and(
        eq(assessmentAssignments.id, input.assignmentId),
        eq(assessmentAssignments.organizationId, registration.organizationId),
      ),
    )
    .limit(1);
  if (
    !assignment ||
    parsed.data.userId !==
      createLtiSubject(registration.organizationId, assignment.applicationId)
  ) {
    throw new TaoAgsError(404, "The line item is unavailable.");
  }

  const providerTimestamp = new Date(parsed.data.timestamp);
  const startedAt = parsed.data.submission?.startedAt
    ? new Date(parsed.data.submission.startedAt)
    : null;
  const submittedAt = parsed.data.submission?.submittedAt
    ? new Date(parsed.data.submission.submittedAt)
    : null;
  const now = new Date();
  if (
    providerTimestamp.getTime() > now.getTime() + AGS_CLOCK_TOLERANCE_MS ||
    (startedAt &&
      submittedAt &&
      startedAt.getTime() > submittedAt.getTime()) ||
    (submittedAt &&
      submittedAt.getTime() >
        providerTimestamp.getTime() + AGS_CLOCK_TOLERANCE_MS)
  ) {
    throw new TaoAgsError(400, "The AGS score timestamp is invalid.");
  }
  const status = nextAssignmentStatus(
    assignment.status,
    parsed.data.activityProgress,
  );
  const [updated] = await database.transaction(async (tx) => {
    const [row] = await tx
      .update(assessmentAssignments)
      .set({
        score: parsed.data.scoreGiven,
        maxScore:
          parsed.data.scoreGiven === null
            ? null
            : (parsed.data.scoreMaximum ?? null),
        activityProgress: parsed.data.activityProgress,
        gradingProgress: parsed.data.gradingProgress,
        providerResultTimestamp: providerTimestamp,
        resultReceivedAt: now,
        syncedAt: now,
        status,
        startedAt:
          assignment.startedAt ??
          startedAt ??
          (parsed.data.activityProgress === "Initialized"
            ? null
            : providerTimestamp),
        completedAt:
          assignment.completedAt ??
          (parsed.data.activityProgress === "Completed"
            ? (submittedAt ?? providerTimestamp)
            : null),
        updatedAt: now,
      })
      .where(
        and(
          eq(assessmentAssignments.id, assignment.id),
          eq(assessmentAssignments.organizationId, registration.organizationId),
          or(
            isNull(assessmentAssignments.providerResultTimestamp),
            lt(
              assessmentAssignments.providerResultTimestamp,
              providerTimestamp,
            ),
          ),
        ),
      )
      .returning({ id: assessmentAssignments.id });
    if (!row) return [];
    await tx.insert(activityEvents).values({
      workspaceId: registration.organizationId,
      entityType: "application",
      entityId: assignment.applicationId,
      type: assignment.resultReceivedAt
        ? "assessment.result_updated"
        : "assessment.result_received",
      metadata: {
        assignmentId: assignment.id,
        activityProgress: parsed.data.activityProgress,
        gradingProgress: parsed.data.gradingProgress,
      },
    });
    if (status === "completed" && assignment.status !== "completed") {
      await tx.insert(activityEvents).values({
        workspaceId: registration.organizationId,
        entityType: "application",
        entityId: assignment.applicationId,
        type: "assessment.completed",
        metadata: { assignmentId: assignment.id },
      });
    }
    return [row];
  });

  if (updated) {
    await logAuditEvent({
      workspaceId: registration.organizationId,
      action: assignment.resultReceivedAt
        ? "assessment.result_updated"
        : "assessment.result_received",
      resourceType: "assessment_assignment",
      resourceId: assignment.id,
      metadata: {
        activityProgress: parsed.data.activityProgress,
        gradingProgress: parsed.data.gradingProgress,
      },
    });
  }
  return { updated: Boolean(updated) };
}

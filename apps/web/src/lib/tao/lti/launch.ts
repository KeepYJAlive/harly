import "server-only";

import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  applications,
  assessmentAssignments,
  assessmentDefinitions,
  assessmentLtiLaunches,
  db,
} from "@harly/db";

import { logAuditEvent } from "@/lib/audit-log";
import { toHarlyPublicUrl } from "@/lib/public-origin";
import { createLogger } from "@/lib/logger";
import {
  buildTaoTargetLinkUri,
  getTaoLtiPlatformConfig,
  isTrustedTaoLaunchResponseUri,
} from "./config";
import { signTaoLtiLaunch } from "./jwt";
import { assignmentLaunchBlockReason } from "./eligibility";
import {
  createOpaqueToken,
  hashOpaqueToken,
  isPlausibleOpaqueToken,
  tokenHashMatches,
} from "./tokens";
import {
  validateOidcAuthorizationInput,
  validateStoredLaunchState,
  type OidcAuthorizationInput,
} from "./state";

const log = createLogger("tao-lti-launch");
const OIDC_SESSION_MS = 5 * 60_000;
const DEFAULT_RETURN_MS = 24 * 60 * 60_000;

export class CandidateLaunchError extends Error {
  constructor(
    public readonly code:
      | "invalid"
      | "unavailable"
      | "configuration"
      | "provider",
    message: string,
  ) {
    super(message);
  }
}

async function findAssignmentByToken(rawToken: string) {
  if (!isPlausibleOpaqueToken(rawToken)) return null;
  const [row] = await db
    .select({
      assignmentId: assessmentAssignments.id,
      organizationId: assessmentAssignments.organizationId,
      applicationId: assessmentAssignments.applicationId,
      status: assessmentAssignments.status,
      expiresAt: assessmentAssignments.expiresAt,
      definitionId: assessmentDefinitions.id,
      assessmentName: assessmentDefinitions.name,
      externalId: assessmentAssignments.providerResourceId,
      definitionActive: assessmentDefinitions.active,
      jobId: applications.jobId,
    })
    .from(assessmentAssignments)
    .innerJoin(
      assessmentDefinitions,
      and(
        eq(
          assessmentDefinitions.id,
          assessmentAssignments.assessmentDefinitionId,
        ),
        eq(
          assessmentDefinitions.organizationId,
          assessmentAssignments.organizationId,
        ),
      ),
    )
    .innerJoin(
      applications,
      and(
        eq(applications.id, assessmentAssignments.applicationId),
        eq(applications.workspaceId, assessmentAssignments.organizationId),
      ),
    )
    .where(eq(assessmentAssignments.launchTokenHash, hashOpaqueToken(rawToken)))
    .limit(1);
  return row ?? null;
}

async function findAssignmentForPortal(input: {
  assignmentId: string;
  organizationId: string;
  candidateId: string;
}) {
  const [row] = await db
    .select({
      assignmentId: assessmentAssignments.id,
      organizationId: assessmentAssignments.organizationId,
      applicationId: assessmentAssignments.applicationId,
      status: assessmentAssignments.status,
      expiresAt: assessmentAssignments.expiresAt,
      definitionId: assessmentDefinitions.id,
      assessmentName: assessmentDefinitions.name,
      externalId: assessmentAssignments.providerResourceId,
      definitionActive: assessmentDefinitions.active,
      jobId: applications.jobId,
    })
    .from(assessmentAssignments)
    .innerJoin(
      assessmentDefinitions,
      and(
        eq(
          assessmentDefinitions.id,
          assessmentAssignments.assessmentDefinitionId,
        ),
        eq(
          assessmentDefinitions.organizationId,
          assessmentAssignments.organizationId,
        ),
      ),
    )
    .innerJoin(
      applications,
      and(
        eq(applications.id, assessmentAssignments.applicationId),
        eq(applications.workspaceId, assessmentAssignments.organizationId),
        eq(applications.candidateId, input.candidateId),
      ),
    )
    .where(
      and(
        eq(assessmentAssignments.id, input.assignmentId),
        eq(assessmentAssignments.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

type ResolvedAssignment = NonNullable<
  Awaited<ReturnType<typeof findAssignmentByToken>>
>;

async function beginResolvedTaoCandidateLaunch(
  assignment: ResolvedAssignment,
): Promise<string> {
  const now = new Date();
  const blockReason = assignmentLaunchBlockReason({
    status: assignment.status,
    activeDefinition: assignment.definitionActive,
    expiresAt: assignment.expiresAt,
    now,
  });
  if (blockReason === "expired") {
    await db
      .update(assessmentAssignments)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(assessmentAssignments.id, assignment.assignmentId),
          inArray(assessmentAssignments.status, ["assigned", "started"]),
        ),
      );
    throw new CandidateLaunchError("unavailable", "Assignment expired.");
  }
  if (blockReason) {
    throw new CandidateLaunchError("unavailable", "Assignment is unavailable.");
  }

  const config = await getTaoLtiPlatformConfig(assignment.organizationId);
  if (!config) {
    throw new CandidateLaunchError(
      "configuration",
      "TAO LTI is not configured.",
    );
  }

  let targetLinkUri: string;
  try {
    targetLinkUri = buildTaoTargetLinkUri(
      config.launchResponseUri,
      assignment.externalId,
    );
  } catch (error) {
    log.error(error, "Stored TAO target URL is invalid");
    throw new CandidateLaunchError("configuration", "TAO target is invalid.");
  }

  const loginHint = createOpaqueToken(32);
  const returnToken = createOpaqueToken(32);
  const expiresAt = new Date(now.getTime() + OIDC_SESSION_MS);
  const returnExpiresAt =
    assignment.expiresAt ?? new Date(now.getTime() + DEFAULT_RETURN_MS);
  const [launch] = await db
    .insert(assessmentLtiLaunches)
    .values({
      assignmentId: assignment.assignmentId,
      loginHintHash: hashOpaqueToken(loginHint),
      returnTokenHash: hashOpaqueToken(returnToken),
      expiresAt,
      returnExpiresAt,
    })
    .returning({ id: assessmentLtiLaunches.id });
  if (!launch)
    throw new CandidateLaunchError("provider", "Could not create launch.");

  const initiationUrl = new URL(config.oidcInitiationUrl);
  initiationUrl.searchParams.set(
    "iss",
    toHarlyPublicUrl("/").replace(/\/$/, ""),
  );
  initiationUrl.searchParams.set("login_hint", loginHint);
  initiationUrl.searchParams.set("target_link_uri", targetLinkUri);
  initiationUrl.searchParams.set("lti_message_hint", launch.id);
  initiationUrl.searchParams.set("client_id", config.clientId);
  initiationUrl.searchParams.set("lti_deployment_id", config.deploymentId);
  return initiationUrl.toString();
}

export async function beginTaoCandidateLaunch(
  rawToken: string,
): Promise<string> {
  const assignment = await findAssignmentByToken(rawToken);
  if (!assignment)
    throw new CandidateLaunchError("invalid", "Assignment not found.");
  return beginResolvedTaoCandidateLaunch(assignment);
}

/** Authenticated portal launch; delivery and target URI stay server-resolved. */
export async function beginTaoPortalAssignmentLaunch(input: {
  assignmentId: string;
  organizationId: string;
  candidateId: string;
}): Promise<string> {
  const assignment = await findAssignmentForPortal(input);
  if (!assignment)
    throw new CandidateLaunchError("invalid", "Assignment not found.");
  return beginResolvedTaoCandidateLaunch(assignment);
}

function authorizationFailure(message: string): never {
  throw new CandidateLaunchError("invalid", message);
}

export async function authorizeTaoLtiLaunch(input: OidcAuthorizationInput) {
  const validationError = validateOidcAuthorizationInput(input);
  if (validationError) authorizationFailure(validationError);

  const [row] = await db
    .select({
      launchId: assessmentLtiLaunches.id,
      loginHintHash: assessmentLtiLaunches.loginHintHash,
      launchExpiresAt: assessmentLtiLaunches.expiresAt,
      consumedAt: assessmentLtiLaunches.consumedAt,
      assignmentId: assessmentAssignments.id,
      organizationId: assessmentAssignments.organizationId,
      applicationId: assessmentAssignments.applicationId,
      assignmentStatus: assessmentAssignments.status,
      assignmentExpiresAt: assessmentAssignments.expiresAt,
      assessmentName: assessmentDefinitions.name,
      externalId: assessmentDefinitions.externalId,
      definitionActive: assessmentDefinitions.active,
      jobId: applications.jobId,
    })
    .from(assessmentLtiLaunches)
    .innerJoin(
      assessmentAssignments,
      eq(assessmentAssignments.id, assessmentLtiLaunches.assignmentId),
    )
    .innerJoin(
      assessmentDefinitions,
      eq(
        assessmentDefinitions.id,
        assessmentAssignments.assessmentDefinitionId,
      ),
    )
    .innerJoin(
      applications,
      eq(applications.id, assessmentAssignments.applicationId),
    )
    .where(eq(assessmentLtiLaunches.id, input.messageHint))
    .limit(1);

  const now = new Date();
  if (!row) authorizationFailure("Launch session is invalid or expired.");
  const storedStateError = validateStoredLaunchState({
    consumedAt: row.consumedAt,
    expiresAt: row.launchExpiresAt,
    now,
    loginHintMatches: tokenHashMatches(input.loginHint, row.loginHintHash),
  });
  if (
    storedStateError ||
    !row.definitionActive ||
    !inArrayStatus(row.assignmentStatus) ||
    (row.assignmentExpiresAt && row.assignmentExpiresAt <= now)
  ) {
    authorizationFailure("Launch session is invalid or expired.");
  }

  const config = await getTaoLtiPlatformConfig(row.organizationId);
  if (!config || config.clientId !== input.clientId) {
    authorizationFailure("LTI registration does not match.");
  }
  if (!isTrustedTaoLaunchResponseUri(input.redirectUri, config.instanceUrl)) {
    authorizationFailure(
      "redirect_uri does not match the TAO launch response endpoint.",
    );
  }
  const launchResponseUri = config.launchResponseUri;
  const targetLinkUri = buildTaoTargetLinkUri(
    config.launchResponseUri,
    row.externalId,
  );

  const [launchSession] = await db
    .select({
      returnTokenHash: assessmentLtiLaunches.returnTokenHash,
    })
    .from(assessmentLtiLaunches)
    .where(eq(assessmentLtiLaunches.id, row.launchId))
    .limit(1);
  if (!launchSession) authorizationFailure("Launch session is unavailable.");

  // The return token cannot be recovered from its hash. Rotate it here and use
  // the newly generated value for this one launch.
  const rawReturnToken = createOpaqueToken(32);
  const returnUrl = toHarlyPublicUrl(`/assessments/complete/${rawReturnToken}`);
  const idToken = await signTaoLtiLaunch({
    organizationId: row.organizationId,
    applicationId: row.applicationId,
    assignmentId: row.assignmentId,
    jobId: row.jobId,
    assessmentName: row.assessmentName,
    clientId: config.clientId,
    deploymentId: config.deploymentId,
    nonce: input.nonce,
    targetLinkUri,
    returnUrl,
  });

  const stateHash = hashOpaqueToken(input.state);
  const nonceHash = hashOpaqueToken(input.nonce);
  const consumed = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(assessmentLtiLaunches)
      .set({
        stateHash,
        nonceHash,
        returnTokenHash: hashOpaqueToken(rawReturnToken),
        consumedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(assessmentLtiLaunches.id, row.launchId),
          isNull(assessmentLtiLaunches.consumedAt),
          gt(assessmentLtiLaunches.expiresAt, now),
        ),
      )
      .returning({ id: assessmentLtiLaunches.id });
    if (!updated) return false;
    await tx
      .update(assessmentAssignments)
      .set({ status: "started", startedAt: now, updatedAt: now })
      .where(
        and(
          eq(assessmentAssignments.id, row.assignmentId),
          eq(assessmentAssignments.status, "assigned"),
        ),
      );
    return true;
  });
  if (!consumed) authorizationFailure("Launch session has already been used.");

  await logAuditEvent({
    workspaceId: row.organizationId,
    action: "assessment.launched",
    resourceType: "assessment_assignment",
    resourceId: row.assignmentId,
    metadata: { provider: "tao" },
  });

  return { redirectUri: launchResponseUri, idToken, state: input.state };
}

function inArrayStatus(status: string): status is "assigned" | "started" {
  return status === "assigned" || status === "started";
}

export async function acknowledgeAssessmentReturn(rawToken: string) {
  if (!isPlausibleOpaqueToken(rawToken)) return null;
  const now = new Date();
  const [row] = await db
    .select({
      launchId: assessmentLtiLaunches.id,
      assignmentId: assessmentAssignments.id,
      assessmentName: assessmentDefinitions.name,
      returnExpiresAt: assessmentLtiLaunches.returnExpiresAt,
    })
    .from(assessmentLtiLaunches)
    .innerJoin(
      assessmentAssignments,
      eq(assessmentAssignments.id, assessmentLtiLaunches.assignmentId),
    )
    .innerJoin(
      assessmentDefinitions,
      eq(
        assessmentDefinitions.id,
        assessmentAssignments.assessmentDefinitionId,
      ),
    )
    .where(eq(assessmentLtiLaunches.returnTokenHash, hashOpaqueToken(rawToken)))
    .limit(1);
  if (!row || row.returnExpiresAt <= now) return null;
  await db
    .update(assessmentLtiLaunches)
    .set({ returnedAt: now, updatedAt: now })
    .where(eq(assessmentLtiLaunches.id, row.launchId));
  return { assessmentName: row.assessmentName };
}

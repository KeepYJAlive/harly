import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import {
  activityEvents,
  applicationReferrals,
  candidateReferrals,
  db,
  user as authUsers,
} from "@harly/db";

import { PERSONAL_REFERRAL_MAX_USES } from "./personal";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class PersonalReferralUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonalReferralUseError";
  }
}

export function isPersonalReferralUseError(
  error: unknown,
): error is PersonalReferralUseError {
  return error instanceof PersonalReferralUseError;
}

/**
 * Apply the candidate's accepted referral to a newly submitted application.
 * Every writer locks the referral aggregate first. The numbered 1..3 slot and
 * unique index then provide a second database-level guard against overuse.
 */
export async function applyAcceptedPersonalReferral(
  tx: DatabaseTransaction,
  input: {
    workspaceId: string;
    candidateId: string;
    applicationId: string;
  },
) {
  const locked = (await tx.execute(sql`
    select "id"
    from "candidate_referrals"
    where "workspace_id" = ${input.workspaceId}
      and "candidate_id" = ${input.candidateId}
      and "kind" = 'personal'
      and "status" = 'accepted'
    for update
  `)) as unknown as Array<{ id: string }>;

  const referralId = locked[0]?.id;
  if (!referralId) {
    throw new PersonalReferralUseError(
      "No active accepted referral is available for this application.",
    );
  }

  const [referral] = await tx
    .select({
      id: candidateReferrals.id,
      status: candidateReferrals.status,
      expiresAt: candidateReferrals.expiresAt,
      referredById: candidateReferrals.referredById,
      referrerName: authUsers.name,
    })
    .from(candidateReferrals)
    .innerJoin(authUsers, eq(authUsers.id, candidateReferrals.referredById))
    .where(
      and(
        eq(candidateReferrals.id, referralId),
        eq(candidateReferrals.workspaceId, input.workspaceId),
        eq(candidateReferrals.candidateId, input.candidateId),
        eq(candidateReferrals.kind, "personal"),
        eq(candidateReferrals.status, "accepted"),
      ),
    )
    .limit(1);

  if (!referral) {
    throw new PersonalReferralUseError(
      "No active accepted referral is available for this application.",
    );
  }

  const now = new Date();
  if (referral.expiresAt && referral.expiresAt <= now) {
    await tx
      .update(candidateReferrals)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(candidateReferrals.id, referral.id),
          eq(candidateReferrals.workspaceId, input.workspaceId),
          eq(candidateReferrals.status, "accepted"),
        ),
      );
    throw new PersonalReferralUseError(
      "This referral has expired and cannot be applied.",
    );
  }

  const [alreadyApplied] = await tx
    .select({
      id: applicationReferrals.id,
      usageSlot: applicationReferrals.usageSlot,
    })
    .from(applicationReferrals)
    .where(
      and(
        eq(applicationReferrals.workspaceId, input.workspaceId),
        eq(applicationReferrals.applicationId, input.applicationId),
      ),
    )
    .limit(1);
  if (alreadyApplied) return alreadyApplied;

  const uses = await tx
    .select({ usageSlot: applicationReferrals.usageSlot })
    .from(applicationReferrals)
    .where(
      and(
        eq(applicationReferrals.workspaceId, input.workspaceId),
        eq(applicationReferrals.referralId, referral.id),
        inArray(applicationReferrals.usageSlot, [1, 2, 3]),
      ),
    );
  const occupied = new Set(uses.map((row) => row.usageSlot));
  const usageSlot = [1, 2, 3].find((slot) => !occupied.has(slot));
  if (!usageSlot || uses.length >= PERSONAL_REFERRAL_MAX_USES) {
    throw new PersonalReferralUseError(
      "This referral has already been used on three applications.",
    );
  }

  const [created] = await tx
    .insert(applicationReferrals)
    .values({
      workspaceId: input.workspaceId,
      referralId: referral.id,
      applicationId: input.applicationId,
      candidateId: input.candidateId,
      referrerUserId: referral.referredById,
      referrerNameSnapshot: referral.referrerName,
      usageSlot,
      appliedAt: now,
    })
    .returning({
      id: applicationReferrals.id,
      usageSlot: applicationReferrals.usageSlot,
    });
  if (!created) {
    throw new PersonalReferralUseError("The referral could not be applied.");
  }

  await tx.insert(activityEvents).values({
    workspaceId: input.workspaceId,
    actorId: null,
    entityType: "application",
    entityId: input.applicationId,
    type: "referral.applied",
    metadata: { referralId: referral.id, usageSlot },
  });

  return created;
}

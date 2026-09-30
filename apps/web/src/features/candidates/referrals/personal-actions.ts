"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

import {
  activityEvents,
  candidateReferrals,
  db,
  emailOutbox,
  user as authUsers,
} from "@harly/db";

import { requirePermission } from "@/features/workspaces/permissions-server";
import { PORTAL_SESSION_COOKIE, resolvePortalSession } from "@/lib/portal-auth";
import { logAuditEvent } from "@/lib/audit-log";
import {
  createPersonalReferralInvitationPayload,
  createReferralToken,
  hashReferralToken,
  normalizeReferralEmail,
  personalReferralDedupeKey,
  PERSONAL_REFERRAL_COOKIE,
  PERSONAL_REFERRAL_EMAIL_KIND,
} from "./personal";
import { evaluateReferralAcceptance } from "./personal-policy";

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter the candidate's name.").max(120),
  email: z.string().trim().email("Enter a valid email address.").max(254),
});

export async function createPersonalReferral(input: {
  name: string;
  email: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid referral.",
    };
  }

  try {
    const { organization: workspace, user } =
      await requirePermission("collab:write");
    const email = normalizeReferralEmail(parsed.data.email);
    const now = new Date();
    const rawToken = createReferralToken();
    const tokenHash = hashReferralToken(rawToken);

    const result = await db.transaction(async (tx) => {
      // Expiration is lazy until a scheduler exists. Transition matching stale
      // rows before the active-referral uniqueness check.
      await tx
        .update(candidateReferrals)
        .set({ status: "expired", updatedAt: now })
        .where(
          and(
            eq(candidateReferrals.workspaceId, workspace.id),
            eq(candidateReferrals.kind, "personal"),
            eq(candidateReferrals.referredById, user.id),
            eq(candidateReferrals.referredEmailNormalized, email),
            inArray(candidateReferrals.status, ["pending", "accepted"]),
            lt(candidateReferrals.expiresAt, now),
          ),
        );

      const [existing] = await tx
        .select({ id: candidateReferrals.id })
        .from(candidateReferrals)
        .where(
          and(
            eq(candidateReferrals.workspaceId, workspace.id),
            eq(candidateReferrals.kind, "personal"),
            eq(candidateReferrals.referredById, user.id),
            eq(candidateReferrals.referredEmailNormalized, email),
            inArray(candidateReferrals.status, ["pending", "accepted"]),
          ),
        )
        .limit(1);
      if (existing) return { duplicate: true as const };

      const [referral] = await tx
        .insert(candidateReferrals)
        .values({
          workspaceId: workspace.id,
          kind: "personal",
          candidateId: null,
          jobId: null,
          referredById: user.id,
          createdById: user.id,
          referredName: parsed.data.name,
          referredEmailNormalized: email,
          tokenHash,
          status: "pending",
          acceptedAt: null,
          revokedAt: null,
          featured: false,
        })
        .returning({ id: candidateReferrals.id });
      if (!referral) throw new Error("Referral could not be created.");

      await tx.insert(emailOutbox).values({
        workspaceId: workspace.id,
        kind: PERSONAL_REFERRAL_EMAIL_KIND,
        payload: createPersonalReferralInvitationPayload(referral.id, rawToken),
        status: "pending",
        actorId: user.id,
        dedupeKey: personalReferralDedupeKey(referral.id),
      });
      await tx.insert(activityEvents).values([
        {
          workspaceId: workspace.id,
          actorId: user.id,
          entityType: "candidate",
          entityId: referral.id,
          type: "referral.created",
          metadata: { referralId: referral.id, kind: "personal" },
        },
        {
          workspaceId: workspace.id,
          actorId: user.id,
          entityType: "candidate",
          entityId: referral.id,
          type: "referral.invitation_queued",
          metadata: { referralId: referral.id },
        },
      ]);
      return { referralId: referral.id };
    });

    if ("duplicate" in result) {
      return {
        ok: false,
        error: "You already have an active referral for this email address.",
      };
    }
    await logAuditEvent({
      workspaceId: workspace.id,
      actorId: user.id,
      actorEmail: user.email,
      action: "referral.created",
      resourceType: "candidate_referral",
      resourceId: result.referralId,
      metadata: { kind: "personal", invitationQueued: true },
    });
    revalidatePath("/dashboard/referrals");
    return { ok: true };
  } catch (error) {
    console.error("Failed to create personal referral", error);
    return { ok: false, error: "Unable to send this referral." };
  }
}

export async function revokePersonalReferral(input: {
  referralId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { organization: workspace, user } =
      await requirePermission("collab:write");
    const now = new Date();
    const [revoked] = await db
      .update(candidateReferrals)
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(candidateReferrals.id, input.referralId),
          eq(candidateReferrals.workspaceId, workspace.id),
          eq(candidateReferrals.kind, "personal"),
          inArray(candidateReferrals.status, ["pending", "accepted"]),
        ),
      )
      .returning({ id: candidateReferrals.id });
    if (!revoked) return { ok: false, error: "Referral not found." };

    await db.insert(activityEvents).values({
      workspaceId: workspace.id,
      actorId: user.id,
      entityType: "candidate",
      entityId: revoked.id,
      type: "referral.revoked",
      metadata: { referralId: revoked.id },
    });
    await logAuditEvent({
      workspaceId: workspace.id,
      actorId: user.id,
      actorEmail: user.email,
      action: "referral.revoked",
      resourceType: "candidate_referral",
      resourceId: revoked.id,
      severity: "warning",
    });
    revalidatePath("/dashboard/referrals");
    return { ok: true };
  } catch {
    return { ok: false, error: "Unable to revoke this referral." };
  }
}

export async function acceptPersonalReferral(): Promise<
  { ok: true; referrerName: string } | { ok: false; error: string }
> {
  const cookieStore = await cookies();
  const referralToken = cookieStore.get(PERSONAL_REFERRAL_COOKIE)?.value;
  const sessionToken = cookieStore.get(PORTAL_SESSION_COOKIE)?.value;
  if (!referralToken || !sessionToken) {
    return { ok: false, error: "Sign in to accept this referral." };
  }
  const session = await resolvePortalSession(sessionToken);
  if (!session) return { ok: false, error: "Sign in to accept this referral." };

  const tokenHash = hashReferralToken(referralToken);
  try {
    const outcome = await db.transaction(async (tx) => {
      // The token hash is the only public lookup key. Locking makes repeated
      // acceptance and competing candidate sessions deterministic.
      await tx.execute(sql`
        select "id"
        from "candidate_referrals"
        where "token_hash" = ${tokenHash}
          and "kind" = 'personal'
        for update
      `);

      const [referral] = await tx
        .select({
          id: candidateReferrals.id,
          workspaceId: candidateReferrals.workspaceId,
          candidateId: candidateReferrals.candidateId,
          email: candidateReferrals.referredEmailNormalized,
          status: candidateReferrals.status,
          expiresAt: candidateReferrals.expiresAt,
          referrerName: authUsers.name,
        })
        .from(candidateReferrals)
        .innerJoin(authUsers, eq(authUsers.id, candidateReferrals.referredById))
        .where(
          and(
            eq(candidateReferrals.tokenHash, tokenHash),
            eq(candidateReferrals.kind, "personal"),
          ),
        )
        .limit(1);
      if (!referral) {
        return {
          ok: false as const,
          error: "This referral is no longer available.",
        };
      }

      const now = new Date();
      let decision = evaluateReferralAcceptance({
        referralWorkspaceId: referral.workspaceId,
        referralCandidateId: referral.candidateId,
        referredEmailNormalized: referral.email,
        status: referral.status,
        expiresAt: referral.expiresAt,
        sessionWorkspaceId: session.workspaceId,
        sessionCandidateId: session.candidateId,
        sessionEmail: session.email,
        hasAnotherAcceptedReferral: false,
        now,
      });
      if (decision.outcome === "expire") {
        await tx
          .update(candidateReferrals)
          .set({ status: "expired", updatedAt: now })
          .where(
            and(
              eq(candidateReferrals.id, referral.id),
              eq(candidateReferrals.workspaceId, session.workspaceId),
              eq(candidateReferrals.status, "pending"),
            ),
          );
        return { ok: false as const, error: decision.error };
      }
      if (decision.outcome === "reject") {
        return { ok: false as const, error: decision.error };
      }
      if (decision.outcome === "idempotent") {
        return {
          ok: true as const,
          referralId: referral.id,
          referrerName: referral.referrerName ?? "a team member",
        };
      }

      const [existingAccepted] = await tx
        .select({ id: candidateReferrals.id })
        .from(candidateReferrals)
        .where(
          and(
            eq(candidateReferrals.workspaceId, session.workspaceId),
            eq(candidateReferrals.kind, "personal"),
            eq(candidateReferrals.candidateId, session.candidateId),
            eq(candidateReferrals.status, "accepted"),
          ),
        )
        .limit(1);
      decision = evaluateReferralAcceptance({
        referralWorkspaceId: referral.workspaceId,
        referralCandidateId: referral.candidateId,
        referredEmailNormalized: referral.email,
        status: referral.status,
        expiresAt: referral.expiresAt,
        sessionWorkspaceId: session.workspaceId,
        sessionCandidateId: session.candidateId,
        sessionEmail: session.email,
        hasAnotherAcceptedReferral: Boolean(existingAccepted),
        now,
      });
      if (decision.outcome !== "accept") {
        return {
          ok: false as const,
          error:
            "error" in decision
              ? decision.error
              : "This referral is no longer available.",
        };
      }

      const acceptedAt = now;
      const [accepted] = await tx
        .update(candidateReferrals)
        .set({
          candidateId: session.candidateId,
          status: "accepted",
          acceptedAt,
          updatedAt: acceptedAt,
        })
        .where(
          and(
            eq(candidateReferrals.id, referral.id),
            eq(candidateReferrals.workspaceId, session.workspaceId),
            eq(candidateReferrals.status, "pending"),
          ),
        )
        .returning({ id: candidateReferrals.id });
      if (!accepted) {
        return {
          ok: false as const,
          error: "This referral is no longer available.",
        };
      }
      await tx.insert(activityEvents).values({
        workspaceId: session.workspaceId,
        actorId: null,
        entityType: "candidate",
        entityId: session.candidateId,
        type: "referral.accepted",
        metadata: { referralId: referral.id },
      });
      return {
        ok: true as const,
        referralId: referral.id,
        referrerName: referral.referrerName ?? "a team member",
      };
    });

    if (!outcome.ok) return outcome;
    cookieStore.delete(PERSONAL_REFERRAL_COOKIE);
    await logAuditEvent({
      workspaceId: session.workspaceId,
      action: "referral.accepted",
      resourceType: "candidate_referral",
      resourceId: outcome.referralId,
      metadata: { candidateId: session.candidateId },
    });
    return { ok: true, referrerName: outcome.referrerName };
  } catch (error) {
    console.error("Failed to accept personal referral", error);
    return { ok: false, error: "Unable to accept this referral." };
  }
}

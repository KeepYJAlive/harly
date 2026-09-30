import "server-only";

import { and, count, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import {
  applicationReferrals,
  candidateReferrals,
  db,
  organization,
  user as authUsers,
} from "@harly/db";

import { requirePermission } from "@/features/workspaces/permissions-server";
import { hashReferralToken, PERSONAL_REFERRAL_MAX_USES } from "./personal";

export async function listPersonalReferrals() {
  const { organization: workspace } = await requirePermission("collab:write");
  const usage = db
    .select({
      referralId: applicationReferrals.referralId,
      used: count(applicationReferrals.id).as("used"),
    })
    .from(applicationReferrals)
    .where(eq(applicationReferrals.workspaceId, workspace.id))
    .groupBy(applicationReferrals.referralId)
    .as("referral_usage");

  const rows = await db
    .select({
      id: candidateReferrals.id,
      referredName: candidateReferrals.referredName,
      referredEmail: candidateReferrals.referredEmailNormalized,
      status: candidateReferrals.status,
      createdAt: candidateReferrals.createdAt,
      expiresAt: candidateReferrals.expiresAt,
      acceptedAt: candidateReferrals.acceptedAt,
      revokedAt: candidateReferrals.revokedAt,
      referrerName: authUsers.name,
      used: sql<number>`coalesce(${usage.used}, 0)::int`,
    })
    .from(candidateReferrals)
    .innerJoin(authUsers, eq(authUsers.id, candidateReferrals.referredById))
    .leftJoin(usage, eq(usage.referralId, candidateReferrals.id))
    .where(
      and(
        eq(candidateReferrals.workspaceId, workspace.id),
        eq(candidateReferrals.kind, "personal"),
      ),
    )
    .orderBy(desc(candidateReferrals.createdAt));

  const now = Date.now();
  return rows.map((row) => ({
    ...row,
    status:
      row.status !== "revoked" &&
      row.expiresAt &&
      row.expiresAt.getTime() <= now
        ? ("expired" as const)
        : row.status,
    remaining: Math.max(PERSONAL_REFERRAL_MAX_USES - row.used, 0),
  }));
}

export async function resolvePersonalReferralToken(rawToken: string) {
  if (!rawToken || rawToken.length > 256) return null;
  const tokenHash = hashReferralToken(rawToken);
  const usage = db
    .select({
      referralId: applicationReferrals.referralId,
      used: count(applicationReferrals.id).as("used"),
    })
    .from(applicationReferrals)
    .groupBy(applicationReferrals.referralId)
    .as("referral_usage");

  const [row] = await db
    .select({
      id: candidateReferrals.id,
      workspaceId: candidateReferrals.workspaceId,
      referredName: candidateReferrals.referredName,
      referredEmail: candidateReferrals.referredEmailNormalized,
      status: candidateReferrals.status,
      expiresAt: candidateReferrals.expiresAt,
      acceptedAt: candidateReferrals.acceptedAt,
      candidateId: candidateReferrals.candidateId,
      referrerName: authUsers.name,
      workspaceName: organization.name,
      workspaceSlug: organization.slug,
      used: sql<number>`coalesce(${usage.used}, 0)::int`,
    })
    .from(candidateReferrals)
    .innerJoin(authUsers, eq(authUsers.id, candidateReferrals.referredById))
    .innerJoin(
      organization,
      eq(organization.id, candidateReferrals.workspaceId),
    )
    .leftJoin(usage, eq(usage.referralId, candidateReferrals.id))
    .where(
      and(
        eq(candidateReferrals.tokenHash, tokenHash),
        eq(candidateReferrals.kind, "personal"),
      ),
    )
    .limit(1);
  if (!row) return null;

  const expired = Boolean(row.expiresAt && row.expiresAt <= new Date());
  return {
    ...row,
    status:
      expired && row.status !== "revoked" ? ("expired" as const) : row.status,
    remaining: Math.max(PERSONAL_REFERRAL_MAX_USES - row.used, 0),
  };
}

export async function getAcceptedPersonalReferral(input: {
  workspaceId: string;
  candidateId: string;
}) {
  const usage = db
    .select({
      referralId: applicationReferrals.referralId,
      used: count(applicationReferrals.id).as("used"),
    })
    .from(applicationReferrals)
    .where(eq(applicationReferrals.workspaceId, input.workspaceId))
    .groupBy(applicationReferrals.referralId)
    .as("referral_usage");
  const [row] = await db
    .select({
      id: candidateReferrals.id,
      referrerName: authUsers.name,
      acceptedAt: candidateReferrals.acceptedAt,
      expiresAt: candidateReferrals.expiresAt,
      used: sql<number>`coalesce(${usage.used}, 0)::int`,
    })
    .from(candidateReferrals)
    .innerJoin(authUsers, eq(authUsers.id, candidateReferrals.referredById))
    .leftJoin(usage, eq(usage.referralId, candidateReferrals.id))
    .where(
      and(
        eq(candidateReferrals.workspaceId, input.workspaceId),
        eq(candidateReferrals.candidateId, input.candidateId),
        eq(candidateReferrals.kind, "personal"),
        eq(candidateReferrals.status, "accepted"),
        or(
          isNull(candidateReferrals.expiresAt),
          gt(candidateReferrals.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);

  if (!row || row.used >= PERSONAL_REFERRAL_MAX_USES) return null;
  return {
    ...row,
    remaining: PERSONAL_REFERRAL_MAX_USES - row.used,
  };
}

export async function getPersonalReferralSummary(input: {
  workspaceId: string;
  candidateId: string;
}) {
  const [row] = await db
    .select({
      id: candidateReferrals.id,
      status: candidateReferrals.status,
      expiresAt: candidateReferrals.expiresAt,
      referrerName: authUsers.name,
      used: sql<number>`(
        select count(*)::int
        from ${applicationReferrals}
        where ${applicationReferrals.referralId} = ${candidateReferrals.id}
          and ${applicationReferrals.workspaceId} = ${input.workspaceId}
      )`,
    })
    .from(candidateReferrals)
    .innerJoin(authUsers, eq(authUsers.id, candidateReferrals.referredById))
    .where(
      and(
        eq(candidateReferrals.workspaceId, input.workspaceId),
        eq(candidateReferrals.candidateId, input.candidateId),
        eq(candidateReferrals.kind, "personal"),
      ),
    )
    .orderBy(desc(candidateReferrals.createdAt))
    .limit(1);
  if (!row) return null;
  const status =
    row.status !== "revoked" && row.expiresAt && row.expiresAt <= new Date()
      ? ("expired" as const)
      : row.status;
  return {
    ...row,
    status,
    remaining: Math.max(PERSONAL_REFERRAL_MAX_USES - row.used, 0),
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  transaction: vi.fn(),
  logAuditEvent: vi.fn(),
  revalidatePath: vi.fn(),
  resolvePortalSession: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  lt: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));
vi.mock("@/features/workspaces/permissions-server", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/audit-log", () => ({ logAuditEvent: mocks.logAuditEvent }));
vi.mock("@/lib/portal-auth", () => ({
  PORTAL_SESSION_COOKIE: "portal-session",
  resolvePortalSession: mocks.resolvePortalSession,
}));
vi.mock("@harly/db", () => ({
  activityEvents: { table: "activity" },
  candidateReferrals: {
    table: "referral",
    id: "candidate_referrals.id",
    workspaceId: "candidate_referrals.workspace_id",
    kind: "candidate_referrals.kind",
    referredById: "candidate_referrals.referred_by_id",
    referredEmailNormalized: "candidate_referrals.referred_email_normalized",
    status: "candidate_referrals.status",
    expiresAt: "candidate_referrals.expires_at",
    tokenHash: "candidate_referrals.token_hash",
    candidateId: "candidate_referrals.candidate_id",
  },
  emailOutbox: { table: "outbox" },
  user: { id: "user.id", name: "user.name" },
  db: { transaction: mocks.transaction },
}));

import {
  acceptPersonalReferral,
  createPersonalReferral,
} from "./personal-actions";

function thenable(value: unknown) {
  const chain = new Proxy(function () {}, {
    get(_target, property) {
      if (property === "then") {
        return (resolve: (result: unknown) => void) => resolve(value);
      }
      return () => chain;
    },
    apply() {
      return chain;
    },
  });
  return chain;
}

describe("personal referral actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    mocks.requirePermission.mockResolvedValue({
      organization: { id: "workspace-server", name: "Acme" },
      user: { id: "referrer-1", email: "referrer@example.com" },
    });
    mocks.logAuditEvent.mockResolvedValue(true);
  });

  it("creates in the authorized workspace, normalizes email, hashes the token, and queues mail", async () => {
    const inserts: Array<{ table: string; value: Record<string, unknown> }> =
      [];
    const tx = {
      update: () => ({ set: () => ({ where: () => thenable([]) }) }),
      select: () => thenable([]),
      insert: (table: { table: string }) => ({
        values: (
          value: Record<string, unknown> | Record<string, unknown>[],
        ) => {
          inserts.push({
            table: table.table,
            value: value as Record<string, unknown>,
          });
          if (table.table === "referral") {
            return { returning: async () => [{ id: "referral-1" }] };
          }
          return Promise.resolve();
        },
      }),
    };
    mocks.transaction.mockImplementation(async (callback) => callback(tx));

    await expect(
      createPersonalReferral({
        name: "Alex Smith",
        email: "  Alex@Example.COM ",
      }),
    ).resolves.toEqual({ ok: true });

    const referral = inserts.find((entry) => entry.table === "referral")?.value;
    const outbox = inserts.find((entry) => entry.table === "outbox")?.value;
    expect(mocks.requirePermission).toHaveBeenCalledWith("collab:write");
    expect(referral).toEqual(
      expect.objectContaining({
        workspaceId: "workspace-server",
        candidateId: null,
        jobId: null,
        referredEmailNormalized: "alex@example.com",
        status: "pending",
      }),
    );
    expect(referral?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(outbox).toEqual(
      expect.objectContaining({
        workspaceId: "workspace-server",
        kind: "referral.invitation",
        status: "pending",
        dedupeKey: "referral-invitation:referral-1",
      }),
    );
    expect(JSON.stringify(outbox?.payload)).not.toContain(
      String(referral?.tokenHash),
    );
  });

  it("rejects unauthorized creation before opening a transaction", async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error("forbidden"));
    await expect(
      createPersonalReferral({ name: "Alex Smith", email: "alex@example.com" }),
    ).resolves.toEqual({ ok: false, error: "Unable to send this referral." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("reports an explicit duplicate for the same referrer and normalized email", async () => {
    const tx = {
      update: () => ({ set: () => ({ where: () => thenable([]) }) }),
      select: () => thenable([{ id: "existing-referral" }]),
      insert: vi.fn(),
    };
    mocks.transaction.mockImplementation(async (callback) => callback(tx));

    await expect(
      createPersonalReferral({
        name: "Alex Smith",
        email: "ALEX@example.com",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "You already have an active referral for this email address.",
    });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("normalizes invalid input without touching the database", async () => {
    await expect(
      createPersonalReferral({ name: "A", email: "not-an-email" }),
    ).resolves.toEqual({ ok: false, error: "Enter the candidate's name." });
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("attaches an accepted referral to the authenticated matching candidate", async () => {
    const deleteCookie = vi.fn();
    mocks.cookies.mockResolvedValue({
      get: (name: string) => ({
        value:
          name === "harly_referral_context"
            ? "opaque-referral-token"
            : "portal-session-token",
      }),
      delete: deleteCookie,
    });
    mocks.resolvePortalSession.mockResolvedValue({
      workspaceId: "workspace-server",
      candidateId: "candidate-1",
      email: "Alex@Example.com",
    });
    const updates: Array<Record<string, unknown>> = [];
    let selectCall = 0;
    const tx = {
      execute: vi.fn().mockResolvedValue([{ id: "referral-1" }]),
      select: vi.fn(() => {
        selectCall += 1;
        return thenable(
          selectCall === 1
            ? [
                {
                  id: "referral-1",
                  workspaceId: "workspace-server",
                  candidateId: null,
                  email: "alex@example.com",
                  status: "pending",
                  expiresAt: null,
                  referrerName: "James Doe",
                },
              ]
            : [],
        );
      }),
      update: vi.fn(() => ({
        set: (value: Record<string, unknown>) => {
          updates.push(value);
          return {
            where: () => ({ returning: async () => [{ id: "referral-1" }] }),
          };
        },
      })),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    };
    mocks.transaction.mockImplementation(async (callback) => callback(tx));

    await expect(acceptPersonalReferral()).resolves.toEqual({
      ok: true,
      referrerName: "James Doe",
    });
    expect(updates).toEqual([
      expect.objectContaining({
        candidateId: "candidate-1",
        status: "accepted",
      }),
    ]);
    expect(deleteCookie).toHaveBeenCalledWith("harly_referral_context");
  });

  it("does not let another authenticated email claim the referral", async () => {
    mocks.cookies.mockResolvedValue({
      get: (name: string) => ({
        value:
          name === "harly_referral_context"
            ? "opaque-referral-token"
            : "portal-session-token",
      }),
      delete: vi.fn(),
    });
    mocks.resolvePortalSession.mockResolvedValue({
      workspaceId: "workspace-server",
      candidateId: "candidate-mallory",
      email: "mallory@example.com",
    });
    const tx = {
      execute: vi.fn().mockResolvedValue([{ id: "referral-1" }]),
      select: vi.fn(() =>
        thenable([
          {
            id: "referral-1",
            workspaceId: "workspace-server",
            candidateId: null,
            email: "alex@example.com",
            status: "pending",
            expiresAt: null,
            referrerName: "James Doe",
          },
        ]),
      ),
      update: vi.fn(),
      insert: vi.fn(),
    };
    mocks.transaction.mockImplementation(async (callback) => callback(tx));

    await expect(acceptPersonalReferral()).resolves.toEqual({
      ok: false,
      error: "Sign in with the email address that received this referral.",
    });
    expect(tx.update).not.toHaveBeenCalled();
  });
});

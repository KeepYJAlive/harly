import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: Object.assign(
    vi.fn(() => ({})),
    { join: vi.fn() },
  ),
}));

vi.mock("@harly/db", () => ({
  db: { transaction: vi.fn() },
  activityEvents: { table: "activity" },
  applicationReferrals: {
    table: "application-referrals",
    id: "application_referrals.id",
    workspaceId: "application_referrals.workspace_id",
    referralId: "application_referrals.referral_id",
    applicationId: "application_referrals.application_id",
    usageSlot: "application_referrals.usage_slot",
  },
  candidateReferrals: {
    id: "candidate_referrals.id",
    workspaceId: "candidate_referrals.workspace_id",
    candidateId: "candidate_referrals.candidate_id",
    kind: "candidate_referrals.kind",
    status: "candidate_referrals.status",
    expiresAt: "candidate_referrals.expires_at",
    referredById: "candidate_referrals.referred_by_id",
  },
  user: { id: "user.id", name: "user.name" },
}));

import {
  applyAcceptedPersonalReferral,
  PersonalReferralUseError,
} from "./personal-service";

type Use = { id: string; usageSlot: number };

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

function createTx(sharedUses: Use[], acquire?: () => Promise<void>) {
  let selectCall = 0;
  const activities: unknown[] = [];
  return {
    execute: vi.fn(async () => {
      await acquire?.();
      return [{ id: "referral-1" }];
    }),
    select: vi.fn(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return thenable([
          {
            id: "referral-1",
            status: "accepted",
            expiresAt: null,
            referredById: "referrer-1",
            referrerName: "James Doe",
          },
        ]);
      }
      if (selectCall === 2) return thenable([]);
      return thenable(sharedUses.map((use) => ({ usageSlot: use.usageSlot })));
    }),
    insert: vi.fn((table: { table?: string }) => ({
      values: (value: Record<string, unknown>) => {
        if (table.table === "application-referrals") {
          const created = {
            id: `use-${value.applicationId}`,
            usageSlot: Number(value.usageSlot),
          };
          sharedUses.push(created);
          return { returning: async () => [created] };
        }
        activities.push(value);
        return Promise.resolve();
      },
    })),
    update: vi.fn(() => ({ set: () => ({ where: async () => [] }) })),
    activities,
  };
}

describe("personal referral application usage", () => {
  it.each([
    [[], 1],
    [[{ id: "use-1", usageSlot: 1 }], 2],
    [
      [
        { id: "use-1", usageSlot: 1 },
        { id: "use-2", usageSlot: 2 },
      ],
      3,
    ],
  ] as const)(
    "allocates the next bounded usage slot",
    async (seed, expected) => {
      const uses: Use[] = seed.map((row) => ({ ...row }));
      const tx = createTx(uses);
      const result = await applyAcceptedPersonalReferral(tx as never, {
        workspaceId: "workspace-1",
        candidateId: "candidate-1",
        applicationId: `application-${expected}`,
      });
      expect(result.usageSlot).toBe(expected);
      expect(tx.execute).toHaveBeenCalledOnce();
      expect(tx.activities).toEqual([
        expect.objectContaining({
          type: "referral.applied",
          metadata: expect.objectContaining({ usageSlot: expected }),
        }),
      ]);
    },
  );

  it("rejects a fourth application", async () => {
    const uses: Use[] = [1, 2, 3].map((usageSlot) => ({
      id: `use-${usageSlot}`,
      usageSlot,
    }));
    const tx = createTx(uses);
    await expect(
      applyAcceptedPersonalReferral(tx as never, {
        workspaceId: "workspace-1",
        candidateId: "candidate-1",
        applicationId: "application-4",
      }),
    ).rejects.toBeInstanceOf(PersonalReferralUseError);
    expect(uses).toHaveLength(3);
  });

  it("can apply one person-specific referral to three distinct job applications", async () => {
    const uses: Use[] = [];

    for (const applicationId of [
      "digital-artist-application",
      "video-editor-application",
      "community-application",
    ]) {
      const tx = createTx(uses);
      await applyAcceptedPersonalReferral(tx as never, {
        workspaceId: "workspace-1",
        candidateId: "candidate-1",
        applicationId,
      });
    }

    expect(uses.map((use) => use.usageSlot)).toEqual([1, 2, 3]);
  });

  it("serializes two contenders for the third slot so only one succeeds", async () => {
    const uses: Use[] = [1, 2].map((usageSlot) => ({
      id: `use-${usageSlot}`,
      usageSlot,
    }));
    let release: (() => void) | null = null;
    let held = false;
    async function acquire() {
      if (!held) {
        held = true;
        return;
      }
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    async function run(applicationId: string) {
      const tx = createTx(uses, acquire);
      try {
        return await applyAcceptedPersonalReferral(tx as never, {
          workspaceId: "workspace-1",
          candidateId: "candidate-1",
          applicationId,
        });
      } finally {
        const next = release;
        release = null;
        next?.();
      }
    }

    const settled = await Promise.allSettled([
      run("application-a"),
      run("application-b"),
    ]);
    expect(
      settled.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      settled.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(uses.map((use) => use.usageSlot).sort()).toEqual([1, 2, 3]);
  });

  it("does not apply a referral owned by another candidate", async () => {
    const tx = createTx([]);
    tx.execute.mockResolvedValueOnce([]);
    await expect(
      applyAcceptedPersonalReferral(tx as never, {
        workspaceId: "workspace-1",
        candidateId: "other-candidate",
        applicationId: "application-1",
      }),
    ).rejects.toThrow("No active accepted referral");
  });
});

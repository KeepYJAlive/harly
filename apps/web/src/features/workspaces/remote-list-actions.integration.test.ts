import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  sql,
  organization,
  workspaceSettings,
  taoRemoteLists as lists,
  taoRemoteListEntries as entries,
} from "@harly/db";
const auth = vi.hoisted(() => ({
  workspace: "remote-list-test-a",
  allowed: true,
  demo: false,
}));
vi.mock("@/features/workspaces/permissions-server", () => ({
  requirePermission: vi.fn(async (permission) => {
    if (permission !== "integrations:manage" || !auth.allowed)
      throw new Error("Forbidden");
    return { organization: { id: auth.workspace }, user: { id: "test-admin" } };
  }),
}));
vi.mock("@/features/demo/assert-not-demo", () => ({
  assertNotDemo: () => {
    if (auth.demo) throw new Error("Demo locked");
  },
}));
vi.mock("@/lib/audit-log", () => ({ logAuditEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import {
  previewRemoteListAction,
  commitRemoteListAction,
  changeRemoteListAction,
  rotateRemoteListTokenAction,
  getRemoteListConnectionAction,
} from "./remote-list-actions";
import { getRemoteLists } from "@/lib/tao/remote-lists/data";
import { GET } from "@/app/api/plugins/tao/remote-lists/[key]/route";

// Run only through tooling/scripts/test-tao-remote-lists.mjs, against a disposable DB.
const isolated =
  process.env.HARLY_REMOTE_LIST_DB_TESTS === "true" &&
  new URL(process.env.DATABASE_URL!).pathname.startsWith(
    "/harly_remote_lists_check_",
  );
const workspaces = ["remote-list-test-a", "remote-list-test-b"];
const json = (
  values: { id: string; label: string; enabled?: boolean }[],
  name = "Topics",
) => JSON.stringify({ key: "topics", name, values });
const createTarget = { id: null, revision: null };
async function create(values = [{ id: "a", label: "Original" }]) {
  const input = json(values);
  const preview = await previewRemoteListAction(input, createTarget);
  if (!preview.ok) throw new Error(preview.error);
  expect(
    await commitRemoteListAction(input, createTarget, preview.receipt),
  ).toEqual({ ok: true });
  return (await getRemoteLists(auth.workspace))[0];
}
async function read(id: string) {
  const connection = await getRemoteListConnectionAction(id);
  if (!connection.ok) throw new Error(connection.error);
  const url = new URL(connection.sourceUrl);
  return {
    url,
    request: new Request("https://harly.test" + url.pathname, {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
          ).toString("base64"),
      },
    }),
  };
}
const ctx = { params: Promise.resolve({ key: "topics" }) };

describe.skipIf(!isolated)("Remote Lists with real PostgreSQL", () => {
  beforeEach(async () => {
    auth.workspace = workspaces[0];
    auth.allowed = true;
    auth.demo = false;
    process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.HARLY_URL = "https://harly.test";
    const existing = await db
      .select({ id: lists.id })
      .from(lists)
      .where(inArray(lists.organizationId, workspaces));
    if (existing.length)
      await db.delete(entries).where(
        inArray(
          entries.remoteListId,
          existing.map((l) => l.id),
        ),
      );
    await db.delete(lists).where(inArray(lists.organizationId, workspaces));
    await db.delete(organization).where(inArray(organization.id, workspaces));
    await db.insert(organization).values(
      workspaces.map((id) => ({
        id,
        slug: id,
        name: id,
        createdAt: new Date(),
      })),
    );
    await db.insert(workspaceSettings).values(
      workspaces.map((organizationId) => ({
        organizationId,
        taoEnabled: false,
        taoInstanceUrl: null,
      })),
    );
  });
  afterAll(async () => {
    await sql.end();
  });

  it("enforces unique keys per workspace and allows independent vocabularies", async () => {
    await create();
    expect(await previewRemoteListAction(json([]), createTarget)).toMatchObject(
      { ok: false, error: expect.stringContaining("already exists") },
    );
    auth.workspace = workspaces[1];
    await create();
    expect(await getRemoteLists(auth.workspace)).toHaveLength(1);
  });

  it("keeps database identities and external IDs stable on rename, preserving omissions", async () => {
    const list = await create([
      { id: "a", label: "Original" },
      { id: "b", label: "Retain me" },
    ]);
    const [before] = await db
      .select()
      .from(entries)
      .where(eq(entries.externalKey, "a"));
    const input = json([
      { id: "a", label: "Renamed" },
      { id: "c", label: "Added" },
    ]);
    const target = { id: list.id, revision: list.revision };
    const preview = await previewRemoteListAction(input, target);
    expect(preview.ok && preview.diff.removed.map((v) => v.id)).toEqual(["b"]);
    if (!preview.ok) throw new Error(preview.error);
    expect(
      await commitRemoteListAction(input, target, preview.receipt),
    ).toEqual({ ok: true });
    const [after] = await db
      .select()
      .from(entries)
      .where(eq(entries.externalKey, "a"));
    expect(after.id).toBe(before.id);
    expect(after.externalKey).toBe(before.externalKey);
    expect(after.label).toBe("Renamed");
    expect(
      (await getRemoteLists(auth.workspace))[0].values.map((v) => v.id),
    ).toEqual(["a", "c", "b"]);
  });

  it("rejects changed JSON, stale previews, and simultaneous updates", async () => {
    const list = await create();
    const target = { id: list.id, revision: list.revision };
    const input = json([{ id: "a", label: "Renamed" }]);
    const preview = await previewRemoteListAction(input, target);
    if (!preview.ok) throw new Error(preview.error);
    expect(
      (await commitRemoteListAction(json([]), target, preview.receipt)).ok,
    ).toBe(false);
    const results = await Promise.all([
      commitRemoteListAction(input, target, preview.receipt),
      commitRemoteListAction(input, target, preview.receipt),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      (await commitRemoteListAction(input, target, preview.receipt)).ok,
    ).toBe(false);
  });

  it("blocks key changes and deletion of nonempty lists; empty lists can be deleted", async () => {
    const list = await create();
    expect(
      (
        await previewRemoteListAction(
          json([]).replace('"topics"', '"renamed"'),
          { id: list.id, revision: list.revision },
        )
      ).ok,
    ).toBe(false);
    expect(
      await changeRemoteListAction({
        id: list.id,
        revision: list.revision,
        action: "delete",
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("TAO owns usage"),
    });
    auth.workspace = workspaces[1];
    const empty = await create([]);
    expect(
      await changeRemoteListAction({
        id: empty.id,
        revision: empty.revision,
        action: "delete",
      }),
    ).toEqual({ ok: true });
    expect(await getRemoteLists(auth.workspace)).toEqual([]);
  });

  it("prevents cross-workspace reads, edits, connection disclosure and receipt reuse", async () => {
    const list = await create();
    const target = { id: list.id, revision: list.revision };
    const preview = await previewRemoteListAction(json([]), target);
    if (!preview.ok) throw new Error(preview.error);
    auth.workspace = workspaces[1];
    expect((await previewRemoteListAction(json([]), target)).ok).toBe(false);
    expect(
      (await commitRemoteListAction(json([]), target, preview.receipt)).ok,
    ).toBe(false);
    expect(
      (await changeRemoteListAction({ ...target, action: "enable" })).ok,
    ).toBe(false);
    expect((await getRemoteListConnectionAction(list.id)).ok).toBe(false);
  });

  it("serves native JSONPath fields with Basic auth, revokes rotated tokens and preserves disabled references", async () => {
    const list = await create();
    const input = json([{ id: "a", label: "Original", enabled: false }]);
    const target = { id: list.id, revision: list.revision };
    const preview = await previewRemoteListAction(input, target);
    if (!preview.ok) throw new Error(preview.error);
    expect(
      (await commitRemoteListAction(input, target, preview.receipt)).ok,
    ).toBe(true);
    expect((await rotateRemoteListTokenAction()).ok).toBe(true);
    const { request, url } = await read(list.id);
    const [settings] = await db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.organizationId, auth.workspace));
    expect(settings.taoRemoteListTokenCiphertext).not.toContain(url.password);
    expect((await GET(request, ctx)).status).toBe(409);
    const current = (await getRemoteLists(auth.workspace))[0];
    expect(
      (
        await changeRemoteListAction({
          id: current.id,
          revision: current.revision,
          action: "enable",
        })
      ).ok,
    ).toBe(true);
    const response = await GET(request, ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      values: [
        { uri: `urn:harly:remote-list:${list.id}:a`, label: "Original" },
      ],
    });
    await rotateRemoteListTokenAction();
    expect((await GET(request, ctx)).status).toBe(401);
    expect((await GET((await read(list.id)).request, ctx)).status).toBe(200);
  });

  it("requires an administrator session for all actions and honors demo locks", async () => {
    const list = await create();
    auth.allowed = false;
    const actions = [
      () => previewRemoteListAction(json([]), createTarget),
      () =>
        commitRemoteListAction(json([]), createTarget, {
          ciphertext: "",
          iv: "",
          tag: "",
        }),
      () =>
        changeRemoteListAction({
          id: list.id,
          revision: list.revision,
          action: "delete",
        }),
      () => rotateRemoteListTokenAction(),
      () => getRemoteListConnectionAction(list.id),
    ];
    for (const action of actions)
      await expect(action()).rejects.toThrow("Forbidden");
    auth.allowed = true;
    auth.demo = true;
    for (const action of actions)
      await expect(action()).rejects.toThrow("Demo locked");
  });
});

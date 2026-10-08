import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock("@harly/db", () => ({
  db: { select: mocks.select, transaction: mocks.transaction },
  workspaceSettings: {},
  taoRemoteLists: {},
  taoRemoteListEntries: {},
}));
vi.mock("@/lib/crypto", () => ({ decryptSecret: mocks.decrypt }));
vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => args,
  and: (...args: unknown[]) => args,
  asc: (arg: unknown) => arg,
}));
import { GET } from "./route";
const token = "a".repeat(43);
function query(value: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "for", "orderBy"])
    chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(value).then(resolve);
  return chain;
}
const request = (
  headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`workspace-a:${token}`).toString("base64")}`,
  },
) =>
  new Request("https://harly.test/api/plugins/tao/remote-lists/topics", {
    headers,
  });
const context = { params: Promise.resolve({ key: "topics" }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.decrypt.mockReturnValue(token);
  mocks.select.mockReturnValue(
    query([{ ciphertext: "encrypted", iv: "iv", tag: "tag", enabled: false }]),
  );
  mocks.transaction.mockImplementation((fn) => fn({ select: mocks.select }));
});
describe("TAO RemoteSource read boundary", () => {
  it.each<Record<string, string>>([
    {},
    { Authorization: `Bearer ${token}` },
    { "X-Harly-Workspace": "workspace-a" },
    { Authorization: "Bearer bad", "X-Harly-Workspace": "workspace-a" },
  ])(
    "rejects missing/invalid credentials without loading a list",
    async (headers) => {
      const res = await GET(request(headers), context);
      expect(res.status).toBe(401);
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
  it("rejects a token from another workspace", async () => {
    mocks.decrypt.mockReturnValue("b".repeat(43));
    expect((await GET(request(), context)).status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("fails closed for missing configuration or corrupt secrets", async () => {
    mocks.select.mockReturnValueOnce(query([]));
    expect((await GET(request(), context)).status).toBe(401);
    mocks.decrypt.mockImplementation(() => {
      throw new Error("corrupt");
    });
    expect((await GET(request(), context)).status).toBe(401);
  });
  it("never returns an empty success for a disabled list", async () => {
    mocks.select
      .mockReturnValueOnce(
        query([{ ciphertext: "encrypted", iv: "iv", tag: "tag" }]),
      )
      .mockReturnValueOnce(query([{ id: "list-id", enabled: false }]));
    expect((await GET(request(), context)).status).toBe(409);
  });
  it("serves vocabulary without any TAO connection or enabled LTI integration", async () => {
    mocks.select
      .mockReturnValueOnce(
        query([
          { ciphertext: "encrypted", iv: "iv", tag: "tag", enabled: false },
        ]),
      )
      .mockReturnValueOnce(
        query([
          {
            id: "list-id",
            key: "topics",
            name: "Topics",
            revision: 2,
            enabled: true,
          },
        ]),
      )
      .mockReturnValueOnce(
        query([{ id: "stable", label: "Renamed", enabled: false }]),
      );
    const res = await GET(request(), context);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({
      values: [
        { label: "Renamed", uri: "urn:harly:remote-list:list-id:stable" },
      ],
    });
  });
});

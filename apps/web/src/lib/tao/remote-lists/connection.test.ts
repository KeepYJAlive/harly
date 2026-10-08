import { describe, expect, it } from "vitest";
import { parseRemoteListCredentials, remoteListSourceUrl } from "./connection";
const token = "a".repeat(43);
const basic = (text: string) => `Basic ${Buffer.from(text).toString("base64")}`;
describe("native TAO source connection", () => {
  it("maps URL credentials to HTTP Basic without custom headers or queries", () => {
    const source = new URL(
      remoteListSourceUrl("https://harly.test", "workspace-a", "topics", token),
    );
    expect(source.pathname).toBe("/api/plugins/tao/remote-lists/topics");
    expect(source.search).toBe("");
    expect(
      parseRemoteListCredentials(
        basic(`${source.username}:${source.password}`),
      ),
    ).toEqual({ workspace: "workspace-a", token });
  });
  it("requires HTTPS", () => {
    expect(() =>
      remoteListSourceUrl("http://harly.test", "workspace-a", "topics", token),
    ).toThrow("HTTPS");
  });
  it.each([
    null,
    "",
    `Bearer ${token}`,
    "Basic !!!!",
    basic(`:${token}`),
    basic(`workspace:bad`),
    basic(`workspace\n:${token}`),
    basic(`workspace:${token}:extra`),
    `Basic ${"A".repeat(1025)}`,
  ])("rejects malformed credentials: %j", (value) => {
    expect(parseRemoteListCredentials(value)).toBeNull();
  });
});

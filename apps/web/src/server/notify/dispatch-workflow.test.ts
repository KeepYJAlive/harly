import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getWorkspaceChatConfig: vi.fn(),
  getWorkspaceSlackConfig: vi.fn(),
  getWorkspaceTelegramConfig: vi.fn(),
}));

vi.mock("@harly/db", () => {
  const emptyQuery = () => ({
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => []),
  });
  return {
    db: { select: vi.fn(emptyQuery) },
    candidates: {},
    jobs: {},
    organization: {},
    workspaceSettings: {},
  };
});
vi.mock("@/lib/notify/config", () => ({ getWorkspaceChatConfig: mocks.getWorkspaceChatConfig }));
vi.mock("@/lib/slack/config", () => ({ getWorkspaceSlackConfig: mocks.getWorkspaceSlackConfig }));
vi.mock("@/lib/telegram/config", () => ({ getWorkspaceTelegramConfig: mocks.getWorkspaceTelegramConfig }));
vi.mock("@/lib/telegram/client", () => ({ sendTelegramMessage: vi.fn() }));
vi.mock("@/lib/public-origin", () => ({ getHarlyPublicOrigin: () => "https://app.example.test" }));

import {
  sendWorkflowChatMessage,
  sendWorkflowDiscordMessage,
  WorkflowChatDeliveryUncertainError,
} from "./dispatch";

describe("workflow chat delivery", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.getWorkspaceChatConfig.mockReset();
    mocks.getWorkspaceSlackConfig.mockReset();
    mocks.getWorkspaceTelegramConfig.mockReset();
    mocks.getWorkspaceSlackConfig.mockResolvedValue(null);
    mocks.getWorkspaceTelegramConfig.mockResolvedValue(null);
    mocks.getWorkspaceChatConfig.mockResolvedValue({
      provider: "discord",
      webhookUrl: "https://discord.example.test/webhook",
      events: [],
    });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("propagates the effect key and treats an ambiguous webhook response as uncertain", async () => {
    mocks.fetch.mockResolvedValue(new Response("gateway timeout", { status: 504 }));

    await expect(
      sendWorkflowChatMessage(
        "workspace-1",
        "candidate.created",
        { eventId: "workflow:run-1:node:chat", candidate: { id: "candidate-1", name: "Ada" } },
      ),
    ).rejects.toBeInstanceOf(WorkflowChatDeliveryUncertainError);

    const [, request] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(request.headers);
    expect(headers.get("Idempotency-Key")).toBe("workflow:run-1:node:chat");
    expect(headers.get("X-Harly-Idempotency-Key")).toBe("workflow:run-1:node:chat");
  });

  it("keeps an explicit provider rejection out of uncertain reconciliation", async () => {
    mocks.fetch.mockResolvedValue(new Response("invalid payload", { status: 400 }));

    await expect(
      sendWorkflowChatMessage("workspace-1", "candidate.created", { eventId: "effect-400" }),
    ).rejects.toMatchObject({ uncertain: false, retryable: false });
  });

  it("marks provider rate limiting as retryable without claiming delivery uncertainty", async () => {
    mocks.fetch.mockResolvedValue(new Response("slow down", { status: 429 }));

    await expect(
      sendWorkflowChatMessage("workspace-1", "candidate.created", { eventId: "effect-429" }),
    ).rejects.toMatchObject({ uncertain: false, retryable: true });
  });

  it("propagates the workflow effect key to direct Discord delivery", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      sendWorkflowDiscordMessage("workspace-1", "candidate.created", {
        eventId: "effect-discord-1",
        candidate: { id: "candidate-1", name: "Ada" },
      }),
    ).resolves.toEqual({ provider: "discord" });

    const [, request] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(new Headers(request.headers).get("Idempotency-Key")).toBe("effect-discord-1");
  });
});

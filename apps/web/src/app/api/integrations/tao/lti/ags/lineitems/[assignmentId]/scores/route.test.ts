import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recordTaoAgsScore: vi.fn() }));

vi.mock("@/lib/tao/lti/ags", () => ({
  AGS_SCORE_CONTENT_TYPE: "application/vnd.ims.lis.v1.score+json",
  recordTaoAgsScore: mocks.recordTaoAgsScore,
  TaoAgsError: class TaoAgsError extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { POST } from "./route";

const URL =
  "https://harly.example/api/integrations/tao/lti/ags/lineitems/assignment-a/scores";
const SCORE = {
  userId: "opaque-user",
  scoreGiven: 84,
  scoreMaximum: 100,
  timestamp: "2026-09-29T12:00:00.000Z",
  activityProgress: "Completed",
  gradingProgress: "FullyGraded",
};

function context() {
  return { params: Promise.resolve({ assignmentId: "assignment-a" }) };
}

describe("TAO AGS scores route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires the AGS score media type", async () => {
    const response = await POST(
      new Request(URL, {
        method: "POST",
        headers: { Authorization: "Bearer access-token" },
        body: JSON.stringify(SCORE),
      }),
      context(),
    );
    expect(response.status).toBe(415);
    expect(mocks.recordTaoAgsScore).not.toHaveBeenCalled();
  });

  it("requires a bearer token", async () => {
    const response = await POST(
      new Request(URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.ims.lis.v1.score+json",
        },
        body: JSON.stringify(SCORE),
      }),
      context(),
    );
    expect(response.status).toBe(401);
  });

  it("passes the route-bound assignment and token to the AGS service", async () => {
    mocks.recordTaoAgsScore.mockResolvedValueOnce({ updated: true });
    const response = await POST(
      new Request(URL, {
        method: "POST",
        headers: {
          Authorization: "Bearer access-token",
          "Content-Type":
            "application/vnd.ims.lis.v1.score+json; charset=utf-8",
        },
        body: JSON.stringify(SCORE),
      }),
      context(),
    );
    expect(response.status).toBe(204);
    expect(mocks.recordTaoAgsScore).toHaveBeenCalledWith({
      assignmentId: "assignment-a",
      accessToken: "access-token",
      score: SCORE,
    });
  });

  it("returns a safe error without provider or assignment details", async () => {
    const { TaoAgsError } = await import("@/lib/tao/lti/ags");
    mocks.recordTaoAgsScore.mockRejectedValueOnce(
      new TaoAgsError(404, "The line item is unavailable."),
    );
    const response = await POST(
      new Request(URL, {
        method: "POST",
        headers: {
          Authorization: "Bearer access-token",
          "Content-Type": "application/vnd.ims.lis.v1.score+json",
        },
        body: JSON.stringify(SCORE),
      }),
      context(),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("assignment-a");
  });
});

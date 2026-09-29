import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/notification-island/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("./assignment-actions", () => ({
  assignAssessmentAction: vi.fn(),
  cancelAssessmentAssignmentAction: vi.fn(),
  regenerateAssessmentLinkAction: vi.fn(),
}));

import { ApplicationAssessmentsPanel } from "./ApplicationAssessmentsPanel";

describe("ApplicationAssessmentsPanel", () => {
  it("distinguishes a real zero score from a missing result", () => {
    const markup = renderToStaticMarkup(
      createElement(ApplicationAssessmentsPanel, {
        applications: [{ id: "application-a", jobTitle: "Digital Artist" }],
        definitions: [],
        canManage: true,
        assignments: [
          {
            id: "assignment-a",
            applicationId: "application-a",
            jobTitle: "Digital Artist",
            assessmentName: "Portfolio knowledge",
            status: "completed",
            assignedAt: "2026-09-29T10:00:00.000Z",
            startedAt: "2026-09-29T10:05:00.000Z",
            completedAt: "2026-09-29T10:30:00.000Z",
            expiresAt: null,
            score: 0,
            maxScore: 100,
            activityProgress: "Completed",
            gradingProgress: "FullyGraded",
            resultReceivedAt: "2026-09-29T10:31:00.000Z",
            syncedAt: "2026-09-29T10:31:00.000Z",
            sourceStageName: "Assessment",
          },
        ],
      }),
    );

    expect(markup).toContain("Score: 0 / 100");
    expect(markup).toContain("Fully Graded");
    expect(markup).not.toContain("pending grading or result synchronization");
  });

  it("shows completed work with an incomplete grade as grading pending", () => {
    const markup = renderToStaticMarkup(
      createElement(ApplicationAssessmentsPanel, {
        applications: [{ id: "application-a", jobTitle: "Video Editor" }],
        definitions: [],
        canManage: true,
        assignments: [
          {
            id: "assignment-a",
            applicationId: "application-a",
            jobTitle: "Video Editor",
            assessmentName: "Editing knowledge",
            status: "completed",
            assignedAt: "2026-09-29T10:00:00.000Z",
            startedAt: "2026-09-29T10:05:00.000Z",
            completedAt: "2026-09-29T10:30:00.000Z",
            expiresAt: null,
            score: null,
            maxScore: null,
            activityProgress: "Completed",
            gradingProgress: "PendingManual",
            resultReceivedAt: "2026-09-29T10:31:00.000Z",
            syncedAt: "2026-09-29T10:31:00.000Z",
            sourceStageName: "Assessment",
          },
        ],
      }),
    );

    expect(markup).toContain("Completed — grading pending");
    expect(markup).toContain(
      "Score: pending grading or result synchronization",
    );
  });
});

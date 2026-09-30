import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.HARLY_URL = "https://harly.example";
  process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters-long";
});

import { ApplicationDisclosure } from "./CandidateDetailsPanel";

const application = {
  id: "application-1",
  jobId: "job-1",
  jobTitle: "Digital Artist",
  currentStageName: "Screening",
  status: "active",
  appliedAt: "2026-09-29T12:00:00.000Z",
  source: "public_form",
  answers: [],
  referral: null,
};

describe("application referral attribution", () => {
  it("shows the immutable referrer snapshot on a referred application", () => {
    const html = renderToStaticMarkup(
      <ApplicationDisclosure
        application={{
          ...application,
          referral: {
            referrerName: "James Doe at submission",
            acceptedAt: "2026-09-28T12:00:00.000Z",
            appliedAt: "2026-09-29T12:00:00.000Z",
          },
        }}
      />,
    );

    expect(html).toContain("Referred by James Doe at submission");
    expect(html).toContain("Referral details");
  });

  it("does not label an ordinary application as referred", () => {
    const html = renderToStaticMarkup(
      <ApplicationDisclosure application={application} />,
    );

    expect(html).not.toContain("Referred by");
    expect(html).not.toContain("Referral details");
  });
});

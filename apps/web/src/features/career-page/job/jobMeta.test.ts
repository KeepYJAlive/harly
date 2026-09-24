import { describe, expect, it } from "vitest";

import { buildJobMeta, formatCompensation, type JobLike } from "./jobMeta";

const volunteer: JobLike = {
  slug: "digital-artist",
  title: "Digital Artist",
  department: "Creative",
  location: "Remote",
  opportunityType: "volunteer",
  employmentType: null,
  workplaceType: "remote",
  salaryMin: null,
  salaryMax: null,
  minimumHours: 5,
  commitmentPeriod: "month",
};

describe("volunteer opportunity metadata", () => {
  it("never formats volunteer compensation as a salary", () => {
    expect(
      formatCompensation({ ...volunteer, salaryMin: 0, salaryMax: 0 }),
    ).toBeNull();
  });

  it("shows volunteer status and a structured minimum time commitment", () => {
    const metadata = buildJobMeta(volunteer);
    expect(metadata).toEqual(
      expect.arrayContaining([
        { label: "Opportunity", value: "Volunteer Opportunity" },
        {
          label: "Minimum Time Commitment",
          value: "5 hours per month",
        },
      ]),
    );
    expect(metadata.some((item) => item.label === "Compensation")).toBe(false);
  });
});

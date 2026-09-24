import { describe, expect, it } from "vitest";

import {
  formatEmploymentType,
  formatMinimumTimeCommitment,
  formatOpportunityType,
  formatWorkplaceType,
  formatJobStatus,
} from "@/lib/format";

describe("formatEmploymentType", () => {
  it("formats full_time", () => {
    expect(formatEmploymentType("full_time")).toBe("Full Time");
  });

  it("formats part_time", () => {
    expect(formatEmploymentType("part_time")).toBe("Part Time");
  });

  it("formats contract", () => {
    expect(formatEmploymentType("contract")).toBe("Contract");
  });

  it("formats internship", () => {
    expect(formatEmploymentType("internship")).toBe("Internship");
  });

  it("formats temporary", () => {
    expect(formatEmploymentType("temporary")).toBe("Temporary");
  });
});

describe("opportunity formatting", () => {
  it("labels volunteer and employment opportunities", () => {
    expect(formatOpportunityType("volunteer")).toBe("Volunteer Opportunity");
    expect(formatOpportunityType("employment")).toBe("Career Opportunity");
  });

  it("formats structured volunteer commitment", () => {
    expect(formatMinimumTimeCommitment(5, "month")).toBe(
      "5 hours per month",
    );
    expect(
      formatMinimumTimeCommitment(5, "month", { compact: true }),
    ).toBe("5 hours/month");
  });
});

describe("formatWorkplaceType", () => {
  it("formats remote", () => {
    expect(formatWorkplaceType("remote")).toBe("Remote");
  });

  it("formats hybrid", () => {
    expect(formatWorkplaceType("hybrid")).toBe("Hybrid");
  });

  it("formats onsite", () => {
    expect(formatWorkplaceType("onsite")).toBe("Onsite");
  });
});

describe("formatJobStatus", () => {
  it("formats draft", () => {
    expect(formatJobStatus("draft")).toBe("Draft");
  });

  it("formats open", () => {
    expect(formatJobStatus("open")).toBe("Open");
  });

  it("formats closed", () => {
    expect(formatJobStatus("closed")).toBe("Closed");
  });
});

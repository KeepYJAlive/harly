import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));
vi.mock("@/features/assessments/stage-actions", () => ({
  saveStageAssessmentConfigurationAction: vi.fn(),
}));

import {
  filterTaoAssessmentOptions,
  toggleAssessmentSelection,
} from "./PipelineStageAssessmentsDialog";

const ASSESSMENTS = [
  {
    id: "one",
    name: "Young Justice Knowledge Assessment",
    description: null,
    externalId: "9ddca443197e",
    active: true,
  },
  {
    id: "two",
    name: "Volunteer Situational Judgment",
    description: null,
    externalId: "delivery-sjt",
    active: true,
  },
];

describe("pipeline assessment picker", () => {
  it("searches by friendly name and TAO delivery ID", () => {
    expect(filterTaoAssessmentOptions(ASSESSMENTS, "justice")).toEqual([
      ASSESSMENTS[0],
    ]);
    expect(filterTaoAssessmentOptions(ASSESSMENTS, "delivery-sjt")).toEqual([
      ASSESSMENTS[1],
    ]);
  });

  it("supports multiple selections without duplicating an item", () => {
    const first = toggleAssessmentSelection([], "one", true);
    const multiple = toggleAssessmentSelection(first, "two", true);
    expect(multiple).toEqual(["one", "two"]);
    expect(toggleAssessmentSelection(multiple, "one", true)).toEqual(multiple);
    expect(toggleAssessmentSelection(multiple, "one", false)).toEqual(["two"]);
  });
});

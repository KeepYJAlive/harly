import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  AssessmentInvitation,
  assessmentInvitationSubject,
} from "@harly/emails";

const BASE_PROPS = {
  candidateName: "Ava",
  jobTitle: "Digital Artist Volunteer",
  assessmentName: "Digital Artist Assessment",
  companyName: "#KeepYJAlive",
  assessmentUrl: "https://opportunities.example/assessment/opaque-token",
};

describe("AssessmentInvitation email", () => {
  function textContent(node: ReactNode): string {
    if (typeof node === "string" || typeof node === "number") {
      return String(node);
    }
    if (Array.isArray(node)) return node.map(textContent).join("");
    if (!isValidElement<{ children?: ReactNode }>(node)) return "";
    return textContent(node.props.children);
  }

  function hrefs(node: ReactNode): string[] {
    if (Array.isArray(node)) return node.flatMap(hrefs);
    if (!isValidElement<{ children?: ReactNode; href?: string }>(node))
      return [];
    return [
      ...(node.props.href ? [node.props.href] : []),
      ...hrefs(node.props.children),
    ];
  }

  it("uses the secure Harly route and renders a configured deadline", () => {
    const email = AssessmentInvitation({
      ...BASE_PROPS,
      dueDate: "October 6, 2026",
      estimatedDuration: "30 minutes",
    });
    const content = textContent(email);
    const links = hrefs(email);

    expect(assessmentInvitationSubject(BASE_PROPS)).toBe(
      "Action required: Complete your #KeepYJAlive assessment",
    );
    expect(content).toContain("Start assessment");
    expect(links).toContain(
      "https://opportunities.example/assessment/opaque-token",
    );
    expect(links.join(" ")).not.toContain(
      "/deliver/api/v1/auth/launch-lti-1p3",
    );
    expect(content).toContain("Due: October 6, 2026");
    expect(content).toContain("Estimated time: 30 minutes");
  });

  it("clearly renders an assessment without a deadline", () => {
    expect(textContent(AssessmentInvitation(BASE_PROPS))).toContain(
      "No deadline",
    );
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./personal-actions", () => ({
  acceptPersonalReferral: vi.fn(),
}));

import { ReferralLandingModal } from "./ReferralLandingModal";

describe("ReferralLandingModal", () => {
  it("renders the unauthenticated careers referral experience", () => {
    const html = renderToStaticMarkup(
      <ReferralLandingModal
        referrerName="James Doe"
        companyName="#KeepYJAlive"
        workspaceSlug="keepyjalive"
        boardRoot="/board/keepyjalive"
        authenticated={false}
        accepted={false}
        remaining={3}
      />,
    );
    expect(html).toContain("You&#x27;ve been referred!");
    expect(html).toContain("James Doe");
    expect(html).toContain("up to 3 applications");
    expect(html).toContain("Sign in to accept referral");
    expect(html).toContain("Create profile");
    expect(html).not.toContain("james@example.com");
  });

  it("renders accepted state and remaining usage", () => {
    const html = renderToStaticMarkup(
      <ReferralLandingModal
        referrerName="James Doe"
        companyName="#KeepYJAlive"
        workspaceSlug="keepyjalive"
        boardRoot="/board/keepyjalive"
        authenticated
        accepted
        remaining={1}
      />,
    );
    expect(html).toContain("Referral accepted");
    expect(html).toContain("1 applications remaining");
    expect(html).toContain("Browse opportunities");
  });
});

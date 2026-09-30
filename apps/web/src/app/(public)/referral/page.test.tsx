import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`);
  }),
  resolvePersonalReferralToken: vi.fn(),
  resolvePortalSession: vi.fn(),
  getCareerPageData: vi.fn(),
  isPortalEnabled: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/candidates/referrals/personal-data", () => ({
  resolvePersonalReferralToken: mocks.resolvePersonalReferralToken,
}));
vi.mock("@/features/career-page/data", () => ({
  getCareerPageData: mocks.getCareerPageData,
}));
vi.mock("@/lib/portal-auth", () => ({
  PORTAL_SESSION_COOKIE: "harly_portal_session",
  isPortalEnabled: mocks.isPortalEnabled,
  resolvePortalSession: mocks.resolvePortalSession,
}));
vi.mock("@/features/career-page/PublicCareerPage", () => ({
  PublicCareerPage: () => null,
}));
vi.mock("@/features/candidates/referrals/ReferralLandingModal", () => ({
  ReferralLandingModal: () => null,
}));

import ReferralLandingPage from "./page";

function cookieStore(values: Record<string, string>) {
  return {
    get: (name: string) =>
      values[name] === undefined ? undefined : { value: values[name] },
  };
}

describe("referral landing authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePersonalReferralToken.mockResolvedValue({
      status: "pending",
      workspaceId: "workspace-1",
      workspaceSlug: "keepyjalive",
    });
  });

  it("redirects immediately to workspace login without a portal cookie", async () => {
    mocks.cookies.mockResolvedValue(
      cookieStore({ harly_referral_context: "referral-token" }),
    );

    await expect(ReferralLandingPage()).rejects.toThrow(
      "redirect:/portal/login?workspace=keepyjalive&next=%2Freferral",
    );
    expect(mocks.resolvePortalSession).not.toHaveBeenCalled();
    expect(mocks.getCareerPageData).not.toHaveBeenCalled();
  });

  it("redirects an invalid portal session back through login", async () => {
    mocks.cookies.mockResolvedValue(
      cookieStore({
        harly_referral_context: "referral-token",
        harly_portal_session: "invalid-session",
      }),
    );
    mocks.resolvePortalSession.mockResolvedValue(null);

    await expect(ReferralLandingPage()).rejects.toThrow(
      "redirect:/portal/login?workspace=keepyjalive&next=%2Freferral",
    );
    expect(mocks.resolvePortalSession).toHaveBeenCalledWith("invalid-session");
  });
});

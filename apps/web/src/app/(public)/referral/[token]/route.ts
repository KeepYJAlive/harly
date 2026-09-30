import { NextResponse, type NextRequest } from "next/server";

import { resolvePersonalReferralToken } from "@/features/candidates/referrals/personal-data";
import {
  buildPersonalReferralLoginPath,
  PERSONAL_REFERRAL_COOKIE,
} from "@/features/candidates/referrals/personal";
import { PORTAL_SESSION_COOKIE } from "@/lib/portal-auth";
import { toHarlyPublicUrl } from "@/lib/public-origin";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const referral = await resolvePersonalReferralToken(token);
  const referralDestination = new URL(toHarlyPublicUrl("/referral"));
  if (!referral || !["pending", "accepted"].includes(referral.status)) {
    referralDestination.searchParams.set("error", "unavailable");
    const response = NextResponse.redirect(referralDestination);
    response.cookies.delete(PERSONAL_REFERRAL_COOKIE);
    return response;
  }

  const destination = request.cookies.get(PORTAL_SESSION_COOKIE)?.value
    ? referralDestination
    : new URL(
        toHarlyPublicUrl(
          buildPersonalReferralLoginPath(referral.workspaceSlug),
        ),
      );
  const response = NextResponse.redirect(destination);
  response.cookies.set(PERSONAL_REFERRAL_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}

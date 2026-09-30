import { NextResponse, type NextRequest } from "next/server";

import { resolvePersonalReferralToken } from "@/features/candidates/referrals/personal-data";
import { PERSONAL_REFERRAL_COOKIE } from "@/features/candidates/referrals/personal";
import { toHarlyPublicUrl } from "@/lib/public-origin";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const referral = await resolvePersonalReferralToken(token);
  const destination = new URL(toHarlyPublicUrl("/referral"));
  if (!referral || !["pending", "accepted"].includes(referral.status)) {
    destination.searchParams.set("error", "unavailable");
    const response = NextResponse.redirect(destination);
    response.cookies.delete(PERSONAL_REFERRAL_COOKIE);
    return response;
  }

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

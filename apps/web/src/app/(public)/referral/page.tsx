import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { PublicCareerPage } from "@/features/career-page/PublicCareerPage";
import { getCareerPageData } from "@/features/career-page/data";
import { ReferralLandingModal } from "@/features/candidates/referrals/ReferralLandingModal";
import { resolvePersonalReferralToken } from "@/features/candidates/referrals/personal-data";
import {
  buildPersonalReferralLoginPath,
  PERSONAL_REFERRAL_COOKIE,
} from "@/features/candidates/referrals/personal";
import {
  PORTAL_SESSION_COOKIE,
  isPortalEnabled,
  resolvePortalSession,
} from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

function UnavailableReferral() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6">
      <div className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Referral unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This referral link is invalid or no longer available. Contact the
          person or organization that sent it to you.
        </p>
      </div>
    </main>
  );
}

export default async function ReferralLandingPage() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(PERSONAL_REFERRAL_COOKIE)?.value;
  if (!rawToken) return <UnavailableReferral />;

  const referral = await resolvePersonalReferralToken(rawToken);
  if (!referral || !["pending", "accepted"].includes(referral.status)) {
    return <UnavailableReferral />;
  }

  const sessionToken = cookieStore.get(PORTAL_SESSION_COOKIE)?.value;
  const session = sessionToken
    ? await resolvePortalSession(sessionToken)
    : null;
  const authenticated = session?.workspaceId === referral.workspaceId;
  if (!authenticated) {
    redirect(buildPersonalReferralLoginPath(referral.workspaceSlug) as Route);
  }
  const [data, portalEnabled] = await Promise.all([
    getCareerPageData(referral.workspaceSlug),
    isPortalEnabled(referral.workspaceId),
  ]);
  if (!data) return <UnavailableReferral />;

  const acceptedByViewer = Boolean(
    referral.status === "accepted" &&
    referral.candidateId === session.candidateId,
  );

  const boardRoot = `/board/${referral.workspaceSlug}`;
  return (
    <>
      <PublicCareerPage
        workspace={data.workspace}
        jobs={data.jobs.map(
          ({
            id,
            slug,
            title,
            department,
            location,
            opportunityType,
            employmentType,
            workplaceType,
            minimumHours,
            commitmentPeriod,
          }) => ({
            id,
            slug,
            title,
            department,
            location,
            opportunityType,
            employmentType,
            workplaceType,
            minimumHours,
            commitmentPeriod,
          }),
        )}
        config={data.config}
        boardRoot={boardRoot}
        portalEnabled={portalEnabled}
      />
      <ReferralLandingModal
        referrerName={referral.referrerName}
        companyName={referral.workspaceName}
        boardRoot={boardRoot}
        accepted={acceptedByViewer}
        remaining={referral.remaining}
      />
    </>
  );
}

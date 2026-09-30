import { notFound } from "next/navigation";

import { ApplyForm } from "@/features/applications/ApplyForm";
import { JobChrome } from "@/features/career-page/job/JobChrome";
import { getPublicJobDetail } from "@/features/jobs/data";
import { normalizeJobApplicationConfig } from "@/features/jobs/config";
import { resolveCaptchaSiteKey } from "@/lib/captcha";
import { isPortalEnabled } from "@/lib/portal-auth";
import { PORTAL_SESSION_COOKIE, resolvePortalSession } from "@/lib/portal-auth";
import { getAcceptedPersonalReferral } from "@/features/candidates/referrals/personal-data";
import { cookies } from "next/headers";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: true } };
export default async function BoardApplyPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; jobSlug: string }>;
}) {
  const { workspaceSlug, jobSlug } = await params;
  const detail = await getPublicJobDetail({ workspaceSlug, jobSlug });
  if (!detail) notFound();
  const { job, workspace, config } = detail;
  const [captcha, portalEnabled] = await Promise.all([
    resolveCaptchaSiteKey(workspace.id),
    isPortalEnabled(),
  ]);
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(PORTAL_SESSION_COOKIE)?.value;
  const session = sessionToken
    ? await resolvePortalSession(sessionToken)
    : null;
  const referral =
    session?.workspaceId === workspace.id
      ? await getAcceptedPersonalReferral({
          workspaceId: workspace.id,
          candidateId: session.candidateId,
        })
      : null;
  const form = (
    <ApplyForm
      jobSlug={job.slug}
      workspaceSlug={workspace.slug}
      opportunityType={job.opportunityType}
      applicationConfig={normalizeJobApplicationConfig(job.applicationConfig)}
      variant={
        config.template === "ashby"
          ? "ashby"
          : config.template === "join"
            ? "join"
            : "default"
      }
      captchaProvider={captcha?.provider ?? null}
      captchaSiteKey={captcha?.siteKey ?? null}
      legalConfigured={workspace.legalConfigured}
      consentCheckboxText={workspace.consentCheckboxText}
      legalPages={workspace.legalPages}
      legalBasePath={`/board/${workspace.slug}/legal`}
      referral={referral}
    />
  );
  return (
    <JobChrome
      config={config}
      workspace={workspace}
      job={job}
      boardRoot={`/board/${workspaceSlug}`}
      activeTab="application"
      portalEnabled={portalEnabled}
    >
      {form}
    </JobChrome>
  );
}

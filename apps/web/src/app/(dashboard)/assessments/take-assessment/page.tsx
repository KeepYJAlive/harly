import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ManualTaoLaunchScreen } from "@/features/assessments/ManualTaoLaunchScreen";
import { requirePagePermission } from "@/features/workspaces/permissions-server";
import { isManualTaoTestLaunchEnabled } from "@/lib/tao/lti/manual-launch";

export const metadata: Metadata = {
  title: "Preparing assessment",
};

export const dynamic = "force-dynamic";

export default async function TakeAssessmentPage() {
  if (!isManualTaoTestLaunchEnabled()) notFound();
  await requirePagePermission("integrations:manage");

  return <ManualTaoLaunchScreen />;
}

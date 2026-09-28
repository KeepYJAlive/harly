import { AlertTriangle, ClipboardCheck } from "lucide-react";
import { redirect } from "next/navigation";
import type { Route } from "next";

import {
  beginTaoCandidateLaunch,
  CandidateLaunchError,
} from "@/lib/tao/lti/launch";
import { candidateAssessmentErrorMessage } from "@/lib/tao/lti/candidate-error";

export const dynamic = "force-dynamic";

export default async function CandidateAssessmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  try {
    const destination = await beginTaoCandidateLaunch(token);
    redirect(destination as Route);
  } catch (error) {
    // next/navigation implements redirect by throwing a framework-owned value.
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    const code = error instanceof CandidateLaunchError && error.code;
    return <AssessmentUnavailable code={code || undefined} />;
  }
}

function AssessmentUnavailable({
  code,
}: {
  code: "invalid" | "unavailable" | "configuration" | "provider" | undefined;
}) {
  const retryable = code === "configuration" || code === "provider";
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
          {retryable ? (
            <AlertTriangle className="size-6 text-muted-foreground" />
          ) : (
            <ClipboardCheck className="size-6 text-muted-foreground" />
          )}
        </span>
        <h1 className="mt-5 font-display text-xl font-semibold">
          Assessment unavailable
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {candidateAssessmentErrorMessage(code)}
        </p>
      </div>
    </main>
  );
}

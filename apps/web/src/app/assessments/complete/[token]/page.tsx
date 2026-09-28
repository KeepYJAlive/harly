import { CheckCircle2 } from "lucide-react";

import { acknowledgeAssessmentReturn } from "@/lib/tao/lti/launch";

export const dynamic = "force-dynamic";

export default async function AssessmentCompletePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await acknowledgeAssessmentReturn(token);
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-sage text-sage-ink">
          <CheckCircle2 className="size-6" />
        </span>
        <h1 className="mt-5 font-display text-xl font-semibold">
          {result ? "Assessment session ended" : "Assessment link unavailable"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {result
            ? "Your assessment session has ended. You may close this window. Results will be synchronized separately."
            : "This return link is invalid or no longer available. You may close this window."}
        </p>
      </div>
    </main>
  );
}

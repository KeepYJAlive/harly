import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PortalShell } from "@/features/portal/PortalShellServer";

export default function AssessmentUnavailablePage() {
  return (
    <PortalShell>
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Card className="max-w-lg p-8 text-center">
          <h1 className="font-display text-xl font-semibold">
            Assessment unavailable
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This assessment cannot be opened right now. Please return to your
            application and try again, or contact the organization that sent it
            to you.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/portal/applications">Back to applications</Link>
          </Button>
        </Card>
      </div>
    </PortalShell>
  );
}

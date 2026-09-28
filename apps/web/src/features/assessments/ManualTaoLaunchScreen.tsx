"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, Rocket, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const MANUAL_TAO_LAUNCH_API =
  "/api/integrations/tao/lti/test-launch";

const STAGES = [
  "Preparing your secure assessment launch…",
  "Checking the path to TAO…",
  "Opening Production Test…",
] as const;

export function ManualTaoLaunchScreen() {
  const formRef = useRef<HTMLFormElement>(null);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const checkingTimer = window.setTimeout(() => setStage(1), 450);
    const openingTimer = window.setTimeout(() => setStage(2), 900);
    const launchTimer = window.setTimeout(() => {
      formRef.current?.requestSubmit();
    }, 1_350);

    return () => {
      window.clearTimeout(checkingTimer);
      window.clearTimeout(openingTimer);
      window.clearTimeout(launchTimer);
    };
  }, []);

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] items-center justify-center py-10">
      <Card className="relative w-full max-w-xl overflow-hidden border-primary/15 bg-gradient-to-b from-card to-muted/20 px-6 py-10 text-center shadow-lg sm:px-10">
        <div
          aria-hidden="true"
          className="absolute -right-20 -top-24 size-56 rounded-full bg-lime/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-28 -left-20 size-64 rounded-full bg-sage/35 blur-3xl"
        />

        <form
          ref={formRef}
          action={MANUAL_TAO_LAUNCH_API}
          method="get"
          aria-busy="true"
          className="relative flex flex-col items-center"
        >
          <div className="relative flex size-36 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-dashed border-primary/35 motion-safe:animate-spin motion-safe:[animation-duration:8s]" />
            <div className="absolute inset-3 rounded-full border-2 border-transparent border-r-lime border-t-primary motion-safe:animate-spin motion-safe:[animation-duration:2.4s]" />
            <div className="absolute inset-7 rounded-full bg-background shadow-md ring-1 ring-border/70" />
            <ClipboardCheck className="relative size-10 text-primary motion-safe:animate-pulse" />
            <Sparkles className="absolute right-1 top-4 size-5 text-lime-ink motion-safe:animate-bounce" />
            <span className="absolute bottom-1 left-5 size-2.5 rounded-full bg-primary/70 motion-safe:animate-pulse" />
          </div>

          <div className="mt-7 space-y-2">
            <div className="mx-auto flex w-fit items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
              <span className="size-1.5 animate-pulse rounded-full bg-lime-ink" />
              Secure LTI 1.3 launch
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Your assessment is almost ready
            </h1>
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-muted-foreground"
            >
              {STAGES[stage]}
            </p>
          </div>

          <div className="mt-7 h-2 w-full max-w-sm overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary via-lime-ink to-primary transition-all duration-500 ease-out"
              style={{ width: `${((stage + 1) / STAGES.length) * 100}%` }}
            />
          </div>

          <p className="mt-5 max-w-sm text-xs leading-5 text-muted-foreground">
            Keep this page open. Harly is creating a one-time launch and will
            take you to TAO automatically.
          </p>

          <Button type="submit" variant="outline" className="mt-6">
            <Rocket className="size-4" />
            Continue now
          </Button>
        </form>
      </Card>
    </div>
  );
}

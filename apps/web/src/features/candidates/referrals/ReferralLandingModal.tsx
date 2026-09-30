"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { CheckCircle2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { acceptPersonalReferral } from "./personal-actions";

export function ReferralLandingModal({
  referrerName,
  companyName,
  workspaceSlug,
  boardRoot,
  authenticated,
  accepted,
  remaining,
}: {
  referrerName: string;
  companyName: string;
  workspaceSlug: string;
  boardRoot: string;
  authenticated: boolean;
  accepted: boolean;
  remaining: number;
}) {
  const [state, setState] = useState<
    | { kind: "ready" }
    | { kind: "accepted"; referrerName: string }
    | { kind: "error"; message: string }
  >(accepted ? { kind: "accepted", referrerName } : { kind: "ready" });
  const [pending, startTransition] = useTransition();
  const loginHref = `/portal/login?workspace=${encodeURIComponent(workspaceSlug)}&next=${encodeURIComponent("/referral")}`;

  function accept() {
    startTransition(async () => {
      const result = await acceptPersonalReferral();
      if (!result.ok) {
        setState({ kind: "error", message: result.error });
        return;
      }
      setState({ kind: "accepted", referrerName: result.referrerName });
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-8 backdrop-blur-[2px]">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="referral-title"
        className="w-full max-w-lg rounded-3xl border border-white/20 bg-card p-7 shadow-2xl sm:p-9"
      >
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {state.kind === "accepted" ? (
            <CheckCircle2 className="size-6" />
          ) : (
            <Users className="size-6" />
          )}
        </div>
        <h1
          id="referral-title"
          className="text-2xl font-semibold tracking-tight"
        >
          {state.kind === "accepted"
            ? "Referral accepted"
            : "You've been referred!"}
        </h1>

        {state.kind === "accepted" ? (
          <>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Your referral from {state.referrerName} is now connected to your
              profile. You may apply it to up to 3 applications.
            </p>
            <p className="mt-3 rounded-xl bg-muted px-4 py-3 text-sm font-medium">
              {accepted ? remaining : 3} applications remaining
            </p>
            <Button asChild className="mt-6 w-full">
              <Link href={boardRoot as Route}>Browse opportunities</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              <span className="font-medium text-foreground">
                {referrerName}
              </span>{" "}
              thinks you might be a great fit for {companyName} and has referred
              you to our opportunities.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              We take referrals seriously as part of our recruitment process,
              but all candidates are evaluated through the same selection
              process. Your referral can be applied to up to 3 applications.
            </p>
            {state.kind === "error" ? (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {state.message}
              </p>
            ) : null}
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {authenticated ? (
                <Button
                  type="button"
                  onClick={accept}
                  disabled={pending}
                  className="sm:col-span-2"
                >
                  {pending ? "Accepting…" : "Accept referral"}
                </Button>
              ) : (
                <>
                  <Button asChild>
                    <Link href={loginHref as Route}>
                      Sign in to accept referral
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={loginHref as Route}>Create profile</Link>
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

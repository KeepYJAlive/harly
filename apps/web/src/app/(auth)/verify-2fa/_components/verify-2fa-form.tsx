"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { authClient } from "@harly/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SpinnerIcon } from "@/components/ui/icons/phosphor";

async function activateFirstOrganization() {
  const organizationsResult = await authClient.organization.list();

  if (organizationsResult.error) {
    return organizationsResult.error.message ?? "Unable to load organizations.";
  }

  const organizationId = organizationsResult.data?.[0]?.id;
  if (!organizationId) {
    return null;
  }

  const activeResult = await authClient.organization.setActive({
    organizationId,
  });

  if (activeResult.error) {
    return activeResult.error.message ?? "Unable to activate organization.";
  }

  return null;
}

export function Verify2FAForm() {
  const searchParams = useSearchParams();
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const callbackURL = searchParams.get("redirect") || "/dashboard";

  async function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (otp.length !== 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setError(null);
    setIsPending(true);

    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: otp,
      });

      if (result.error) {
        setError(result.error.message ?? "Invalid verification code.");
        return;
      }

      const organizationError = await activateFirstOrganization();
      if (organizationError) {
        setError(organizationError);
        return;
      }

      window.location.href = callbackURL;
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Two-factor authentication</h1>
        <p className="text-sm text-muted-foreground">
          Enter the verification code from your authenticator app to continue.
        </p>
      </div>

      <form onSubmit={handleVerify} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="2fa-code">Verification code</Label>
          <Input
            id="2fa-code"
            value={otp}
            onChange={(event) =>
              setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="000000"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="font-mono tracking-widest"
            autoFocus
          />
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" disabled={otp.length !== 6 || isPending}>
          {isPending && <SpinnerIcon className="mr-1.5 size-3.5" />}
          Verify
        </Button>
      </form>
    </div>
  );
}

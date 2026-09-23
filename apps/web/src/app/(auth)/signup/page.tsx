import Link from "next/link";

import { getAvailableLoginMethods } from "@/features/auth/login-methods.server";
import { getAuthBranding } from "@/features/auth/branding.server";
import { AuthShell, AuthCard } from "../_components/auth-shell";
import { SignupForm } from "./_components/signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const [methods, branding] = await Promise.all([
    getAvailableLoginMethods(),
    getAuthBranding(),
  ]);
  const googleEnabled = methods.social.includes("google");

  return (
    <AuthShell
      branding={branding}
      rightSlot={
        <Link
          href="/login"
          className="font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Sign in
        </Link>
      }
    >
      <AuthCard
        title="Create your account"
        subtitle="Set up your ATS in minutes. No credit card required."
        footer={
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-foreground hover:underline">
              Sign in
            </Link>
          </>
        }
      >
        <SignupForm googleEnabled={googleEnabled} />
      </AuthCard>
    </AuthShell>
  );
}

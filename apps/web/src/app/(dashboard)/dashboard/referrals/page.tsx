import { listPersonalReferrals } from "@/features/candidates/referrals/personal-data";
import { PersonalReferralsView } from "@/features/candidates/referrals/PersonalReferralsView";

export const dynamic = "force-dynamic";

export default async function ReferralsPage() {
  const referrals = await listPersonalReferrals();
  return (
    <PersonalReferralsView
      referrals={referrals.map((referral) => ({
        ...referral,
        createdAt: referral.createdAt.toISOString(),
        expiresAt: referral.expiresAt?.toISOString() ?? null,
        acceptedAt: referral.acceptedAt?.toISOString() ?? null,
        revokedAt: referral.revokedAt?.toISOString() ?? null,
      }))}
    />
  );
}

import { Button, Section, Text } from "@react-email/components";

import { EmailFallbackLink } from "./EmailFallbackLink";
import type { SocialLink } from "./HarlyLayout";
import { WorkspaceLayout } from "./WorkspaceLayout";

export type PersonalReferralInvitationProps = {
  referredFirstName: string;
  referrerName: string;
  companyName: string;
  referralUrl: string;
  companyLogoUrl?: string;
  accentColor?: string;
  socialLinks?: SocialLink[];
  hideBranding?: boolean;
};

export function personalReferralInvitationSubject({
  companyName,
}: Pick<PersonalReferralInvitationProps, "companyName">) {
  return `You've been referred to ${companyName}`;
}

export function PersonalReferralInvitation({
  referredFirstName,
  referrerName,
  companyName,
  referralUrl,
  companyLogoUrl,
  accentColor,
  socialLinks,
  hideBranding,
}: PersonalReferralInvitationProps) {
  return (
    <WorkspaceLayout
      preview={`${referrerName} referred you to opportunities at ${companyName}.`}
      companyName={companyName}
      companyLogoUrl={companyLogoUrl}
      accentColor={accentColor}
      socialLinks={socialLinks}
      hideBranding={hideBranding}
    >
      <Text className="text-[36px] leading-[1.08] tracking-[-1px] font-inter text-fg m-0 mb-3.5 font-medium">
        You&apos;ve been referred!
      </Text>
      <Text className="text-[14px] leading-[1.5] font-inter text-fg-2 m-0 mb-4">
        Hi {referredFirstName},
      </Text>
      <Text className="text-[14px] leading-[1.5] font-inter text-fg-2 m-0 mb-4">
        <span className="text-fg font-semibold">{referrerName}</span> thinks you
        might be a great fit for {companyName} and has referred you to our
        opportunities.
      </Text>
      <Section className="border border-solid border-border bg-card px-4 py-3 mb-4">
        <Text className="text-[14px] leading-[1.5] font-inter text-fg-2 m-0">
          We take referrals seriously as part of our recruitment process, but
          all candidates are evaluated through the same selection process. Your
          referral can be applied to up to 3 applications.
        </Text>
      </Section>
      <Section className="mt-2 mb-4">
        <Button
          href={referralUrl}
          className="bg-brand text-[14px] leading-[1.5] font-inter text-fg-inverted inline-block border-none px-4 py-2.5 text-center box-border no-underline"
        >
          View opportunities
        </Button>
        <EmailFallbackLink url={referralUrl} />
      </Section>
      <Text className="text-[13px] leading-[1.5] font-inter text-fg-3 m-0">
        Sign in with the email address that received this invitation before
        accepting it. The link itself does not sign you in.
      </Text>
    </WorkspaceLayout>
  );
}

PersonalReferralInvitation.PreviewProps = {
  referredFirstName: "Alex",
  referrerName: "James Doe",
  companyName: "#KeepYJAlive",
  referralUrl: "https://opportunities.example/referral/example-token",
} satisfies PersonalReferralInvitationProps;

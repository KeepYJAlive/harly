import { Button, Section, Text } from "@react-email/components";

import { EmailFallbackLink } from "./EmailFallbackLink";
import type { SocialLink } from "./HarlyLayout";
import { WorkspaceLayout } from "./WorkspaceLayout";

export type AssessmentInvitationProps = {
  candidateName: string;
  jobTitle: string;
  assessmentName: string;
  companyName: string;
  assessmentUrl: string;
  dueDate?: string;
  estimatedDuration?: string;
  companyLogoUrl?: string;
  accentColor?: string;
  socialLinks?: SocialLink[];
  hideBranding?: boolean;
};

export function assessmentInvitationSubject({
  companyName,
}: Pick<AssessmentInvitationProps, "companyName">) {
  return "Action required: Complete your " + companyName + " assessment";
}

export function AssessmentInvitation({
  candidateName,
  jobTitle,
  assessmentName,
  companyName,
  assessmentUrl,
  dueDate,
  estimatedDuration,
  companyLogoUrl,
  accentColor,
  socialLinks,
  hideBranding,
}: AssessmentInvitationProps) {
  return (
    <WorkspaceLayout
      preview={
        "Complete your " + assessmentName + " assessment for " + jobTitle + "."
      }
      companyName={companyName}
      companyLogoUrl={companyLogoUrl}
      accentColor={accentColor}
      socialLinks={socialLinks}
      hideBranding={hideBranding}
    >
      <Text className="text-[36px] leading-[1.08] tracking-[-1px] font-inter text-fg m-0 mb-3.5 font-medium">
        Your assessment is ready
      </Text>
      <Text className="text-[14px] leading-[1.5] font-inter text-fg-2 m-0 mb-4">
        Hi {candidateName},
      </Text>
      <Text className="text-[14px] leading-[1.5] font-inter text-fg-2 m-0 mb-4">
        Thank you for your continued interest in the{" "}
        <span className="text-fg font-semibold">{jobTitle}</span> opportunity
        with {companyName}. As the next step, we&apos;ve invited you to complete
        an online assessment.
      </Text>
      <Section className="border border-solid border-border bg-card px-4 py-3 mb-4">
        <Text className="text-[12px] uppercase tracking-[0.08em] text-fg-3 m-0 mb-1">
          Assessment
        </Text>
        <Text className="text-[15px] font-semibold text-fg m-0">
          {assessmentName}
        </Text>
        {estimatedDuration ? (
          <Text className="text-[13px] text-fg-2 m-0 mt-2">
            Estimated time: {estimatedDuration}
          </Text>
        ) : null}
        <Text className="text-[13px] text-fg-2 m-0 mt-1">
          {dueDate ? "Due: " + dueDate : "No deadline"}
        </Text>
      </Section>
      <Text className="text-[14px] leading-[1.5] font-inter text-fg-2 m-0 mb-4">
        This assessment helps our team understand skills relevant to the
        opportunity. Your link is unique to your application; please do not
        forward or share it.
      </Text>
      <Section className="mt-2 mb-4">
        <Button
          href={assessmentUrl}
          className="bg-brand text-[14px] leading-[1.5] font-inter text-fg-inverted inline-block border-none px-4 py-2.5 text-center box-border no-underline"
        >
          Start assessment
        </Button>
        <EmailFallbackLink url={assessmentUrl} />
      </Section>
      <Text className="text-[13px] leading-[1.5] font-inter text-fg-3 m-0">
        If you need assistance or believe you may need an accommodation, contact
        the recruitment team that invited you.
      </Text>
    </WorkspaceLayout>
  );
}

AssessmentInvitation.PreviewProps = {
  candidateName: "Ava",
  jobTitle: "Digital Artist Volunteer",
  assessmentName: "Digital Artist Assessment",
  companyName: "#KeepYJAlive",
  assessmentUrl: "https://opportunities.example/assessment/example-token",
  dueDate: "October 5, 2026",
} satisfies AssessmentInvitationProps;

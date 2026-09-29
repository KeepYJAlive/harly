export const LTI_CLAIM = {
  version: "https://purl.imsglobal.org/spec/lti/claim/version",
  messageType: "https://purl.imsglobal.org/spec/lti/claim/message_type",
  deploymentId: "https://purl.imsglobal.org/spec/lti/claim/deployment_id",
  targetLinkUri: "https://purl.imsglobal.org/spec/lti/claim/target_link_uri",
  resourceLink: "https://purl.imsglobal.org/spec/lti/claim/resource_link",
  roles: "https://purl.imsglobal.org/spec/lti/claim/roles",
  context: "https://purl.imsglobal.org/spec/lti/claim/context",
  launchPresentation:
    "https://purl.imsglobal.org/spec/lti/claim/launch_presentation",
  agsEndpoint: "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint",
} as const;

export const LTI_VERSION = "1.3.0";
export const LTI_MESSAGE_TYPE = "LtiResourceLinkRequest";
export const LTI_LEARNER_ROLE =
  "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";
export const LTI_AGS_SCORE_SCOPE =
  "https://purl.imsglobal.org/spec/lti-ags/scope/score";

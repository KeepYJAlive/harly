import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/workspaces/lti-settings-actions", () => ({
  disconnectTaoAction: vi.fn(),
  saveTaoSettingsAction: vi.fn(),
  testTaoConnectionAction: vi.fn(),
}));
vi.mock("@/features/assessments/definition-actions", () => ({
  saveTaoAssessmentDefinitionAction: vi.fn(),
  setTaoAssessmentActiveAction: vi.fn(),
}));
vi.mock("@/lib/notification-island/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { TaoConnectPanel } from "./TaoConnectPanel";

describe("TaoConnectPanel", () => {
  it("renders connection, configurable LTI fields, platform availability, and passback details", () => {
    const markup = renderToStaticMarkup(
      createElement(TaoConnectPanel, {
        canEdit: true,
        tileClassName: "bg-violet-600 text-white",
        description: "Connect TAO over LTI 1.3.",
        manualTestLaunchEnabled: true,
        assessments: [],
        status: {
          enabled: true,
          configured: true,
          connectionState: "configured",
          instanceUrl: "https://tao.example.com",
          clientId: "harly-tao-client-1",
          deploymentId: "deployment-1",
          lastConnectionError: null,
          lastTestedAt: null,
          encryptionReady: true,
          platformIssuer: "https://harly.example.com",
          platformAuthorizationUrl:
            "https://harly.example.com/api/integrations/tao/lti/authorize",
          platformTokenUrl:
            "https://harly.example.com/api/integrations/tao/lti/token",
          platformJwksUrl:
            "https://harly.example.com/api/integrations/tao/lti/jwks",
          platformAgsLineItemPattern:
            "https://harly.example.com/api/integrations/tao/lti/ags/lineitems/{assignmentId}",
          taoOidcInitiationUrl:
            "https://tao.example.com/auth-server/lti1p3/oidc/initiation",
          taoJwksUrl:
            "https://tao.example.com/auth-server/.well-known/jwks.json",
          taoToolAudience: "https://tao.example.com/deliver",
          taoDeliveryTargetLinkPattern:
            "https://tao.example.com/deliver/api/v1/auth/launch-lti-1p3/{deliveryId}",
        },
      }),
    );

    expect(markup).toContain("Configured");
    expect(markup).toContain("TAO base URL");
    expect(markup).toContain("TAO Tool configuration");
    expect(markup).toContain("Client ID");
    expect(markup).toContain("OIDC initiation URL");
    expect(markup).toContain("Tool audience");
    expect(markup).toContain("Delivery target-link pattern");
    expect(markup).not.toContain("TAO OAuth/token URL");
    expect(markup).not.toContain("Provided by TAO");
    expect(markup).not.toContain("TAO LTI launch/target URL");
    expect(markup).not.toContain("TAO Client Secret");
    expect(markup).toContain("https://harly.example.com");
    expect(markup).toContain("OAuth Access Token URL");
    expect(markup).toContain("Deployment ID");
    expect(markup).toContain("AGS line-item URL pattern");
    expect(markup).toContain("LTI 1.3 Assignment and Grade Services (AGS)");
    expect(markup).toContain("Stable opaque Harly application subject");
    expect(markup).toContain("Manual LTI test");
    expect(markup).toContain("Launch Production Test");
    expect(markup).toContain('href="/assessments/take-assessment"');
    expect(markup).toContain(
      "https://tao.example.com/deliver/api/v1/auth/launch-lti-1p3/{deliveryId}",
    );
    expect(markup).not.toContain("Map friendly Harly names to deliveries");
    expect(markup).not.toContain("Coming soon");
  });

  it("disables the manual launch button when the server-side gate is off", () => {
    const markup = renderToStaticMarkup(
      createElement(TaoConnectPanel, {
        canEdit: true,
        tileClassName: "bg-violet-600 text-white",
        description: "Connect TAO over LTI 1.3.",
        manualTestLaunchEnabled: false,
        assessments: [],
        status: {
          enabled: true,
          configured: true,
          connectionState: "configured",
          instanceUrl: "https://assessment.keepyjalive.org",
          clientId: "harly-tao-client-1",
          deploymentId: "deployment-1",
          lastConnectionError: null,
          lastTestedAt: null,
          encryptionReady: true,
          platformIssuer: "https://opportunities.keepyjalive.org",
          platformAuthorizationUrl:
            "https://opportunities.keepyjalive.org/api/integrations/tao/lti/authorize",
          platformTokenUrl:
            "https://opportunities.keepyjalive.org/api/integrations/tao/lti/token",
          platformJwksUrl:
            "https://opportunities.keepyjalive.org/api/integrations/tao/lti/jwks",
          platformAgsLineItemPattern:
            "https://opportunities.keepyjalive.org/api/integrations/tao/lti/ags/lineitems/{assignmentId}",
          taoOidcInitiationUrl:
            "https://assessment.keepyjalive.org/auth-server/lti1p3/oidc/initiation",
          taoJwksUrl:
            "https://assessment.keepyjalive.org/auth-server/.well-known/jwks.json",
          taoToolAudience: "https://assessment.keepyjalive.org/deliver",
          taoDeliveryTargetLinkPattern:
            "https://assessment.keepyjalive.org/deliver/api/v1/auth/launch-lti-1p3/{deliveryId}",
        },
      }),
    );

    expect(markup).toContain("Launch Production Test");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain('href="/assessments/take-assessment"');
    expect(markup).toContain("HARLY_TAO_MANUAL_TEST_LAUNCH=true");
  });
});

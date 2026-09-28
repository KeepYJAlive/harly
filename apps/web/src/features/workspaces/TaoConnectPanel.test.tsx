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
        assessments: [],
        tileClassName: "bg-violet-600 text-white",
        description: "Connect TAO over LTI 1.3.",
        status: {
          enabled: true,
          configured: true,
          connectionState: "configured",
          instanceUrl: "https://tao.example.com",
          clientId: "client-1",
          hasClientSecret: true,
          deploymentId: "deployment-1",
          oidcAuthUrl: "https://tao.example.com/custom/authorize",
          oauthTokenUrl: "https://tao.example.com/custom/token",
          jwksUrl: "https://tao.example.com/custom/jwks",
          launchUrl: "https://tao.example.com/custom/launch",
          lastConnectionError: null,
          lastTestedAt: null,
          encryptionReady: true,
          platformIssuer: "https://harly.example.com",
          platformAuthorizationUrl:
            "https://harly.example.com/api/integrations/tao/lti/authorize",
          platformJwksUrl:
            "https://harly.example.com/api/integrations/tao/lti/jwks",
        },
      }),
    );

    expect(markup).toContain("Configured");
    expect(markup).toContain("TAO instance URL");
    expect(markup).toContain("TAO OIDC authentication URL");
    expect(markup).toContain("TAO OAuth/token URL");
    expect(markup).toContain("TAO JWKS URL");
    expect(markup).toContain("TAO LTI launch/target URL");
    expect(markup).toContain("https://harly.example.com");
    expect(markup).toContain("Not yet available");
    expect(markup).toContain("LTI 1.3 Assignment and Grade Services (AGS)");
    expect(markup).toContain("Harly application ID");
    expect(markup).not.toContain("Coming soon");
  });
});

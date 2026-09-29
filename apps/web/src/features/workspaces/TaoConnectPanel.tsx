"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Loader2,
  PlugZap,
  Rocket,
  Unplug,
} from "lucide-react";
import { useRouter } from "next/navigation";

import {
  disconnectTaoAction,
  saveTaoSettingsAction,
  testTaoConnectionAction,
} from "@/features/workspaces/lti-settings-actions";
import { IntegrationHeader } from "@/features/workspaces/IntegrationDetailShell";
import type { TaoConnectionState, WorkspaceTaoStatus } from "@/lib/lti/config";
import { toast } from "@/lib/notification-island/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TaoAssessmentsSection } from "@/features/assessments/TaoAssessmentsSection";
import type { TaoAssessmentDefinitionItem } from "@/features/assessments/types";

function TaoLogo({ className }: { className?: string }) {
  return <ClipboardCheck className={className} />;
}

const CONNECTION_LABEL: Record<TaoConnectionState, string> = {
  not_configured: "Not configured",
  configured: "Configured",
  connected: "Connected",
  error: "Connection error",
};

const CONNECTION_TONE = {
  not_configured: "neutral",
  configured: "neutral",
  connected: "on",
  error: "warn",
} as const;

type LocalTestState = {
  state: "connected" | "error";
  message: string;
} | null;

export function TaoConnectPanel({
  status,
  canEdit,
  tileClassName,
  description,
  manualTestLaunchEnabled,
  assessments,
}: {
  status: WorkspaceTaoStatus;
  canEdit: boolean;
  tileClassName: string;
  description: string;
  manualTestLaunchEnabled: boolean;
  assessments: TaoAssessmentDefinitionItem[];
}) {
  const router = useRouter();
  const [instanceUrl, setInstanceUrl] = useState(status.instanceUrl ?? "");
  const [testState, setTestState] = useState<LocalTestState>(null);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();

  const displayedState = testState?.state ?? status.connectionState;
  const manualTestLaunchReady =
    manualTestLaunchEnabled &&
    canEdit &&
    status.configured &&
    Boolean(status.clientId && status.deploymentId);

  function save() {
    startSave(async () => {
      const result = await saveTaoSettingsAction({
        instanceUrl,
      });
      if (!result.ok) {
        toast.error(result.error ?? "Could not save TAO settings.");
        return;
      }
      setTestState(null);
      toast.success("TAO settings saved");
      router.refresh();
    });
  }

  function testConnection() {
    startTest(async () => {
      setTestState(null);
      const result = await testTaoConnectionAction({ instanceUrl });
      if (!result.ok) {
        const message = result.error ?? "Could not reach TAO.";
        setTestState({ state: "error", message });
        toast.error(message);
        return;
      }
      setTestState({
        state: "connected",
        message: "TAO responded successfully.",
      });
      toast.success("TAO is reachable");
      router.refresh();
    });
  }

  function disconnect() {
    startDisconnect(async () => {
      const result = await disconnectTaoAction();
      if (!result.ok) {
        toast.error(result.error ?? "Could not disconnect TAO.");
        return;
      }
      toast.success("TAO disconnected");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <IntegrationHeader
        logo={TaoLogo}
        logoClassName="size-8"
        tileClassName={tileClassName}
        name="TAO assessments"
        description={description}
        statusLabel={CONNECTION_LABEL[displayedState]}
        statusTone={CONNECTION_TONE[displayedState]}
      />

      <Card className="space-y-6 p-6">
        <SectionIntro
          title="Connection"
          description="Configure the root URL of the TAO instance Harly should contact. Saving records the configuration; testing it separately verifies reachability."
        />

        <Field
          id="tao-instance-url"
          label="TAO base URL"
          value={instanceUrl}
          onChange={(value) => {
            setInstanceUrl(value);
            setTestState(null);
          }}
          placeholder="https://tao.example.com"
          required
          disabled={!canEdit}
        />

        {testState || status.lastConnectionError ? (
          <div
            className={
              displayedState === "connected"
                ? "flex items-start gap-2 rounded-lg bg-sage px-3 py-2.5 text-sm text-sage-ink"
                : "flex items-start gap-2 rounded-lg bg-clay/10 px-3 py-2.5 text-sm text-clay"
            }
          >
            {displayedState === "connected" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            )}
            <span>
              {testState?.message ??
                status.lastConnectionError ??
                "TAO is reachable."}
            </span>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t pt-5">
          {status.configured ? (
            <Button
              type="button"
              variant="outline"
              onClick={disconnect}
              disabled={!canEdit || disconnecting}
            >
              {disconnecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unplug className="size-4" />
              )}
              Disconnect
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={testConnection}
            disabled={!canEdit || testing || !instanceUrl.trim()}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlugZap className="size-4" />
            )}
            Test connection
          </Button>
          <Button type="button" onClick={save} disabled={!canEdit || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </Card>

      <Card className="space-y-6 p-6">
        <SectionIntro
          title="TAO Tool configuration"
          description="TAO is the LTI 1.3 Tool. Its verified endpoints are derived from this base URL."
        />
        <div className="divide-y rounded-xl border">
          <PlatformValue label="TAO base URL" value={status.instanceUrl} />
          <PlatformValue
            label="OIDC initiation URL"
            value={status.taoOidcInitiationUrl}
          />
          <PlatformValue label="TAO JWKS URL" value={status.taoJwksUrl} />
          <PlatformValue label="Tool audience" value={status.taoToolAudience} />
          <div className="flex flex-col gap-2 px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">
              Delivery target-link pattern
            </p>
            <p className="break-all font-mono text-xs">
              {status.taoDeliveryTargetLinkPattern ?? "Not available"}
            </p>
            <p className="text-xs text-muted-foreground">
              Informational only. A delivery ID is assessment-specific.
            </p>
          </div>
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <SectionIntro
          title="Harly platform configuration"
          description="Values from Harly that will be entered into TAO during platform registration."
        />
        <div className="divide-y rounded-xl border">
          <PlatformValue label="Issuer" value={status.platformIssuer} />
          <PlatformValue label="Client ID" value={status.clientId} />
          <PlatformValue label="Deployment ID" value={status.deploymentId} />
          <PlatformValue
            label="OIDC Authentication URL"
            value={status.platformAuthorizationUrl}
          />
          <PlatformValue
            label="OAuth Access Token URL"
            value={status.platformTokenUrl}
          />
          <PlatformValue label="JWKS URL" value={status.platformJwksUrl} />
          <PlatformValue
            label="AGS line-item URL pattern"
            value={status.platformAgsLineItemPattern}
          />
        </div>
      </Card>

      <Card className="space-y-4 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <SectionIntro
            title="Manual LTI test"
            description="Launch the registered TAO delivery “Production Test” to verify the OIDC and LTI Resource Link flow. This test does not store a result."
          />
          {manualTestLaunchReady ? (
            <Button asChild className="self-start sm:self-auto">
              <a href="/assessments/take-assessment">
                <Rocket className="size-4" />
                Launch Production Test
              </a>
            </Button>
          ) : (
            <Button type="button" disabled className="self-start sm:self-auto">
              <Rocket className="size-4" />
              Launch Production Test
            </Button>
          )}
        </div>
        {!manualTestLaunchEnabled ? (
          <p className="text-xs text-muted-foreground">
            Manual test launch is disabled. Set{" "}
            <code>HARLY_TAO_MANUAL_TEST_LAUNCH=true</code> to enable it in a
            production build.
          </p>
        ) : !canEdit ? (
          <p className="text-xs text-muted-foreground">
            Owner or administrator access is required to run this test.
          </p>
        ) : !status.configured || !status.clientId || !status.deploymentId ? (
          <p className="text-xs text-muted-foreground">
            Save a complete TAO platform configuration before running this test.
          </p>
        ) : null}
      </Card>

      <Card className="space-y-5 p-6">
        <TaoAssessmentsSection assessments={assessments} canEdit={canEdit} />
      </Card>

      <Card className="space-y-5 p-6">
        <SectionIntro
          title="Result passback"
          description="TAO can publish standards-based score and progress updates to each Harly assessment assignment."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <InfoValue
            label="Result transport"
            value="LTI 1.3 Assignment and Grade Services (AGS)"
          />
          <InfoValue
            label="Candidate identity"
            value="Stable opaque Harly application subject"
          />
        </div>
      </Card>
    </div>
  );
}

function SectionIntro({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="font-display text-base font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  required = false,
  disabled = false,
  type = "url",
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
  type?: "url" | "text" | "password";
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete="off"
        className="font-mono text-xs"
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function PlatformValue({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate font-mono text-xs">
          {value ?? "Generated or derived after saving TAO settings"}
        </p>
      </div>
      {value ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start sm:self-auto"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success(`${label} copied`);
          }}
        >
          <Copy className="size-3.5" />
          Copy
        </Button>
      ) : null}
    </div>
  );
}

function InfoValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

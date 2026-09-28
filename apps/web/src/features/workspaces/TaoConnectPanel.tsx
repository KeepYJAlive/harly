"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Loader2,
  PlugZap,
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
  assessments,
  canEdit,
  tileClassName,
  description,
}: {
  status: WorkspaceTaoStatus;
  assessments: TaoAssessmentDefinitionItem[];
  canEdit: boolean;
  tileClassName: string;
  description: string;
}) {
  const router = useRouter();
  const [instanceUrl, setInstanceUrl] = useState(status.instanceUrl ?? "");
  const [clientId, setClientId] = useState(status.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [deploymentId, setDeploymentId] = useState(status.deploymentId ?? "");
  const [oidcAuthUrl, setOidcAuthUrl] = useState(status.oidcAuthUrl ?? "");
  const [oauthTokenUrl, setOauthTokenUrl] = useState(
    status.oauthTokenUrl ?? "",
  );
  const [jwksUrl, setJwksUrl] = useState(status.jwksUrl ?? "");
  const [launchUrl, setLaunchUrl] = useState(status.launchUrl ?? "");
  const [testState, setTestState] = useState<LocalTestState>(null);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();

  const displayedState = testState?.state ?? status.connectionState;

  function save() {
    startSave(async () => {
      const result = await saveTaoSettingsAction({
        instanceUrl,
        clientId,
        clientSecret,
        deploymentId,
        oidcAuthUrl,
        oauthTokenUrl,
        jwksUrl,
        launchUrl,
      });
      if (!result.ok) {
        toast.error(result.error ?? "Could not save TAO settings.");
        return;
      }
      setClientSecret("");
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
          label="TAO instance URL"
          value={instanceUrl}
          onChange={(value) => {
            setInstanceUrl(value);
            setTestState(null);
          }}
          placeholder="https://tao.example.com"
          required
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
          title="LTI 1.3 configuration"
          description="Enter the exact registration values exposed by your TAO deployment. Endpoint paths are intentionally not inferred."
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="tao-client-id"
            label="Client ID"
            value={clientId}
            onChange={setClientId}
            placeholder="Provided by TAO"
          />
          <Field
            id="tao-deployment-id"
            label="Deployment ID"
            value={deploymentId}
            onChange={setDeploymentId}
            placeholder="Deployment identifier"
          />
          <Field
            id="tao-client-secret"
            label="Client secret (optional)"
            value={clientSecret}
            onChange={setClientSecret}
            placeholder={
              status.hasClientSecret
                ? "Stored securely — leave blank to keep it"
                : "Only if supplied by TAO"
            }
            type="password"
            hint="Encrypted before storage and never returned to this page."
          />
          <div className="hidden sm:block" />
          <Field
            id="tao-oidc-auth-url"
            label="TAO OIDC authentication URL"
            value={oidcAuthUrl}
            onChange={setOidcAuthUrl}
            placeholder="https://tao.example.com/…"
          />
          <Field
            id="tao-oauth-token-url"
            label="TAO OAuth/token URL"
            value={oauthTokenUrl}
            onChange={setOauthTokenUrl}
            placeholder="https://tao.example.com/…"
          />
          <Field
            id="tao-jwks-url"
            label="TAO JWKS URL"
            value={jwksUrl}
            onChange={setJwksUrl}
            placeholder="https://tao.example.com/…"
          />
          <Field
            id="tao-launch-url"
            label="TAO LTI launch/target URL"
            value={launchUrl}
            onChange={setLaunchUrl}
            placeholder="https://tao.example.com/…"
          />
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <SectionIntro
          title="Harly platform configuration"
          description="Values from Harly that will be entered into TAO during platform registration."
        />
        <div className="divide-y rounded-xl border">
          <PlatformValue label="Harly issuer" value={status.platformIssuer} />
          <PlatformValue
            label="Harly OIDC authentication URL"
            value={status.platformAuthorizationUrl}
          />
          <PlatformValue
            label="Harly JWKS URL"
            value={status.platformJwksUrl}
          />
          <UnavailableValue
            label="AGS endpoints"
            detail="Available in a later phase"
          />
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <TaoAssessmentsSection assessments={assessments} canEdit={canEdit} />
      </Card>

      <Card className="space-y-5 p-6">
        <SectionIntro
          title="Result passback"
          description="Assessment assignment and result records are intentionally deferred to the next phase."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <InfoValue
            label="Result transport"
            value="LTI 1.3 Assignment and Grade Services (AGS)"
          />
          <InfoValue label="Candidate identity" value="Harly application ID" />
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
  type = "url",
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
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
        disabled={false}
        autoComplete="off"
        className="font-mono text-xs"
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function PlatformValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate font-mono text-xs">{value}</p>
      </div>
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
    </div>
  );
}

function UnavailableValue({
  label,
  detail,
}: {
  label: string;
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">
        Not yet available{detail ? ` · ${detail}` : ""}
      </p>
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

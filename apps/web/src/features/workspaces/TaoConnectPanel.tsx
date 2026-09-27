"use client";

import { useState, useTransition } from "react";
import { ClipboardCheck, Copy, KeyRound, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  disconnectLtiAction,
  saveLtiSettingsAction,
} from "@/features/workspaces/lti-settings-actions";
import {
  IntegrationHeader,
  InlineReveal,
} from "@/features/workspaces/IntegrationDetailShell";
import { StatCell } from "@/features/workspaces/settings-ui";
import type { WorkspaceLtiStatus } from "@/lib/lti/config";
import { toast } from "@/lib/notification-island/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

function TaoLogo({ className }: { className?: string }) {
  return <ClipboardCheck className={className} />;
}

export function TaoConnectPanel({
  status,
  canEdit,
  tileClassName,
  description,
}: {
  status: WorkspaceLtiStatus;
  canEdit: boolean;
  tileClassName: string;
  description: string;
}) {
  const router = useRouter();
  const configured = Boolean(status.registrationId);
  const [open, setOpen] = useState(!configured);
  const [togglePending, startToggle] = useTransition();

  function toggleEnabled(enabled: boolean) {
    if (!status.clientId || !status.oidcInitiationUrl || !status.jwksUrl) return;
    startToggle(async () => {
      const result = await saveLtiSettingsAction({
        enabled,
        clientId: status.clientId!,
        toolAudience: status.toolAudience ?? undefined,
        oidcInitiationUrl: status.oidcInitiationUrl!,
        jwksUrl: status.jwksUrl!,
      });

      if (!result.ok) {
        toast.error(result.error ?? "Could not update TAO.");
        return;
      }
     
      toast.success(enabled ? "TAO enabled" : "TAO disabled");
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
        statusLabel={configured ? (status.enabled ? "Connected" : "Disabled") : "Not connected"}
        statusTone={configured ? (status.enabled ? "on" : "off") : "neutral"}
        action={
          canEdit ? (
            <>
              <Button
                variant={configured ? "outline" : "default"}
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
              >
                {configured ? <Settings2 className="size-4" /> : <KeyRound className="size-4" />}
                {configured ? (open ? "Hide settings" : "Manage") : "Connect"}
              </Button>
              {configured ? (
                <label className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                  <Switch
                    checked={status.enabled}
                    disabled={togglePending}
                    onCheckedChange={toggleEnabled}
                    aria-label="Enable TAO assessments"
                  />
                  <span className="text-muted-foreground">{status.enabled ? "On" : "Off"}</span>
                </label>
              ) : null}
            </>
          ) : null
        }
      />

      {configured ? (
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <StatCell label="Protocol">LTI 1.3</StatCell>
            <StatCell label="Score return">AGS 2.0</StatCell>
            <StatCell label="Deployment">
              <span className="truncate font-mono text-xs">{status.deploymentId}</span>
            </StatCell>
          </div>
        </Card>
      ) : null}

      {!status.encryptionReady ? (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
          Set <code className="font-mono text-xs">AI_ENCRYPTION_KEY</code> before connecting TAO.
          Harly uses it to encrypt the platform signing key at rest.
        </Card>
      ) : null}

      {canEdit ? (
        <InlineReveal open={open}>
          <TaoSettingsForm status={status} />
        </InlineReveal>
      ) : null}
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success(`${label} copied`);
          }}
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function TaoSettingsForm({ status }: { status: WorkspaceLtiStatus }) {
  const router = useRouter();
  const [clientId, setClientId] = useState(status.clientId ?? "");
  const [toolAudience, setToolAudience] = useState(status.toolAudience ?? "");
  const [oidcInitiationUrl, setOidcInitiationUrl] = useState(
    status.oidcInitiationUrl ?? "",
  );
  const [jwksUrl, setJwksUrl] = useState(status.jwksUrl ?? "");
  const [saving, startSave] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();

  function save() {
    startSave(async () => {
      const result = await saveLtiSettingsAction({
        enabled: true,
        clientId,
        toolAudience: toolAudience || undefined,
        oidcInitiationUrl,
        jwksUrl,
      });

      if (!result.ok) {
        toast.error(result.error ?? "Could not save TAO settings.");
        return;
      }

      toast.success("TAO connection saved");
      router.refresh();
    });
  }

  function disconnect() {
    startDisconnect(async () => {
      const result = await disconnectLtiAction();
      if (!result.ok)
      {
        toast.error(result.error ?? "Could not disable TAO.");
        return;
      } 
      toast.success("TAO disabled");
      router.refresh();
    });
  }

  return (
    <Card className="space-y-7 p-6">
      <div>
        <h2 className="font-display text-base font-semibold tracking-tight">
          {status.registrationId ? "Manage TAO registration" : "Connect TAO"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the values supplied by your TAO administrator. Harly generates the
          platform deployment and signing key on the first save.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="tao-client-id">TAO client ID</Label>
          <Input
            id="tao-client-id"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            autoComplete="off"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tao-audience">TAO audience / issuer</Label>
          <Input
            id="tao-audience"
            value={toolAudience}
            onChange={(event) => setToolAudience(event.target.value)}
            placeholder="Provided by TAO"
            autoComplete="off"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="tao-oidc">TAO OIDC initiation URL</Label>
          <Input
            id="tao-oidc"
            type="url"
            value={oidcInitiationUrl}
            onChange={(event) => setOidcInitiationUrl(event.target.value)}
            placeholder="https://tao.example.com/…/oidc"
            autoComplete="off"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="tao-jwks">TAO JWKS URL</Label>
          <Input
            id="tao-jwks"
            type="url"
            value={jwksUrl}
            onChange={(event) => setJwksUrl(event.target.value)}
            placeholder="https://tao.example.com/…/jwks"
            autoComplete="off"
            className="font-mono text-xs"
          />
        </div>
      </div>

      <div className="border-t pt-6">
        <h3 className="text-sm font-semibold">Provide these values to TAO</h3>
        <div className="mt-4 grid gap-4">
          <CopyField label="Audience / platform issuer" value={status.platformIssuer} />
          <CopyField label="OIDC authentication URL" value={status.authenticationUrl} />
          <CopyField label="OAuth access token URL" value={status.accessTokenUrl} />
          <CopyField label="Platform JWKS URL" value={status.platformJwksUrl} />
          <CopyField label="Deployment ID" value={status.deploymentId} />
        </div>
        {!status.registrationId ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Save once to generate the JWKS URL and deployment ID.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t pt-5">
        {status.registrationId ? (
          <Button variant="outline" onClick={disconnect} disabled={disconnecting}>
            Disable
          </Button>
        ) : null}
        <Button onClick={save} disabled={saving || !status.encryptionReady}>
          {saving ? "Saving…" : "Save connection"}
        </Button>
      </div>
    </Card>
  );
}

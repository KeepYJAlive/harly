import "server-only";

import { eq } from "drizzle-orm";

import { db, ltiRegistrations } from "@harly/db";

import { decryptSecret, isEncryptionConfigured } from "@/lib/crypto";
import { getHarlyPublicOrigin } from "@/lib/public-origin";

export type WorkspaceLtiStatus = {
  registrationId: string | null;
  enabled: boolean;
  clientId: string | null;
  deploymentId: string | null;
  toolAudience: string | null;
  oidcInitiationUrl: string | null;
  jwksUrl: string | null;
  encryptionReady: boolean;
  platformIssuer: string;
  authenticationUrl: string;
  accessTokenUrl: string;
  platformJwksUrl: string | null;
};

export type LtiRegistrationConfig = {
  id: string;
  workspaceId: string;
  enabled: boolean;
  clientId: string;
  deploymentId: string;
  toolAudience: string | null;
  oidcInitiationUrl: string;
  jwksUrl: string;
  keyId: string;
  publicJwk: Record<string, unknown>;
  privateKeyPem: string;
};

function platformUrls(registrationId?: string | null) {
  const platformIssuer = getHarlyPublicOrigin();
  return {
    platformIssuer,
    authenticationUrl: `${platformIssuer}/api/lti/authorize`,
    accessTokenUrl: `${platformIssuer}/api/lti/token`,
    platformJwksUrl: registrationId
      ? `${platformIssuer}/api/lti/jwks/${registrationId}`
      : null,
  };
}

export async function getWorkspaceLtiStatus(
  workspaceId: string,
): Promise<WorkspaceLtiStatus> {
  const [row] = await db
    .select({
      id: ltiRegistrations.id,
      enabled: ltiRegistrations.enabled,
      clientId: ltiRegistrations.clientId,
      deploymentId: ltiRegistrations.deploymentId,
      toolAudience: ltiRegistrations.toolAudience,
      oidcInitiationUrl: ltiRegistrations.oidcInitiationUrl,
      jwksUrl: ltiRegistrations.jwksUrl,
    })
    .from(ltiRegistrations)
    .where(eq(ltiRegistrations.workspaceId, workspaceId))
    .limit(1);

  return {
    registrationId: row?.id ?? null,
    enabled: row?.enabled ?? false,
    clientId: row?.clientId ?? null,
    deploymentId: row?.deploymentId ?? null,
    toolAudience: row?.toolAudience ?? null,
    oidcInitiationUrl: row?.oidcInitiationUrl ?? null,
    jwksUrl: row?.jwksUrl ?? null,
    encryptionReady: isEncryptionConfigured(),
    ...platformUrls(row?.id),
  };
}

export async function getLtiRegistrationConfigById(
  registrationId: string,
): Promise<LtiRegistrationConfig | null> {
  const [row] = await db
    .select()
    .from(ltiRegistrations)
    .where(eq(ltiRegistrations.id, registrationId))
    .limit(1);
  if (!row || !row.enabled || !isEncryptionConfigured()) return null;

  try {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      enabled: row.enabled,
      clientId: row.clientId,
      deploymentId: row.deploymentId,
      toolAudience: row.toolAudience,
      oidcInitiationUrl: row.oidcInitiationUrl,
      jwksUrl: row.jwksUrl,
      keyId: row.keyId,
      publicJwk: row.publicJwk,
      privateKeyPem: decryptSecret({
        ciphertext: row.privateKeyCiphertext,
        iv: row.privateKeyIv,
        tag: row.privateKeyTag,
      }),
    };
  } catch {
    return null;
  }
}

export async function getLtiRegistrationConfigForWorkspace(
  workspaceId: string,
): Promise<LtiRegistrationConfig | null> {
  const [row] = await db
    .select({ id: ltiRegistrations.id })
    .from(ltiRegistrations)
    .where(eq(ltiRegistrations.workspaceId, workspaceId))
    .limit(1);
  return row ? getLtiRegistrationConfigById(row.id) : null;
}

import "server-only";

import { randomUUID } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import {
  createLocalJWKSet,
  jwtVerify,
  SignJWT,
  type JSONWebKeySet,
} from "jose";
import { NextResponse } from "next/server";

import { db, taoLtiClientAssertions, workspaceSettings } from "@harly/db";

import { getHarlyPublicOrigin } from "@/lib/public-origin";
import { getTaoToolConfiguration } from "@/lib/lti/config";
import { safeFetchHttp } from "@/lib/ssrf";
import { ensureTaoSigningKey } from "@/lib/tao/lti/keys";

export const dynamic = "force-dynamic";

const TOKEN_PATH = "/api/integrations/tao/lti/token";
const VALID_GRANT_TYPE = "client_credentials";
const VALID_ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const SCORE_SCOPE = "https://purl.imsglobal.org/spec/lti-ags/scope/score";
const MAX_ASSERTION_LIFETIME_SECONDS = 300;
const ASSERTION_CLOCK_TOLERANCE_SECONDS = 5;

function oauthError(
  status: number,
  error: string,
  description: string,
) {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function readTaoJwks(instanceUrl: string): Promise<JSONWebKeySet> {
  const tool = getTaoToolConfiguration(instanceUrl);
  if (!tool.jwksUrl) throw new Error("TAO JWKS URL is unavailable.");
  const response = await safeFetchHttp(
    tool.jwksUrl,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    },
    process.env.HARLY_ALLOW_PRIVATE_TAO === "true",
  );
  if (response.status < 200 || response.status >= 300) {
    await response.body?.cancel();
    throw new Error("TAO JWKS endpoint did not return a successful response.");
  }

  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("keys" in value)) {
    throw new Error("TAO JWKS response is malformed.");
  }
  const keys = (value as { keys?: unknown }).keys;
  if (
    !Array.isArray(keys) ||
    !keys.some((key) => {
      if (!key || typeof key !== "object") return false;
      const jwk = key as Record<string, unknown>;
      return (
        jwk.kty === "RSA" &&
        typeof jwk.kid === "string" &&
        typeof jwk.n === "string" &&
        typeof jwk.e === "string" &&
        !("d" in jwk) &&
        (jwk.use === undefined || jwk.use === "sig") &&
        (jwk.alg === undefined || jwk.alg === "RS256")
      );
    })
  ) {
    throw new Error("TAO JWKS contains no valid public RSA signing key.");
  }
  return value as JSONWebKeySet;
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthError(400, "invalid_request", "Request must be form-encoded.");
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) {
    return oauthError(400, "invalid_request", "Request body is too large.");
  }

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return oauthError(400, "invalid_request", "Request body is invalid.");
  }

  if (form.get("grant_type") !== VALID_GRANT_TYPE) {
    return oauthError(
      400,
      "unsupported_grant_type",
      "Only client_credentials is allowed.",
    );
  }
  if (form.get("client_assertion_type") !== VALID_ASSERTION_TYPE) {
    return oauthError(
      400,
      "invalid_client",
      "Unsupported client_assertion_type.",
    );
  }

  const clientId = form.get("client_id");
  const clientAssertion = form.get("client_assertion");
  if (!clientId || !clientAssertion) {
    return oauthError(
      400,
      "invalid_client",
      "client_id and client_assertion are required.",
    );
  }

  const requestedScopes = (form.get("scope") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (
    requestedScopes.length !== 1 ||
    requestedScopes[0] !== SCORE_SCOPE
  ) {
    return oauthError(
      400,
      "invalid_scope",
      "Only the LTI AGS score scope is currently supported.",
    );
  }

  const [registration] = await db
    .select({
      organizationId: workspaceSettings.organizationId,
      clientId: workspaceSettings.taoClientId,
      instanceUrl: workspaceSettings.taoInstanceUrl,
      enabled: workspaceSettings.taoEnabled,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.taoClientId, clientId))
    .limit(1);

  if (
    !registration?.enabled ||
    registration.clientId !== clientId ||
    !registration.instanceUrl
  ) {
    return oauthError(401, "invalid_client", "Unknown or disabled client_id.");
  }

  const publicOrigin = getHarlyPublicOrigin();
  const tokenAudience = new URL(TOKEN_PATH, `${publicOrigin}/`).toString();
  let assertionPayload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    const jwks = await readTaoJwks(registration.instanceUrl);
    const { payload } = await jwtVerify(
      clientAssertion,
      createLocalJWKSet(jwks),
      {
        algorithms: ["RS256"],
        issuer: clientId,
        audience: tokenAudience,
        requiredClaims: ["iss", "sub", "aud", "exp", "iat", "jti"],
        maxTokenAge: MAX_ASSERTION_LIFETIME_SECONDS,
        clockTolerance: ASSERTION_CLOCK_TOLERANCE_SECONDS,
      },
    );
    const now = Math.floor(Date.now() / 1_000);
    if (
      payload.sub !== clientId ||
      typeof payload.jti !== "string" ||
      !payload.jti ||
      payload.jti.length > 255 ||
      typeof payload.exp !== "number" ||
      typeof payload.iat !== "number" ||
      payload.iat > now + ASSERTION_CLOCK_TOLERANCE_SECONDS ||
      payload.exp - payload.iat > MAX_ASSERTION_LIFETIME_SECONDS ||
      (payload.client_id !== undefined && payload.client_id !== clientId)
    ) {
      throw new Error("Client assertion claims are invalid.");
    }
    assertionPayload = payload;
  } catch {
    return oauthError(
      401,
      "invalid_client",
      "client_assertion signature or claims are invalid.",
    );
  }

  await db
    .delete(taoLtiClientAssertions)
    .where(lt(taoLtiClientAssertions.expiresAt, new Date()));
  const [reservedAssertion] = await db
    .insert(taoLtiClientAssertions)
    .values({
      clientId,
      jti: assertionPayload.jti as string,
      expiresAt: new Date((assertionPayload.exp as number) * 1_000),
    })
    .onConflictDoNothing()
    .returning({ id: taoLtiClientAssertions.id });
  if (!reservedAssertion) {
    return oauthError(401, "invalid_client", "client_assertion was already used.");
  }

  const signingKey = await ensureTaoSigningKey(registration.organizationId);
  const accessToken = await new SignJWT({
    scope: SCORE_SCOPE,
    client_id: clientId,
    jti: randomUUID(),
  })
    .setProtectedHeader({ alg: "RS256", kid: signingKey.kid, typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .setIssuer(publicOrigin)
    .setAudience(publicOrigin)
    .setSubject(clientId)
    .sign(signingKey.privateKey);

  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 300,
      scope: SCORE_SCOPE,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
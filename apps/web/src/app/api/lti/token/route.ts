import type { JsonWebKey } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";

import {
  db,
  ltiAccessTokens,
  ltiClientAssertions,
  ltiRegistrations,
} from "@harly/db";

import { AGS_SCORE_SCOPE } from "@/lib/lti/constants";
import { audienceIncludes, parseJwt, verifyRs256Jwt } from "@/lib/lti/jwt";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/lti/tokens";
import { getHarlyPublicOrigin } from "@/lib/public-origin";
import { safeFetchHttp } from "@/lib/ssrf";

export const dynamic = "force-dynamic";

const CLIENT_ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const TOKEN_TTL_SECONDS = 3_600;

type JwksResponse = { keys?: JsonWebKey[] };

function oauthError(
  error: "invalid_request" | "invalid_client" | "invalid_grant" | "invalid_scope",
  description: string,
  status = 400,
) {
  return Response.json(
    { error, error_description: description },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}

function stringClaim(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

async function fetchToolJwks(url: string): Promise<JsonWebKey[]> {
  const allowPrivate = process.env.HARLY_ALLOW_PRIVATE_LTI === "true";
  const response = await safeFetchHttp(
    url,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) },
    allowPrivate,
  );
  if (!response.ok) throw new Error(`TAO JWKS returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > 262_144) throw new Error("TAO JWKS response is too large.");
  const body = JSON.parse(text) as JwksResponse;
  if (!Array.isArray(body.keys)) throw new Error("TAO JWKS has no keys array.");
  return body.keys.filter(
    (key) =>
      key &&
      key.kty === "RSA" &&
      (!key.use || key.use === "sig") &&
      (!("alg" in key) || !key.alg || key.alg === "RS256"),
  );
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "Use application/x-www-form-urlencoded.");
  }

  let form: URLSearchParams;
  try {
    const text = await request.text();
    if (text.length > 131_072) return oauthError("invalid_request", "Request is too large.");
    form = new URLSearchParams(text);
  } catch {
    return oauthError("invalid_request", "Could not read the token request.");
  }

  const grantType = form.get("grant_type");
  const assertionType = form.get("client_assertion_type");
  const assertion = form.get("client_assertion");
  const clientId = form.get("client_id");
  const requestedScopes = (form.get("scope") ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  if (grantType !== "client_credentials") {
    return oauthError("invalid_grant", "Only client_credentials is supported.");
  }
  if (assertionType !== CLIENT_ASSERTION_TYPE || !assertion || !clientId) {
    return oauthError("invalid_request", "A private_key_jwt client assertion is required.");
  }
  if (
    requestedScopes.length === 0 ||
    requestedScopes.some((scope) => scope !== AGS_SCORE_SCOPE)
  ) {
    return oauthError("invalid_scope", "Only the AGS score scope is available.");
  }

  const [registration] = await db
    .select({
      id: ltiRegistrations.id,
      clientId: ltiRegistrations.clientId,
      toolAudience: ltiRegistrations.toolAudience,
      jwksUrl: ltiRegistrations.jwksUrl,
      enabled: ltiRegistrations.enabled,
    })
    .from(ltiRegistrations)
    .where(eq(ltiRegistrations.clientId, clientId))
    .limit(1);
  if (!registration?.enabled) {
    return oauthError("invalid_client", "Unknown or disabled LTI client.", 401);
  }

  let parsed;
  try {
    parsed = parseJwt(assertion);
  } catch {
    return oauthError("invalid_client", "Malformed client assertion.", 401);
  }
  if (parsed.header.alg !== "RS256") {
    return oauthError("invalid_client", "Client assertions must use RS256.", 401);
  }

  const now = Math.floor(Date.now() / 1_000);
  const issuer = stringClaim(parsed.payload, "iss");
  const subject = stringClaim(parsed.payload, "sub");
  const jti = stringClaim(parsed.payload, "jti");
  const issuedAt = parsed.payload.iat;
  const expiresAt = parsed.payload.exp;
  const notBefore = parsed.payload.nbf;
  const expectedAudience = `${getHarlyPublicOrigin()}/api/lti/token`;
  const validIssuers = new Set(
    [registration.clientId, registration.toolAudience].filter(
      (value): value is string => Boolean(value),
    ),
  );

  if (!issuer || !validIssuers.has(issuer) || subject !== registration.clientId) {
    return oauthError("invalid_client", "Client assertion identity does not match.", 401);
  }
  if (!audienceIncludes(parsed.payload.aud, expectedAudience)) {
    return oauthError("invalid_client", "Client assertion audience does not match.", 401);
  }
  if (
    typeof issuedAt !== "number" ||
    typeof expiresAt !== "number" ||
    issuedAt > now + 60 ||
    issuedAt < now - 600 ||
    expiresAt <= now ||
    expiresAt > now + 600 ||
    (typeof notBefore === "number" && notBefore > now + 60)
  ) {
    return oauthError("invalid_client", "Client assertion lifetime is invalid.", 401);
  }
  if (!jti || jti.length > 500) {
    return oauthError("invalid_client", "Client assertion must contain a valid jti.", 401);
  }

  try {
    const keys = await fetchToolJwks(registration.jwksUrl);
    const candidates = parsed.header.kid
      ? keys.filter((key) => key.kid === parsed.header.kid)
      : keys;
    if (candidates.length === 0 || !candidates.some((key) => verifyRs256Jwt(parsed, key))) {
      return oauthError("invalid_client", "Client assertion signature is invalid.", 401);
    }
  } catch {
    return oauthError("invalid_client", "Could not validate the TAO signing key.", 401);
  }

  const rawAccessToken = createOpaqueToken(48);
  const tokenExpiresAt = new Date((now + TOKEN_TTL_SECONDS) * 1_000);
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(ltiClientAssertions)
        .where(lt(ltiClientAssertions.expiresAt, new Date()));
      await tx.delete(ltiAccessTokens).where(lt(ltiAccessTokens.expiresAt, new Date()));
      await tx.insert(ltiClientAssertions).values({
        registrationId: registration.id,
        jti,
        expiresAt: new Date(expiresAt * 1_000),
      });
      await tx.insert(ltiAccessTokens).values({
        registrationId: registration.id,
        tokenHash: hashOpaqueToken(rawAccessToken),
        scope: AGS_SCORE_SCOPE,
        expiresAt: tokenExpiresAt,
      });
    });
  } catch {
    return oauthError("invalid_client", "Client assertion has already been used.", 401);
  }

  return Response.json(
    {
      access_token: rawAccessToken,
      token_type: "Bearer",
      expires_in: TOKEN_TTL_SECONDS,
      scope: AGS_SCORE_SCOPE,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}

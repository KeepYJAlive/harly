import "server-only";

import {
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
  type JsonWebKey,
} from "node:crypto";

type JwtHeader = {
  alg: string;
  kid?: string;
  typ?: string;
};

export type ParsedJwt = {
  header: JwtHeader;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
};

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseJsonPart(value: string): Record<string, unknown> {
  if (value.length > 32_768) throw new Error("JWT part is too large.");
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const parsed: unknown = JSON.parse(decoded);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JWT part must be an object.");
  }
  return parsed as Record<string, unknown>;
}

export function parseJwt(token: string): ParsedJwt {
  if (token.length > 65_536) throw new Error("JWT is too large.");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error("JWT must have three parts.");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [
    string,
    string,
    string,
  ];
  const rawHeader = parseJsonPart(encodedHeader);
  if (typeof rawHeader.alg !== "string") {
    throw new Error("JWT is missing an algorithm.");
  }
  return {
    header: {
      alg: rawHeader.alg,
      kid: typeof rawHeader.kid === "string" ? rawHeader.kid : undefined,
      typ: typeof rawHeader.typ === "string" ? rawHeader.typ : undefined,
    },
    payload: parseJsonPart(encodedPayload),
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature: Buffer.from(encodedSignature, "base64url"),
  };
}

export function signRs256Jwt(input: {
  payload: Record<string, unknown>;
  privateKeyPem: string;
  keyId: string;
}): string {
  const header = base64urlJson({ alg: "RS256", kid: input.keyId, typ: "JWT" });
  const payload = base64urlJson(input.payload);
  const signingInput = `${header}.${payload}`;
  const signature = signBytes(
    "RSA-SHA256",
    Buffer.from(signingInput, "utf8"),
    input.privateKeyPem,
  );
  return `${signingInput}.${signature.toString("base64url")}`;
}

export function verifyRs256Jwt(parsed: ParsedJwt, jwk: JsonWebKey): boolean {
  if (parsed.header.alg !== "RS256") return false;
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  return verifyBytes(
    "RSA-SHA256",
    Buffer.from(parsed.signingInput, "utf8"),
    publicKey,
    parsed.signature,
  );
}

export function audienceIncludes(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value === expected;
  return Array.isArray(value) && value.some((entry) => entry === expected);
}

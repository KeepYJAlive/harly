import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function tokenHashMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashOpaqueToken(token));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isPlausibleOpaqueToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,160}$/.test(token);
}

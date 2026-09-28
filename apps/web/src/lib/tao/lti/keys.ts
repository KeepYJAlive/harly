import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importPKCS8,
  type JWK,
} from "jose";

import { db, taoLtiSigningKeys } from "@harly/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export type TaoSigningKey = {
  kid: string;
  privateKey: Awaited<ReturnType<typeof importPKCS8>>;
  publicJwk: JWK;
};

async function readActiveKey(organizationId: string) {
  const [row] = await db
    .select()
    .from(taoLtiSigningKeys)
    .where(
      and(
        eq(taoLtiSigningKeys.organizationId, organizationId),
        eq(taoLtiSigningKeys.active, true),
      ),
    )
    .limit(1);
  return row?.active ? row : null;
}

export async function ensureTaoSigningKey(
  organizationId: string,
): Promise<TaoSigningKey> {
  let row = await readActiveKey(organizationId);
  if (!row) {
    const { kid, privatePkcs8, publicJwk } =
      await generateTaoSigningKeyMaterial();
    const encrypted = encryptSecret(privatePkcs8);

    try {
      const [inserted] = await db
        .insert(taoLtiSigningKeys)
        .values({
          organizationId,
          kid,
          privateKeyCiphertext: encrypted.ciphertext,
          privateKeyIv: encrypted.iv,
          privateKeyTag: encrypted.tag,
          publicJwk,
        })
        .returning();
      row = inserted ?? null;
    } catch (error) {
      // A concurrent request may have won the one-active-key race.
      row = await readActiveKey(organizationId);
      if (!row) throw error;
    }
  }

  const privatePkcs8 = decryptSecret({
    ciphertext: row.privateKeyCiphertext,
    iv: row.privateKeyIv,
    tag: row.privateKeyTag,
  });
  return {
    kid: row.kid,
    privateKey: await importPKCS8(privatePkcs8, "RS256"),
    publicJwk: row.publicJwk as JWK,
  };
}

/** Generates portable key material for persistence/rotation. The caller must
 * encrypt privatePkcs8 before storage. */
export async function generateTaoSigningKeyMaterial() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
    modulusLength: 2048,
  });
  const kid = randomUUID();
  return {
    kid,
    privatePkcs8: await exportPKCS8(privateKey),
    publicJwk: {
      ...(await exportJWK(publicKey)),
      kid,
      use: "sig",
      alg: "RS256",
    } satisfies JWK,
  };
}

export async function listActiveTaoPublicKeys(): Promise<JWK[]> {
  const rows = await db
    .select({ publicJwk: taoLtiSigningKeys.publicJwk })
    .from(taoLtiSigningKeys)
    .where(eq(taoLtiSigningKeys.active, true));
  return rows.map((row) => row.publicJwk as JWK);
}

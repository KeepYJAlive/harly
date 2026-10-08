import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  workspaceSettings,
  taoRemoteLists as lists,
  taoRemoteListEntries as entries,
} from "@harly/db";
import { decryptSecret } from "@/lib/crypto";
import { parseRemoteListCredentials } from "@/lib/tao/remote-lists/connection";
import { remoteListEntryUri } from "@/lib/tao/remote-lists/identifiers";
import { listKey } from "@/lib/tao/remote-lists/import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "no-store",
  Vary: "Authorization",
};
function response(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers:
      status === 401
        ? {
            ...headers,
            "WWW-Authenticate":
              'Basic realm="Harly Remote Lists", charset="UTF-8"',
          }
        : headers,
  });
}

/** Consumed directly by TAO RemoteSource with $.values[*].uri / $.values[*].label. */
export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const credentials = parseRemoteListCredentials(
    request.headers.get("Authorization"),
  );
  if (!credentials) return response({ error: "Unauthorized" }, 401);
  const { workspace, token } = credentials;
  const [config] = await db
    .select({
      ciphertext: workspaceSettings.taoRemoteListTokenCiphertext,
      iv: workspaceSettings.taoRemoteListTokenIv,
      tag: workspaceSettings.taoRemoteListTokenTag,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.organizationId, workspace));
  if (!config?.ciphertext || !config.iv || !config.tag)
    return response({ error: "Unauthorized" }, 401);
  try {
    const expected = decryptSecret({
      ciphertext: config.ciphertext,
      iv: config.iv,
      tag: config.tag,
    });
    const digest = (value: string) =>
      createHash("sha256").update(value).digest();
    if (!timingSafeEqual(digest(token), digest(expected)))
      return response({ error: "Unauthorized" }, 401);
  } catch {
    return response({ error: "Unauthorized" }, 401);
  }
  const { key } = await context.params;
  if (!listKey.safeParse(key).success)
    return response({ error: "List not found" }, 404);
  return db.transaction(async (tx) => {
    // Shares the admin mutation lock, preventing a mixed-revision response.
    const [list] = await tx
      .select()
      .from(lists)
      .where(and(eq(lists.organizationId, workspace), eq(lists.key, key)))
      .for("share");
    if (!list) return response({ error: "List not found" }, 404);
    // Never serve [] when disabled: that would erase TAO's cached vocabulary.
    if (!list.enabled) return response({ error: "List is disabled" }, 409);
    // Include inactive values: this TAO parser has no enabled field and reload
    // replaces cached values. Dropping a URI could orphan an item assignment.
    const values = await tx
      .select({
        id: entries.externalKey,
        label: entries.label,
      })
      .from(entries)
      .where(eq(entries.remoteListId, list.id))
      .orderBy(asc(entries.position), asc(entries.externalKey));
    return response(
      {
        values: values.map((value) => ({
          label: value.label,
          uri: remoteListEntryUri(list.id, value.id),
        })),
      },
      200,
    );
  });
}

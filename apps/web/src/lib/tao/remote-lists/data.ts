import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, taoRemoteLists, taoRemoteListEntries } from "@harly/db";

export async function getRemoteLists(organizationId: string) {
  const lists = await db
    .select()
    .from(taoRemoteLists)
    .where(eq(taoRemoteLists.organizationId, organizationId))
    .orderBy(asc(taoRemoteLists.name));
  const entries = await db
    .select({
      listId: taoRemoteListEntries.remoteListId,
      id: taoRemoteListEntries.externalKey,
      label: taoRemoteListEntries.label,
      enabled: taoRemoteListEntries.enabled,
    })
    .from(taoRemoteListEntries)
    .innerJoin(
      taoRemoteLists,
      and(
        eq(taoRemoteLists.id, taoRemoteListEntries.remoteListId),
        eq(taoRemoteLists.organizationId, organizationId),
      ),
    )
    .orderBy(
      asc(taoRemoteListEntries.position),
      asc(taoRemoteListEntries.externalKey),
    );
  return lists.map((list) => ({
    ...list,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
    values: entries
      .filter((e) => e.listId === list.id)
      .map(({ id, label, enabled }) => ({ id, label, enabled })),
  }));
}
export type RemoteListView = Awaited<ReturnType<typeof getRemoteLists>>[number];

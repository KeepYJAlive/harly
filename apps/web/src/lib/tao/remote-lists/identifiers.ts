// TAO CreateRdsListStore::create() defines list_items.uri as varchar(255).
const PREFIX = "urn:harly:remote-list:";
const UUID_LENGTH = 36;
export function canEncodeRemoteListId(externalKey: string) {
  try {
    return (
      PREFIX.length +
        UUID_LENGTH +
        1 +
        encodeURIComponent(externalKey).length <=
      255
    );
  } catch {
    // JSON can contain lone surrogate code points, which cannot form a URI.
    return false;
  }
}
export function remoteListEntryUri(listId: string, externalKey: string) {
  return `${PREFIX}${listId}:${encodeURIComponent(externalKey)}`;
}

export type StoragePresignResponse = {
  uploadUrl: string;
  fileUrl: string;
  key: string;
  uploadHeaders?: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}
function isStoragePresignResponse(
  value: unknown,
): value is StoragePresignResponse {
  return (
    isRecord(value) &&
    typeof value.uploadUrl === "string" &&
    typeof value.fileUrl === "string" &&
    typeof value.key === "string" &&
    (value.uploadHeaders === undefined || isStringRecord(value.uploadHeaders))
  );
}

/** Accept authenticated raw responses and public v1 `{ data }` envelopes. */
export function parseStoragePresignResponse(
  value: unknown,
): StoragePresignResponse | null {
  if (isStoragePresignResponse(value)) return value;
  if (isRecord(value) && isStoragePresignResponse(value.data)) {
    return value.data;
  }
  return null;
}

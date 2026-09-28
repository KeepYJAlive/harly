export type TaoUrlValidationOptions = {
  production?: boolean;
};

function parseTaoUrl(
  raw: string,
  label: string,
  options: TaoUrlValidationOptions = {},
): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }

  const production = options.production ?? process.env.NODE_ENV === "production";
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  if (production && url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS in production.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} cannot contain credentials.`);
  }
  if (url.hash) {
    throw new Error(`${label} cannot contain a fragment.`);
  }
  return url;
}

export function normalizeTaoInstanceUrl(
  raw: string,
  options: TaoUrlValidationOptions = {},
): string {
  const url = parseTaoUrl(raw, "TAO instance URL", options);
  if (url.search) {
    throw new Error("TAO instance URL cannot contain a query string.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

export function normalizeOptionalTaoEndpoint(
  raw: string | null | undefined,
  label: string,
  options: TaoUrlValidationOptions = {},
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return parseTaoUrl(trimmed, label, options).toString();
}

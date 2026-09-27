export function normalizeLtiUrl(raw: string): URL {
  const url = new URL(raw.trim());
  const localDevelopmentUrl =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localDevelopmentUrl) {
    throw new Error("LTI endpoints must use HTTPS.");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("LTI endpoints cannot contain credentials or fragments.");
  }
  return url;
}

/** TAO launch URLs may contain a delivery id in either supported route form. */
export function deliveryIdFromTargetLink(targetLinkUri: string): string | null {
  const url = new URL(targetLinkUri);
  const advance = /\/launch-lti-1p3\/([^/]+)\/?$/.exec(url.pathname);
  if (advance?.[1]) return decodeURIComponent(advance[1]);
  const core = url.searchParams.get("delivery");
  return core?.trim() || null;
}

export function validateTaoTargetLink(
  targetLinkUri: string,
  oidcInitiationUrl: string,
): URL {
  const target = normalizeLtiUrl(targetLinkUri);
  const oidc = normalizeLtiUrl(oidcInitiationUrl);
  if (target.origin !== oidc.origin) {
    throw new Error("The TAO launch URL must use the configured TAO origin.");
  }
  return target;
}

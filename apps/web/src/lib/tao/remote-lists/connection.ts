/** Native TAO/Guzzle URL credentials use HTTP Basic authentication. */
export function parseRemoteListCredentials(authorization: string | null) {
  if (!authorization || authorization.length > 1024) return null;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64");
  if (decoded.toString("base64") !== match[1]) return null;
  const text = decoded.toString("utf8");
  const separator = text.indexOf(":");
  const workspace = text.slice(0, separator);
  const token = text.slice(separator + 1);
  if (
    separator < 1 ||
    workspace.length > 200 ||
    /[\s\u0000-\u001f\u007f]/.test(workspace) ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  )
    return null;
  return { workspace, token };
}

export function remoteListSourceUrl(
  origin: string,
  workspace: string,
  key: string,
  token: string,
) {
  const url = new URL(
    `/api/plugins/tao/remote-lists/${encodeURIComponent(key)}`,
    origin,
  );
  if (url.protocol !== "https:")
    throw new Error(
      "Configure an HTTPS Harly public URL before connecting TAO Remote Lists.",
    );
  if (
    !parseRemoteListCredentials(
      `Basic ${Buffer.from(`${workspace}:${token}`).toString("base64")}`,
    )
  )
    throw new Error("Invalid remote-list credentials.");
  url.username = workspace;
  url.password = token;
  return url.toString();
}

export type OidcAuthorizationInput = {
  clientId: string;
  redirectUri: string;
  loginHint: string;
  messageHint: string;
  nonce: string;
  state: string;
  responseType: string;
  responseMode: string;
  scope: string;
  prompt: string | null;
};

function bounded(value: string, min: number, max: number) {
  return value.length >= min && value.length <= max;
}

export function validateOidcAuthorizationInput(
  input: OidcAuthorizationInput,
): string | null {
  if (input.responseType !== "id_token") return "Unsupported response_type.";
  if (input.responseMode !== "form_post") return "Unsupported response_mode.";
  if (!input.scope.split(/\s+/).includes("openid"))
    return "openid scope is required.";
  if (input.prompt && input.prompt !== "none")
    return "Unsupported prompt value.";
  if (!bounded(input.clientId, 1, 500)) return "Invalid client_id.";
  if (!bounded(input.redirectUri, 1, 2_000)) return "Invalid redirect_uri.";
  if (!bounded(input.loginHint, 40, 160)) return "Invalid login_hint.";
  if (!bounded(input.messageHint, 36, 80)) return "Invalid lti_message_hint.";
  if (!bounded(input.state, 16, 2_000)) return "Invalid state.";
  if (!bounded(input.nonce, 16, 2_000)) return "Invalid nonce.";
  return null;
}

export function validateStoredLaunchState(input: {
  consumedAt: Date | null;
  expiresAt: Date;
  now: Date;
  loginHintMatches: boolean;
}): string | null {
  if (input.consumedAt) return "Launch state has already been used.";
  if (input.expiresAt <= input.now) return "Launch state has expired.";
  if (!input.loginHintMatches) return "Launch state is invalid.";
  return null;
}

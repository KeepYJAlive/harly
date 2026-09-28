import { createLogger } from "@/lib/logger";
import { createLtiFormPostHtml } from "@/lib/tao/lti/html";
import { authorizeTaoLtiLaunch } from "@/lib/tao/lti/launch";
import type { OidcAuthorizationInput } from "@/lib/tao/lti/state";
import {
  authorizeManualTaoTestLaunch,
  createManualLtiFormPost,
  MANUAL_TAO_TEST,
} from "@/lib/tao/lti/manual-launch";

const log = createLogger("tao-lti-authorize");

function value(params: URLSearchParams, name: string) {
  return params.get(name) ?? "";
}

function parseInput(params: URLSearchParams): OidcAuthorizationInput {
  return {
    clientId: value(params, "client_id"),
    redirectUri: value(params, "redirect_uri"),
    loginHint: value(params, "login_hint"),
    messageHint: value(params, "lti_message_hint"),
    nonce: value(params, "nonce"),
    state: value(params, "state"),
    responseType: value(params, "response_type"),
    responseMode: value(params, "response_mode"),
    scope: value(params, "scope"),
    prompt: params.get("prompt"),
  };
}

async function respond(params: URLSearchParams) {
  try {
    const input = parseInput(params);
    const launch =
      input.messageHint === MANUAL_TAO_TEST.messageHint
        ? await authorizeManualTaoTestLaunch(input)
        : await authorizeTaoLtiLaunch(input);
    return new Response(
      input.messageHint === MANUAL_TAO_TEST.messageHint
        ? createManualLtiFormPost({
            redirectUri: launch.redirectUri,
            idToken: launch.idToken,
            state: launch.state,
          })
        : createLtiFormPostHtml({
            target: launch.redirectUri,
            idToken: launch.idToken,
            state: launch.state,
          }),
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    log.warn(error, "TAO LTI authorization request rejected");
    return new Response(
      "The assessment launch request is invalid or has expired.",
      {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

export async function GET(request: Request) {
  return respond(new URL(request.url).searchParams);
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return new Response("Unsupported request.", { status: 415 });
  }
  const form = await request.formData();
  const params = new URLSearchParams();
  for (const [key, raw] of form.entries()) {
    if (typeof raw === "string") params.append(key, raw);
  }
  return respond(params);
}

import { NextResponse } from "next/server";

import {
  AGS_SCORE_CONTENT_TYPE,
  recordTaoAgsScore,
  TaoAgsError,
} from "@/lib/tao/lti/ags";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SCORE_BODY_BYTES = 64 * 1024;
const log = createLogger("tao-lti-ags");

function errorResponse(status: number, message: string) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith(AGS_SCORE_CONTENT_TYPE)) {
    return errorResponse(415, "Unsupported score content type.");
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(contentLength) || contentLength > MAX_SCORE_BODY_BYTES) {
    return errorResponse(413, "Score payload is too large.");
  }
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  if (!bearer) return errorResponse(401, "A bearer token is required.");

  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_SCORE_BODY_BYTES) {
      return errorResponse(413, "Score payload is too large.");
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return errorResponse(400, "The AGS score payload is invalid.");
    }
    const { assignmentId } = await context.params;
    await recordTaoAgsScore({
      assignmentId,
      accessToken: bearer,
      score: body,
    });
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof TaoAgsError) {
      return errorResponse(error.status, error.message);
    }
    log.error(error, "TAO AGS score request failed");
    return errorResponse(500, "The AGS score request could not be processed.");
  }
}

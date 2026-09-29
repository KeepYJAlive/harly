import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { PORTAL_SESSION_COOKIE, resolvePortalSession } from "@/lib/portal-auth";
import {
  beginTaoPortalAssignmentLaunch,
  CandidateLaunchError,
} from "@/lib/tao/lti/launch";
import { createLogger } from "@/lib/logger";

const log = createLogger("portal-assessment-launch");

function unavailable(request: Request) {
  return NextResponse.redirect(
    new URL("/portal/assessments/unavailable", request.url),
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const assignmentId = z.uuid().safeParse((await params).assignmentId);
  if (!assignmentId.success) return unavailable(request);

  const token = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/portal/login", request.url));
  }
  const session = await resolvePortalSession(token);
  if (!session) {
    return NextResponse.redirect(new URL("/portal/login", request.url));
  }

  try {
    const initiationUrl = await beginTaoPortalAssignmentLaunch({
      assignmentId: assignmentId.data,
      organizationId: session.workspaceId,
      candidateId: session.candidateId,
    });
    return NextResponse.redirect(initiationUrl);
  } catch (error) {
    if (!(error instanceof CandidateLaunchError)) {
      log.error(error, "Candidate assessment launch failed");
    } else if (error.code === "provider" || error.code === "configuration") {
      log.error(
        { code: error.code, assignmentId: assignmentId.data },
        "Candidate assessment provider launch failed",
      );
    }
    return unavailable(request);
  }
}

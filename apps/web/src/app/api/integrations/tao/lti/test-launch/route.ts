import { NextResponse } from "next/server";

import { assertNotDemo } from "@/features/demo/assert-not-demo";
import { requirePermission } from "@/features/workspaces/permissions-server";
import {
  beginManualTaoTestLaunch,
  isManualTaoTestLaunchEnabled,
} from "@/lib/tao/lti/manual-launch";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isManualTaoTestLaunchEnabled()) {
    return new Response("Not found.", { status: 404 });
  }

  let context: Awaited<ReturnType<typeof requirePermission>>;
  try {
    assertNotDemo();
    context = await requirePermission("integrations:manage");
  } catch {
    return new Response("Forbidden.", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const destination = await beginManualTaoTestLaunch({
      organizationId: context.organization.id,
      userId: context.user.id,
    });
    return NextResponse.redirect(destination, { status: 302 });
  } catch {
    return new Response(
      "The TAO manual test launch is unavailable. Verify the saved registration and try again.",
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

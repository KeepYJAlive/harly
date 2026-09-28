import { NextResponse } from "next/server";

import { listActiveTaoPublicKeys } from "@/lib/tao/lti/keys";

export const dynamic = "force-dynamic";

export async function GET() {
  const keys = await listActiveTaoPublicKeys();
  return NextResponse.json(
    { keys },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
      },
    },
  );
}

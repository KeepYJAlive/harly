import { eq } from "drizzle-orm";

import { db, ltiRegistrations } from "@harly/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ registrationId: string }> },
) {
  const { registrationId } = await params;
  const [registration] = await db
    .select({
      enabled: ltiRegistrations.enabled,
      publicJwk: ltiRegistrations.publicJwk,
    })
    .from(ltiRegistrations)
    .where(eq(ltiRegistrations.id, registrationId))
    .limit(1);

  if (!registration?.enabled) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json(
    { keys: [registration.publicJwk] },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        "Content-Type": "application/json",
      },
    },
  );
}

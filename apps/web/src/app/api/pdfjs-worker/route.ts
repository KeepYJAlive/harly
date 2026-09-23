import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const require = createRequire(import.meta.url);

export async function GET() {
  const workerPath = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
  const body = await readFile(workerPath);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

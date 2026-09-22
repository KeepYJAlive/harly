/**
 * Fase 1 spike — vector signature capture (client only).
 *
 * Thin wrappers around pdfjs-dist's `SignatureExtractor` (same dependency
 * Harly already uses for PDF rendering in `usePdfPageRenderer.ts`).
 * The extractor converts Type/Draw/Image input into resolution-independent
 * vector outlines instead of the PNG raster `SignaturePad` produces today
 * via `canvas.toDataURL("image/png")`.
 *
 * Scope rules for this spike:
 * - No imports of server modules, no `server-only`.
 * - pdfjs-dist is loaded lazily via dynamic `import()` so the main bundle
 *   is untouched when the flag is off (same pattern as `usePdfPageRenderer`).
 * - Every wrapper accepts an injectable `extractor` so node tests can pass
 *   the legacy build (or a stub for the OffscreenCanvas-dependent paths)
 *   without needing a browser.
 * - Validation here is input-shape only (finite numbers, bounds, counts).
 *   Bounding-box-vs-field checks belong to the bake step (Fase A, out of
 *   scope) per the approved plan.
 */

// Matches `NATIVE_FIELD_TEXT_MAX_LENGTH` in `lib/esign/native/bake.ts`.
export const VECTOR_TEXT_MAX_LENGTH = 200;
export const VECTOR_MAX_CURVES = 200;
export const VECTOR_MAX_POINTS_PER_CURVE = 20000;
export const VECTOR_MAX_DIM = 2048;
// Compressed vector outline (pdf.js `compressSignature` output): base64
// deflate payload, typically a few KB. Cap well above real signatures but
// far below anything that could hurt storage or decompress time.
export const MAX_VECTOR_COMPRESSED_CHARS = 100_000;

export type VectorCurve = { points: number[] };
export type VectorDims = { width: number; height: number };
export type VectorFontInfo = {
  fontFamily: string;
  fontStyle: string;
  fontWeight: string;
};

export type VectorSignatureData = {
  /** SVG path data in normalized 0..1 coordinates (from `outline.toSVGPath()`). */
  outlinePath: string;
  /** true for Type/Image (filled contours), false for Draw (stroked ink). */
  areContours: boolean;
  thickness: number;
  width: number;
  height: number;
  curveCount: number;
  /** `deflate-raw` base64 from `compressSignature`, null when empty. */
  compressed: string | null;
};

type ExtractorOutline = { toSVGPath(): string };
type ExtractorResult = {
  outline: ExtractorOutline;
  newCurves: Array<{ points: number[] } | number[]>;
  areContours: boolean;
  thickness: number;
  width: number;
  height: number;
} | null;

/** Structural subset of pdfjs-dist `SignatureExtractor` statics we use. */
export type VectorExtractor = {
  processDrawnLines(args: {
    lines: { curves: unknown; thickness?: number; width: number; height: number };
    pageWidth: number;
    pageHeight: number;
    rotation: number;
    innerMargin: number;
    mustSmooth: boolean;
    areContours: boolean;
  }): ExtractorResult;
  extractContoursFromText(
    text: string,
    fontInfo: VectorFontInfo,
    pageWidth: number,
    pageHeight: number,
    rotation: number,
    innerMargin: number,
  ): ExtractorResult;
  process(
    bitmap: ImageBitmap,
    pageWidth: number,
    pageHeight: number,
    rotation: number,
    innerMargin: number,
  ): ExtractorResult;
  compressSignature(args: {
    outlines: unknown;
    areContours: boolean;
    thickness: number;
    width: number;
    height: number;
  }): Promise<string>;
  decompressSignature(data: string): Promise<unknown>;
};

async function defaultExtractor(): Promise<VectorExtractor> {
  const pdfjs = await import("pdfjs-dist");
  return pdfjs.SignatureExtractor as unknown as VectorExtractor;
}

/**
 * Server/Node extractor. The default browser build touches DOMMatrix at
 * module top-level and crashes in node — the legacy build is the same
 * algorithm and loads cleanly (verified in Fase 0/1 node tests).
 * Server actions and `server-only` modules must pass this explicitly;
 * never import the default build on the server.
 */
export async function serverVectorExtractor(): Promise<VectorExtractor> {
  const m = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return (m as unknown as { SignatureExtractor: VectorExtractor }).SignatureExtractor;
}

export type VerifiedVector = {
  width: number;
  height: number;
  curves: number;
  areContours: boolean;
  thickness: number;
};

/**
 * Fail-closed vector verification: shape check, then a real decompress
 * with bounds. Returns the outline metadata or null. Works wherever the
 * given extractor loads (browser default, node legacy).
 */
export async function verifyVectorPayload(
  vectorData: string,
  loadExtractor: () => Promise<VectorExtractor> = defaultExtractor,
): Promise<VerifiedVector | null> {
  const shaped = validateVectorSaveInput({ vectorData });
  if (!shaped.ok) return null;
  try {
    const ext = await loadExtractor();
    const data = (await ext.decompressSignature(shaped.vectorData)) as {
      outlines: ArrayLike<number>[];
      areContours: boolean;
      thickness: number;
      width: number;
      height: number;
    } | null;
    if (!data || !Array.isArray(data.outlines) || data.outlines.length === 0) return null;
    if (data.outlines.length > VECTOR_MAX_CURVES) return null;
    if (
      !Number.isFinite(data.width) || !Number.isFinite(data.height) ||
      data.width < 1 || data.height < 1 ||
      data.width > VECTOR_MAX_DIM || data.height > VECTOR_MAX_DIM
    ) {
      return null;
    }
    return {
      width: data.width,
      height: data.height,
      curves: data.outlines.length,
      areContours: data.areContours,
      thickness: Number.isFinite(data.thickness) ? data.thickness : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Pure shape check for a vector save payload (no DB, no decompress).
 * Lives here — not in the server action — so node tests can import it
 * without dragging the server module graph (auth, storage, db).
 * The server action additionally decompresses for real before persisting
 * (fail closed).
 */
export function validateVectorSaveInput(
  input: unknown,
): { ok: true; vectorData: string } | { ok: false; error: string } {
  const raw =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>).vectorData
      : undefined;
  if (typeof raw !== "string") return { ok: false, error: "Invalid vector signature." };
  const vectorData = raw.trim();
  if (vectorData.length < 1 || vectorData.length > MAX_VECTOR_COMPRESSED_CHARS) {
    return { ok: false, error: "Invalid vector signature." };
  }
  if (!/^[A-Za-z0-9+/=_-]+$/.test(vectorData)) {
    return { ok: false, error: "Invalid vector signature encoding." };
  }
  return { ok: true, vectorData };
}

/**
 * Spike flag fallback. Prefer the workspace setting
 * (`workspaceSettings.vectorSignaturesEnabled`, Fase 2) when the caller has
 * it — this env flag covers flows without settings access (portal).
 */
export function isVectorSignaturesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VECTOR_SIGNS === "1";
}

function assertDims(dims: VectorDims): void {
  if (
    !Number.isFinite(dims.width) ||
    !Number.isFinite(dims.height) ||
    dims.width < 1 ||
    dims.height < 1 ||
    dims.width > VECTOR_MAX_DIM ||
    dims.height > VECTOR_MAX_DIM
  ) {
    throw new Error("Invalid signature capture dimensions.");
  }
}

function assertCurves(curves: VectorCurve[]): void {
  if (!Array.isArray(curves) || curves.length === 0) {
    throw new Error("A signature needs at least one stroke.");
  }
  if (curves.length > VECTOR_MAX_CURVES) {
    throw new Error(`A signature supports at most ${VECTOR_MAX_CURVES} strokes.`);
  }
  for (const curve of curves) {
    const pts = curve.points;
    if (!Array.isArray(pts) || pts.length < 2 || pts.length % 2 !== 0) {
      throw new Error("Invalid signature stroke.");
    }
    if (pts.length > VECTOR_MAX_POINTS_PER_CURVE) {
      throw new Error("A signature stroke has too many points.");
    }
    for (const n of pts) {
      if (!Number.isFinite(n)) throw new Error("Invalid signature stroke.");
    }
  }
}

function toData(
  result: ExtractorResult,
  compressed: string | null,
): VectorSignatureData | null {
  if (!result) return null;
  const path = result.outline.toSVGPath();
  if (!path) return null;
  const curves = result.newCurves as Array<{ points: number[] }>;
  return {
    outlinePath: path,
    areContours: result.areContours,
    thickness: result.thickness,
    width: result.width,
    height: result.height,
    curveCount: curves.length,
    compressed,
  };
}

/**
 * Draw tab: raw pointer strokes in canvas pixels (same space `SignaturePad`
 * paints in, e.g. 700x180). Returns null when the extractor finds no data
 * (blank canvas), mirroring pdf.js `#showError("NoData")`.
 */
export async function getVectorFromDraw(
  curves: VectorCurve[],
  dims: VectorDims,
  extractor?: VectorExtractor,
): Promise<VectorSignatureData | null> {
  assertCurves(curves);
  assertDims(dims);
  const ext = extractor ?? (await defaultExtractor());
  const result = ext.processDrawnLines({
    lines: { curves, thickness: 3, width: dims.width, height: dims.height },
    pageWidth: dims.width,
    pageHeight: dims.height,
    rotation: 0,
    innerMargin: 0,
    mustSmooth: false,
    areContours: false,
  });
  if (!result) return null;
  const compressed = await ext.compressSignature({
    outlines: result.newCurves,
    areContours: result.areContours,
    thickness: result.thickness,
    width: result.width,
    height: result.height,
  });
  return toData(result, compressed);
}

/**
 * Type tab: text plus the input's computed font. `extractContoursFromText`
 * rasterizes offscreen (browser-only) and returns filled contours.
 */
export async function getVectorFromType(
  text: string,
  fontInfo: VectorFontInfo,
  dims: VectorDims,
  extractor?: VectorExtractor,
): Promise<VectorSignatureData | null> {
  const value = text.trim();
  if (value.length === 0) throw new Error("Type a name to preview the signature.");
  if (value.length > VECTOR_TEXT_MAX_LENGTH) {
    throw new Error(`Keep the signature under ${VECTOR_TEXT_MAX_LENGTH} characters.`);
  }
  assertDims(dims);
  const ext = extractor ?? (await defaultExtractor());
  const result = ext.extractContoursFromText(
    value,
    fontInfo,
    dims.width,
    dims.height,
    0,
    0,
  );
  if (!result) return null;
  const compressed = await ext.compressSignature({
    outlines: result.newCurves,
    areContours: result.areContours,
    thickness: result.thickness,
    width: result.width,
    height: result.height,
  });
  return toData(result, compressed);
}

/**
 * Image tab: an already-decoded `ImageBitmap` (call `createImageBitmap(file)`
 * first). The extractor grayscales, denoises (bilateral), thresholds and
 * returns ink-only contours — no white background baked in.
 */
export async function getVectorFromImage(
  bitmap: ImageBitmap,
  extractor?: VectorExtractor,
): Promise<VectorSignatureData | null> {
  if (!bitmap || !Number.isFinite(bitmap.width) || bitmap.width < 1) {
    throw new Error("Invalid signature image.");
  }
  const ext = extractor ?? (await defaultExtractor());
  const result = ext.process(bitmap, bitmap.width, bitmap.height, 0, 0);
  if (!result) return null;
  const compressed = await ext.compressSignature({
    outlines: result.newCurves,
    areContours: result.areContours,
    thickness: result.thickness,
    width: result.width,
    height: result.height,
  });
  return toData(result, compressed);
}

export type RebuiltVectorPreview = {
  outlinePath: string;
  areContours: boolean;
};

/**
 * Rebuild an SVG preview from a stored compressed payload (same steps as
 * pdf.js `#addToolbarButton`: decompress → curves → `processDrawnLines`).
 * Used by the Saved tab and settings list; never touches the server.
 * Returns null when the payload is corrupt — callers fall back to hiding
 * the entry, never to trusting it.
 */
export async function rebuildVectorPreview(
  compressed: string,
  extractor?: VectorExtractor,
): Promise<RebuiltVectorPreview | null> {
  if (!compressed || compressed.length > 100_000) return null;
  const ext = extractor ?? (await defaultExtractor());
  const data = (await ext.decompressSignature(compressed)) as {
    outlines: Array<{ points: number[] } | number[]>;
    areContours: boolean;
    thickness: number;
    width: number;
    height: number;
  } | null;
  if (!data || !Array.isArray(data.outlines) || data.outlines.length === 0) {
    return null;
  }
  if (data.outlines.length > VECTOR_MAX_CURVES) return null;
  // Decompress yields Float32Arrays (see pdf.js `#addToolbarButton`, which
  // wraps them the same way); plain arrays pass through untouched.
  const curves = data.outlines.map((o) =>
    Array.isArray(o) || ArrayBuffer.isView(o)
      ? { points: Array.from(o as ArrayLike<number>) }
      : o,
  );
  const result = ext.processDrawnLines({
    lines: {
      curves,
      thickness: data.thickness,
      width: data.width,
      height: data.height,
    },
    pageWidth: data.width,
    pageHeight: data.height,
    rotation: 0,
    innerMargin: 0,
    mustSmooth: false,
    areContours: data.areContours,
  });
  if (!result) return null;
  const path = result.outline.toSVGPath();
  if (!path) return null;
  return { outlinePath: path, areContours: result.areContours };
}

/**
 * Dual-read bridge (browser-only): rasterize a stored vector payload to a
 * PNG data URL so saved vector signatures can feed the current PNG bake
 * flow (`signDocumentNatively`) unchanged. Returns null on any failure —
 * callers keep the PNG path.
 */
export async function vectorToPngDataUrl(
  compressed: string,
  width = 700,
  height = 180,
  extractor?: VectorExtractor,
): Promise<string | null> {
  try {
    const preview = await rebuildVectorPreview(compressed, extractor);
    if (!preview) return null;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="${width}" height="${height}">` +
      `<path d="${preview.outlinePath}" fill="${preview.areContours ? "#171717" : "none"}" ` +
      `stroke="${preview.areContours ? "none" : "#171717"}" stroke-width="4" stroke-linecap="round" ` +
      `stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("rasterize failed"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, width, height);
      return canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

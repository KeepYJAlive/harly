"use client";

import { useEffect, useState } from "react";

import { rebuildVectorPreview } from "./signature-vector";

type Props = {
  /** SVG path data in normalized 0..1 coordinates. Null = nothing to show. */
  d: string | null;
  /** true = filled contours (Type/Image), false = stroked ink (Draw). */
  areContours: boolean;
  className?: string;
};

/**
 * Fase 1 spike — renders a vector signature outline as SVG.
 * Coordinates from `SignatureExtractor` are normalized (0..1), so the path
 * uses `vector-effect="non-scaling-stroke"` to keep line width constant at
 * any size — this is what makes it stay sharp where the PNG preview pixels.
 */
export function VectorSignaturePreview({ d, areContours, className }: Props) {
  if (!d) return null;
  return (
    <div
      className={className ?? "rounded-lg border bg-white p-2"}
      aria-label="Vector signature preview"
    >
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="xMidYMid meet"
        className="h-20 w-full"
        role="img"
      >
        <path
          d={d}
          fill={areContours ? "#171717" : "none"}
          stroke={areContours ? "none" : "#171717"}
          strokeWidth={areContours ? undefined : 4}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p className="mt-1 text-center text-[11px] text-muted-foreground">
        Vector preview (spike) — scales without pixelating.
      </p>
    </div>
  );
}

/**
 * Saved-tab / settings thumbnail: rebuilds the SVG preview from a stored
 * compressed payload on mount. Renders nothing while loading; null payloads
 * (corrupt) render a muted placeholder so the entry can still be deleted.
 */
export function SavedVectorThumb({ vectorData }: { vectorData: string }) {
  const [preview, setPreview] = useState<{ d: string; areContours: boolean } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void rebuildVectorPreview(vectorData)
      .then((next) => {
        if (cancelled) return;
        if (!next) setFailed(true);
        else setPreview({ d: next.outlinePath, areContours: next.areContours });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [vectorData]);

  if (failed) {
    return <span className="px-2 text-center text-[11px] text-muted-foreground">Unreadable vector</span>;
  }
  if (!preview) {
    return <span className="h-10 w-3/4 animate-pulse rounded bg-muted" />;
  }
  return (
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="xMidYMid meet"
      className="max-h-full max-w-full"
      role="img"
      aria-label="Saved vector signature"
    >
      <path
        d={preview.d}
        fill={preview.areContours ? "#171717" : "none"}
        stroke={preview.areContours ? "none" : "#171717"}
        strokeWidth={preview.areContours ? undefined : 4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

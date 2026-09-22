"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "@/lib/notification-island/toast";

/* eslint-disable @next/next/no-img-element */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteSavedSignature,
  listSavedSignatures,
  saveSignature,
  saveVectorSignature,
  type SavedSignatureEntry,
} from "./saved-signature-actions";
import {
  getVectorFromDraw,
  getVectorFromImage,
  getVectorFromType,
  isVectorSignaturesEnabled,
  vectorToPngDataUrl,
  type VectorSignatureData,
} from "./signature-vector";
import { SavedVectorThumb, VectorSignaturePreview } from "./VectorSignaturePreview";

type Props = {
  value?: string;
  onChange: (pngDataUrl: string) => void;
  /** Show the "Saved" tab, backed by the caller's workspace signing settings. */
  allowSaved?: boolean;
  /** Fase 1 spike: receives the vector outline when the flag is on. PNG flow untouched. */
  onVectorChange?: (vector: VectorSignatureData | null) => void;
  /**
   * Fase 2: workspace flag (`workspaceSettings.vectorSignaturesEnabled`).
   * Falls back to the Fase 1 env flag when omitted (portal flows).
   */
  vectorEnabled?: boolean;
};

const TABS = [
  { key: "draw", label: "Draw" },
  { key: "type", label: "Type" },
  { key: "upload", label: "Upload" },
] as const;

export function SignaturePad({ value, onChange, allowSaved = false, onVectorChange, vectorEnabled: vectorEnabledProp }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef(false);
  const internalValueRef = useRef<string | undefined>(undefined);
  const captureStrokeRef = useRef(false);
  const lastSpaceRef = useRef(0);
  // Fase 1 spike: raw pointer strokes in canvas pixels for vector extraction.
  // Only populated when the flag is on; PNG flow never reads this.
  // Fase 2: workspace setting wins when provided, env flag is the fallback.
  const vectorEnabled = vectorEnabledProp ?? isVectorSignaturesEnabled();
  const strokesRef = useRef<number[][]>([]);
  const [vector, setVector] = useState<VectorSignatureData | null>(null);

  function emitVector(next: VectorSignatureData | null) {
    setVector(next);
    onVectorChange?.(next);
  }
  const [mode, setMode] = useState<"draw" | "type" | "upload" | "saved">(
    "draw",
  );
  const [typed, setTyped] = useState("");
  const [captureMode, setCaptureMode] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSignatureEntry[]>([]);
  const [savedLoading, setSavedLoading] = useState(allowSaved);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const [savingCurrent, setSavingCurrent] = useState(false);

  useEffect(() => {
    if (!allowSaved) return;
    let cancelled = false;
    void listSavedSignatures()
      .then((rows) => {
        if (!cancelled) setSaved(rows);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSavedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowSaved]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.strokeStyle = "#171717";
    context.lineWidth = 3;
    context.lineCap = "round";
    if (value === internalValueRef.current) return;
    internalValueRef.current = value;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (value?.startsWith("data:image")) {
      const image = new Image();
      image.onload = () =>
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = value;
    }
  }, [value]);

  function point(clientX: number, clientY: number) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== "draw") return;
    setSelectedSavedId(null);
    drawingRef.current = true;
    const p = point(event.clientX, event.clientY);
    const context = canvasRef.current!.getContext("2d")!;
    // A click without movement is a valid mark. Paint it immediately and
    // commit it on pointer-up instead of relying on pointermove to serialize
    // the canvas.
    context.beginPath();
    context.arc(p.x, p.y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fillStyle = context.strokeStyle;
    context.fill();
    context.beginPath();
    context.moveTo(p.x, p.y);
    if (vectorEnabled) strokesRef.current.push([p.x, p.y]);
    canvasRef.current!.setPointerCapture(event.pointerId);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current && !captureMode) return;
    const context = canvasRef.current!.getContext("2d")!;
    const nativeEvent = event.nativeEvent;
    const samples = nativeEvent.getCoalescedEvents?.() ?? [nativeEvent];
    for (const sample of samples) {
      const p = point(sample.clientX, sample.clientY);
      if (captureMode && !captureStrokeRef.current) {
        context.beginPath();
        context.moveTo(p.x, p.y);
        captureStrokeRef.current = true;
        // Capture mode draws without pointer-down, so no stroke was opened
        // in start() — open one here. Normal mode already opened it.
        if (vectorEnabled) strokesRef.current.push([]);
      }
      context.lineTo(p.x, p.y);
      context.stroke();
      if (vectorEnabled) strokesRef.current[strokesRef.current.length - 1]?.push(p.x, p.y);
    }
  }

  function commitCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nextValue = canvas.toDataURL("image/png");
    internalValueRef.current = nextValue;
    onChange(nextValue);
  }

  function finishDrawing() {
    const shouldCommit = drawingRef.current || captureStrokeRef.current;
    drawingRef.current = false;
    captureStrokeRef.current = false;
    if (shouldCommit) commitCanvas();
    // Fase 1 spike: vector outline alongside the PNG. Failure never blocks signing.
    if (vectorEnabled && shouldCommit) {
      const canvas = canvasRef.current;
      const curves = strokesRef.current
        .filter((pts) => pts.length >= 2)
        .map((pts) => ({ points: pts }));
      if (canvas && curves.length > 0) {
        void getVectorFromDraw(
          curves,
          { width: canvas.width, height: canvas.height },
        )
          .then(emitVector)
          .catch(() => undefined);
      }
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    internalValueRef.current = "";
    captureStrokeRef.current = false;
    strokesRef.current = [];
    setTyped("");
    setSelectedSavedId(null);
    emitVector(null);
    onChange("");
  }

  useEffect(() => {
    if (!captureMode) return;
    function stop(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setCaptureMode(false);
        captureStrokeRef.current = false;
      }
    }
    window.addEventListener("keydown", stop);
    return () => window.removeEventListener("keydown", stop);
  }, [captureMode]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        mode !== "draw" ||
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement
      )
        return;
      if (event.code !== "Space") return;
      const now = Date.now();
      if (now - lastSpaceRef.current < 350) {
        event.preventDefault();
        setCaptureMode((current) => !current);
        captureStrokeRef.current = false;
        lastSpaceRef.current = 0;
      } else {
        lastSpaceRef.current = now;
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [mode]);

  function renderTyped(value: string) {
    setTyped(value);
    setSelectedSavedId(null);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#171717";
    context.font = "italic 42px cursive";
    context.fillText(value.slice(0, 80), 30, 105);
    const nextValue = canvas.toDataURL("image/png");
    internalValueRef.current = nextValue;
    onChange(nextValue);
    // Fase 1 spike: vector contours alongside the PNG. Failure is silent.
    if (vectorEnabled && value.trim().length > 0) {
      const style = window.getComputedStyle(
        document.getElementById("signature-name") ?? document.body,
      );
      void getVectorFromType(
        value,
        {
          fontFamily: style.fontFamily || "cursive",
          fontStyle: "italic",
          fontWeight: style.fontWeight || "400",
        },
        { width: canvas.width, height: canvas.height },
      )
        .then(emitVector)
        .catch(() => undefined);
    } else if (vectorEnabled) {
      emitVector(null);
    }
  }

  function uploadImage(file: File | undefined) {
    setUploadError(null);
    if (!file) return;
    const supported = ["image/png", "image/jpeg", "image/gif", "image/bmp"];
    if (!supported.includes(file.type)) {
      setUploadError("Use a PNG, JPG, GIF, or BMP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Signature images must be smaller than 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d")!;
        context.clearRect(0, 0, canvas.width, canvas.height);
        const scale = Math.min(
          canvas.width / image.width,
          canvas.height / image.height,
        );
        const width = image.width * scale;
        const height = image.height * scale;
        context.drawImage(
          image,
          (canvas.width - width) / 2,
          (canvas.height - height) / 2,
          width,
          height,
        );
        const nextValue = canvas.toDataURL("image/png");
        internalValueRef.current = nextValue;
        setTyped("");
        setSelectedSavedId(null);
        onChange(nextValue);
        // Fase 1 spike: ink-only contours alongside the PNG. Failure is silent.
        if (vectorEnabled && typeof createImageBitmap === "function") {
          void createImageBitmap(file)
            .then((bitmap) => getVectorFromImage(bitmap))
            .then((next) => emitVector(next))
            .catch(() => undefined);
        }
      };
      image.onerror = () => setUploadError("That image could not be read.");
      image.src = String(reader.result);
    };
    reader.onerror = () => setUploadError("That image could not be read.");
    reader.readAsDataURL(file);
  }

  function selectSaved(signature: SavedSignatureEntry) {
    setSelectedSavedId(signature.id);
    // Fase 2 dual-read: vector rows rasterize to the PNG the bake flow
    // expects. Failure falls back to leaving the canvas untouched.
    if (signature.kind === "vector") {
      void vectorToPngDataUrl(signature.vectorData)
        .then((png) => {
          if (!png) {
            toast.error("That vector signature could not be loaded.");
            return;
          }
          internalValueRef.current = png;
          onChange(png);
        })
        .catch(() => toast.error("That vector signature could not be loaded."));
      return;
    }
    internalValueRef.current = signature.dataUrl;
    onChange(signature.dataUrl);
  }

  function deleteSaved(id: string) {
    void deleteSavedSignature({ id }).then((result) => {
      if (!result.ok) {
        toast.error(result.error ?? "Could not delete the signature.");
        return;
      }
      setSaved((current) => current.filter((item) => item.id !== id));
      if (selectedSavedId === id) setSelectedSavedId(null);
    });
  }

  function saveCurrent() {
    if (!value) return;
    setSavingCurrent(true);
    // Fase 2 dual-write: PNG row first (legacy flow), then the vector row
    // when the flag is on and an outline was captured. Either may fail
    // independently without blocking the other.
    const vectorData = vectorEnabled ? vector?.compressed ?? null : null;
    void saveSignature({ pngBase64: value })
      .then(async (result) => {
        if (!result.ok) {
          toast.error(result.error ?? "Could not save the signature.");
          return;
        }
        if (vectorData) {
          const vec = await saveVectorSignature({ vectorData });
          if (!vec.ok) {
            toast.error("PNG saved, but the vector copy failed. You can retry from the signing screen.");
          }
        }
        toast.success("Signature saved for reuse");
        return listSavedSignatures().then((rows) => setSaved(rows));
      })
      .catch(() => toast.error("Could not save the signature."))
      .finally(() => setSavingCurrent(false));
  }

  const tabs = allowSaved
    ? [...TABS, { key: "saved" as const, label: "Saved" }]
    : TABS;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-0.5 rounded-full bg-muted p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === tab.key
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {mode !== "saved" ? (
          <Button type="button" size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        ) : null}
      </div>

      {mode === "saved" ? (
        <div className="space-y-2">
          {savedLoading ? (
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="h-16 animate-pulse rounded-lg bg-muted"
                />
              ))}
            </div>
          ) : saved.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
              No saved signatures yet. Draw or type one, then save it here for
              next time.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {saved.map((signature) => (
                <div key={signature.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => selectSaved(signature)}
                    className={`flex h-16 w-full items-center justify-center rounded-lg border bg-white p-1.5 transition-colors ${
                      selectedSavedId === signature.id
                        ? "border-primary ring-1 ring-primary/30"
                        : "border-input hover:border-primary/40"
                    }`}
                  >
                    {signature.kind === "vector" ? (
                      <SavedVectorThumb vectorData={signature.vectorData} />
                    ) : (
                      <img
                        src={signature.dataUrl}
                        alt="Saved signature"
                        className="max-h-full max-w-full object-contain"
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Delete saved signature"
                    onClick={() => deleteSaved(signature.id)}
                    className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border bg-card text-muted-foreground opacity-0 shadow-xs transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {mode === "type" ? (
            <div className="space-y-1">
              <Label htmlFor="signature-name">Name</Label>
              <Input
                id="signature-name"
                value={typed}
                onChange={(event) => renderTyped(event.target.value)}
                placeholder="Your name"
              />
            </div>
          ) : null}
          {mode === "upload" ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/bmp"
                className="sr-only"
                onChange={(event) => uploadImage(event.target.files?.[0])}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose image
              </Button>
            </div>
          ) : null}
          <canvas
            ref={canvasRef}
            width={700}
            height={180}
            className={`h-40 w-full touch-none rounded-lg border bg-white ${captureMode ? "cursor-crosshair" : mode === "draw" ? "cursor-pen" : "cursor-default"}`}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={finishDrawing}
            onPointerCancel={finishDrawing}
            aria-label="Signature pad"
          />
          {mode === "draw" ? (
            captureMode ? (
              <p className="text-xs leading-5 text-muted-foreground">
                Capture active. Move across the pad without holding the
                trackpad. Press Space twice or Escape when you are done.
              </p>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                Press Space twice to capture movement without holding the
                trackpad.
              </p>
            )
          ) : null}
          {uploadError ? (
            <p className="text-xs text-destructive" role="alert">
              {uploadError}
            </p>
          ) : null}
          {vectorEnabled && vector ? (
            <VectorSignaturePreview
              d={vector.outlinePath}
              areContours={vector.areContours}
            />
          ) : null}
          {allowSaved && value ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={savingCurrent}
              onClick={saveCurrent}
            >
              {savingCurrent ? "Saving…" : "Save for reuse"}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

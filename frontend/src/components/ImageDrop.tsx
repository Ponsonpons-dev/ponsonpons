"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { IMAGE_LIMITS, imageRejection, parseImageMeta } from "@/lib/imageMeta";

import { UploadImage } from "./icons";

/**
 * Drop-or-browse image picker for the launch form. Validates locally first
 * (same rules as the server: square, 100 to 1024 px, under 1 MB), then pins
 * the file through /api/upload and hands back the resulting ipfs:// URI.
 * The server re-runs every check; this copy exists only for instant feedback.
 */
export function ImageDrop({
  value,
  onChange,
}: {
  value: string;
  onChange: (uri: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dims, setDims] = useState<string | null>(null);

  // Revoke the object URL when it is replaced or the component unmounts.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const meta = parseImageMeta(bytes);
      const rejection = imageRejection(meta, bytes.byteLength);
      if (rejection) {
        setError(rejection);
        return;
      }

      setBusy(true);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body });
        const json = (await res.json().catch(() => ({}))) as { uri?: string; error?: string };
        if (!res.ok || !json.uri) {
          setError(json.error ?? `Upload failed (HTTP ${res.status}).`);
          return;
        }
        setPreview(URL.createObjectURL(file));
        setDims(`${meta!.width}×${meta!.height} ${meta!.format}`);
        onChange(json.uri);
      } catch {
        setError("Upload failed. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const clear = useCallback(() => {
    onChange("");
    setPreview(null);
    setDims(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [onChange]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-field border border-edge bg-input p-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Launch image preview"
            className="h-12 w-12 shrink-0 rounded-full border border-edge object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-edge bg-ink/[0.05] text-pop">
            <UploadImage className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-ink">
            Image pinned{dims ? ` · ${dims}` : ""}
          </div>
          <div className="truncate font-mono text-[11px] text-dim/70">{value}</div>
        </div>
        <button
          type="button"
          onClick={clear}
          className="shrink-0 rounded-[9px] px-2.5 py-2 text-[12px] font-semibold text-dim transition-colors hover:bg-ink/[0.05] hover:text-ink"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        className={`flex w-full flex-col items-center gap-1.5 rounded-field border border-dashed px-4 py-6 text-center transition-colors ${
          dragging ? "border-pop/60 bg-pop/[0.06]" : "border-edge bg-input hover:bg-hover"
        }`}
      >
        <span className={dragging ? "text-pop" : "text-dim"}>
          <UploadImage className="h-5 w-5" />
        </span>
        <span className="text-[12.5px] font-semibold text-ink">
          {busy ? "Pinning to IPFS…" : dragging ? "Drop it" : "Drop an image or tap to browse"}
        </span>
        <span className="text-[11px] leading-relaxed text-dim/70">
          Square PNG, JPEG, GIF or WebP · {IMAGE_LIMITS.minSide} to {IMAGE_LIMITS.maxSide} px
          (500×500 is ideal) · under 1 MB
        </span>
      </button>
      {error && <div className="mt-1.5 text-[11.5px] text-down">{error}</div>}
    </div>
  );
}

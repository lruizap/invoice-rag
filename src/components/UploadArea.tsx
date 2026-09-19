"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExtractedDataPanel from "@/components/ExtractedDataPanel";
import { normalizeResult, type ExtractApiResult } from "@/lib/normalizeResult";
import { buildFieldErrors, extractResultSchema } from "@/lib/schemas";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

type PreviewFile = {
  file: File;
  url: string;
};

type ExtractResult = ExtractApiResult;

type Props = {
  onSaved?: () => void;
};

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function UploadArea({ onSaved }: Props) {
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validation = useMemo(
    () => (result ? extractResultSchema.safeParse(result) : null),
    [result]
  );
  const errors = useMemo(() => (validation ? buildFieldErrors(validation) : {}), [validation]);
  const isValid = validation?.success ?? false;

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Formato no soportado. Sube una imagen (PNG, JPG, WEBP, GIF) o un PDF.");
      return;
    }
    setError(null);
    setExtractError(null);
    setResult(null);
    setSaveError(null);
    setSavedMessage(null);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { file, url: URL.createObjectURL(file) };
    });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFile(e.dataTransfer.files?.[0]);
    },
    [handleFile]
  );

  const clearPreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setResult(null);
    setExtractError(null);
    setSaveError(null);
    setSavedMessage(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const extractData = async () => {
    if (!preview) return;
    setIsExtracting(true);
    setExtractError(null);
    setResult(null);
    setSaveError(null);
    setSavedMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", preview.file);
      const res = await fetch("/api/extract", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error ?? "No se pudo extraer la información.");
      }
      setResult(normalizeResult(json as ExtractResult));
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setIsExtracting(false);
    }
  };

  const saveDocument = async () => {
    if (!result || !preview || !isValid) return;
    setIsSaving(true);
    setSaveError(null);
    setSavedMessage(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: result.tipo,
          datos: result.datos,
          filename: preview.file.name,
          mimeType: preview.file.type,
          sizeBytes: preview.file.size,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error ?? "No se pudo guardar el documento.");
      }
      setSavedMessage("Documento guardado correctamente.");
      onSaved?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Error inesperado al guardar.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
      {!preview && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors cursor-pointer ${
            isDragging
              ? "border-foreground bg-foreground/5"
              : "border-foreground/20 hover:border-foreground/40"
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-10 h-10 opacity-60"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 8.25 12 3.75m0 0L7.5 8.25M12 3.75v13.5"
            />
          </svg>
          <p className="font-medium">Arrastra una imagen o PDF aquí</p>
          <p className="text-sm opacity-60">o haz clic para seleccionar un archivo</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      {preview && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-foreground/10 p-4">
            <div className="min-w-0">
              <p className="font-medium truncate">{preview.file.name}</p>
              <p className="text-sm opacity-60">
                {preview.file.type} · {formatBytes(preview.file.size)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={extractData}
                disabled={isExtracting}
                className="rounded-full bg-foreground text-background px-3 py-1 text-sm hover:opacity-90 disabled:opacity-50"
              >
                {isExtracting ? "Extrayendo…" : "Extraer datos"}
              </button>
              {result && (
                <button
                  onClick={saveDocument}
                  disabled={!isValid || isSaving}
                  title={!isValid ? "Corrige los campos en rojo antes de guardar" : undefined}
                  className="rounded-full border border-green-600 text-green-600 px-3 py-1 text-sm hover:bg-green-600/10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSaving ? "Guardando…" : "Confirmar y guardar"}
                </button>
              )}
              <button
                onClick={clearPreview}
                className="rounded-full border border-foreground/20 px-3 py-1 text-sm hover:bg-foreground/5"
              >
                Quitar
              </button>
            </div>
          </div>

          {extractError && <p className="text-sm text-red-500">{extractError}</p>}
          {saveError && <p className="text-sm text-red-500">{saveError}</p>}
          {savedMessage && <p className="text-sm text-green-600">{savedMessage}</p>}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <div className="overflow-hidden rounded-xl border border-foreground/10 bg-foreground/[0.03]">
              {preview.file.type === "application/pdf" ? (
                <iframe src={preview.url} title={preview.file.name} className="h-[700px] w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.url}
                  alt={preview.file.name}
                  className="max-h-[700px] w-full object-contain"
                />
              )}
            </div>

            {result ? (
              <ExtractedDataPanel
                tipo={result.tipo}
                datos={result.datos}
                errors={errors}
                isValid={isValid}
                onChange={(datos) => {
                  setSavedMessage(null);
                  setResult({ tipo: result.tipo, datos });
                }}
              />
            ) : (
              <div className="flex h-full min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-foreground/15 p-6 text-center text-sm opacity-50">
                {isExtracting
                  ? "Extrayendo datos…"
                  : 'Pulsa "Extraer datos" para ver aquí los campos detectados.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

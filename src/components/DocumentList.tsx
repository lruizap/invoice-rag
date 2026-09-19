"use client";

import { useEffect, useState } from "react";
import type { DocumentType } from "@/lib/schemas";

type DocumentRow = {
  id: string;
  tipo: DocumentType;
  filename: string;
  mimeType: string;
  createdAt: string;
  titulo: string | null;
  emisor: string | null;
  total: string | null;
  fecha: string | null;
};

type Props = {
  refreshToken: number;
};

const TIPO_LABEL: Record<DocumentType, string> = {
  factura: "Factura",
  recibo: "Recibo",
  contrato: "Contrato",
  desconocido: "Desconocido",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function DocumentList({ refreshToken }: Props) {
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch("/api/documents")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "No se pudo cargar la lista de documentos.");
        if (!cancelled) setDocuments(json as DocumentRow[]);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error inesperado.");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Documentos guardados</h2>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {!error && documents === null && (
        <p className="text-sm opacity-50">Cargando documentos…</p>
      )}

      {documents && documents.length === 0 && (
        <p className="text-sm opacity-50">Aún no has guardado ningún documento.</p>
      )}

      {documents && documents.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-foreground/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left opacity-60">
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Título</th>
                <th className="px-4 py-2 font-medium">Emisor</th>
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Archivo</th>
                <th className="px-4 py-2 font-medium">Guardado</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b border-foreground/5 last:border-0">
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium">
                      {TIPO_LABEL[doc.tipo] ?? doc.tipo}
                    </span>
                  </td>
                  <td className="px-4 py-2 max-w-[240px] truncate" title={doc.titulo ?? undefined}>
                    {doc.titulo ?? "—"}
                  </td>
                  <td className="px-4 py-2">{doc.emisor ?? "—"}</td>
                  <td className="px-4 py-2">{doc.fecha ?? "—"}</td>
                  <td className="px-4 py-2">{doc.total ?? "—"}</td>
                  <td className="px-4 py-2 max-w-[200px] truncate" title={doc.filename}>
                    {doc.filename}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap opacity-60">
                    {formatDate(doc.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

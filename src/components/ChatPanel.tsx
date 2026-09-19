"use client";

import { useState } from "react";

type Source = {
  n: number;
  id: string | null;
  tipo: string;
  filename: string;
  titulo: string | null;
  similarity: number | null;
};

type ChatEntry = {
  question: string;
  answer: string;
  sources: Source[];
  mode: "sql" | "semantic";
  sql?: string;
};

const TIPO_LABEL: Record<string, string> = {
  factura: "Factura",
  recibo: "Recibo",
  contrato: "Contrato",
  desconocido: "Desconocido",
};

export default function ChatPanel() {
  const [question, setQuestion] = useState("");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error ?? "No se pudo responder la pregunta.");
      }
      setEntries((prev) => [
        ...prev,
        {
          question: q,
          answer: json.answer as string,
          sources: (json.sources ?? []) as Source[],
          mode: (json.mode ?? "semantic") as "sql" | "semantic",
          sql: json.sql as string | undefined,
        },
      ]);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Pregunta a tus documentos</h2>

      {entries.length === 0 && (
        <p className="text-sm opacity-50">
          Busca semánticamente en los documentos guardados y cita el origen de cada respuesta.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {entries.map((entry, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-2xl border border-foreground/10 p-4">
            <div className="flex items-center gap-2">
              <p className="font-medium">{entry.question}</p>
              {entry.mode === "sql" && (
                <span className="shrink-0 rounded-full bg-blue-500/10 text-blue-600 px-2 py-0.5 text-xs font-medium">
                  cálculo SQL
                </span>
              )}
            </div>
            <p className="text-sm whitespace-pre-wrap">{entry.answer}</p>
            {entry.sql && (
              <details className="text-xs opacity-70">
                <summary className="cursor-pointer select-none">Ver consulta SQL generada</summary>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-foreground/[0.04] p-2">
                  {entry.sql}
                </pre>
              </details>
            )}
            {entry.sources.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {entry.sources.map((s) => (
                  <span
                    key={`${s.id ?? s.filename}-${s.n}`}
                    title={s.similarity !== null ? `Similitud: ${(s.similarity * 100).toFixed(0)}%` : undefined}
                    className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs"
                  >
                    [{s.n}] {TIPO_LABEL[s.tipo] ?? s.tipo} · {s.titulo ?? s.filename}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <form onSubmit={ask} className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ej: ¿Cuánto pagué en el taller mecánico?"
          className="flex-1 rounded-lg border border-foreground/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/50"
        />
        <button
          type="submit"
          disabled={isLoading || !question.trim()}
          className="rounded-full bg-foreground text-background px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50"
        >
          {isLoading ? "Pensando…" : "Preguntar"}
        </button>
      </form>
    </div>
  );
}

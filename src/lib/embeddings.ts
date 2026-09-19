import { OLLAMA_BASE_URL, ollamaUnreachableMessage } from "@/lib/ollama";

const OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text";

/** Genera un embedding (768 dims con el modelo por defecto `nomic-embed-text`) vía Ollama local. */
export async function getEmbedding(text: string): Promise<number[]> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_EMBEDDING_MODEL, input: text }),
    });
  } catch {
    throw new Error(ollamaUnreachableMessage());
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error ?? "Error al generar el embedding con Ollama.");
  }

  const embedding = data?.embeddings?.[0];
  if (!Array.isArray(embedding)) {
    throw new Error("La respuesta de embeddings de Ollama no tiene el formato esperado.");
  }

  return embedding as number[];
}

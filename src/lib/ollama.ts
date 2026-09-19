export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
};

/** Mensaje de error homogéneo cuando `fetch` no puede alcanzar el daemon de Ollama. */
export function ollamaUnreachableMessage(): string {
  return `No se pudo conectar con Ollama en ${OLLAMA_BASE_URL}. ¿Está corriendo? (\`ollama serve\`)`;
}

/**
 * Llama a `POST /api/chat` de Ollama (formato nativo, no el compatible con OpenAI) y
 * devuelve el texto de la respuesta. Lanza un Error con un mensaje apto para mostrar
 * al usuario si Ollama no responde, devuelve un error, o no hay contenido en la respuesta.
 */
export async function callOllamaChat(
  model: string,
  messages: OllamaMessage[],
  options?: { numPredict?: number; think?: boolean }
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages,
        options: {
          temperature: 0,
          ...(options?.numPredict !== undefined ? { num_predict: options.numPredict } : {}),
        },
        ...(options?.think !== undefined ? { think: options.think } : {}),
      }),
    });
  } catch {
    throw new Error(ollamaUnreachableMessage());
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? "Error al llamar a Ollama.");
  }

  const content: string | undefined = data?.message?.content;
  if (!content) {
    throw new Error("El modelo no devolvió una respuesta.");
  }
  return content;
}

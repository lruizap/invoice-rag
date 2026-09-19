import { afterEach, describe, expect, it, vi } from "vitest";
import { callOllamaChat, ollamaUnreachableMessage } from "./ollama";

function ollamaResponse(content: string, status = 200) {
  return new Response(JSON.stringify({ message: { role: "assistant", content } }), { status });
}

describe("callOllamaChat", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("envía model/messages/options a /api/chat y devuelve el contenido", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ollamaResponse("hola"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callOllamaChat("llama3.1", [{ role: "user", content: "hi" }], {
      numPredict: 100,
    });

    expect(result).toBe("hola");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("llama3.1");
    expect(body.stream).toBe(false);
    expect(body.options.num_predict).toBe(100);
    expect(body.think).toBeUndefined();
  });

  it("incluye think:false cuando se pide desactivar el razonamiento", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ollamaResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await callOllamaChat("qwen3", [{ role: "user", content: "hi" }], { think: false });

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.think).toBe(false);
  });

  it("lanza un error legible si no puede conectar con Ollama", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(callOllamaChat("llama3.1", [])).rejects.toThrow(/No se pudo conectar con Ollama/);
    expect(ollamaUnreachableMessage()).toMatch(/localhost:11434/);
  });

  it("lanza el error devuelto por Ollama si la respuesta no es ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "model not found" }), { status: 404 }))
    );
    await expect(callOllamaChat("no-existe", [])).rejects.toThrow("model not found");
  });

  it("lanza un error si la respuesta no trae contenido", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: {} }))));
    await expect(callOllamaChat("llama3.1", [])).rejects.toThrow(/no devolvió una respuesta/);
  });
});

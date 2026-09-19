import { afterEach, describe, expect, it, vi } from "vitest";
import { getEmbedding } from "./embeddings";

describe("getEmbedding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("envía el texto a /api/embed y devuelve el primer vector", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] })));
    vi.stubGlobal("fetch", fetchMock);

    const embedding = await getEmbedding("hola mundo");

    expect(embedding).toEqual([0.1, 0.2, 0.3]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/embed");
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("nomic-embed-text");
    expect(body.input).toBe("hola mundo");
  });

  it("lanza un error legible si no puede conectar con Ollama", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(getEmbedding("x")).rejects.toThrow(/No se pudo conectar con Ollama/);
  });

  it("lanza el error devuelto por Ollama si la respuesta no es ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "model 'nomic-embed-text' not found" }), {
          status: 404,
        })
      )
    );
    await expect(getEmbedding("x")).rejects.toThrow(/not found/);
  });

  it("lanza un error si la respuesta no trae un array de embeddings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}))));
    await expect(getEmbedding("x")).rejects.toThrow(/formato esperado/);
  });
});

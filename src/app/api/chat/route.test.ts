import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn() },
}));
vi.mock("@/lib/embeddings", () => ({
  getEmbedding: vi.fn(),
}));
vi.mock("@/lib/sqlGuard", () => ({
  runReadOnlyQuery: vi.fn(),
}));

import { pool } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
import { runReadOnlyQuery } from "@/lib/sqlGuard";
import { POST } from "./route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ollamaChat(content: string, status = 200) {
  return new Response(JSON.stringify({ message: { role: "assistant", content } }), { status });
}

/** Distingue la llamada de clasificación (router) de la llamada de respuesta final,
 * inspeccionando el system prompt en vez de depender del orden de las llamadas. */
function makeFetchMock(opts: { router?: () => Response; answer?: () => Response }) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const parsedBody = JSON.parse(init.body as string);
    const systemContent = parsedBody.messages?.[0]?.content ?? "";
    if (systemContent.includes("Decides cómo responder")) {
      return opts.router?.() ?? ollamaChat('{"modo":"semantic"}');
    }
    return opts.answer?.() ?? ollamaChat("respuesta");
  });
}

const sampleRow = {
  id: "doc-1",
  tipo: "recibo",
  filename: "recibo.png",
  titulo: "R-2026-0091",
  texto: "Tipo de documento: recibo\n\n{...}",
  similarity: "0.87",
};

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responde 400 si la pregunta está vacía", async () => {
    const req = makeRequest({ question: "   " });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("responde 400 si el cuerpo no es JSON válido", async () => {
    const req = new NextRequest("http://localhost/api/chat", { method: "POST", body: "no-json" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  describe("pregunta de cálculo/totales -> modo SQL", () => {
    it("el router genera SQL, se ejecuta y se responde SIN usar embeddings", async () => {
      const fetchMock = makeFetchMock({
        router: () =>
          ollamaChat('{"modo": "sql", "sql": "SELECT SUM(total) AS total FROM facturas"}'),
        answer: () => ollamaChat("El total de tus facturas es 1.234,56 EUR."),
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.mocked(runReadOnlyQuery).mockResolvedValue([{ total: "1234.56" }]);

      const req = makeRequest({ question: "¿Cuánto suman todas mis facturas?" });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.mode).toBe("sql");
      expect(json.sql).toBe("SELECT SUM(total) AS total FROM facturas");
      expect(json.answer).toMatch(/1.234,56/);
      expect(json.sources).toEqual([]);

      expect(runReadOnlyQuery).toHaveBeenCalledWith("SELECT SUM(total) AS total FROM facturas");
      expect(getEmbedding).not.toHaveBeenCalled();
      expect(pool.query).not.toHaveBeenCalled();

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:11434/api/chat");
      const sentBody = JSON.parse(options.body as string);
      expect(sentBody.model).toBe("llama3.1");
      expect(sentBody.think).toBe(false);
    });

    it("cuando el resultado SQL incluye filename/tipo, se citan como fuentes", async () => {
      const fetchMock = makeFetchMock({
        router: () =>
          ollamaChat(
            '{"modo":"sql","sql":"SELECT d.filename, d.tipo, f.total FROM facturas f JOIN documents d ON d.id=f.document_id ORDER BY f.total DESC LIMIT 1"}'
          ),
        answer: () => ollamaChat("La factura más cara es factura.pdf, por 500 EUR."),
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.mocked(runReadOnlyQuery).mockResolvedValue([
        { filename: "factura.pdf", tipo: "factura", total: "500.00" },
      ]);

      const req = makeRequest({ question: "¿Cuál es mi factura más cara?" });
      const res = await POST(req);

      const json = await res.json();
      expect(json.mode).toBe("sql");
      expect(json.sources).toEqual([
        { n: 1, id: null, tipo: "factura", filename: "factura.pdf", titulo: null, similarity: null },
      ]);
    });

    it("si la consulta SQL falla o no es segura, cae de vuelta a búsqueda semántica", async () => {
      const fetchMock = makeFetchMock({
        router: () => ollamaChat('{"modo":"sql","sql":"DROP TABLE facturas"}'),
        answer: () => ollamaChat("Pagaste 85,50 EUR [Documento 1]."),
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.mocked(runReadOnlyQuery).mockRejectedValue(
        new Error("La consulta generada no es una consulta SELECT segura.")
      );
      vi.mocked(pool.query).mockResolvedValue({ rows: [sampleRow] } as never);

      const req = makeRequest({ question: "¿Cuánto pagué?" });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.mode).toBe("semantic");
      expect(getEmbedding).toHaveBeenCalled();
      expect(json.sources).toHaveLength(1);
    });
  });

  describe("pregunta de búsqueda/contenido -> modo semántico", () => {
    it("el router decide 'semantic', busca por similitud y cita el documento de origen", async () => {
      const fetchMock = makeFetchMock({
        router: () => ollamaChat('{"modo":"semantic"}'),
        answer: () => ollamaChat("Pagaste 85,50 EUR [Documento 1]."),
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.mocked(pool.query).mockResolvedValue({ rows: [sampleRow] } as never);

      const req = makeRequest({ question: "¿Cuánto pagué en el taller?" });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.mode).toBe("semantic");
      expect(json.answer).toMatch(/85,50 EUR/);
      expect(json.sources).toEqual([
        {
          n: 1,
          id: "doc-1",
          tipo: "recibo",
          filename: "recibo.png",
          titulo: "R-2026-0091",
          similarity: 0.87,
        },
      ]);
      expect(runReadOnlyQuery).not.toHaveBeenCalled();

      const [, queryParams] = vi.mocked(pool.query).mock.calls[0];
      expect((queryParams as unknown[])[0]).toBe("[0.1,0.2,0.3]");
    });

    it("si el router devuelve un JSON malformado, cae a búsqueda semántica", async () => {
      const fetchMock = makeFetchMock({
        router: () => ollamaChat("esto no es json"),
        answer: () => ollamaChat("Pagaste 85,50 EUR [Documento 1]."),
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.mocked(pool.query).mockResolvedValue({ rows: [sampleRow] } as never);

      const req = makeRequest({ question: "¿Cuánto pagué?" });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.mode).toBe("semantic");
    });

    it("sin documentos guardados: responde sin llamar al modelo para generar la respuesta", async () => {
      const fetchMock = makeFetchMock({ router: () => ollamaChat('{"modo":"semantic"}') });
      vi.stubGlobal("fetch", fetchMock);
      vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);

      const req = makeRequest({ question: "¿Cuánto pagué?" });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sources).toEqual([]);
      expect(json.answer).toMatch(/no hay documentos/i);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("responde 502 si falla el embedding de la pregunta", async () => {
      const fetchMock = makeFetchMock({ router: () => ollamaChat('{"modo":"semantic"}') });
      vi.stubGlobal("fetch", fetchMock);
      vi.mocked(getEmbedding).mockRejectedValue(new Error("fallo de red"));

      const req = makeRequest({ question: "¿Cuánto pagué?" });
      const res = await POST(req);
      expect(res.status).toBe(502);
    });

    it("responde 502 si Ollama devuelve un error al generar la respuesta final", async () => {
      const fetchMock = makeFetchMock({
        router: () => ollamaChat('{"modo":"semantic"}'),
        answer: () => new Response(JSON.stringify({ error: "modelo no disponible" }), { status: 503 }),
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.mocked(pool.query).mockResolvedValue({ rows: [sampleRow] } as never);

      const req = makeRequest({ question: "¿Cuánto pagué?" });
      const res = await POST(req);

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error).toMatch(/modelo no disponible/);
    });

    it("responde 502 si el modelo no devuelve contenido en la respuesta final", async () => {
      const fetchMock = makeFetchMock({
        router: () => ollamaChat('{"modo":"semantic"}'),
        answer: () => new Response(JSON.stringify({ message: {} })),
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.mocked(pool.query).mockResolvedValue({ rows: [sampleRow] } as never);

      const req = makeRequest({ question: "¿Cuánto pagué?" });
      const res = await POST(req);
      expect(res.status).toBe(502);
    });

    it("responde 502 con un mensaje claro si Ollama no está disponible", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
      vi.mocked(pool.query).mockResolvedValue({ rows: [sampleRow] } as never);

      const req = makeRequest({ question: "¿Cuánto pagué?" });
      const res = await POST(req);

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error).toMatch(/No se pudo conectar con Ollama/);
    });
  });
});

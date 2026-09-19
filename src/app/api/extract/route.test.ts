import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getScreenshotMock = vi.fn();
const destroyMock = vi.fn();

vi.mock("pdf-parse", () => ({
  PDFParse: vi.fn().mockImplementation(function PDFParseMock() {
    return { getScreenshot: getScreenshotMock, destroy: destroyMock };
  }),
}));

import { POST } from "./route";

function makeRequest(content: BlobPart, filename: string, type: string) {
  const formData = new FormData();
  formData.append("file", new File([content], filename, { type }));
  return new NextRequest("http://localhost/api/extract", { method: "POST", body: formData });
}

function ollamaChatResponse(content: string, status = 200) {
  return new Response(JSON.stringify({ message: { role: "assistant", content } }), { status });
}

describe("POST /api/extract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responde 400 si no se envía ningún archivo", async () => {
    const formData = new FormData();
    const req = new NextRequest("http://localhost/api/extract", { method: "POST", body: formData });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("responde 400 si el tipo de archivo no está soportado", async () => {
    const req = makeRequest("hola", "a.txt", "text/plain");
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("imagen exitosa: envía la imagen en base64 a Ollama y reenvía el JSON extraído", async () => {
    const modelJson = {
      tipo: "recibo",
      datos: { emisor: "A", numero_recibo: "1", fecha: "01/01/2026", total: 10 },
    };
    const fetchMock = vi.fn().mockResolvedValue(ollamaChatResponse(JSON.stringify(modelJson)));
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest("fake-bytes", "recibo.png", "image/png");
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(modelJson);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/chat");
    const sentBody = JSON.parse(options.body as string);
    expect(sentBody.model).toBe("llama3.2-vision");
    expect(sentBody.messages[1].images).toHaveLength(1);
    expect(getScreenshotMock).not.toHaveBeenCalled();
  });

  it("PDF exitoso: rasteriza las páginas a imágenes y las envía a Ollama (sin texto embebido)", async () => {
    const modelJson = {
      tipo: "factura",
      datos: {
        emisor: "A",
        receptor: "B",
        numero_factura: "1",
        fecha: "01/01/2026",
        subtotal: 100,
        impuestos: 21,
        total: 121,
        items: [],
      },
    };
    getScreenshotMock.mockResolvedValue({
      pages: [{ data: new Uint8Array([1, 2, 3]), pageNumber: 1 }],
    });
    const fetchMock = vi.fn().mockResolvedValue(ollamaChatResponse(JSON.stringify(modelJson)));
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest("%PDF-1.4 fake", "factura.pdf", "application/pdf");
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(modelJson);
    expect(getScreenshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ first: 3, imageBuffer: true })
    );
    expect(destroyMock).toHaveBeenCalledTimes(1);

    const [, options] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(options.body as string);
    expect(sentBody.messages[1].images).toEqual([Buffer.from([1, 2, 3]).toString("base64")]);
  });

  it("PDF incompleto: el modelo devuelve datos parciales y la ruta los reenvía tal cual", async () => {
    const modelJson = { tipo: "factura", datos: { emisor: "A" } };
    getScreenshotMock.mockResolvedValue({ pages: [{ data: new Uint8Array([9]) }] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ollamaChatResponse(JSON.stringify(modelJson))));

    const req = makeRequest("%PDF-1.4 fake", "factura-incompleta.pdf", "application/pdf");
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(modelJson);
  });

  it("responde 400 si el PDF no tiene páginas renderizables", async () => {
    getScreenshotMock.mockResolvedValue({ pages: [] });
    const req = makeRequest("%PDF-1.4 fake", "vacio.pdf", "application/pdf");
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("responde 400 si pdf-parse no puede procesar el archivo", async () => {
    getScreenshotMock.mockRejectedValue(new Error("PDF corrupto"));
    const req = makeRequest("no es un pdf", "roto.pdf", "application/pdf");
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("responde 502 con un mensaje claro si Ollama no está disponible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
    const req = makeRequest("fake", "a.png", "image/png");
    const res = await POST(req);

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/No se pudo conectar con Ollama/);
  });

  it("responde 502 si Ollama devuelve un error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "model 'llama3.2-vision' not found" }), {
          status: 404,
        })
      )
    );
    const req = makeRequest("fake", "a.png", "image/png");
    const res = await POST(req);

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/not found/);
  });

  it("responde 502 si el modelo no devuelve contenido de texto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: {} }), { status: 200 }))
    );
    const req = makeRequest("fake", "a.png", "image/png");
    const res = await POST(req);
    expect(res.status).toBe(502);
  });

  it("responde 502 si el modelo devuelve texto que no es JSON válido", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ollamaChatResponse("esto no es json")));
    const req = makeRequest("fake", "a.png", "image/png");
    const res = await POST(req);

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.raw).toBe("esto no es json");
  });

  it("extrae el JSON aunque venga envuelto en un bloque de markdown ```json", async () => {
    const modelJson = { tipo: "desconocido", datos: { resumen: "algo" } };
    const wrapped = "```json\n" + JSON.stringify(modelJson) + "\n```";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ollamaChatResponse(wrapped)));

    const req = makeRequest("fake", "a.png", "image/png");
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(modelJson);
  });
});

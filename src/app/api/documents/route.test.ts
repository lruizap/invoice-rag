import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock("@/lib/embeddings", () => ({
  getEmbedding: vi.fn(),
}));

import { pool } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
import { GET, POST } from "./route";

type MockClient = { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

function makeClient(overrides?: (sql: string) => unknown): MockClient {
  const query = vi.fn(async (sql: string) => {
    const custom = overrides?.(sql);
    if (custom !== undefined) return custom;
    if (sql.includes("INSERT INTO documents")) {
      return { rows: [{ id: "doc-1", created_at: "2026-09-19T00:00:00.000Z" }] };
    }
    if (sql.includes("INSERT INTO facturas")) {
      return { rows: [{ id: "factura-1" }] };
    }
    if (sql.includes("INSERT INTO contratos")) {
      return { rows: [{ id: "contrato-1" }] };
    }
    return { rows: [] };
  });
  return { query, release: vi.fn() };
}

function makeJsonRequest(body: unknown) {
  return new NextRequest("http://localhost/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const facturaCompleta = {
  emisor: "Panadería El Trigo S.L.",
  receptor: "Comercial Ibaizabal S.A.",
  numero_factura: "F-2026-0042",
  fecha: "15/09/2026",
  fecha_vencimiento: "30/09/2026",
  items: [{ descripcion: "Pan integral x50", cantidad: 50, precio_unitario: 1.2, importe: 60 }],
  subtotal: 110,
  impuestos: 11,
  total: 121,
  moneda: "EUR",
};

const reciboCompleto = {
  emisor: "Taller Mecánico Zubieta S.L.",
  receptor: "Jon Etxeberria",
  numero_recibo: "R-2026-0091",
  fecha: "18/09/2026",
  concepto: "Revisión y cambio de aceite",
  metodo_pago: "Tarjeta",
  total: 85.5,
  moneda: "EUR",
};

const contratoCompleto = {
  partes: ["Empresa A S.L.", "Empresa B S.A."],
  objeto: "Prestación de servicios de consultoría",
  fecha_inicio: "01/01/2026",
  fecha_fin: "31/12/2026",
  duracion: "12 meses",
  importe: "2.000 EUR/mes",
  clausulas_clave: ["Confidencialidad", "Exclusividad"],
};

describe("POST /api/documents", () => {
  beforeEach(() => {
    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("responde 400 si el cuerpo no es JSON válido", async () => {
    const req = new NextRequest("http://localhost/api/documents", {
      method: "POST",
      body: "esto no es json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("responde 400 y no llama a la base de datos si los datos no pasan la validación (documento incompleto)", async () => {
    const req = makeJsonRequest({ tipo: "factura", datos: { emisor: "A" } });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/no son válidos/);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(getEmbedding).not.toHaveBeenCalled();
  });

  it("factura completa: guarda documents + facturas + factura_items y confirma la transacción", async () => {
    const client = makeClient();
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const req = makeJsonRequest({
      tipo: "factura",
      datos: facturaCompleta,
      filename: "factura.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1234,
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe("doc-1");

    const calls = client.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes("BEGIN"))).toBe(true);
    expect(calls.some((sql) => sql.includes("INSERT INTO documents"))).toBe(true);
    expect(calls.some((sql) => sql.includes("INSERT INTO facturas"))).toBe(true);
    expect(calls.filter((sql) => sql.includes("INSERT INTO factura_items")).length).toBe(1);
    expect(calls.some((sql) => sql.includes("COMMIT"))).toBe(true);
    expect(calls.some((sql) => sql.includes("ROLLBACK"))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);

    const documentsCall = client.query.mock.calls.find((c) =>
      (c[0] as string).includes("INSERT INTO documents")
    );
    const params = documentsCall?.[1] as unknown[];
    expect(params[0]).toBe("factura");
    expect(params[5]).toBe("[0.1,0.2,0.3]");
  });

  it("recibo completo: guarda documents + recibos", async () => {
    const client = makeClient();
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const req = makeJsonRequest({ tipo: "recibo", datos: reciboCompleto });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const calls = client.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes("INSERT INTO recibos"))).toBe(true);
  });

  it("contrato completo: guarda documents + contratos + partes + cláusulas", async () => {
    const client = makeClient();
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const req = makeJsonRequest({ tipo: "contrato", datos: contratoCompleto });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const calls = client.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes("INSERT INTO contratos"))).toBe(true);
    expect(calls.filter((sql) => sql.includes("INSERT INTO contrato_partes")).length).toBe(2);
    expect(calls.filter((sql) => sql.includes("INSERT INTO contrato_clausulas")).length).toBe(2);
  });

  it("documento desconocido: guarda documents + desconocidos", async () => {
    const client = makeClient();
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const req = makeJsonRequest({ tipo: "desconocido", datos: { resumen: "Ticket de parking" } });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const calls = client.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes("INSERT INTO desconocidos"))).toBe(true);
  });

  it("responde 502 si falla la generación del embedding, sin tocar la base de datos", async () => {
    vi.mocked(getEmbedding).mockRejectedValue(new Error("No se pudo conectar con Ollama"));

    const req = makeJsonRequest({ tipo: "recibo", datos: reciboCompleto });
    const res = await POST(req);

    expect(res.status).toBe(502);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("responde 500 y hace ROLLBACK si falla una inserción a mitad de la transacción", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("INSERT INTO factura_items")) {
        throw new Error("columna inexistente");
      }
      return undefined;
    });
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const req = makeJsonRequest({ tipo: "factura", datos: facturaCompleta });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const calls = client.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes("ROLLBACK"))).toBe(true);
    expect(calls.some((sql) => sql.includes("COMMIT"))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/documents", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("devuelve la lista de documentos guardados", async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [
        {
          id: "doc-1",
          tipo: "factura",
          filename: "factura.pdf",
          mimeType: "application/pdf",
          createdAt: "2026-09-19T00:00:00.000Z",
          titulo: "F-2026-0042",
          emisor: "Panadería El Trigo",
          total: "121.00",
          fecha: "2026-09-15",
        },
      ],
    } as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].tipo).toBe("factura");
  });
});

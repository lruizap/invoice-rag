import { describe, expect, it } from "vitest";
import { normalizeResult } from "./normalizeResult";

describe("normalizeResult", () => {
  it("no modifica una factura cuyo modelo ya devolvió 'items' como array", () => {
    const input = { tipo: "factura" as const, datos: { items: [{ descripcion: "x" }] } };
    expect(normalizeResult(input)).toEqual(input);
  });

  it("rellena 'items' con [] si el modelo lo omite en una factura", () => {
    const result = normalizeResult({ tipo: "factura", datos: { emisor: "A" } });
    expect(result.datos.items).toEqual([]);
  });

  it("rellena 'partes' y 'clausulas_clave' con [] si el modelo los omite en un contrato", () => {
    const result = normalizeResult({ tipo: "contrato", datos: { objeto: "X" } });
    expect(result.datos.partes).toEqual([]);
    expect(result.datos.clausulas_clave).toEqual([]);
  });

  it("no toca los campos de un recibo (no tiene campos de tipo lista)", () => {
    const input = { tipo: "recibo" as const, datos: { emisor: "A", total: 10 } };
    expect(normalizeResult(input)).toEqual(input);
  });

  it("no toca un documento desconocido", () => {
    const input = { tipo: "desconocido" as const, datos: { resumen: "algo" } };
    expect(normalizeResult(input)).toEqual(input);
  });
});

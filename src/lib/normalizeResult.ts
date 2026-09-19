import type { DocumentType } from "@/lib/schemas";

export type ExtractApiResult = {
  tipo: DocumentType;
  datos: Record<string, unknown>;
};

const ARRAY_FIELDS_BY_TIPO: Record<DocumentType, string[]> = {
  factura: ["items"],
  recibo: [],
  contrato: ["partes", "clausulas_clave"],
  desconocido: [],
};

/** Garantiza que los campos de tipo lista existan como array, aunque el modelo los omita. */
export function normalizeResult(raw: ExtractApiResult): ExtractApiResult {
  const arrayFields = ARRAY_FIELDS_BY_TIPO[raw.tipo] ?? [];
  const datos = { ...raw.datos };
  for (const field of arrayFields) {
    if (!Array.isArray(datos[field])) datos[field] = [];
  }
  return { tipo: raw.tipo, datos };
}

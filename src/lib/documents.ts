import { parseFlexibleDate, type DocumentType } from "@/lib/schemas";

/** Convierte una fecha ya validada (DD/MM/AAAA, DD-MM-AAAA o AAAA-MM-DD) al formato DATE de Postgres. */
export function toSqlDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = parseFlexibleDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

/** Representación textual del documento, usada como entrada para el embedding y como respaldo legible. */
export function buildDocumentText(tipo: DocumentType, datos: Record<string, unknown>): string {
  return `Tipo de documento: ${tipo}\n\n${JSON.stringify(datos, null, 2)}`;
}

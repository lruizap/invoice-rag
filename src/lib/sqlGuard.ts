import { pool } from "@/lib/db";

const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|call|execute|vacuum|reindex|listen|notify|merge|do)\b/i;

/** Comprobación superficial: solo un SELECT, sin sentencias múltiples ni palabras clave de escritura. */
export function isSelectOnly(sql: string): boolean {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (trimmed.length === 0) return false;
  if (!/^select\b/i.test(trimmed)) return false;
  if (trimmed.includes(";")) return false;
  if (FORBIDDEN_KEYWORDS.test(trimmed)) return false;
  return true;
}

/**
 * Ejecuta una consulta SELECT generada por el modelo con varias capas de protección:
 * solo se acepta si pasa `isSelectOnly`, se ejecuta dentro de una transacción
 * `READ ONLY` de Postgres (rechaza cualquier escritura a nivel de base de datos
 * aunque el filtro anterior falle), con timeout corto y un LIMIT forzado.
 */
export async function runReadOnlyQuery(
  sql: string,
  maxRows = 50
): Promise<Record<string, unknown>[]> {
  if (!isSelectOnly(sql)) {
    throw new Error("La consulta generada no es una consulta SELECT segura.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '3000ms'");
    const inner = sql.trim().replace(/;+\s*$/, "");
    const wrapped = `SELECT * FROM (${inner}) AS _sub LIMIT ${maxRows}`;
    const { rows } = await client.query(wrapped);
    return rows;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

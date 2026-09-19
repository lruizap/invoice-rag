import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
import { buildDocumentText, toSqlDate } from "@/lib/documents";
import {
  extractResultSchema,
  type ContratoDatos,
  type DesconocidoDatos,
  type FacturaDatos,
  type ReciboDatos,
} from "@/lib/schemas";

export const runtime = "nodejs";

export async function GET() {
  const { rows } = await pool.query(`
    SELECT
      d.id,
      d.tipo,
      d.filename,
      d.mime_type AS "mimeType",
      d.created_at AS "createdAt",
      COALESCE(f.numero_factura, r.numero_recibo, c.objeto, u.resumen) AS titulo,
      COALESCE(f.emisor, r.emisor) AS emisor,
      COALESCE(f.total, r.total) AS total,
      COALESCE(to_char(f.fecha, 'YYYY-MM-DD'), to_char(r.fecha, 'YYYY-MM-DD'), to_char(c.fecha_inicio, 'YYYY-MM-DD')) AS fecha
    FROM documents d
    LEFT JOIN facturas f ON f.document_id = d.id
    LEFT JOIN recibos r ON r.document_id = d.id
    LEFT JOIN contratos c ON c.document_id = d.id
    LEFT JOIN desconocidos u ON u.document_id = d.id
    ORDER BY d.created_at DESC
    LIMIT 200
  `);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo de la petición inválido." }, { status: 400 });
  }

  const { filename, mimeType, sizeBytes, tipo, datos } = body ?? {};

  const parsed = extractResultSchema.safeParse({ tipo, datos });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Los datos no son válidos. Corrige los campos marcados en rojo antes de guardar." },
      { status: 400 }
    );
  }

  const result = parsed.data;
  const textoDocumento = buildDocumentText(result.tipo, result.datos);

  let embedding: number[];
  try {
    embedding = await getEmbedding(textoDocumento);
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo generar el embedding.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO documents (tipo, filename, mime_type, size_bytes, texto, embedding)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [
        result.tipo,
        typeof filename === "string" && filename ? filename : "documento",
        typeof mimeType === "string" && mimeType ? mimeType : "application/octet-stream",
        Number.isFinite(sizeBytes) ? Number(sizeBytes) : 0,
        textoDocumento,
        `[${embedding.join(",")}]`,
      ]
    );
    const documentId = rows[0].id as string;

    if (result.tipo === "factura") {
      const f: FacturaDatos = result.datos;
      const facturaResult = await client.query(
        `INSERT INTO facturas
           (document_id, emisor, receptor, numero_factura, fecha, fecha_vencimiento, subtotal, impuestos, total, moneda)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [
          documentId,
          f.emisor,
          f.receptor,
          f.numero_factura,
          toSqlDate(f.fecha),
          toSqlDate(f.fecha_vencimiento),
          f.subtotal,
          f.impuestos,
          f.total,
          f.moneda ?? null,
        ]
      );
      const facturaId = facturaResult.rows[0].id as string;
      for (const item of f.items) {
        await client.query(
          `INSERT INTO factura_items (factura_id, descripcion, cantidad, precio_unitario, importe)
           VALUES ($1,$2,$3,$4,$5)`,
          [facturaId, item.descripcion, item.cantidad ?? null, item.precio_unitario ?? null, item.importe]
        );
      }
    } else if (result.tipo === "recibo") {
      const r: ReciboDatos = result.datos;
      await client.query(
        `INSERT INTO recibos
           (document_id, emisor, receptor, numero_recibo, fecha, concepto, metodo_pago, total, moneda)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          documentId,
          r.emisor,
          r.receptor ?? null,
          r.numero_recibo,
          toSqlDate(r.fecha),
          r.concepto ?? null,
          r.metodo_pago ?? null,
          r.total,
          r.moneda ?? null,
        ]
      );
    } else if (result.tipo === "contrato") {
      const c: ContratoDatos = result.datos;
      const contratoResult = await client.query(
        `INSERT INTO contratos (document_id, objeto, fecha_inicio, fecha_fin, duracion, importe)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id`,
        [
          documentId,
          c.objeto,
          toSqlDate(c.fecha_inicio),
          toSqlDate(c.fecha_fin),
          c.duracion ?? null,
          c.importe ?? null,
        ]
      );
      const contratoId = contratoResult.rows[0].id as string;
      for (const parte of c.partes) {
        await client.query(`INSERT INTO contrato_partes (contrato_id, nombre) VALUES ($1,$2)`, [
          contratoId,
          parte,
        ]);
      }
      for (const clausula of c.clausulas_clave) {
        await client.query(`INSERT INTO contrato_clausulas (contrato_id, texto) VALUES ($1,$2)`, [
          contratoId,
          clausula,
        ]);
      }
    } else {
      const u: DesconocidoDatos = result.datos;
      await client.query(`INSERT INTO desconocidos (document_id, resumen) VALUES ($1,$2)`, [
        documentId,
        u.resumen,
      ]);
    }

    await client.query("COMMIT");
    return NextResponse.json({ id: documentId, createdAt: rows[0].created_at }, { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message : "No se pudo guardar el documento.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

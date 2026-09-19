/** Descripción del esquema (solo lectura) que se pasa al modelo para generar SQL. */
export const DB_SCHEMA_DESCRIPTION = `documents(id uuid, tipo text ['factura'|'recibo'|'contrato'|'desconocido'], filename text, mime_type text, size_bytes int, texto text, created_at timestamptz)
facturas(id uuid, document_id uuid -> documents.id, emisor text, receptor text, numero_factura text, fecha date, fecha_vencimiento date, subtotal numeric, impuestos numeric, total numeric, moneda text)
factura_items(id uuid, factura_id uuid -> facturas.id, descripcion text, cantidad numeric, precio_unitario numeric, importe numeric)
recibos(id uuid, document_id uuid -> documents.id, emisor text, receptor text, numero_recibo text, fecha date, concepto text, metodo_pago text, total numeric, moneda text)
contratos(id uuid, document_id uuid -> documents.id, objeto text, fecha_inicio date, fecha_fin date, duracion text, importe text)
contrato_partes(id uuid, contrato_id uuid -> contratos.id, nombre text)
contrato_clausulas(id uuid, contrato_id uuid -> contratos.id, texto text)
desconocidos(id uuid, document_id uuid -> documents.id, resumen text)`;

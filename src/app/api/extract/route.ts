import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { callOllamaChat } from "@/lib/ollama";

export const runtime = "nodejs";

const ACCEPTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL ?? "llama3.2-vision";

/** Páginas de PDF a rasterizar como imagen y enviar al modelo (documentos largos se truncan). */
const MAX_PDF_PAGES = 3;

const SYSTEM_PROMPT = `Eres un asistente OCR que analiza documentos (imágenes o páginas de PDF) y responde ÚNICAMENTE con un JSON válido, sin texto adicional ni bloques de markdown.

Primero determina el tipo de documento: "factura", "recibo", "contrato" o "desconocido" si no encaja en ninguno.

Después extrae los datos relevantes según el tipo:
- factura: emisor, receptor, numero_factura, fecha, fecha_vencimiento, items (array con descripcion, cantidad, precio_unitario, importe), subtotal, impuestos, total, moneda.
- recibo: emisor, receptor, numero_recibo, fecha, concepto, metodo_pago, total, moneda.
- contrato: partes (array), objeto, fecha_inicio, fecha_fin, duracion, importe o contraprestacion, clausulas_clave (array de strings breves).
- desconocido: incluye un campo "resumen" con una breve descripción de lo que contiene el documento.

Si un campo no aparece en el documento, usa null. Responde exactamente con este formato:

{
  "tipo": "factura" | "recibo" | "contrato" | "desconocido",
  "datos": { ... }
}`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

/** Rasteriza las primeras páginas de un PDF a PNG (base64) para poder tratarlas como imágenes. */
async function pdfToImages(buffer: Buffer): Promise<string[]> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getScreenshot({
      scale: 2,
      first: MAX_PDF_PAGES,
      imageBuffer: true,
      imageDataUrl: false,
    });
    return result.pages.map((page) => Buffer.from(page.data).toString("base64"));
  } finally {
    await parser.destroy();
  }
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });
  }

  if (!ACCEPTED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Formato no soportado. Sube una imagen o un PDF." },
      { status: 400 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const isPdf = file.type === "application/pdf";

  let images: string[];
  if (isPdf) {
    try {
      images = await pdfToImages(Buffer.from(arrayBuffer));
    } catch {
      return NextResponse.json(
        { error: "No se pudo procesar el PDF. ¿Es un PDF válido?" },
        { status: 400 }
      );
    }
    if (images.length === 0) {
      return NextResponse.json({ error: "El PDF no tiene páginas que procesar." }, { status: 400 });
    }
  } else {
    images = [Buffer.from(arrayBuffer).toString("base64")];
  }

  let text: string;
  try {
    text = await callOllamaChat(
      OLLAMA_VISION_MODEL,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: "Analiza este documento y devuelve el JSON solicitado.", images },
      ],
      { numPredict: 2048 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido al llamar al modelo.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch {
    return NextResponse.json(
      { error: "No se pudo interpretar la respuesta del modelo como JSON.", raw: text },
      { status: 502 }
    );
  }

  return NextResponse.json(parsed);
}

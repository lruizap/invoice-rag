import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
import { runReadOnlyQuery } from "@/lib/sqlGuard";
import { DB_SCHEMA_DESCRIPTION } from "@/lib/dbSchemaDescription";
import { callOllamaChat } from "@/lib/ollama";

export const runtime = "nodejs";

const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? "llama3.1";

const TOP_K = 5;

type ChatSource = {
  n: number;
  id: string | null;
  tipo: string;
  filename: string;
  titulo: string | null;
  similarity: number | null;
};

type ChatAnswer = {
  answer: string;
  sources: ChatSource[];
  mode: "sql" | "semantic";
  sql?: string;
};

function extractJsonBlock(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

const ROUTER_SYSTEM_PROMPT = `Decides cómo responder preguntas sobre documentos guardados por el usuario (facturas, recibos, contratos).

Si la pregunta implica un CÁLCULO o AGREGACIÓN sobre los datos estructurados (sumar, totalizar, promediar, contar, comparar importes, "cuánto en total", "cuántas facturas", el mayor/menor, filtros por fecha/emisor, etc.), responde ÚNICAMENTE con este JSON, sin explicaciones ni bloques de markdown:
{"modo": "sql", "sql": "<una única consulta SELECT de solo lectura en PostgreSQL>"}

Reglas para "sql":
- Solo una sentencia SELECT. Nunca INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE ni varias sentencias separadas por ";".
- Usa únicamente estas tablas y columnas (esquema de solo lectura):
${DB_SCHEMA_DESCRIPTION}
- Si el resultado depende de documentos concretos, incluye también d.filename y d.tipo (haciendo JOIN con documents) para poder citar el origen.
- Limita el resultado con LIMIT 50 o menos.

Si la pregunta es de búsqueda o consulta sobre el CONTENIDO de uno o varios documentos (no un cálculo sobre los datos estructurados), responde ÚNICAMENTE con:
{"modo": "semantic"}`;

type RouterDecision = { modo: "sql"; sql: string } | { modo: "semantic" };

async function classifyQuestion(question: string): Promise<RouterDecision> {
  try {
    const content = await callOllamaChat(
      OLLAMA_CHAT_MODEL,
      [
        { role: "system", content: ROUTER_SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
      // Algunos modelos "piensan" antes de responder y pueden agotar num_predict
      // razonando sin llegar a emitir contenido: desactivamos ese razonamiento aquí
      // (los modelos que no lo soportan simplemente ignoran el campo).
      { numPredict: 800, think: false }
    );
    const parsed = extractJsonBlock(content) as { modo?: string; sql?: string };
    if (parsed?.modo === "sql" && typeof parsed.sql === "string" && parsed.sql.trim()) {
      return { modo: "sql", sql: parsed.sql };
    }
    return { modo: "semantic" };
  } catch {
    return { modo: "semantic" };
  }
}

function extractSourcesFromRows(rows: Record<string, unknown>[]): ChatSource[] {
  const seen = new Map<string, ChatSource>();
  let n = 1;
  for (const row of rows) {
    const filename = typeof row.filename === "string" ? row.filename : null;
    if (!filename) continue;
    if (seen.has(filename)) continue;
    seen.set(filename, {
      n: n++,
      id: typeof row.document_id === "string" ? row.document_id : null,
      tipo: typeof row.tipo === "string" ? row.tipo : "desconocido",
      filename,
      titulo: typeof row.titulo === "string" ? row.titulo : null,
      similarity: null,
    });
  }
  return [...seen.values()];
}

const SQL_ANSWER_SYSTEM_PROMPT = `Responde la pregunta del usuario en español, de forma clara y concisa, basándote EXCLUSIVAMENTE en el resultado de esta consulta SQL ejecutada sobre sus documentos guardados.
- Si el resultado está vacío, dilo explícitamente; no inventes datos.
- Si las filas incluyen "filename" o "tipo", menciona los documentos de origen.`;

async function runSqlMode(question: string, sql: string): Promise<ChatAnswer> {
  const rows = await runReadOnlyQuery(sql);
  const sources = extractSourcesFromRows(rows);
  const answer = await callOllamaChat(
    OLLAMA_CHAT_MODEL,
    [
      { role: "system", content: SQL_ANSWER_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Pregunta: ${question}\n\nResultado de la consulta SQL (JSON): ${JSON.stringify(rows)}`,
      },
    ],
    { numPredict: 1200 }
  );
  return { answer, sources, mode: "sql", sql };
}

type SemanticSourceDoc = {
  id: string;
  tipo: string;
  filename: string;
  titulo: string | null;
  texto: string;
  similarity: number;
};

function buildSemanticContext(docs: SemanticSourceDoc[]): string {
  return docs
    .map(
      (doc, i) =>
        `[Documento ${i + 1}] tipo: ${doc.tipo} · archivo: ${doc.filename}${
          doc.titulo ? ` · referencia: ${doc.titulo}` : ""
        }\n${doc.texto}`
    )
    .join("\n\n---\n\n");
}

const SEMANTIC_SYSTEM_PROMPT = `Eres un asistente que responde preguntas basándose ÚNICAMENTE en los documentos guardados que se te proporcionan a continuación.
Reglas:
- Si la respuesta no está en los documentos proporcionados, dilo explícitamente; no inventes datos.
- Cada vez que uses un dato de un documento, cita su origen con el formato [Documento N], donde N es el número indicado junto a ese documento.
- Sé conciso y responde en español.`;

async function runSemanticMode(question: string): Promise<ChatAnswer> {
  const questionEmbedding = await getEmbedding(question);

  const { rows } = await pool.query(
    `SELECT
       d.id,
       d.tipo,
       d.filename,
       COALESCE(f.numero_factura, r.numero_recibo, c.objeto, u.resumen) AS titulo,
       d.texto,
       1 - (d.embedding <=> $1) AS similarity
     FROM documents d
     LEFT JOIN facturas f ON f.document_id = d.id
     LEFT JOIN recibos r ON r.document_id = d.id
     LEFT JOIN contratos c ON c.document_id = d.id
     LEFT JOIN desconocidos u ON u.document_id = d.id
     WHERE d.embedding IS NOT NULL
     ORDER BY d.embedding <=> $1
     LIMIT $2`,
    [`[${questionEmbedding.join(",")}]`, TOP_K]
  );

  const docs: SemanticSourceDoc[] = rows.map((r) => ({
    id: r.id,
    tipo: r.tipo,
    filename: r.filename,
    titulo: r.titulo,
    texto: r.texto,
    similarity: Number(r.similarity),
  }));

  if (docs.length === 0) {
    return {
      answer:
        "Todavía no hay documentos guardados. Sube y confirma al menos uno para poder responder preguntas sobre él.",
      sources: [],
      mode: "semantic",
    };
  }

  const answer = await callOllamaChat(
    OLLAMA_CHAT_MODEL,
    [
      { role: "system", content: SEMANTIC_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Documentos:\n\n${buildSemanticContext(docs)}\n\nPregunta: ${question}`,
      },
    ],
    { numPredict: 1536 }
  );

  return {
    answer,
    mode: "semantic",
    sources: docs.map((d, i) => ({
      n: i + 1,
      id: d.id,
      tipo: d.tipo,
      filename: d.filename,
      titulo: d.titulo,
      similarity: d.similarity,
    })),
  };
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo de la petición inválido." }, { status: 400 });
  }

  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "Escribe una pregunta." }, { status: 400 });
  }

  try {
    const decision = await classifyQuestion(question);

    if (decision.modo === "sql") {
      try {
        const result = await runSqlMode(question, decision.sql);
        return NextResponse.json(result);
      } catch {
        // La consulta generada no era segura o falló al ejecutarse: recurrimos a
        // la búsqueda semántica en lugar de devolver un error al usuario.
      }
    }

    const result = await runSemanticMode(question);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido al llamar al modelo.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

# Extracto

[![Tests](https://github.com/lruizap/invoice-rag/actions/workflows/test.yml/badge.svg)](https://github.com/lruizap/invoice-rag/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Ollama](https://img.shields.io/badge/Ollama-local%20LLM-000000?logo=ollama&logoColor=white)](https://ollama.com)
[![pgvector](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)

App Next.js que permite:

1. Subir una imagen o un PDF y previsualizarlo.
2. Enviarlo a un modelo local con visión (vía [Ollama](https://ollama.com), corriendo en tu máquina) que detecta si es una **factura**, **recibo** o **contrato** y extrae sus datos. Los PDF se rasterizan página a página y se procesan como imágenes, con OCR real por visión (no solo texto embebido).
3. Editar esos datos en un formulario (documento a la izquierda, datos a la derecha), validado con **Zod**: fechas, campos obligatorios y que `subtotal + impuestos = total` en las facturas. Los campos inválidos se marcan en rojo.
4. Al confirmar, guardar los datos estructurados en tablas de **PostgreSQL** y el texto del documento como **embedding en pgvector**.
5. Consultar la **lista de documentos guardados**.
6. Preguntar en un **chat**: si la pregunta implica un cálculo o total (sumar, contar, comparar...), genera y ejecuta una **consulta SQL de solo lectura** sobre las tablas estructuradas; si es una pregunta sobre el contenido de los documentos, usa **búsqueda semántica por embeddings** y cita el documento de origen.

Todo el procesamiento con IA (visión, embeddings, chat) corre **localmente con Ollama** — no se envían documentos ni preguntas a ningún servicio externo, ni hace falta ninguna API key.

## Requisitos

- Node.js 20+
- Docker Desktop (para la base de datos)
- [Ollama](https://ollama.com) instalado y corriendo (`ollama serve`, o el propio instalador ya lo deja como servicio) con estos modelos descargados:

  ```bash
  ollama pull llama3.2-vision   # extracción con visión (imágenes y páginas de PDF)
  ollama pull nomic-embed-text  # embeddings (768 dims)
  ollama pull llama3.1          # chat: router SQL/semántico y redacción de respuestas
  ```

## Puesta en marcha

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Copia el archivo de entorno:

   ```bash
   cp .env.local.example .env.local
   ```

   Por defecto apunta a `http://localhost:11434` con los modelos de arriba. Si usas otros modelos o Ollama en otra máquina/puerto, ajusta `OLLAMA_BASE_URL`, `OLLAMA_VISION_MODEL`, `OLLAMA_EMBEDDING_MODEL` y `OLLAMA_CHAT_MODEL` en `.env.local`.

   > **Si cambias `OLLAMA_EMBEDDING_MODEL`** por uno con una dimensión distinta a 768, actualiza también `VECTOR(768)` en `db/init.sql` (y recrea el volumen de Docker, ver más abajo).

3. Levanta PostgreSQL con pgvector:

   ```bash
   docker compose up -d
   ```

   Esto crea la base de datos `extracto`, habilita la extensión `vector` y crea las tablas descritas en `db/init.sql`.

   > Si ya tenías el contenedor levantado de una versión anterior de este proyecto (con otro esquema, p. ej. `VECTOR(1536)` de una configuración previa con OpenRouter), recréalo con `docker compose down -v && docker compose up -d` para que se aplique el esquema nuevo — `init.sql` solo se ejecuta en un volumen vacío.

4. Arranca el servidor de desarrollo:

   ```bash
   npm run dev
   ```

5. Abre [http://localhost:3000](http://localhost:3000).

## Tests

```bash
npm test
```

Usa [Vitest](https://vitest.dev) para probar, sin necesidad de Docker ni de Ollama corriendo (se mockean `fetch`, `pdf-parse`, la base de datos y los embeddings):

- Los esquemas de Zod: fechas válidas/inválidas, campos obligatorios ausentes, `subtotal + impuestos = total`, por cada tipo de documento.
- `src/lib/ollama.test.ts` / `embeddings.test.ts`: formato de las peticiones a Ollama, errores de conexión, respuestas sin contenido.
- `/api/extract`: sin archivo, tipo no soportado, imagen exitosa, PDF exitoso (rasterizado a imágenes), PDF con datos incompletos (el modelo devuelve pocos campos y la ruta los reenvía tal cual — la validación es responsabilidad del cliente), Ollama no disponible, JSON malformado.
- `/api/documents`: guardado válido de cada tipo (factura con líneas, recibo, contrato con partes/cláusulas, desconocido), rechazo de datos incompletos antes de tocar la base de datos, rollback si falla una inserción, fallo al generar el embedding.
- `/api/chat`: router SQL vs. semántico, ejecución de SQL generado por el modelo con citas de origen, caída a búsqueda semántica si la SQL falla o no es segura, sin documentos guardados, errores del modelo.
- `src/lib/sqlGuard.test.ts`: valida y ejecuta de forma segura el SQL generado por el modelo (solo `SELECT`, transacción `READ ONLY`, timeout, `LIMIT`).

## Estructura relevante

- `src/app/page.tsx` — página principal (renderiza `ExtractoApp`).
- `src/components/ExtractoApp.tsx` — orquesta subida, lista de documentos y chat.
- `src/components/UploadArea.tsx` — subir/previsualizar archivo, botón "Extraer datos" y "Confirmar y guardar" (deshabilitado si hay campos inválidos).
- `src/components/ExtractedDataPanel.tsx` — formulario editable de los datos extraídos (documento a la izquierda vía `UploadArea`, datos a la derecha), con campos en rojo cuando son inválidos.
- `src/components/DocumentList.tsx` — lista de documentos guardados.
- `src/components/ChatPanel.tsx` — chat con router SQL/semántico y citas de origen (muestra la SQL generada cuando aplica).
- `src/lib/schemas.ts` — esquemas Zod por tipo de documento (factura/recibo/contrato/desconocido), validación de fechas y de `subtotal + impuestos = total`.
- `src/lib/documents.ts` — helpers para guardar (fechas a formato SQL, texto del documento para el embedding).
- `src/lib/ollama.ts` — cliente mínimo para `POST /api/chat` de Ollama, compartido por extracción y chat.
- `src/lib/embeddings.ts` — genera embeddings vía `POST /api/embed` de Ollama (`nomic-embed-text`, 768 dims).
- `src/lib/sqlGuard.ts` — valida y ejecuta de forma segura el SQL generado por el modelo (solo `SELECT`, transacción `READ ONLY`, timeout, `LIMIT`).
- `src/lib/dbSchemaDescription.ts` — descripción del esquema que se le da al modelo para generar SQL.
- `src/app/api/extract/route.ts` — rasteriza los PDF a imágenes (`pdf-parse`), envía imagen(es) a Ollama (modelo con visión) y devuelve el JSON clasificado.
- `src/app/api/documents/route.ts` — `POST` valida con Zod, genera el embedding y guarda en `documents` + la tabla del tipo correspondiente dentro de una transacción; `GET` lista los documentos guardados.
- `src/app/api/chat/route.ts` — decide con el modelo si la pregunta necesita SQL o búsqueda semántica; en modo SQL ejecuta la consulta (solo lectura) y cita los documentos involucrados; en modo semántico busca por distancia coseno (pgvector) y cita `[Documento N]`.
- `src/lib/db.ts` — pool de conexión a PostgreSQL (`pg`).
- `docker-compose.yml` — servicio `pgvector/pgvector:pg16`.
- `db/init.sql` — extensión `vector`, tabla `documents` (con `embedding VECTOR(768)` e índice `hnsw`) y tablas `facturas`/`factura_items`, `recibos`, `contratos`/`contrato_partes`/`contrato_clausulas`, `desconocidos`.

## Licencia

[MIT](LICENSE)

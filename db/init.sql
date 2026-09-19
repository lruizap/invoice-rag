CREATE EXTENSION IF NOT EXISTS vector;

-- Un registro por documento subido: metadatos + representación de texto + embedding.
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo TEXT NOT NULL CHECK (tipo IN ('factura', 'recibo', 'contrato', 'desconocido')),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    texto TEXT NOT NULL,
    -- 768 dims = modelo de embeddings por defecto de Ollama (nomic-embed-text).
    -- Si cambias OLLAMA_EMBEDDING_MODEL por uno con otra dimensión, actualiza esto.
    embedding VECTOR(768),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_embedding_idx
    ON documents USING hnsw (embedding vector_cosine_ops);

-- Datos estructurados por tipo de documento (1:1 con documents).

CREATE TABLE IF NOT EXISTS facturas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    emisor TEXT NOT NULL,
    receptor TEXT NOT NULL,
    numero_factura TEXT NOT NULL,
    fecha DATE NOT NULL,
    fecha_vencimiento DATE,
    subtotal NUMERIC(14, 2) NOT NULL,
    impuestos NUMERIC(14, 2) NOT NULL,
    total NUMERIC(14, 2) NOT NULL,
    moneda TEXT
);

CREATE TABLE IF NOT EXISTS factura_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factura_id UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL,
    cantidad NUMERIC(14, 2),
    precio_unitario NUMERIC(14, 2),
    importe NUMERIC(14, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS recibos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    emisor TEXT NOT NULL,
    receptor TEXT,
    numero_recibo TEXT NOT NULL,
    fecha DATE NOT NULL,
    concepto TEXT,
    metodo_pago TEXT,
    total NUMERIC(14, 2) NOT NULL,
    moneda TEXT
);

CREATE TABLE IF NOT EXISTS contratos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    objeto TEXT NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE,
    duracion TEXT,
    importe TEXT
);

CREATE TABLE IF NOT EXISTS contrato_partes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contrato_id UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contrato_clausulas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contrato_id UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    texto TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS desconocidos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    resumen TEXT NOT NULL
);

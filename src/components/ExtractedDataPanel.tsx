"use client";

import type { DocumentType } from "@/lib/schemas";

type Datos = Record<string, unknown>;

type Props = {
  tipo: DocumentType;
  datos: Datos;
  errors: Record<string, string>;
  isValid: boolean;
  onChange: (datos: Datos) => void;
};

const TIPO_LABEL: Record<DocumentType, string> = {
  factura: "Factura",
  recibo: "Recibo",
  contrato: "Contrato",
  desconocido: "Desconocido",
};

type FieldKind = "text" | "textarea" | "number" | "date";

type FieldConfig = { name: string; label: string; kind: FieldKind };

const FACTURA_FIELDS: FieldConfig[] = [
  { name: "emisor", label: "Emisor", kind: "text" },
  { name: "receptor", label: "Receptor", kind: "text" },
  { name: "numero_factura", label: "Número de factura", kind: "text" },
  { name: "fecha", label: "Fecha", kind: "date" },
  { name: "fecha_vencimiento", label: "Fecha de vencimiento", kind: "date" },
  { name: "subtotal", label: "Subtotal", kind: "number" },
  { name: "impuestos", label: "Impuestos", kind: "number" },
  { name: "total", label: "Total", kind: "number" },
  { name: "moneda", label: "Moneda", kind: "text" },
];

const RECIBO_FIELDS: FieldConfig[] = [
  { name: "emisor", label: "Emisor", kind: "text" },
  { name: "receptor", label: "Receptor", kind: "text" },
  { name: "numero_recibo", label: "Número de recibo", kind: "text" },
  { name: "fecha", label: "Fecha", kind: "date" },
  { name: "concepto", label: "Concepto", kind: "text" },
  { name: "metodo_pago", label: "Método de pago", kind: "text" },
  { name: "total", label: "Total", kind: "number" },
  { name: "moneda", label: "Moneda", kind: "text" },
];

const CONTRATO_FIELDS: FieldConfig[] = [
  { name: "objeto", label: "Objeto del contrato", kind: "textarea" },
  { name: "fecha_inicio", label: "Fecha de inicio", kind: "date" },
  { name: "fecha_fin", label: "Fecha de fin", kind: "date" },
  { name: "duracion", label: "Duración", kind: "text" },
  { name: "importe", label: "Importe / contraprestación", kind: "text" },
];

const DESCONOCIDO_FIELDS: FieldConfig[] = [{ name: "resumen", label: "Resumen", kind: "textarea" }];

function setKey(datos: Datos, key: string, value: unknown): Datos {
  return { ...datos, [key]: value };
}

function fieldInputValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function inputClass(hasError: boolean) {
  return `rounded-lg border bg-transparent px-3 py-1.5 text-sm outline-none transition-colors ${
    hasError
      ? "border-red-500 text-red-600 focus:border-red-500"
      : "border-foreground/20 focus:border-foreground/50"
  }`;
}

function Field({
  config,
  value,
  error,
  onChange,
}: {
  config: FieldConfig;
  value: unknown;
  error?: string;
  onChange: (value: string) => void;
}) {
  const strValue = fieldInputValue(value);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium opacity-70">{config.label}</span>
      {config.kind === "textarea" ? (
        <textarea
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={inputClass(!!error)}
        />
      ) : (
        <input
          type={config.kind === "number" ? "text" : "text"}
          inputMode={config.kind === "number" ? "decimal" : undefined}
          placeholder={config.kind === "date" ? "DD/MM/AAAA" : undefined}
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass(!!error)}
        />
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </label>
  );
}

function ListField({
  label,
  values,
  errors,
  groupError,
  onChange,
}: {
  label: string;
  values: string[];
  errors: (string | undefined)[];
  groupError?: string;
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium opacity-70">{label}</span>
      {groupError && <p className="text-xs text-red-500">{groupError}</p>}
      {values.length === 0 && (
        <p className="text-xs opacity-50">Sin elementos. Añade uno abajo.</p>
      )}
      {values.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">
            <input
              type="text"
              value={v}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
              className={inputClass(!!errors[i]) + " w-full"}
            />
            {errors[i] && <span className="text-xs text-red-500">{errors[i]}</span>}
          </div>
          <button
            type="button"
            onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            className="mt-1 shrink-0 rounded-full border border-foreground/20 px-2 py-0.5 text-xs hover:bg-foreground/5"
          >
            Quitar
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ""])}
        className="self-start rounded-full border border-foreground/20 px-3 py-1 text-xs hover:bg-foreground/5"
      >
        + Añadir
      </button>
    </div>
  );
}

type FacturaItem = {
  descripcion?: unknown;
  cantidad?: unknown;
  precio_unitario?: unknown;
  importe?: unknown;
};

function ItemsField({
  items,
  errors,
  onChange,
}: {
  items: FacturaItem[];
  errors: Record<string, string>;
  onChange: (items: FacturaItem[]) => void;
}) {
  const updateItem = (i: number, key: keyof FacturaItem, value: string) => {
    const next = items.map((item, idx) => (idx === i ? { ...item, [key]: value } : item));
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium opacity-70">Líneas</span>
      {items.length === 0 && (
        <p className="text-xs opacity-50">Sin líneas. Añade una abajo.</p>
      )}
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border border-foreground/10 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] opacity-60">Descripción</span>
              <input
                type="text"
                value={fieldInputValue(item.descripcion)}
                onChange={(e) => updateItem(i, "descripcion", e.target.value)}
                className={inputClass(!!errors[`items.${i}.descripcion`])}
              />
              {errors[`items.${i}.descripcion`] && (
                <span className="text-xs text-red-500">{errors[`items.${i}.descripcion`]}</span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] opacity-60">Importe</span>
              <input
                type="text"
                inputMode="decimal"
                value={fieldInputValue(item.importe)}
                onChange={(e) => updateItem(i, "importe", e.target.value)}
                className={inputClass(!!errors[`items.${i}.importe`])}
              />
              {errors[`items.${i}.importe`] && (
                <span className="text-xs text-red-500">{errors[`items.${i}.importe`]}</span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] opacity-60">Cantidad</span>
              <input
                type="text"
                inputMode="decimal"
                value={fieldInputValue(item.cantidad)}
                onChange={(e) => updateItem(i, "cantidad", e.target.value)}
                className={inputClass(!!errors[`items.${i}.cantidad`])}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] opacity-60">Precio unitario</span>
              <input
                type="text"
                inputMode="decimal"
                value={fieldInputValue(item.precio_unitario)}
                onChange={(e) => updateItem(i, "precio_unitario", e.target.value)}
                className={inputClass(!!errors[`items.${i}.precio_unitario`])}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            className="self-start rounded-full border border-foreground/20 px-2 py-0.5 text-xs hover:bg-foreground/5"
          >
            Quitar línea
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...items, { descripcion: "", cantidad: "", precio_unitario: "", importe: "" }])
        }
        className="self-start rounded-full border border-foreground/20 px-3 py-1 text-xs hover:bg-foreground/5"
      >
        + Añadir línea
      </button>
    </div>
  );
}

export default function ExtractedDataPanel({ tipo, datos, errors, isValid, onChange }: Props) {
  const setField = (name: string, value: string) => onChange(setKey(datos, name, value));

  const fields =
    tipo === "factura"
      ? FACTURA_FIELDS
      : tipo === "recibo"
        ? RECIBO_FIELDS
        : tipo === "contrato"
          ? CONTRATO_FIELDS
          : DESCONOCIDO_FIELDS;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-foreground/10 p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm opacity-60">Tipo detectado:</span>
        <span className="rounded-full bg-foreground/10 px-3 py-1 text-sm font-medium">
          {TIPO_LABEL[tipo]}
        </span>
        <span
          className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ${
            isValid
              ? "bg-green-500/10 text-green-600"
              : "bg-red-500/10 text-red-600"
          }`}
        >
          {isValid ? "Datos válidos" : `${Object.keys(errors).length} campo(s) con error`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.name} className={f.kind === "textarea" ? "sm:col-span-2" : undefined}>
            <Field
              config={f}
              value={datos[f.name]}
              error={errors[f.name]}
              onChange={(v) => setField(f.name, v)}
            />
          </div>
        ))}
      </div>

      {tipo === "factura" && (
        <ItemsField
          items={Array.isArray(datos.items) ? (datos.items as FacturaItem[]) : []}
          errors={errors}
          onChange={(items) => onChange(setKey(datos, "items", items))}
        />
      )}

      {tipo === "contrato" && (
        <>
          <ListField
            label="Partes"
            values={Array.isArray(datos.partes) ? (datos.partes as string[]) : []}
            errors={
              Array.isArray(datos.partes)
                ? (datos.partes as string[]).map((_, i) => errors[`partes.${i}`])
                : []
            }
            groupError={errors.partes}
            onChange={(values) => onChange(setKey(datos, "partes", values))}
          />
          <ListField
            label="Cláusulas clave"
            values={Array.isArray(datos.clausulas_clave) ? (datos.clausulas_clave as string[]) : []}
            errors={
              Array.isArray(datos.clausulas_clave)
                ? (datos.clausulas_clave as string[]).map((_, i) => errors[`clausulas_clave.${i}`])
                : []
            }
            onChange={(values) => onChange(setKey(datos, "clausulas_clave", values))}
          />
        </>
      )}
    </div>
  );
}

import { z } from "zod";

/** Acepta "YYYY-MM-DD", "DD/MM/YYYY" o "DD-MM-YYYY" y valida que la fecha exista de verdad. */
export function parseFlexibleDate(raw: string): Date | null {
  const value = raw.trim();
  let y: number | undefined;
  let m: number | undefined;
  let d: number | undefined;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else {
    const eu = value.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (eu) {
      d = Number(eu[1]);
      m = Number(eu[2]);
      y = Number(eu[3]);
    }
  }

  if (y === undefined || m === undefined || d === undefined) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const date = new Date(Date.UTC(y, m - 1, d));
  const valid =
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return valid ? date : null;
}

export function isValidDateString(value: string): boolean {
  return parseFlexibleDate(value) !== null;
}

const nullish = z.union([z.string(), z.number(), z.null(), z.undefined()]);

const requiredString = (message: string) =>
  nullish
    .transform((v) => (v === null || v === undefined ? "" : String(v).trim()))
    .refine((v) => v.length > 0, message);

// El .optional() final es necesario para que Zod v4 acepte la clave totalmente
// ausente del objeto (no basta con que el `union` interno incluya z.undefined()).
const optionalString = nullish
  .transform((v) => {
    const t = v === null || v === undefined ? "" : String(v).trim();
    return t.length > 0 ? t : null;
  })
  .optional();

const requiredDate = (message: string) =>
  requiredString(message).refine(
    (v) => v.length === 0 || isValidDateString(v),
    "Fecha inválida (usa DD/MM/AAAA o AAAA-MM-DD)"
  );

const optionalDate = optionalString.refine(
  (v) => v === null || v === undefined || isValidDateString(v),
  "Fecha inválida (usa DD/MM/AAAA o AAAA-MM-DD)"
);

/** Interpreta números tanto en formato "1234.56" como "1234,56" o "1.234,56". */
const toNumber = (v: string | number): number => {
  if (typeof v === "number") return v;
  const trimmed = v.trim();
  if (trimmed === "") return NaN;
  const hasComma = trimmed.includes(",");
  const hasDot = trimmed.includes(".");
  let normalized = trimmed;
  if (hasComma && hasDot) {
    normalized = trimmed.replace(/,/g, "");
  } else if (hasComma && !hasDot) {
    normalized = trimmed.replace(",", ".");
  }
  return Number(normalized);
};

const requiredNumber = (message: string) =>
  nullish
    .transform((v) => (v === null || v === undefined || v === "" ? NaN : toNumber(v)))
    .refine((v) => Number.isFinite(v), message);

const optionalNumber = nullish
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = toNumber(v);
    return Number.isFinite(n) ? n : null;
  })
  .optional();

const AMOUNT_TOLERANCE = 0.01;

const facturaItemSchema = z.object({
  descripcion: requiredString("La descripción es obligatoria"),
  cantidad: optionalNumber,
  precio_unitario: optionalNumber,
  importe: requiredNumber("El importe es obligatorio"),
});

export const facturaDatosSchema = z
  .object({
    emisor: requiredString("El emisor es obligatorio"),
    receptor: requiredString("El receptor es obligatorio"),
    numero_factura: requiredString("El número de factura es obligatorio"),
    fecha: requiredDate("La fecha es obligatoria"),
    fecha_vencimiento: optionalDate,
    items: z.array(facturaItemSchema).default([]),
    subtotal: requiredNumber("El subtotal es obligatorio"),
    impuestos: requiredNumber("Los impuestos son obligatorios"),
    total: requiredNumber("El total es obligatorio"),
    moneda: optionalString,
  })
  .superRefine((data, ctx) => {
    if (
      Number.isFinite(data.subtotal) &&
      Number.isFinite(data.impuestos) &&
      Number.isFinite(data.total)
    ) {
      const expected = data.subtotal + data.impuestos;
      if (Math.abs(expected - data.total) > AMOUNT_TOLERANCE) {
        ctx.addIssue({
          code: "custom",
          message: `Subtotal + impuestos (${expected.toFixed(2)}) no coincide con el total (${data.total.toFixed(2)})`,
          path: ["total"],
        });
      }
    }
  });

export const reciboDatosSchema = z.object({
  emisor: requiredString("El emisor es obligatorio"),
  receptor: optionalString,
  numero_recibo: requiredString("El número de recibo es obligatorio"),
  fecha: requiredDate("La fecha es obligatoria"),
  concepto: optionalString,
  metodo_pago: optionalString,
  total: requiredNumber("El total es obligatorio"),
  moneda: optionalString,
});

export const contratoDatosSchema = z.object({
  partes: z
    .array(requiredString("El nombre de la parte no puede estar vacío"))
    .min(1, "Debe indicar al menos una parte del contrato"),
  objeto: requiredString("El objeto del contrato es obligatorio"),
  fecha_inicio: requiredDate("La fecha de inicio es obligatoria"),
  fecha_fin: optionalDate,
  duracion: optionalString,
  importe: optionalString,
  clausulas_clave: z.array(z.string()).default([]),
});

export const desconocidoDatosSchema = z.object({
  resumen: requiredString("El resumen es obligatorio"),
});

export const extractResultSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("factura"), datos: facturaDatosSchema }),
  z.object({ tipo: z.literal("recibo"), datos: reciboDatosSchema }),
  z.object({ tipo: z.literal("contrato"), datos: contratoDatosSchema }),
  z.object({ tipo: z.literal("desconocido"), datos: desconocidoDatosSchema }),
]);

export type DocumentType = z.infer<typeof extractResultSchema>["tipo"];
export type ExtractResult = z.infer<typeof extractResultSchema>;
export type FacturaDatos = z.infer<typeof facturaDatosSchema>;
export type ReciboDatos = z.infer<typeof reciboDatosSchema>;
export type ContratoDatos = z.infer<typeof contratoDatosSchema>;
export type DesconocidoDatos = z.infer<typeof desconocidoDatosSchema>;

export const DATOS_SCHEMA_BY_TIPO = {
  factura: facturaDatosSchema,
  recibo: reciboDatosSchema,
  contrato: contratoDatosSchema,
  desconocido: desconocidoDatosSchema,
} as const;

/** Convierte los issues de un safeParse fallido en un mapa { "ruta.dentro.de.datos": mensaje }. */
export function buildFieldErrors(
  result: ReturnType<typeof extractResultSchema.safeParse>
): Record<string, string> {
  if (result.success) return {};
  const map: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path =
      issue.path[0] === "datos" ? issue.path.slice(1).join(".") : issue.path.join(".");
    if (path && !(path in map)) map[path] = issue.message;
  }
  return map;
}

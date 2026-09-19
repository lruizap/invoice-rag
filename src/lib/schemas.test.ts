import { describe, expect, it } from "vitest";
import {
  buildFieldErrors,
  contratoDatosSchema,
  desconocidoDatosSchema,
  extractResultSchema,
  facturaDatosSchema,
  isValidDateString,
  reciboDatosSchema,
} from "./schemas";

describe("isValidDateString", () => {
  it("acepta fechas ISO válidas", () => {
    expect(isValidDateString("2026-09-15")).toBe(true);
  });

  it("acepta fechas DD/MM/AAAA válidas", () => {
    expect(isValidDateString("15/09/2026")).toBe(true);
  });

  it("acepta fechas DD-MM-AAAA válidas", () => {
    expect(isValidDateString("15-09-2026")).toBe(true);
  });

  it("rechaza un mes inválido", () => {
    expect(isValidDateString("15/13/2026")).toBe(false);
  });

  it("rechaza un día inexistente (31 de febrero)", () => {
    expect(isValidDateString("31/02/2026")).toBe(false);
  });

  it("rechaza texto que no es una fecha", () => {
    expect(isValidDateString("no es una fecha")).toBe(false);
  });

  it("rechaza cadenas vacías", () => {
    expect(isValidDateString("")).toBe(false);
  });
});

describe("facturaDatosSchema", () => {
  const facturaCompleta = {
    emisor: "Panadería El Trigo S.L.",
    receptor: "Comercial Ibaizabal S.A.",
    numero_factura: "F-2026-0042",
    fecha: "15/09/2026",
    fecha_vencimiento: "30/09/2026",
    items: [{ descripcion: "Pan integral x50", cantidad: 50, precio_unitario: 1.2, importe: 60 }],
    subtotal: 110,
    impuestos: 11,
    total: 121,
    moneda: "EUR",
  };

  it("acepta una factura completa y coherente (PDF exitoso)", () => {
    const result = facturaDatosSchema.safeParse(facturaCompleta);
    expect(result.success).toBe(true);
  });

  it("interpreta números con coma decimal ('1,20') igual que con punto", () => {
    const result = facturaDatosSchema.safeParse({
      ...facturaCompleta,
      subtotal: "110,00",
      impuestos: "11,00",
      total: "121,00",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtotal).toBe(110);
      expect(result.data.total).toBe(121);
    }
  });

  it("no confunde '1.20' (decimal) con miles al validar importes de línea", () => {
    const result = facturaDatosSchema.safeParse(facturaCompleta);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].precio_unitario).toBeCloseTo(1.2);
    }
  });

  it("rechaza una factura incompleta: falta el emisor", () => {
    const { emisor: _emisor, ...incompleta } = facturaCompleta;
    const result = facturaDatosSchema.safeParse(incompleta);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("emisor");
    }
  });

  it("rechaza una factura incompleta: campos obligatorios en null (típico de un PDF mal escaneado)", () => {
    const result = facturaDatosSchema.safeParse({
      ...facturaCompleta,
      numero_factura: null,
      total: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("numero_factura");
      expect(paths).toContain("total");
    }
  });

  it("rechaza una fecha inválida", () => {
    const result = facturaDatosSchema.safeParse({ ...facturaCompleta, fecha: "31/02/2026" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "fecha");
      expect(issue?.message).toMatch(/Fecha inválida/);
    }
  });

  it("rechaza cuando subtotal + impuestos no coincide con el total", () => {
    const result = facturaDatosSchema.safeParse({ ...facturaCompleta, total: 999 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "total");
      expect(issue?.message).toMatch(/no coincide con el total/);
    }
  });

  it("acepta pequeñas diferencias de redondeo (<= 1 céntimo)", () => {
    const result = facturaDatosSchema.safeParse({ ...facturaCompleta, total: 121.005 });
    expect(result.success).toBe(true);
  });

  it("rechaza una línea de factura sin importe", () => {
    const result = facturaDatosSchema.safeParse({
      ...facturaCompleta,
      items: [{ descripcion: "Pan integral x50" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("items.0.importe");
    }
  });

  it("acepta una lista de items vacía", () => {
    const result = facturaDatosSchema.safeParse({ ...facturaCompleta, items: [] });
    expect(result.success).toBe(true);
  });
});

describe("reciboDatosSchema", () => {
  const reciboCompleto = {
    emisor: "Taller Mecánico Zubieta S.L.",
    receptor: "Jon Etxeberria",
    numero_recibo: "R-2026-0091",
    fecha: "18/09/2026",
    concepto: "Revisión y cambio de aceite",
    metodo_pago: "Tarjeta",
    total: 85.5,
    moneda: "EUR",
  };

  it("acepta un recibo completo (imagen exitosa)", () => {
    expect(reciboDatosSchema.safeParse(reciboCompleto).success).toBe(true);
  });

  it("rechaza un recibo sin número de recibo ni total (recibo incompleto)", () => {
    const result = reciboDatosSchema.safeParse({
      ...reciboCompleto,
      numero_recibo: "",
      total: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("numero_recibo");
      expect(paths).toContain("total");
    }
  });

  it("permite receptor, concepto y método de pago ausentes", () => {
    const result = reciboDatosSchema.safeParse({
      emisor: reciboCompleto.emisor,
      numero_recibo: reciboCompleto.numero_recibo,
      fecha: reciboCompleto.fecha,
      total: reciboCompleto.total,
      receptor: null,
      concepto: null,
      metodo_pago: null,
      moneda: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("contratoDatosSchema", () => {
  const contratoCompleto = {
    partes: ["Empresa A S.L.", "Empresa B S.A."],
    objeto: "Prestación de servicios de consultoría",
    fecha_inicio: "01/01/2026",
    fecha_fin: "31/12/2026",
    duracion: "12 meses",
    importe: "2.000 EUR/mes",
    clausulas_clave: ["Confidencialidad", "Exclusividad"],
  };

  it("acepta un contrato completo (PDF exitoso)", () => {
    expect(contratoDatosSchema.safeParse(contratoCompleto).success).toBe(true);
  });

  it("rechaza un contrato sin partes (lista vacía)", () => {
    const result = contratoDatosSchema.safeParse({ ...contratoCompleto, partes: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "partes");
      expect(issue?.message).toMatch(/al menos una parte/);
    }
  });

  it("rechaza un contrato incompleto: falta el objeto y la fecha de inicio", () => {
    const result = contratoDatosSchema.safeParse({
      ...contratoCompleto,
      objeto: "",
      fecha_inicio: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("objeto");
      expect(paths).toContain("fecha_inicio");
    }
  });

  it("permite fecha_fin, duración e importe ausentes", () => {
    const result = contratoDatosSchema.safeParse({
      partes: contratoCompleto.partes,
      objeto: contratoCompleto.objeto,
      fecha_inicio: contratoCompleto.fecha_inicio,
      fecha_fin: null,
      duracion: null,
      importe: null,
      clausulas_clave: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("desconocidoDatosSchema", () => {
  it("acepta un resumen no vacío", () => {
    expect(desconocidoDatosSchema.safeParse({ resumen: "Ticket de aparcamiento" }).success).toBe(
      true
    );
  });

  it("rechaza un resumen vacío", () => {
    const result = desconocidoDatosSchema.safeParse({ resumen: "" });
    expect(result.success).toBe(false);
  });
});

describe("extractResultSchema (unión completa)", () => {
  it("valida el documento correcto según su tipo (factura)", () => {
    const result = extractResultSchema.safeParse({
      tipo: "factura",
      datos: {
        emisor: "A",
        receptor: "B",
        numero_factura: "1",
        fecha: "01/01/2026",
        subtotal: 100,
        impuestos: 21,
        total: 121,
        items: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rechaza un tipo de documento no reconocido", () => {
    const result = extractResultSchema.safeParse({ tipo: "otra_cosa", datos: {} });
    expect(result.success).toBe(false);
  });
});

describe("buildFieldErrors", () => {
  it("devuelve un mapa vacío cuando la validación tiene éxito", () => {
    const result = extractResultSchema.safeParse({
      tipo: "desconocido",
      datos: { resumen: "algo" },
    });
    expect(buildFieldErrors(result)).toEqual({});
  });

  it("mapea las rutas relativas a 'datos' (sin el prefijo 'datos.')", () => {
    const result = extractResultSchema.safeParse({
      tipo: "recibo",
      datos: { emisor: "", numero_recibo: "R1", fecha: "01/01/2026", total: 10 },
    });
    expect(result.success).toBe(false);
    const errors = buildFieldErrors(result);
    expect(errors.emisor).toBeDefined();
    expect(Object.keys(errors).every((k) => !k.startsWith("datos."))).toBe(true);
  });

  it("mapea rutas anidadas de arrays con índice (items.0.importe)", () => {
    const result = extractResultSchema.safeParse({
      tipo: "factura",
      datos: {
        emisor: "A",
        receptor: "B",
        numero_factura: "1",
        fecha: "01/01/2026",
        subtotal: 100,
        impuestos: 21,
        total: 121,
        items: [{ descripcion: "X" }],
      },
    });
    expect(result.success).toBe(false);
    const errors = buildFieldErrors(result);
    expect(errors["items.0.importe"]).toBeDefined();
  });
});

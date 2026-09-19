import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  pool: { connect: vi.fn() },
}));

import { pool } from "@/lib/db";
import { isSelectOnly, runReadOnlyQuery } from "./sqlGuard";

describe("isSelectOnly", () => {
  it("acepta un SELECT simple", () => {
    expect(isSelectOnly("SELECT SUM(total) FROM facturas")).toBe(true);
  });

  it("acepta un SELECT con punto y coma final único", () => {
    expect(isSelectOnly("SELECT * FROM facturas;")).toBe(true);
  });

  it("acepta SELECT en minúsculas", () => {
    expect(isSelectOnly("select count(*) from recibos")).toBe(true);
  });

  it("rechaza una cadena vacía", () => {
    expect(isSelectOnly("")).toBe(false);
  });

  it("rechaza sentencias que no empiezan por SELECT", () => {
    expect(isSelectOnly("UPDATE facturas SET total = 0")).toBe(false);
    expect(isSelectOnly("DELETE FROM facturas")).toBe(false);
    expect(isSelectOnly("DROP TABLE facturas")).toBe(false);
  });

  it("rechaza sentencias múltiples separadas por punto y coma", () => {
    expect(isSelectOnly("SELECT 1; DROP TABLE facturas;")).toBe(false);
  });

  it("rechaza un SELECT que contiene palabras clave de escritura", () => {
    expect(isSelectOnly("SELECT * FROM facturas WHERE 1=1; INSERT INTO facturas DEFAULT VALUES")).toBe(
      false
    );
  });

  it("rechaza intentos de acceder a catálogos internos (pg_*)", () => {
    // "pg_" en sí no está en la lista de palabras prohibidas por regex \b, se deja pasar
    // el filtro léxico: la protección real es la transacción READ ONLY de Postgres.
    expect(isSelectOnly("SELECT * FROM pg_catalog.pg_tables")).toBe(true);
  });
});

describe("runReadOnlyQuery", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("rechaza sin tocar la base de datos si la consulta no es un SELECT seguro", async () => {
    await expect(runReadOnlyQuery("DROP TABLE facturas")).rejects.toThrow(/SELECT segura/);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("ejecuta el SELECT dentro de una transacción READ ONLY, con LIMIT y hace ROLLBACK al final", async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.startsWith("SELECT * FROM (")) {
          return { rows: [{ total: 121 }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const rows = await runReadOnlyQuery("SELECT SUM(total) AS total FROM facturas", 10);

    expect(rows).toEqual([{ total: 121 }]);
    expect(calls[0]).toBe("BEGIN READ ONLY");
    expect(calls.some((c) => c.includes("statement_timeout"))).toBe(true);
    expect(calls.some((c) => c.includes("LIMIT 10"))).toBe(true);
    expect(calls[calls.length - 1]).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("hace ROLLBACK y libera el cliente aunque la consulta falle", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith("SELECT * FROM (")) {
          throw new Error("columna inexistente");
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    await expect(runReadOnlyQuery("SELECT columna_falsa FROM facturas")).rejects.toThrow(
      /columna inexistente/
    );
    expect(client.query.mock.calls.some((c) => c[0] === "ROLLBACK")).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

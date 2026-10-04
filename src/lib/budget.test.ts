import { describe, expect, it } from "vitest";
import {
  addSpend,
  approvedFingerprint,
  assertApprovedImmutable,
  computeLedger,
  createSpend,
  freezeApprovedBudget,
  ImmutableBudgetError,
  parseApprovedBudgetCsv,
  removeSpend,
} from "./budget";
import { createSampleBudget, createSampleSpends, SAMPLE_CSV } from "./sample";

describe("presupuesto restante", () => {
  it("resta el gasto de cada partida y del total sin inventar cifras", () => {
    const budget = createSampleBudget();
    const spends = createSampleSpends(budget);
    const ledger = computeLedger(budget, spends);

    const google = ledger.lines.find((row) => row.line.partida === "Google Ads");
    const feria = ledger.lines.find((row) => row.line.partida === "Q4 trade fair");
    const meta = ledger.lines.find((row) => row.line.partida === "Meta Ads");

    expect(google?.line.aprobado).toBe(5000);
    expect(google?.gastado).toBe(1800);
    expect(google?.restante).toBe(3200);
    expect(google?.desvio).toBe(0);

    expect(feria?.line.aprobado).toBe(4500);
    expect(feria?.gastado).toBe(4700);
    expect(feria?.restante).toBe(-200);
    expect(feria?.desvio).toBe(200);

    expect(meta?.gastado).toBe(0);
    expect(meta?.restante).toBe(3200);

    expect(ledger.totalAprobado).toBe(16700);
    expect(ledger.totalGastado).toBe(6900);
    expect(ledger.totalRestante).toBe(9800);
    expect(ledger.totalDesvio).toBe(200);
  });

  it("queda igual al aprobado si no hay gastos", () => {
    const budget = createSampleBudget();
    const ledger = computeLedger(budget, []);
    expect(ledger.totalGastado).toBe(0);
    expect(ledger.totalRestante).toBe(ledger.totalAprobado);
    expect(ledger.lines.every((row) => row.restante === row.line.aprobado)).toBe(true);
  });

  it("rechaza un gasto sobre una partida que no está en el CSV", () => {
    const budget = createSampleBudget();
    expect(() =>
      computeLedger(budget, [
        createSpend({
          lineId: "partida-inventada",
          importe: 10,
          nota: "no existe",
        }),
      ]),
    ).toThrow(/does not exist/);
  });
});

describe("presupuesto aprobado inmutable", () => {
  it("congela las partidas y no permite reasignar el aprobado", () => {
    const budget = createSampleBudget();
    expect(Object.isFrozen(budget)).toBe(true);
    expect(Object.isFrozen(budget.lines)).toBe(true);
    expect(Object.isFrozen(budget.lines[0])).toBe(true);

    expect(() => {
      (budget.lines[0] as { aprobado: number }).aprobado = 1;
    }).toThrow(TypeError);

    expect(budget.lines[0].aprobado).toBe(5000);
  });

  it("el gasto no cambia el fingerprint ni los importes aprobados", () => {
    const budget = createSampleBudget();
    const before = budget.lines.map((line) => line.aprobado);
    const fingerprint = budget.fingerprint;

    const spends = addSpend(
      budget,
      [],
      createSpend({ lineId: budget.lines[0].id, importe: 250, nota: "SAMPLE DATA" }),
    );
    const ledger = computeLedger(budget, spends);

    expect(ledger.budget).toBe(budget);
    expect(ledger.budget.fingerprint).toBe(fingerprint);
    expect(ledger.budget.lines.map((line) => line.aprobado)).toEqual(before);
    expect(approvedFingerprint(ledger.budget.lines)).toBe(fingerprint);
    assertApprovedImmutable(budget, ledger.budget);
  });

  it("borrar un gasto tampoco toca el aprobado", () => {
    const budget = createSampleBudget();
    const first = createSpend({ lineId: budget.lines[1].id, importe: 80, nota: "a" });
    const withSpend = addSpend(budget, [], first);
    const without = removeSpend(budget, withSpend, first.id);
    const ledger = computeLedger(budget, without);

    expect(without).toHaveLength(0);
    expect(ledger.budget.fingerprint).toBe(budget.fingerprint);
    expect(ledger.lines[1].line.aprobado).toBe(3200);
  });

  it("detecta si alguien intenta sustituir el aprobado", () => {
    const budget = createSampleBudget();
    const tampered = freezeApprovedBudget({
      fileName: budget.fileName,
      isSample: true,
      lines: budget.lines.map((line, i) => ({
        ...line,
        aprobado: i === 0 ? line.aprobado + 999 : line.aprobado,
      })),
    });

    expect(() => assertApprovedImmutable(budget, tampered)).toThrow(ImmutableBudgetError);
  });
});

describe("CSV de solo lectura", () => {
  it("lee el CSV de ejemplo y lo marca como datos de ejemplo", () => {
    const budget = parseApprovedBudgetCsv(SAMPLE_CSV, "sample-presupuesto.csv");
    expect(budget.isSample).toBe(true);
    expect(budget.lines).toHaveLength(5);
    expect(budget.lines[0]?.origen).toBe("SAMPLE DATA");
    expect(budget.lines.reduce((sum, line) => sum + line.aprobado, 0)).toBe(16700);
  });

  it("acepta CSV europeo con punto de miles y coma decimal", () => {
    const csv = [
      "categoria;partida;presupuesto_aprobado",
      "Eventos;Stand;1.200,50",
      "Contenido;Foto;800",
    ].join("\n");
    const budget = parseApprovedBudgetCsv(csv, "export.csv");
    expect(budget.lines[0]?.aprobado).toBe(1200.5);
    expect(budget.lines[1]?.aprobado).toBe(800);
  });

  it("no inventa filas ni rellena huecos", () => {
    expect(() => parseApprovedBudgetCsv("categoria,partida,presupuesto_aprobado\n", "vacio.csv")).toThrow(
      /needs a header|contains no budget items/,
    );
  });
});

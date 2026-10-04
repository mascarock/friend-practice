import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addSpend, computeLedger, createSpend, parseApprovedBudgetCsv, removeSpend } from "./budget";
import { formatMoney } from "./money";
import { createSampleBudget, SAMPLE_CSV, SAMPLE_FILE_NAME } from "./sample";
import { loadLocalBudget, loadLocalSpends, saveLocalState } from "./storage";

afterEach(() => vi.unstubAllGlobals());

describe("local budget workflow", () => {
  it("preserves approved amounts and spending through local storage", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    } });
    const budget = parseApprovedBudgetCsv("category,item,approved_budget\nMarketing,Campaign,1200.50", "approved.csv");
    const spend = createSpend({ lineId: budget.lines[0].id, importe: 200.25, nota: "Local entry" });
    const spends = addSpend(budget, [], spend);
    expect(computeLedger(budget, spends).totalRestante).toBe(1000.25);
    saveLocalState(budget, spends);
    const restored = loadLocalBudget()!;
    const restoredSpends = loadLocalSpends();
    expect(restored.fingerprint).toBe(budget.fingerprint);
    expect(Object.isFrozen(restored.lines[0])).toBe(true);
    expect(restoredSpends).toEqual(spends);
    expect(computeLedger(restored, restoredSpends).totalRestante).toBe(1000.25);
    expect(computeLedger(restored, removeSpend(restored, restoredSpends, spend.id)).totalRestante).toBe(1200.50);
    expect(restored.lines[0].aprobado).toBe(1200.50);
    saveLocalState(null, []);
    expect(storage.size).toBe(0);
  });

  it("keeps the English download and loaded sample identical and labeled", () => {
    expect(readFileSync(`public/${SAMPLE_FILE_NAME}`, "utf8")).toBe(SAMPLE_CSV);
    const imported = parseApprovedBudgetCsv(SAMPLE_CSV, SAMPLE_FILE_NAME);
    const sample = createSampleBudget();
    expect(imported.lines).toEqual(sample.lines);
    expect(imported.isSample).toBe(true);
    expect(imported.lines.every((line) => line.origen === "SAMPLE DATA")).toBe(true);
    expect(SAMPLE_CSV).toContain("not Paola’s real budget");
  });

  it("continues to label legacy Spanish sample CSVs", () => {
    const budget = parseApprovedBudgetCsv("origen,categoria,partida,presupuesto_aprobado\nDATOS DE EJEMPLO,Eventos,Stand,1200", "export.csv");
    expect(budget.isSample).toBe(true);
    expect(budget.lines[0].aprobado).toBe(1200);
  });

  it.each([Infinity, -Infinity, NaN, 0, -1])("rejects invalid spend amounts: %s", (importe) => {
    expect(() => createSpend({ lineId: "test", importe, nota: "" })).toThrow("Enter a finite spend amount greater than 0.");
  });

  it("formats amounts in English without adding an assumed currency", () => {
    expect(formatMoney(16700)).toBe("16,700.00");
    expect(formatMoney(-200.25)).toBe("-200.25");
  });
});

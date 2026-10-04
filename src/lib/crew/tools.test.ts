import { describe, expect, it } from "vitest";
import { parseApprovedBudgetCsv } from "../budget";
import { SAMPLE_CSV, createSampleSpends } from "../sample";
import { logSpend, runTool } from "./tools";

const budget = parseApprovedBudgetCsv(SAMPLE_CSV, "sample.csv");
const state = { budget, spends: createSampleSpends(budget) };
describe("local budget crew", () => {
  it("Ledger returns only CSV items, including custom categories", () => {
    const local = parseApprovedBudgetCsv("category,item,approved_budget\nReal category,Only this row,12.25", "local.csv");
    expect(runTool("ledger", { budget: local, spends: [] }).lines).toEqual([{ category: "Real category", item: "Only this row", approved: 12.25, spent: 0, remaining: 12.25, overspend: 0 }]);
  });
  it("Watcher computes strict overspend in code", () => {
    expect(runTool("watcher", state).lines.map((line) => [line.item, line.overspend])).toEqual([["Q4 trade fair", 200]]);
    const equal = logSpend({ budget, spends: [] }, { lineId: budget.lines[0].id, amount: "5000", note: "" });
    expect(runTool("watcher", { budget, spends: equal.spends }).lines).toEqual([]);
  });
  it("Clerk preserves approved values and updates Remainder to the cent", () => {
    const before = JSON.stringify(budget);
    const next = logSpend(state, { lineId: budget.lines[0].id, amount: "0.25", note: "Local" });
    expect(JSON.stringify(budget)).toBe(before);
    expect(runTool("remainder", { budget, spends: next.spends })).toMatchObject({ approved: 16700, spent: 6900.25, remaining: 9799.75, isSample: true });
    expect(state.spends).toHaveLength(3);
    expect(next.spends.at(-1)?.isSample).toBe(true);
  });
  it.each(["", "0", "-1", "NaN", "Infinity", "hello", "0.001"])("rejects invalid typed amount %s", (amount) => {
    expect(() => logSpend(state, { lineId: budget.lines[0].id, amount, note: "" })).toThrow();
  });
  it("rejects absent categories and invalid persisted spends", () => {
    expect(() => logSpend(state, { lineId: "invented", amount: "10", note: "" })).toThrow();
    expect(() => runTool("remainder", { budget, spends: [{ ...state.spends[0], importe: -2 }] })).toThrow();
  });
  it("Note receives precisely the code-computed watcher list", () => {
    expect(runTool("note", state).lines).toEqual(runTool("watcher", state).lines);
  });
});

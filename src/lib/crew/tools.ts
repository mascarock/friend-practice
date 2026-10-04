import { addSpend, computeLedger, createSpend, type SpendEntry } from "../budget";
import { parseLocaleNumber } from "../money";
import type { BotId, ClerkInput, CrewState, ToolResult } from "./types";

// Validate persisted and incoming data before any computation or model call.
export function validateState(state: CrewState): void {
  if (!state?.budget || !Array.isArray(state.budget.lines) || !state.budget.lines.length || !Array.isArray(state.spends)) {
    throw new Error("Load an approved CSV first.");
  }
  const ids = new Set<string>();
  for (const line of state.budget.lines) {
    if (!line.id || ids.has(line.id) || typeof line.categoria !== "string" || !line.categoria.trim() || typeof line.partida !== "string" || !line.partida.trim() || !Number.isFinite(line.aprobado) || line.aprobado < 0) {
      throw new Error("The approved CSV contains an invalid item.");
    }
    ids.add(line.id);
  }
  const spendIds = new Set<string>();
  for (const spend of state.spends) {
    if (!ids.has(spend.lineId) || !Number.isFinite(spend.importe) || spend.importe <= 0 || !spend.id || spendIds.has(spend.id)) {
      throw new Error("The local spend log contains an invalid entry.");
    }
    spendIds.add(spend.id);
  }
}

export function runTool(bot: BotId, state: CrewState): ToolResult {
  validateState(state);
  const ledger = computeLedger(state.budget, state.spends);
  if (![ledger.totalAprobado, ledger.totalGastado, ledger.totalRestante].every(Number.isFinite)) throw new Error("Budget totals are too large.");
  const allLines = ledger.lines.map(({ line, gastado, restante, desvio }) => ({
    category: line.categoria, item: line.partida, approved: line.aprobado,
    spent: gastado, remaining: restante, overspend: desvio,
  }));
  const lines = bot === "watcher" || bot === "note" ? allLines.filter((line) => line.spent > line.approved) : bot === "remainder" ? [] : allLines;
  const messages: Record<BotId, string> = {
    ledger: `Read ${allLines.length} items from the loaded CSV.`,
    clerk: "Spend saved locally. Approved amounts are unchanged.",
    watcher: lines.length ? `Found ${lines.length} over-budget ${lines.length === 1 ? "item" : "items"}.` : "No items are over budget.",
    remainder: "Calculated approved, spent, and remaining.",
    note: lines.length ? "Computed over-budget items for Paola." : "No items are over budget.",
  };
  return { bot, isSample: state.budget.isSample, source: state.budget.fileName, lines,
    approved: ledger.totalAprobado, spent: ledger.totalGastado, remaining: ledger.totalRestante, message: messages[bot] };
}

export function logSpend(state: CrewState, input: ClerkInput): { spends: SpendEntry[]; result: ToolResult } {
  validateState(state);
  const line = state.budget.lines.find((entry) => entry.id === input.lineId);
  if (!line) throw new Error("Choose an item in an existing approved category.");
  if (typeof input.amount !== "string") throw new Error("Type a positive spend amount.");
  const amount = parseLocaleNumber(input.amount);
  if (amount === null || amount <= 0) throw new Error("Type a positive spend amount.");
  const spend = createSpend({ lineId: line.id, importe: amount, nota: input.note, isSample: state.budget.isSample });
  const spends = addSpend(state.budget, state.spends, spend);
  const result = runTool("clerk", { budget: state.budget, spends });
  result.lines = result.lines.filter((entry) => entry.category === line.categoria && entry.item === line.partida);
  return { spends, result };
}

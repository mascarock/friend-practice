import type { ApprovedBudget, SpendEntry } from "./budget";
import { freezeApprovedBudget } from "./budget";

const BUDGET_KEY = "presupuesto-local:approved";
const SPENDS_KEY = "presupuesto-local:spends";

function reviveBudget(value: ApprovedBudget): ApprovedBudget {
  return freezeApprovedBudget({
    fileName: value.fileName,
    importedAt: value.importedAt,
    isSample: value.isSample,
    lines: value.lines.map((line) => ({ ...line })),
  });
}

export function loadLocalBudget(): ApprovedBudget | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(BUDGET_KEY);
  if (!raw) {
    return null;
  }
  try {
    return reviveBudget(JSON.parse(raw) as ApprovedBudget);
  } catch {
    return null;
  }
}

export function loadLocalSpends(): SpendEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(SPENDS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as SpendEntry[];
    return parsed.map((spend) => Object.freeze({ ...spend }));
  } catch {
    return [];
  }
}

export function saveLocalState(budget: ApprovedBudget | null, spends: readonly SpendEntry[]): void {
  if (typeof window === "undefined") {
    return;
  }
  if (!budget) {
    window.localStorage.removeItem(BUDGET_KEY);
    window.localStorage.removeItem(SPENDS_KEY);
    return;
  }
  window.localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
  window.localStorage.setItem(SPENDS_KEY, JSON.stringify(spends));
}

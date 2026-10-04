import type { ApprovedBudget, SpendEntry } from "../budget";

export type BotId = "ledger" | "clerk" | "watcher" | "remainder" | "note";
export type CrewState = { budget: ApprovedBudget; spends: readonly SpendEntry[] };
export type CrewLine = { category: string; item: string; approved: number; spent: number; remaining: number; overspend: number };
export type ToolResult = {
  bot: BotId;
  isSample: boolean;
  source: string;
  lines: CrewLine[];
  approved: number;
  spent: number;
  remaining: number;
  message: string;
};
export type ClerkInput = { lineId: string; amount: string; note: string };
export type NoteResponse = { status: "ok" | "withheld" | "unavailable"; text: string; toolResult: ToolResult };

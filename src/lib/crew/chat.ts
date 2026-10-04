import type { ApprovedBudget } from "../budget";
import { formatMoney } from "../money";
import type { BotId, ClerkInput, ToolResult } from "./types";

export const examples: Record<BotId, string> = {
  ledger: "what's approved for Meta Ads?",
  clerk: "log 200 on Meta Ads for the sample stand",
  watcher: "anything over?",
  remainder: "how much is left?",
  note: "one sentence for Paola",
};

type Intent =
  | { kind: "clarify"; text: string }
  | { kind: "read"; target?: string }
  | { kind: "spend"; input: ClerkInput };
const normalize = (text: string) => text.trim().replace(/’/g, "'").replace(/\s+/g, " ").toLowerCase();

/** Deliberately bounded grammar: unknown or compound requests never execute a tool. */
export function parseMessage(bot: BotId, message: string, budget: ApprovedBudget): Intent {
  const text = normalize(message).replace(/[?.!]$/, "");
  const clarify = (text: string): Intent => ({ kind: "clarify", text });
  if (bot === "ledger") {
    if (/^(?:show|read) (?:the )?(?:approved (?:budget|csv)|budget|csv)$/.test(text) || /^(?:what's|what is) approved$/.test(text)) return { kind: "read" };
    const target = /^(?:(?:what's|what is) approved for|how much is approved for|show approved for) (.+)$/.exec(text)?.[1];
    if (target && budget.lines.some((line) => normalize(line.partida) === target || normalize(line.categoria) === target)) return { kind: "read", target };
    return clarify("Which item or category in the loaded CSV should I read?");
  }
  if (bot === "clerk") {
    const match = /^(?:log|record) ((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?) (?:on|against|for) (.+)$/i.exec(message.trim());
    if (match && Number(match[1].replace(/,/g, "")) > 0 && Number.isFinite(Number(match[1].replace(/,/g, "")))) {
      const tail = normalize(match[2]);
      const candidates = budget.lines.flatMap((line) => {
        const names = [normalize(line.partida), normalize(line.categoria)];
        const name = names.find((name) => tail === name || tail.startsWith(`${name} for `));
        return name ? [{ line, name }] : [];
      });
      if (candidates.length === 1) {
        const { line, name } = candidates[0];
        const note = tail === name ? "" : match[2].trim().replace(/\s+/g, " ").slice(name.length + 5).trim();
        if (!/\b(?:and|then)\s+(?:log|record|add|spend)\b/i.test(note)) return { kind: "spend", input: { lineId: line.id, amount: match[1].replace(/,/g, ""), note } };
      }
    }
    return clarify("What amount and existing item should I log? Use “log [amount] on [item] for [note]”.");
  }
  const patterns = {
    watcher: /^(?:anything over|anything over budget|what(?:'s| is) over(?: budget)?|show (?:the )?over-budget items|check (?:the )?budget)$/,
    remainder: /^(?:how much is left|what(?:'s| is) left|show (?:the )?(?:remaining|totals)|how much remains|approved, spent, and remaining)$/,
    note: /^(?:one sentence for paola|(?:write|give me) (?:one|a) sentence for paola|(?:write )?a note for paola)$/,
  };
  if (patterns[bot].test(text)) return { kind: "read" };
  return clarify({ watcher: "Should I check which items are over budget? Try “anything over?”.", remainder: "Should I show approved, spent, and remaining? Try “how much is left?”.", note: "Would you like a sentence from local Gemma? Try “one sentence for Paola”." }[bot]);
}

export function selectLedgerResult(result: ToolResult, target?: string): ToolResult {
  return target ? { ...result, lines: result.lines.filter((line) => normalize(line.item) === target || normalize(line.category) === target) } : result;
}

/** Every item and figure in an answer is copied from a tool result. */
export function replyFromTool(result: ToolResult): string {
  if (result.bot === "ledger") return result.lines.map((line) => `${line.item} has ${formatMoney(line.approved)} approved.`).join("\n");
  if (result.bot === "watcher" || result.bot === "note") return result.lines.length ? result.lines.map((line) => `${line.item} is over budget by ${formatMoney(line.overspend)}.`).join("\n") : "No items are over budget.";
  if (result.bot === "clerk") return "Spend saved locally. Approved amounts are unchanged.";
  return "Here’s what remains in the loaded budget.";
}

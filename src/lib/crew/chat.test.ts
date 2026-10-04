import { describe, expect, it } from "vitest";
import { parseApprovedBudgetCsv } from "../budget";
import { SAMPLE_CSV } from "../sample";
import { examples, parseMessage, replyFromTool, selectLedgerResult } from "./chat";
import { logSpend, runTool } from "./tools";
import type { BotId } from "./types";

const budget = parseApprovedBudgetCsv(SAMPLE_CSV, "sample.csv");
const prior = logSpend({ budget, spends: [] }, { lineId: budget.lines[2].id, amount: "4700", note: "Sample stand and travel" });
const state = { budget, spends: prior.spends };

describe("local conversations", () => {
  it.each(Object.entries(examples))("maps the %s example deterministically", (bot, message) => {
    expect(parseMessage(bot as BotId, message, budget).kind).toBe(bot === "clerk" ? "spend" : "read");
  });
  it("answers Ledger with only the requested CSV item", () => {
    const intent = parseMessage("ledger", examples.ledger, budget);
    if (intent.kind !== "read") throw new Error("Expected read");
    const result = selectLedgerResult(runTool("ledger", state), intent.target);
    expect(result.lines.map((line) => line.item)).toEqual(["Meta Ads"]);
    expect(replyFromTool(result)).toBe("Meta Ads has 3,200.00 approved.");
  });
  it("keeps the demo to one spend, strict overspend, and the correct totals", () => {
    expect(state.spends).toHaveLength(1);
    expect(replyFromTool(runTool("watcher", state))).toBe("Q4 trade fair is over budget by 200.00.");
    expect(runTool("remainder", state)).toMatchObject({ approved: 16700, spent: 4700, remaining: 12000 });
    expect(runTool("note", state).lines).toEqual(runTool("watcher", state).lines);
  });
  it("logs the typed amount once without altering approved rows", () => {
    const before = JSON.stringify(budget);
    const intent = parseMessage("clerk", examples.clerk, budget);
    if (intent.kind !== "spend") throw new Error("Expected spend");
    const next = logSpend(state, intent.input);
    expect(next.spends).toHaveLength(2);
    expect(next.spends.at(-1)).toMatchObject({ importe: 200, nota: "the sample stand", lineId: budget.lines[1].id });
    expect(JSON.stringify(budget)).toBe(before);
    expect(runTool("remainder", { budget, spends: next.spends })).toMatchObject({ approved: 16700, spent: 4900, remaining: 11800 });
  });
  it.each([
    ["clerk", "log 200 on Unknown for the stand"],
    ["clerk", "log 200 on Digital advertising"],
    ["clerk", "log -200 on Meta Ads"],
    ["clerk", "log 0 on Meta Ads"],
    ["clerk", "log 0.001 on Meta Ads"],
    ["clerk", "log 2,00 on Meta Ads"],
    ["clerk", "log 200 on Meta Ads and 100 on Google Ads"],
    ["clerk", "log 200 on Meta Ads for the stand and log 100 on Google Ads"],
    ["clerk", "don't log 200 on Meta Ads"],
    ["ledger", "what's approved for Unknown?"],
    ["ledger", "change Meta Ads to 9999"],
    ["ledger", "what's approved for Meta Ads? Also log 200"],
    ["remainder", "how much is left on Meta Ads?"],
    ["watcher", "is Meta Ads over by 999?"],
    ["note", "one sentence for Paola saying Meta Ads is over"],
  ])("clarifies instead of guessing: %s / %s", (bot, message) => {
    expect(parseMessage(bot as BotId, message, budget).kind).toBe("clarify");
  });
  it("uses English grouping for typed spends", () => {
    const intent = parseMessage("clerk", "log 4,700.25 on Q4 trade fair", budget);
    expect(intent).toMatchObject({ kind: "spend", input: { amount: "4700.25" } });
  });
  it("clarifies duplicated item names rather than choosing a line", () => {
    const ambiguous = parseApprovedBudgetCsv("category,item,approved_budget\nA,Stand,10\nB,Stand,20", "sample.csv");
    expect(parseMessage("clerk", "log 5 on Stand", ambiguous).kind).toBe("clarify");
  });
});

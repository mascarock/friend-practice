import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSampleBudget, createSampleSpends } from "../src/lib/sample";
import { withholdNarration } from "../src/lib/crew/ground";
import { runTool } from "../src/lib/crew/tools";

const outputPath = join(process.cwd(), "docs", "proof", "note-guard-proof.txt");

describe("Note Gemma guard proof", () => {
  it("writes a judge-readable pass/fail fixture for Gemma narration", () => {
    const budget = createSampleBudget();
    const toolResult = runTool("note", { budget, spends: createSampleSpends(budget) });

    const cases = [
      {
        label: "accepts grounded sentence",
        sentence: "SAMPLE DATA: the Q4 trade fair is over budget by 200.",
        expectedStatus: "narrated",
        expectedReason: "",
      },
      {
        label: "withholds wrong item",
        sentence: "SAMPLE DATA: Google Ads is over budget by 200.",
        expectedStatus: "withheld",
        expectedReason: "not_over_budget",
      },
      {
        label: "withholds wrong number",
        sentence: "SAMPLE DATA: the Q4 trade fair is over budget by 300.",
        expectedStatus: "withheld",
        expectedReason: "invented_figure",
      },
    ] as const;

    const checked = cases.map((entry) => ({ ...entry, result: withholdNarration(entry.sentence, toolResult) }));

    for (const entry of checked) {
      expect(entry.result.status).toBe(entry.expectedStatus);
      if (entry.expectedStatus === "withheld") {
        expect(entry.result).toMatchObject({ reason: entry.expectedReason });
      }
    }

    const lines = [
      "Note Gemma Guard Proof",
      "======================",
      "",
      "Command:",
      "  npm run proof:note-guard",
      "",
      "This fixture uses the real Note tool result and the same withholdNarration guard used by the local app.",
      "No model output is mocked as accepted: the candidate sentences below are checked exactly as Gemma sentences are checked before display.",
      "",
      "Tool result computed in code:",
      `  bot: ${toolResult.bot}`,
      `  sample: ${toolResult.isSample}`,
      `  source: ${toolResult.source}`,
      `  approved total: ${toolResult.approved}`,
      `  spent total: ${toolResult.spent}`,
      `  remaining total: ${toolResult.remaining}`,
      "  over-budget lines:",
      ...toolResult.lines.map((line) => `    - ${line.category} / ${line.item}: approved ${line.approved}, spent ${line.spent}, over ${line.overspend}`),
      "",
      "Checked candidate sentences:",
      ...checked.flatMap((entry) => [
        `  - ${entry.label}`,
        `    sentence: ${entry.sentence}`,
        `    guard status: ${entry.result.status}`,
        `    guard reason: ${entry.result.status === "withheld" ? entry.result.reason : "accepted"}`,
        `    shown to Paola: ${entry.result.status === "narrated" ? entry.result.sentence : entry.result.message}`,
      ]),
      "",
      "Result: 1 accepted, 2 withheld. Wrong item and wrong number do not reach the UI as Gemma narration.",
      "",
    ];

    mkdirSync(join(process.cwd(), "docs", "proof"), { recursive: true });
    writeFileSync(outputPath, lines.join("\n"), "utf8");
  });
});

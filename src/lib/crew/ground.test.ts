import { describe, expect, it } from "vitest";
import { parseApprovedBudgetCsv } from "../budget";
import { createSampleBudget, createSampleSpends } from "../sample";
import { isPlainName, judgeShape, withholdNarration } from "./ground";
import { buildNoteSystemPrompt, buildNoteUserPrompt } from "./prompts";
import { logSpend, runTool } from "./tools";
import type { BotId } from "./types";

function sampleResult(bot: BotId, withSpends = true) {
  const budget = createSampleBudget();
  return runTool(bot, { budget, spends: withSpends ? createSampleSpends(budget) : [] });
}

// The SAMPLE DATA note result after the clerk logs more sample spends, as [item, amount] pairs.
function noteAfterSpends(...extra: (readonly [string, string])[]) {
  const budget = createSampleBudget();
  let spends = createSampleSpends(budget);
  for (const [item, amount] of extra) {
    const line = budget.lines.find((entry) => entry.partida === item);
    if (!line) {
      throw new Error(`Sample item not found: ${item}`);
    }
    spends = logSpend({ budget, spends }, { lineId: line.id, amount, note: "SAMPLE DATA" }).spends;
  }
  return runTool("note", { budget, spends });
}

function noteAfterSpend(item: string, amount: string) {
  return noteAfterSpends([item, amount]);
}

// Meta Ads spent 3,300 of 3,200 (over by 100), the Q4 trade fair 4,700 of 4,500 (over by 200).
function twoOverNote() {
  return noteAfterSpend("Meta Ads", "3300");
}

// The note result for a SAMPLE DATA CSV Paola loads herself, after the clerk logs [row, amount] spends.
function csvNote(rows: string, spends: (readonly [number, string])[] = []) {
  const budget = parseApprovedBudgetCsv(`source,category,item,approved_budget\n${rows}`, "team-sample.csv");
  let log: ReturnType<typeof createSampleSpends> = [];
  for (const [row, amount] of spends) {
    log = logSpend({ budget, spends: log }, { lineId: budget.lines[row].id, amount, note: "SAMPLE DATA" }).spends;
  }
  return runTool("note", { budget, spends: log });
}

// The prompt's own facts, as Gemma copies them at temperature 0.
function promptCopy(toolResult: ReturnType<typeof csvNote>) {
  const facts = toolResult.lines.map((line) => `${line.item} is over budget by ${line.overspend}`);
  return `SAMPLE DATA: ${facts.length > 0 ? facts.join("; ") : "No item is over budget"}.`;
}

// SAMPLE DATA figures: only the Q4 trade fair is over budget (4,700 spent of 4,500 approved).
const remainder = { bot: "remainder", isSample: true, approvedTotal: 16700, spentTotal: 6900, remaining: 9800 };
const watcher = {
  bot: "watcher",
  isSample: true,
  overBudget: [{ category: "Events", item: "Q4 trade fair", approved: 4500, spent: 4700, over: 200 }],
};
const sampleLines = [
  { category: "Digital advertising", item: "Google Ads", approved: 5000, spent: 1800 },
  { category: "Digital advertising", item: "Meta Ads", approved: 3200, spent: 0 },
  { category: "Events", item: "Q4 trade fair", approved: 4500, spent: 4700 },
  { category: "Content", item: "Video production", approved: 2800, spent: 400 },
  { category: "Tools", item: "Marketing software", approved: 1200, spent: 0 },
];
const watcherWithLines = { ...watcher, lines: sampleLines };

// The same watcher answer in the shapes a tool result may take.
const watcherShapes: Array<[string, unknown]> = [
  ["overBudget lines only", watcher],
  ["overBudget plus every line", watcherWithLines],
  ["budget.ts line status", { bot: "watcher", overBudget: [{ line: { categoria: "Events", partida: "Q4 trade fair", aprobado: 4500 }, gastado: 4700, desvio: 200 }] }],
  ["overBudget names", { bot: "watcher", overBudget: ["Q4 trade fair"], totalOver: 200 }],
];

function expectWithheld(sentence: string, toolResult: unknown, reason: string) {
  const result = withholdNarration(sentence, toolResult);
  expect(result).toMatchObject({ status: "withheld", reason, toolResult });
  expect(result).not.toHaveProperty("sentence");
  expect(JSON.stringify(result)).not.toContain(sentence.trim());
}

/**
 * A true sentence in wording other than the facts' own shape: the checks find nothing false in it,
 * and Note withholds it only for its wording, because it narrates nothing but "X is over budget by N".
 */
function expectWordingWithheld(sentence: string, toolResult: unknown) {
  expectWithheld(sentence, toolResult, "unchecked_wording");
}

describe("withholdNarration: the crew's note tool result", () => {
  it("keeps the true sentence about the sample note result", () => {
    const toolResult = sampleResult("note");
    const sentence = "SAMPLE DATA: the Q4 trade fair is over budget by 200.";
    expect(withholdNarration(sentence, toolResult)).toEqual({ status: "narrated", sentence, toolResult });
  });

  it("withholds the known failure: Google Ads over by 200 when only the trade fair is over", () => {
    expectWithheld("Google Ads is over by 200.", sampleResult("note"), "not_over_budget");
    expectWithheld("SAMPLE DATA: Google Ads is over budget by 200.", sampleResult("watcher"), "not_over_budget");
  });

  it("checks 'nothing is over budget' against the note lines", () => {
    expectWithheld("SAMPLE DATA: nothing is over budget.", sampleResult("note"), "contradicts_watcher");
    expect(withholdNarration("SAMPLE DATA: no item is over budget.", sampleResult("note", false)).status).toBe("narrated");
  });

  it("does not treat ledger lines as the over-budget list", () => {
    expectWithheld("SAMPLE DATA: the Q4 trade fair is over budget by 200.", sampleResult("ledger"), "not_over_budget");
  });

  it("re-checks note lines: a line is over budget only when spent is greater than approved", () => {
    const toolResult = sampleResult("note");
    const googleAds = { category: "Digital advertising", item: "Google Ads", approved: 5000, spent: 1800, remaining: 3200, overspend: 0 };
    expectWithheld("Google Ads is over budget.", { ...toolResult, lines: [...toolResult.lines, googleAds] }, "not_over_budget");
  });
});

// Every SAMPLE DATA state below: each listed item over budget, with its own overspend.
const allOverNote = () =>
  noteAfterSpends(["Google Ads", "3500"], ["Meta Ads", "3300"], ["Video production", "2500"], ["Marketing software", "1300"]);

describe("withholdNarration: only the shape Gemma writes", () => {
  // gemma3:1b wrote each of these at temperature 0.7 or 1.0 from the facts the note prompt writes out.
  it.each([
    ["SAMPLE DATA: The Q4 trade fair is over budget by 200.", sampleResult("note")],
    ["Q4 trade fair is over budget by 200.", sampleResult("note")],
    ["SAMPLE DATA: Meta Ads is over budget by 100; Q4 trade fair is over budget by 200.", twoOverNote()],
    ["SAMPLE DATA: The Meta Ads is over budget by 100 and the Q4 trade fair is over budget by 200.", twoOverNote()],
    ["SAMPLE DATA: The Q4 trade fair is over budget by 200; Meta Ads is over budget by 100.", twoOverNote()],
    [
      "SAMPLE DATA: Google Ads is over budget by 300; Meta Ads is over budget by 100; Q4 trade fair is over budget by 200; Video production is over budget by 100; Marketing software is over budget by 100.",
      allOverNote(),
    ],
    ["SAMPLE DATA: Google Ads is over budget by 996800; Q4 trade fair is over budget by 200.", noteAfterSpend("Google Ads", "1000000")],
    ["SAMPLE DATA: Meta Ads is over budget by 0.5; Q4 trade fair is over budget by 200.", noteAfterSpend("Meta Ads", "3200.50")],
    ["SAMPLE DATA: No item is over budget.", sampleResult("note", false)],
    ["SAMPLE DATA: No items are over budget.", sampleResult("note", false)],
  ])("narrates the facts as the prompt writes them: %s", (sentence, toolResult) => {
    expect(withholdNarration(sentence, toolResult)).toEqual({ status: "narrated", sentence, toolResult });
  });

  it.each([
    ["SAMPLE DATA: Google Ads is over budget by 996,800, and the Q4 trade fair is over budget by 200.", noteAfterSpend("Google Ads", "1000000")],
    ["SAMPLE DATA: Meta Ads overspent by 100; the Q4 trade fair overspent by 200.", twoOverNote()],
    ["sample data: the q4 trade fair is over budget by 200", sampleResult("note")],
  ])("narrates small variations of that shape: %s", (sentence, toolResult) => {
    expect(withholdNarration(sentence, toolResult).status).toBe("narrated");
  });

  it("withholds 'are': a plural reads as every item of that kind, like 'the ads are over budget'", () => {
    expectWordingWithheld("SAMPLE DATA: Meta Ads are over budget by 100, and the Q4 trade fair is over budget by 200.", twoOverNote());
  });

  // Each is true; Note still shows the computed result instead, because open wording can say more than a check can follow.
  it.each([
    ["SAMPLE DATA: the Q4 trade fair spent 4,700.", sampleResult("note")],
    ["SAMPLE DATA: overall, you are within budget.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200, but overall you are within budget.", sampleResult("note")],
    ["SAMPLE DATA: Q4 trade fair: over budget by 200.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is over budget by $200.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200!", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200; the Q4 trade fair is over budget by 200.", sampleResult("note")],
  ])("withholds any other wording, even when true: %s", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "unchecked_wording");
  });

  it("withholds the shape when it leaves out a listed item", () => {
    // Meta Ads is over budget too: naming only the trade fair hides it.
    expectWithheld("SAMPLE DATA: the Q4 trade fair is over budget by 200.", twoOverNote(), "contradicts_watcher");
  });

  // Round-three review. A SAMPLE DATA CSV that Paola loads may name one item on two lines: the facts cannot say which.
  it.each([
    ["two lines named alike", "SAMPLE DATA,Events,Travel,1000\nSAMPLE DATA,Content,Travel,1000\n", "SAMPLE DATA: Travel is over budget by 100."],
    ["two lines named alike but for case", "SAMPLE DATA,Events,Travel,1000\nSAMPLE DATA,Content,TRAVEL,1000\n", "SAMPLE DATA: Travel is over budget by 100."],
    ["a row and its copy", "SAMPLE DATA,Events,Travel,500\nSAMPLE DATA,Events,Travel,500\n", "SAMPLE DATA: Travel is over budget by 50."],
  ])("withholds every sentence when %s are both over budget", (_case, rows, sentence) => {
    const budget = parseApprovedBudgetCsv(`source,category,item,approved_budget\n${rows}`, "team-sample.csv");
    let spends: ReturnType<typeof createSampleSpends> = [];
    for (const line of budget.lines) {
      spends = logSpend({ budget, spends }, { lineId: line.id, amount: String(line.aprobado * 1.1), note: "SAMPLE DATA" }).spends;
    }
    const toolResult = runTool("note", { budget, spends });
    expect(toolResult.lines).toHaveLength(2);
    expect(withholdNarration(sentence, toolResult).status).toBe("withheld");
    expect(withholdNarration(`SAMPLE DATA: ${toolResult.lines.map((line) => `${line.item} is over budget by ${line.overspend}`).join("; ")}.`, toolResult).status).toBe(
      "withheld",
    );
  });

  // "0,200" reads as 0.2 where a comma marks decimals, as in the app's own number parsing.
  it.each([
    ["SAMPLE DATA: The Q4 trade fair is over budget by 0,200.", sampleResult("note")],
    ["SAMPLE DATA: The Q4 trade fair is over budget by 000,200.", sampleResult("note")],
    ["SAMPLE DATA: The Q4 trade fair is over budget by 0200.", sampleResult("note")],
    ["SAMPLE DATA: Google Ads is over budget by 0,996,800; the Q4 trade fair is over budget by 200.", noteAfterSpend("Google Ads", "1000000")],
    ["SAMPLE DATA: Meta Ads is over budget by 0,000.5; the Q4 trade fair is over budget by 200.", noteAfterSpend("Meta Ads", "3200.50")],
  ])("withholds a figure with a leading zero group: %s", (sentence, toolResult) => {
    expect(judgeShape(sentence, toolResult)).toBe("unchecked_wording");
    expect(withholdNarration(sentence, toolResult).status).toBe("withheld");
  });

  // From about 7e13 a lone number cannot hold every cent, and figures that differ compare as equal.
  it.each([
    "SAMPLE DATA: Google Ads is over budget by 9999999999996801; the Q4 trade fair is over budget by 200.",
    "SAMPLE DATA: Google Ads is over budget by 9999999999996800.50; the Q4 trade fair is over budget by 200.",
    "SAMPLE DATA: Google Ads is over budget by 9999999999996800; the Q4 trade fair is over budget by 200.",
  ])("withholds every sentence about an overspend too large to check to the cent: %s", (sentence) => {
    expect(withholdNarration(sentence, noteAfterSpend("Google Ads", "10000000000000000")).status).toBe("withheld");
  });

  // Round-four review: amounts past the cap shift an overspend by cents, or drop a line from the list.
  it.each([
    ["a line brought level by drift", "SAMPLE DATA,Events,Stand,70368744177664.01\n", [[0, "70368744177664.02"]] as const],
    [
      "a huge reserve line that drift drops",
      "SAMPLE DATA,Digital advertising,Google Ads,5000\nSAMPLE DATA,Events,Q4 trade fair,4500\nSAMPLE DATA,Other,Reserve,100000000000000000000\n",
      [[0, "1800"], [1, "4700"], [2, "100000000000000000000"], [2, "8000"]] as const,
    ],
  ])("withholds every sentence when an amount is too large to check to the cent: %s", (_case, rows, spends) => {
    const toolResult = csvNote(rows, [...spends]);
    expect(withholdNarration(promptCopy(toolResult), toolResult).status).toBe("withheld");
    expect(withholdNarration("SAMPLE DATA: No item is over budget.", toolResult).status).toBe("withheld");
  });

  // A line Paola names "The rest" reads as every other line: Google Ads is 3,200 within budget.
  it("withholds every sentence when a listed name reads as other lines or the whole budget", () => {
    const toolResult = csvNote(
      "SAMPLE DATA,Digital advertising,Google Ads,5000\nSAMPLE DATA,Digital advertising,Meta Ads,3200\nSAMPLE DATA,Other,The rest,1000\n",
      [[0, "1800"], [1, "3300"], [2, "1050"]],
    );
    expect(withholdNarration(promptCopy(toolResult), toolResult).status).toBe("withheld");
    expect(withholdNarration("SAMPLE DATA: Meta Ads is over budget by 100, and the rest are over budget by 50.", toolResult).status).toBe("withheld");
  });

  it.each([
    "Other items", "Others", "Everything else", "All other items", "All ads", "Every item", "The whole budget", "The entire budget", "Paola",
    "The remainder", "Balance", "Some ads", "Most ads", "Everyone", "Leftovers", "Spare funds", "Unspent",
  ])(
    "withholds every sentence about a line named %s",
    (name) => {
      const toolResult = csvNote(`SAMPLE DATA,Digital advertising,Google Ads,5000\nSAMPLE DATA,Other,${name},1000\n`, [[0, "1800"], [1, "1050"]]);
      expect(toolResult.lines.map((line) => line.item)).toEqual([name]);
      expect(withholdNarration(promptCopy(toolResult), toolResult).status).toBe("withheld");
    },
  );

  // Names that carry the narration's own words or marks, or an invisible character.
  it.each([
    ["Google Ads overspent by 300; Google Ads", "SAMPLE DATA: Google Ads overspent by 300; Google Ads is over budget by 300."],
    ["SAMPLE DATA: Google Ads", "SAMPLE DATA: SAMPLE DATA: Google Ads is over budget by 300."],
    ["Google\uFEFFAds", "SAMPLE DATA: Google Ads is over budget by 300."],
  ])("withholds every sentence about a line named %j", (name, sentence) => {
    const toolResult = csvNote(`SAMPLE DATA,Digital advertising,Google Ads,5000\nSAMPLE DATA,Other,"${name}",1000\n`, [[0, "1800"], [1, "1300"]]);
    expect(toolResult.lines).toHaveLength(1);
    expect(withholdNarration(sentence, toolResult).status).toBe("withheld");
    expect(withholdNarration(promptCopy(toolResult), toolResult).status).toBe("withheld");
  });

  // Gemma copied the facts exactly; the open-wording checks misread the name. The sentence stays withheld, and the
  // notice says so instead of blaming Gemma for a claim it never made.
  it.each(["Red carpet", "Hotel (3 nights)", "Extra staff", "Excess baggage", "Now", "This"])(
    "says Note could not read the name when Gemma copies the facts for a line named %s",
    (name) => {
      const toolResult = csvNote(`SAMPLE DATA,Digital advertising,Google Ads,5000\nSAMPLE DATA,Other,${name},1000\n`, [[0, "1800"], [1, "1050"]]);
      const sentence = promptCopy(toolResult);
      expect(judgeShape(sentence, toolResult)).toBeNull();
      expect(withholdNarration(sentence, toolResult)).toMatchObject({ status: "withheld", reason: "unread_name" });
    },
  );

  // Round-five review. Facts that cannot be narrated safely: the notice says so, not that Gemma strayed.
  it.each([
    ["an item named like its own category", "SAMPLE DATA,Events,Events,1000\nSAMPLE DATA,Events,Q4 trade fair,4500\n", [[0, "1050"], [1, "4200"]] as const],
    [
      "an item named like another listed line's category",
      "SAMPLE DATA,Digital advertising,Meta Ads,3200\nSAMPLE DATA,Other,Digital advertising,1000\n",
      [[0, "3300"], [1, "1050"]] as const,
    ],
    ["two lines named alike", "SAMPLE DATA,Events,Travel,1000\nSAMPLE DATA,Content,Travel,1000\n", [[0, "1100"], [1, "1100"]] as const],
    ["a line named The rest", "SAMPLE DATA,Digital advertising,Google Ads,5000\nSAMPLE DATA,Other,The rest,1000\n", [[0, "1800"], [1, "1050"]] as const],
    ["an amount too large to check to the cent", "SAMPLE DATA,Events,Stand,70368744177664.01\n", [[0, "70368744177664.02"]] as const],
  ])("withholds every sentence for %s, and says why", (_case, rows, spends) => {
    const toolResult = csvNote(rows, [...spends]);
    expect(withholdNarration(promptCopy(toolResult), toolResult)).toMatchObject({ status: "withheld", reason: "unnarrated_budget" });
  });

  // A name that starts like a figure continues the figure before it: "by 5 and \u00BD page ad" reads as 5\u00BD.
  it.each(["\uFF15\uFF10\uFF10 flyers", "1/2 page ad", "\u00BD page ad", "500 flyers", "A half-day workshop", "Half page ad"])(
    "withholds every sentence about a line named %s",
    (name) => {
      const toolResult = csvNote(`SAMPLE DATA,Digital advertising,Meta Ads,3200\nSAMPLE DATA,Print,${name},1000\n`, [[0, "3205"], [1, "1300"]]);
      expect(toolResult.lines).toHaveLength(2);
      expect(withholdNarration(`SAMPLE DATA: Meta Ads is over budget by 5 and ${name} is over budget by 300.`, toolResult).status).toBe("withheld");
      expect(withholdNarration(promptCopy(toolResult), toolResult)).toMatchObject({ status: "withheld", reason: "unnarrated_budget" });
    },
  );

  // Drawn as "Google Ads", next to Paola's real Google Ads line, which is 3,200 within budget.
  it.each([
    ["a combining grapheme joiner", "Google \u034FAds"],
    ["a Hangul filler", "Google\u3164Ads"],
    ["a variation selector", "Google Ads\uFE0F"],
    ["a Braille blank", "Google\u2800Ads"],
    ["Cyrillic letters", "G\u043E\u043Egle Ads"],
    ["a Greek letter", "Google \u0391ds"],
  ])("withholds every sentence about a look-alike name with %s", (_case, name) => {
    const toolResult = csvNote(`SAMPLE DATA,Digital advertising,Google Ads,5000\nSAMPLE DATA,Digital advertising,${name},1000\n`, [[0, "1800"], [1, "1300"]]);
    expect(toolResult.lines).toHaveLength(1);
    expect(withholdNarration(promptCopy(toolResult), toolResult).status).toBe("withheld");
  });

  // Every word that keeps a name from standing as one line's name, in the guard's own word lists.
  it.each([
    "no", "nothing", "none", "every", "everything", "all", "each", "any", "anything", "else", "other", "others", "rest",
    "total", "totals", "overall", "altogether", "combined", "entire", "whole", "you", "your", "we", "our", "us", "paola",
    "item", "items", "line", "lines", "category", "categories", "entry", "entries", "partida", "partidas", "time", "times",
    "only", "one", "sole", "single", "not", "never", "neither", "nor", "without",
    "left", "remaining", "remains", "remain", "available", "headroom", "spare", "leftover", "unspent", "leftovers",
    "remainder", "balance", "some", "most", "many", "several", "few", "various", "both", "everyone", "everybody", "anyone",
    "anybody", "budget", "budgets", "over", "overspent", "overspend", "by", "is", "are", "was", "were", "and", "or",
    "sample", "data", "samples", "yours", "ours", "mine", "paolas", "nobody", "subtotal", "subtotals", "expenses",
    "expenditure", "expenditures", "actuals", "ytd", "annual", "monthly", "yearly", "quarterly", "weekly", "daily",
    "month", "months", "year", "years", "quarter", "quarters", "week", "weeks", "global", "wide", "average", "per",
    "etc", "lot", "majority",
  ])("refuses a name with the word %s", (word) => {
    expect(isPlainName(`Team ${word} fund`)).toBe(false);
  });

  it.each(["Print, signage", "Q1: kickoff", "Venue;catering", "Google + Meta", "Meta Ads & Google Ads", "A/V equipment"])(
    "refuses a name with a mark that joins or labels: %s",
    (name) => {
      expect(isPlainName(name)).toBe(false);
    },
  );

  // "Google  Ads" is drawn as "Google Ads"; "Q4 is over budget by 100" reads as the whole quarter.
  // Round-seven review: "Summer is over budget by 100" reads as all of summer; "Google plus Meta" as both lines.
  it.each([
    "Summer", "Christmas", "Spring", "Autumn", "Fall", "Winter", "Easter", "Weekend", "Friday", "Today", "Summer 2026", "Xmas",
    "Holidays", "Mon", "Tonight", "Day 1", "Night 2", "Phase 2", "Sprint 3",
    "Hourly fees", "Nightly rate", "Biweekly payroll", "Fortnightly pay", "Semiannual review",
    "Google plus Meta", "Venue plus catering", "Google vs Meta", "Google versus Meta", "Nike x Apple",
    // The CSV may be in Spanish: "Otros" is "Others", "Verano" is "Summer", "Google y Meta" joins two lines.
    "Otros", "Resto", "Varios", "Todo", "Mensual", "Anual", "Verano", "Navidad", "Marzo", "Lunes", "Google y Meta",
  ])("refuses a period, a per-unit, or a joined name: %j", (name) => {
    expect(isPlainName(name)).toBe(false);
  });

  // Round-eight review: drawn like another name, or folded by Unicode into one.
  const char = (code: number) => String.fromCharCode(code);
  it.each([
    ["a ligature", `O${char(0xfb03)}ce supplies`],
    ["a non-breaking hyphen", `Kick${char(0x2011)}off event`],
    ["a backspace", `Google ${char(0x8)}Ads`],
    ["a next-line control", `Google${char(0x85)}Ads`],
  ])("refuses a name with %s", (_case, name) => {
    expect(isPlainName(name)).toBe(false);
  });

  it.each(["Feria Q4", "Anuncios en Meta", `Kids${char(0x2019)} party`, "Kick-off event"])("accepts an ordinary name: %j", (name) => {
    expect(isPlainName(name)).toBe(true);
  });

  // Two lines whose names differ only in how an apostrophe is drawn, or in a leading "the", are drawn alike.
  it.each([
    ["apostrophes", `SAMPLE DATA,Events,Kids' party,1000\nSAMPLE DATA,Gala,Kids${char(0x2019)} party,1000\n`],
    ["a leading the", "SAMPLE DATA,Events,Fair,1000\nSAMPLE DATA,Gala,The fair,1000\n"],
    ["a hyphen", "SAMPLE DATA,Events,Sales team,1000\nSAMPLE DATA,Gala,Sales-team,1000\n"],
    ["a short plural", "SAMPLE DATA,Events,Meta Ad,1000\nSAMPLE DATA,Gala,Meta Ads,1000\n"],
    // The saltillo is a letter drawn like an apostrophe.
    ["a saltillo", `SAMPLE DATA,Events,Kids' party,1000\nSAMPLE DATA,Gala,Kids${char(0xa78c)} party,1000\n`],
  ])("withholds every sentence for two listed lines drawn alike but for %s", (_case, rows) => {
    const toolResult = csvNote(rows, [[0, "1100"], [1, "1050"]]);
    expect(toolResult.lines).toHaveLength(2);
    expect(withholdNarration(promptCopy(toolResult), toolResult)).toMatchObject({ status: "withheld", reason: "unnarrated_budget" });
  });

  // "Kids’ party is over budget by 50" reads as the Kids' party category, which is 2,400 within budget.
  it("refuses an item named like a listed line's category but for its apostrophe", () => {
    const toolResult = csvNote(
      `SAMPLE DATA,Kids' party,Balloons,1000\nSAMPLE DATA,Kids' party,Venue,3000\nSAMPLE DATA,Other,Kids${char(0x2019)} party,1000\n`,
      [[0, "1100"], [1, "500"], [2, "1050"]],
    );
    expect(toolResult.lines).toHaveLength(2);
    expect(withholdNarration(promptCopy(toolResult), toolResult)).toMatchObject({ status: "withheld", reason: "unnarrated_budget" });
  });

  // Round-nine review: a category read like the item, though spelled with ´ (a Spanish keyboard's apostrophe),
  // without its apostrophe, or in the plural. Balloons is over; the category is within budget.
  it.each([
    ["an acute accent for its apostrophe", `Kids${char(0xb4)} party`, "Kids' party"],
    ["no apostrophe", "Kids party", "Kids' party"],
    ["the plural", "Events", "Event"],
    // Round ten: an acute accent as a singular possessive, and a hyphen for a space.
    ["an acute accent for a possessive", `McDonald${char(0xb4)}s`, "McDonald's"],
    ["an acute accent for a possessive", `Women${char(0xb4)}s day`, `Women${char(0x2019)}s day`],
    ["a space for a hyphen", "Sales team", "Sales-team"],
    // A category is never checked by isPlainName, so a modifier letter inside its word must fold away here.
    ["a modifier-letter apostrophe inside a word", `Kick${char(0x2bc)}off event`, "Kick-off event"],
  ])("refuses an item named like a listed line's category written with %s", (_case, category, item) => {
    const toolResult = csvNote(
      `SAMPLE DATA,${category},Balloons,1000\nSAMPLE DATA,${category},Cake,1000\nSAMPLE DATA,Other,${item},1000\n`,
      [[0, "1100"], [1, "100"], [2, "1050"]],
    );
    expect(toolResult.lines).toHaveLength(2);
    expect(withholdNarration(promptCopy(toolResult), toolResult)).toMatchObject({ status: "withheld", reason: "unnarrated_budget" });
  });

  it.each([
    ["a modifier-letter apostrophe", `Paola${char(0x2bc)}s team`],
    ["a modifier-letter apostrophe", `Other${char(0x2bc)}s costs`],
    ["a modifier minus", `Kick${char(0x2d7)}off event`],
    ["a hyphen bullet", `Kick${char(0x2043)}off event`],
    ["a combining dot", `Gi${char(0x307)}ft bags`],
  ])("refuses a name drawn with %s", (_case, name) => {
    expect(isPlainName(name)).toBe(false);
  });

  // A line named "IT" (a common budget line) reads as "it" in a sentence; only the open-wording checks catch that.
  it("withholds 'it' standing for a line named IT", () => {
    const toolResult = csvNote("SAMPLE DATA,Events,Q4 trade fair,4500\nSAMPLE DATA,Tools,IT,1000\n", [[0, "4700"], [1, "1500"]]);
    expect(toolResult.lines).toHaveLength(2);
    const sentence = "SAMPLE DATA: Q4 trade fair is over budget by 200 and it is over budget by 500.";
    expect(withholdNarration(sentence, toolResult).status).toBe("withheld");
  });

  it.each(["Summer festival", "Christmas party", "Fall campaign", "Sprint planning", "Weekend market stall"])(
    "accepts a name that only starts with a period word: %s",
    (name) => {
      expect(isPlainName(name)).toBe(true);
    },
  );

  it.each(["Google  Ads", " Google Ads", "Google Ads ", "Q4", "March", "March 2026", "FY26", "Q4 2026", "H2"])(
    "refuses a name that reads as another line or a whole period: %j",
    (name) => {
      expect(isPlainName(name)).toBe(false);
    },
  );

  // Round-six review: each of these is the only rule that refuses its name, so a looser edit must fail here.
  it.each([
    // "Google Ads/Meta Ads is over budget by 50" reads as both lines, which are each within budget.
    ["a slash", "Google Ads/Meta Ads"],
    ["a slash", "Print/OOH"],
    // Pasted with a no-break space, it is drawn as Paola's real Google Ads line.
    ["a no-break space", `Google${String.fromCharCode(0xa0)}Ads`],
    // "By 5 and two-thirds page ad" reads as 5⅔.
    ["a leading number word", "Two-thirds page ad"],
    ["a leading number word", "Ten-minute walk"],
  ])("refuses a name with %s: %j", (_case, name) => {
    expect(isPlainName(name)).toBe(false);
  });

  // The Digital advertising category is 3,100 within budget; the line named like it is filed under Other.
  it("refuses an item named like a listed line's category in any case", () => {
    const toolResult = csvNote(
      "SAMPLE DATA,Digital advertising,Meta Ads,3200\nSAMPLE DATA,Other,Digital Advertising,1000\n",
      [[0, "3300"], [1, "1050"]],
    );
    expect(toolResult.lines).toHaveLength(2);
    const sentence = "SAMPLE DATA: Meta Ads is over budget by 100; Digital Advertising is over budget by 50.";
    expect(judgeShape(sentence, toolResult)).toBe("unnarrated_budget");
    expect(withholdNarration(sentence, toolResult).status).toBe("withheld");
  });

  // The app's own sums lose a cent from about 2^44 (1.76e13): here nothing is over budget in exact arithmetic.
  it("withholds every sentence where the app's own sums may have drifted", () => {
    const toolResult = csvNote("SAMPLE DATA,Events,Stand,24323813487766.59\n", [
      [0, "12161906743885.63"],
      [0, "12161906743880.96"],
    ]);
    expect(withholdNarration(promptCopy(toolResult), toolResult).status).toBe("withheld");
    expect(withholdNarration("SAMPLE DATA: Stand is over budget by 0.01.", toolResult).status).toBe("withheld");
  });

  it("refuses facts from 1e12 on, well below where cents drift", () => {
    const watcherAt = (approved: number) => ({ bot: "watcher", approved, overBudget: [{ item: "Q4 trade fair", over: 200 }] });
    expect(judgeShape("SAMPLE DATA: the Q4 trade fair is over budget by 200.", watcherAt(1e12))).toBe("unnarrated_budget");
    expect(judgeShape("SAMPLE DATA: the Q4 trade fair is over budget by 200.", watcherAt(1e12 - 1))).toBeNull();
  });

  it.each(["Google Ads", "Meta Ads", "Q4 trade fair", "Video production", "Marketing software", "Red carpet"])(
    "accepts an ordinary line name: %s",
    (name) => {
      expect(isPlainName(name)).toBe(true);
    },
  );

  // Gemma copied the facts exactly, but Note does not narrate this budget: the notice must say that, not blame Gemma.
  it.each(["Voice-over recording", "Below-the-line promotions", "No-show fees"])(
    "says the budget cannot be narrated when Gemma copies the facts for a line named %s",
    (name) => {
      const toolResult = csvNote(`SAMPLE DATA,Digital advertising,Google Ads,5000\nSAMPLE DATA,Other,${name},1000\n`, [[0, "1800"], [1, "1050"]]);
      expect(withholdNarration(promptCopy(toolResult), toolResult)).toMatchObject({ status: "withheld", reason: "unnarrated_budget" });
    },
  );

  it("keeps the checks' own reason when the facts are wrong", () => {
    const toolResult = csvNote("SAMPLE DATA,Digital advertising,Google Ads,5000\nSAMPLE DATA,Other,Red carpet,1000\n", [[0, "1800"], [1, "1050"]]);
    expect(withholdNarration("SAMPLE DATA: Google Ads is over budget by 50.", toolResult)).toMatchObject({ reason: "not_over_budget" });
  });

  it("keeps the checks' own reason when Gemma is wrong about a budget Note does not narrate", () => {
    // "The rest" is refused, so no sentence is narrated; 999 is no figure of this result at all.
    const toolResult = csvNote("SAMPLE DATA,Digital advertising,Google Ads,5000\nSAMPLE DATA,Other,The rest,1000\n", [[0, "1800"], [1, "1050"]]);
    expect(withholdNarration("SAMPLE DATA: The rest is over budget by 999.", toolResult)).toMatchObject({ reason: "invented_figure" });
  });

  // Gemma copied both facts for two lines Paola named alike; the notice must not say Gemma named something unlisted.
  it.each(["Red carpet", "Extra staff", "Short film"])("says the budget cannot be narrated for two lines named %s", (name) => {
    const toolResult = csvNote(`SAMPLE DATA,Events,${name},1000\nSAMPLE DATA,Gala,${name},2000\n`, [[0, "1100"], [1, "2050"]]);
    expect(toolResult.lines).toHaveLength(2);
    expect(withholdNarration(promptCopy(toolResult), toolResult)).toMatchObject({ status: "withheld", reason: "unnarrated_budget" });
  });

  // Category names pass through nothing but the name key that compares them with items: case, spaces, and Unicode forms.
  it.each([
    ["two spaces", "Digital  advertising", "Digital advertising"],
    ["a decomposed accent", `Cafe${String.fromCharCode(0x301)}`, `Caf${String.fromCharCode(0xe9)}`],
  ])("refuses an item named like a listed line's category written with %s", (_case, category, item) => {
    const toolResult = {
      bot: "note",
      isSample: true,
      lines: [
        { category, item: "Latte", approved: 1000, spent: 1100, remaining: -100, overspend: 100 },
        { category: "Other", item, approved: 1000, spent: 1050, remaining: -50, overspend: 50 },
      ],
      approved: 2000,
      spent: 2150,
      remaining: -150,
    };
    expect(judgeShape(`SAMPLE DATA: Latte is over budget by 100; ${item} is over budget by 50.`, toolResult)).toBe("unnarrated_budget");
  });

  it("refuses an item named like a category whose line comes after it", () => {
    const toolResult = csvNote(
      "SAMPLE DATA,Other,Digital advertising,1000\nSAMPLE DATA,Digital advertising,Meta Ads,3200\n",
      [[0, "1050"], [1, "3300"]],
    );
    expect(toolResult.lines).toHaveLength(2);
    expect(withholdNarration(promptCopy(toolResult), toolResult)).toMatchObject({ status: "withheld", reason: "unnarrated_budget" });
  });

  // "By 1, 500 flyers" reads as "by 1,500": Meta Ads is over by 1.
  it("withholds a figure that runs into a name starting with digits", () => {
    const toolResult = csvNote(
      "SAMPLE DATA,Digital advertising,Meta Ads,3200\nSAMPLE DATA,Events,500 flyers,1000\nSAMPLE DATA,Content,360 video,2000\n",
      [[0, "3201"], [1, "1300"], [2, "2100"]],
    );
    const commas = "SAMPLE DATA: Meta Ads is over budget by 1, 500 flyers is over budget by 300, 360 video is over budget by 100.";
    expect(withholdNarration(commas, toolResult).status).toBe("withheld");
    // A name that starts with a numeral is never narrated, so even the "; " copy, which reads correctly, is withheld.
    expect(withholdNarration(promptCopy(toolResult), toolResult)).toMatchObject({ status: "withheld", reason: "unnarrated_budget" });
  });

  // What Paola is shown is the sentence as written, so it must be the sentence that was checked.
  it.each([
    ["SAMPLE DATA: The Q4 trade fair is over budget by\uFEFF200.", sampleResult("note")],
    ["SAMPLE\u00A0DATA: The Q4 trade fair is over budget by 200.", sampleResult("note")],
    ["SAMPLE DATA: Meta Ads is over budget by 100\u037E Q4 trade fair is over budget by 200.", twoOverNote()],
    ["SAMPLE DATA: Meta Ads is over budget by 100;\nQ4 trade fair is over budget by 200.", twoOverNote()],
    ["SAMPLE DATA: The Q4 trade fair is over budget by 200\u200B.", sampleResult("note")],
    // The Kelvin sign lower-cases to "k", so this would match "Marketing software" if it were not refused first.
    [
      "SAMPLE DATA: Mar\u212Aeting software is over budget by 100; the Q4 trade fair is over budget by 200.",
      noteAfterSpend("Marketing software", "1300"),
    ],
  ])("withholds the shape written with characters that read as others: %s", (sentence, toolResult) => {
    expect(judgeShape(sentence, toolResult)).toBe("unchecked_wording");
    expect(withholdNarration(sentence, toolResult).status).toBe("withheld");
  });

  // The shape check stands on its own: each of these is also caught by the checks before it.
  describe("judgeShape alone", () => {
    it("reads 'No item is over budget' as the whole sentence", () => {
      // Meta Ads spent exactly its 3,200: nothing is over budget, and Meta Ads has nothing left.
      const toolResult = csvNote("SAMPLE DATA,Digital advertising,Meta Ads,3200\n", [[0, "3200"]]);
      expect(toolResult.lines).toHaveLength(0);
      expect(judgeShape("SAMPLE DATA: No item is over budget.", toolResult)).toBeNull();
      expect(judgeShape("SAMPLE DATA: No item is over budget, and every item still has money left.", toolResult)).toBe(
        "unchecked_wording",
      );
    });

    it.each([
      ["a joint other than ;, , and 'and'", "SAMPLE DATA: Meta Ads is over budget by 100 or the Q4 trade fair is over budget by 200."],
      ["a verb other than the prompt's", "SAMPLE DATA: Meta Ads is under budget by 100; the Q4 trade fair is over budget by 200."],
      ["'only' before a name", "SAMPLE DATA: only Meta Ads is over budget by 100; the Q4 trade fair is over budget by 200."],
      ["a label other than SAMPLE DATA", "NOTE: Meta Ads is over budget by 100; the Q4 trade fair is over budget by 200."],
    ])("withholds %s", (_case, sentence) => {
      expect(judgeShape(sentence, twoOverNote())).toBe("unchecked_wording");
    });

    it.each([
      "SAMPLE DATA: Meta Ads is over budget by 100.01; the Q4 trade fair is over budget by 200.",
      // 200.01 - 200 is a little under 0.01 in binary, so a "within a cent" comparison would let this through.
      "SAMPLE DATA: Meta Ads is over budget by 100; the Q4 trade fair is over budget by 200.01.",
    ])("checks each figure to the cent: %s", (sentence) => {
      expect(judgeShape(sentence, twoOverNote())).toBe("contradicts_watcher");
    });

    it("reads 'No item is over budget' only from the start of the sentence", () => {
      const toolResult = csvNote("SAMPLE DATA,Digital advertising,Meta Ads,3200\n", [[0, "3200"]]);
      expect(judgeShape("SAMPLE DATA: Every item still has money left, and no item is over budget.", toolResult)).toBe(
        "unchecked_wording",
      );
    });

    it("passes the facts in their own shape", () => {
      expect(judgeShape("SAMPLE DATA: The Q4 trade fair is over budget by 200.", sampleResult("note"))).toBeNull();
      expect(judgeShape("Meta Ads is over budget by 100 and the Q4 trade fair is over budget by 200", twoOverNote())).toBeNull();
      expect(judgeShape("SAMPLE DATA: No item is over budget.", sampleResult("note", false))).toBeNull();
    });

    it.each([
      ["SAMPLE DATA: the Q4 trade fair is over budget by 300.", sampleResult("note")],
      ["SAMPLE DATA: Meta Ads is over budget by 200; the Q4 trade fair is over budget by 100.", twoOverNote()],
      ["SAMPLE DATA: No item is over budget.", sampleResult("note")],
      ["SAMPLE DATA: the Q4 trade fair is over budget by 200.", twoOverNote()],
    ])("withholds facts that do not match the list: %s", (sentence, toolResult) => {
      expect(judgeShape(sentence, toolResult)).toBe("contradicts_watcher");
    });

    it.each([
      ["SAMPLE DATA: Google Ads is over budget by 200.", sampleResult("note")],
      ["SAMPLE DATA: the Q4 trade fair is over budget by 200.", sampleResult("ledger")],
      ["SAMPLE DATA: No item is over budget.", sampleResult("ledger")],
      ["SAMPLE DATA: Meta Ads is over budget by 100 the Q4 trade fair is over budget by 200.", twoOverNote()],
    ])("withholds anything that is not the list's own facts: %s", (sentence, toolResult) => {
      expect(judgeShape(sentence, toolResult)).toBe("unchecked_wording");
    });

    // A list it cannot read for certain gives no facts at all.
    it.each([
      ["an overspend that is not spent minus approved", { bot: "note", lines: [{ item: "Q4 trade fair", approved: 4500, spent: 4700, overspend: 300 }] }],
      [
        "one item listed twice with two overspends",
        { bot: "watcher", overBudget: [{ item: "Q4 trade fair", over: 300 }], lines: [{ item: "Q4 trade fair", approved: 4500, spent: 4700 }] },
      ],
      ["an overspend below zero", { bot: "watcher", overBudget: [{ item: "Q4 trade fair", over: -300 }] }],
      ["a total shared by two names", { bot: "watcher", overBudget: ["Q4 trade fair", "Meta Ads"], totalOver: 300 }],
      ["a line too large to check to the cent, with no totals", { bot: "watcher", overBudget: [{ item: "Q4 trade fair", approved: 1e20, over: 300 }] }],
    ])("withholds every sentence for %s", (_case, toolResult) => {
      expect(judgeShape("SAMPLE DATA: the Q4 trade fair is over budget by 300.", toolResult)).toBe("unnarrated_budget");
    });
  });

  // Round-two review: each of these reached Paola through the open-wording checks. The trade fair is the only
  // item over budget on the base sample (by 200, with 9,800 of 16,700 left); Meta Ads is over by 100 in meta100.
  it.each([
    ["SAMPLE DATA: spending is within budget.", allOverNote()],
    ["SAMPLE DATA: the budget is used up.", sampleResult("note")],
    ["SAMPLE DATA: Meta Ads is over budget by 100 and so is the Q4 trade fair.", twoOverNote()],
    ["SAMPLE DATA: the Q4 trade fair's approved spending is 4,700.", sampleResult("note")],
    ["SAMPLE DATA: Q4 trade fair: approved > spent.", sampleResult("note")],
    ["SAMPLE DATA: the items that went over budget are Meta Ads and the Q4 trade fair.", noteAfterSpends(["Meta Ads", "3300"], ["Video production", "2500"])],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200; every other item still has money left.", twoOverNote()],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200; it still has money left.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is far from over budget.", sampleResult("note")],
    ["SAMPLE DATA: Meta Ads outspent the Q4 trade fair.", twoOverNote()],
    ["SAMPLE DATA: Meta Ads went over budget by 100 during the Q4 trade fair.", twoOverNote()],
    ["SAMPLE DATA: for Meta Ads, the overspend is 200, and the Q4 trade fair is also over budget.", twoOverNote()],
    ["SAMPLE DATA: the sample data is now Paola's budget.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is also over budget by 200.", sampleResult("note")],
    ["SAMPLE DATA: Q4 trade fair: spent ≯ approved.", sampleResult("note")],
    ["SAMPLE DATA: Meta Ads ❌ over budget by 100, Q4 trade fair ✅.", twoOverNote()],
  ])("withholds what the round-two review got past the checks: %s", (sentence, toolResult) => {
    expect(withholdNarration(sentence, toolResult).status).toBe("withheld");
  });
});

describe("withholdNarration: before anything is grounded", () => {
  it("withholds narration until a tool result exists", () => {
    expectWithheld("Paola, here is your note.", undefined, "no_tool_result");
    expectWithheld("Paola, here is your note.", null, "no_tool_result");
  });

  it("withholds an empty or missing sentence and still returns the tool result", () => {
    for (const sentence of ["   ", undefined, null]) {
      expect(withholdNarration(sentence, watcher)).toMatchObject({ status: "withheld", reason: "empty", toolResult: watcher });
    }
  });

  it("withholds a bare SAMPLE DATA label as empty", () => {
    // gemma3:1b sometimes stops right after the label.
    for (const sentence of ["SAMPLE DATA:", "SAMPLE DATA.", "“SAMPLE DATA”"]) {
      expect(withholdNarration(sentence, watcher)).toMatchObject({ status: "withheld", reason: "empty", toolResult: watcher });
    }
  });

  it.each([
    ["note lines holding null", { ...sampleResult("note"), lines: [null] }],
    ["note lines that are not a list", { ...sampleResult("note"), lines: "Q4 trade fair" }],
    ["a tool result that contains itself", (() => {
      const cyclic: Record<string, unknown> = { ...sampleResult("note") };
      cyclic.self = cyclic;
      return cyclic;
    })()],
  ])("never throws on a malformed tool result, and withholds: %s", (_case, toolResult) => {
    const sentence = "SAMPLE DATA: the Q4 trade fair is over budget by 200.";
    expect(() => withholdNarration(sentence, toolResult)).not.toThrow();
    expect(withholdNarration(sentence, toolResult).status).toBe("withheld");
  });

  it("withholds an answer far longer than one short sentence, without reading it", () => {
    const sentence = `SAMPLE DATA: the Q4 trade fair is over budget by 200${", and it is over budget by 200".repeat(40)}.`;
    expect(sentence.length).toBeGreaterThan(1000);
    expectWithheld(sentence, sampleResult("note"), "too_long");
    // The longest SAMPLE DATA narration gemma3:1b writes, with every item over budget, stays well under the cap.
    const allOver =
      "SAMPLE DATA: Google Ads is over budget by 300; Meta Ads is over budget by 100; Q4 trade fair is over budget by 200; Video production is over budget by 100; Marketing software is over budget by 100";
    const everyItemOver = noteAfterSpends(["Google Ads", "3500"], ["Meta Ads", "3300"], ["Video production", "2500"], ["Marketing software", "1300"]);
    expect(withholdNarration(allOver, everyItemOver).status).toBe("narrated");
  });

  it("withholds a sentence that is not text", () => {
    const toolResult = sampleResult("note");
    expect(withholdNarration(200 as unknown as string, toolResult)).toMatchObject({ status: "withheld", reason: "empty", toolResult });
  });

  it.each(["SAMPLE DATA: this is not sample data.", "SAMPLE DATA: the Q4 trade fair is over budget by 200, and this isn't a sample."])(
    "withholds a sentence that says the sample is not a sample: %s",
    (sentence) => {
      expectWithheld(sentence, sampleResult("note"), "denies_sample");
    },
  );

  it.each([
    "SAMPLE DATA: none of this is sample data.",
    "SAMPLE DATA: this data is not from the sample.",
    // The sample is not Paola's real budget.
    "SAMPLE DATA: this is Paola's budget, and the Q4 trade fair is over budget by 200.",
  ])(
    "withholds a sentence that denies the sample in other words: %s",
    (sentence) => {
      expectWithheld(sentence, sampleResult("note"), "denies_sample");
    },
  );

  it("finds nothing false in a negator that is about something other than the sample", () => {
    expectWordingWithheld("SAMPLE DATA: nothing is over budget in this sample.", sampleResult("note", false));
  });
});

describe("withholdNarration: figures", () => {
  it("finds nothing false in a sentence whose figures all appear in the tool result", () => {
    expectWordingWithheld("SAMPLE DATA: 9,800 remains of the 16,700 approved, with 6,900 spent.", remainder);
  });

  it("withholds a figure that is not in the tool result and returns the tool result instead", () => {
    expectWithheld("SAMPLE DATA: 10,000 remains of the 16,700 approved.", remainder, "invented_figure");
  });

  it("reads figures that the tool result stores as text", () => {
    const asText = { bot: "remainder", approvedTotal: "16,700.00", remaining: "9,800.00" };
    expectWordingWithheld("9,800 remains of 16,700.", asText);
  });

  it("treats a figure glued to letters as unverifiable", () => {
    expectWithheld("SAMPLE DATA: 9,800k remains.", remainder, "invented_figure");
  });

  it("checks figures written as words", () => {
    expectWordingWithheld("The Q4 trade fair is over budget by two hundred.", watcher);
    expectWordingWithheld("Google Ads has spent eighteen hundred.", watcherWithLines);
    expectWithheld("The Q4 trade fair is over budget by three hundred.", watcher, "invented_figure");
    expectWithheld("Google Ads has spent nineteen hundred.", watcherWithLines, "invented_figure");
    // A lone "one" is a pronoun, not a figure.
    expectWordingWithheld("The Q4 trade fair is the one item over budget.", watcher);
  });

  it("treats fractions and multiples as figures it cannot check", () => {
    expectWithheld("Google Ads has spent half its budget.", watcherWithLines, "invented_figure");
    expectWithheld("The Q4 trade fair spent twice what Meta Ads did.", watcherWithLines, "invented_figure");
  });

  // 200 is the trade fair's overspend, but 200% is not: it overspent by under 5%.
  it.each([
    "The Q4 trade fair is 200% over budget.",
    "The Q4 trade fair is 200 % over budget.",
    "The Q4 trade fair is over budget by 200 percent.",
    "The Q4 trade fair is over budget by 200 per cent.",
  ])("treats a percentage as a figure it cannot check: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "invented_figure");
  });

  it.each(["The Q4 trade fair has spent thousands.", "The Q4 trade fair is hundreds over budget.", "The Q4 trade fair spent 4,700 cents."])(
    "treats a vague or rescaled amount as a figure it cannot check: %s",
    (sentence) => {
      expectWithheld(sentence, sampleResult("note"), "invented_figure");
    },
  );

  // The trade fair is over budget by exactly 200 and spent exactly 4,700: a bound is not the figure.
  it.each([
    "SAMPLE DATA: the Q4 trade fair is over budget by more than 200.",
    "SAMPLE DATA: the Q4 trade fair is over budget by over 200.",
    "SAMPLE DATA: the Q4 trade fair is more than 200 over budget.",
    "SAMPLE DATA: the Q4 trade fair spent more than 4,700.",
    "SAMPLE DATA: the Q4 trade fair spent less than €4,700.",
    "SAMPLE DATA: the Q4 trade fair is over budget by in excess of 200.",
    "SAMPLE DATA: the Q4 trade fair is over budget by upwards of 200.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200+.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200 or more.",
    "SAMPLE DATA: the Q4 trade fair spent > 4,700.",
    "SAMPLE DATA: the Q4 trade fair spent ≥ 4,700.",
  ])("treats a bounded figure as one it cannot check: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "invented_figure");
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair is 200 over budget.",
    "SAMPLE DATA: the Q4 trade fair spent 200 more than approved.",
    "SAMPLE DATA: the Q4 trade fair spent 4,700, over its 4,500 approved budget.",
  ])("finds nothing false in a comparison that holds its own figure exactly: %s", (sentence) => {
    expectWordingWithheld(sentence, sampleResult("note"));
  });

  // Tool result figures are in cents, so a finer figure is not one of them, however it rounds.
  it.each([
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200.001.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 199.999.", sampleResult("note")],
    // Meta Ads spent 3,200.50 of 3,200: over by 0.50.
    ["SAMPLE DATA: Meta Ads is over budget by 0.499.", noteAfterSpend("Meta Ads", "3200.50")],
  ])("treats a figure finer than cents as one it cannot check: %s", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "invented_figure");
  });

  it("reads cents and trailing zeros", () => {
    const sentence = "SAMPLE DATA: Meta Ads is over budget by 0.50; the Q4 trade fair is over budget by 200.";
    expect(withholdNarration(sentence, noteAfterSpend("Meta Ads", "3200.50")).status).toBe("narrated");
    expectWordingWithheld("SAMPLE DATA: the Q4 trade fair is over budget by 200.000.", sampleResult("note"));
  });

  // A sentence can state a figure with no digits: "nothing has been spent" says 0 is spent. 6,900 is.
  it.each([
    "SAMPLE DATA: nothing has been spent.",
    "SAMPLE DATA: no money is left.",
    "SAMPLE DATA: none of the budget remains.",
    "SAMPLE DATA: nothing remains overall.",
  ])("checks a figure said without digits: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "invented_figure");
  });

  // "The whole budget" is the 16,700 approved: it has not all been spent, and it does not all remain.
  it.each([
    "SAMPLE DATA: the entire budget has been spent.",
    "SAMPLE DATA: all of the budget is spent.",
    "SAMPLE DATA: the whole budget is used.",
    "SAMPLE DATA: the whole budget remains.",
  ])("checks the whole budget said without digits: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "misread_figure");
  });

  it("finds nothing false in a figure said without digits that the tool result has", () => {
    // With no spends logged, 0 is what was spent and the whole 16,700 remains.
    expectWordingWithheld("SAMPLE DATA: nothing has been spent.", sampleResult("note", false));
    expectWordingWithheld("SAMPLE DATA: the whole budget remains.", sampleResult("note", false));
    expectWordingWithheld("SAMPLE DATA: the Q4 trade fair has exceeded its entire approved budget by 200.", sampleResult("note"));
  });

  it("treats a count of items as a figure it cannot check", () => {
    expectWithheld("SAMPLE DATA: the Q4 trade fair is one of 200 items over budget.", sampleResult("note"), "invented_figure");
  });

  it("does not read digits inside an item name as figures", () => {
    expectWordingWithheld("SAMPLE DATA: the Q4 trade fair spent 4,700 of 4,500 approved.", watcher);
    expectWordingWithheld("SAMPLE DATA: the Q4 fair spent 4,700.", watcher);
    const kickoff = { bot: "ledger", lines: [{ category: "Events", item: "2026 kickoff", approved: 900 }] };
    expectWordingWithheld("The 2026 kickoff has 900 approved.", kickoff);
  });
});

describe("withholdNarration: over budget", () => {
  it.each(watcherShapes)("keeps an over-budget claim about the item on the overBudget list (%s)", (_shape, toolResult) => {
    const sentence = "SAMPLE DATA: the Q4 trade fair is over budget by 200.";
    expect(withholdNarration(sentence, toolResult)).toEqual({ status: "narrated", sentence, toolResult });
  });

  it.each(watcherShapes)(
    "withholds the known failure: Google Ads over by 200 when only the trade fair is over (%s)",
    (_shape, toolResult) => {
      // 200 is a real figure here: it is the trade fair's overspend. Only the item is wrong.
      expectWithheld("Google Ads is over by 200.", toolResult, "not_over_budget");
    },
  );

  it.each([
    "The trade fair went 200 over its approved 4,500.",
    "Over budget: Q4 trade fair, by 200.",
    "The Q4 trade fair has exceeded its budget by 200.",
    "Paola, the trade fair's spending is 200 over budget.",
    "The Q4 trade fair is currently over budget by 200, having spent 4,700 of its 4,500 approved.",
  ])("finds nothing false in other phrasings that blame only the listed item: %s", (sentence) => {
    expectWordingWithheld(sentence, watcherWithLines);
  });

  it("withholds an over-budget claim that adds an item the watcher did not list", () => {
    const sentence = "Google Ads and the Q4 trade fair are over budget.";
    expectWithheld(sentence, watcher, "not_over_budget");
    expectWithheld(sentence, watcherWithLines, "not_over_budget");
    expectWithheld("The Q4 trade fair and travel are over budget by 200.", watcher, "not_over_budget");
  });

  it("withholds any over-budget claim when no overBudget list says so", () => {
    expectWithheld("SAMPLE DATA: the trade fair is over budget.", remainder, "not_over_budget");
    expectWithheld("The trade fair is over budget.", { bot: "watcher", overBudget: [] }, "not_over_budget");
  });

  it.each(["Google Ads blew its budget by 200.", "Google Ads has a deficit of 200.", "Google Ads went past its budget by 200."])(
    "withholds other ways of calling an item over budget: %s",
    (sentence) => {
      expectWithheld(sentence, watcherWithLines, "not_over_budget");
    },
  );

  it("does not let a name in the tool result swallow the words 'over budget'", () => {
    const labelled = { ...watcherWithLines, label: "Over budget" };
    expectWithheld("Google Ads is over budget by 200.", labelled, "not_over_budget");
  });

  it("withholds a pronoun that points at nothing named before it", () => {
    expectWithheld("They are over budget by 200, and so is the Q4 trade fair.", watcher, "unknown_item");
    expectWithheld("It is over budget by 200, and so is the Q4 trade fair.", watcher, "unknown_item");
    // "It looks like" stands for nothing, so it hides no item.
    expectWordingWithheld("It looks like the Q4 trade fair is over budget by 200.", watcher);
  });

  it("reads 'it' and 'they' as the items named in the clause before", () => {
    expectWordingWithheld("SAMPLE DATA: the Q4 trade fair spent 4,700; it is over budget by 200.", sampleResult("note"));
    const sentence = "SAMPLE DATA: Meta Ads and the Q4 trade fair spent 3,300 and 4,700; they are over budget.";
    expectWordingWithheld(sentence, twoOverNote());
    expectWithheld("SAMPLE DATA: Meta Ads spent 3,300; it is over budget by 200.", twoOverNote(), "wrong_item");
  });

  it("finds nothing false in a true narration that lists over-budget items with 'including'", () => {
    // gemma3:1b wrote this for the SAMPLE DATA note result after a 1,000,000 Google Ads spend.
    const sentence =
      "SAMPLE DATA: The tool computed over-budget items for Paola, including Google Ads being over budget by 996800 and Q4 trade fair being over budget by 200.";
    expectWordingWithheld(sentence, noteAfterSpend("Google Ads", "1000000"));
  });

  it("finds nothing false in a sentence that names other items without calling them over budget", () => {
    const sentence = "Google Ads has spent 1,800 of 5,000 approved.";
    expectWordingWithheld(sentence, watcherWithLines);
  });

  // One word of a longer name says more than the item: "marketing is over budget" reads as all of marketing.
  it.each([
    // Marketing software spent 1,300 of 1,200.
    ["SAMPLE DATA: marketing is over budget by 100.", noteAfterSpend("Marketing software", "1300")],
    ["SAMPLE DATA: the ads are over budget by 100.", twoOverNote()],
    // Video production spent 3,000 of 2,800.
    ["SAMPLE DATA: production is over budget by 200.", noteAfterSpend("Video production", "2600")],
  ])("withholds one generic word of a longer item name: %s", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "not_over_budget");
  });

  // A name cut short of its last word names something else: "the Q4 trade show" is not the Q4 trade fair.
  it.each(["SAMPLE DATA: the Q4 trade show is over budget by 200.", "SAMPLE DATA: the Q4 trade budget is over by 200."])(
    "withholds a name that drops the item's last word: %s",
    (sentence) => {
      expect(withholdNarration(sentence, sampleResult("note")).status).toBe("withheld");
    },
  );

  it("keeps the item's whole name", () => {
    // Marketing software spent 1,300 of 1,200; the trade fair is over by 200 too.
    const toolResult = noteAfterSpend("Marketing software", "1300");
    const sentence = "SAMPLE DATA: Marketing software is over budget by 100; the Q4 trade fair is over budget by 200.";
    expect(withholdNarration(sentence, toolResult).status).toBe("narrated");
    expectWordingWithheld("SAMPLE DATA: the marketing software line is over budget by 100.", toolResult);
  });
});

describe("withholdNarration: a category is not an item", () => {
  // In twoOverNote, Meta Ads is over budget but its category is not: Digital advertising has
  // 5,100 spent of 8,200 approved (Google Ads 1,800 of 5,000, Meta Ads 3,300 of 3,200).
  // A note result holds only the over-budget lines, so it cannot back a claim about a category.
  it.each([
    "SAMPLE DATA: Digital advertising is over budget by 100.",
    "SAMPLE DATA: The Digital advertising category is over budget.",
    "SAMPLE DATA: Digital advertising and Events are over budget by 100 and 200.",
    // gemma3:1b wrote these three for the SAMPLE DATA note result.
    "Hi Paola, just wanted to let you know that the Digital advertising and Events categories have exceeded their budgets by $100 and $200, respectively!",
    "SAMPLE DATA: Digital advertising overspend 100, Events overspend 200",
    "Paola’s budget tool showed that the Digital advertising category exceeded its approved amount by 100, while the Events category was overspent by 200, resulting in a remaining amount of 6500, and the overall remaining amount is 6500.",
  ])("withholds an over-budget claim about a category: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "not_over_budget");
  });

  it("withholds a line's figure given to its category", () => {
    expectWithheld("SAMPLE DATA: Digital advertising spent 3,300.", twoOverNote(), "wrong_item");
  });

  it.each([
    "SAMPLE DATA: Meta Ads, in Digital advertising, is over budget by 100.",
    "SAMPLE DATA: The Q4 trade fair (Events) is over budget by 200.",
    "SAMPLE DATA: The Q4 trade fair event is over budget by 200.",
    "SAMPLE DATA: the Q4 trade fair in Events is over budget by 200.",
    "SAMPLE DATA: Meta Ads (Digital advertising) and the Q4 trade fair (Events) are over budget by 100 and 200.",
  ])("finds nothing false in a category named alongside its over-budget item: %s", (sentence) => {
    expectWordingWithheld(sentence, twoOverNote());
  });

  // Listed beside its item as one more name, a category is said to be over budget itself.
  it.each([
    "SAMPLE DATA: the Q4 trade fair and Events are each over budget by 200.",
    "SAMPLE DATA: the Q4 trade fair, Events, and Meta Ads are over budget.",
  ])("withholds a category listed as if it were another item: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "not_over_budget");
  });

  // An aside qualifies the item right before it: Meta Ads is in Digital advertising, not Events.
  it.each([
    "SAMPLE DATA: Meta Ads (Events) and the Q4 trade fair are over budget by 100 and 200.",
    "SAMPLE DATA: Meta Ads, in Events, and the Q4 trade fair are over budget by 100 and 200.",
  ])("withholds a category set beside an item that is not in it: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "wrong_item");
  });
});

describe("withholdNarration: figures belong to their line", () => {
  it.each(watcherShapes.slice(0, 3))("withholds the trade fair's figures given to Google Ads (%s)", (_shape, toolResult) => {
    expectWithheld("Google Ads spent 4,700.", toolResult, "wrong_item");
  });

  it("finds nothing false in a line's figures next to that line, and totals anywhere", () => {
    expectWordingWithheld("SAMPLE DATA: the Q4 trade fair is over budget by 200; it spent 4,700.", watcher);
    const withTotals = { ...watcherWithLines, approvedTotal: 16700, spentTotal: 6900 };
    expectWordingWithheld("Google Ads has 5,000 approved, out of 16,700 in total.", withTotals);
  });

  // The note result's totals are 16,700 approved, 6,900 spent, and 9,800 remaining.
  it.each([
    "The Q4 trade fair has 9,800 remaining.",
    "SAMPLE DATA: the Q4 trade fair spent 6,900.",
    "The Q4 trade fair has 16,700 approved.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200; it spent 6,900.",
    "The Q4 trade fair, which spent 6,900, is over budget by 200.",
    "The Q4 trade fair is over budget by 200, with 9,800 remaining.",
  ])("withholds a total given to one item: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "wrong_item");
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair is over budget by 200; you have 9,800 left.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200. Overall, 9,800 remains.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200, with 9,800 remaining in total.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200, and the total spent is 6,900.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200, leaving 9,800 overall.",
  ])("finds nothing false in a total said about the whole budget: %s", (sentence) => {
    expectWordingWithheld(sentence, sampleResult("note"));
  });

  // A phrase about the whole budget, or about Paola's, takes only totals: 4,700 and -200 are the trade fair's.
  it.each([
    "SAMPLE DATA: the Q4 trade fair is over budget by 200, and the total spent is 4,700.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200; you have -200 left.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200, leaving -200 overall.",
  ])("withholds one item's figure given as a total: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "wrong_item");
  });

  it("gives the total overspend to an item only when that item is the whole list", () => {
    const twoNames = { bot: "watcher", overBudget: ["Q4 trade fair", "Meta Ads"], totalOver: 300 };
    expectWithheld("The Q4 trade fair is over budget by 300.", twoNames, "wrong_item");
  });

  it.each([
    "SAMPLE DATA: Meta Ads is over budget by 200, and the Q4 trade fair by 100.",
    "Meta Ads is over budget by 200 and the Q4 trade fair is over budget by 100.",
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget by 100 each.",
  ])("withholds figures swapped between two over-budget items: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "wrong_item");
  });

  it("finds nothing false in 'each' when no figure is shared out", () => {
    expectWordingWithheld("SAMPLE DATA: Meta Ads and the Q4 trade fair are each over budget.", twoOverNote());
  });

  it.each([
    "SAMPLE DATA: Meta Ads is over budget by 100, and the Q4 trade fair by 200.",
    // gemma3:1b wrote this one for the SAMPLE DATA note result.
    "SAMPLE DATA: Meta Ads overbudget by 100, Q4 trade fair overbudget by 200",
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget by 100 and 200.",
  ])("finds nothing false in each over-budget item's own figure: %s", (sentence) => {
    expectWordingWithheld(sentence, twoOverNote());
  });

  // Names listed together take their figures in the same order: Meta Ads is over by 100 and spent 3,300.
  it.each([
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget by 200 and 100.",
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget by 200 and 100, respectively.",
    "SAMPLE DATA: Meta Ads and the Q4 trade fair spent 4,700 and 3,300.",
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget; they spent 4,700 and 3,300.",
  ])("withholds figures given to names in the wrong order: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "wrong_item");
  });

  it.each([
    "SAMPLE DATA: Meta Ads and the Q4 trade fair spent 3,300 and 4,700.",
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget; they spent 3,300 and 4,700.",
    // One line named twice, by item and by category, still holds both of its figures.
    "SAMPLE DATA: the Q4 trade fair event spent 4,700 and went over by 200.",
    // An aside does not cut the list: Meta Ads still takes the first figure.
    "SAMPLE DATA: Meta Ads (Digital advertising) and the Q4 trade fair are over budget by 100 and 200.",
    "SAMPLE DATA: Meta Ads, in Digital advertising, and the Q4 trade fair are over budget by 100 and 200.",
  ])("finds nothing false in figures given to names in the same order: %s", (sentence) => {
    expectWordingWithheld(sentence, twoOverNote());
  });

  // One figure after several names is said of each of them: Meta Ads is over by 100, the trade fair by 200.
  it.each([
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget by 100.",
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget by 200.",
    "SAMPLE DATA: Meta Ads (Digital advertising) and the Q4 trade fair are over budget by 200 and 200.",
  ])("withholds one figure given to names that do not all have it: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "wrong_item");
  });

  // Meta Ads spent 3,300 (over by 100), Video production 2,900 (over by 100), the trade fair 4,700 (over by 200).
  const threeOver = () => noteAfterSpends(["Meta Ads", "3300"], ["Video production", "2500"]);

  it.each([
    "SAMPLE DATA: Meta Ads, Video production, and the Q4 trade fair are over budget by 100, 100, and 200.",
    "SAMPLE DATA: Meta Ads, the Q4 trade fair, and Video production are over budget; they spent 3,300, 4,700, and 2,900.",
  ])("finds nothing false in a list of figures written with commas, in the order of their names: %s", (sentence) => {
    expectWordingWithheld(sentence, threeOver());
  });

  it.each([
    "SAMPLE DATA: Meta Ads, Video production, and the Q4 trade fair are over budget by 200, 100, and 100.",
    "SAMPLE DATA: Meta Ads, the Q4 trade fair, and Video production are over budget; they spent 3,300, 2,900, and 4,700.",
  ])("withholds a list of figures written with commas in the wrong order: %s", (sentence) => {
    expectWithheld(sentence, threeOver(), "wrong_item");
  });

  it("finds nothing false in one figure that each name has", () => {
    // Video production spent 3,000 of 2,800: it and the trade fair are both over by 200.
    const sentence = "SAMPLE DATA: the Q4 trade fair and Video production are over budget by 200.";
    expectWordingWithheld(sentence, noteAfterSpend("Video production", "2600"));
  });

  it.each([
    // A phrase that opens with its figure goes on with the phrase before it.
    "SAMPLE DATA: Meta Ads is over budget, and the Q4 trade fair is over budget, by 100.",
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget, by 200 and 100.",
    "SAMPLE DATA: over budget: Meta Ads, by 200; the Q4 trade fair, by 100.",
    // A phrase with no names before it is about the names after it.
    "SAMPLE DATA: by 100, the Q4 trade fair is over budget, and so is Meta Ads.",
  ])("withholds a nameless phrase's figure that belongs to another item: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "wrong_item");
  });

  it.each([
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget, by 100 and 200.",
    // The totals: 16,700 approved, 10,200 spent, 6,500 remaining.
    "SAMPLE DATA: 16,700 approved, 10,200 spent, 6,500 remaining, and Meta Ads is over budget by 100.",
    "SAMPLE DATA: the Q4 trade fair: 4,700 spent, 4,500 approved, 200 over.",
  ])("finds nothing false in a nameless phrase's figure that belongs to its subject or to the whole budget: %s", (sentence) => {
    expectWordingWithheld(sentence, twoOverNote());
  });

  // "Is over budget by 100" after "the trade fair, like Meta Ads," is said about the trade fair, not Meta Ads.
  it.each([
    "SAMPLE DATA: the Q4 trade fair, like Meta Ads, is over budget by 100.",
    "SAMPLE DATA: Meta Ads, with the Q4 trade fair, is over budget by 200.",
    "SAMPLE DATA: the Q4 trade fair, like Meta Ads, exceeded its budget by 100.",
    "SAMPLE DATA: Meta Ads and the Q4 trade fair, as listed, are over budget by 200 and 100.",
    "SAMPLE DATA: the Q4 trade fair (Meta Ads) is over budget by 100.",
  ])("withholds a predicate's figure that its subject does not have: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "wrong_item");
  });

  it.each([
    "SAMPLE DATA: Meta Ads and the Q4 trade fair, as listed, are over budget by 100 and 200.",
    "SAMPLE DATA: Meta Ads is over budget by 100, and the Q4 trade fair, in Events, is over budget by 200.",
    "SAMPLE DATA: the Q4 trade fair, which spent 4,700, is over budget by 200.",
    "SAMPLE DATA: the Q4 trade fair (Events) spent 4,700 and went over by 200.",
    // "Which" points past the aside to the trade fair.
    "SAMPLE DATA: the Q4 trade fair (Events), which spent 4,700, is over budget by 200.",
  ])("finds nothing false in a predicate's figure that its subject has: %s", (sentence) => {
    expectWordingWithheld(sentence, twoOverNote());
  });

  // "Like Meta Ads", "and so did Meta Ads", "Meta Ads, too" say the same of Meta Ads: its own figures must back it.
  it.each([
    "SAMPLE DATA: the Q4 trade fair, like Meta Ads, is over budget by 200.",
    "SAMPLE DATA: by 200, the Q4 trade fair is over budget, and so is Meta Ads.",
    "SAMPLE DATA: Meta Ads spent 3,300, and so did the Q4 trade fair.",
    "SAMPLE DATA: Meta Ads is over budget by 100, as is the Q4 trade fair.",
    "SAMPLE DATA: Meta Ads is over budget by 100; the Q4 trade fair, too.",
  ])("withholds what is said again of a name whose figures do not back it: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "wrong_item");
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair, with Meta Ads, is over budget by 200.",
    "SAMPLE DATA: Meta Ads is over budget by 100; so is the Q4 trade fair.",
    "SAMPLE DATA: Meta Ads spent 3,300; so did the Q4 trade fair.",
    "SAMPLE DATA: the Q4 trade fair spent 4,700, and Meta Ads did too.",
  ])("withholds what is said again of a name in other words: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "wrong_item");
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair is over budget by 200, and so is the overall budget.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200, and so are you.",
  ])("checks what is said again of the whole budget: %s", (sentence) => {
    // 9,800 of the whole budget remains: it is not over.
    expectWithheld(sentence, sampleResult("note"), "contradicts_watcher");
  });

  it.each(["SAMPLE DATA: Meta Ads is over budget; so is the Q4 trade fair.", "SAMPLE DATA: Meta Ads, with 3,300 spent, is over budget by 100."])(
    "finds nothing false in what is said again of a name that it is true of: %s",
    (sentence) => {
      expectWordingWithheld(sentence, twoOverNote());
    },
  );

  it.each([
    "SAMPLE DATA: the Q4 trade fair is over budget by 200; Digital advertising, too.",
    "SAMPLE DATA: Meta Ads is over budget by 100; so is Digital advertising.",
    "SAMPLE DATA: Meta Ads, with Digital advertising, is over budget by 100.",
    "SAMPLE DATA: Meta Ads, like Digital advertising, is over budget.",
    "SAMPLE DATA: Meta Ads, like Digital advertising, is over budget by 100.",
  ])("withholds 'too' or 'like' that calls a category over budget: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "not_over_budget");
  });

  it.each([
    ["SAMPLE DATA: Meta Ads is over budget, and so is the Q4 trade fair.", twoOverNote()],
    ["SAMPLE DATA: Meta Ads is over budget; the Q4 trade fair, too.", twoOverNote()],
    // Video production spent 3,000 of 2,800: it and the trade fair are both over by 200.
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200, as is Video production.", noteAfterSpend("Video production", "2600")],
  ])("finds nothing false in what is said again of a name whose figures back it: %s", (sentence, toolResult) => {
    expectWordingWithheld(sentence, toolResult);
  });

  // "&" lists names like "and"; two names side by side are two lines, not one.
  it.each([
    "SAMPLE DATA: Meta Ads & Q4 trade fair are over budget by 200 and 100.",
    "SAMPLE DATA: Meta Ads & Q4 trade fair are over budget by 200.",
    "SAMPLE DATA: Meta Ads Q4 trade fair are over budget by 200 and 100.",
  ])("withholds figures that cannot be paired with their names: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "wrong_item");
  });

  it("withholds three names given two figures, which cannot be told apart", () => {
    // Video production spent 2,900 of 2,800: Meta Ads, Video production, and the trade fair are over by 100, 100, and 200.
    const sentence = "SAMPLE DATA: Meta Ads, Video production, and the Q4 trade fair are over budget by 200 and 100, respectively.";
    expectWithheld(sentence, noteAfterSpends(["Meta Ads", "3300"], ["Video production", "2500"]), "wrong_item");
  });

  it("finds nothing false in '&' between names that take their figures in order", () => {
    expectWordingWithheld("SAMPLE DATA: Meta Ads & the Q4 trade fair are over budget by 100 and 200.", twoOverNote());
  });

  // 6,900 and 9,800 are the whole budget's spending and remaining; the trade fair spent 4,700.
  it.each([
    "SAMPLE DATA: after spending 6,900, the Q4 trade fair is over budget by 200.",
    "SAMPLE DATA: by 16,700, the Q4 trade fair is over budget.",
    "SAMPLE DATA: at 9,800 remaining, the Q4 trade fair is over budget by 200.",
    "SAMPLE DATA: by spending 6,900, the Q4 trade fair went over budget by 200.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200; it has 9,800 left overall.",
  ])("binds a leading phrase, or 'it', to its item, never to a total: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "wrong_item");
  });

  it.each([
    "SAMPLE DATA: after spending 4,700, the Q4 trade fair is over budget by 200.",
    // "Of the 16,700 approved" is a part of the whole budget, not the trade fair's own figure.
    "SAMPLE DATA: of the 16,700 approved, the Q4 trade fair spent 4,700.",
  ])("finds nothing false in a leading phrase that is the item's own, or a part of the whole: %s", (sentence) => {
    expectWordingWithheld(sentence, sampleResult("note"));
  });

  it("binds a leading 'having spent' to the item after it, never to a total", () => {
    // 6,900 is everything spent; the trade fair spent 4,700.
    expectWithheld("SAMPLE DATA: having spent 6,900, the Q4 trade fair is over budget by 200.", sampleResult("note"), "wrong_item");
    expectWordingWithheld("SAMPLE DATA: having spent 4,700, the Q4 trade fair is over budget by 200.", sampleResult("note"));
  });

  it("reads 'its budget of N' as the approved amount even after 'spent'", () => {
    expectWithheld("SAMPLE DATA: the Q4 trade fair spent its budget of 4,700.", sampleResult("note"), "misread_figure");
    expectWordingWithheld("SAMPLE DATA: the Q4 trade fair spent its budget of 4,500 and 200 more.", sampleResult("note"));
  });

  it("withholds a category aside that is not the item's own, in any claim", () => {
    expectWithheld("SAMPLE DATA: Meta Ads (Events) spent 3,300.", twoOverNote(), "wrong_item");
    expectWordingWithheld("SAMPLE DATA: Meta Ads (Digital advertising) spent 3,300.", twoOverNote());
  });

  it.each(["SAMPLE DATA: is the Q4 trade fair over budget? No.", "SAMPLE DATA: is the Q4 trade fair over budget by 200?"])(
    "withholds a question, which narrates nothing: %s",
    (sentence) => {
      expectWithheld(sentence, sampleResult("note"), "question");
    },
  );

  // Every item over budget: 16,700 approved, 17,500 spent, -800 remaining. On the base sample, 9,800 remains.
  const everyItemOver = () =>
    noteAfterSpends(["Google Ads", "3500"], ["Meta Ads", "3300"], ["Video production", "2500"], ["Marketing software", "1300"]);

  it.each([
    ["SAMPLE DATA: overall, you are within budget.", everyItemOver()],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200; overall, you are still within budget.", noteAfterSpend("Google Ads", "1000000")],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200, and the whole budget is over.", sampleResult("note")],
    ["SAMPLE DATA: Google Ads is over budget by 300, but overall you are within budget.", everyItemOver()],
  ])("checks a claim about the whole budget against what remains of it: %s", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "contradicts_watcher");
  });

  // With no comma, "but you are over budget" shares a phrase with the item; 9,800 remains on the base sample.
  it.each([
    ["SAMPLE DATA: the Q4 trade fair is over budget but you are over budget.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair spent 4,700 and overall you are over budget.", sampleResult("note")],
    ["SAMPLE DATA: Google Ads is over budget by 300 while you are within budget.", everyItemOver()],
  ])("checks a claim about the whole budget that shares a phrase with an item: %s", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "contradicts_watcher");
  });

  // "Q4 trade fair, all in all, you have money left" reads as the trade fair having money left: it is 200 over.
  it.each([
    ["SAMPLE DATA: Q4 trade fair, all in all, you have money left.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair, but overall you are within budget.", sampleResult("note")],
    ["SAMPLE DATA: Q4 trade fair but overall, you have money left.", sampleResult("note")],
    ["SAMPLE DATA: Meta Ads, you are over budget.", everyItemOver()],
    ["SAMPLE DATA: the Q4 trade fair spent 4,700; it, but overall you have money left.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair spending, but overall you have money left.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair approved, but overall you are within budget.", sampleResult("note")],
  ])("withholds an item named with nothing said of it but the whole budget: %s", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "unclear_item");
  });

  it.each([
    ["SAMPLE DATA: the Q4 trade fair spent 4,700, but you have money left.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200 and you have money left.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair spent 4,700; it is over budget by 200 and you have money left.", sampleResult("note")],
    ["SAMPLE DATA: Google Ads is over budget by 300, and still, overall, you are over budget.", everyItemOver()],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200, but, overall, you are within budget.", sampleResult("note")],
  ])("finds nothing false in an item claim beside a true claim about the whole budget: %s", (sentence, toolResult) => {
    expectWordingWithheld(sentence, toolResult);
  });

  it("withholds a claim about the whole budget set inside an item's phrase", () => {
    // Read inside "the Q4 trade fair, ..., is", it says you are within budget at the trade fair, which is 200 over.
    const sentence = "SAMPLE DATA: the Q4 trade fair, where you are within budget, is over budget by 200.";
    expect(withholdNarration(sentence, sampleResult("note")).status).toBe("withheld");
  });

  // The tool result says what the whole budget is now, never what it will be or was.
  it.each([
    ["SAMPLE DATA: overall, you will be within budget.", sampleResult("note")],
    ["SAMPLE DATA: overall, you were within budget before.", sampleResult("note")],
    ["SAMPLE DATA: overall, you were within budget.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200, but overall you were within budget.", sampleResult("note")],
    ["SAMPLE DATA: overall, you will be over budget.", everyItemOver()],
    ["SAMPLE DATA: the whole budget would be within budget.", sampleResult("note")],
    ["SAMPLE DATA: overall you used to be within budget.", sampleResult("note")],
    ["SAMPLE DATA: you should be within budget overall.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200, but overall you will be within budget.", sampleResult("note")],
  ])("withholds a guess or another time for the whole budget: %s", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "contradicts_watcher");
  });

  it.each([
    ["SAMPLE DATA: Paola is not over budget.", everyItemOver()],
    ["SAMPLE DATA: you have money left.", everyItemOver()],
  ])("checks Paola's whole budget against what remains of it: %s", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "contradicts_watcher");
  });

  it("reads 'over-budget items for Paola' as about items, which it never names", () => {
    // gemma3:1b wrote this after a 1,000,000 Google Ads spend, which puts the whole budget over too.
    const sentence = "SAMPLE DATA: The tool computed over-budget items for Paola.";
    expectWithheld(sentence, noteAfterSpend("Google Ads", "1000000"), "not_over_budget");
  });

  it.each([
    ["SAMPLE DATA: overall, you are within budget.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200; overall, you are still within budget.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200, but overall you are within budget.", sampleResult("note")],
    ["SAMPLE DATA: overall, you are over budget by 800.", everyItemOver()],
    ["SAMPLE DATA: Paola is not over budget.", sampleResult("note")],
    ["SAMPLE DATA: you have money left.", sampleResult("note")],
  ])("finds nothing false in a true claim about the whole budget: %s", (sentence, toolResult) => {
    expectWordingWithheld(sentence, toolResult);
  });

  // The trade fair's spending (4,700) exceeds its budget (4,500), not the other way round.
  it.each([
    "SAMPLE DATA: the Q4 trade fair's budget exceeds its spending by 200.",
    "SAMPLE DATA: the Q4 trade fair's approved budget is 200 higher than its spending.",
  ])("withholds an overspend turned the wrong way round: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "contradicts_watcher");
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair's spending exceeds its budget by 200.",
    "SAMPLE DATA: the Q4 trade fair's spending is 200 higher than its approved budget.",
  ])("finds nothing false in an overspend the right way round: %s", (sentence) => {
    expectWordingWithheld(sentence, sampleResult("note"));
  });
});

describe("withholdNarration: a figure keeps its meaning", () => {
  // The trade fair: 4,500 approved, 4,700 spent, -200 remaining, 200 over. Totals: 9,800 remaining.
  it.each([
    "The Q4 trade fair has 200 remaining.",
    "The Q4 trade fair has 200 left.",
    "The Q4 trade fair spent 4,500 of its 4,700 approved.",
    "The Q4 trade fair has an approved budget of 4,700.",
    "The Q4 trade fair is over budget by 4,700.",
    "SAMPLE DATA: 9,800 is spent so far.",
    "SAMPLE DATA: -9,800 remains.",
  ])("withholds an approved, spent, remaining, or over figure used as another: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "misread_figure");
  });

  it.each([
    "The Q4 trade fair is over its approved budget by 200.",
    "SAMPLE DATA: the Q4 trade fair spent 4,700 against 4,500 approved, 200 over.",
    "SAMPLE DATA: the Q4 trade fair has spent 4,700, which is 200 more than its 4,500 approved.",
    "SAMPLE DATA: 9,800 remains of the 16,700 approved.",
    "SAMPLE DATA: the Q4 trade fair has a remaining amount of -200.",
    // gemma3:1b wrote this one for the SAMPLE DATA note result.
    "SAMPLE DATA: Q4 trade fair, spent > approved by 200",
    "SAMPLE DATA: Q4 trade fair overspend: 200",
  ])("finds nothing false in each figure with its own meaning: %s", (sentence) => {
    expectWordingWithheld(sentence, sampleResult("note"));
  });

  // "Spent A of B" says B is the approved amount; here 9,800 is what remains, 200 the overspend, 6,900 the spend.
  it.each([
    "SAMPLE DATA: you have spent 6,900 of 9,800.",
    "SAMPLE DATA: the Q4 trade fair spent 4,700 of 200.",
    "SAMPLE DATA: 9,800 remains of 6,900.",
    "SAMPLE DATA: 9,800 of 16,700 has been spent.",
  ])("reads the figure after 'of' as the approved amount: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "misread_figure");
  });

  it.each(["SAMPLE DATA: you have spent 6,900 of 16,700.", "SAMPLE DATA: the Q4 trade fair spent 4,700 out of 4,500."])(
    "finds nothing false in the approved amount after 'of': %s",
    (sentence) => {
      expectWordingWithheld(sentence, sampleResult("note"));
    },
  );

  // Figures listed or gapped after one cue share its meaning: in "over budget by 100 and 4,700", 4,700 is an overspend too.
  it.each([
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget by 100 and 4,700.",
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget by 100 and -200.",
    "SAMPLE DATA: Meta Ads is over budget by 100, and the Q4 trade fair by 4,500.",
    "SAMPLE DATA: Meta Ads is over budget by 100; the Q4 trade fair, by 4,500.",
    "SAMPLE DATA: the Q4 trade fair spent 4,700 and Meta Ads 3,200.",
    "SAMPLE DATA: the Q4 trade fair spent 4,700, and Meta Ads 3,200.",
  ])("gives figures listed after one cue its meaning: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "misread_figure");
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair spent 4,700 and Meta Ads 3,300.",
    "SAMPLE DATA: the Q4 trade fair spent 4,700, and Meta Ads 3,300.",
    // A new "A of B" pair after "and" starts with a part, not a whole.
    "SAMPLE DATA: Meta Ads and the Q4 trade fair spent 3,300 of 3,200 and 4,700 of 4,500.",
    "SAMPLE DATA: Meta Ads is over budget by 100; the Q4 trade fair, by 200.",
    "SAMPLE DATA: over budget: Meta Ads, by 100; the Q4 trade fair, by 200.",
  ])("finds nothing false in figures listed after one cue that have its meaning: %s", (sentence) => {
    expectWordingWithheld(sentence, twoOverNote());
  });

  // In "A of B approved is spent", the cue at the end is about A: 6,900 is what was spent.
  it.each(["SAMPLE DATA: 16,700 of 16,700 approved is spent.", "SAMPLE DATA: 9,800 of 16,700 approved is spent."])(
    "reads a cue at the end as about the part before 'of': %s",
    (sentence) => {
      expectWithheld(sentence, sampleResult("note"), "misread_figure");
    },
  );

  it("finds nothing false in the part before 'of' that the cue at the end is true of", () => {
    expectWordingWithheld("SAMPLE DATA: 6,900 of 16,700 approved is spent.", sampleResult("note"));
  });

  // A heading like "spent:" or "over budget:" says what the figures after it measure.
  it.each([
    ["SAMPLE DATA: spent: Q4 trade fair 4,500.", sampleResult("note")],
    ["SAMPLE DATA: approved: Q4 trade fair 4,700.", sampleResult("note")],
    ["SAMPLE DATA: over budget: Q4 trade fair 4,700.", sampleResult("note")],
    ["SAMPLE DATA: spent: Meta Ads 3,300, the Q4 trade fair 4,500.", twoOverNote()],
    // Video production spent 3,000 of 2,800: both it and the trade fair are over by 200.
    ["SAMPLE DATA: over budget: Q4 trade fair (4,500) and Video production (200).", noteAfterSpend("Video production", "2600")],
  ])("reads what a heading says the figures after it measure: %s", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "misread_figure");
  });

  it.each([
    "SAMPLE DATA: spent: Q4 trade fair 4,700.",
    "SAMPLE DATA: spent: Meta Ads 3,300, the Q4 trade fair 4,700.",
    "SAMPLE DATA: over budget: Meta Ads (100) and the Q4 trade fair (200).",
    "SAMPLE DATA: Meta Ads (100 over) and the Q4 trade fair (200 over) are over budget.",
  ])("finds nothing false in figures that are what their heading says: %s", (sentence) => {
    expectWordingWithheld(sentence, twoOverNote());
  });

  it("withholds a figure that nothing in its clause says the meaning of", () => {
    // "Came in at" says nothing Paola can check; "over budget" is about the trade fair, not 4,500.
    expectWithheld("SAMPLE DATA: the Q4 trade fair came in at 4,500, over budget.", sampleResult("note"), "unexplained_figure");
  });

  it("binds a phrase that opens with what it measures to the item before it", () => {
    // 16,700 is the whole budget's approved amount, not the trade fair's.
    expectWithheld("SAMPLE DATA: Q4 trade fair: approved 16,700, over by 200.", sampleResult("note"), "wrong_item");
    expectWordingWithheld("SAMPLE DATA: Q4 trade fair: approved 4,500, over by 200.", sampleResult("note"));
  });

  // "By N" is the overspend wherever the over word sits, and a role noun reaches past the item it is about.
  it.each([
    "SAMPLE DATA: by 4,700, the Q4 trade fair is over budget.",
    "SAMPLE DATA: the overspend on the Q4 trade fair is 4,500.",
    "SAMPLE DATA: the overspend on the Q4 trade fair line is 4,700.",
    "SAMPLE DATA: the approved budget for the Q4 trade fair is 4,700.",
  ])("reads a figure's meaning in another word order: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "misread_figure");
  });

  it.each([
    "SAMPLE DATA: the overspend on the Q4 trade fair is 200.",
    "SAMPLE DATA: the remaining budget for the Q4 trade fair is -200.",
    "SAMPLE DATA: the approved budget for the Q4 trade fair is 4,500.",
  ])("finds nothing false in a figure's meaning in another word order: %s", (sentence) => {
    expectWordingWithheld(sentence, sampleResult("note"));
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair's spending came to 4,700.",
    "SAMPLE DATA: total spending came to 6,900.",
    "SAMPLE DATA: the Q4 trade fair is over budget by about 200.",
    "SAMPLE DATA: the Q4 trade fair's remaining amount is minus 200.",
    // "Spent 200 over" is spent 200 over budget: the word after the figure says it is the overspend.
    "SAMPLE DATA: the Q4 trade fair spent 200 over.",
  ])("reads a figure's meaning across 'came to' and 'about', and 'minus' as its sign: %s", (sentence) => {
    expectWordingWithheld(sentence, sampleResult("note"));
  });

  // Each of these says the figure is two things at once, or the wrong one: the trade fair spent 4,700.
  it.each([
    "SAMPLE DATA: the Q4 trade fair spent minus 200.",
    "SAMPLE DATA: the Q4 trade fair spent 4,700 over.",
    "SAMPLE DATA: the Q4 trade fair spent 4,500 approved.",
    "SAMPLE DATA: the Q4 trade fair has 4,500 approved remaining.",
  ])("withholds a figure given two meanings or a sign it does not have: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "misread_figure");
  });

  // Spending is 6,900 in total; 9,800 is what remains. A limit is the approved amount.
  it.each([
    // gemma3:1b wrote this one when asked to rewrite a true SAMPLE DATA sentence.
    "“We’ve spent $4,700 of the approved budget for the Q4 trade fair, bringing the total expenditure to $9,800.”",
    "SAMPLE DATA: total expenses are 9,800.",
    "SAMPLE DATA: the Q4 trade fair spent 4,700 against a limit of 4,700.",
  ])("reads expenditure as spent and a limit as approved: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "misread_figure");
  });

  it.each(["SAMPLE DATA: total expenses are 6,900.", "SAMPLE DATA: the Q4 trade fair spent 4,700 against a limit of 4,500."])(
    "finds nothing false in expenditure and limits with their own figures: %s",
    (sentence) => {
      expectWordingWithheld(sentence, sampleResult("note"));
    },
  );

  // An item's budget is its approved amount: the trade fair's is 4,500, and the whole budget is 16,700.
  it.each([
    "SAMPLE DATA: the Q4 trade fair's budget is 4,700, and it spent 4,700.",
    "SAMPLE DATA: the Q4 trade fair has a budget of 4,700 and has spent 4,700.",
    "SAMPLE DATA: budget: 9,800, spent: 6,900.",
    "SAMPLE DATA: increase the Q4 trade fair budget to 4,700.",
  ])("reads a budget figure as the approved amount: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "misread_figure");
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair's budget is 4,500, and it spent 4,700.",
    "SAMPLE DATA: the remaining budget is 9,800.",
    "SAMPLE DATA: budget: 16,700, spent: 6,900.",
    // "Over budget" is the overspend, not the budget.
    "SAMPLE DATA: the Q4 trade fair went over budget, 200.",
    // The cue after "16,700" speaks for the part before "of", not the whole.
    "SAMPLE DATA: overall, 6,900 of 16,700 has been spent, leaving 9,800.",
    "SAMPLE DATA: 9,800 of 16,700 remains.",
  ])("finds nothing false in a budget figure that is the approved amount: %s", (sentence) => {
    expectWordingWithheld(sentence, sampleResult("note"));
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair's approved budget should be 4,700.",
    "SAMPLE DATA: the Q4 trade fair's approved budget will be 4,700.",
    "SAMPLE DATA: the approved budget would be 9,800.",
  ])("reads what a figure measures across a modal verb: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "misread_figure");
  });

  // gemma3:1b wrote the first one: the label sits in the phrase before its figure.
  it.each(["SAMPLE DATA: Q4 trade fair, spent, 200", "SAMPLE DATA: Q4 trade fair remaining: 200"])(
    "reads a label across the comma or colon before its figure: %s",
    (sentence) => {
      expectWithheld(sentence, sampleResult("note"), "misread_figure");
    },
  );

  // gemma3:1b wrote the first one with nothing over budget: 16,700 is both approved and remaining there.
  it.each([
    ["SAMPLE DATA: 16700", sampleResult("note", false)],
    ["SAMPLE DATA: Meta Ads 100, Q4 trade fair 200", twoOverNote()],
  ])("withholds a figure with nothing saying what it measures: %s", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "unexplained_figure");
  });

  it("withholds an overspend written below zero, which would mean underspent", () => {
    // gemma3:1b wrote this with the category names; Meta Ads and the trade fair are over by +100 and +200.
    expectWithheld("SAMPLE DATA: Meta Ads overspend -100, Q4 trade fair overspend -200", twoOverNote(), "misread_figure");
    expectWordingWithheld("SAMPLE DATA: Meta Ads overspend 100, Q4 trade fair overspend 200", twoOverNote());
  });
});

describe("withholdNarration: only what the tool result has", () => {
  // The SAMPLE DATA note result holds only the Q4 trade fair (Events) and the totals.
  it.each([
    "Keep an eye on Google Ads.",
    "Google Ads spent 6,900.",
    "Meta Ads has 9,800 remaining.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200. Travel and catering drove it.",
  ])("withholds a sentence that names an item the note result does not have: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "unknown_item");
  });

  it.each([
    "SAMPLE DATA: increase the Q4 trade fair budget.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200. Consider moving 200 from Google Ads.",
  ])("withholds advice to change the approved budget: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "unknown_item");
  });

  it.each([
    ["SAMPLE DATA: everything is fine.", sampleResult("note")],
    ["Okay, Paola, great news! The Q4 trade fair is over budget by 200.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is slightly over budget by 200.", sampleResult("note")],
    ["SAMPLE DATA: nothing was overspent this month.", sampleResult("note", false)],
  ])("withholds a judgement the tool result cannot back: %s", (sentence, toolResult) => {
    expect(withholdNarration(sentence, toolResult).status).toBe("withheld");
  });

  // Each of these was written by gemma3:1b for a SAMPLE DATA note result, and each is true.
  it.each([
    ["SAMPLE DATA: The remaining amount is 16700.", sampleResult("note", false)],
    [
      "Paola, the budget tool analysis shows that the total spent was 0, and the remaining amount is 16700, with no items exceeding the approved budget.",
      sampleResult("note", false),
    ],
    [
      "Paola’s budget tool showed that the Q4 trade fair event cost $4700, which is $200 over budget, and the remaining amount is $9800.",
      sampleResult("note"),
    ],
  ])("finds nothing false in a true narration: %s", (sentence, toolResult) => {
    expectWordingWithheld(sentence, toolResult);
  });

  it("finds nothing false in a total said in the same clause as an over-budget claim", () => {
    const sentence = "SAMPLE DATA: the Q4 trade fair is over budget by 200, while 9,800 remains overall.";
    expectWordingWithheld(sentence, sampleResult("note"));
  });

  it("finds nothing false in the CSV's own file name", () => {
    const sentence =
      "Paola, the budget tool analysis shows that the total spent on the sample-presupuesto.csv dataset is zero, and the remaining amount is $16,700, with no items exceeding the approved budget.";
    expectWordingWithheld(sentence, sampleResult("note", false));
  });

  it("withholds a comparison the figures do not back", () => {
    // gemma3:1b wrote this with nothing spent: spent is 0 and approved is 16,700.
    const sentence =
      "Paola, the budget tool analysis shows that the total spent is exactly the approved amount, with no items exceeding the budget, leaving a remaining amount of 16700.";
    expect(withholdNarration(sentence, sampleResult("note", false)).status).toBe("withheld");
  });
});

describe("withholdNarration: what a pointing phrase is about", () => {
  // Each was written by gemma3:1b. A phrase like ", leaving ..." or ", which is ..." is about whatever the
  // phrase before it was about: an item, or the whole budget.
  it.each([
    [
      "Paola’s budget tool showed that the Q4 trade fair event was over budget by 200, with a total spent of 6900 and approved of 16700, leaving a remaining amount of 9800, which is over budget by 200.",
      sampleResult("note"),
    ],
    [
      "Paola’s budget tool showed that the Q4 trade fair event exceeded the approved budget by 200, resulting in a remaining amount of 9800, and the total spent was 6900, leaving a deficit of 200.",
      sampleResult("note"),
    ],
    [
      // gemma3:1b wrote this with the category names Digital advertising and Events.
      "Paola’s budget tool showed that Meta Ads exceeded its approved amount by 100, while the Q4 trade fair was overspent by 200, resulting in a remaining amount of 6500, and the overall remaining amount is 6500.",
      twoOverNote(),
    ],
  ])("withholds a figure that lands on the wrong subject (%#)", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "wrong_item");
  });

  it("finds nothing false in a pointing phrase that stays with its item", () => {
    const sentence =
      "Paola’s budget tool showed that the Q4 trade fair event is over budget, with a spending of 4700 and an approved amount of 4500, resulting in a remaining amount of -200, and it’s over budget by 200.";
    expectWordingWithheld(sentence, sampleResult("note"));
  });
});

describe("withholdNarration: contradicting the watcher", () => {
  const emptyWatcher = { bot: "watcher", isSample: true, overBudget: [] };
  const twoOver = {
    bot: "watcher",
    overBudget: [
      { category: "Events", item: "Q4 trade fair", approved: 4500, spent: 4700, over: 200 },
      { category: "Digital advertising", item: "Meta Ads", approved: 3200, spent: 3300, over: 100 },
    ],
  };

  it.each(["Nothing is over budget.", "No item is over budget.", "Everything is within budget."])(
    "withholds '%s' while the watcher lists an item",
    (sentence) => {
      expectWithheld(sentence, watcher, "contradicts_watcher");
    },
  );

  it("keeps 'no item is over budget' when the watcher list is empty", () => {
    expect(withholdNarration("SAMPLE DATA: no item is over budget.", emptyWatcher).status).toBe("narrated");
  });

  it("withholds a listed item called within budget", () => {
    expectWithheld("The Q4 trade fair is within budget.", watcher, "contradicts_watcher");
    expectWithheld("The Q4 trade fair isn't over budget.", watcher, "contradicts_watcher");
  });

  it("finds nothing false in a sentence that clears an item the watcher did not list", () => {
    expectWordingWithheld("Google Ads is not over budget.", watcherWithLines);
    expectWordingWithheld("Google Ads is within budget.", watcherWithLines);
  });

  it("withholds budget-status claims when the tool result has no overBudget list", () => {
    expectWithheld("Nothing is over budget.", remainder, "contradicts_watcher");
  });

  it("withholds 'only' when the watcher lists other items too", () => {
    const sentence = "Only the Q4 trade fair is over budget, by 200.";
    expectWordingWithheld(sentence, watcher);
    expectWithheld(sentence, twoOver, "contradicts_watcher");
    expectWordingWithheld("The Q4 trade fair and Meta Ads are over budget.", twoOver);
  });

  // The watcher says what is over budget now; a guess, a plan, or another time is not what it says.
  it.each([
    ["SAMPLE DATA: the Q4 trade fair will be over budget by 200.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair could be over budget by 200.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair might go over budget by 200.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair used to be over budget by 200.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair is going to be over budget by 200.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair was over budget by 200 before.", sampleResult("note")],
    ["SAMPLE DATA: no item will be over budget.", sampleResult("note", false)],
  ])("withholds a hedged or time-shifted budget claim: %s", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "contradicts_watcher");
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair was originally over budget by 200.",
    "SAMPLE DATA: the Q4 trade fair had been over budget by 200.",
    "SAMPLE DATA: the Q4 trade fair was then over budget by 200.",
  ])(
    "withholds a budget claim about an earlier time: %s",
    (sentence) => {
      expectWithheld(sentence, sampleResult("note"), "contradicts_watcher");
    },
  );

  // The tool result gives figures, never their causes: these may be false even when every figure is right.
  it.each([
    ["SAMPLE DATA: Meta Ads is over budget by 100 because of the Q4 trade fair.", twoOverNote()],
    ["SAMPLE DATA: the Q4 trade fair spent 4,700, so Meta Ads is over budget by 100.", twoOverNote()],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200, so the whole budget is over.", sampleResult("note")],
    ["SAMPLE DATA: the Q4 trade fair spent 4,700, making Meta Ads over budget by 100.", twoOverNote()],
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200, leaving Meta Ads over budget by 100.", twoOverNote()],
    ["SAMPLE DATA: the Q4 trade fair went over budget by 200 after Meta Ads did.", twoOverNote()],
  ])("withholds a cause the tool result does not state: %s", (sentence, toolResult) => {
    expectWithheld(sentence, toolResult, "unchecked_claim");
  });

  it("finds nothing false in a budget claim in the past tense of a report", () => {
    // The checks read "was over budget" as a report of now; Note still shows only the prompt's own "is".
    expectWordingWithheld("SAMPLE DATA: the Q4 trade fair was over budget by 200.", sampleResult("note"));
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair is already over budget by 200.",
    "SAMPLE DATA: the Q4 trade fair has been over budget by 200.",
    "SAMPLE DATA: so far, the Q4 trade fair has spent 4,700.",
    // "So it" draws on the same item's own figures, each of which is checked.
    "SAMPLE DATA: the Q4 trade fair spent 4,700, so it is over budget by 200.",
  ])("finds nothing false in a budget claim about now: %s", (sentence) => {
    expectWordingWithheld(sentence, sampleResult("note"));
  });

  // Meta Ads is over by 100 and the trade fair by 200.
  it.each([
    "SAMPLE DATA: Meta Ads is over budget by 100; the Q4 trade fair is not.",
    "SAMPLE DATA: Meta Ads is over budget by 100, and no other item is, not even the Q4 trade fair.",
    "SAMPLE DATA: only the Q4 trade fair is over budget, by 200, while Meta Ads spent 3,300.",
    "SAMPLE DATA: the over-budget item is the Q4 trade fair, by 200.",
    "SAMPLE DATA: Meta Ads is over budget by 100, but the Q4 trade fair is on budget.",
  ])("withholds a sentence that denies or leaves out a listed item: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "contradicts_watcher");
  });

  // Meta Ads is over budget too: naming its spending does not make "nothing else" true.
  it.each([
    "SAMPLE DATA: the Q4 trade fair is over budget by 200, Meta Ads has spent 3,300, and nothing else is over budget.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200; Meta Ads spent 3,300; nothing else is over budget.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200 while Meta Ads spent 3,300, and no other item is over budget.",
  ])("counts only the names said to be over budget for 'nothing else': %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "contradicts_watcher");
  });

  it.each([
    "SAMPLE DATA: Meta Ads and the Q4 trade fair are over budget; nothing else is.",
    "SAMPLE DATA: Meta Ads is over budget by 100; the Q4 trade fair is over budget by 200; nothing else is.",
  ])("finds nothing false in 'nothing else' after every listed item is said to be over: %s", (sentence) => {
    expectWordingWithheld(sentence, twoOverNote());
  });

  it("withholds 'the items over budget are' when it leaves one out", () => {
    // Video production spent 2,900 of 2,800: three items are over budget.
    const sentence = "SAMPLE DATA: the items over budget are Meta Ads and the Q4 trade fair.";
    expectWithheld(sentence, noteAfterSpends(["Meta Ads", "3300"], ["Video production", "2500"]), "contradicts_watcher");
    expectWordingWithheld(sentence, twoOverNote());
  });

  it("checks 'it is the only item over budget' against the item 'it' names", () => {
    const sentence = "SAMPLE DATA: the Q4 trade fair is over budget by 200; it is the only item over budget.";
    expectWithheld(sentence, twoOverNote(), "contradicts_watcher");
    expectWordingWithheld(sentence, sampleResult("note"));
  });

  // "It is the only one" says nothing of its own: it repeats "over budget" from the clause before.
  it.each(["SAMPLE DATA: the Q4 trade fair is over budget by 200; it is the only one.", "SAMPLE DATA: the Q4 trade fair is over budget by 200; the only one."])(
    "checks an exclusive remark against the watcher list: %s",
    (sentence) => {
      expect(withholdNarration(sentence, twoOverNote()).status).toBe("withheld");
    },
  );

  it("finds nothing false in '; it is the only one' when it is", () => {
    const sentence = "SAMPLE DATA: the Q4 trade fair is over budget by 200; it is the only one.";
    expectWordingWithheld(sentence, sampleResult("note"));
  });

  it("counts the item 'it' names toward 'nothing else'", () => {
    const sentence = "SAMPLE DATA: the Q4 trade fair spent 4,700; it is over budget by 200, and nothing else is.";
    expectWithheld(sentence, twoOverNote(), "contradicts_watcher");
    expectWordingWithheld(sentence, sampleResult("note"));
  });

  // "It" is one thing: after two items, nobody can tell which one it is.
  it.each([
    "SAMPLE DATA: Meta Ads and the Q4 trade fair spent 3,300 and 4,700; it is the only item over budget.",
    "SAMPLE DATA: Meta Ads and the Q4 trade fair spent 3,300 and 4,700; it is over budget, and nothing else is.",
  ])("withholds 'it' after two items: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "unknown_item");
  });

  it("finds nothing false in 'they' for the items before it", () => {
    const sentence = "SAMPLE DATA: Meta Ads and the Q4 trade fair spent 3,300 and 4,700; they are the only items over budget.";
    expectWordingWithheld(sentence, twoOverNote());
    expectWithheld(sentence, noteAfterSpends(["Meta Ads", "3300"], ["Video production", "2500"]), "contradicts_watcher");
  });

  it.each([
    ["SAMPLE DATA: the Q4 trade fair is over budget by 200 and no other item is.", sampleResult("note")],
    ["SAMPLE DATA: the over-budget item is the Q4 trade fair, by 200.", sampleResult("note")],
    ["SAMPLE DATA: only the Q4 trade fair, by 200, and Meta Ads, by 100, are over budget.", twoOverNote()],
    // "The Meta Ads line" names one line; it does not say it is the only one.
    ["SAMPLE DATA: the Meta Ads line: over budget by 100.", twoOverNote()],
  ])("finds nothing false in a sentence that names the whole list: %s", (sentence, toolResult) => {
    expectWordingWithheld(sentence, toolResult);
  });

  // The trade fair has -200 remaining: it has nothing left to spend.
  it.each([
    "SAMPLE DATA: the Q4 trade fair has money left.",
    "SAMPLE DATA: the Q4 trade fair still has budget available.",
    "SAMPLE DATA: the Q4 trade fair has 200 more to spend.",
    "SAMPLE DATA: the Q4 trade fair is out of the red.",
    "SAMPLE DATA: the Q4 trade fair's overspend is gone.",
  ])("withholds a listed item said to be within budget in other words: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "contradicts_watcher");
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair can still spend.",
    "SAMPLE DATA: the Q4 trade fair has funds left over.",
    "SAMPLE DATA: the Q4 trade fair is out of deficit.",
    "SAMPLE DATA: the Q4 trade fair's deficit is over.",
  ])("withholds other ways of saying a listed item has money left: %s", (sentence) => {
    expectWithheld(sentence, sampleResult("note"), "contradicts_watcher");
  });

  it.each([
    "SAMPLE DATA: the Q4 trade fair is over budget by 200, but Meta Ads still has money left.",
    "SAMPLE DATA: Meta Ads is over budget by 100, but the Q4 trade fair has money left.",
    "SAMPLE DATA: the Q4 trade fair is over budget by 200; Meta Ads, no.",
  ])("withholds money left or a 'no' beside a listed item, next to another claim: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "contradicts_watcher");
  });

  it.each(["SAMPLE DATA: the Q4 trade fair has -200 remaining.", "SAMPLE DATA: the Q4 trade fair has gone over budget by 200."])(
    "finds nothing false in a listed item's true remaining amount and overspend: %s",
    (sentence) => {
      expectWordingWithheld(sentence, sampleResult("note"));
    },
  );

  it("withholds 'just' before a name when the watcher lists other items too", () => {
    const sentence = "Just the Q4 trade fair is over budget, by 200.";
    expectWordingWithheld(sentence, watcher);
    expectWithheld(sentence, twoOver, "contradicts_watcher");
    expectWordingWithheld("Just so you know, the Q4 trade fair is over budget by 200.", twoOver);
  });

  // The tool result gives each item's own figures; it never compares one item with another.
  it.each([
    "SAMPLE DATA: Meta Ads is over budget by more than the Q4 trade fair.",
    "SAMPLE DATA: Meta Ads is over budget by more than the Q4 trade fair is.",
    "SAMPLE DATA: Meta Ads spent less than the Q4 trade fair.",
  ])("withholds a comparison between two items: %s", (sentence) => {
    expectWithheld(sentence, twoOverNote(), "unchecked_comparison");
  });

  it.each([
    "The Q4 trade fair is over budget by 200; no other item is.",
    "The Q4 trade fair is over budget by 200, and nothing else is.",
    "The Q4 trade fair is over budget by 200; the rest are within budget.",
    "The Q4 trade fair is over budget by 200; everything else is within budget.",
  ])("checks 'nothing else' against the whole list: %s", (sentence) => {
    expectWordingWithheld(sentence, watcher);
    expectWithheld(sentence, twoOver, "contradicts_watcher");
  });
});

describe("note prompts", () => {
  /** The prompt's own words, without the tool result JSON. */
  function instructions(toolResult: ReturnType<typeof sampleResult>) {
    return buildNoteUserPrompt(toolResult).replace(JSON.stringify(toolResult, null, 2), "");
  }
  /** Figures standing on their own, so the 4 in "Q4" does not count. */
  function figuresIn(text: string) {
    return text.match(/(?<![\p{L}\p{N}])\d[\d,.]*\d|(?<![\p{L}\p{N}])\d(?![\p{L}\p{N}])/gu) ?? [];
  }

  it("give Gemma no figure of their own in the system prompt", () => {
    expect(buildNoteSystemPrompt()).not.toMatch(/\d/);
  });

  it("put the whole tool result in front of Gemma", () => {
    const toolResult = sampleResult("note");
    expect(buildNoteUserPrompt(toolResult)).toContain(JSON.stringify(toolResult, null, 2));
  });

  // gemma3:1b copies its prompt: told "if lines is empty, say no item is over budget", it said so with the trade fair over.
  it("spell out each over-budget item with its overspend, copied from the tool result", () => {
    const one = instructions(sampleResult("note"));
    expect(one).toContain("Q4 trade fair is over budget by 200");
    expect(figuresIn(one)).toEqual(["200"]);
    const two = instructions(twoOverNote());
    expect(two).toContain("Meta Ads is over budget by 100");
    expect(two).toContain("Q4 trade fair is over budget by 200");
    expect(figuresIn(two)).toEqual(["100", "200"]);
  });

  // Gemma copies the facts the prompt writes out; Note narrates only that shape, so the two must agree.
  it.each([
    ["no spends", sampleResult("note", false)],
    ["the sample spends", sampleResult("note")],
    ["Meta Ads over too", twoOverNote()],
    ["every item over", allOverNote()],
    ["an overspend in cents", noteAfterSpend("Meta Ads", "3200.50")],
    ["a very large overspend", noteAfterSpend("Google Ads", "1000000")],
  ])("write facts that Note narrates when Gemma copies them exactly (%s)", (_case, toolResult) => {
    const facts = /computed in code: (.+?)\. (?:Begin|Write)/i.exec(instructions(toolResult))?.[1];
    expect(facts).toBeDefined();
    const sentence = `SAMPLE DATA: ${facts}.`;
    expect(judgeShape(sentence, toolResult)).toBeNull();
    expect(withholdNarration(sentence, toolResult).status).toBe("narrated");
  });

  it("say that nothing is over budget only when nothing is", () => {
    expect(instructions(sampleResult("note"))).not.toMatch(/no item is over budget/i);
    expect(instructions(twoOverNote())).not.toMatch(/no item is over budget/i);
    expect(instructions(sampleResult("note", false))).toMatch(/no item is over budget/i);
    expect(figuresIn(instructions(sampleResult("note", false)))).toEqual([]);
  });

  it("ask for the SAMPLE DATA label only on sample data", () => {
    expect(instructions(sampleResult("note"))).toContain('Begin with "SAMPLE DATA:"');
    expect(instructions({ ...sampleResult("note"), isSample: false })).not.toContain("SAMPLE DATA");
  });

  it("refuse to prompt Gemma before a tool result exists", () => {
    expect(() => buildNoteUserPrompt(undefined)).toThrow(/tool result/);
    expect(() => buildNoteUserPrompt(null)).toThrow(/tool result/);
  });
});

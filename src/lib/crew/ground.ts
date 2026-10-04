/**
 * Grounding for Note: Gemma's one sentence for Paola is shown only when it is true of the tool
 * result that code computed. Otherwise the tool result is shown with a notice saying why.
 *
 * Two layers, and a sentence must pass both:
 * - judgeSentence reads open English (names, figures and what they measure, over and within
 *   budget, "only", "nothing else", hedges, causes) and picks most withheld reasons.
 * - judgeShape decides what may be shown at all: the over-budget facts as the prompt writes
 *   them, "<item> is over budget by <N>" joined by ";", ",", or "and", every listed item once
 *   at its own overspend; or "No item is over budget" when none is listed. Adversarial review
 *   rounds kept finding false sentences that open-English checks let through, so anything else
 *   is withheld.
 *
 * The facts are read from the tool result itself (overBudgetFacts), and refused when they
 * cannot be told apart or checked to the cent: one name on two lines, amounts of 1e12 or more,
 * or a line name that reads as something else (isPlainName). Widening the shape, the figures,
 * or the names it accepts needs a new adversarial review: each round found what the last missed.
 */
import { money } from "../money";
import type { ToolResult } from "./types";

export type WithheldReason =
  | "no_tool_result"
  | "empty"
  | "invented_figure"
  | "wrong_item"
  | "misread_figure"
  | "not_over_budget"
  | "contradicts_watcher"
  | "unexplained_figure"
  | "unknown_item"
  | "unchecked_comparison"
  | "denies_sample"
  | "unreadable"
  | "too_long"
  | "unchecked_claim"
  | "question"
  | "unclear_item"
  | "unchecked_wording"
  | "unread_name"
  | "unnarrated_budget";

export type Narration<T> =
  | { readonly status: "narrated"; readonly sentence: string; readonly toolResult: T }
  | { readonly status: "withheld"; readonly reason: WithheldReason; readonly message: string; readonly toolResult: T };

const NOTICES: Record<WithheldReason, string> = {
  no_tool_result: "Withheld: Gemma may narrate only after a bot returns a tool result.",
  empty: "Withheld: Gemma returned no sentence.",
  invented_figure: "Withheld: Gemma used a figure that is not in the tool result.",
  wrong_item: "Withheld: Gemma tied a figure to an item it does not belong to.",
  misread_figure: "Withheld: Gemma mixed up approved, spent, remaining, or over-budget amounts.",
  not_over_budget: "Withheld: Gemma called something over budget that the watcher did not list.",
  contradicts_watcher: "Withheld: Gemma’s sentence does not match the watcher’s over-budget list.",
  unexplained_figure: "Withheld: Gemma gave a figure without saying what it measures.",
  unknown_item: "Withheld: Gemma mentioned something that is not in the tool result.",
  unchecked_comparison: "Withheld: Gemma compared one item with another; the tool result gives each item’s own figures only.",
  denies_sample: "Withheld: Gemma said this is not sample data. It is SAMPLE DATA.",
  unreadable: "Withheld: Note could not read this tool result, so it cannot check Gemma’s sentence.",
  too_long: "Withheld: Gemma’s answer is far longer than one short sentence.",
  unchecked_claim: "Withheld: Gemma gave a cause or an order of events the tool result does not state.",
  question: "Withheld: Gemma asked a question instead of narrating the result.",
  unclear_item: "Withheld: Gemma named an item without saying what the tool result shows for it.",
  unchecked_wording:
    "Withheld: Note shows only sentences that name each over-budget item with the amount it is over, as computed.",
  unread_name: "Withheld: Note could not read an item name in Gemma’s sentence well enough to check it.",
  unnarrated_budget: "Withheld: this budget has an item name or amount that Note does not narrate, so it shows the computed result.",
};

/** What a figure measures. A negative remaining is an overspend. */
type Role = "approved" | "spent" | "remaining" | "over";

/** What a tool result lets Gemma say. */
type Grounds = {
  readonly figures: ReadonlySet<string>;
  /** Figures outside any named line, like totals: any clause may use them. */
  readonly shared: ReadonlySet<string>;
  /** Figures inside a named line, with the names of the lines they belong to. */
  readonly owners: ReadonlyMap<string, ReadonlySet<string>>;
  /** What each figure measures, for each line name that holds it ("" for the top level). */
  readonly roles: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<Role>>>;
  /** What remains of the whole budget, below zero when it is over budget; null when the tool result does not say. */
  readonly wholeRemaining: number | null;
  /** The whole budget's approved amount, which "the whole budget" means; null when the tool result does not say. */
  readonly wholeApproved: number | null;
  /** Item and category names, as written in the tool result. */
  readonly names: readonly string[];
  /** The names that name an item, not only a category: a category's own figures are not in the tool result. */
  readonly items: ReadonlySet<string>;
  /** The CSV's file name, which a sentence may quote whole. */
  readonly files: readonly string[];
  /** False when the tool result has no overBudget list, so it says nothing about overspend. */
  readonly hasList: boolean;
  /** Names of each line on the watcher's overBudget list. */
  readonly entries: readonly (readonly string[])[];
  /** Names of every line in the tool result, listed or not: an item and its category share a line. */
  readonly lines: readonly (readonly string[])[];
  readonly listed: ReadonlySet<string>;
};

/** Words that name a known line, with the names of every line they could mean. */
type Mention = {
  readonly kind: "mention";
  readonly owners: readonly string[];
  /** Which of the tool result's lines the words could mean. */
  readonly lines: readonly number[];
};
/** A figure in digits or in words; null when it cannot be checked, like 200k, 4th, or half. */
type Figure = { readonly kind: "figure"; readonly value: number | null };
type Word = { readonly kind: "word"; readonly text: string };
type Atom = Mention | Figure | Word;
/** The atoms between two commas, colons, dashes, or brackets, in the order they were written. */
type Phrase = readonly Atom[];
/** The phrases between two full stops, semicolons, or line breaks. */
type Clause = {
  readonly phrases: readonly Phrase[];
  readonly mentions: readonly Mention[];
  /** Every word that is neither part of a known name nor a figure. */
  readonly free: readonly string[];
  /** Where the phrases in brackets sit, like "(Events)": asides that are never the subject. */
  readonly asides: ReadonlySet<number>;
};

/** A word, or a figure in digits as written. */
type Text = { readonly text: string; readonly value?: number | null };
type Token = Text | "phrase" | "clause" | "open" | "close";
type KnownName = { readonly name: string; readonly words: readonly string[]; readonly lines: readonly number[] };

/**
 * Digits not glued to letters (with a minus sign before them, and a percent or plus sign after
 * them that makes them unverifiable), a word, the end of a clause, an opening or closing
 * bracket, the end of a phrase.
 */
const TOKEN =
  /(?<![\p{L}\p{N}])([-−]?)(\d(?:[\d,.]*\d)?)(?![\p{L}\p{N}])(\s*%|\+)?|([\p{L}\p{N}]+)|([.;!?](?=\s|$)|\n)|([([])|([)\]])|([,:–—]|\s-\s)/gu;
const ENGLISH_FIGURE = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const NAME_KEY = /^(?:item|name|label|title|line|partida|categor(?:y|ia|ies))(?:name)?s?$/i;
const ITEM_KEY = /^(?:item|name|label|title|line|partida)(?:name)?s?$/i;
const CATEGORY_KEY = /^categor(?:y|ia|ies)(?:name)?s?$/i;
const FILE_KEY = /^(?:source|file_?name)$/i;
const OVER_FIELD = /^(?:total_?)?(?:over|overspend|overspent|overbudget|desvio|excess)(?:_?total)?$/i;
/** Field names in the tool result, and what the figures under them measure. */
const ROLE_FIELDS: readonly (readonly [RegExp, Role])[] = [
  [/^(?:total_?)?(?:approved|aprobado|approved_?budget)(?:_?total)?$/i, "approved"],
  [/^(?:total_?)?(?:spent|gastado)(?:_?total)?$/i, "spent"],
  [/^(?:total_?)?(?:remaining|restante)(?:_?total)?$/i, "remaining"],
  [OVER_FIELD, "over"],
];

const OVER = new Set([
  "over", "overspent", "overspend", "overspends", "overspending", "overrun", "overruns", "overran", "overshot",
  "overshoot", "overbudget", "overdrawn", "overdraft", "outspent", "exceed", "exceeds", "exceeded", "exceeding",
  "surpass", "surpasses", "surpassed", "above", "beyond", "past", "more", "higher", "greater", "excess", "red",
  "deficit", "shortfall", "negative", "minus", "blew", "blown", "busted", "extra", "additional",
]);
/** Words that say an item spent less than approved. */
const UNDER = new Set([
  "under", "within", "below", "inside", "less", "fewer", "lower", "short", "underspent", "underspend", "underspends",
  "underspending", "underbudget", "underrun", "saved", "saving", "savings", "surplus",
]);

/** Words an over-budget claim may use besides listed names, figures, and OVER words. */
const CONNECTIVE = new Set([
  "a", "an", "the", "this", "that", "it", "its", "their", "you", "your", "we", "our", "which", "there",
  "paola", "sample", "data", "heads", "up", "note",
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had", "having", "now", "currently", "still",
  "already", "so", "far", "went", "gone", "goes", "going", "ran", "run", "running", "came", "come", "comes", "ended",
  "sits", "stands", "spent", "spend", "spends", "spending", "budget", "budgets", "budgeted", "approved", "amount",
  "limit", "plan", "planned", "line", "lines", "item", "items", "category", "total", "remaining", "left", "cost",
  "costs", "and", "by", "of", "on", "in", "for", "at", "to", "from", "with", "than", "against", "vs", "versus", "as",
  "per", "into", "eur", "euro", "euros", "usd", "dollar", "dollars",
]);

const NEGATORS = new Set(["not", "no", "never", "nothing", "none", "neither", "nor", "without"]);
const UNIVERSAL = new Set([
  "no", "nothing", "none", "every", "everything", "all", "each", "any", "anything", "else", "other", "others", "rest",
]);
/** "Only the trade fair" is true only when the trade fair is the whole list. */
const EXCLUSIVE = new Set(["only", "one", "sole", "single"]);
/** "No other item is" is true only when the sentence names the whole list. */
const NO_WORDS = new Set(["no", "none", "nothing", "neither"]);
const REST = new Set(["else", "other", "others", "rest"]);
const WITHIN = /\b(?:under|within|below|inside)(?: (?:the|its|their|your|approved))* (?:budget|limit|plan)\b|\bon (?:track|budget)\b/;
/** Words that make a budget claim a guess or move it to another time. */
const HEDGES = new Set([
  "will", "ll", "would", "could", "may", "might", "should", "shall", "can", "must", "if", "unless", "before", "originally",
  "previously", "initially", "again", "then",
]);
/** Words that give every name they follow the same figure: "100 each". */
const DISTRIBUTIVE = new Set(["each", "both", "apiece"]);
/**
 * Words that point a phrase back at what the phrase before it was about: "; it spent", ", which
 * spent", ", with 4,700 spent", ", leaving 9,800".
 */
const ANAPHORA = new Set([
  "it", "its", "itself", "they", "their", "them", "which", "who", "whose", "having", "with", "this", "resulting",
  "leaving", "bringing", "making", ...DISTRIBUTIVE,
]);
/** Pronouns that stand for the names of the clause before: "...; it is over budget by 200". */
const PRONOUNS = new Set(["it", "they", "them"]);
/** Pronouns that stand for more than one thing. */
const PLURAL = new Set(["they", "them", "their", "theirs", "themselves", "these", "those", "both"]);
/** Pronouns that need a name before them to mean anything. */
const REFERRING = new Set(["it", "its", "itself", "they", "their", "theirs", "them", "themselves"]);
/** Verbs after which "it" stands for nothing: "it looks like the trade fair is over budget". */
const DUMMY_IT = new Set(["looks", "look", "seems", "seem", "appears", "appear"]);
/** Words that say a figure is about the whole budget, not one item. */
const TOTALS = new Set(["total", "totals", "overall", "altogether", "combined", "entire", "whole"]);
/** Who holds the whole budget: in a phrase that names no item, "you have 9,800 left" is about all of it. */
const HOLDERS = new Set(["you", "your", "we", "our", "us", "paola"]);
/** Words that say what the figure nearest to them measures: "spent 4,700", "4,500 approved", "200 over". */
const ROLE_CUES = new Map<string, Role>([
  ...["approved", "budgeted", "allocated", "allotted", "allocation", "allowance", "planned", "limit", "limits", "aprobado"].map(
    (word) => [word, "approved"] as const,
  ),
  ...[
    "spent", "spend", "spends", "spending", "used", "paid", "cost", "costs", "costing", "outlay", "expenditure", "expenditures",
    "expense", "expenses", "gastado",
  ].map((word) => [word, "spent"] as const),
  ...["remaining", "remains", "remain", "left", "leftover", "available", "unspent", "spare", "headroom", "leaving", "balance"].map(
    (word) => [word, "remaining"] as const,
  ),
  ...[...OVER].map((word) => [word, "over"] as const),
]);
/** Words a cue may reach across to its figure: "an approved budget of 4,500", "9,800 is spent", "approved should be". */
const FILLER = new Set([
  "a", "an", "the", "its", "their", "your", "our", "of", "is", "are", "was", "were", "be", "been", "has", "have",
  "had", "now", "currently", "already", "so", "far", "just", "budget", "budgets", "total", "amount", "amounts", "in",
  "at", "to", "for", "by", "eur", "euro", "euros", "usd", "dollar", "dollars", "will", "would", "shall", "should",
  "can", "could", "may", "might", "must", "came", "comes", "come", ...["about", "around"],
]);
/** Words that say a figure is about that much; "by about 200" is still the overspend. */
const APPROX = new Set(["about", "around"]);
/** How far a cue reaches: "the approved budget for the Q4 trade fair is 4,500" crosses five atoms. */
const MAX_FILLER = 6;
/** Words a cue reaching forward may cross with the item it is about: "the overspend on the trade fair line is 200". */
const ABOUT_ITEM = new Set([
  "on", "line", "lines", "item", "items", "category", "categories", "entry", "file", "dataset", "data", "sheet",
]);
/** The label a sample narration starts with; on its own it says nothing. */
const LABEL = new Set(["sample", "data"]);
/** A name never swallows these, so a tool result labelled "Over budget" cannot hide a claim. */
const CLAIM_WORDS = new Set([...OVER, ...NEGATORS, ...UNDER]);
/**
 * Words that never name an item, point at another item, or judge the budget, so an over-budget
 * claim may use them freely. "Great news", "slightly", "this month", "consider moving", "travel":
 * none are here, so a sentence that uses them is withheld.
 */
const NARRATION = new Set([
  ...CONNECTIVE,
  ...TOTALS,
  ...DISTRIBUTIVE,
  ...`am do does did done will would can could may might should must ve re ll or but yet also too then though
    although while whereas because since if when where whether about around across after before between via out
    through during toward towards upon just even again actually indeed original originally here file dataset
    hi hello hey please thanks fyi quick summary sentence result results tool analysis shows show showed shown says
    said indicates indicated reveals revealed found identified computed calculated according based check review keep
    eye watch attention worth look looks looking like seems seem appears appear wanted want let know see approval
    remains remain leftover balance totals amounts figure figures money funds expenses expenditure paid used outlay
    limits categories entry entries list listed sitting standing stood reached reaches reaching brings bringing
    brought leaves leaving resulting resulted means meaning making makes made totaling totalling totaled coming
    respectively including include includes being`.split(/\s+/),
]);
/** Every word a sentence may use besides the names and figures in the tool result. */
const VOCABULARY = new Set([
  ...NARRATION,
  ...OVER,
  ...UNDER,
  ...NEGATORS,
  ...UNIVERSAL,
  ...EXCLUSIVE,
  ...REST,
  ...ANAPHORA,
  ...ROLE_CUES.keys(),
  ...FILLER,
  ..."these those theirs themselves us ours yours i me my who whom whose what track".split(" "),
]);
/**
 * Figures a sentence can imply without digits, or that rescale the digits next to them;
 * none of them can be checked against the tool result.
 */
const VAGUE_FIGURES = new Set([
  "half", "halves", "quarter", "quarters", "third", "thirds", "double", "doubled", "twice", "triple", "tripled",
  "dozen", "dozens", "hundreds", "thousands", "millions", "billions", "grand",
  "percent", "percentage", "percentages", "pct", "cent", "cents",
]);

/** Words that bound the figure right after them, so it is no longer that figure: "more than 200", "over 200". */
const BOUND_BEFORE = new Set(["than", "over", "under", "above", "below", "beyond", "past", "upwards", "upward"]);
/** Words that bound the figure after "of": "in excess of 200", "upwards of 200". */
const BOUND_OF = new Set(["excess", "upwards", "upward"]);
/** Words that bound the figure before "or": "200 or more". */
const BOUND_OR = new Set(["more", "less", "fewer", "over", "under", "above", "below", "higher", "lower", "so"]);
/** Currency words a bound may reach across: "over EUR 200". */
const CURRENCY = new Set(["eur", "euro", "euros", "usd", "dollar", "dollars"]);
/** Words that make the figure before them a count, which the tool result never states: "200 items". */
const COUNTED = new Set([
  "item", "items", "line", "lines", "category", "categories", "entry", "entries", "partida", "partidas", "time", "times",
]);

const UNITS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SMALL_NUMBERS = new Map<string, number>([
  ...UNITS.map((word, value) => [word, value] as const),
  ...TENS.map((word, i) => [word, (i + 2) * 10] as const),
]);
const SCALES = new Map([["hundred", 100], ["thousand", 1_000], ["million", 1_000_000], ["billion", 1_000_000_000]]);

function isNumberWord(word: string): boolean {
  return SMALL_NUMBERS.has(word) || SCALES.has(word);
}

function figureKey(value: number): string {
  return money(Math.abs(value)).toFixed(2);
}

/** English figures only, as the UI writes them: 4,700.00 is 4700, never 4.7. */
function parseFigure(raw: string): number | null {
  return ENGLISH_FIGURE.test(raw) ? Number(raw.replace(/,/g, "")) : null;
}

/** A figure as a sentence writes it. Tool result figures are in cents, so 200.001 is none of them, however it rounds. */
function sentenceFigure(raw: string): number | null {
  const [, decimals = ""] = raw.split(".");
  return /^\d{0,2}0*$/.test(decimals) ? parseFigure(raw) : null;
}

function readFigure(text: string): number | null {
  return parseFigure(text.replace(/^[+\-−]\s*/, "").replace(/^[€$£]\s*|\s*[€$£%]$/g, ""));
}

/** Lower case, no accents, "isn't" as "is not", and "spent > approved" as "spent over approved". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/n['’]t\b/g, " not")
    .replace(/['’]s\b/g, "")
    .replace(/[>≥]/g, " over ")
    .replace(/[<≤]/g, " under ")
    // "Meta Ads & the trade fair", "Meta Ads + the trade fair", "Meta Ads/the trade fair" list two names.
    .replace(/&|\s\+\s|(?<=\p{L})\s*\/\s*(?=\p{L})/gu, " and ");
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const [, minus, digits, mark, word, clauseEnd, open, close] of normalize(text).matchAll(TOKEN)) {
    if (digits !== undefined) {
      const value = mark ? null : sentenceFigure(digits);
      tokens.push({ text: digits, value: value !== null && minus ? -value : value });
    } else if (word !== undefined) {
      tokens.push({ text: word });
    } else {
      tokens.push(clauseEnd !== undefined ? "clause" : open !== undefined ? "open" : close !== undefined ? "close" : "phrase");
    }
  }
  return tokens;
}

/** Text under the keys that match, like item and category names, or the CSV's file name. */
function stringsIn(value: unknown, keys: RegExp, key = ""): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return keys.test(key) && text && readFigure(text) === null ? [text] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => stringsIn(item, keys, key));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([childKey, child]) => stringsIn(child, keys, childKey));
  }
  return [];
}

function namesIn(value: unknown, key = ""): string[] {
  return stringsIn(value, NAME_KEY, key);
}

/** Names written on this line itself; budget.ts LineStatus keeps them on its .line. */
function lineNames(line: object): string[] {
  const own = Object.entries(line).flatMap(([key, child]) => (typeof child === "string" ? namesIn(child, key) : []));
  const inner = (line as { line?: unknown }).line;
  return inner && typeof inner === "object" && !Array.isArray(inner) ? [...own, ...lineNames(inner)] : own;
}

type CollectedFigures = {
  readonly shared: Set<string>;
  readonly owners: Map<string, Set<string>>;
  readonly roles: Map<string, Map<string, Set<Role>>>;
  /** Top-level figures that total the overspend of the over-budget list, like totalOver. */
  readonly overTotals: Set<string>;
};

/** What a figure measures, from the field that holds it; null when the field says nothing we know. */
function roleOf(field: string, value: number): Role | null {
  const role = ROLE_FIELDS.find(([pattern]) => pattern.test(field))?.[1] ?? null;
  return role === "remaining" && value < 0 ? "over" : role;
}

function addOwners(into: CollectedFigures, key: string, owners: readonly string[], role: Role | null): void {
  const known = into.owners.get(key) ?? new Set<string>();
  owners.forEach((owner) => known.add(owner));
  into.owners.set(key, known);
  if (role) {
    const roles = into.roles.get(key) ?? new Map<string, Set<Role>>();
    owners.forEach((owner) => roles.set(owner, (roles.get(owner) ?? new Set<Role>()).add(role)));
    into.roles.set(key, roles);
  }
}

/** Record every figure under the names of the nearest line that holds it. The top level owns nothing. */
function collectFigures(value: unknown, owners: readonly string[], into: CollectedFigures, field = ""): void {
  const figure = typeof value === "number" ? value : typeof value === "string" ? readFigure(value.trim()) : null;
  if (figure !== null && Number.isFinite(figure)) {
    const key = figureKey(figure);
    const role = roleOf(field, figure);
    if (owners.length > 0) {
      addOwners(into, key, owners, role);
    } else {
      into.shared.add(key);
      if (role) {
        const roles = into.roles.get(key) ?? new Map<string, Set<Role>>();
        roles.set("", (roles.get("") ?? new Set<Role>()).add(role));
        into.roles.set(key, roles);
      }
      if (OVER_FIELD.test(field)) {
        into.overTotals.add(key);
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectFigures(item, owners, into, field));
  } else if (value && typeof value === "object") {
    const names = lineNames(value);
    Object.entries(value).forEach(([key, child]) => collectFigures(child, names.length > 0 ? names : owners, into, key));
  }
}

function listsNamedOverBudget(value: unknown): unknown[][] {
  if (Array.isArray(value)) {
    return value.flatMap(listsNamedOverBudget);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      key === "overBudget" && Array.isArray(child) ? [child] : listsNamedOverBudget(child),
    );
  }
  return [];
}

/**
 * The watcher's list: any overBudget array, plus the lines of a watcher or note result.
 * Those lines are re-checked here, so a line is listed only when spent is greater than approved.
 */
function overBudgetLists(toolResult: unknown): unknown[][] {
  const lists = listsNamedOverBudget(toolResult);
  const { bot, lines } = (toolResult ?? {}) as Partial<ToolResult>;
  if ((bot === "watcher" || bot === "note") && Array.isArray(lines)) {
    lists.push(lines.filter((line) => line && typeof line === "object" && line.spent > line.approved));
  }
  return lists;
}

/** The names of every line in the tool result: each object that names an item or category, and each name listed alone. */
function linesIn(value: unknown, listed = false): string[][] {
  if (typeof value === "string") {
    return listed && value.trim() ? [[value.trim()]] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => linesIn(item, true));
  }
  if (value && typeof value === "object") {
    const names = lineNames(value);
    return names.length > 0 ? [names] : Object.values(value).flatMap((child) => linesIn(child));
  }
  return [];
}

function collectGrounds(toolResult: unknown): Grounds {
  const lists = overBudgetLists(toolResult);
  const entries = lists.flat().map((entry) =>
    typeof entry === "string" ? [entry.trim()].filter(Boolean) : namesIn(entry),
  );
  const names = [...new Set([...namesIn(toolResult), ...entries.flat()])];
  const items = new Set([
    ...stringsIn(toolResult, ITEM_KEY),
    ...lists.flat().flatMap((entry) => (typeof entry === "string" ? [entry.trim()] : [])),
  ]);
  const figures: CollectedFigures = { shared: new Set(), owners: new Map(), roles: new Map(), overTotals: new Set() };
  if (toolResult && typeof toolResult === "object") {
    Object.entries(toolResult).forEach(([key, child]) => collectFigures(child, [], figures, key));
  } else {
    collectFigures(toolResult, [], figures);
  }
  // With one item over budget, the total overspend is that item's overspend.
  const distinct = new Map(entries.map((entry) => [entry.join("\n"), entry]));
  if (distinct.size === 1) {
    const [only] = distinct.values();
    figures.overTotals.forEach((key) => addOwners(figures, key, only, "over"));
  }
  return {
    figures: new Set([...figures.shared, ...figures.owners.keys()]),
    shared: figures.shared,
    roles: figures.roles,
    owners: figures.owners,
    wholeRemaining: wholeFigure(toolResult, "remaining"),
    wholeApproved: wholeFigure(toolResult, "approved"),
    names,
    items,
    files: [...new Set(stringsIn(toolResult, FILE_KEY))],
    hasList: lists.length > 0,
    entries,
    lines: linesIn(toolResult),
    listed: new Set(entries.flat()),
  };
}

function wordValue(run: readonly string[]): number {
  let total = 0;
  let current = 0;
  for (const word of run) {
    const scale = SCALES.get(word);
    if (scale === undefined) {
      current += SMALL_NUMBERS.get(word) ?? 0;
    } else if (scale === 100) {
      current = (current || 1) * scale;
    } else {
      total += (current || 1) * scale;
      current = 0;
    }
  }
  return total + current;
}

/** A word that can only come from a name. Digits alone never can: "2026" is a figure, not "2026 kickoff". */
function isDistinctive(word: string): boolean {
  return !CONNECTIVE.has(word) && !/^[\d,.]+$/.test(word) && (word.length >= 3 || /\d/.test(word));
}

/** Singular and plural match, so "event" finds "Events" and "trade fairs" finds "Q4 trade fair". */
function sameWord(a: string | undefined, b: string | undefined): boolean {
  const stem = (word: string) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
  return a !== undefined && b !== undefined && stem(a) === stem(b);
}

function containsRun(haystack: readonly string[], run: readonly string[]): boolean {
  for (let i = 0; i + run.length <= haystack.length; i += 1) {
    if (run.every((word, k) => sameWord(haystack[i + k], word))) {
      return true;
    }
  }
  return false;
}

type Run = { readonly start: number; readonly end: number; readonly owners: readonly string[] };

/**
 * Longest runs of words taken from a known name, so "the trade fair" finds "Q4 trade fair", and
 * runs side by side from one name, so "the Q4 fair" does too. One word of a longer name names
 * nothing: "marketing" for "Marketing software" or "ads" for "Meta Ads" says more than the item.
 * Nor does a name cut short of its last word: "the Q4 trade show" is not the Q4 trade fair.
 */
function findMentions(words: readonly string[], known: readonly KnownName[]): Run[] {
  const runs: Run[] = [];
  for (const run of findRuns(words, known)) {
    const last = runs[runs.length - 1];
    const common = last?.end === run.start ? last.owners.filter((owner) => run.owners.includes(owner)) : [];
    if (common.length > 0) {
      runs[runs.length - 1] = { start: last.start, end: run.end, owners: common };
    } else {
      runs.push(run);
    }
  }
  const byName = new Map(known.map((name) => [name.name, name.words]));
  const names = ({ start, end, owners }: Run) =>
    owners.some((owner) => {
      const nameWords = byName.get(owner) ?? [];
      return (end - start > 1 || nameWords.length === 1) && sameWord(words[end - 1], nameWords[nameWords.length - 1]);
    });
  return runs.filter(names);
}

function findRuns(words: readonly string[], known: readonly KnownName[]): Run[] {
  const mentions = [];
  let i = 0;
  while (i < words.length) {
    let length = 0;
    for (const name of known) {
      for (let j = 0; j < name.words.length; j += 1) {
        let k = 0;
        while (i + k < words.length && !CLAIM_WORDS.has(words[i + k]) && sameWord(words[i + k], name.words[j + k])) {
          k += 1;
        }
        length = Math.max(length, k);
      }
    }
    const run = words.slice(i, i + length);
    if (run.some(isDistinctive)) {
      const owners = known.filter((name) => containsRun(name.words, run)).map((name) => name.name);
      mentions.push({ start: i, end: i + length, owners });
      i += length;
    } else {
      i += 1;
    }
  }
  return mentions;
}

/**
 * Known names first, then figures: digits, number words like "two hundred", and words that
 * imply a figure no one can check. A lone "one" is a pronoun, not a figure.
 */
function readPhrase(texts: readonly Text[], known: readonly KnownName[], wholeApproved: number | null): Atom[] {
  const words = texts.map(({ text }) => text);
  const mentions = findMentions(words, known);
  const atoms: Atom[] = [];
  let numbers: string[] = [];
  const flush = () => {
    if (numbers.length === 1 && numbers[0] === "one") {
      atoms.push({ kind: "word", text: "one" });
    } else if (numbers.length > 0) {
      atoms.push({ kind: "figure", value: wordValue(numbers) });
    }
    numbers = [];
  };
  for (let i = 0; i < texts.length; i += 1) {
    const mention = mentions.find(({ start }) => start === i);
    if (mention) {
      flush();
      const lines = known.filter(({ name }) => mention.owners.includes(name)).flatMap((name) => name.lines);
      atoms.push({ kind: "mention", owners: mention.owners, lines: [...new Set(lines)] });
      i = mention.end - 1;
      continue;
    }
    const { text, value } = texts[i];
    if (value !== undefined) {
      flush();
      atoms.push({ kind: "figure", value });
    } else if (isNumberWord(text) || (text === "and" && SCALES.has(numbers.at(-1) ?? "") && SMALL_NUMBERS.has(words[i + 1] ?? ""))) {
      numbers.push(text);
    } else {
      flush();
      atoms.push(VAGUE_FIGURES.has(text) || /\d/.test(text) ? { kind: "figure", value: null } : { kind: "word", text });
    }
  }
  flush();
  const checked = atoms.map((atom, at): Atom => (atom.kind === "figure" && isBounded(atoms, at) ? { kind: "figure", value: null } : atom));
  return impliedFigures(signedFigures(checked), wholeApproved);
}

/** Words that are a figure's sign: "minus 200" is -200, so "remaining is minus 200" is true and "spent minus 200" is not. */
const SIGNS = new Set(["minus", "negative"]);

function signedFigures(atoms: readonly Atom[]): Atom[] {
  const out: Atom[] = [];
  for (let i = 0; i < atoms.length; i += 1) {
    const [atom, next] = [atoms[i], atoms[i + 1]];
    if (atom.kind === "word" && SIGNS.has(atom.text) && next?.kind === "figure" && next.value !== null && next.value > 0) {
      out.push({ kind: "figure", value: -next.value });
      i += 1;
    } else {
      out.push(atom);
    }
  }
  return out;
}

/** Words that state an amount of nothing: "nothing has been spent", "none of it remains", "no money is left". */
const NOTHING = new Set(["nothing", "none"]);
const MONEY = new Set(["money", "funds", "budget", "amount", "cash", "spending", "expenses", "expenditure"]);
/** Words that say all of an amount: "the entire budget has been spent". */
const WHOLLY = new Set(["all", "entire", "whole", "fully", "completely"]);

/**
 * Figures a phrase states without digits. A no-word before a spent, remaining, or approved cue is
 * the figure 0: "nothing has been spent". A whole-budget word with a spent or remaining cue is the
 * whole approved amount, "the entire budget has been spent"; said of one item, it is a figure the
 * tool result does not give.
 */
function impliedFigures(atoms: readonly Atom[], wholeApproved: number | null): Atom[] {
  const cueAfter = (from: number, roles: readonly Role[]) => {
    for (const atom of atoms.slice(from + 1)) {
      if (atom.kind === "figure") {
        return false;
      }
      const role = atom.kind === "word" ? ROLE_CUES.get(atom.text) : undefined;
      if (role && roles.includes(role)) {
        return true;
      }
    }
    return false;
  };
  const amounts: readonly Role[] = ["spent", "remaining", "approved"];
  const out: Atom[] = [];
  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i];
    const next = atoms[i + 1];
    const noMoney = atom.kind === "word" && atom.text === "no" && next?.kind === "word" && MONEY.has(next.text);
    if (atom.kind === "word" && (NOTHING.has(atom.text) || noMoney) && cueAfter(noMoney ? i + 1 : i, amounts)) {
      out.push({ kind: "figure", value: 0 });
      i += noMoney ? 1 : 0;
    } else if (
      atom.kind === "word" &&
      WHOLLY.has(atom.text) &&
      !atoms.some((other) => other.kind === "figure") &&
      cueAfter(i, ["spent", "remaining"])
    ) {
      const aboutItem = atoms.some((other) => other.kind === "mention");
      out.push({ kind: "figure", value: aboutItem ? null : wholeApproved });
    } else {
      out.push(atom);
    }
  }
  return out;
}

/**
 * True when words around the figure make it a bound, like "more than 200" or "200 or more", or a
 * count, like "200 items", not the figure itself.
 */
function isBounded(atoms: readonly Atom[], at: number): boolean {
  const wordAt = (i: number) => {
    const atom = atoms[i];
    return atom?.kind === "word" ? atom.text : undefined;
  };
  let before = at - 1;
  while (CURRENCY.has(wordAt(before) ?? "")) {
    before -= 1;
  }
  let after = at + 1;
  while (CURRENCY.has(wordAt(after) ?? "")) {
    after += 1;
  }
  const previous = wordAt(before) ?? "";
  return (
    BOUND_BEFORE.has(previous) ||
    (previous === "of" && BOUND_OF.has(wordAt(before - 1) ?? "")) ||
    (wordAt(after) === "or" && BOUND_OR.has(wordAt(after + 1) ?? "")) ||
    COUNTED.has(wordAt(at + 1) ?? "")
  );
}

function toClause(phrases: readonly Phrase[], asides: ReadonlySet<number>): Clause {
  const atoms = phrases.flat();
  return {
    phrases,
    mentions: atoms.filter((atom): atom is Mention => atom.kind === "mention"),
    free: atoms.flatMap((atom) => (atom.kind === "word" ? [atom.text] : [])),
    asides,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The CSV's whole file name reads as the word "file", so "sample-presupuesto.csv" adds no words of its own. */
function withoutFileNames(sentence: string, files: readonly string[]): string {
  return files.reduce(
    (text, file) => text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(file)}(?![\\p{L}\\p{N}])`, "giu"), " file "),
    sentence,
  );
}

/** True when the phrase is nothing but figures, like ", 100," or ", and 200". */
function figuresOnly(phrase: Phrase): boolean {
  return (
    phrase.some((atom) => atom.kind === "figure") &&
    phrase.every((atom) => atom.kind === "figure" || (atom.kind === "word" && (atom.text === "and" || atom.text === "or")))
  );
}

function readSentence(sentence: string, grounds: Grounds): Clause[] {
  const known = grounds.names.map((name) => ({
    name,
    words: tokenize(name).flatMap((token) => (typeof token === "string" ? [] : [token.text])),
    lines: grounds.lines.flatMap((names, line) => (names.includes(name) ? [line] : [])),
  }));
  const clauses: Clause[] = [];
  let phrases: Phrase[] = [];
  let asides = new Set<number>();
  let texts: Text[] = [];
  let bracketed = false;
  const endPhrase = () => {
    if (texts.length > 0) {
      const phrase = readPhrase(texts, known, grounds.wholeApproved);
      const previous = phrases[phrases.length - 1];
      if (!bracketed && previous?.[previous.length - 1]?.kind === "figure" && figuresOnly(phrase)) {
        // ", 100, and 200" goes on with the figures before it: "over budget by 100, 100, and 200".
        phrases[phrases.length - 1] = [...previous, ...phrase];
      } else {
        if (bracketed) {
          asides.add(phrases.length);
        }
        phrases.push(phrase);
      }
    }
    texts = [];
  };
  const endClause = () => {
    endPhrase();
    if (phrases.length > 0) {
      clauses.push(toClause(phrases, asides));
    }
    phrases = [];
    asides = new Set();
  };
  for (const token of tokenize(withoutFileNames(sentence, grounds.files))) {
    if (token === "phrase" || token === "open" || token === "close") {
      endPhrase();
      bracketed = token === "open" || (token === "phrase" && bracketed);
    } else if (token === "clause") {
      endClause();
      bracketed = false;
    } else {
      texts.push(token);
    }
  }
  endClause();
  return clauses;
}

function figuresIn(clause: Clause): (number | null)[] {
  return clause.phrases.flat().flatMap((atom) => (atom.kind === "figure" ? [atom.value] : []));
}

function isListed(mention: Mention, grounds: Grounds): boolean {
  return mention.owners.every((owner) => grounds.listed.has(owner));
}

/** True when the mentions name every line on the watcher's list. */
function coversList(mentions: readonly Mention[], grounds: Grounds): boolean {
  const named = new Set(mentions.filter((mention) => isListed(mention, grounds)).flatMap((mention) => mention.owners));
  return grounds.entries.every((entry) => entry.some((name) => named.has(name)));
}

/** The first atom after a word, past filler words like "the". */
function nextAfter(phrase: Phrase, at: number): Atom | undefined {
  return phrase.slice(at + 1).find((atom) => atom.kind !== "word" || !FILLER.has(atom.text));
}

/** True when the word stands right before a name, past filler words: "just the trade fair", "than Meta Ads". */
function precedesName({ phrases }: Clause, word: string): boolean {
  return phrases.some((phrase) =>
    phrase.some((atom, at) => atom.kind === "word" && atom.text === word && nextAfter(phrase, at)?.kind === "mention"),
  );
}

/** "Meta Ads is over by more than the trade fair": the tool result never compares two items. */
function judgeComparison(clause: Clause): WithheldReason | null {
  return precedesName(clause, "than") ? "unchecked_comparison" : null;
}

/**
 * "This is not sample data", "none of this is sample data": the label is the one thing Paola must
 * never be told otherwise. A negator beside "sample", or in a phrase about the sample and no budget
 * figure, denies it; "nothing is over budget in this sample" does not.
 */
function judgeLabel({ phrases }: Clause): WithheldReason | null {
  const denies = phrases.some((phrase) => {
    const words = phrase.flatMap((atom) => (atom.kind === "word" ? [atom.text] : []));
    const beside = phrase.some((atom, at) => {
      if (atom.kind !== "word" || !NEGATORS.has(atom.text)) {
        return false;
      }
      const next = nextAfter(phrase, at);
      return next?.kind === "word" && next.text === "sample";
    });
    const aboutSample =
      words.includes("sample") &&
      words.some((word) => NEGATORS.has(word)) &&
      !words.some((word) => OVER.has(word) || UNDER.has(word) || ROLE_CUES.has(word));
    // "This is Paola's budget": the sample is not Paola's real budget.
    const real = REAL_BUDGET.test(words.join(" "));
    return beside || aboutSample || real;
  });
  return denies ? "denies_sample" : null;
}

const REAL_BUDGET = /\b(?:this|it|that) (?:is|was) (?:paola|your|our|her) (?:real |actual |own )?budget\b/;

/** Words that give a cause, which the tool result never states: "over budget because of the trade fair". */
const CAUSES = new Set(["because", "since"]);
/**
 * Words after a leading "so" that make it something other than a new cause: "so far", "and so is
 * Meta Ads", or "so it is over budget", which draws on the same item's own figures.
 */
const NOT_CAUSAL_SO = new Set(["far", "is", "are", "was", "were", "did", "does", "do", "has", "have", "had", "it", "they"]);

/** Words that tie a result or a time to another name: "making Meta Ads over budget", "after Meta Ads did". */
const LINKING = new Set(["making", "leaving", "causing", "pushing", "putting", "bringing", "resulting", "after", "before"]);

/**
 * "Over budget by 100 because of the trade fair", ", so Meta Ads is over budget", ", making Meta Ads
 * over budget", "after Meta Ads did": a cause or an order of events that no figure can back.
 */
function judgeCause({ phrases, free }: Clause): WithheldReason | null {
  const causalSo = phrases.some((phrase) => {
    const at = phrase[0]?.kind === "word" && phrase[0].text === "and" ? 1 : 0;
    const [so, next] = [phrase[at], phrase[at + 1]];
    return so?.kind === "word" && so.text === "so" && next !== undefined && !(next.kind === "word" && NOT_CAUSAL_SO.has(next.text));
  });
  const linked = phrases.some((phrase) =>
    phrase.some((atom, at) => atom.kind === "word" && LINKING.has(atom.text) && nextAfter(phrase, at)?.kind === "mention"),
  );
  return causalSo || linked || free.some((word) => CAUSES.has(word)) ? "unchecked_claim" : null;
}

function deniesRest(free: readonly string[]): boolean {
  return free.some((word) => NO_WORDS.has(word)) && free.some((word) => REST.has(word));
}

function namesItem(mention: Mention, grounds: Grounds): boolean {
  return mention.owners.some((owner) => grounds.items.has(owner));
}

/** Words for the approved amount, which an overspend is measured against. */
const APPROVED_WORDS = new Set([
  "budget", "budgets", "approved", "budgeted", "allocated", "allocation", "allotted", "allowance", "planned", "limit", "limits",
]);

/**
 * "The budget exceeds its spending by 200" turns an overspend the wrong way round: in the over
 * word's phrase, the approved amount comes first and the spending after it.
 */
function isReversed({ phrases }: Clause): boolean {
  return phrases.some((phrase) => {
    const words = phrase.flatMap((atom) => (atom.kind === "word" ? [atom.text] : []));
    const overAt = words.findIndex((word) => OVER.has(word) && word !== "over");
    return (
      overAt > 0 &&
      words.slice(0, overAt).some((word) => APPROVED_WORDS.has(word)) &&
      words.slice(overAt + 1).some((word) => ROLE_CUES.get(word) === "spent")
    );
  });
}

/** "The over-budget item is", "the items over budget are": a definite list says it is the whole list. */
const THE_OVER_LIST =
  /\bthe (?:over budget|overbudget) (?:items?|lines?)\b|\bthe (?:items?|lines?) (?:that (?:are|is|were|was) )?(?:over budget|overbudget)\b/;

/**
 * The names an over-budget claim says are over: those up to and in the first phrase with the over
 * word. "Only the trade fair is over budget, while Meta Ads spent 3,300" says nothing of Meta Ads.
 */
function claimedOver({ phrases }: Clause): Mention[] {
  // "...over budget while Meta Ads spent 3,300": a contrast word starts a claim about something else.
  const before = (phrase: Phrase) => {
    const at = phrase.findIndex((atom) => atom.kind === "word" && CONTRAST.has(atom.text));
    return (at < 0 ? phrase : phrase.slice(0, at)).filter((atom): atom is Mention => atom.kind === "mention");
  };
  const last = phrases.findIndex((phrase) => phrase.some((atom) => atom.kind === "word" && OVER.has(atom.text)));
  const named = phrases.slice(0, last < 0 ? phrases.length : last + 1).flatMap(before);
  // "Over budget: Meta Ads and the trade fair" names them after the heading.
  return named.length > 0 || last < 0 ? named : phrases.slice(last + 1).flatMap(before);
}

/** Words that start a claim about something else within a phrase. */
const CONTRAST = new Set(["while", "whereas", "but", "though", "although", "yet"]);

/** True when the two mentions name one listed line, the second by its item. */
function sameLine(category: Mention, item: Mention, grounds: Grounds): boolean {
  return grounds.lines.some(
    (names) =>
      category.owners.some((owner) => names.includes(owner)) &&
      item.owners.some((owner) => names.includes(owner) && grounds.items.has(owner)),
  );
}

/** The name right beside the atom on one side, past filler words like "in" or "the", or null. */
function mentionBeside(phrase: Phrase, at: number, step: 1 | -1): Mention | null {
  for (let k = at + step; k >= 0 && k < phrase.length; k += step) {
    const atom = phrase[k];
    if (atom.kind === "mention") {
      return atom;
    }
    if (atom.kind !== "word" || !FILLER.has(atom.text)) {
      return null;
    }
  }
  return null;
}

/**
 * "Meta Ads (Events) spent 3,300": a category set beside an item must be that item's own, in any
 * claim, not only an over-budget one.
 */
function judgeAsides(clause: Clause, grounds: Grounds): WithheldReason | null {
  const wrong = clause.phrases.some((phrase, p) =>
    phrase.some((atom, a) => {
      if (atom.kind !== "mention" || atom.owners.some((owner) => grounds.items.has(owner))) {
        return false;
      }
      const opener = openingWord(phrase) ?? "";
      const aside = clause.asides.has(p) || (MODIFIERS.has(opener) && !COMPARING.has(opener));
      const nearName = mentionBeside(phrase, a, -1) !== null || mentionBeside(phrase, a, 1) !== null;
      return (aside || nearName) && !qualifiesItsItem(clause, p, a, grounds);
    }),
  );
  return wrong ? "wrong_item" : null;
}

/**
 * True when a category mention only qualifies a listed item of its own: right beside it, as in
 * "the Q4 trade fair event" or "the Q4 trade fair in Events", or set apart right after it, as in
 * "the trade fair (Events)" or "Meta Ads, in Digital advertising,". Listed as one more name,
 * "the trade fair and Events", it is said to be over budget itself.
 */
function qualifiesItsItem({ phrases, asides }: Clause, p: number, a: number, grounds: Grounds): boolean {
  const phrase = phrases[p];
  const category = phrase[a] as Mention;
  const beside = (step: 1 | -1) => {
    const other = mentionBeside(phrase, a, step);
    return other !== null && sameLine(category, other, grounds);
  };
  // "Like Digital advertising" compares; it does not say which category Meta Ads is in.
  const opener = openingWord(phrase) ?? "";
  const aside = asides.has(p) || (MODIFIERS.has(opener) && !COMPARING.has(opener));
  const alone = phrase.every((atom, k) => k === a || atom.kind !== "mention");
  /** The item named last before the aside, past other asides. */
  const follows = () => {
    for (let k = p - 1; k >= 0; k -= 1) {
      if (!asides.has(k)) {
        const last = phrases[k].findLast((atom): atom is Mention => atom.kind === "mention");
        return last !== undefined && sameLine(category, last, grounds);
      }
    }
    return false;
  };
  return beside(-1) || beside(1) || (aside && alone && follows());
}

/**
 * An over-budget claim may name only listed items; every other word must carry no item at all.
 * A category may only qualify a listed item of its own, as in "Meta Ads, in Digital advertising":
 * the watcher lists items, and a category with one item over budget can still be within budget.
 * sentenceCovers says whether the whole sentence names every listed line.
 */
function judgeOverClaim(clause: Clause, grounds: Grounds, sentenceCovers: boolean): WithheldReason | null {
  const { mentions, free } = clause;
  const listed = mentions.filter((mention) => isListed(mention, grounds));
  if (listed.length === 0 || listed.length < mentions.length) {
    return "not_over_budget";
  }
  const categories = clause.phrases.flatMap((phrase, p) =>
    phrase.flatMap((atom, a) => (atom.kind === "mention" && !namesItem(atom, grounds) ? [[p, a] as const] : [])),
  );
  if (!mentions.some((mention) => namesItem(mention, grounds)) || !categories.every(([p, a]) => qualifiesItsItem(clause, p, a, grounds))) {
    return "not_over_budget";
  }
  const restDenied = deniesRest(free);
  // A pronoun in a clause that names nothing stands for the names before it, which are the mentions here.
  const resolved = !clause.phrases.some((phrase) => phrase.some((atom) => atom.kind === "mention"));
  const carriesNoItem = (word: string) =>
    OVER.has(word) ||
    NARRATION.has(word) ||
    EXCLUSIVE.has(word) ||
    isNumberWord(word) ||
    /^\d+$/.test(word) ||
    (resolved && PRONOUNS.has(word)) ||
    (restDenied && (NEGATORS.has(word) || REST.has(word)));
  if (!free.every(carriesNoItem)) {
    return "not_over_budget";
  }
  // Names stay in the text as "#", so "the Meta Ads line: over budget" is not "the line over budget".
  const text = clause.phrases.map((phrase) => phrase.map((atom) => (atom.kind === "word" ? atom.text : "#")).join(" ")).join(" ");
  const exclusive = free.some((word) => EXCLUSIVE.has(word)) || precedesName(clause, "just") || THE_OVER_LIST.test(text);
  // "...; it is the only item over budget" says it of what "it" stands for.
  const claimed = resolved ? mentions : claimedOver(clause);
  if ((exclusive && !coversList(claimed, grounds)) || (restDenied && !sentenceCovers) || isReversed(clause)) {
    return "contradicts_watcher";
  }
  return null;
}

/** Ways to say within budget without "under" or "within": "out of the red", "200 more to spend", "overspend is gone". */
const WITHIN_TOO = new RegExp(
  [
    /\bout of (?:the )?(?:red|deficit|overspend)\b/.source,
    /\b(?:more|extra|additional) (?:to )?(?:spend|left|available|remaining)\b/.source,
    /\b(?:overspend|overspending|overrun|deficit|shortfall)(?: is| has| was)* (?:gone|over|ended|done)\b/.source,
    /\b(?:can|could) (?:still )?(?:spend|use)\b/.source,
  ].join("|"),
);
/** Words that say money is left, which with no figure says a line is within budget: "has money left". */
const LEFT = new Set(["left", "remaining", "remains", "remain", "available", "headroom", "spare", "leftover", "unspent"]);

/** True when a negator stands right before or after the name, past filler words: "not even the trade fair", "the trade fair is not". */
function negatedAt(phrase: Phrase, at: number): boolean {
  const near = (step: 1 | -1) => {
    for (let k = at + step; k >= 0 && k < phrase.length; k += step) {
      const atom = phrase[k];
      if (atom.kind === "word" && NEGATORS.has(atom.text)) {
        return true;
      }
      if (atom.kind !== "word" || !(FILLER.has(atom.text) || atom.text === "even")) {
        return false;
      }
    }
    return false;
  };
  return near(-1) || near(1);
}

/** The tool result's own figure for the whole budget, like the note result's "approved" or "remaining". */
function wholeFigure(toolResult: unknown, wanted: Role): number | null {
  if (!toolResult || typeof toolResult !== "object" || Array.isArray(toolResult)) {
    return null;
  }
  const field = Object.entries(toolResult).find(
    ([key, value]) => ROLE_FIELDS.some(([pattern, role]) => role === wanted && pattern.test(key)) && typeof value === "number",
  );
  return field && Number.isFinite(field[1]) ? (field[1] as number) : null;
}

/**
 * "Overall, you are within budget", "the whole budget is over": a claim about the whole budget is
 * true only as the whole budget's own remaining amount says, and only now: "you will be within
 * budget" is a guess. A clause that says "nothing" or "no item" is about the items, not the whole
 * budget. whole says the clause is only such a claim; phrases, in a clause that names something,
 * are the phrases that hold a checked claim about the whole budget.
 */
function judgeWhole(
  clause: Clause,
  grounds: Grounds,
): { readonly reason: WithheldReason | null; readonly whole: boolean; readonly atoms: ReadonlySet<Atom> } {
  const nameless = clause.mentions.length === 0;
  const scopes = nameless ? [clause.phrases.flat()] : clause.phrases.flatMap(statementsIn).filter((part) => !part.some(namesSomething));
  const checked = new Set<Atom>();
  let claimed = false;
  // "...over budget, and so is the overall budget": the copied phrase claims what the clause claims.
  const clauseOver = claimsOver(clause.free);
  const clauseWithin = !clauseOver && (WITHIN.test(clause.free.join(" ")) || clause.free.some((word) => UNDER.has(word)));
  for (const atoms of scopes) {
    const words = atoms.flatMap((atom) => (atom.kind === "word" ? [atom.text] : []));
    // "Nothing is over budget", "over-budget items for Paola": claims about items, not the whole budget.
    const aboutItems = words.some((word) => UNIVERSAL.has(word) || COUNTED.has(word));
    if (!words.some((word) => TOTALS.has(word) || HOLDERS.has(word)) || aboutItems) {
      continue;
    }
    // "You have money left", with no figure, says the whole budget is within budget.
    const moneyLeft = words.some((word) => LEFT.has(word)) && overWordAt(words) < 0 && !atoms.some((atom) => atom.kind === "figure");
    const start = words[0] === "and" || words[0] === "but" ? 1 : 0;
    const copied = (words[start] === "so" || words[start] === "as") && AGAIN_VERBS.has(words[start + 1] ?? "");
    const overAt = words.findIndex((word) => OVER.has(word));
    const negated = words.slice(0, Math.max(overAt, 0)).some((word) => NEGATORS.has(word));
    const over = (overAt >= 0 && !negated) || (copied && clauseOver);
    const within =
      !over &&
      (WITHIN.test(words.join(" ")) ||
        words.some((word) => UNDER.has(word)) ||
        (overAt >= 0 && negated) ||
        (copied && clauseWithin) ||
        moneyLeft);
    if (!over && !within) {
      continue;
    }
    claimed = true;
    const otherTime = isHedged(words) || words.some((word) => PAST.has(word));
    if (otherTime || grounds.wholeRemaining === null || (over ? grounds.wholeRemaining >= 0 : grounds.wholeRemaining < 0)) {
      return { reason: "contradicts_watcher", whole: nameless, atoms: checked };
    }
    atoms.forEach((atom) => checked.add(atom));
  }
  return { reason: null, whole: nameless && claimed, atoms: nameless ? new Set() : checked };
}

/** "You were within budget" may be true of another time; the tool result says what is true now. */
const PAST = new Set(["was", "were"]);

/** True for a name, or for a pronoun that stands for one. */
function namesSomething(atom: Atom): boolean {
  return atom.kind === "mention" || (atom.kind === "word" && PRONOUNS.has(atom.text));
}

/**
 * The statements in a phrase, split before each connective: "the trade fair is over budget but
 * you are over budget" is two, so a claim about the whole budget is checked even with no comma
 * before it. A phrase that names nothing is one statement.
 */
function statementsIn(phrase: Phrase): Phrase[] {
  if (!phrase.some(namesSomething)) {
    return [phrase];
  }
  const parts: Atom[][] = [[]];
  for (const atom of phrase) {
    if (atom.kind === "word" && CONNECTIVES.has(atom.text) && parts[parts.length - 1].length > 0) {
      parts.push([]);
    }
    parts[parts.length - 1].push(atom);
  }
  return parts;
}

/**
 * A listed item may never be denied or called within budget, in any phrase of the clause, even
 * beside an over-budget claim: "...; the trade fair is not", "not even the trade fair", "but the
 * trade fair is on budget", "the trade fair has money left".
 */
function judgeListedDenied({ phrases }: Clause, grounds: Grounds): WithheldReason | null {
  const names = phrases.some((phrase) =>
    phrase.some((atom) => atom.kind === "mention" && atom.owners.some((owner) => grounds.listed.has(owner))),
  );
  // "...; Meta Ads, no.": a negator standing alone answers for the listed name beside it.
  const loneNo = phrases.some(
    (phrase) =>
      phrase.some((atom) => atom.kind === "word" && NEGATORS.has(atom.text)) &&
      phrase.every((atom) => atom.kind === "word" && (NEGATORS.has(atom.text) || FILLER.has(atom.text))),
  );
  if (names && loneNo) {
    return "contradicts_watcher";
  }
  for (const [p, phrase] of phrases.entries()) {
    const listed = phrase.flatMap((atom, at) =>
      atom.kind === "mention" && atom.owners.some((owner) => grounds.listed.has(owner)) ? [at] : [],
    );
    if (listed.length === 0) {
      continue;
    }
    const words = phrase.flatMap((atom) => (atom.kind === "word" ? [atom.text] : []));
    const text = words.join(" ");
    // "Has money left" with no figure says the line is within budget; "remaining: 200" labels the figure after it.
    const next = phrases[p + 1];
    const labelsNext = next?.find((atom) => atom.kind !== "word" || !FILLER.has(atom.text))?.kind === "figure";
    const moneyLeft =
      words.some((word) => LEFT.has(word)) && overWordAt(words) < 0 && !phrase.some((atom) => atom.kind === "figure") && !labelsNext;
    const within = WITHIN.test(text) || words.some((word) => UNDER.has(word)) || WITHIN_TOO.test(text) || moneyLeft;
    if (within || listed.some((at) => negatedAt(phrase, at))) {
      return "contradicts_watcher";
    }
  }
  return null;
}

/** "Nothing is over budget" or "the trade fair is within budget" must agree with the watcher list. */
function judgeDenial({ mentions, free }: Clause, grounds: Grounds, sentenceCovers: boolean): WithheldReason | null {
  if (!grounds.hasList) {
    return "contradicts_watcher";
  }
  if (grounds.entries.length === 0) {
    return null;
  }
  if (mentions.some((mention) => mention.owners.some((owner) => grounds.listed.has(owner)))) {
    return "contradicts_watcher";
  }
  // "Nothing else is", "the rest are within budget": true only when the sentence names the whole list.
  if (deniesRest(free) || free.some((word) => REST.has(word))) {
    return sentenceCovers ? null : "contradicts_watcher";
  }
  return free.some((word) => UNIVERSAL.has(word)) ? "contradicts_watcher" : null;
}

/** What a figure written below zero means: "-200 remaining" is over budget, "overspend -100" is under it. */
const FLIPPED: Record<Role, Role | null> = { remaining: "over", over: "remaining", spent: null, approved: null };
/** The whole budget, as the subject of a phrase like "the total spent was 6,900". */
const WHOLE = Symbol("whole budget");
/**
 * Names written together, in the order written: "Meta Ads and the trade fair" is two parts. One line
 * named twice in a row, like "the Q4 trade fair event", is one part.
 */
type Names = readonly ReadonlySet<string>[];
/** What a phrase is about: some named lines, the whole budget, or nothing said. */
type Subject = Names | typeof WHOLE | null;
/** A figure, where it sits in its phrase, and what it is said about; every: said of each of the names. */
type Bound = {
  readonly at: number;
  readonly value: number;
  readonly names: ReadonlySet<string> | typeof WHOLE | null;
  readonly every: boolean;
};
type Placed = { readonly at: number; readonly value: number };

/**
 * As many figures as names go to the names in the same order. One figure after several names is
 * said of each of them: "Meta Ads and the trade fair are over budget by 100". Any other count is
 * shared by them all.
 */
function bindFigures(figures: readonly Placed[], subject: Subject): Bound[] {
  return figures.map((figure, i) => {
    if (subject === WHOLE || subject === null) {
      return { ...figure, names: subject, every: false };
    }
    if (subject.length > 1 && figures.length > 1) {
      // "Spent 3,300 of 3,200 and 4,700 of 4,500" gives each name its own run of figures in order.
      // Any other count, like three names and two figures, cannot be told apart: no name has them.
      const run = figures.length / subject.length;
      return { ...figure, names: Number.isInteger(run) ? subject[Math.floor(i / run)] : new Set<string>(), every: false };
    }
    return { ...figure, names: new Set(subject.flatMap((part) => [...part])), every: figures.length === 1 && subject.length > 1 };
  });
}

/** Names with no figure between them, and the figures that follow them. */
type Group = { readonly parts: Set<string>[]; readonly figures: Placed[] };

/** The phrase's groups in order, and the figures written before any name. */
function groupPhrase(phrase: Phrase): { groups: Group[]; before: Placed[] } {
  const groups: Group[] = [];
  const before: Placed[] = [];
  let open = false;
  phrase.forEach((atom, at) => {
    if (atom.kind === "mention") {
      if (!open) {
        groups.push({ parts: [], figures: [] });
      }
      const { parts } = groups[groups.length - 1];
      const before = phrase[at - 1];
      // "The Q4 trade fair event" names one line twice; "Meta Ads Q4 trade fair" names two lines.
      if (before?.kind === "mention" && before.lines.some((line) => atom.lines.includes(line))) {
        atom.owners.forEach((owner) => parts[parts.length - 1].add(owner));
      } else {
        parts.push(new Set(atom.owners));
      }
      open = true;
    } else if (atom.kind === "figure" && atom.value !== null) {
      (groups.length > 0 ? groups[groups.length - 1].figures : before).push({ at, value: atom.value });
      open = false;
    }
  });
  return { groups, before };
}

/**
 * Each figure is said about the names just before it, or the first names after it when none
 * come before: "Meta Ads is over by 100 and the trade fair by 200". Names with no figure between
 * them take their figures in order: "Meta Ads and the trade fair are over by 100 and 200".
 * listed holds names that the phrase's first names go on from, across an aside: "Meta Ads
 * (Digital advertising) and the trade fair are over by 100 and 200".
 */
function bindPhrase(phrase: Phrase, leaning: Subject, listed: Names = []): { bound: Bound[]; last: Names | null } {
  const { groups, before } = groupPhrase(phrase);
  const parts = (k: number) => (k === 0 ? [...listed, ...groups[0].parts] : groups[k].parts);
  return {
    bound: [
      ...bindFigures(before, groups.length > 0 ? parts(0) : leaning),
      ...groups.flatMap(({ figures }, k) => bindFigures(figures, parts(k))),
    ],
    last: groups.length > 0 ? parts(groups.length - 1) : null,
  };
}

/**
 * The names listed before a phrase that opens with "and": "Meta Ads (Digital advertising) and
 * the trade fair" lists Meta Ads first. Asides and phrases about something beside the list are
 * passed over; a phrase that says more than names ends the list.
 */
function listedBefore({ phrases, asides }: Clause, i: number): Names {
  if (openingWord(phrases[i]) !== "and" || !phrases[i].some((atom) => atom.kind === "mention")) {
    return [];
  }
  const listed: Names[] = [];
  for (let k = i - 1; k >= 0; k -= 1) {
    const phrase = phrases[k];
    if (asides.has(k) || MODIFIERS.has(openingWord(phrase) ?? "")) {
      continue;
    }
    if (!phrase.some((atom) => atom.kind === "mention") || !namesOnly(phrase)) {
      break;
    }
    listed.unshift(groupPhrase(phrase).groups.flatMap((group) => group.parts));
  }
  return listed.flat();
}

/** Words that open a phrase about something beside the subject: ", like Meta Ads,", ", in Events,", ", which spent 4,700,". */
const MODIFIERS = new Set([
  "like", "unlike", "in", "as", "with", "including", "which", "who", "whose", "for", "from", "besides", "alongside",
]);
/** Verbs that open a phrase saying something about its clause's subject: ", is over budget by 200". */
const PREDICATES = new Set([
  ...OVER,
  ...[...ROLE_CUES.keys()].filter((word) => !ANAPHORA.has(word)),
  ..."is are was were has have had went goes gone ran runs came comes ended sits stands stood remains remain reached reaches spent spends used paid cost costs totals totaled totalled".split(
    " ",
  ),
]);
/** Words that may come before a predicate's verb: ", and is over budget", ", now stands". */
const LEADING = new Set(["and", "but", "yet", "so", "then", "already", "currently", "now", "still", "also"]);

function openingWord(phrase: Phrase, skip: ReadonlySet<string> = new Set()): string | undefined {
  const atom = phrase.find((candidate) => candidate.kind !== "word" || !skip.has(candidate.text));
  return atom?.kind === "word" ? atom.text : undefined;
}

/** True when the phrase names nothing of its own but every word is filler, like "(Events)" beside "the Q4 trade fair". */
function namesOnly(phrase: Phrase): boolean {
  return phrase.every((atom) => atom.kind === "mention" || (atom.kind === "word" && (FILLER.has(atom.text) || atom.text === "and")));
}

/**
 * What a predicate phrase like ", is over budget by 200" is about: the names listed before it,
 * past asides like "(Events)" and phrases about something beside them, like ", like Meta Ads,".
 * An aside lends the subject nothing: "the trade fair (Meta Ads) is over budget by 100" is about
 * the trade fair. A whole statement before the list is not part of it.
 */
function subjectOf({ phrases, asides }: Clause, i: number): Names | null {
  const found: Phrase[] = [];
  for (let k = i - 1; k >= 0; k -= 1) {
    const phrase = phrases[k];
    if (asides.has(k) || MODIFIERS.has(openingWord(phrase) ?? "")) {
      continue;
    }
    if (!phrase.some((atom) => atom.kind === "mention")) {
      if (found.length > 0) {
        break;
      }
      continue;
    }
    if (!namesOnly(phrase)) {
      if (found.length === 0) {
        found.push(phrase);
      }
      break;
    }
    found.unshift(phrase);
  }
  return found.length > 0 ? found.flatMap((phrase) => groupPhrase(phrase).groups.flatMap((group) => group.parts)) : null;
}

/** Modifier words that compare rather than qualify: "like Meta Ads" and "with Meta Ads" say the same of Meta Ads. */
const COMPARING = new Set(["like", "unlike", "as", "with", "alongside"]);
/** Verbs after "so" or "as" that say the same again of the names after them: "and so did", "as is". */
const AGAIN_VERBS = new Set(["is", "are", "was", "were", "did", "does", "do", "has", "have", "had"]);
/** Words that say the same again of the names beside them: "the trade fair, too". */
const ALSO = new Set(["too", "also"]);

/** "And the trade fair too", "Meta Ads also": names with "too" or "also" and nothing else of their own. */
function alsoNames(atoms: readonly Atom[]): boolean {
  return (
    atoms.some((atom) => atom.kind === "mention") &&
    atoms.some((atom) => atom.kind === "word" && ALSO.has(atom.text)) &&
    atoms.every((atom) => atom.kind === "mention" || (atom.kind === "word" && (namesOnlyWord(atom.text) || ALSO.has(atom.text))))
  );
}

/** Words that add nothing to a name said again: "and Meta Ads did too", "with the trade fair". */
function namesOnlyWord(word: string): boolean {
  return FILLER.has(word) || AGAIN_VERBS.has(word) || word === "and";
}

/** "With Meta Ads", "alongside the trade fair": names put with the subject, and nothing else of their own. */
const WITH = new Set(["with", "alongside"]);

/**
 * True when the phrase says its clause's claim again of its own names: "and so did the trade fair",
 * "as is Meta Ads", "like Meta Ads", "and the trade fair too".
 */
function isCopy(phrase: Phrase): boolean {
  const word = (atom: Atom | undefined) => (atom?.kind === "word" ? atom.text : "");
  const start = word(phrase[0]) === "and" || word(phrase[0]) === "but" ? 1 : 0;
  const [first, second] = [word(phrase[start]), word(phrase[start + 1])];
  const withNames = WITH.has(first) && phrase.slice(start + 1).every((atom) => atom.kind === "mention" || namesOnlyWord(word(atom)));
  return (
    phrase.some((atom) => atom.kind === "mention") &&
    (first === "like" || withNames || ((first === "so" || first === "as") && AGAIN_VERBS.has(second)) || alsoNames(phrase))
  );
}

/**
 * True when the clause only says the clause before it again of other names: "...; the trade fair,
 * too.", "...; so is the trade fair.", "...; so did Meta Ads."
 */
function isCopyClause({ phrases }: Clause): boolean {
  const figures = phrases.some((phrase) => phrase.some((atom) => atom.kind === "figure"));
  return alsoNames(phrases.flat()) || (!figures && phrases.length === 1 && isCopy(phrases[0]));
}

/** "...; it is the only one": a clause that says "only" with no status of its own repeats the clause before. */
function isExclusiveRemark({ free }: Clause): boolean {
  const status = overWordAt(free) >= 0 || WITHIN.test(free.join(" ")) || free.some((word) => UNDER.has(word)) || deniesRest(free);
  return !status && free.some((word) => EXCLUSIVE.has(word));
}

/** The first phrase after the i-th that names something; an empty phrase when none does. */
function nextNamed(phrases: readonly Phrase[], i: number): Phrase {
  return phrases.slice(i + 1).find((phrase) => phrase.some((atom) => atom.kind === "mention")) ?? [];
}

/** The first names written in these phrases. */
function firstNames(phrases: readonly Phrase[]): Names | null {
  for (const phrase of phrases) {
    const [group] = groupPhrase(phrase).groups;
    if (group) {
      return group.parts;
    }
  }
  return null;
}

/**
 * The nearest figure from a word, crossing filler words only. Reaching forward it also crosses the
 * item the word is about: "the overspend on the trade fair is 200", "approved for Meta Ads, 3,200".
 */
function reachFigure(phrase: Phrase, from: number, step: 1 | -1): { at: number; distance: number } | null {
  for (let at = from + step, distance = 0; at >= 0 && at < phrase.length; at += step, distance += 1) {
    const atom = phrase[at];
    if (atom.kind === "figure") {
      return { at, distance };
    }
    const about = step === 1 && (atom.kind === "mention" || (atom.kind === "word" && ABOUT_ITEM.has(atom.text)));
    if (!(about || (atom.kind === "word" && FILLER.has(atom.text))) || distance === MAX_FILLER) {
      return null;
    }
  }
  return null;
}

/** Words that make "budget" part of another phrase: "over budget", "remaining budget", "on budget". */
const BUDGET_TAKERS = new Set([
  ...OVER,
  ...UNDER,
  // "Spent its budget of 4,500" spends the budget: the budget is still the approved amount.
  ...[...ROLE_CUES].flatMap(([word, role]) => (role === "spent" ? [] : [word])),
  "on",
]);

/** "The trade fair's budget is 4,500", "a budget of 4,500", "budget: 16,700": a budget on its own is the approved amount. */
function isBudgetCue(phrase: Phrase, at: number): boolean {
  const atom = phrase[at];
  if (atom?.kind !== "word" || (atom.text !== "budget" && atom.text !== "budgets")) {
    return false;
  }
  for (let k = at - 1; k >= 0; k -= 1) {
    const before = phrase[k];
    if (before.kind !== "word" || !FILLER.has(before.text)) {
      return !(before.kind === "word" && BUDGET_TAKERS.has(before.text));
    }
  }
  return true;
}

/** The cue word that ends a phrase, like "spent" in "spent, 200", "remaining" in "remaining: 9,800", or "budget" in "budget: 16,700". */
function trailingCue(phrase: Phrase | undefined): Role | undefined {
  for (let at = (phrase?.length ?? 0) - 1; phrase && at >= 0; at -= 1) {
    const atom = phrase[at];
    if (isBudgetCue(phrase, at)) {
      return "approved";
    }
    if (atom.kind !== "word" || !FILLER.has(atom.text)) {
      return atom.kind === "word" ? ROLE_CUES.get(atom.text) : undefined;
    }
  }
  return undefined;
}

type Meaning = { distance: number; roles: Set<Role>; readonly cue: number };
/**
 * What the rest of the sentence passes on: an over word so far or anywhere in this clause, which
 * makes "by 200" an overspend, and the meanings of the last phrase with figures.
 */
type Carry = {
  readonly overBefore: boolean;
  readonly prior: readonly ReadonlySet<Role>[];
  /** The meaning a heading like "spent:" gives the figures after it that have none. */
  readonly heading?: Role;
};

/**
 * What the phrase says each figure measures. A cue word speaks for the nearest figure, so in
 * "9,800 remains of 16,700" only 9,800 is said to remain. "By" after an over word, as in "over
 * its approved budget by 200", marks the overspend. A figure that opens its phrase takes the
 * cue that ends the phrase before it: "spent, 200", "remaining: 9,800". A budget on its own is
 * the approved amount, and so is the whole after "of": "spent 4,700 of 4,500". A cue after that
 * whole speaks for the part: in "6,900 of 16,700 has been spent", 6,900 is spent, and so does a
 * cue that reaches no figure: "6,900 of 16,700 approved is spent". Figures listed after a figure
 * share its meaning: "over budget by 100 and 200", "spent 4,700 and Meta Ads 3,300". A phrase with
 * no cue of its own repeats the meanings of the last phrase with figures: "Meta Ads spent 3,300,
 * and the trade fair 4,700", and "by 200" after "over budget" anywhere before it is an overspend.
 */
function meaningsIn(phrase: Phrase, before: Phrase | undefined, carry: Carry): Map<number, Set<Role>> {
  const nearest = new Map<number, Meaning>();
  const dangling: { cue: number; role: Role }[] = [];
  /** The figure each cue word reached. */
  const targets = new Map<number, number>();
  phrase.forEach((atom, at) => {
    const role = atom.kind === "word" ? ROLE_CUES.get(atom.text) : undefined;
    const reached = role ? [reachFigure(phrase, at, -1), reachFigure(phrase, at, 1)].flatMap((hit) => (hit ? [hit] : [])) : [];
    if (role && reached.length === 0) {
      // "4,500 approved remaining": a cue right after a cue that reached a figure says that figure is this too.
      const target = targets.get(at - 1);
      if (target !== undefined) {
        nearest.get(target)?.roles.add(role);
      } else {
        dangling.push({ cue: at, role });
      }
    }
    const closest = Math.min(...reached.map(({ distance }) => distance));
    for (const hit of reached.filter(({ distance }) => distance === closest)) {
      targets.set(at, hit.at);
      const known = nearest.get(hit.at);
      if (!known || hit.distance < known.distance) {
        nearest.set(hit.at, { distance: hit.distance, roles: new Set([role as Role]), cue: at });
      } else if (hit.distance === known.distance) {
        known.roles.add(role as Role);
      }
    }
  });
  let afterOver = carry.overBefore;
  phrase.forEach((atom, at) => {
    let k = at - 1;
    while (phrase[k]?.kind === "word" && APPROX.has((phrase[k] as Word).text)) {
      k -= 1;
    }
    const previous = phrase[k];
    if (atom.kind === "figure" && afterOver && previous?.kind === "word" && previous.text === "by") {
      nearest.set(at, { distance: 0, roles: new Set(["over"]), cue: k });
    }
    afterOver ||= atom.kind === "word" && OVER.has(atom.text);
  });
  // "Spent 200 more than approved", "spent 200 over": an over word right after the figure says it is the excess.
  nearest.forEach((meaning, at) => {
    const next = phrase[at + 1];
    if (meaning.roles.has("spent") && meaning.roles.has("over") && next?.kind === "word" && OVER.has(next.text)) {
      meaning.roles.delete("spent");
    }
  });
  const opening = phrase.findIndex((atom) => atom.kind !== "word" || !FILLER.has(atom.text));
  const carried = trailingCue(before);
  if (phrase[opening]?.kind === "figure" && carried && !nearest.has(opening)) {
    nearest.set(opening, { distance: 0, roles: new Set([carried]), cue: -1 });
  }
  phrase.forEach((_, at) => {
    const hit = isBudgetCue(phrase, at) ? reachFigure(phrase, at, 1) : null;
    const known = hit ? nearest.get(hit.at) : undefined;
    if (hit && (!known || hit.distance < known.distance)) {
      nearest.set(hit.at, { distance: hit.distance, roles: new Set(["approved"]), cue: at });
    }
  });
  phrase.forEach((atom, at) => {
    const part = atom.kind === "figure" ? partOf(phrase, at) : null;
    const known = nearest.get(at);
    if (part === null || known?.roles.has("approved")) {
      return;
    }
    if (known && known.cue > at && !nearest.has(part)) {
      nearest.set(part, known);
    }
    if (!known || known.cue > at) {
      nearest.set(at, { distance: 0, roles: new Set(["approved"]), cue: at });
    }
  });
  for (const { cue, role } of dangling) {
    for (let at = cue - 1; at >= 0; at -= 1) {
      const part = phrase[at].kind === "figure" ? partOf(phrase, at) : null;
      if (part !== null) {
        if (!nearest.has(part)) {
          nearest.set(part, { distance: 0, roles: new Set([role]), cue });
        }
        break;
      }
    }
  }
  phrase.forEach((atom, at) => {
    for (let k = at - 1; atom.kind === "figure" && !nearest.has(at) && k >= 0; k -= 1) {
      const earlier = phrase[k];
      if (earlier.kind === "figure") {
        // After the whole of "4,700 of 4,500", a new pair starts with a part: "and 3,300 of 3,200".
        const known = nearest.get(partOf(phrase, k) ?? k);
        if (known) {
          nearest.set(at, { ...known, roles: new Set(known.roles) });
        }
        break;
      }
      if (earlier.kind === "word" && !FILLER.has(earlier.text) && earlier.text !== "and" && earlier.text !== "or") {
        break;
      }
    }
  });
  const ownCue = phrase.some((atom, at) => (atom.kind === "word" && ROLE_CUES.has(atom.text)) || isBudgetCue(phrase, at));
  const figures = phrase.flatMap((atom, at) => (atom.kind === "figure" ? [at] : []));
  const [first] = carry.prior;
  const alike = first !== undefined && carry.prior.every((roles) => roles.size === first.size && [...roles].every((role) => first.has(role)));
  figures.forEach((at, i) => {
    const roles = figures.length === carry.prior.length ? carry.prior[i] : alike ? first : undefined;
    if (!ownCue && roles && !nearest.has(at)) {
      nearest.set(at, { distance: 0, roles: new Set(roles), cue: -1 });
    }
  });
  figures.forEach((at) => {
    if (carry.heading && !nearest.has(at)) {
      nearest.set(at, { distance: 0, roles: new Set([carry.heading]), cue: -1 });
    }
  });
  return new Map([...nearest].map(([at, { roles }]) => [at, roles]));
}

/** A heading like "over budget:" before the clause's first name or figure gives its meaning to figures with none. */
function headingOf({ phrases }: Clause): Role | undefined {
  for (const [i, phrase] of phrases.entries()) {
    if (phrase.some((atom) => atom.kind !== "word")) {
      return undefined;
    }
    const role = trailingCue(phrase);
    if (role && i + 1 < phrases.length) {
      return role;
    }
  }
  return undefined;
}

/**
 * "Spent 4,700 of 4,500", "9,800 remaining out of 16,700": the figure after "of" is the whole, the
 * approved amount. Returns where the part before "of" sits, or null.
 */
function partOf(phrase: Phrase, at: number): number | null {
  let of = false;
  for (let k = at - 1; k >= 0; k -= 1) {
    const atom = phrase[k];
    if (atom.kind === "figure") {
      return of ? k : null;
    }
    if (atom.kind !== "word" || !(FILLER.has(atom.text) || (of && (atom.text === "out" || ROLE_CUES.has(atom.text))))) {
      return null;
    }
    of ||= atom.text === "of";
  }
  return null;
}

/**
 * A figure said about a line must belong to that line, so a total is never one item's figure,
 * and must measure what the sentence says it does. A phrase that names nothing but points back,
 * like "it spent", ", which is", or ", leaving", or that opens with its figure, like ", by 100",
 * is about whatever the phrase before it was about: named lines, or the whole budget after "the
 * total spent was 6,900". Before anything is named, a nameless phrase is about the first names
 * after it in its clause, or the whole budget: "by 100, the trade fair is over budget". Any other
 * nameless phrase may use totals, or the figures of any line the sentence names. "100 each" must
 * belong to every name it follows. Returns, for each clause, a reason to withhold it and whether
 * every figure in it was said to measure something.
 */
function judgeFigures(
  clauses: readonly Clause[],
  grounds: Grounds,
): { readonly reason: WithheldReason | null; readonly explained: boolean }[] {
  const named = new Set(clauses.flatMap((clause) => clause.mentions.flatMap((mention) => mention.owners)));
  /** loose: a total fits as well as the named lines' own figures. */
  const belongs = ({ value, names }: Bound, shared: boolean, loose: boolean) => {
    const key = figureKey(value);
    const owners = [...(grounds.owners.get(key) ?? [])];
    if (loose && grounds.shared.has(key)) {
      return true;
    }
    if (names === WHOLE) {
      return grounds.shared.has(key);
    }
    if (names && ![...names].some((name) => grounds.items.has(name))) {
      // A line's figure is not its category's figure: "Digital advertising spent 3,300".
      return false;
    }
    if (names) {
      return shared ? [...names].every((name) => owners.includes(name)) : owners.some((owner) => names.has(owner));
    }
    return grounds.shared.has(key) || owners.length === 0 || owners.some((owner) => named.has(owner));
  };
  const measures = ({ value, names }: Bound, meant: ReadonlySet<Role>, loose: boolean) => {
    const byOwner = grounds.roles.get(figureKey(value)) ?? new Map<string, ReadonlySet<Role>>();
    const holders = names === WHOLE ? [""] : names ? [...names, ...(loose ? [""] : [])] : [...byOwner.keys()];
    const roles = holders.flatMap((holder) => [...(byOwner.get(holder) ?? [])]);
    // Below zero, remaining means over budget and an overspend means under it; nothing is spent or approved below zero.
    const said = value < 0 ? new Set([...meant].map((role) => FLIPPED[role])) : meant;
    // Every meaning the sentence gives the figure must hold: "spent 200 over" says it is both, and it is not.
    return said.size > 0 && [...said].every((role) => role !== null && roles.includes(role));
  };
  let previous: Subject = null;
  let carry: Carry = { overBefore: false, prior: [] };
  /** The figures the clause before said, with what each measures, for a clause that says it again. */
  let saidBefore: { readonly figure: Bound; readonly meant: ReadonlySet<Role> | undefined }[] = [];
  return clauses.map((clause) => {
    let reason: WithheldReason | null = null;
    let explained = true;
    const saidHere: typeof saidBefore = [];
    for (const [i, phrase] of clause.phrases.entries()) {
      const words = phrase.flatMap((atom) => (atom.kind === "word" ? [atom.text] : []));
      const nameless = !phrase.some((atom) => atom.kind === "mention");
      const aboutWhole = words.some((word) => TOTALS.has(word) || (nameless && HOLDERS.has(word)));
      const opening = phrase.find((atom) => atom.kind !== "word" || !FILLER.has(atom.text));
      const goesOn = i > 0 && opening?.kind === "figure";
      // "It has 9,800 left overall": "it" is still the item, whatever else the phrase says.
      const pronoun = words.some((word) => REFERRING.has(word));
      const pointsBack = (words.some((word) => ANAPHORA.has(word)) || goesOn) && (!aboutWhole || pronoun);
      const predicate = nameless && !aboutWhole && i > 0 && PREDICATES.has(openingWord(phrase, LEADING) ?? "");
      const subject = predicate ? subjectOf(clause, i) : null;
      const ahead = nameless && previous === null && !aboutWhole ? firstNames(clause.phrases.slice(i + 1)) : null;
      const shared = words.some((word) => DISTRIBUTIVE.has(word));
      // A nameless phrase about the whole budget takes totals only: "and the total spent is 6,900".
      // One figure in brackets after a list is about the name just before it: "Meta Ads (100) and the trade fair (200)".
      const back = pointsBack ? previous : null;
      const lone = clause.asides.has(i) && phrase.filter((atom) => atom.kind === "figure").length === 1;
      const nearestBack = lone && back !== null && back !== WHOLE && back.length > 1 ? [back[back.length - 1]] : back;
      const leaning = subject ?? nearestBack ?? ahead ?? (nameless && aboutWhole ? WHOLE : null);
      const { bound, last } = bindPhrase(phrase, leaning, listedBefore(clause, i));
      const overInClause = clause.free.some((word) => OVER.has(word));
      const meanings = meaningsIn(phrase, clause.phrases[i - 1], {
        ...carry,
        overBefore: carry.overBefore || overInClause,
        heading: headingOf(clause),
      });
      // "Having spent 6,900, the trade fair..." is about the trade fair alone; "16,700 approved, ..." may be a total.
      // "16,700 approved, 10,200 spent, and Meta Ads is over budget" lists totals before a new statement, which may
      // stand for the whole budget; "after spending 6,900, the trade fair..." is about the trade fair alone.
      const startsNew = ["and", "but", "while", "whereas"].includes(openingWord(nextNamed(clause.phrases, i)) ?? "");
      // "Of the 16,700 approved, the trade fair spent 4,700" sets the item inside the whole budget.
      const partOfWhole = words[0] === "of" || (words[0] === "out" && words[1] === "of");
      const loose =
        leaning !== null && leaning === ahead && (startsNew || partOfWhole) && !words.some((word) => ANAPHORA.has(word));
      for (const figure of bound) {
        const meant = meanings.get(figure.at);
        explained &&= meant !== undefined;
        if (!belongs(figure, shared || figure.every, loose)) {
          reason ??= "wrong_item";
        } else if (meant && !measures(figure, meant, loose)) {
          reason ??= "misread_figure";
        }
        if (!isCopy(phrase)) {
          saidHere.push({ figure, meant });
        }
      }
      const said = phrase.flatMap((atom, at) => (atom.kind === "figure" ? [meanings.get(at)] : [])).filter((roles) => roles !== undefined);
      carry = {
        overBefore: carry.overBefore || words.some((word) => OVER.has(word)),
        prior: said.length > 0 ? said : carry.prior,
      };
      if (!clause.asides.has(i)) {
        previous = last ?? subject ?? (aboutWhole ? WHOLE : previous);
      }
    }
    // "Like Meta Ads", "and so did Meta Ads", "; Meta Ads, too": every figure said must hold for the copied names as well.
    const copyClause = isCopyClause(clause);
    const copied = clause.phrases
      .filter((phrase) => copyClause || isCopy(phrase))
      .flatMap((phrase) => groupPhrase(phrase).groups.flatMap((group) => group.parts));
    for (const part of copied) {
      for (const { figure, meant } of copyClause ? saidBefore : saidHere) {
        const again: Bound = { ...figure, names: part, every: false };
        if (!belongs(again, false, false) || (meant && !measures(again, meant, false))) {
          reason ??= "wrong_item";
        }
      }
    }
    saidBefore = saidHere.length > 0 ? saidHere : saidBefore;
    return { reason, explained };
  });
}

/** "Will be", "could be", "used to be", "before": the watcher says what is over budget now, not a guess or another time. */
function isHedged(free: readonly string[]): boolean {
  return free.some(
    (word, i) =>
      HEDGES.has(word) ||
      ((word === "used" || word === "going") && free[i + 1] === "to") ||
      (word === "had" && free[i + 1] === "been"),
  );
}

/** Where the clause's over word is, or -1; "left over" is what remains, not an overspend. */
function overWordAt(free: readonly string[]): number {
  return free.findIndex((word, i) => OVER.has(word) && !(word === "over" && free[i - 1] === "left"));
}

/** True when the clause calls something over budget, with no negator before the over word. */
function claimsOver(free: readonly string[]): boolean {
  const overAt = overWordAt(free);
  return overAt >= 0 && !free.slice(0, overAt).some((word) => NEGATORS.has(word));
}

function judgeClause(clause: Clause, grounds: Grounds, sentenceCovers: boolean): WithheldReason | null {
  const { free } = clause;
  const overAt = overWordAt(free);
  const status = overAt >= 0 || WITHIN.test(free.join(" ")) || free.some((word) => UNDER.has(word)) || deniesRest(free);
  if (status && isHedged(free)) {
    return "contradicts_watcher";
  }
  if (claimsOver(free)) {
    return judgeOverClaim(clause, grounds, sentenceCovers);
  }
  return status ? judgeDenial(clause, grounds, sentenceCovers) : null;
}

/**
 * A clause must say what each of its figures measures: "SAMPLE DATA: 16700" says nothing Paola can
 * check, and in "the trade fair came in at 4,500, over budget" nothing says what 4,500 is.
 */
function judgeExplained(explained: boolean): WithheldReason | null {
  return explained ? null : "unexplained_figure";
}

/** Every other word must be one that names nothing: anything else may be an item the tool result does not have. */
function judgeWords({ free }: Clause): WithheldReason | null {
  return free.every((word) => VOCABULARY.has(word)) ? null : "unknown_item";
}

function withheld<T>(reason: WithheldReason, toolResult: T): Narration<T> {
  return { status: "withheld", reason, message: NOTICES[reason], toolResult };
}

/** One short sentence for Paola is far shorter than this; anything longer is withheld unread. */
const MAX_SENTENCE = 1000;

/**
 * Gemma's sentence for Paola is shown only when it is grounded in the tool
 * result: the checks in judgeSentence find nothing false in it, and it is the
 * over-budget facts in the shape the prompt writes them (judgeShape).
 * Otherwise the tool result is shown instead, never the sentence.
 * It never throws: anything it cannot read is withheld.
 */
export function withholdNarration<T>(sentence: string | null | undefined, toolResult: T): Narration<T> {
  if (toolResult === null || toolResult === undefined) {
    return withheld("no_tool_result", toolResult);
  }
  const text = typeof sentence === "string" ? sentence.trim() : "";
  if (!text) {
    return withheld("empty", toolResult);
  }
  if (text.length > MAX_SENTENCE) {
    return withheld("too_long", toolResult);
  }
  try {
    // A tool result that cannot be written as JSON, like one that contains itself, is not one a bot returned.
    JSON.stringify(toolResult);
    const checked = judgeSentence(text, toolResult);
    const shape = judgeShape(text, toolResult);
    // Gemma copied the facts exactly, so the notice must not blame Gemma for a claim it never made: either
    // the open-wording checks misread an item name, like "Red carpet", or Note does not narrate this budget.
    const copied = shape === "unnarrated_budget" && copiesFacts(text, toolResult);
    const reason = copied ? shape : checked && shape === null ? "unread_name" : (checked ?? shape);
    return reason ? withheld(reason, toolResult) : { status: "narrated", sentence: text, toolResult };
  } catch {
    return withheld("unreadable", toolResult);
  }
}

/** "No item is over budget", the prompt's own words for an empty list. */
const NO_ITEM = /^no (?:item is|items are) over budget$/;
/**
 * "Is over budget by 200": the prompt's words for one fact, and the one other form a small model
 * writes them in. Never "was": the tool result says what is over budget now. Never "are": "the ads
 * are over budget" reads as every ad.
 */
const FACT_VERB = "(?:is over budget|overspent) by ";
/**
 * A figure as the prompt writes it, or with thousands commas: 200, 996800, 996,800, 0.5. Never a
 * leading zero: "0,200" is 0.2 where a comma marks decimals. No ASCII digit may follow it, even past
 * a comma and a space, so "0200" and "200.505" are no figure. A line name that starts with any
 * numeral, as in "by 1, 500 flyers" (read as 1,500), is refused before this by isPlainName.
 */
const FACT_FIGURE = "((?:0|[1-9]\\d{0,2}(?:,\\d{3})+|[1-9]\\d*)(?:\\.\\d{1,2})?)(?!\\d|[.,] ?\\d)";
/**
 * Facts from here up are refused. The app's own sums of cents start to drift from about 2^44
 * (1.76e13), and lone numbers stop holding every cent near 7e13; below 1e12 every figure here
 * compares exactly to the cent, with a wide margin. A boundary test pins this value, and a drift
 * test shows a real drifted budget at 2.4e13.
 */
const MAX_FACT = 1e12;
/** What may join two facts: "; ", ", ", " and ", ", and ", "; and ". */
const JOINTS = ["; and ", ", and ", "; ", ", ", " and "];

/**
 * Note narrates only the shape the prompt writes out and gemma3:1b copies at temperature 0: the
 * over-budget facts, "the Q4 trade fair is over budget by 200", joined by ";", ",", or "and", with
 * every listed item named once with its own overspend; or "No item is over budget" when the
 * watcher lists none. Open English can say more than the checks above can follow, so any other
 * wording is withheld even when they find nothing false in it, and the tool result is shown.
 * Exported so tests can check it on its own, apart from the checks that run before it.
 */
export function judgeShape(sentence: string, toolResult: unknown): WithheldReason | null {
  if (overBudgetLists(toolResult).length === 0) {
    return "unchecked_wording";
  }
  const facts = overBudgetFacts(toolResult);
  return facts === null ? "unnarrated_budget" : matchFacts(sentence, [...facts]);
}

/**
 * True when the sentence is the facts exactly as the prompt writes them, for a budget whose facts
 * Note refuses to narrate: the notice then says the budget is the reason, not Gemma's wording.
 * The facts are read the way prompts.ts writes them, one per over-budget line, so two lines named
 * alike give two facts. This only chooses the notice; it never narrates anything.
 */
function copiesFacts(sentence: string, toolResult: unknown): boolean {
  const facts = promptFacts(toolResult);
  return facts !== null && matchFacts(sentence, facts) === null;
}

/** The over-budget facts as prompts.ts writes them: each line with spent over approved, by item and overspend. */
function promptFacts(toolResult: unknown): (readonly [string, number])[] | null {
  const lines = toolResult && typeof toolResult === "object" ? (toolResult as { lines?: unknown }).lines : undefined;
  if (!Array.isArray(lines)) {
    return null;
  }
  const facts: (readonly [string, number])[] = [];
  for (const line of lines) {
    const { item, spent, approved, overspend } = (line ?? {}) as Record<string, unknown>;
    if (typeof spent === "number" && typeof approved === "number" && spent > approved) {
      if (typeof item !== "string" || typeof overspend !== "number") {
        return null;
      }
      facts.push([plain(item), overspend]);
    }
  }
  return facts;
}

/**
 * Why the sentence is not these facts in the shape the prompt writes them, or null when it is:
 * every fact named once, at its own amount, and nothing else.
 */
function matchFacts(sentence: string, facts: readonly (readonly [string, number])[]): WithheldReason | null {
  const written = plainSentence(sentence);
  if (written === null) {
    return "unchecked_wording";
  }
  let rest = written.replace(/^sample data: /, "").replace(/\.$/, "");
  if (NO_ITEM.test(rest)) {
    return facts.length === 0 ? null : "contradicts_watcher";
  }
  const used = facts.map(() => false);
  // Each fact must run from its name to its figure, so one name cannot match the start of another;
  // order matters only beside the optional "the", where "The Ads" is tried before "Ads".
  const patterns = [...new Set(facts.map(([name]) => name))]
    .sort((a, b) => b.length - a.length)
    .map((name) => ({ name, pattern: new RegExp(`^(?:the )?${escapeRegExp(name)} ${FACT_VERB}${FACT_FIGURE}`) }));
  for (;;) {
    let fact: { readonly name: string; readonly match: RegExpExecArray } | undefined;
    for (const { name, pattern } of patterns) {
      const match = pattern.exec(rest);
      if (match) {
        fact = { name, match };
        break;
      }
    }
    const said = fact ? Number(fact.match[1].replace(/,/g, "")) : Number.NaN;
    const open = facts.flatMap(([name], i) => (fact && name === fact.name && !used[i] ? [i] : []));
    if (!fact || open.length === 0) {
      return "unchecked_wording";
    }
    const at = open.find((i) => sameAmount(said, facts[i][1]));
    if (at === undefined) {
      return "contradicts_watcher";
    }
    used[at] = true;
    rest = rest.slice(fact.match[0].length);
    if (rest === "") {
      return used.every(Boolean) ? null : "contradicts_watcher";
    }
    const joint = JOINTS.find((candidate) => rest.startsWith(candidate));
    if (!joint) {
      return "unchecked_wording";
    }
    rest = rest.slice(joint.length);
  }
}

/**
 * A name from the tool result, compared without case, in NFC, and with one space between words.
 * Category names pass through nothing else, so this folding is all that compares them with items.
 */
function plain(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * A name as a reader takes it, for telling two names apart. Accents, modifier marks, and the
 * saltillo (a letter drawn as an apostrophe) drop out first, so "McDonald´s" stays one word; then
 * every other mark splits words, a lone possessive
 * "s" drops, a leading article drops, each word loses a plural "s", and the words are joined with
 * no spaces. "Kids´ party", "Kids' party", and "Kids party" read alike, as do "McDonald´s" and
 * "McDonald's", "Sales team" and "Sales-team", and "Events" and "Event". It only ever refuses:
 * two listed lines read alike cannot be told apart in a sentence, and an item read like a listed
 * line's category reads as that category.
 */
function alike(name: string): string {
  const words = name
    .replace(/[\p{Sk}\p{Lm}\p{M}\u{A78B}\u{A78C}]/gu, "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && word !== "s");
  const stem = (word: string) => (word.length > 2 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
  return (ARTICLES.has(words[0] ?? "") ? words.slice(1) : words).map(stem).join("");
}
const ARTICLES = new Set(["the", "el", "la", "los", "las"]);
/** The dashes a name may hold: hyphen-minus, en dash, em dash. */
const PLAIN_DASHES = new Set([0x2d, 0x2013, 0x2014]);

/**
 * The sentence in lower case, or null when what Paola would be shown could differ from what is
 * checked: a control or invisible character, any space but a plain one, or text that Unicode
 * normalisation would change, like a Greek question mark that reads as ";".
 */
function plainSentence(text: string): string | null {
  // Ignorable marks (a combining grapheme joiner, a Hangul filler, a variation selector) and the Braille blank draw as nothing.
  const invisible = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u;
  if (invisible.test(text) || /[^\S ]/.test(text) || text !== text.normalize("NFC")) {
    return null;
  }
  return text.replace(/ +/g, " ").trim().toLowerCase();
}

function sameAmount(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.round(a * 100) === Math.round(b * 100);
}

/**
 * The watcher's list as plain facts, item name to overspend, read from the tool result itself; null
 * when there is no list, or when Note does not narrate these facts: an item or overspend it cannot
 * read for certain, one name on two lines, an amount of MAX_FACT or more, or a name that reads as
 * something other than its own line.
 */
function overBudgetFacts(toolResult: unknown): Map<string, number> | null {
  const lists = overBudgetLists(toolResult);
  if (lists.length === 0) {
    return null;
  }
  // No amount is below zero, so the totals bound every line, even one that rounding has dropped from the list.
  const totals = [topField(toolResult, roleField("approved")), topField(toolResult, roleField("spent"))];
  if (totals.some((total) => total !== null && !(Math.abs(total) < MAX_FACT))) {
    return null;
  }
  const entries = lists.flat();
  const names = entries.map((entry) => (typeof entry === "string" ? entry.trim() : firstField(entry, ITEM_KEY, "string")));
  // "overBudget: ['Q4 trade fair'], totalOver: 200": with one item listed, the total is its overspend.
  const total = new Set(names).size === 1 ? topField(toolResult, OVER_FIELD) : null;
  // One name on two lines of the same list is two lines the facts cannot tell apart, even when they
  // differ only in case. The same line may still appear in two lists, like overBudget and lines.
  const repeated = lists.some((list) => {
    const keys = list.map((entry) => (typeof entry === "string" ? entry : firstField(entry, ITEM_KEY, "string")));
    return new Set(keys.map((key) => (typeof key === "string" ? alike(key) : key))).size < keys.length;
  });
  // "Events is over budget by 50" reads as the Events category when a listed line is filed under Events.
  const categories = new Set(entries.flatMap((entry) => {
    const category = firstField(entry, CATEGORY_KEY, "string");
    return typeof category === "string" ? [alike(category)] : [];
  }));
  if (repeated || names.some((name) => typeof name === "string" && categories.has(alike(name)))) {
    return null;
  }
  const facts = new Map<string, number>();
  for (const [i, entry] of entries.entries()) {
    const name = names[i];
    const over = typeof entry === "string" ? total : entryOverspend(entry);
    if (typeof name !== "string" || !isPlainName(name) || over === null || !(over > 0) || over >= MAX_FACT) {
      return null;
    }
    const key = plain(name);
    const known = facts.get(key);
    if (known !== undefined && !sameAmount(known, over)) {
      return null;
    }
    facts.set(key, over);
  }
  return facts;
}

/**
 * Words that make a listed name read as something other than one line: other lines or the whole
 * budget ("The rest", "Every item", "Paola"), or the narration's own words ("…overspent by 300").
 */
const NOT_A_NAME = new Set([
  ...UNIVERSAL, ...REST, ...TOTALS, ...HOLDERS, ...COUNTED, ...EXCLUSIVE, ...NEGATORS, ...LEFT, "leftovers",
  "remainder", "remaining", "balance", "some", "most", "many", "several", "few", "various", "both", "everyone",
  "everybody", "anyone", "anybody", "nobody", "yours", "ours", "mine", "paolas",
  // Whole-budget, time, and per-unit words: "Subtotal", "Year to date", "Monthly", "Per head".
  "subtotal", "subtotals", "expenses", "expenditure", "expenditures", "actuals", "ytd", "annual", "monthly", "yearly",
  "quarterly", "weekly", "daily", "month", "months", "year", "years", "quarter", "quarters", "week", "weeks", "global",
  "wide", "average", "per", "etc", "lot", "majority", "hourly", "nightly", "biweekly", "bimonthly", "fortnightly",
  "biannual", "semiannual", "semiannually",
  // Words that join two lines into one name: "Google plus Meta" reads as both lines.
  "plus", "vs", "versus", "x",
  // The same in Spanish, which the CSV loader also reads: "Otros", "Resto", "Mensual", "Google y Meta".
  "otros", "otras", "otro", "otra", "resto", "demas", "demás", "varios", "varias", "todo", "todos", "toda", "todas",
  "cada", "ninguno", "ninguna", "nada", "mensual", "anual", "semanal", "diario", "diaria", "trimestral", "semestral",
  "presupuesto", "presupuestos", "totales", "y", "o", "mas", "más", "contra", "ejemplo", "datos",
  "budget", "budgets", "over", "overspent", "overspend", "by", "is", "are", "was", "were", "and", "or", "sample",
  "samples", "data",
]);
/** Words a name may not start with, since they continue the figure before it: "by 5 and a half-day workshop". */
const FIGURE_STARTS = new Set(["a", "an", "half", "halves", "quarter", "third", "thirds", "dozen"]);
/**
 * A period on its own: a name made only of these reads as the whole period, like "Q4", "March
 * 2026", "Summer", or "Day 1". A longer name, like "Summer festival", is one line's name.
 */
const PERIOD_WORD = new RegExp(
  `^(?:q[1-4]|h[12]|fy\\d{2,4}|\\d{1,4}|${[
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november",
    "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
    "spring", "summer", "autumn", "fall", "winter", "season", "seasons", "christmas", "xmas", "easter", "holiday",
    "holidays", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "tues", "wed",
    "thu", "thur", "thurs", "fri", "sat", "sun", "weekend", "weekends", "weekday", "weekdays", "today", "tonight",
    "tomorrow", "yesterday", "day", "days", "night", "nights", "phase", "sprint", "term", "semester",
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre",
    "noviembre", "diciembre", "lunes", "martes", "miercoles", "miércoles", "jueves", "viernes", "sabado", "sábado",
    "domingo", "primavera", "verano", "otono", "otoño", "invierno", "navidad", "pascua", "hoy", "semana", "semanas",
    "mes", "meses", "año", "años", "trimestre", "semestre", "dia", "día", "dias", "días", "noche", "noches", "fase",
  ].join("|")})$`,
);

/**
 * True when a listed name can stand in the shape as a name and nothing else. Line names come from
 * a CSV Paola may write herself: "The rest" reads as every other line, "Google Ads overspent by
 * 300; Google Ads" as two facts, "½ page ad" runs on from the figure before it, and an invisible
 * mark or a letter from another script inside a word makes one name look like another (a whole
 * word in another script is not caught). This cannot be complete: it refuses the names that read
 * as something else most often, and anything it cannot read.
 */
export function isPlainName(name: string): boolean {
  // "Google  Ads" is drawn as "Google Ads", which may be another line: one space between words, none around them.
  // A compatibility form, like a ligature or a non-breaking hyphen, is drawn like another name too, and so is a
  // modifier letter or symbol (a modifier-letter apostrophe), a combining mark, the saltillo, or any dash but -,
  // en, and em.
  const odd =
    plainSentence(name) === null ||
    name !== name.normalize("NFKC") ||
    [...name].some((mark) => {
      const code = mark.codePointAt(0) ?? 0;
      return /[\p{Lm}\p{Sk}\p{M}\u{A78B}\u{A78C}]/u.test(mark) || (/\p{Pd}/u.test(mark) && !PLAIN_DASHES.has(code)) || code === 0x2043;
    });
  if (!name.trim() || odd || /[;,:&+/]/.test(name) || /^ | $| {2}/.test(name)) {
    return false;
  }
  const words = name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const startsLikeFigure = /^\p{N}/u.test(name) || isNumberWord(words[0] ?? "") || FIGURE_STARTS.has(words[0] ?? "");
  const mixedScripts = words.some((word) => /\p{Script=Latin}/u.test(word) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(word));
  const periodOnly = words.every((word) => PERIOD_WORD.test(word));
  return !startsLikeFigure && !mixedScripts && !periodOnly && !words.some((word) => NOT_A_NAME.has(word));
}

/**
 * An entry's overspend: its own over field, or spent minus approved; both, when given, must agree.
 * Amounts too large to check to the cent give none.
 */
function entryOverspend(entry: unknown): number | null {
  const field = firstField(entry, OVER_FIELD, "number");
  const spent = firstField(entry, roleField("spent"), "number");
  const approved = firstField(entry, roleField("approved"), "number");
  if ([spent, approved].some((amount) => typeof amount === "number" && !(Math.abs(amount) < MAX_FACT))) {
    return null;
  }
  const difference = typeof spent === "number" && typeof approved === "number" ? spent - approved : null;
  if (typeof field === "number" && difference !== null) {
    return sameAmount(field, difference) ? field : null;
  }
  return typeof field === "number" ? field : difference;
}

function roleField(wanted: Role): RegExp {
  return ROLE_FIELDS.find(([, role]) => role === wanted)?.[0] ?? /(?!)/;
}

/** The first value of this type under a matching key, searching the object depth first. */
function firstField(value: unknown, key: RegExp, type: "string" | "number"): string | number | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  for (const [name, child] of Object.entries(value)) {
    if (key.test(name) && typeof child === type && (type === "string" || Number.isFinite(child))) {
      return child as string | number;
    }
  }
  for (const child of Object.values(value)) {
    const found = firstField(child, key, type);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** A number directly under a matching key at the tool result's top level. */
function topField(toolResult: unknown, key: RegExp): number | null {
  if (!toolResult || typeof toolResult !== "object" || Array.isArray(toolResult)) {
    return null;
  }
  const found = Object.entries(toolResult).find(([name, child]) => key.test(name) && typeof child === "number" && Number.isFinite(child));
  return found ? (found[1] as number) : null;
}

/** Why the sentence must be withheld, or null when every claim in it is grounded in the tool result. */
function judgeSentence(text: string, toolResult: unknown): WithheldReason | null {
  if (text.includes("?")) {
    return "question";
  }
  const grounds = collectGrounds(toolResult);
  const clauses = readSentence(text, grounds);
  const atoms = clauses.flatMap((clause) => clause.phrases.flat());
  if (atoms.every((atom) => atom.kind === "word" && LABEL.has(atom.text))) {
    return "empty";
  }
  const figures = clauses.flatMap(figuresIn);
  if (figures.some((figure) => figure === null || !grounds.figures.has(figureKey(figure)))) {
    return "invented_figure";
  }
  if (pointsAtNothing(clauses)) {
    return "unknown_item";
  }
  const abouts = clauses.map(pointedAt);
  if (abouts.some((about, i) => about.mentions !== clauses[i].mentions && isAmbiguous(clauses[i], about.mentions))) {
    return "unknown_item";
  }
  // "Nothing else is over budget" is true only when the names said to be over budget are the whole list.
  const sentenceCovers = coversList(
    abouts.flatMap((about, i) => (!claimsOver(about.free) ? [] : about === clauses[i] ? claimedOver(about) : about.mentions)),
    grounds,
  );
  const figureJudgements = judgeFigures(clauses, grounds);
  for (const [i, clause] of clauses.entries()) {
    const { reason: figureReason, explained } = figureJudgements[i];
    const about = abouts[i];
    const whole = judgeWhole(about, grounds);
    const split = whole.whole ? null : splitWholeClaims(about, whole.atoms);
    // "...over budget; Digital advertising, too" calls Digital advertising over budget as well.
    const copiesOver = i > 0 && (isCopyClause(clause) || isExclusiveRemark(clause)) && claimsOver(clauses[i - 1].free);
    const reason =
      judgeLabel(clause) ??
      judgeComparison(clause) ??
      judgeCause(clause) ??
      judgeListedDenied(clause, grounds) ??
      judgeAsides(clause, grounds) ??
      whole.reason ??
      (copiesOver ? judgeOverClaim(about, grounds, sentenceCovers) : null) ??
      (split?.says === false ? "unclear_item" : null) ??
      (whole.whole ? null : judgeClause(split?.rest ?? about, grounds, sentenceCovers)) ??
      figureReason ??
      judgeWords(clause) ??
      judgeExplained(explained);
    if (reason) {
      return reason;
    }
  }
  return null;
}

/**
 * Each clause with the names it is about. "It is over budget by 200" after a clause that names the
 * trade fair is about the trade fair; a clause that names something is about what it names.
 */
function pointedAt(clause: Clause, i: number, clauses: readonly Clause[]): Clause {
  if (clause.mentions.length > 0 || !clause.free.some((word) => PRONOUNS.has(word))) {
    return clause;
  }
  const named = clauses.slice(0, i).findLast((before) => before.mentions.length > 0)?.mentions ?? [];
  return { ...clause, mentions: named };
}

/** True when "it" stands for names that are not one thing: "Meta Ads and the trade fair spent...; it is over budget". */
function isAmbiguous(clause: Clause, named: readonly Mention[]): boolean {
  const atoms = clause.phrases.flat();
  const singular = atoms.some((atom, at) => {
    const next = atoms[at + 1];
    return atom.kind === "word" && atom.text === "it" && !(next?.kind === "word" && DUMMY_IT.has(next.text));
  });
  const plural = clause.free.some((word) => PLURAL.has(word));
  const same = (a: Mention, b: Mention) => a.lines.some((line) => b.lines.includes(line)) || a.owners.some((owner) => b.owners.includes(owner));
  return singular && !plural && named.some((a) => named.some((b) => !same(a, b)));
}

/** Words that only lead into a claim about the whole budget: "but, overall, you are within budget". */
const LEAD_IN = new Set([...CONTRAST, ...TOTALS, "and", "still", "in", "all"]);
/** Words that start a statement of its own inside a clause. */
const CONNECTIVES = new Set([...CONTRAST, "and"]);

/**
 * The clause apart from its checked claims about the whole budget, so that "the trade fair is over
 * budget by 200, but overall you are within budget" is judged as the trade fair's claim alone; null
 * when it makes no such claim. says is false when what is left says nothing of its own, as in "the
 * trade fair, but overall you are within budget". The rest is cut out only when each claim about
 * the whole budget starts a statement of its own, with "and", "but", or "while".
 */
function splitWholeClaims(clause: Clause, whole: ReadonlySet<Atom>): { readonly rest: Clause; readonly says: boolean } | null {
  if (whole.size === 0) {
    return null;
  }
  const atoms = clause.phrases.flat();
  const drop = new Set(whole);
  let ownStatements = true;
  for (const [at, atom] of atoms.entries()) {
    if (!whole.has(atom) || (at > 0 && whole.has(atoms[at - 1]))) {
      continue;
    }
    let start = at;
    while (start > 0 && !drop.has(atoms[start - 1]) && isLeadIn(atoms[start - 1])) {
      start -= 1;
      drop.add(atoms[start]);
    }
    const first = atoms[start];
    ownStatements &&= first.kind === "word" && CONNECTIVES.has(first.text);
  }
  // Something a judge can check: a figure, or an over-budget or within-budget status. "The trade
  // fair spending, but overall..." says nothing of the trade fair.
  const words = atoms.flatMap((atom) => (atom.kind === "word" && !drop.has(atom) ? [atom.text] : []));
  const says =
    atoms.some((atom) => atom.kind === "figure" && !drop.has(atom)) ||
    overWordAt(words) >= 0 ||
    WITHIN.test(words.join(" ")) ||
    deniesRest(words) ||
    words.some((word) => UNDER.has(word));
  if (!ownStatements) {
    return { rest: clause, says };
  }
  const kept = clause.phrases.flatMap((phrase, p) => {
    const left = phrase.filter((atom) => !drop.has(atom));
    return left.length > 0 ? [[p, left] as const] : [];
  });
  const asides = new Set(kept.flatMap(([p], at) => (clause.asides.has(p) ? [at] : [])));
  return { rest: { ...toClause(kept.map(([, phrase]) => phrase), asides), mentions: clause.mentions }, says };
}

function isLeadIn(atom: Atom): boolean {
  return atom.kind === "word" && LEAD_IN.has(atom.text);
}

/**
 * True when a pronoun comes before any name: in "it is over budget by 200, and so is the trade
 * fair", "it" is something the tool result never names.
 */
function pointsAtNothing(clauses: readonly Clause[]): boolean {
  const atoms = clauses.flatMap((clause) => clause.phrases.flat());
  for (const [at, atom] of atoms.entries()) {
    if (atom.kind === "mention") {
      return false;
    }
    const next = atoms[at + 1];
    if (atom.kind === "word" && REFERRING.has(atom.text) && !(next?.kind === "word" && DUMMY_IT.has(next.text))) {
      return true;
    }
  }
  return false;
}

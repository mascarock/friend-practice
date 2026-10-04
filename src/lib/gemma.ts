import { findInventedNumbers, type KnownFacts } from "./facts";

export const GEMMA_MODEL = "gemma3:1b";
export const OLLAMA_URL = "http://127.0.0.1:11434";

export const UNKNOWN_NUMBER_REPLY =
  "I don’t know. That figure is not in the approved budget or local spend log.";

export const INVENTED_NUMBER_REPLY =
  "I don’t know. Gemma mentioned a figure outside the local budget and spend log, so its response has been withheld.";

export function buildGemmaSystemPrompt(): string {
  return [
    "You read local budget figures for Paola, who works in marketing.",
    "Only mention numbers that appear in LOCAL DATA.",
    `If asked for a number that is not there, reply exactly: "${UNKNOWN_NUMBER_REPLY}"`,
    "Never invent figures, industry averages, forecasts, or Paola’s real budget.",
    "Never suggest changing the approved budget. It is read-only.",
    "Nothing you read leaves this computer.",
    "Respond in English. Be brief and specific.",
    "An item is over budget only when its overspend is greater than 0.00.",
    "If you say an item is over budget, quote that item's overspend from LOCAL DATA.",
    "Do not call an item over budget when its overspend is 0.00.",
    "If the source says SAMPLE DATA, say so in your first sentence.",
  ].join(" ");
}

export function buildGemmaUserPrompt(facts: KnownFacts, question: string): string {
  return [
    facts.sheet,
    "",
    "Rules for this answer:",
    "- This is SAMPLE DATA unless the source says otherwise. Say that first.",
    "- Over budget means that item's overspend is greater than 0.00.",
    "- Name an item as over budget only together with its overspend figure from the lines above.",
    "- If overspend is 0.00, do not say that item is over budget.",
    "",
    `Paola’s question:\n${question.trim()}`,
  ].join("\n");
}

export function groundModelText(text: string, facts: KnownFacts): { ok: true; text: string } | { ok: false; text: string } {
  const cleaned = text.trim();
  if (!cleaned) {
    return { ok: false, text: UNKNOWN_NUMBER_REPLY };
  }
  const invented = findInventedNumbers(cleaned, facts);
  if (invented.length > 0) {
    return { ok: false, text: INVENTED_NUMBER_REPLY };
  }
  return { ok: true, text: cleaned };
}

export type GemmaRequestBody = {
  question: string;
  facts: KnownFacts;
};

export type GemmaResponse =
  | { status: "ok"; model: string; text: string; grounded: true }
  | { status: "ungrounded"; model: string; text: string }
  | { status: "unavailable"; reason: "ollama_unreachable" | "model_missing" | "empty" | "timeout"; detail: string };

export function promptContainsOnlyKnownNumbers(systemPrompt: string, userPrompt: string, facts: KnownFacts): number[] {
  return findInventedNumbers(`${systemPrompt}\n${userPrompt}`, {
    ...facts,
    numbers: [
      ...facts.numbers,
      // The system prompt itself must not introduce money figures.
    ],
  });
}

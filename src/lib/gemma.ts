import { findInventedNumbers, type KnownFacts } from "./facts";

export const GEMMA_MODEL = "gemma3:1b";
export const OLLAMA_URL = "http://127.0.0.1:11434";

export const UNKNOWN_NUMBER_REPLY =
  "No lo sé. Ese dato no está en el presupuesto aprobado ni en el registro local de gasto.";

export const INVENTED_NUMBER_REPLY =
  "No lo sé. Gemma mencionó una cifra que no está en el archivo local ni en el registro de gasto, así que no la muestro.";

export function buildGemmaSystemPrompt(): string {
  return [
    "Eres una lectora de cifras locales para Paola, que trabaja en marketing.",
    "Solo puedes mencionar números que aparecen en DATOS LOCALES.",
    `Si te piden un número que no está ahí, responde exactamente: "${UNKNOWN_NUMBER_REPLY}"`,
    "Nunca inventes cifras, promedios del sector, previsiones, ni el presupuesto real de Paola.",
    "Nunca sugieras cambiar el presupuesto aprobado. Ese presupuesto es de solo lectura.",
    "Nada de lo que lees sale de este ordenador.",
    "Responde en español, breve y concreto: qué está desbordado, qué queda y qué mirar ahora.",
    "Si el origen indica DATOS DE EJEMPLO, dilo en la primera frase.",
  ].join(" ");
}

export function buildGemmaUserPrompt(facts: KnownFacts, question: string): string {
  return `${facts.sheet}\n\nPregunta de Paola:\n${question.trim()}`;
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

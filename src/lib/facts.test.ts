import { describe, expect, it } from "vitest";
import { computeLedger } from "./budget";
import { collectKnownFacts, findInventedNumbers } from "./facts";
import {
  buildGemmaSystemPrompt,
  buildGemmaUserPrompt,
  groundModelText,
  INVENTED_NUMBER_REPLY,
  UNKNOWN_NUMBER_REPLY,
} from "./gemma";
import { createSampleBudget, createSampleSpends } from "./sample";

function sampleFacts() {
  const budget = createSampleBudget();
  const ledger = computeLedger(budget, createSampleSpends(budget));
  return { ledger, facts: collectKnownFacts(ledger) };
}

describe("ninguna cifra inventada", () => {
  it("las cifras conocidas salen solo del CSV y del registro de gasto", () => {
    const { ledger, facts } = sampleFacts();
    expect(facts.numbers).toContain(5000);
    expect(facts.numbers).toContain(1800);
    expect(facts.numbers).toContain(3200);
    expect(facts.numbers).toContain(-200);
    expect(facts.numbers).toContain(16700);
    expect(facts.numbers).toContain(6900);
    expect(facts.numbers).toContain(9800);
    expect(facts.sheet).toContain("DATOS DE EJEMPLO");
    expect(facts.sheet).not.toMatch(/presupuesto real de Paola: \d/);
    expect(facts.isSample).toBe(true);

    const mentionedInSheet = findInventedNumbers(facts.sheet, facts);
    expect(mentionedInSheet).toEqual([]);
    expect(ledger.budget.fingerprint).toBe(ledger.budget.fingerprint);
  });

  it("acepta un texto que solo repite cifras locales", () => {
    const { facts } = sampleFacts();
    const text =
      "DATOS DE EJEMPLO. Feria Q4 está desbordada: aprobado 4500,00, gastado 4700,00, desvío 200,00. Quedan 9800,00 en total.";
    expect(findInventedNumbers(text, facts)).toEqual([]);
    expect(groundModelText(text, facts)).toEqual({ ok: true, text });
  });

  it("rechaza una cifra que no está en el archivo ni en el log", () => {
    const { facts } = sampleFacts();
    const text = "El sector gasta de media 99999 y Paola debería subir el aprobado a 20000.";
    expect(findInventedNumbers(text, facts)).toEqual([99999, 20000]);
    expect(groundModelText(text, facts)).toEqual({
      ok: false,
      text: INVENTED_NUMBER_REPLY,
    });
  });

  it("el prompt de Gemma no mete cifras que no existan en los hechos locales", () => {
    const { facts } = sampleFacts();
    const systemPrompt = buildGemmaSystemPrompt();
    const userPrompt = buildGemmaUserPrompt(facts, "¿Qué está desbordado y qué queda?");
    expect(systemPrompt).toContain(UNKNOWN_NUMBER_REPLY);
    expect(systemPrompt).toMatch(/solo lectura/i);
    expect(findInventedNumbers(`${systemPrompt}\n${userPrompt}`, facts)).toEqual([]);
    expect(userPrompt).toContain(facts.sheet);
    expect(userPrompt).not.toContain("99999");
  });
});

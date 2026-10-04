import { canonicalKeys, formatMoney, money } from "./money";
import type { Ledger } from "./budget";
import { SAMPLE_ORIGIN } from "./budget";

export type KnownFacts = {
  readonly numbers: readonly number[];
  readonly keys: readonly string[];
  readonly sheet: string;
  readonly isSample: boolean;
};

const DATE_TOKEN = /^\d{4}-\d{2}-\d{2}/;
const ISO_IN_TEXT = /\d{4}-\d{2}-\d{2}(?:[tT ][\d:.zZ+-]+)?/g;

export function collectKnownFacts(ledger: Ledger): KnownFacts {
  const numbers: number[] = [0];
  const push = (value: number) => {
    numbers.push(money(value));
  };

  push(ledger.lines.length);
  push(ledger.spends.length);
  push(ledger.totalAprobado);
  push(ledger.totalGastado);
  push(ledger.totalRestante);
  push(ledger.totalDesvio);

  for (const row of ledger.lines) {
    push(row.line.aprobado);
    push(row.gastado);
    push(row.restante);
    push(row.desvio);
    push(row.porcentajeUso);
  }

  for (const spend of ledger.spends) {
    push(spend.importe);
  }

  const unique = [...new Set(numbers.map((value) => money(value)))];
  const keys = [...new Set(unique.flatMap((value) => canonicalKeys(value)))];

  const origin = ledger.budget.isSample
    ? `${SAMPLE_ORIGIN} — not Paola’s real budget. File: ${ledger.budget.fileName}`
    : `Read-only local CSV: ${ledger.budget.fileName}`;

  const partidas = ledger.lines
    .map((row) => {
      return `- ${row.line.categoria} / ${row.line.partida} | approved ${row.line.aprobado.toFixed(2)} | spent ${row.gastado.toFixed(2)} | remaining ${row.restante.toFixed(2)} | overspend ${row.desvio.toFixed(2)} | used ${row.porcentajeUso.toFixed(2)}%`;
    })
    .join("\n");

  const gastos =
    ledger.spends.length === 0
      ? "- (no spending recorded)"
      : ledger.spends
          .map((spend) => {
            const line = ledger.budget.lines.find((item) => item.id === spend.lineId);
            const label = line ? `${line.categoria} / ${line.partida}` : spend.lineId;
            const sample = spend.isSample ? " [SAMPLE DATA]" : "";
            const nota = spend.nota ? ` | note: ${spend.nota}` : "";
            return `- ${spend.timestamp.slice(0, 10)} | ${label} | ${spend.importe.toFixed(2)}${sample}${nota}`;
          })
          .join("\n");

  const sheet = [
    "LOCAL DATA (the only figures you may mention):",
    `Source: ${origin}`,
    `Budget items: ${ledger.lines.length}`,
    `Total approved budget: ${ledger.totalAprobado.toFixed(2)}`,
    `Total spent: ${ledger.totalGastado.toFixed(2)}`,
    `Total remaining: ${ledger.totalRestante.toFixed(2)}`,
    `Total overspend: ${ledger.totalDesvio.toFixed(2)}`,
    "",
    "Budget items:",
    partidas,
    "",
    "Recorded spending:",
    gastos,
  ].join("\n");

  return Object.freeze({
    numbers: Object.freeze(unique),
    keys: Object.freeze(keys),
    sheet,
    isSample: ledger.budget.isSample,
  });
}

const NUMBER_TOKEN =
  /(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ])-?(?:\d{1,3}(?:\.\d{3})+,\d+|\d{1,3}(?:,\d{3})+\.\d+|\d+[.,]\d+|\d+)/g;

export function extractMentionedNumbers(text: string): number[] {
  const withoutIso = text.replace(ISO_IN_TEXT, " ");
  const matches = withoutIso.match(NUMBER_TOKEN) ?? [];
  const values: number[] = [];

  for (const match of matches) {
    if (DATE_TOKEN.test(match)) {
      continue;
    }
    const compact = match.replace(/\s/g, "");
    let normalized = compact;
    const lastComma = compact.lastIndexOf(",");
    const lastDot = compact.lastIndexOf(".");
    if (lastComma > lastDot) {
      normalized = compact.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = compact.replace(/,/g, "");
    }
    const value = Number(normalized);
    if (Number.isFinite(value)) {
      values.push(money(value));
    }
  }

  return values;
}

export function findInventedNumbers(text: string, facts: KnownFacts): number[] {
  const known = new Set(facts.numbers.map((value) => value.toFixed(2)));
  const invented: number[] = [];
  for (const value of extractMentionedNumbers(text)) {
    if (!known.has(value.toFixed(2))) {
      invented.push(value);
    }
  }
  return invented;
}

export function formatKnownForPrompt(facts: KnownFacts): string {
  return facts.sheet;
}

export { formatMoney };

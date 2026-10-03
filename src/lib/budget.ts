import { money, parseLocaleNumber } from "./money";

export type BudgetLine = {
  readonly id: string;
  readonly categoria: string;
  readonly partida: string;
  readonly aprobado: number;
  readonly origen: string;
};

export type ApprovedBudget = {
  readonly importedAt: string;
  readonly fileName: string;
  readonly isSample: boolean;
  readonly lines: readonly BudgetLine[];
  readonly fingerprint: string;
};

export type SpendEntry = {
  readonly id: string;
  readonly timestamp: string;
  readonly lineId: string;
  readonly importe: number;
  readonly nota: string;
  readonly isSample: boolean;
};

export type LineStatus = {
  readonly line: BudgetLine;
  readonly gastado: number;
  readonly restante: number;
  readonly desvio: number;
  readonly porcentajeUso: number;
};

export type Ledger = {
  readonly budget: ApprovedBudget;
  readonly spends: readonly SpendEntry[];
  readonly lines: readonly LineStatus[];
  readonly totalAprobado: number;
  readonly totalGastado: number;
  readonly totalRestante: number;
  readonly totalDesvio: number;
};

export const SAMPLE_ORIGIN = "DATOS DE EJEMPLO";

const HEADER_ALIASES: Record<string, "categoria" | "partida" | "aprobado" | "origen"> = {
  categoria: "categoria",
  categoría: "categoria",
  category: "categoria",
  partida: "partida",
  line: "partida",
  item: "partida",
  cuenta: "partida",
  presupuesto_aprobado: "aprobado",
  presupuestoaprobado: "aprobado",
  approved: "aprobado",
  approved_budget: "aprobado",
  budget: "aprobado",
  origen: "origen",
  source: "origen",
};

export class BudgetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetParseError";
  }
}

export class ImmutableBudgetError extends Error {
  constructor(message = "El presupuesto aprobado no se puede modificar.") {
    super(message);
    this.name = "ImmutableBudgetError";
  }
}

export function approvedFingerprint(lines: readonly Pick<BudgetLine, "id" | "aprobado">[]): string {
  return lines.map((line) => `${line.id}:${money(line.aprobado).toFixed(2)}`).join("|");
}

function lineId(categoria: string, partida: string, index: number): string {
  const slug = `${categoria}::${partida}`.toLowerCase().replace(/\s+/g, "-");
  return `${slug}#${index}`;
}

export function freezeApprovedBudget(input: {
  fileName: string;
  importedAt?: string;
  isSample?: boolean;
  lines: Array<Omit<BudgetLine, "id"> & { id?: string }>;
}): ApprovedBudget {
  const lines = Object.freeze(
    input.lines.map((line, index) =>
      Object.freeze({
        id: line.id ?? lineId(line.categoria, line.partida, index),
        categoria: line.categoria,
        partida: line.partida,
        aprobado: money(line.aprobado),
        origen: line.origen,
      }),
    ),
  );

  return Object.freeze({
    importedAt: input.importedAt ?? new Date().toISOString(),
    fileName: input.fileName,
    isSample: Boolean(input.isSample),
    lines,
    fingerprint: approvedFingerprint(lines),
  });
}

function detectDelimiter(headerLine: string): "," | ";" {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semis = (headerLine.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

function splitCsvLine(line: string, delimiter: "," | ";"): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function looksLikeSample(fileName: string, origenes: string[], raw: string): boolean {
  const haystack = `${fileName}\n${origenes.join("\n")}\n${raw}`.toLowerCase();
  return (
    haystack.includes("datos de ejemplo") ||
    haystack.includes("sample") ||
    fileName.toLowerCase().includes("ejemplo")
  );
}

export function parseApprovedBudgetCsv(raw: string, fileName: string): ApprovedBudget {
  const text = raw.replace(/^\uFEFF/, "");
  const physicalLines = text.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
  if (physicalLines.length < 2) {
    throw new BudgetParseError("El CSV no tiene cabecera y filas. Exporta el presupuesto aprobado desde Power BI.");
  }

  const delimiter = detectDelimiter(physicalLines[0]);
  const headers = splitCsvLine(physicalLines[0], delimiter).map(normalizeHeader);
  const index: Partial<Record<"categoria" | "partida" | "aprobado" | "origen", number>> = {};

  headers.forEach((header, i) => {
    const alias = HEADER_ALIASES[header];
    if (alias) {
      index[alias] = i;
    }
  });

  if (index.categoria === undefined || index.partida === undefined || index.aprobado === undefined) {
    throw new BudgetParseError(
      "Faltan columnas. Se espera: categoria, partida, presupuesto_aprobado (origen es opcional).",
    );
  }

  const parsedLines: Array<Omit<BudgetLine, "id">> = [];
  const origenes: string[] = [];

  physicalLines.slice(1).forEach((line, rowIndex) => {
    const cells = splitCsvLine(line, delimiter);
    const categoria = cells[index.categoria!]?.trim() ?? "";
    const partida = cells[index.partida!]?.trim() ?? "";
    const aprobadoRaw = cells[index.aprobado!]?.trim() ?? "";
    const origen = (index.origen !== undefined ? cells[index.origen]?.trim() : "") || "";

    if (!categoria || !partida) {
      throw new BudgetParseError(`La fila ${rowIndex + 2} no tiene categoría o partida.`);
    }

    const aprobado = parseLocaleNumber(aprobadoRaw);
    if (aprobado === null) {
      throw new BudgetParseError(`La fila ${rowIndex + 2} no tiene un presupuesto aprobado numérico.`);
    }
    if (aprobado < 0) {
      throw new BudgetParseError(`La fila ${rowIndex + 2} tiene un presupuesto aprobado negativo.`);
    }

    origenes.push(origen);
    parsedLines.push({ categoria, partida, aprobado, origen });
  });

  if (parsedLines.length === 0) {
    throw new BudgetParseError("El CSV no contiene partidas.");
  }

  return freezeApprovedBudget({
    fileName,
    isSample: looksLikeSample(fileName, origenes, text),
    lines: parsedLines,
  });
}

export function assertApprovedImmutable(before: ApprovedBudget, after: ApprovedBudget): void {
  if (before.fingerprint !== after.fingerprint) {
    throw new ImmutableBudgetError();
  }
  if (before.lines.length !== after.lines.length) {
    throw new ImmutableBudgetError();
  }
  before.lines.forEach((line, i) => {
    const next = after.lines[i];
    if (line.id !== next.id || line.aprobado !== next.aprobado) {
      throw new ImmutableBudgetError();
    }
  });
}

export function computeLedger(budget: ApprovedBudget, spends: readonly SpendEntry[]): Ledger {
  const allowedIds = new Set(budget.lines.map((line) => line.id));
  for (const spend of spends) {
    if (!allowedIds.has(spend.lineId)) {
      throw new BudgetParseError("Hay un gasto sobre una partida que no existe en el presupuesto aprobado.");
    }
  }

  const spentByLine = new Map<string, number>();
  for (const spend of spends) {
    spentByLine.set(spend.lineId, money((spentByLine.get(spend.lineId) ?? 0) + spend.importe));
  }

  const lines = Object.freeze(
    budget.lines.map((line) => {
      const gastado = spentByLine.get(line.id) ?? 0;
      const restante = money(line.aprobado - gastado);
      const desvio = money(Math.max(0, gastado - line.aprobado));
      const porcentajeUso = line.aprobado === 0 ? (gastado === 0 ? 0 : 100) : money((gastado / line.aprobado) * 100);
      return Object.freeze({ line, gastado, restante, desvio, porcentajeUso });
    }),
  );

  const totalAprobado = money(lines.reduce((sum, item) => sum + item.line.aprobado, 0));
  const totalGastado = money(lines.reduce((sum, item) => sum + item.gastado, 0));
  const totalRestante = money(totalAprobado - totalGastado);
  const totalDesvio = money(lines.reduce((sum, item) => sum + item.desvio, 0));

  const ledger = Object.freeze({
    budget,
    spends: Object.freeze([...spends]),
    lines,
    totalAprobado,
    totalGastado,
    totalRestante,
    totalDesvio,
  });

  assertApprovedImmutable(budget, ledger.budget);
  return ledger;
}

export function createSpend(input: {
  lineId: string;
  importe: number;
  nota: string;
  isSample?: boolean;
  id?: string;
  timestamp?: string;
}): SpendEntry {
  const importe = money(input.importe);
  if (!(importe > 0)) {
    throw new BudgetParseError("El importe del gasto tiene que ser mayor que 0.");
  }
  return Object.freeze({
    id: input.id ?? `gasto-${crypto.randomUUID()}`,
    timestamp: input.timestamp ?? new Date().toISOString(),
    lineId: input.lineId,
    importe,
    nota: input.nota.trim(),
    isSample: Boolean(input.isSample),
  });
}

export function addSpend(budget: ApprovedBudget, spends: readonly SpendEntry[], spend: SpendEntry): SpendEntry[] {
  const ledger = computeLedger(budget, [...spends, spend]);
  assertApprovedImmutable(budget, ledger.budget);
  return [...ledger.spends];
}

export function removeSpend(budget: ApprovedBudget, spends: readonly SpendEntry[], spendId: string): SpendEntry[] {
  const next = spends.filter((spend) => spend.id !== spendId);
  const ledger = computeLedger(budget, next);
  assertApprovedImmutable(budget, ledger.budget);
  return [...ledger.spends];
}

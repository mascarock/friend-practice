import { createSpend, freezeApprovedBudget, type ApprovedBudget, type SpendEntry } from "./budget";

export const SAMPLE_FILE_NAME = "sample-presupuesto.csv";

export const SAMPLE_CSV = `# SAMPLE DATA — not Paola’s real budget
# Local CSV sample. This app has no Power BI connection.
source,category,item,approved_budget
SAMPLE DATA,Digital advertising,Google Ads,5000
SAMPLE DATA,Digital advertising,Meta Ads,3200
SAMPLE DATA,Events,Q4 trade fair,4500
SAMPLE DATA,Content,Video production,2800
SAMPLE DATA,Tools,Marketing software,1200
`;

export function createSampleBudget(): ApprovedBudget {
  return freezeApprovedBudget({
    fileName: SAMPLE_FILE_NAME,
    isSample: true,
    importedAt: "2026-10-03T00:00:00.000Z",
    lines: [
      {
        categoria: "Digital advertising",
        partida: "Google Ads",
        aprobado: 5000,
        origen: "SAMPLE DATA",
      },
      {
        categoria: "Digital advertising",
        partida: "Meta Ads",
        aprobado: 3200,
        origen: "SAMPLE DATA",
      },
      {
        categoria: "Events",
        partida: "Q4 trade fair",
        aprobado: 4500,
        origen: "SAMPLE DATA",
      },
      {
        categoria: "Content",
        partida: "Video production",
        aprobado: 2800,
        origen: "SAMPLE DATA",
      },
      {
        categoria: "Tools",
        partida: "Marketing software",
        aprobado: 1200,
        origen: "SAMPLE DATA",
      },
    ],
  });
}

export function createSampleSpends(budget: ApprovedBudget): SpendEntry[] {
  const byPartida = (partida: string) => {
    const line = budget.lines.find((item) => item.partida === partida);
    if (!line) {
      throw new Error(`Sample item not found: ${partida}`);
    }
    return line.id;
  };

  return [
    createSpend({
      id: "sample-spend-1",
      timestamp: "2026-09-12T09:00:00.000Z",
      lineId: byPartida("Google Ads"),
      importe: 1800,
      nota: "SAMPLE DATA — test campaign",
      isSample: true,
    }),
    createSpend({
      id: "sample-spend-2",
      timestamp: "2026-09-20T11:30:00.000Z",
      lineId: byPartida("Q4 trade fair"),
      importe: 4700,
      nota: "SAMPLE DATA — stand and travel",
      isSample: true,
    }),
    createSpend({
      id: "sample-spend-3",
      timestamp: "2026-09-28T16:15:00.000Z",
      lineId: byPartida("Video production"),
      importe: 400,
      nota: "SAMPLE DATA — first cut",
      isSample: true,
    }),
  ];
}

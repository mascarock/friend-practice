import { createSpend, freezeApprovedBudget, type ApprovedBudget, type SpendEntry } from "./budget";

export const SAMPLE_FILE_NAME = "sample-presupuesto.csv";

export const SAMPLE_CSV = `# DATOS DE EJEMPLO — no es el presupuesto real de Paola
# Formato de exportación local (Power BI → CSV). Esta app no se conecta a Power BI.
origen,categoria,partida,presupuesto_aprobado
DATOS DE EJEMPLO,Publicidad digital,Google Ads,5000
DATOS DE EJEMPLO,Publicidad digital,Meta Ads,3200
DATOS DE EJEMPLO,Eventos,Feria Q4,4500
DATOS DE EJEMPLO,Contenido,Producción de vídeo,2800
DATOS DE EJEMPLO,Herramientas,Software de marketing,1200
`;

export function createSampleBudget(): ApprovedBudget {
  return freezeApprovedBudget({
    fileName: SAMPLE_FILE_NAME,
    isSample: true,
    importedAt: "2026-10-03T00:00:00.000Z",
    lines: [
      {
        categoria: "Publicidad digital",
        partida: "Google Ads",
        aprobado: 5000,
        origen: "DATOS DE EJEMPLO",
      },
      {
        categoria: "Publicidad digital",
        partida: "Meta Ads",
        aprobado: 3200,
        origen: "DATOS DE EJEMPLO",
      },
      {
        categoria: "Eventos",
        partida: "Feria Q4",
        aprobado: 4500,
        origen: "DATOS DE EJEMPLO",
      },
      {
        categoria: "Contenido",
        partida: "Producción de vídeo",
        aprobado: 2800,
        origen: "DATOS DE EJEMPLO",
      },
      {
        categoria: "Herramientas",
        partida: "Software de marketing",
        aprobado: 1200,
        origen: "DATOS DE EJEMPLO",
      },
    ],
  });
}

export function createSampleSpends(budget: ApprovedBudget): SpendEntry[] {
  const byPartida = (partida: string) => {
    const line = budget.lines.find((item) => item.partida === partida);
    if (!line) {
      throw new Error(`Partida de ejemplo no encontrada: ${partida}`);
    }
    return line.id;
  };

  return [
    createSpend({
      id: "sample-spend-1",
      timestamp: "2026-09-12T09:00:00.000Z",
      lineId: byPartida("Google Ads"),
      importe: 1800,
      nota: "DATOS DE EJEMPLO — campaña de prueba",
      isSample: true,
    }),
    createSpend({
      id: "sample-spend-2",
      timestamp: "2026-09-20T11:30:00.000Z",
      lineId: byPartida("Feria Q4"),
      importe: 4700,
      nota: "DATOS DE EJEMPLO — stand y desplazamiento",
      isSample: true,
    }),
    createSpend({
      id: "sample-spend-3",
      timestamp: "2026-09-28T16:15:00.000Z",
      lineId: byPartida("Producción de vídeo"),
      importe: 400,
      nota: "DATOS DE EJEMPLO — primer corte",
      isSample: true,
    }),
  ];
}

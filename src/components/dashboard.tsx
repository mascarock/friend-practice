"use client";

import {
  Lock,
  Upload,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addSpend,
  computeLedger,
  createSpend,
  parseApprovedBudgetCsv,
  removeSpend,
  type ApprovedBudget,
  type SpendEntry,
} from "@/lib/budget";
import { collectKnownFacts } from "@/lib/facts";
import type { GemmaResponse } from "@/lib/gemma";
import { GEMMA_MODEL } from "@/lib/gemma";
import { formatMoney } from "@/lib/money";
import { createSampleBudget, createSampleSpends, SAMPLE_CSV, SAMPLE_FILE_NAME } from "@/lib/sample";
import { loadLocalBudget, loadLocalSpends, saveLocalState } from "@/lib/storage";

const PRESET_QUESTIONS = [
  "¿Qué partidas están desbordadas?",
  "¿Cuánto queda en cada partida?",
  "¿Qué debería mirar ahora?",
];

type GemmaStatus = "unknown" | "ready" | "missing";

export function Dashboard() {
  const [budget, setBudget] = useState<ApprovedBudget | null>(null);
  const [spends, setSpends] = useState<SpendEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [lineId, setLineId] = useState("");
  const [importe, setImporte] = useState("");
  const [nota, setNota] = useState("");
  const [question, setQuestion] = useState(PRESET_QUESTIONS[0]);
  const [coaching, setCoaching] = useState<GemmaResponse | null>(null);
  const [coachingBusy, setCoachingBusy] = useState(false);
  const [gemmaStatus, setGemmaStatus] = useState<GemmaStatus>("unknown");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const storedBudget = loadLocalBudget();
    const storedSpends = loadLocalSpends();
    setBudget(storedBudget);
    setSpends(storedSpends);
    if (storedBudget?.lines[0]) {
      setLineId(storedBudget.lines[0].id);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    saveLocalState(budget, spends);
  }, [budget, spends, hydrated]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/gemma", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { available?: boolean }) => {
        if (!cancelled) {
          setGemmaStatus(payload.available ? "ready" : "missing");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGemmaStatus("missing");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ledger = useMemo(() => (budget ? computeLedger(budget, spends) : null), [budget, spends]);
  const facts = useMemo(() => (ledger ? collectKnownFacts(ledger) : null), [ledger]);

  const applyBudget = useCallback((next: ApprovedBudget, nextSpends: SpendEntry[]) => {
    setParseError(null);
    setBudget(next);
    setSpends(nextSpends);
    setLineId(next.lines[0]?.id ?? "");
    setCoaching(null);
  }, []);

  const onCsvText = useCallback(
    (text: string, fileName: string) => {
      try {
        const next = parseApprovedBudgetCsv(text, fileName);
        applyBudget(next, []);
      } catch (error) {
        setParseError(error instanceof Error ? error.message : "No se pudo leer el CSV.");
      }
    },
    [applyBudget],
  );

  const onFile = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }
      void file.text().then((text) => onCsvText(text, file.name));
    },
    [onCsvText],
  );

  const loadSample = useCallback(() => {
    const sample = createSampleBudget();
    applyBudget(sample, createSampleSpends(sample));
  }, [applyBudget]);

  const submitSpend = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (!budget) {
        return;
      }
      setSpendError(null);
      const amount = Number(importe.replace(",", "."));
      try {
        const spend = createSpend({
          lineId,
          importe: amount,
          nota,
          isSample: budget.isSample,
        });
        setSpends((current) => addSpend(budget, current, spend));
        setImporte("");
        setNota("");
        setCoaching(null);
      } catch (error) {
        setSpendError(error instanceof Error ? error.message : "No se pudo anotar el gasto.");
      }
    },
    [budget, importe, lineId, nota],
  );

  const askGemma = useCallback(async () => {
    if (!facts || !question.trim()) {
      return;
    }
    setCoachingBusy(true);
    setCoaching(null);
    try {
      const response = await fetch("/api/gemma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, facts }),
      });
      const payload = (await response.json()) as GemmaResponse;
      setCoaching(payload);
      if (payload.status === "unavailable") {
        setGemmaStatus("missing");
      }
      if (payload.status === "ok") {
        setGemmaStatus("ready");
      }
    } catch {
      setGemmaStatus("missing");
      setCoaching({
        status: "unavailable",
        reason: "ollama_unreachable",
        detail: "Gemma no está en este ordenador. Instala Ollama y ejecuta: ollama pull gemma3:1b",
      });
    } finally {
      setCoachingBusy(false);
    }
  }, [facts, question]);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 text-sm text-[#6b6258]">Cargando el registro local…</div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <header className="mb-6 flex flex-col gap-4 sm:mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="local">Solo en este ordenador</Badge>
          <Badge tone="locked">Presupuesto aprobado de solo lectura</Badge>
          {budget?.isSample ? <Badge tone="sample">DATOS DE EJEMPLO</Badge> : null}
        </div>
        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#8a6a2f]">Para Paola · marketing</p>
          <h1 className="mt-2 font-serif text-4xl leading-tight text-[#1f1a14] sm:text-5xl">
            Control local del presupuesto aprobado
          </h1>
          <p className="mt-3 max-w-2xl text-base text-[#4a433b]">
            El aprobado vive en Power BI. Esta app no se conecta a Power BI: sueltas el CSV que exportas, anotas el
            gasto aquí y ves el restante al momento. Nada se envía fuera de este ordenador.
          </p>
        </div>
      </header>

      <section className="mb-6 grid gap-3 md:grid-cols-3">
        <RuleCard n="01" title="No inventar cifras" body="Solo cuentan el CSV aprobado y el registro local de gasto. Si un número no está ahí, la app dice que no lo sabe." />
        <RuleCard n="02" title="No tocar el aprobado" body="El presupuesto importado es inmutable. Puedes anotar gasto o cargar un CSV nuevo; no puedes editar una partida aprobada." />
        <RuleCard n="03" title="Nada sale de aquí" body="Sin nube, sin sincronizar, sin API cerrada. Gemma, si está instalada, habla solo con Ollama en localhost." />
      </section>

      {budget?.isSample ? (
        <div
          data-testid="sample-banner"
          className="mb-6 rounded-xl border-2 border-[#c45c16] bg-[#fff4e8] px-4 py-3 text-[#7a3e0c]"
        >
          <p className="text-sm font-semibold uppercase tracking-wide">DATOS DE EJEMPLO</p>
          <p className="text-sm">
            Este no es el presupuesto real de Paola ni un gasto real. Es una exportación de muestra para probar el
            bucle local. Sustitúyela por tu CSV de Power BI cuando quieras.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>CSV del presupuesto aprobado</CardTitle>
              <CardDescription>
                Arrastra el export de Power BI. Columnas: categoria, partida, presupuesto_aprobado. El origen
                opcional ayuda a marcar DATOS DE EJEMPLO.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  onFile(event.dataTransfer.files[0]);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors ${
                  dragOver ? "border-[#1f1a14] bg-[#f6efe3]" : "border-[#d7ccb8] bg-[#fbf7f0]"
                }`}
              >
                <Upload className="mb-3 h-6 w-6 text-[#8a6a2f]" />
                <span className="font-medium">Suelta aquí el CSV exportado de Power BI</span>
                <span className="mt-1 text-sm text-[#6b6258]">o haz clic para elegir un archivo local</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(event) => onFile(event.target.files?.[0])}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={loadSample}>
                  Cargar CSV de ejemplo
                </Button>
                <a href={`/${SAMPLE_FILE_NAME}`} download={SAMPLE_FILE_NAME}>
                  <Button type="button" variant="outline">
                    Descargar CSV de ejemplo
                  </Button>
                </a>
                {budget ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      applyBudget(budget, []);
                    }}
                  >
                    Vaciar solo el gasto
                  </Button>
                ) : null}
                {budget ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setBudget(null);
                      setSpends([]);
                      setCoaching(null);
                    }}
                  >
                    Borrar datos locales
                  </Button>
                ) : null}
              </div>
              {parseError ? <p className="text-sm text-[#9b2c2c]">{parseError}</p> : null}
              {budget ? (
                <p className="text-sm text-[#6b6258]">
                  Archivo en local: <span className="font-medium text-[#1f1a14]">{budget.fileName}</span>
                  {budget.isSample ? " · DATOS DE EJEMPLO" : " · exportación de solo lectura"}
                </p>
              ) : (
                <p className="text-sm text-[#6b6258]">Todavía no hay un presupuesto aprobado en este ordenador.</p>
              )}
            </CardContent>
          </Card>

          {ledger ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Aprobado" value={formatMoney(ledger.totalAprobado)} hint="Cerrado. No se edita." locked />
                <Kpi label="Gastado" value={formatMoney(ledger.totalGastado)} hint="Suma del registro local" />
                <Kpi
                  label="Restante"
                  value={formatMoney(ledger.totalRestante)}
                  hint="Aprobado menos gastado"
                  tone={ledger.totalRestante < 0 ? "over" : "ok"}
                />
                <Kpi
                  label="Desvío"
                  value={formatMoney(ledger.totalDesvio)}
                  hint="Solo lo que ya pasó del aprobado"
                  tone={ledger.totalDesvio > 0 ? "over" : "neutral"}
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Partidas</CardTitle>
                  <CardDescription>El restante se recalcula en el momento. El aprobado no cambia.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#e2d8c8] text-[#6b6258]">
                        <th className="py-2 pr-3 font-medium">Partida</th>
                        <th className="py-2 pr-3 font-medium">Aprobado</th>
                        <th className="py-2 pr-3 font-medium">Gastado</th>
                        <th className="py-2 pr-3 font-medium">Restante</th>
                        <th className="py-2 font-medium">Uso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.lines.map((row) => {
                        const over = row.restante < 0;
                        const width = Math.min(100, Math.max(0, row.porcentajeUso));
                        return (
                          <tr key={row.line.id} className="border-b border-[#f0e9dc] last:border-0">
                            <td className="py-3 pr-3">
                              <div className="font-medium">{row.line.partida}</div>
                              <div className="text-xs text-[#6b6258]">{row.line.categoria}</div>
                              {row.line.origen === "DATOS DE EJEMPLO" ? (
                                <div className="mt-1">
                                  <Badge tone="sample">DATOS DE EJEMPLO</Badge>
                                </div>
                              ) : null}
                            </td>
                            <td className="py-3 pr-3 tabular-nums">
                              <span className="inline-flex items-center gap-1">
                                <Lock className="h-3 w-3 text-[#8a6a2f]" />
                                {formatMoney(row.line.aprobado)}
                              </span>
                            </td>
                            <td className="py-3 pr-3 tabular-nums">{formatMoney(row.gastado)}</td>
                            <td className={`py-3 pr-3 tabular-nums ${over ? "font-semibold text-[#9b2c2c]" : "text-[#1f5c45]"}`}>
                              {formatMoney(row.restante)}
                            </td>
                            <td className="py-3">
                              <div className="mb-1 text-xs text-[#6b6258]">{row.porcentajeUso.toFixed(2)}%</div>
                              <div className="h-2 overflow-hidden rounded-full bg-[#efe7d8]">
                                <div
                                  className={`h-full ${over ? "bg-[#9b2c2c]" : "bg-[#1f5c45]"}`}
                                  style={{ width: `${width}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-10 text-sm text-[#6b6258]">
                Carga un CSV aprobado o el archivo de ejemplo para ver el restante.
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Anotar gasto</CardTitle>
              <CardDescription>Solo partidas que ya existen en el CSV. El aprobado no se toca.</CardDescription>
            </CardHeader>
            <CardContent>
              {budget && ledger ? (
                <form className="space-y-3" onSubmit={submitSpend}>
                  <div className="space-y-1.5">
                    <Label htmlFor="partida">Partida aprobada</Label>
                    <select
                      id="partida"
                      value={lineId}
                      onChange={(event) => setLineId(event.target.value)}
                      className="flex h-10 w-full rounded-md border border-[#d7ccb8] bg-white px-3 text-sm"
                    >
                      {budget.lines.map((line) => (
                        <option key={line.id} value={line.id}>
                          {line.categoria} — {line.partida}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="importe">Importe</Label>
                    <Input
                      id="importe"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={importe}
                      onChange={(event) => setImporte(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nota">Nota (opcional)</Label>
                    <Input id="nota" value={nota} onChange={(event) => setNota(event.target.value)} />
                  </div>
                  {spendError ? <p className="text-sm text-[#9b2c2c]">{spendError}</p> : null}
                  <Button type="submit" className="w-full">
                    <Wallet className="h-4 w-4" />
                    Registrar en este ordenador
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-[#6b6258]">Primero hace falta el CSV aprobado.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Registro local de gasto</CardTitle>
              <CardDescription>
                {spends.length === 0 ? "Todavía no hay movimientos." : `${spends.length} apunte(s) guardados en este navegador.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {spends.length === 0 ? (
                <p className="text-sm text-[#6b6258]">Cuando anotes un gasto, el restante de arriba cambia al momento.</p>
              ) : (
                <ul className="space-y-2">
                  {spends.map((spend) => {
                    const line = budget?.lines.find((item) => item.id === spend.lineId);
                    return (
                      <li key={spend.id} className="flex items-start justify-between gap-3 rounded-lg bg-[#fbf7f0] px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">
                            {line ? `${line.partida}` : spend.lineId} · {formatMoney(spend.importe)}
                          </p>
                          <p className="text-xs text-[#6b6258]">
                            {spend.timestamp.slice(0, 10)}
                            {spend.nota ? ` · ${spend.nota}` : ""}
                          </p>
                          {spend.isSample ? (
                            <div className="mt-1">
                              <Badge tone="sample">DATOS DE EJEMPLO</Badge>
                            </div>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => budget && setSpends(removeSpend(budget, spends, spend.id))}
                          aria-label="Borrar gasto"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Lectura con Gemma</CardTitle>
                {gemmaStatus === "ready" ? <Badge tone="ok">{GEMMA_MODEL} en local</Badge> : <Badge tone="neutral">{GEMMA_MODEL} no detectada</Badge>}
              </div>
              <CardDescription>
                Gemma lee solo las cifras de este CSV y de este registro. Si una cifra no está, debe decir que no lo
                sabe. Sin Ollama, el presupuesto y el gasto siguen funcionando.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {PRESET_QUESTIONS.map((item) => (
                  <Button key={item} type="button" size="sm" variant={question === item ? "default" : "secondary"} onClick={() => setQuestion(item)}>
                    {item}
                  </Button>
                ))}
              </div>
              <Textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
              <Button type="button" className="w-full" onClick={() => void askGemma()} disabled={!facts || coachingBusy}>
                <Sparkles className="h-4 w-4" />
                {coachingBusy ? "Consultando Ollama en localhost…" : "Leer las cifras locales"}
              </Button>
              <CoachingResult coaching={coaching} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RuleCard({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-[#e2d8c8] bg-[#fffdf8] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8a6a2f]">{n}</p>
      <h2 className="mt-1 font-serif text-lg">{title}</h2>
      <p className="mt-1 text-sm text-[#4a433b]">{body}</p>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  locked,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  locked?: boolean;
  tone?: "neutral" | "ok" | "over";
}) {
  return (
    <div className="rounded-xl border border-[#e2d8c8] bg-[#fffdf8] p-4">
      <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[#6b6258]">
        {locked ? <Lock className="h-3 w-3 text-[#8a6a2f]" /> : null}
        {label}
      </p>
      <p
        className={`mt-2 font-serif text-3xl tabular-nums ${
          tone === "over" ? "text-[#9b2c2c]" : tone === "ok" ? "text-[#1f5c45]" : "text-[#1f1a14]"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-[#6b6258]">{hint}</p>
    </div>
  );
}

function CoachingResult({ coaching }: { coaching: GemmaResponse | null }) {
  if (!coaching) {
    return (
      <p className="text-sm text-[#6b6258]">
        No hay transcripción inventada. Si Gemma no está instalada, verás un aviso real, no un análisis falso.
      </p>
    );
  }

  if (coaching.status === "unavailable") {
    return (
      <div className="rounded-lg border border-[#e2d8c8] bg-[#fbf7f0] p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4 text-[#8a6a2f]" />
          Gemma no ha contestado
        </p>
        <p className="mt-1 text-[#4a433b]">{coaching.detail}</p>
        <p className="mt-2 font-mono text-xs text-[#6b6258]">ollama pull gemma3:1b</p>
      </div>
    );
  }

  if (coaching.status === "ungrounded") {
    return (
      <div className="rounded-lg border border-[#e3a2a2] bg-[#fdf2f2] p-3 text-sm text-[#9b2c2c]">
        {coaching.text}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#9cc9b4] bg-[#f3faf6] p-3 text-sm text-[#1f5c45]">
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
        <CheckCircle2 className="h-4 w-4" />
        Lectura anclada a cifras locales · {coaching.model}
      </p>
      <p className="whitespace-pre-wrap text-[#1f1a14]">{coaching.text}</p>
    </div>
  );
}

"use client";

import {
  Lock,
  Upload,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Crew } from "@/components/crew";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { createSampleBudget, createSampleSpends, SAMPLE_FILE_NAME } from "@/lib/sample";
import { loadLocalBudget, loadLocalSpends, saveLocalState } from "@/lib/storage";

const PRESET_QUESTIONS = [
  "Which items are over budget?",
  "How much remains for each item?",
  "What needs attention?",
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
    setSpendError(null);
    setImporte("");
    setNota("");
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
        setParseError(error instanceof Error ? error.message : "Could not read the CSV.");
      }
    },
    [applyBudget],
  );

  const onFile = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }
      void file.text().then((text) => onCsvText(text, file.name)).catch(() => setParseError("Could not read this local file. Try choosing it again."));
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
        setSpendError(error instanceof Error ? error.message : "Could not record this spend.");
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
        detail: "Gemma is unavailable on this computer. Start Ollama with gemma3:1b installed, then try again.",
      });
    } finally {
      setCoachingBusy(false);
    }
  }, [facts, question]);

  if (!hydrated) {
    return <main className="shell py-24 text-sm text-neutral-400">Loading your local budget…</main>;
  }

  return (
    <main className="shell">
      <header className="masthead">
        <a href="#" className="wordmark" aria-label="Local Budget home"><span className="brand-mark" aria-hidden="true" />LOCAL / BUDGET</a>
        <span className="flex items-center gap-2 text-xs text-neutral-400"><Lock size={13} /> On this computer only</span>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">PAOLA / MARKETING</p>
        <h1 id="page-title">Every figure.<br /><span className="text-neutral-500">Accounted for.</span></h1>
        <div className="hero-bottom">
          <p className="max-w-lg text-base leading-relaxed text-neutral-400">Load your approved budget. Log what you spend.<br className="hidden sm:block" /> See what remains, immediately. Everything stays here.</p>
          <a href="#import" className={buttonVariants({ variant: "outline" })}>Load a local CSV <ArrowUpRight size={16} /></a>
        </div>
      </section>

      {budget?.isSample ? (
        <aside data-testid="sample-banner" className="sample-banner">
          <Badge tone="sample">SAMPLE DATA</Badge>
          <p>This is not Paola’s real budget or real spending. Load your approved CSV to replace this sample.</p>
        </aside>
      ) : null}

      <section className="metrics" aria-label="Budget totals" aria-live="polite" aria-atomic="true">
        <Kpi label="Approved" value={ledger ? formatMoney(ledger.totalAprobado) : "—"} hint="Read-only. Always unchanged." locked />
        <Kpi label="Spent" value={ledger ? formatMoney(ledger.totalGastado) : "—"} hint="From your local spend log" />
        <Kpi label="Remaining" value={ledger ? formatMoney(ledger.totalRestante) : "—"} hint={ledger && ledger.totalRestante < 0 ? "Total spending exceeds approval" : "Approved minus spent"} />
        <Kpi label="Over budget" value={ledger ? formatMoney(ledger.totalDesvio) : "—"} hint="Overspend across individual items" />
      </section>

      <div className="workspace">
        <div className="min-w-0">
          <section className="section" aria-labelledby="items-title">
            <SectionHeading number="01" title="Budget items" id="items-title" description="Remaining updates with every entry. Approved amounts stay fixed." />
            {ledger ? (
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Approved budget items">
                <table>
                  <thead><tr><th>Item</th><th>Approved</th><th>Spent</th><th>Remaining</th><th>Used</th></tr></thead>
                  <tbody>
                    {ledger.lines.map((row) => (
                      <tr key={row.line.id}>
                        <td><p className="font-medium text-neutral-100">{row.line.partida}</p><p className="mt-1 text-xs text-neutral-400">{row.line.categoria}</p>{budget?.isSample ? <span className="mt-2 block text-[10px] tracking-widest text-neutral-400">SAMPLE DATA</span> : null}</td>
                        <td>{formatMoney(row.line.aprobado)}</td>
                        <td>{formatMoney(row.gastado)}</td>
                        <td className={row.restante < 0 ? "font-semibold text-white" : ""}>{formatMoney(row.restante)}{row.restante < 0 ? <span className="mt-1 block text-[10px] uppercase tracking-wide">Over budget</span> : null}</td>
                        <td><span className="text-xs">{row.porcentajeUso.toFixed(2)}%</span><div className="usage-track"><div style={{ width: `${Math.min(100, Math.max(0, row.porcentajeUso))}%` }} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state"><p className="text-2xl tracking-tight text-neutral-200">Start with the approved numbers.</p><p className="mt-3 max-w-sm text-sm leading-relaxed text-neutral-400">Load a local CSV below, or explore the clearly labeled sample. No budget figures appear until you choose a source.</p><a href="#import" className="mt-6 inline-flex items-center gap-2 text-sm underline underline-offset-4">Choose a source <ArrowUpRight size={14} /></a></div>
            )}
          </section>

          <section id="import" className="section scroll-mt-8" aria-labelledby="import-title">
            <SectionHeading number="02" title="Your approved CSV" id="import-title" description="Read locally. Stored in this browser. Loading a CSV replaces the current budget and clears its spend log." />
            <label
              onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => { event.preventDefault(); setDragOver(false); onFile(event.dataTransfer.files[0]); }}
              className={`upload-zone ${dragOver ? "is-dragging" : ""}`}
            >
              <Upload size={22} strokeWidth={1.3} />
              <span className="mt-4 text-base">Drop your approved CSV here</span>
              <span className="mt-2 text-xs text-neutral-400">or choose a file from this computer</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="Choose approved budget CSV" onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ""; }} />
            </label>
            <p className="mt-4 text-xs leading-relaxed text-neutral-400">Columns: <code>category, item, approved_budget</code>. Optional: <code>source</code>. Existing Spanish column headers are also supported.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={loadSample}>Load sample data</Button>
              <a className={buttonVariants({ variant: "outline" })} href={`/${SAMPLE_FILE_NAME}`} download={SAMPLE_FILE_NAME}>Download sample CSV <ArrowUpRight size={14} /></a>
            </div>
            {parseError ? <p role="alert" className="error-message">{parseError}</p> : null}
            <p className="mt-5 break-all text-xs text-neutral-400">{budget ? <>Local file: <span className="text-neutral-200">{budget.fileName}</span>{budget.isSample ? " · SAMPLE DATA" : " · Read-only"}</> : "No approved budget loaded."}</p>
            {budget ? <div className="mt-5 flex flex-wrap gap-4"><Button type="button" size="sm" variant="ghost" onClick={() => applyBudget(budget, [])}>Clear spend log</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setBudget(null); setSpends([]); setCoaching(null); setParseError(null); setSpendError(null); }}>Delete local data</Button></div> : null}
          </section>
        </div>

        <div className="min-w-0">
          <section className="section" aria-labelledby="spend-title">
            <SectionHeading number="03" title="Log spend" id="spend-title" description="Record spending against an approved item." />
            {budget && ledger ? (
              <form className="space-y-5" onSubmit={submitSpend}>
                <div className="space-y-2"><Label htmlFor="partida">Approved item</Label><select id="partida" value={lineId} onChange={(event) => setLineId(event.target.value)} className="field">{budget.lines.map((line) => <option key={line.id} value={line.id}>{line.categoria} — {line.partida}</option>)}</select></div>
                <div className="space-y-2"><Label htmlFor="importe">Amount</Label><Input id="importe" inputMode="decimal" placeholder="0.00" value={importe} onChange={(event) => setImporte(event.target.value)} required /></div>
                <div className="space-y-2"><Label htmlFor="nota">Note <span className="text-neutral-500">(optional)</span></Label><Input id="nota" value={nota} onChange={(event) => setNota(event.target.value)} placeholder="What was this for?" /></div>
                {spendError ? <p role="alert" className="error-message">{spendError}</p> : null}
                <Button type="submit" className="w-full"><Wallet size={16} /> Save spend locally <ArrowUpRight size={16} className="ml-auto" /></Button>
                {budget.isSample ? <p className="text-xs text-neutral-400">Entries in this budget are labeled sample data.</p> : null}
              </form>
            ) : <p className="py-6 text-sm text-neutral-400">Load an approved CSV to record spending.</p>}
          </section>

          <section className="section" aria-labelledby="log-title">
            <SectionHeading number="04" title="Spend log" id="log-title" description={spends.length === 0 ? "No spending recorded yet." : `${spends.length} ${spends.length === 1 ? "entry" : "entries"} saved in this browser.`} />
            {spends.length === 0 ? <p className="text-sm leading-relaxed text-neutral-400">Every entry updates the remaining amount immediately.</p> : (
              <ul>{spends.map((spend) => {
                const line = budget?.lines.find((item) => item.id === spend.lineId);
                return <li key={spend.id} className="spend-entry"><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2 text-sm"><span>{line?.partida ?? spend.lineId}</span><span className="tabular-nums">{formatMoney(spend.importe)}</span></div><p className="mt-2 break-words text-xs leading-relaxed text-neutral-400">{spend.timestamp.slice(0, 10)}{spend.nota ? ` · ${spend.nota}` : ""}</p>{spend.isSample ? <span className="mt-2 block text-[10px] tracking-widest text-neutral-400">SAMPLE DATA</span> : null}</div><Button type="button" size="sm" variant="ghost" onClick={() => { if (budget) { setSpends(removeSpend(budget, spends, spend.id)); setCoaching(null); } }} aria-label={`Delete spend for ${line?.partida ?? "item"}`}><Trash2 size={14} /></Button></li>;
              })}</ul>
            )}
          </section>
        </div>
      </div>

      <section className="gemma-section" aria-labelledby="gemma-title">
        <div><p className="eyebrow">LOCAL INTELLIGENCE / OPTIONAL</p><h2 id="gemma-title" className="mt-4 text-4xl tracking-tight">Read the numbers.<br /><span className="text-neutral-500">With Gemma.</span></h2><p className="mt-5 max-w-sm text-sm leading-relaxed text-neutral-400">Gemma uses only your CSV and spend log through Ollama on this computer. Unknown figures stay unknown. Your budget works without it.</p><div className="mt-6"><Badge tone="neutral">{gemmaStatus === "unknown" ? "Checking local Gemma…" : gemmaStatus === "ready" ? `${GEMMA_MODEL} · Available locally` : `${GEMMA_MODEL} · Not detected`}</Badge></div></div>
        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap gap-2">{PRESET_QUESTIONS.map((item) => <Button key={item} type="button" size="sm" variant={question === item ? "default" : "outline"} onClick={() => setQuestion(item)}>{item}</Button>)}</div>
          <div className="space-y-2"><Label htmlFor="gemma-question">Your question</Label><Textarea id="gemma-question" value={question} onChange={(event) => setQuestion(event.target.value)} /></div>
          <Button type="button" onClick={() => void askGemma()} disabled={!facts || coachingBusy || !question.trim()}>{coachingBusy ? "Reading with local Gemma…" : "Ask local Gemma"}<ArrowUpRight size={16} /></Button>
          <CoachingResult coaching={coaching} />
        </div>
      </section>

      <details className="section"><summary className="cursor-pointer text-sm">Open the local budget crew</summary><div className="mt-8"><Crew /></div></details>

      <footer className="footer"><span>LOCAL / BUDGET</span><p>Approved stays fixed. Spending stays local. No cloud connection.</p></footer>
    </main>
  );
}

function SectionHeading({ number, title, description, id }: { number: string; title: string; description: string; id: string }) {
  return <div className="section-heading"><p className="eyebrow">{number} /</p><h2 id={id} className="mt-3 text-2xl tracking-tight">{title}</h2><p className="mt-2 max-w-lg text-sm leading-relaxed text-neutral-400">{description}</p></div>;
}

function Kpi({ label, value, hint, locked }: { label: string; value: string; hint: string; locked?: boolean }) {
  return <div className="metric"><p className="eyebrow flex items-center gap-2">{label}{locked ? <Lock size={11} /> : null}</p><p className="metric-value">{value}</p><p className="mt-3 text-xs leading-relaxed text-neutral-400">{hint}</p></div>;
}

function CoachingResult({ coaching }: { coaching: GemmaResponse | null }) {
  if (!coaching) {
    return <p className="text-xs leading-relaxed text-neutral-400">No response yet. Ask a question to request a real local Gemma response. If Gemma is unavailable, you’ll see its connection status.</p>;
  }
  if (coaching.status === "unavailable") {
    return <div role="status" className="coaching-result"><p className="flex items-center gap-2 text-sm"><AlertTriangle size={16} /> Gemma did not respond</p><p className="mt-3 text-sm leading-relaxed text-neutral-400">{coaching.detail}</p></div>;
  }
  if (coaching.status === "ungrounded") {
    return <div role="status" className="coaching-result text-sm leading-relaxed">{coaching.text}</div>;
  }
  return <div role="status" className="coaching-result"><p className="mb-3 flex items-center gap-2 text-xs text-neutral-400"><CheckCircle2 size={14} /> Figures checked against local data · {coaching.model}</p><p className="whitespace-pre-wrap text-sm leading-relaxed">{coaching.text}</p></div>;
}

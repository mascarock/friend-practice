"use client";

import { useEffect, useRef, useState } from "react";
import { parseApprovedBudgetCsv, type ApprovedBudget, type SpendEntry } from "@/lib/budget";
import { SAMPLE_CSV, SAMPLE_FILE_NAME } from "@/lib/sample";
import { formatMoney } from "@/lib/money";
import { logSpend, runTool, validateState } from "@/lib/crew/tools";
import { examples, parseMessage, replyFromTool, selectLedgerResult } from "@/lib/crew/chat";
import type { BotId, NoteResponse, ToolResult } from "@/lib/crew/types";

const bots: { id: BotId; name: string; job: string }[] = [
  { id: "ledger", name: "Ledger", job: "Read the approved CSV, row by row." },
  { id: "clerk", name: "Clerk", job: "Log a spend against an existing item." },
  { id: "watcher", name: "Watcher", job: "Find spending above approval." },
  { id: "remainder", name: "Remainder", job: "Show approved, spent, and remaining." },
  { id: "note", name: "Note", job: "A checked sentence from local Gemma." },
];
const STORAGE_KEY = "local-computer:crew:v1";
type Message = { id: string; role: "user" | "assistant"; text: string; time: string; result?: ToolResult; narration?: string; spendCount?: number };
type Threads = Partial<Record<BotId, Message[]>>;

export function Crew() {
  const [budget, setBudget] = useState<ApprovedBudget | null>(null);
  const [spends, setSpends] = useState<SpendEntry[]>([]);
  const [active, setActive] = useState<BotId>("ledger");
  const [threads, setThreads] = useState<Threads>({});
  const [drafts, setDrafts] = useState<Partial<Record<BotId, string>>>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<BotId | null>(null);
  const locked = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        validateState(parsed);
        if (!parsed.budget.isSample) throw new Error("Sample data only.");
        setBudget(parsed.budget); setSpends(parsed.spends);
        // Earlier versions stored only the budget and spend log.
        if (parsed.threads && bots.every(({ id }) => !parsed.threads[id] || (Array.isArray(parsed.threads[id]) && parsed.threads[id].every((message: Message) => typeof message.text === "string" && typeof message.id === "string" && typeof message.time === "string" && ["user", "assistant"].includes(message.role) && (!message.result || Array.isArray(message.result.lines)))))) setThreads(parsed.threads);
      } else setBudget(parseApprovedBudgetCsv(SAMPLE_CSV, SAMPLE_FILE_NAME));
    } catch { setError("Saved data could not be read. Load a sample CSV to continue."); }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !budget) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ budget, spends, threads })); }
    catch { setError("Local storage is full or unavailable. Keep the app open to retain this session."); }
  }, [budget, spends, threads, ready]);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [active, threads, busy]);

  function loadCsv(raw: string, name: string) {
    try {
      const next = parseApprovedBudgetCsv(raw, name);
      validateState({ budget: next, spends: [] });
      if (!next.isSample) throw new Error("This demo accepts sample CSVs only. Include a SAMPLE DATA source label.");
      setBudget(next); setSpends([]); setThreads({}); setDrafts({}); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load this CSV."); }
  }

  function append(bot: BotId, message: Omit<Message, "id" | "time">) {
    setThreads((current) => ({ ...current, [bot]: [...(current[bot] ?? []), { ...message, id: crypto.randomUUID(), time: new Date().toISOString() }] }));
  }

  async function send() {
    const message = drafts[active]?.trim();
    if (!budget || !message || locked.current) return;
    const bot = active;
    locked.current = true; setBusy(bot); setError("");
    append(bot, { role: "user", text: message });
    setDrafts((current) => ({ ...current, [bot]: "" }));
    let result: ToolResult | undefined;
    try {
      const intent = parseMessage(bot, message, budget);
      if (intent.kind === "clarify") { append(bot, { role: "assistant", text: intent.text }); return; }
      let spendCount = spends.length;
      let narration: string | undefined;
      if (intent.kind === "spend") {
        const next = logSpend({ budget, spends }, intent.input);
        setSpends(next.spends); spendCount = next.spends.length; result = next.result;
      } else {
        result = runTool(bot, { budget, spends });
        if (bot === "ledger") result = selectLedgerResult(result, intent.target);
        if (bot === "note") {
          const response = await fetch("/api/crew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ budget, spends }), signal: AbortSignal.timeout(30000) });
          const payload = await response.json() as NoteResponse & { error?: string };
          if (!response.ok) throw new Error(payload.error ?? "Local Note is unavailable.");
          result = payload.toolResult; narration = payload.text;
        }
      }
      append(bot, { role: "assistant", text: replyFromTool(result), result, narration, spendCount });
    } catch {
      append(bot, { role: "assistant", text: result ? replyFromTool(result) : "I couldn’t save that spend. Please check the amount and existing item, then try again.", result, spendCount: spends.length, narration: result ? "Local Gemma did not respond. Here is the computed tool result." : undefined });
    } finally { locked.current = false; setBusy(null); }
  }

  const selected = bots.find((bot) => bot.id === active)!;
  const messages = threads[active] ?? [];
  return <div className="crew-app" data-bot={active}>
    <aside className="crew-sidebar">
      <div className="crew-brand"><span className="brand-mark" /><span>LOCAL<br />COMPUTER</span></div>
      <p className="eyebrow crew-rail-label">YOUR ASSISTANTS / ON THIS MAC</p>
      <nav aria-label="Budget bots">{bots.map((bot) => {
        const last = threads[bot.id]?.at(-1);
        return <div key={bot.id} data-bot={bot.id} className={`crew-bot ${active === bot.id ? "selected" : ""}`}>
          <button className="crew-select" aria-label={`Chat with ${bot.name}`} onClick={() => setActive(bot.id)} aria-current={active === bot.id ? "page" : undefined}>
            <BotAvatar bot={bot.id} /><span className="crew-bot-copy"><span className="crew-bot-name">{bot.name}<time>{last ? new Date(last.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""}</time></span><span className="crew-preview">{last?.text ?? bot.job}</span></span>
          </button>
        </div>;
      })}</nav>
      <div className="crew-local"><span className="crew-dot" /> Offline by design<p>Five small jobs.<br />Your conversations stay here.</p></div>
    </aside>
    <main className="crew-main">
      <header className="crew-top"><span>WORKSPACE / BUDGET CREW</span><span>ON THIS MAC · PRIVATE</span></header>
      <div className="crew-source"><div><span className="eyebrow">SAMPLE DATA</span><p>{budget?.fileName ?? "No CSV loaded"}</p><small>Not Paola’s real budget. Approved amounts stay fixed.</small></div><div className="crew-source-actions"><button disabled={!!busy} onClick={() => fileInput.current?.click()}>Load sample CSV</button><button disabled={!!busy} onClick={() => loadCsv(SAMPLE_CSV, SAMPLE_FILE_NAME)}>Reset sample</button><input ref={fileInput} className="sr-only" aria-label="Load crew CSV" type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((raw) => loadCsv(raw, file.name)).catch(() => setError("Could not read this file.")); event.target.value = ""; }} /></div></div>
      <p className="crew-source-hint">Loading or resetting sample data clears these chats and the spend log.</p>
      {error ? <p role="alert" className="error-message">{error}</p> : null}
      <section className="crew-detail" aria-labelledby="crew-title">
        <div className="crew-title-row"><BotAvatar bot={active} large /><div><h1 id="crew-title">{selected.name}<span>.</span></h1><p className="crew-job">{selected.job}</p></div><span className="crew-chat-status"><span className="crew-dot" />{active === "note" ? "LOCAL GEMMA" : "LOCAL TOOL"}</span></div>
        <div className="crew-thread" role="log" aria-label={`${selected.name} conversation`} aria-live="polite" aria-busy={busy === active}>
          <div className="crew-thread-intro"><span className="eyebrow">A CONVERSATION WITH {selected.name.toUpperCase()}</span><p>Ask in your own words. Answers stay with the loaded sample.</p></div>
          {!messages.length ? <div className="crew-empty"><span>↳</span><p>What would you like to know?</p><small>{active === "clerk" ? "Type an amount and an existing item to log a spend." : "Start with a message below."}</small><button onClick={() => setDrafts((current) => ({ ...current, [active]: examples[active] }))}>{examples[active]} <span>↙</span></button></div> : null}
          {messages.map((message) => <article key={message.id} className={`crew-message crew-message-${message.role}`}>
            <div className="crew-message-meta"><span>{message.role === "user" ? "YOU" : `${selected.name.toUpperCase()}${message.result ? " / SAMPLE DATA" : ""}`}</span><time>{new Date(message.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time></div>
            <div className={message.role === "assistant" ? "crew-answer" : "crew-user-bubble"}>
              {message.narration ? <p className="crew-note">{message.narration}</p> : null}
              {message.narration ? <p className="eyebrow">COMPUTED TOOL RESULT</p> : null}
              <p className="crew-result-message">{message.text}</p>
              {message.result ? <Result result={message.result} /> : null}
              {message.result && message.spendCount !== spends.length ? <p className="crew-snapshot">Saved answer · spending has changed since this message. Ask again for current figures.</p> : null}
            </div>
          </article>)}
          {busy === active ? <p className="crew-thinking" role="status">{active === "note" ? "Tool result ready. Checking local Gemma’s sentence…" : "Checking the local tool…"}</p> : null}
          <div ref={end} />
        </div>
        <form className="crew-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <label className="sr-only" htmlFor="crew-message">Message {selected.name}</label>
          <textarea id="crew-message" rows={2} maxLength={2000} value={drafts[active] ?? ""} placeholder={`Message ${selected.name}…`} disabled={!budget} onChange={(event) => setDrafts((current) => ({ ...current, [active]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
          <div className="crew-composer-bottom"><span>Only your local tools. Approved stays fixed.</span><button type="submit" aria-label={`Send to ${selected.name}`} disabled={!budget || !!busy || !drafts[active]?.trim()}>Send <span>↑</span></button></div>
        </form>
      </section>
      <footer className="crew-footer">SAMPLE DATA · NOT PAOLA’S REAL BUDGET<span>STORED ON THIS MAC</span></footer>
    </main>
  </div>;
}

function BotAvatar({ bot, large = false }: { bot: BotId; large?: boolean }) {
  return <span className={`crew-avatar${large ? " crew-avatar-large" : ""}`} aria-hidden="true"><span className={`crew-shape crew-shape-${bot}`} /></span>;
}

function Result({ result }: { result: ToolResult }) {
  if (result.bot === "remainder" || result.bot === "note") return <dl className="crew-totals">{[["Approved", result.approved], ["Spent", result.spent], ["Remaining", result.remaining]].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{formatMoney(value as number)}</dd></div>)}</dl>;
  if (result.bot !== "clerk") return null;
  return <>{result.lines.map((line, index) => <div key={index}><p className="crew-line-name">{line.item}</p><dl className="crew-totals">{[["Approved", line.approved], ["Spent", line.spent], ["Remaining", line.remaining]].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{formatMoney(value as number)}</dd></div>)}</dl></div>)}</>;
}

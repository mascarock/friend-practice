import { NextResponse } from "next/server";
import { runTool } from "@/lib/crew/tools";
import type { CrewState, NoteResponse } from "@/lib/crew/types";
import { GEMMA_MODEL, OLLAMA_URL } from "@/lib/gemma";
import { withholdNarration } from "@/lib/crew/ground";
import { buildNoteSystemPrompt, buildNoteUserPrompt } from "@/lib/crew/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const localHost = request.headers.get("host") ?? new URL(request.url).host;
  if (origin && origin !== `http://${localHost}`) return NextResponse.json({ error: "Only this local app may run Note." }, { status: 403 });
  let state: CrewState;
  try {
    const raw = await request.text();
    if (raw.length > 2_000_000) throw new Error("This budget is too large for Note.");
    state = JSON.parse(raw) as CrewState;
    const toolResult = runTool("note", state);
    if (!toolResult.isSample) throw new Error("This demo accepts SAMPLE DATA only.");
    try {
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(25000),
        body: JSON.stringify({ model: GEMMA_MODEL, stream: false, options: { temperature: 0, num_predict: 100 }, messages: [
          { role: "system", content: buildNoteSystemPrompt() },
          { role: "user", content: buildNoteUserPrompt(toolResult) },
        ] }),
      });
      if (!response.ok) throw new Error("Local Gemma is unavailable.");
      const payload = await response.json();
      const sentence = typeof payload?.message?.content === "string" ? payload.message.content.trim() : "";
      const checked = withholdNarration(sentence, toolResult);
      const sentenceCount = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(sentence)].length;
      if (checked.status === "narrated" && sentenceCount === 1 && sentence.length <= 400) {
        const text = /^SAMPLE DATA\b/i.test(checked.sentence) ? checked.sentence : `SAMPLE DATA: ${checked.sentence}`;
        return NextResponse.json({ status: "ok", text, toolResult } satisfies NoteResponse);
      }
      return NextResponse.json({ status: "withheld", text: checked.status === "withheld" ? checked.message : "Gemma’s answer was withheld: Note must return one short sentence. The computed result is shown below.", toolResult } satisfies NoteResponse);
    } catch {
      return NextResponse.json({ status: "unavailable", text: "Local Gemma did not respond. Start Ollama with gemma3:1b to try again. The computed result is shown below.", toolResult } satisfies NoteResponse);
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid local budget." }, { status: 400 });
  }
}

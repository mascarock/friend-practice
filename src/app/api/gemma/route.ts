import { NextResponse } from "next/server";
import {
  buildGemmaSystemPrompt,
  buildGemmaUserPrompt,
  GEMMA_MODEL,
  groundModelText,
  OLLAMA_URL,
  UNKNOWN_NUMBER_REPLY,
  type GemmaResponse,
} from "@/lib/gemma";
import type { KnownFacts } from "@/lib/facts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isKnownFacts(value: unknown): value is KnownFacts {
  if (!value || typeof value !== "object") {
    return false;
  }
  const facts = value as KnownFacts;
  return (
    Array.isArray(facts.numbers) &&
    Array.isArray(facts.keys) &&
    typeof facts.sheet === "string" &&
    typeof facts.isSample === "boolean"
  );
}

export async function GET(): Promise<NextResponse> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) {
      return NextResponse.json({ available: false, model: GEMMA_MODEL });
    }
    const payload = (await response.json()) as { models?: Array<{ name?: string }> };
    const names = (payload.models ?? []).map((model) => model.name ?? "");
    const installed = names.some((name) => name === GEMMA_MODEL || name.startsWith(`${GEMMA_MODEL}`));
    return NextResponse.json({ available: installed, model: GEMMA_MODEL, models: names });
  } catch {
    return NextResponse.json({ available: false, model: GEMMA_MODEL });
  }
}

export async function POST(request: Request): Promise<NextResponse<GemmaResponse>> {
  const body = (await request.json()) as { question?: string; facts?: unknown };
  const question = body.question?.trim() ?? "";
  if (!question || !isKnownFacts(body.facts)) {
    return NextResponse.json(
      { status: "unavailable", reason: "empty", detail: "Faltan la pregunta o los datos locales." },
      { status: 400 },
    );
  }

  const facts = body.facts;
  const messages = [
    { role: "system", content: buildGemmaSystemPrompt() },
    { role: "user", content: buildGemmaUserPrompt(facts, question) },
  ];

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model: GEMMA_MODEL,
        stream: false,
        messages,
      }),
    });

    if (response.status === 404) {
      return NextResponse.json(
        {
          status: "unavailable",
          reason: "model_missing",
          detail: `Ollama está en este ordenador, pero falta el modelo ${GEMMA_MODEL}. Ejecuta: ollama pull gemma3:1b`,
        },
        { status: 503 },
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          status: "unavailable",
          reason: "ollama_unreachable",
          detail: `Ollama respondió ${response.status}.`,
        },
        { status: 503 },
      );
    }

    const payload = (await response.json()) as { message?: { content?: string } };
    const raw = payload.message?.content?.trim() ?? "";
    if (!raw) {
      return NextResponse.json({
        status: "unavailable",
        reason: "empty",
        detail: UNKNOWN_NUMBER_REPLY,
      });
    }

    const grounded = groundModelText(raw, facts);
    if (!grounded.ok) {
      return NextResponse.json({ status: "ungrounded", model: GEMMA_MODEL, text: grounded.text });
    }
    return NextResponse.json({ status: "ok", model: GEMMA_MODEL, text: grounded.text, grounded: true });
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json(
      {
        status: "unavailable",
        reason: timeout ? "timeout" : "ollama_unreachable",
        detail: timeout
          ? "Ollama no respondió a tiempo. El presupuesto y el gasto siguen siendo locales."
          : "Gemma no está en este ordenador. Instala Ollama y ejecuta: ollama pull gemma3:1b",
      },
      { status: 503 },
    );
  }
}

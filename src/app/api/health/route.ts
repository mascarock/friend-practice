import { probeOllama, resolveOllamaConfig } from "@/lib/ollama";
import { NextResponse } from "next/server";

export async function GET() {
  const config = resolveOllamaConfig();
  const probe = await probeOllama(config);
  return NextResponse.json(probe, { status: probe.ok ? 200 : 503 });
}

import { afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { collectKnownFacts } from "@/lib/facts";
import { computeLedger } from "@/lib/budget";
import { createSampleBudget } from "@/lib/sample";
import { INVENTED_NUMBER_REPLY, OLLAMA_URL } from "@/lib/gemma";

afterEach(() => vi.unstubAllGlobals());

function request() {
  return new Request("http://localhost/api/gemma", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "What remains?", facts: collectKnownFacts(computeLedger(createSampleBudget(), [])) }),
  });
}

it("reports unavailable local Gemma in English without fabricating a response", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("Offline"));
  vi.stubGlobal("fetch", fetch);
  expect(await (await GET()).json()).toMatchObject({ available: false });
  const response = await POST(request());
  expect(response.status).toBe(503);
  const payload = await response.json();
  expect(payload).toMatchObject({ status: "unavailable", reason: "ollama_unreachable" });
  expect(payload.detail).toContain("Could not reach local Ollama");
  expect(payload.text).toBeUndefined();
  for (const [url] of fetch.mock.calls) expect(url).toMatch(new RegExp(`^${OLLAMA_URL}/api/`));
});

it("withholds unsupported model figures and asks for English responses", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ message: { content: "Spend 99999 next month." } }));
  vi.stubGlobal("fetch", fetch);
  expect(await (await POST(request())).json()).toMatchObject({ status: "ungrounded", text: INVENTED_NUMBER_REPLY });
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe(`${OLLAMA_URL}/api/chat`);
  expect(JSON.parse(options.body).messages[0].content).toContain("Respond in English");
});

import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";
import { parseApprovedBudgetCsv } from "@/lib/budget";
import { SAMPLE_CSV } from "@/lib/sample";
import { logSpend } from "@/lib/crew/tools";

const budget = parseApprovedBudgetCsv(SAMPLE_CSV, "sample.csv");
const spends = logSpend({ budget, spends: [] }, { lineId: budget.lines[2].id, amount: "4700", note: "Sample stand" }).spends;
function request(state = { budget, spends }) {
  return new Request("http://127.0.0.1/api/crew", { method: "POST", body: JSON.stringify(state) });
}
afterEach(() => vi.unstubAllGlobals());

it.each(["SAMPLE DATA: Meta Ads is over budget by 200.", "SAMPLE DATA: Q4 trade fair is over budget by 999."])("withholds unsafe Gemma narration: %s", async (sentence) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ message: { content: sentence } }));
  vi.stubGlobal("fetch", fetch);
  const payload = await (await POST(request())).json();
  expect(payload.status).toBe("withheld");
  expect(JSON.stringify(payload)).not.toContain(sentence);
  expect(payload.toolResult).toMatchObject({ approved: 16700, spent: 4700, remaining: 12000, lines: [{ item: "Q4 trade fair", overspend: 200 }] });
  expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/chat");
  const messages = JSON.parse(fetch.mock.calls[0][1].body).messages;
  expect(messages[1].content).toContain('"remaining": 12000');
});
it("returns the computed result if local Gemma is offline", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  expect(await (await POST(request())).json()).toMatchObject({ status: "unavailable", toolResult: { approved: 16700, spent: 4700, remaining: 12000 } });
});
it("never contacts Gemma before validating and computing the tool result", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const invalid = { budget, spends: [{ ...spends[0], lineId: "missing" }] };
  expect((await POST(request(invalid))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

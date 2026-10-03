import { describe, expect, it } from "vitest";
import { OllamaError } from "@/lib/ollama";
import { continuePractice, startPractice } from "@/lib/practice";
import { SAMPLE_PROFILE } from "@/lib/sample";

describe("practice loop", () => {
  it("starts a session from a valid profile using the injected chat function", async function () {
    const result = await startPractice(SAMPLE_PROFILE, async () => {
      return "Jordan, we will keep this short. Try a 30-second update.";
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.session.status).toBe("awaiting_reply");
    expect(result.session.turns[0]).toEqual({
      speaker: "partner",
      content: "Jordan, we will keep this short. Try a 30-second update.",
    });
  });

  it("returns field errors instead of calling the model", async function () {
    let called = false;
    const result = await startPractice({ name: "" }, async () => {
      called = true;
      return "should not run";
    });

    expect(called).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      errors: { name: "Add their name." },
    });
  });

  it("continues after a learner reply and completes on the third wrap-up", async function () {
    const started = await startPractice(SAMPLE_PROFILE, async () => "Prompt 1");
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    const second = await continuePractice(
      started.session,
      "First try",
      async () => "Prompt 2",
    );
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }

    const third = await continuePractice(
      second.session,
      "Second try",
      async () => "Prompt 3",
    );
    expect(third.ok).toBe(true);
    if (!third.ok) {
      return;
    }

    const done = await continuePractice(
      third.session,
      "Third try",
      async () => "Thanks. You stayed concrete. Try pausing once next time.",
    );
    expect(done.ok).toBe(true);
    if (!done.ok) {
      return;
    }
    expect(done.session.status).toBe("complete");
    expect(done.session.turns).toHaveLength(7);
  });

  it("surfaces an Ollama outage instead of faking a partner turn", async function () {
    const result = await startPractice(SAMPLE_PROFILE, async () => {
      throw new OllamaError(
        "unavailable",
        "Could not reach Ollama. This app will not invent a practice transcript.",
      );
    });

    expect(result).toEqual({
      ok: false,
      code: "unavailable",
      error:
        "Could not reach Ollama. This app will not invent a practice transcript.",
    });
  });
});

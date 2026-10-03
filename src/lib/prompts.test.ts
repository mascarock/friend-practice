import { describe, expect, it } from "vitest";
import { SAMPLE_NOTICE, SAMPLE_PROFILE } from "@/lib/sample";
import { parseProfile } from "@/lib/profile";
import {
  applyLearnerMessage,
  applyPartnerMessage,
  createIdleSession,
} from "@/lib/session";
import {
  buildSystemPrompt,
  buildUserInstruction,
  toOllamaMessages,
} from "@/lib/prompts";

describe("practice prompts", () => {
  it("puts the person's details and the sample warning into the system prompt", () => {
    const prompt = buildSystemPrompt(SAMPLE_PROFILE);
    expect(prompt).toContain("Jordan (sample)");
    expect(prompt).toContain(SAMPLE_PROFILE.skill);
    expect(prompt).toContain(SAMPLE_PROFILE.avoid);
    expect(prompt).toContain(SAMPLE_NOTICE);
    expect(prompt).toContain("3 practice attempts");
  });

  it("omits the sample warning for a real profile", () => {
    const parsed = parseProfile({
      name: "Sam",
      skill: "asking clearer questions",
      avoid: "interrupting",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const prompt = buildSystemPrompt(parsed.profile);
    expect(prompt).toContain("Sam");
    expect(prompt).not.toContain(SAMPLE_NOTICE);
  });

  it("asks Gemma to open, continue, then wrap up", () => {
    let session = createIdleSession(SAMPLE_PROFILE);
    expect(buildUserInstruction(session)).toMatch(/Start the session/);

    session = applyPartnerMessage(session, "First prompt");
    session = applyLearnerMessage(session, "My first try");
    expect(buildUserInstruction(session)).toMatch(/attempt 1 of 3/);

    session = applyPartnerMessage(session, "Second prompt");
    session = applyLearnerMessage(session, "My second try");
    session = applyPartnerMessage(session, "Third prompt");
    session = applyLearnerMessage(session, "My third try");
    expect(buildUserInstruction(session)).toMatch(/end the session/);
    expect(buildUserInstruction(session)).not.toMatch(/next practice prompt/);
  });

  it("builds the Ollama message list from session turns", () => {
    let session = createIdleSession(SAMPLE_PROFILE);
    session = applyPartnerMessage(session, "First prompt");
    session = applyLearnerMessage(session, "My first try");
    const messages = toOllamaMessages(session);

    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[1]).toEqual({ role: "assistant", content: "First prompt" });
    expect(messages[2]).toEqual({ role: "user", content: "My first try" });
    expect(messages.at(-1)?.role).toBe("user");
    expect(messages.at(-1)?.content).toMatch(/attempt 1 of 3/);
  });
});

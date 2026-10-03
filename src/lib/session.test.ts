import { describe, expect, it } from "vitest";
import { SAMPLE_PROFILE } from "@/lib/sample";
import {
  LEARNER_REPLY_MAX,
  PRACTICE_ROUNDS,
  applyLearnerMessage,
  applyPartnerMessage,
  createIdleSession,
  learnerReplyCount,
  nextStep,
  parseSessionPayload,
  remainingLearnerTurns,
} from "@/lib/session";

function startedSession() {
  return applyPartnerMessage(
    createIdleSession(SAMPLE_PROFILE),
    "Let's try a 30-second update. What did you finish yesterday?",
  );
}

describe("practice session", () => {
  it("starts idle and opens on the first partner message", () => {
    const idle = createIdleSession(SAMPLE_PROFILE);
    expect(idle.status).toBe("idle");
    expect(nextStep(idle)).toBe("open");
    expect(remainingLearnerTurns(idle)).toBe(PRACTICE_ROUNDS);

    const open = applyPartnerMessage(idle, "First prompt");
    expect(open.status).toBe("awaiting_reply");
    expect(nextStep(open)).toBe("continue");
  });

  it("rejects empty partner or learner messages", () => {
    expect(() =>
      applyPartnerMessage(createIdleSession(SAMPLE_PROFILE), "   "),
    ).toThrow("empty reply");
    expect(() => applyLearnerMessage(startedSession(), "   ")).toThrow(
      "Write a reply",
    );
    expect(() =>
      applyLearnerMessage(startedSession(), "x".repeat(LEARNER_REPLY_MAX + 1)),
    ).toThrow("2000");
  });

  it("rejects a learner reply before the partner has spoken", () => {
    expect(() =>
      applyLearnerMessage(createIdleSession(SAMPLE_PROFILE), "hello"),
    ).toThrow("Wait for the partner");
  });

  it("counts three learner attempts and then wraps up", () => {
    let session = startedSession();

    for (let i = 0; i < PRACTICE_ROUNDS; i += 1) {
      session = applyLearnerMessage(session, `Attempt ${i + 1}`);
      expect(learnerReplyCount(session)).toBe(i + 1);
      expect(nextStep(session)).toBe(
        i === PRACTICE_ROUNDS - 1 ? "wrap_up" : "continue",
      );
      session = applyPartnerMessage(session, `Partner ${i + 1}`);
    }

    expect(session.status).toBe("complete");
    expect(remainingLearnerTurns(session)).toBe(0);
    expect(() => applyLearnerMessage(session, "one more")).toThrow(
      "Wait for the partner",
    );
  });

  it("parses a valid session payload and rejects a broken one", () => {
    const session = startedSession();
    expect(parseSessionPayload(session)).toEqual(session);
    expect(() => parseSessionPayload({ profile: SAMPLE_PROFILE })).toThrow(
      "turns",
    );
    expect(() =>
      parseSessionPayload({
        ...session,
        turns: [{ speaker: "coach", content: "nope" }],
      }),
    ).toThrow("unknown speaker");
  });
});

import { parseProfile, type PracticeProfile } from "@/lib/profile";

export const PRACTICE_ROUNDS = 3;
export const LEARNER_REPLY_MAX = 2000;

export type Speaker = "partner" | "learner";

export type Turn = {
  speaker: Speaker;
  content: string;
};

export type SessionStatus = "idle" | "awaiting_reply" | "complete";

export type PracticeSession = {
  profile: PracticeProfile;
  turns: Turn[];
  status: SessionStatus;
  roundsCompleted: number;
};

export type SessionStep = "open" | "continue" | "wrap_up";

export function createIdleSession(profile: PracticeProfile): PracticeSession {
  return {
    profile,
    turns: [],
    status: "idle",
    roundsCompleted: 0,
  };
}

export function learnerReplyCount(session: PracticeSession): number {
  return session.turns.filter((turn) => turn.speaker === "learner").length;
}

export function remainingLearnerTurns(session: PracticeSession): number {
  return Math.max(0, PRACTICE_ROUNDS - learnerReplyCount(session));
}

export function nextStep(session: PracticeSession): SessionStep {
  if (session.turns.length === 0) {
    return "open";
  }
  if (learnerReplyCount(session) >= PRACTICE_ROUNDS) {
    return "wrap_up";
  }
  return "continue";
}

export function applyPartnerMessage(
  session: PracticeSession,
  content: string,
): PracticeSession {
  const text = content.trim();
  if (!text) {
    throw new Error("The partner sent an empty reply.");
  }

  const rounds = learnerReplyCount(session);
  const complete = rounds >= PRACTICE_ROUNDS;

  return {
    ...session,
    turns: [...session.turns, { speaker: "partner", content: text }],
    status: complete ? "complete" : "awaiting_reply",
    roundsCompleted: rounds,
  };
}

export function applyLearnerMessage(
  session: PracticeSession,
  content: string,
): PracticeSession {
  if (session.status !== "awaiting_reply") {
    throw new Error("Wait for the partner before sending another reply.");
  }

  const text = content.trim();
  if (!text) {
    throw new Error("Write a reply before sending.");
  }
  if (text.length > LEARNER_REPLY_MAX) {
    throw new Error(`Keep the reply under ${LEARNER_REPLY_MAX} characters.`);
  }

  const roundsCompleted = learnerReplyCount(session) + 1;

  return {
    ...session,
    turns: [...session.turns, { speaker: "learner", content: text }],
    status: "idle",
    roundsCompleted,
  };
}

function isSpeaker(value: unknown): value is Speaker {
  return value === "partner" || value === "learner";
}

function isStatus(value: unknown): value is SessionStatus {
  return value === "idle" || value === "awaiting_reply" || value === "complete";
}

export function parseTurns(input: unknown): Turn[] {
  if (!Array.isArray(input)) {
    throw new Error("The session is missing its turns.");
  }

  return input.map((item, index) => {
    if (item === null || typeof item !== "object") {
      throw new Error(`Turn ${index + 1} is not valid.`);
    }
    const raw = item as Record<string, unknown>;
    if (!isSpeaker(raw.speaker)) {
      throw new Error(`Turn ${index + 1} has an unknown speaker.`);
    }
    if (typeof raw.content !== "string" || !raw.content.trim()) {
      throw new Error(`Turn ${index + 1} is empty.`);
    }
    return {
      speaker: raw.speaker,
      content: raw.content.trim(),
    };
  });
}

export function parseSessionPayload(input: unknown): PracticeSession {
  if (input === null || typeof input !== "object") {
    throw new Error("The session payload is missing.");
  }

  const raw = input as Record<string, unknown>;
  const parsedProfile = parseProfile(raw.profile);
  if (!parsedProfile.ok) {
    throw new Error("The session profile is incomplete.");
  }

  const turns = parseTurns(raw.turns);
  const status = isStatus(raw.status) ? raw.status : null;
  if (!status) {
    throw new Error("The session status is not valid.");
  }

  const roundsCompleted =
    typeof raw.roundsCompleted === "number" &&
    Number.isInteger(raw.roundsCompleted) &&
    raw.roundsCompleted >= 0
      ? raw.roundsCompleted
      : learnerReplyCount({
          profile: parsedProfile.profile,
          turns,
          status,
          roundsCompleted: 0,
        });

  return {
    profile: parsedProfile.profile,
    turns,
    status,
    roundsCompleted,
  };
}

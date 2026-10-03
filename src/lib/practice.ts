import { OllamaError, chatWithGemma, type OllamaMessage } from "@/lib/ollama";
import { parseProfile, type PracticeProfile } from "@/lib/profile";
import { toOllamaMessages } from "@/lib/prompts";
import {
  applyLearnerMessage,
  applyPartnerMessage,
  createIdleSession,
  parseSessionPayload,
  type PracticeSession,
} from "@/lib/session";

export type ChatFn = (messages: OllamaMessage[]) => Promise<string>;

export type PracticeSuccess = {
  ok: true;
  session: PracticeSession;
};

export type PracticeFailure = {
  ok: false;
  errors?: Record<string, string>;
  error?: string;
  code?: string;
};

export type PracticeResult = PracticeSuccess | PracticeFailure;

function fromUnknownError(error: unknown): PracticeFailure {
  if (error instanceof OllamaError) {
    return { ok: false, code: error.code, error: error.message };
  }
  if (error instanceof Error) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "The practice session could not continue." };
}

export async function startPractice(
  profileInput: unknown,
  chat: ChatFn = chatWithGemma,
): Promise<PracticeResult> {
  const parsed = parseProfile(profileInput);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors };
  }

  try {
    let session = createIdleSession(parsed.profile);
    const reply = await chat(toOllamaMessages(session));
    session = applyPartnerMessage(session, reply);
    return { ok: true, session };
  } catch (error) {
    return fromUnknownError(error);
  }
}

export async function continuePractice(
  sessionInput: unknown,
  learnerMessage: unknown,
  chat: ChatFn = chatWithGemma,
): Promise<PracticeResult> {
  if (typeof learnerMessage !== "string") {
    return { ok: false, error: "Write a reply before sending." };
  }

  try {
    let session = parseSessionPayload(sessionInput);
    session = applyLearnerMessage(session, learnerMessage);
    const reply = await chat(toOllamaMessages(session));
    session = applyPartnerMessage(session, reply);
    return { ok: true, session };
  } catch (error) {
    return fromUnknownError(error);
  }
}

export function publicProfile(profile: PracticeProfile): PracticeProfile {
  return { ...profile };
}

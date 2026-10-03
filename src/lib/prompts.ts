import { SAMPLE_NOTICE } from "@/lib/sample";
import {
  PRACTICE_ROUNDS,
  learnerReplyCount,
  nextStep,
  type PracticeSession,
} from "@/lib/session";
import type { OllamaMessage } from "@/lib/ollama";
import type { PracticeProfile } from "@/lib/profile";

export function buildSystemPrompt(profile: PracticeProfile): string {
  const sampleLine = profile.isSample
    ? `The learner profile is labeled sample data. ${SAMPLE_NOTICE} Do not invent a biography.`
    : "";

  return [
    "You are a patient local practice partner for one person.",
    `Their name is ${profile.name}.`,
    `They want to get better at: ${profile.skill}.`,
    `Avoid: ${profile.avoid}.`,
    sampleLine,
    "Rules:",
    "- Stay kind, specific, and unhurried.",
    "- Ask for one short spoken or written attempt at a time.",
    "- After they try, give brief feedback and one next prompt.",
    "- Do not grade with scores. Do not invent quotes from them.",
    "- Keep each reply under 120 words.",
    `- This session is short: ${PRACTICE_ROUNDS} practice attempts, then a wrap-up.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildUserInstruction(session: PracticeSession): string {
  const step = nextStep(session);
  const replies = learnerReplyCount(session);

  if (step === "open") {
    return `Start the session. Greet ${session.profile.name} by name, say you will keep this short and patient, and give the first practice prompt. Do not wait for extra context.`;
  }

  if (step === "wrap_up") {
    return `They have finished ${PRACTICE_ROUNDS} attempts. Thank them, name two concrete things that went well from their replies, and offer one small thing to try next time. Then end the session. Do not ask another practice question.`;
  }

  return `They just replied. Give brief, patient feedback on that attempt, then one next practice prompt. This is attempt ${replies} of ${PRACTICE_ROUNDS}.`;
}

export function toOllamaMessages(session: PracticeSession): OllamaMessage[] {
  const messages: OllamaMessage[] = [
    { role: "system", content: buildSystemPrompt(session.profile) },
  ];

  for (const turn of session.turns) {
    messages.push({
      role: turn.speaker === "partner" ? "assistant" : "user",
      content: turn.content,
    });
  }

  messages.push({ role: "user", content: buildUserInstruction(session) });
  return messages;
}

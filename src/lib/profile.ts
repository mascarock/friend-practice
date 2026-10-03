export const NAME_MAX = 60;
export const SKILL_MAX = 240;
export const AVOID_MAX = 240;

export type PracticeProfile = {
  name: string;
  skill: string;
  avoid: string;
  isSample: boolean;
};

export type ProfileValidation =
  | { ok: true; profile: PracticeProfile }
  | { ok: false; errors: Record<string, string> };

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseProfile(input: unknown): ProfileValidation {
  if (input === null || typeof input !== "object") {
    return {
      ok: false,
      errors: { form: "Describe who this practice is for." },
    };
  }

  const raw = input as Record<string, unknown>;
  const name = asTrimmedString(raw.name);
  const skill = asTrimmedString(raw.skill);
  const avoid = asTrimmedString(raw.avoid);
  const isSample = raw.isSample === true;
  const errors: Record<string, string> = {};

  if (!name) {
    errors.name = "Add their name.";
  } else if (name.length > NAME_MAX) {
    errors.name = `Keep the name under ${NAME_MAX} characters.`;
  }

  if (!skill) {
    errors.skill = "What are they trying to get better at?";
  } else if (skill.length > SKILL_MAX) {
    errors.skill = `Keep this under ${SKILL_MAX} characters.`;
  }

  if (!avoid) {
    errors.avoid = "What should the partner avoid?";
  } else if (avoid.length > AVOID_MAX) {
    errors.avoid = `Keep this under ${AVOID_MAX} characters.`;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    profile: { name, skill, avoid, isSample },
  };
}

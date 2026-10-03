import { describe, expect, it } from "vitest";
import { NAME_MAX, parseProfile } from "@/lib/profile";
import { SAMPLE_PROFILE } from "@/lib/sample";

describe("parseProfile", () => {
  it("accepts a complete profile and trims fields", () => {
    const result = parseProfile({
      name: "  Sam  ",
      skill: "  asking clearer questions  ",
      avoid: "  interrupting  ",
      isSample: false,
    });

    expect(result).toEqual({
      ok: true,
      profile: {
        name: "Sam",
        skill: "asking clearer questions",
        avoid: "interrupting",
        isSample: false,
      },
    });
  });

  it("keeps the sample flag only when it is explicitly true", () => {
    const sample = parseProfile({ ...SAMPLE_PROFILE });
    expect(sample.ok).toBe(true);
    if (sample.ok) {
      expect(sample.profile.isSample).toBe(true);
    }

    const notSample = parseProfile({
      name: "Sam",
      skill: "asking clearer questions",
      avoid: "interrupting",
      isSample: "true",
    });
    expect(notSample.ok).toBe(true);
    if (notSample.ok) {
      expect(notSample.profile.isSample).toBe(false);
    }
  });

  it("rejects missing or oversized fields", () => {
    expect(parseProfile(null).ok).toBe(false);
    expect(parseProfile({ name: "", skill: "x", avoid: "y" })).toMatchObject({
      ok: false,
      errors: { name: "Add their name." },
    });
    expect(
      parseProfile({
        name: "x".repeat(NAME_MAX + 1),
        skill: "asking clearer questions",
        avoid: "interrupting",
      }).ok,
    ).toBe(false);
    expect(
      parseProfile({
        name: "Sam",
        skill: "",
        avoid: "interrupting",
      }),
    ).toMatchObject({
      ok: false,
      errors: { skill: "What are they trying to get better at?" },
    });
    expect(
      parseProfile({
        name: "Sam",
        skill: "asking clearer questions",
        avoid: "",
      }),
    ).toMatchObject({
      ok: false,
      errors: { avoid: "What should the partner avoid?" },
    });
  });
});

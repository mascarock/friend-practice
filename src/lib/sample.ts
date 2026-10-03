import type { PracticeProfile } from "@/lib/profile";

export const SAMPLE_NOTICE =
  "This is sample data for trying the app. It is not a real person, quote, or testimonial.";

export const SAMPLE_PROFILE: PracticeProfile = {
  name: "Jordan (sample)",
  skill:
    "giving a short spoken summary of a work update, in about 30 seconds",
  avoid:
    "harsh scoring, rushing the person, or treating filler words like a failure",
  isSample: true,
};

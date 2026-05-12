/**
 * Step keys for timeline + orchestration.
 * Automated keys run via POST …/actions/run-step.
 * Human keys are logged when you approve/reject from the dashboard.
 */
export const STUDIO_STEP_KEYS = {
  // --- ingest ---
  FETCH_DRIVE_PHOTOS: "FETCH_DRIVE_PHOTOS",

  // --- stage A dog illustration ---
  DOG_LLM_INITIAL_PROMPT: "DOG_LLM_INITIAL_PROMPT",
  DOG_IMG_V1: "DOG_IMG_V1",
  DOG_LLM_CRITIQUE: "DOG_LLM_CRITIQUE",
  DOG_IMG_V2_CORRECTION: "DOG_IMG_V2_CORRECTION",
  DOG_LLM_IDENTITY_PROMPT: "DOG_LLM_IDENTITY_PROMPT",
  DOG_IMG_V3_IDENTITY: "DOG_IMG_V3_IDENTITY",

  // --- stage B text ---
  TEXT_LLM_STYLE_PROMPT: "TEXT_LLM_STYLE_PROMPT",
  TEXT_IMG_V1: "TEXT_IMG_V1",
  TEXT_LLM_CRITIQUE: "TEXT_LLM_CRITIQUE",
  TEXT_IMG_V2_CORRECTION: "TEXT_IMG_V2_CORRECTION",

  // --- stage C final composition ---
  FINAL_IMG_V1: "FINAL_IMG_V1",
  FINAL_LLM_CRITIQUE: "FINAL_LLM_CRITIQUE",
  FINAL_IMG_V2_CORRECTION: "FINAL_IMG_V2_CORRECTION",

  // --- human decisions (audit trail) ---
  HUMAN_APPROVE_DOG: "HUMAN_APPROVE_DOG",
  HUMAN_REJECT_DOG: "HUMAN_REJECT_DOG",
  HUMAN_APPROVE_TEXT: "HUMAN_APPROVE_TEXT",
  HUMAN_REJECT_TEXT: "HUMAN_REJECT_TEXT",
  HUMAN_APPROVE_FINAL: "HUMAN_APPROVE_FINAL",
  HUMAN_REJECT_FINAL: "HUMAN_REJECT_FINAL",
} as const;

export type StudioStepKey = (typeof STUDIO_STEP_KEYS)[keyof typeof STUDIO_STEP_KEYS];

export const STUDIO_PROMPT_KEYS = {
  dog_initial_prompt_llm: "dog_initial_prompt_llm",
  dog_critique_llm: "dog_critique_llm",
  dog_identity_prompt_llm: "dog_identity_prompt_llm",
  text_style_prompt_llm: "text_style_prompt_llm",
  text_critique_llm: "text_critique_llm",
  final_composition_image_prompt: "final_composition_image_prompt",
  final_critique_llm: "final_critique_llm",
} as const;

export type StudioPromptKey = (typeof STUDIO_PROMPT_KEYS)[keyof typeof STUDIO_PROMPT_KEYS];

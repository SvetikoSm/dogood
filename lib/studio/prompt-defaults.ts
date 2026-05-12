import type { StudioPromptKey } from "@/lib/studio/step-keys";
import { STUDIO_PROMPT_KEYS } from "@/lib/studio/step-keys";

type PromptSeed = { key: StudioPromptKey; title: string; body: string };

const JSON_RULES = `You MUST respond with a single JSON object only (no markdown fences).
Schema:
{
  "status": "ok" | "needs_correction",
  "prompt": "string — next image prompt, or empty if truly N/A",
  "reasoning_summary": "string — short, non-chain-of-thought",
  "key_issues": ["string"],
  "confidence": 0.0
}
confidence is between 0 and 1.`;

export const STUDIO_DEFAULT_PROMPTS: PromptSeed[] = [
  {
    key: STUDIO_PROMPT_KEYS.dog_initial_prompt_llm,
    title: "Dog stage — build Nano Banana image prompt",
    body: `You help create a print-ready pet illustration matching a fixed brand style.

Priorities (in order):
1) Likeness / recognizability of the real pet (face, ears, eyes, muzzle, fur pattern, body type)
2) Style match to the provided style reference illustrations for this template
3) Clean, centered, printable composition

${JSON_RULES}

When status is "ok", put the full detailed English image-generation prompt into "prompt" for the image model.
Reference the attached pet photos and style references implicitly (do not claim you cannot see images).`,
  },
  {
    key: STUDIO_PROMPT_KEYS.dog_critique_llm,
    title: "Dog stage — critique + correction prompt",
    body: `You compare a generated pet illustration to the real pet photos and style references.

${JSON_RULES}

If the image is already strong on likeness + style + printability, return status "ok" and a minimal "prompt" that says to keep the image unchanged.
If it needs work, return "needs_correction" and a concrete correction prompt for the image model.`,
  },
  {
    key: STUDIO_PROMPT_KEYS.dog_identity_prompt_llm,
    title: "Dog stage — identity-only correction prompt",
    body: `Preserve the existing illustration style, pose, and composition, but improve similarity to the real pet.

${JSON_RULES}`,
  },
  {
    key: STUDIO_PROMPT_KEYS.text_style_prompt_llm,
    title: "Text stage — stylized pet name",
    body: `Generate an image prompt so the customer's pet name appears as graphic text matching the text style reference.

Hard rules:
- Preserve the exact spelling and codepoints of the pet name provided by metadata (no translation, no transliteration).
- Preserve the script: Cyrillic stays Cyrillic, Latin stays Latin.
- If mixed scripts appear in the name, keep them exactly.

${JSON_RULES}`,
  },
  {
    key: STUDIO_PROMPT_KEYS.text_critique_llm,
    title: "Text stage — critique spelling/script/style",
    body: `Evaluate the generated name artwork against the text style reference.

Check: style/weight/flow, spelling vs requested name, script correctness, composition.

${JSON_RULES}`,
  },
  {
    key: STUDIO_PROMPT_KEYS.final_composition_image_prompt,
    title: "Final composition — image prompt template",
    body: `Universal composition instruction (prepended before template-specific notes):

Replace the original illustrated dog with the provided custom dog artwork.
Replace the original name lettering with the provided custom name artwork.
Keep all other layout, ornaments, palette relationships, and print margins consistent with the master template.
Output a single cohesive, print-ready illustration.

Template-specific replacement rules and extra copy edits are appended separately at runtime.`,
  },
  {
    key: STUDIO_PROMPT_KEYS.final_critique_llm,
    title: "Final composition — critique",
    body: `Compare the final composite to the master template and inputs.

Check: overall design fidelity, dog recognizability, text integration, print cleanliness.

${JSON_RULES}`,
  },
];

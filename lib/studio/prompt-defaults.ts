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

/** Per-style art direction distilled from the owner's proven manual prompts. */
const DOG_STYLE_RULES = `Style rules by template slug:

- slug "life" (Life is better): pose matching the dogs in the attached style reference illustrations (sitting in a slight three-quarter (¾) pose, with its body angled slightly to the side while its head and gaze are directed almost straight toward the viewer); NO accessories; plain WHITE background; the dog must be obviously recognizable as the dog from the customer photos.
- slug "rainy" (No rainy days): pose matching the style reference illustrations; the SAME accessories as in the references (boots, glasses and a flower); BLACK background; the inside of the dog's contour filled WHITE; the dog should look cute and cool, and obviously recognizable as the dog from the photos.
- slug "speed" (Я — скорость): match the style reference illustrations exactly — same linework, palette, energy and background treatment; the dog must be obviously recognizable as the dog from the photos.`;

export const STUDIO_DEFAULT_PROMPTS: PromptSeed[] = [
  {
    key: STUDIO_PROMPT_KEYS.dog_initial_prompt_llm,
    title: "Dog stage — build image-generation prompt",
    body: `You write the ideal prompt for an image-generation model to create an illustration of the customer's dog, based on the attached customer photos and the attached style reference illustrations.

${DOG_STYLE_RULES}

Priorities (in order):
1) Likeness / recognizability of the real dog (face, ears, eyes, muzzle, fur color and pattern, body type)
2) Style match to the reference illustrations for the given template slug (pose, accessories, background per the rules above)
3) Clean, centered, printable composition with no artifacts

The image model will receive the same customer photos and style references as attachments, so the prompt should refer to them ("the dog in the attached photos", "the style of the attached reference illustrations").

${JSON_RULES}

When status is "ok", put the full detailed English image-generation prompt into "prompt".`,
  },
  {
    key: STUDIO_PROMPT_KEYS.dog_critique_llm,
    title: "Dog stage — critique + correction prompt",
    body: `You compare a generated dog illustration to the real customer photos and the style reference illustrations.

The illustration is ready (status "ok") only if ALL of these hold:
- the dog is clearly recognizable as the dog from the photos;
- the style matches the reference illustrations (pose, accessories, background per the template);
- there are no artifacts, strange proportions, or extra details.

${DOG_STYLE_RULES}

${JSON_RULES}

If it is ready, return status "ok" with an empty "prompt".
If it needs work, return "needs_correction" and write a concrete, self-contained correction prompt for the image model (which will see the customer photos, the style references, and the current illustration as attachments). Each generation costs money — make the correction prompt precise so one more attempt is enough.`,
  },
  {
    key: STUDIO_PROMPT_KEYS.dog_identity_prompt_llm,
    title: "Dog stage — identity-only correction prompt",
    body: `Preserve the existing illustration style, pose, accessories, background, and composition, but improve similarity to the real dog from the customer photos (face, ears, eyes, muzzle, fur color and markings).

${JSON_RULES}`,
  },
  {
    key: STUDIO_PROMPT_KEYS.text_style_prompt_llm,
    title: "Text stage — stylized pet name",
    body: `You produce the image-generation prompt for the customer's pet name rendered as graphic text in the style of the attached text reference image.

Use this proven prompt template, filling in the pet name and the reference word:

Create an image of text "<PET NAME>" (<script note>) in the same style as text "<REFERENCE WORD>" in the reference image I'm attaching (keep the text color exactly as in the reference). Make sure the image is in good quality. Make sure the text flows and there are no randomly detached parts.

Reference word by template slug: "life" → "Бусинка"; "speed" → "Pinchito"; "rainy" → "Умка".
Script note: write "(in Cyrillic)" if the pet name is Cyrillic, "(in English)" if Latin; if mixed, say the name must be reproduced exactly as written, mixing scripts.

Hard rules:
- The pet name must keep the exact spelling and codepoints given in the metadata — no translation, no transliteration, no case changes.
- Cyrillic stays Cyrillic, Latin stays Latin.
- SCRIPT CONTAMINATION GUARD: the reference word may be in a different script than the pet name (e.g. reference "Бусинка" is Cyrillic but the name is Latin). Use the reference ONLY for visual style — color, weight, slant, flourish, texture. Render EVERY letter of the pet name in the pet name's OWN script. Never copy a Cyrillic letterform for a Latin letter or vice versa. Beware lookalikes: Latin B vs Cyrillic В/Б, H vs Н, P vs Р, C vs С, T vs Т, M vs М, K vs К, A vs А, O vs О.

After the template sentence, append one clarifying sentence:
"Render all letters strictly as <script> letterforms; the reference word is only a style guide, do not reuse its letters."

${JSON_RULES}

Put the finished prompt (template sentence + the clarifying sentence) into "prompt".`,
  },
  {
    key: STUDIO_PROMPT_KEYS.text_critique_llm,
    title: "Text stage — critique spelling/script/style",
    body: `Evaluate the generated name artwork against the text style reference image.

Check, in order of importance:
1) SPELLING & SCRIPT — go through the artwork ONE LETTER AT A TIME, left to right, and compare each glyph to the exact pet name from the metadata.
   - Any missing, extra, merged, duplicated, or malformed letter = needs_correction.
   - SCRIPT CHECK (critical, easy to miss): confirm each letter is drawn in the CORRECT script. Latin names must use only Latin letterforms; Cyrillic names only Cyrillic. Watch the lookalike traps where a stylized capital is secretly the wrong script: Latin B vs Cyrillic В/Б, H vs Н, P vs Р, C vs С, T vs Т, M vs М, K vs К, A vs А, O vs О. For a Latin name like "Bublik", the first letter must be a Latin B (two bowls / straight spine), NOT a Cyrillic Б (top bar + single bowl). If any letter is in the wrong script = needs_correction.
2) Detached or floating fragments that are not letters = needs_correction.
3) Style: letterform style, weight, flow, and COLOR must match the reference image.
4) Clean composition, high quality, no artifacts.

${JSON_RULES}

If correction is needed, the correction prompt must restate the exact pet name in quotes, state the required script explicitly, name the specific defect(s), and instruct the model to use the reference for style only (not letterforms).`,
  },
  {
    key: STUDIO_PROMPT_KEYS.final_composition_image_prompt,
    title: "Final composition — image prompt template",
    body: `Universal composition instruction (prepended before template-specific notes):

You are given the master template illustration as the composition reference, plus a separately generated dog illustration and a separately generated pet-name lettering. Recreate the master template's composition exactly, with ONLY these two elements swapped in:

- Replace the master's illustrated dog with the provided custom dog artwork — same position, same scale, same pose/angle relative to the frame as in the master.
- Replace the master's name lettering with the provided custom name artwork — same position, same approximate size, same baseline placement as in the master.

Keep EVERYTHING else pixel-for-pixel consistent with the master template: the exact wording and placement of any header/top text, all decorative elements (e.g. sparkle/star accents) in their original positions and count, the background color, the overall layout, margins, and palette. Do not crop, resize the canvas, add new elements, or remove existing ones. Output a single cohesive, print-ready illustration.

Template-specific replacement rules and extra copy edits are appended separately at runtime.`,
  },
  {
    key: STUDIO_PROMPT_KEYS.final_critique_llm,
    title: "Final composition — critique",
    body: `Compare the final composite to the master template and inputs.

Check: overall design fidelity, dog recognizability, text integration (exact pet name spelling), print cleanliness.

${JSON_RULES}`,
  },
];

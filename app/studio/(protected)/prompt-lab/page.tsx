import { PromptLabClient } from "@/components/studio/prompt-lab-client";

export default function PromptLabPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Prompt Lab</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Calls OpenRouter with <code className="text-zinc-300">STUDIO_LLM_MODEL</code> (or mock
          mode). Paste optional image data URLs for vision tests.
        </p>
      </div>
      <PromptLabClient />
    </div>
  );
}

import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Printable design templates (3 in prod; seed adds demo slugs). */
export const studioTemplates = sqliteTable(
  "studio_templates",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    /** Relative path under studio data dir, e.g. `templates/speed/design.png` */
    designTemplatePath: text("design_template_path").notNull(),
    /** JSON string[] — pet style reference illustrations */
    petStyleRefPathsJson: text("pet_style_ref_paths_json").notNull().default("[]"),
    /** Single text-style reference image */
    textStyleRefPath: text("text_style_ref_path").notNull(),
    /** JSON: { replaceDog, replaceMainName, replaceSecondaryPetNameInCopy } */
    replacementRulesJson: text("replacement_rules_json").notNull(),
    /** Extra instructions (e.g. Design 3 repeated name rules) */
    compositionNotes: text("composition_notes").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("studio_templates_slug_idx").on(t.slug)],
);

export const studioOrderStatuses = [
  /** Manual Telegram job being assembled (awaiting photos/name); orchestrator ignores it. */
  "draft",
  "new",
  "assets_loaded",
  "dog_in_progress",
  "dog_awaiting_approval",
  /** Dog stage approved; run text-stage steps when ready */
  "dog_approved_idle",
  "text_in_progress",
  "text_awaiting_approval",
  /** Text stage approved; run final composition when ready */
  "text_approved_idle",
  "final_in_progress",
  "final_awaiting_approval",
  "completed",
  "error",
] as const;

export type StudioOrderStatus = (typeof studioOrderStatuses)[number];

export const studioOrders = sqliteTable(
  "studio_orders",
  {
    id: text("id").primaryKey(),
    /** Same as Google Sheet "Order ID" */
    sheetOrderId: text("sheet_order_id").notNull().unique(),
    customerName: text("customer_name").notNull().default(""),
    /** Exact characters from the form — never normalize for generation */
    petNameRaw: text("pet_name_raw").notNull().default(""),
    petNameScript: text("pet_name_script").notNull().default("unknown"),
    /** FK-style slug into studio_templates.slug */
    designSlug: text("design_slug").notNull().default(""),
    driveFolderUrl: text("drive_folder_url").notNull().default(""),
    driveFolderId: text("drive_folder_id").notNull().default(""),
    status: text("status").notNull().default("new"),
    /** full = dog→text→final (sheet); dog_text = dog→text (Telegram pack); dog_only / name_only = single-stage manual */
    mode: text("mode").notNull().default("full"),
    lastError: text("last_error").notNull().default(""),
    /** Paths relative to studio data dir for approved stage outputs */
    approvedDogArtifactPath: text("approved_dog_artifact_path").notNull().default(""),
    approvedTextArtifactPath: text("approved_text_artifact_path").notNull().default(""),
    approvedFinalArtifactPath: text("approved_final_artifact_path").notNull().default(""),
    /** Last stage we sent to Telegram (dog|text|final) to avoid duplicate pings */
    reviewNotifiedFor: text("review_notified_for").notNull().default(""),
    /** Latest human reject note from Telegram (used for next correction prompt) */
    humanRejectNote: text("human_reject_note").notNull().default(""),
    /** Consecutive failed automated steps; reset to 0 on success */
    retryCount: integer("retry_count").notNull().default(0),
    /** Orchestrator skips this order until this time (backoff after a failure) */
    nextRetryAt: integer("next_retry_at", { mode: "timestamp" }),
    /** Snapshot of sheet row for debugging / re-sync */
    sheetPayloadJson: text("sheet_payload_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("studio_orders_status_idx").on(t.status),
    index("studio_orders_design_idx").on(t.designSlug),
  ],
);

export const studioOrderPhotos = sqliteTable(
  "studio_order_photos",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => studioOrders.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    driveFileId: text("drive_file_id").notNull().default(""),
    originalName: text("original_name").notNull().default(""),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    /** Relative path under studio data dir */
    localRelativePath: text("local_relative_path").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("studio_order_photos_order_idx").on(t.orderId)],
);

export const studioStepRunStatuses = [
  "pending",
  "running",
  "success",
  "failed",
  "skipped",
] as const;

export type StudioStepRunStatus = (typeof studioStepRunStatuses)[number];

export const studioStepRuns = sqliteTable(
  "studio_step_runs",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => studioOrders.id, { onDelete: "cascade" }),
    /** dog | text | final */
    stage: text("stage").notNull(),
    /** Machine step id, e.g. DOG_LLM_INITIAL_PROMPT */
    stepKey: text("step_key").notNull(),
    attempt: integer("attempt").notNull().default(1),
    status: text("status").notNull().default("pending"),
    providerLlm: text("provider_llm").notNull().default(""),
    providerImage: text("provider_image").notNull().default(""),
    llmModel: text("llm_model").notNull().default(""),
    imageModel: text("image_model").notNull().default(""),
    /** JSON: inputs summary (paths, ids) */
    inputSnapshotJson: text("input_snapshot_json").notNull().default("{}"),
    /** JSON: { system?, user?, imagePrompt? } */
    promptBundleJson: text("prompt_bundle_json").notNull().default("{}"),
    /** Parsed LLM JSON (critique / prompt-gen), if applicable */
    llmOutputJson: text("llm_output_json").notNull().default(""),
    /** Relative path to primary image output */
    outputArtifactPath: text("output_artifact_path").notNull().default(""),
    rawLlmResponseText: text("raw_llm_response_text").notNull().default(""),
    error: text("error").notNull().default(""),
    /** Optional link for correction chains */
    parentStepRunId: text("parent_step_run_id").notNull().default(""),
    startedAt: integer("started_at", { mode: "timestamp" }),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("studio_step_runs_order_idx").on(t.orderId),
    index("studio_step_runs_order_step_idx").on(t.orderId, t.stepKey),
  ],
);

/** Simple named locks (e.g. cron tick) so overlapping runs don't duplicate work. */
export const studioLocks = sqliteTable("studio_locks", {
  name: text("name").primaryKey(),
  lockedUntil: integer("locked_until", { mode: "timestamp" }).notNull(),
});

/** One row per billed AI call (LLM or image) so we can total cost per order. */
export const studioAiCalls = sqliteTable(
  "studio_ai_calls",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().default(""),
    stepKey: text("step_key").notNull().default(""),
    /** "llm" | "image" */
    kind: text("kind").notNull().default("llm"),
    model: text("model").notNull().default(""),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    /** USD; OpenRouter returns this in `usage.cost` when we ask for it */
    costUsd: real("cost_usd").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("studio_ai_calls_order_idx").on(t.orderId)],
);

/** Per-chat conversation state for the manual Telegram menu (pack/dog/name flows). */
export const studioTgSessions = sqliteTable("studio_tg_sessions", {
  chatId: text("chat_id").primaryKey(),
  /** "pack" | "dog" | "name" | "" */
  flow: text("flow").notNull().default(""),
  /** style slug once chosen */
  style: text("style").notNull().default(""),
  /** "style" | "photos" | "name" | "" — what the bot is waiting for */
  awaiting: text("awaiting").notNull().default(""),
  /** manual order being assembled (photos attach here) */
  orderId: text("order_id").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Editable prompt bodies (system + user template); merged at runtime with order context. */
export const studioPromptDefinitions = sqliteTable("studio_prompt_definitions", {
  key: text("key").primaryKey(),
  title: text("title").notNull(),
  /** Main instruction body (markdown ok) */
  body: text("body").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type StudioTgSession = typeof studioTgSessions.$inferSelect;
export type StudioTemplate = typeof studioTemplates.$inferSelect;
export type StudioOrder = typeof studioOrders.$inferSelect;
export type StudioOrderPhoto = typeof studioOrderPhotos.$inferSelect;
export type StudioStepRun = typeof studioStepRuns.$inferSelect;
export type StudioPromptDefinition = typeof studioPromptDefinitions.$inferSelect;

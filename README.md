# DoGood v2

Next.js storefront plus an **internal Studio** dashboard for the multi-stage pet-print design pipeline (Google Sheets + Drive + OpenRouter + pluggable image generation).

## Run locally

```bash
npm install
npm run dev
```

Public site: [http://localhost:3000](http://localhost:3000)

---

## Studio (internal design pipeline)

Password-protected UI under **`/studio`**: orders, per-order step runner, templates, editable prompts, Prompt Lab, and settings.

### MVP architecture (simple by design)

| Piece | Role |
|--------|------|
| **SQLite** (`data/studio/studio.db`, via `@libsql/client` + Drizzle) | Orders synced from Sheets, template config, prompt library, every pipeline step run (inputs/outputs JSON, artifact paths). |
| **Disk** under `data/studio/` | Template PNGs, Drive cache, generated `artifacts/<orderId>/…`. |
| **Google Sheets** | Source of truth for incoming orders (reuses existing ops sheet + `fetchOrderSheetGrid`). |
| **Google Drive** | Pet photos downloaded by folder id parsed from column `Папка с фото`. |
| **OpenRouter** | LLM JSON tasks (prompt writing + critique). Model defaults via `STUDIO_LLM_MODEL` (override per call in Prompt Lab). |
| **Image provider** | `STUDIO_MOCK_AI` → tiny PNG; or `STUDIO_IMAGE_HTTP_URL` JSON POST; else OpenRouter chat + `STUDIO_IMAGE_MODEL` with naive base64 scrape (swap for your real “Nano Banana” HTTP adapter when ready). |

No Redis, no worker queue: each step is **one explicit button** → one API request → one row in `studio_step_runs`. Manual approvals write human audit rows and copy approved artifact paths on the order.

### Setup

1. **Environment** — copy variables from `.env.example` (Studio block). Minimum for login:

   - `STUDIO_ADMIN_PASSWORD`
   - `STUDIO_SESSION_SECRET` (or reuse `REVIEW_SESSION_SECRET` / `CRON_SECRET`)

2. **Database & seed**

   ```bash
   npm run studio:db:push
   npm run studio:seed
   ```

   Seed creates three templates (`speed`, `life`, `rainy`) with tiny placeholder PNGs under `data/studio/templates/…` and a demo order **`STUDIO-DEMO-1`** with one cached photo so you can click through the pipeline in mock mode.

3. **Google (optional for demo)**

   - Same service account as ops: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEETS_SPREADSHEET_ID`, tab name via `GOOGLE_SHEETS_TAB_NAME`.
   - In Studio **Orders**, use **Sync from Google Sheet** to upsert rows into SQLite.
   - **Fetch photos from Drive** on an order uses `Папка с фото` → folder id.

4. **OpenRouter**

   - `OPENROUTER_API_KEY`
   - `STUDIO_LLM_MODEL` — e.g. your **Gemini 2.5 Flash / “Flash Lite”** slug on OpenRouter.
   - For image steps without a custom HTTP adapter: `STUDIO_IMAGE_MODEL` (e.g. your **Gemini image** slug) **or** leave unset and use **`STUDIO_MOCK_AI=true`** until `STUDIO_IMAGE_HTTP_URL` points at your real image endpoint.

5. **Open the UI**

   Visit `/studio/login`, then `/studio/orders` and open an order.

### Pet name / script

`pet_name_raw` is stored **exactly** as in the sheet (Unicode). Script is a **hint** only (`inferPetNameScript`). Prompts instruct the LLM not to translate or transliterate. Optional column override: `STUDIO_SHEET_PET_NAME_COLUMN`; otherwise `pet_name` / `Pet name` / first line of `Футболки`.

### Template-specific rules

`studio_templates.replacement_rules_json` + `composition_notes` drive Stage C wording (e.g. Design 3 repeated names). Edit in **Templates** UI or in the DB.

### Code map

- `lib/studio/db/schema.ts` — Drizzle schema  
- `lib/studio/pipeline/run-studio-step.ts` — step runner  
- `lib/studio/pipeline/human-actions.ts` — approve / reject gates  
- `lib/studio/ai/openrouter-llm.ts` — LLM JSON  
- `lib/studio/ai/image-generation.ts` — mock / HTTP / OpenRouter image  
- `app/studio/(protected)/` — dashboard pages  
- `app/api/studio/**` — JSON APIs + authenticated file proxy  

### Deployment note

**Timeweb (VPS) / любой свой сервер:** соберите образ по `Dockerfile` (Next.js в режиме `standalone`), пробросьте `.env.production` и том для `/app/data` — см. комментарии в `Dockerfile` и пример `deploy/nginx-dogood.conf.example` для nginx перед контейнером.

SQLite для Studio ожидает **постоянный диск** (том Docker на VPS). Если когда‑нибудь снова понадобится serverless без диска, можно направить `STUDIO_DATABASE_URL` на [Turso](https://turso.tech/) или другой hosted libSQL.

Файл `netlify.toml` в репозитории остаётся только для истории/опционального Netlify; на Timeweb он не используется.

---

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)

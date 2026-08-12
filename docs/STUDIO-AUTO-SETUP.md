# Studio automation (n8n replacement)

## What runs automatically

1. **Cron** `GET /api/studio/cron/tick` (every 2–5 min on VPS):
   - Sync orders from [DOGOOD sheet](https://docs.google.com/spreadsheets/d/1v0qR8kUcEICstHSo-R1yluzxarepLmL2B_cSTd1KN1Y)
   - Pick row with `Order ID` + `Папка с фото`, skip `add-on` rows
   - Pet name from column **Кличка**, style from **Стиль (id, 1-я)** (`«Я — скорость»` / `Life is better` / `No rainy days`)
   - Run one pipeline step (dog → text → final)
   - Send Telegram when awaiting your approve

2. **Telegram** commands (after webhook setup):
   - `/approve_dog_hvostik468SD`
   - `/reject_dog_hvostik468SD ears too big` (comment optional)
   - Same for `_text_` and `_final_`

3. **Drive uploads** on approve:
   - Dog → [approved](https://drive.google.com/drive/u/0/folders/1-n0MWLhsxWG6_Rz9GMCp4LG9xYd2oiaQ) as `{Кличка}.png`
   - Text → text badges folder as `{Кличка}.png`
   - Final → approved as `{Кличка}_final.png`

## One-time setup (minimal)

```bash
npm run studio:db:push
```

Copy `.env.example` → `.env.local` and set:

| Variable | Source |
|----------|--------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Same SA as site / Timeweb; share sheet + all Drive folders with `client_email` |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | `1v0qR8kUcEICstHSo-R1yluzxarepLmL2B_cSTd1KN1Y` |
| `GOOGLE_SHEETS_TAB_NAME` | `Orders` (the live tab; NOT "DOGOOD") |
| `OPENROUTER_API_KEY` | Same as n8n Header Auth / OpenRouter |
| `STUDIO_IMAGE_MODEL` | `openai/gpt-5.4-image-2` (GPT Image) |
| `STUDIO_LLM_MODEL` | `google/gemini-2.5-flash` (needs image input for critiques) |
| `STUDIO_MOCK_AI` | `false` |
| `STUDIO_CRON_SECRET` | random string |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | @BotFather |
| `OPS_NOTIFY_TELEGRAM` | `true` |
| `OPS_PUBLIC_BASE_URL` | `https://dogood-brand.ru` |

Pull templates from Drive (once):

```bash
curl -X POST -H "Authorization: Bearer YOUR_STUDIO_CRON_SECRET" \
  https://dogood-brand.ru/api/studio/templates/sync-drive
```

Register Telegram webhook:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://dogood-brand.ru/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Cron on VPS (crontab):

```cron
*/3 * * * * curl -fsS -H "Authorization: Bearer YOUR_STUDIO_CRON_SECRET" https://dogood-brand.ru/api/studio/cron/tick >> /var/log/dogood-studio-cron.log 2>&1
```

## Drive folders (defaults in code)

| Purpose | Folder ID |
|---------|-----------|
| Approved dogs + finals | `1-n0MWLhsxWG6_Rz9GMCp4LG9xYd2oiaQ` |
| Mockup masters | `1cqXzHfe1xByc1aFOlCZLbAGXyH-gISJ0` |
| Pet style refs | `1VcahlOwbGHCqK8iK3HULf4wENu2mTefq` |
| Text style refs | `17K50Hx83nj4OBGgMLjM_8Qqzio1VXNqu` |
| Text badges | `1eB9OI-KYKFb3s4LdiVBEnVOTwxSZGjtl` |

n8n cannot export Google/OpenRouter secrets via API — paste those keys into `.env.local` on the server once.

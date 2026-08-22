# ЗАДАЧА: исправить 6 дефектов ярмарочного потока (dogood-v2)

Ярмарочный бот уже написан и работает (см. `docs/FAIR-BOT-SETUP.md`). Ниже — конкретные дефекты, найденные при ревью. Чини строго по списку, в порядке FIX-1 → FIX-6.

## Правила

- Прочитай `AGENTS.md`. Next.js 16.
- Не добавляй зависимости. Не трогай публичный сайт и форму заказа.
- Схема БД правится ТОЛЬКО парой `lib/studio/db/schema.ts` + `lib/studio/db/ensure-schema.ts` (сырой DDL + `addColumnIfMissing`).
- После КАЖДОГО FIX: `npx tsc --noEmit` без ошибок.
- В конце: оба прогона зелёные (см. «Приёмка»).
- Сообщения клиенту — по-русски, дружелюбно, с эмодзи. Сообщения владельцу — коротко и по делу.

## FIX-1 (блокер) — отклонённый макет не перегенерируется

**Файл:** `lib/studio/pipeline/orchestrator.ts`, блок `/* ---- Stage C: final composition ---- */` в `resolveNextAutomatedStep`.

**Симптом:** владелец жмёт «❌ На доработку» на финальном макете → комментарий сохраняется в `humanRejectNote`, статус становится `final_in_progress`, но следующий тик сразу возвращает статус в `final_awaiting_approval` и присылает ТУ ЖЕ картинку. Для `mode="fair"` виновата ветка `skipsAutoCritique`, которая срабатывает раньше любой проверки заметки. Для `mode="full"` тот же стопор возникает, когда критика отвечает `ok`.

**Причина:** в Stage C, в отличие от стадий dog и text, нет проверки `humanRejectNote` перед проверками критики.

**Что сделать:** сразу после проверки «есть ли хоть одна успешная FINAL_IMG» и ДО `if (skipsAutoCritique(...))` вставить:

```ts
// Human reject always wins over the critique/skip logic — the reviewer is
// the throttle here, same as on the dog and text stages.
if (order.humanRejectNote?.trim()) return STUDIO_STEP_KEYS.FINAL_IMG_V2_CORRECTION;
```

Шаг `FINAL_IMG_V2_CORRECTION` в `run-studio-step.ts` уже умеет забирать и очищать `humanRejectNote` — его не трогай.

## FIX-2 — оплаченный заказ может не доехать до таблицы

**Файл:** `lib/studio/telegram/fair-flow.ts` (`finalizeFairOrder`), `lib/studio/pipeline/orchestrator.ts`.

**Симптом:** если `appendOrderRow` падает (Google недоступен, лимит квоты), клиент уже получил «Заказ оформлен», `step='done'`, но строки в таблице нет и повторной попытки не будет. Оплаченный заказ теряется, остаётся только в SQLite.

**Что сделать:**
1. Экспортируй `finalizeFairOrder` (сейчас она приватная).
2. Добавь в `fair-flow.ts`:

```ts
/** Retry sheet writes for paid, completed fair orders whose row never landed. */
export async function retryUnwrittenFairSheetRows(): Promise<number> { … }
```
Выбирает строки `studio_fair_orders` с `paymentStatus='succeeded' AND step='done' AND sheetRowWritten=false`, для каждой зовёт `finalizeFairOrder`, возвращает число успешно записанных.
3. В `runStudioPipelineTick` (`orchestrator.ts`) вызови её рядом с существующим `pollPendingFairPayments()` — в том же `try/catch`-стиле, добавляя в `actions` строку вида `fair_sheet_rows_written=N`.

## FIX-3 — второй «❌» затирает первый

**Файл:** `lib/studio/telegram/review-bot.ts` (`setReviewPending`, `getReviewPending`, `handlePendingReviewComment`, `handleTelegramCallback`).

**Симптом:** таблица `studio_review_pending` ключуется только по `chat_id`. На ярмарке одновременно висят несколько заказов. Владелец жмёт ❌ на заказе A, потом ❌ на заказе B (не написав комментарий) → запись A молча затирается, отклонение A НЕ применяется, а `dogNotified` остаётся `true`, поэтому A больше никогда не придёт на проверку. Заказ зависает навсегда. Плюс забытый ❌ без таймаута перехватывает следующее текстовое сообщение владельца, ломая ручное меню.

**Что сделать:**
1. В `setReviewPending`: если уже есть pending на ДРУГОЙ заказ/стадию — сначала применить его как отклонение без комментария (`applyReject(prev.stage, prev.sheetOrderId, "")`, там уже есть `GENERIC_REJECT_NOTE`), затем записать новый pending и отправить владельцу: `Доработка <prev> отправлена без комментария.`
2. В `handlePendingReviewComment`:
   - если `pending.updatedAt` старше 15 минут — применить `applyReject(..., "")`, очистить pending и вернуть `{ handled: false }` (текущее сообщение НЕ съедать, пусть идёт в ручное меню);
   - если текст начинается с `/` — вернуть `{ handled: false }`, pending не трогать (это команда, а не комментарий).
3. В сообщении-приглашении («Напишите комментарий одним сообщением») укажи, к чему комментарий: стадия + `sheetOrderId` + кличка.

## FIX-4 — `/start` сжигает лимит и путает клиента посреди заказа

**Файл:** `lib/studio/telegram/fair-flow.ts` (`handleFairCommand`, `createFairSession`, `handleFairPhoto`).

**Симптом:**
- `createFairSession` создаёт заказ и fair-строку прямо на `/start`. Любой, кто просто нажал `/start` и ушёл, навсегда занял свой единственный бесплатный макет и оставил мусорный `draft`-заказ в БД.
- Повторный `/start` на любом шаге кроме `awaiting_photo` (в том числе посреди анкеты после оплаты!) отвечает «вы уже получали макет» — клиент решает, что его заказ потерян.

**Что сделать:**
1. Создавать `studio_orders` + `studio_fair_orders` не в `/start`, а при ПЕРВОМ фото (`handleFairPhoto`, когда сессии ещё нет). `/start` без сессии — только приветствие с согласием на обработку ПД и просьбой прислать фото.
2. Лимит «один макет на аккаунт» считать только по доставленному макету: отказывать, если `step` ∈ `{awaiting_payment, paid_awaiting_size, awaiting_fio, awaiting_phone, awaiting_delivery, awaiting_pvz, done}`.
3. Если сессия на шаге `awaiting_photo | awaiting_pet_name | awaiting_email | generating` — не отказывать, а продолжить с текущего шага, переиспользуя существующий `stepReminder(step)`.

## FIX-5 — у владельца нет ручного управления на мероприятии

**Файл:** `lib/studio/telegram/review-bot.ts` (`handleTelegramCommand`).

Добавь три команды (владелец пишет их своему боту):

- `/fair` — список активных ярмарочных заказов: кличка, шаг, статус оплаты, `sheetOrderId`. Максимум 20 строк, новые сверху.
- `/fair_reset <chatId>` — удалить fair-строку и связанный заказ этого чата (клиент сможет получить макет заново). Отказать, если оплата уже `succeeded` — такие не удалять.
- `/fair_resend <chatId>` — повторно выполнить выдачу макета и ссылки на оплату для последнего fair-заказа этого чата (нужно, когда `createPayment` упал и клиент остался без кнопки). Переиспользуй `handleFairFinalApproved(orderId, driveFileId)`; `driveFileId` возьми из уже сохранённого `makeupUrl`, если он есть.

## FIX-6 — двойное «Спасибо за оплату» / двойная строка в таблице

**Файлы:** `lib/studio/telegram/fair-flow.ts` (`onFairPaymentSucceeded`, `finalizeFairOrder`).

**Симптом:** вебхук ЮKassa и фолбэк-поллинг могут сработать одновременно; проверка «уже обработано» делается отдельным SELECT перед UPDATE, поэтому оба вызова могут пройти её и дважды написать клиенту / дважды добавить строку.

**Что сделать:** заменить пару SELECT-проверка + UPDATE на один условный UPDATE и действовать только если он реально изменил строку:

```ts
const res = await db.update(schema.studioFairOrders)
  .set({ paymentStatus: "succeeded", step: "paid_awaiting_size", updatedAt: new Date() })
  .where(and(eq(schema.studioFairOrders.id, fair.id), ne(schema.studioFairOrders.paymentStatus, "succeeded")));
if ((res.rowsAffected ?? 0) === 0) return;   // another caller already handled it
```
Аналогично для `sheetRowWritten` в `finalizeFairOrder` — пометить строку записанной условным UPDATE ДО обращения к Google, и при неуспешной записи откатить флаг в `false` (чтобы FIX-2 подхватил её на повторе).

## FIX-7 (крупный) — параллельная обработка вместо строго последовательной

**Файлы:** `lib/studio/pipeline/orchestrator.ts` (основное), `lib/studio/config.ts`, `lib/studio/db/schema.ts` + `ensure-schema.ts`, `scripts/install-studio-cron.sh`.

**Симптом:** сейчас `runStudioPipelineTick` берёт ОДИН заказ (`pickWorkingOrder`, `limit 1`), выполняет ОДИН шаг, ждёт его завершения, и только потом берёт следующий. Из-за этого: (а) картинка собаки и картинка клички одного заказа делаются по очереди, хотя они полностью независимы; (б) клиенты в очереди обрабатываются строго друг за другом. При потоке на мероприятии последний в очереди ждёт десятки минут.

**Цель:** выполнять независимые генерации одновременно — и внутри заказа (собака ‖ кличка), и между заказами. Модель генерации картинок НЕ менять: качество важнее, количество вызовов ИИ остаётся прежним, меняется только их одновременность, поэтому стоимость не растёт.

### Ключевая идея: дорожки (lanes)

Дорожка — это пара «заказ + стадия». Внутри дорожки шаги строго последовательны (промт → картинка → коррекция), между дорожками — полностью независимы. Одно понятие закрывает обе задачи: `dog` и `text` одного заказа — это две дорожки, и дорожки разных заказов тоже идут параллельно.

```ts
type LaneStage = "ingest" | "dog" | "text" | "final" | "legacy";
type Lane = { orderId: string; sheetOrderId: string; mode: string; stage: LaneStage; createdAt: Date };
```

### 7.1 Сбор дорожек

Заменить `pickWorkingOrder()` на `collectRunnableLanes(limit): Promise<Lane[]>`:

- выбрать ВСЕ заказы в рабочих статусах (тот же фильтр, что сейчас, но без `.limit(1)`);
- отбросить дорожки, у которых в `studio_lane_state` стоит `nextRetryAt` в будущем (см. 7.4);
- сортировать заказы по `createdAt` по возрастанию — первый пришедший клиент должен и закончить первым;
- какие дорожки даёт заказ:
  - статус `new` / `assets_loaded` и фотографий нет → только `ingest`;
  - режимы `full`/`fair`, статус `in_progress` → `dog`, если `dogStatus ∈ {pending, in_progress}`; `text`, если `textStatus ∈ {pending, in_progress}` (обе сразу — это и есть параллельность внутри заказа);
  - любой режим, статус `text_approved_idle` / `final_in_progress` → `final`;
  - остальные режимы (`dog_only`/`name_only`/`dog_text`) → одна дорожка `legacy` (поведение не меняется);
- вернуть первые `limit` дорожек.

### 7.2 Разбор `resolveNextAutomatedStep`

Функция сейчас совмещает выбор стадии и выбор шага. Разнести на функции по стадиям, не меняя их внутренней логики:

- `resolveDogStepForFull(order)` — уже есть, оставить как есть;
- `resolveTextStepForFull(order)` — уже есть, оставить как есть;
- `resolveFinalStep(order)` — вынести из блока `/* ---- Stage C ---- */` (вместе с правкой FIX-1);
- `resolveIngestStep(order)` — переход `new|assets_loaded → in_progress` и `FETCH_DRIVE_PHOTOS`;
- `resolveLegacyStep(order)` — целиком нынешняя `else`-ветка для непараллельных режимов.

`resolveNextAutomatedStep` больше не нужна как единая точка входа — вместо неё диспетчер `resolveStepForLane(order, stage)`.

### 7.3 Исполнение дорожек

```
runStudioPipelineTick():
  ensureStudioSchema
  acquire global tick lock            // как сейчас
  sync sheet; pollPendingFairPayments; retryUnwrittenFairSheetRows
  heartbeat = setInterval(refreshTickLock, 60_000)     // пока дорожки в работе
  while (Date.now() - started < STUDIO_TICK_BUDGET_MS):
      lanes = await collectRunnableLanes(STUDIO_MAX_CONCURRENT_LANES)
      if (!lanes.length) break
      const results = await Promise.all(lanes.map(runLane))   // ← вот здесь параллельность
      if (results.every(r => r === "noop")) break              // защита от холостого цикла
  clearInterval(heartbeat)
  notifyAwaitingReviews()
```

`runLane(lane)` — захватить дорожку, выполнить ОДИН шаг, отпустить:

1. `claimLock('lane:' + orderId + ':' + stage, STUDIO_LANE_LOCK_MS)` — обобщи существующий `acquireTickLock` в `claimLock(name, ttlMs)` и переиспользуй таблицу `studio_locks` (там ровно нужная форма и уже проверенный атомарный паттерн «insert onConflictDoNothing + условный update с проверкой `rowsAffected`»). Не захватилось → вернуть `"noop"`.
2. Перечитать заказ по id (свежие данные), `resolveStepForLane(order, stage)`.
3. Шага нет → `"noop"`. Шаг есть → `runStudioStep(orderId, step)`, при успехе сбросить состояние дорожки, при ошибке — 7.4.
4. `finally`: отпустить лок дорожки (`lockedUntil = new Date(0)`, как в `releaseTickLock`).

**Никогда не запускай два шага одной дорожки параллельно** — внутри дорожки шаги зависят друг от друга.

### 7.4 Ретраи на уровне дорожки (обязательно)

Сейчас `retryCount` / `nextRetryAt` живут на заказе. При параллельных дорожках одна упавшая генерация клички через `nextRetryAt` заморозит и дорожку собаки, а три неудачи припаркуют весь заказ в `error`. Нужно перенести бухгалтерию ретраев на дорожку.

Новая таблица (drizzle + идентичный DDL в `ensure-schema.ts`):

```
studio_lane_state:
  order_id TEXT NOT NULL
  stage TEXT NOT NULL
  retry_count INTEGER NOT NULL DEFAULT 0
  next_retry_at INTEGER
  last_error TEXT NOT NULL DEFAULT ''
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  PRIMARY KEY (order_id, stage)
```

- при успехе шага — обнулить строку дорожки;
- при ошибке — увеличить `retry_count`, выставить `next_retry_at` по бэкоффу, записать `last_error`, а также продублировать текст в `studio_orders.lastError` (чтобы админка `/studio/orders` по-прежнему всё показывала);
- исчерпаны попытки — НЕ ставить заказу `status='error'` (это убьёт живую соседнюю стадию). Вместо этого оставить дорожку остановленной (`next_retry_at` далеко в будущем) и отправить `sendStudioAlert` с заказом, стадией и ошибкой.
- **Бэкофф зависит от режима.** Нынешние 5/15/60 минут на мероприятии равносильны потере клиента. В `config.ts`:

```ts
export const STUDIO_STEP_RETRY_BACKOFF_SECONDS_FAIR = [15, 45, 120] as const;   // живое мероприятие
export const STUDIO_STEP_RETRY_BACKOFF_MINUTES = [5, 15, 60] as const;         // как было
export const STUDIO_MAX_CONCURRENT_LANES = Number(process.env.STUDIO_MAX_CONCURRENT_LANES) || 4;
export const STUDIO_LANE_LOCK_MS = 300_000;
```
`STUDIO_TICK_BUDGET_MS` поднять до `180_000`, `STUDIO_TICK_LOCK_MS` — до `300_000`.

### 7.5 Одновременная запись в SQLite

Параллельные дорожки пишут в базу одновременно, а клиент libsql создаётся без прагм — возможны `SQLITE_BUSY`. В `doEnsure()` (`ensure-schema.ts`), до выполнения DDL, выполнить:

```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=10000;
```

### 7.6 Гарантия «не перепутать собаку с кличкой»

Перемешивание данных исключается тремя свойствами, которые нужно сохранить и НЕ нарушать:

1. каждый шаг получает `orderId` и сам перечитывает свой заказ, свои фото и свои артефакты — общего изменяемого состояния между дорожками нет;
2. дорожки одного заказа пишут в РАЗНЫЕ колонки (`dog_status`/`dogNotified`/`humanRejectNote` против `text_status`/`textNotified`/`textRejectNote`). Нигде не заменяй точечные `.set({ поле })` на запись всей строки заказа;
3. артефакты лежат по путям `artifacts/<orderId>/<runId>.png` — коллизий между заказами нет.

В комментарии к `runLane` зафиксируй эти три инварианта.

### 7.7 Мгновенный старт после действий владельца

**Файл:** `app/api/telegram/webhook/route.ts`.

Сейчас тик запускается только для callback-ов ручного меню. После нажатия «✅ Одобрить» и после отправленного комментария к доработке тик НЕ запускается — работа ждёт крона, до 3 минут простоя на каждом действии (а их у клиента минимум три). Запускать `kickTick()` после `handleTelegramCallback` и после успешного `handlePendingReviewComment`.

Дополнительно: в `scripts/install-studio-cron.sh` заменить `*/3 * * * *` на `* * * * *` (раз в минуту) — тик дёшев, если работы нет, а простой сокращается втрое.

## Приёмка

1. `npx tsc --noEmit` — чисто. `npm run lint` — не больше ошибок, чем было до правок (в `components/` и `send-emails.js` ошибки существовали ранее, их не чинить).
2. `npx tsx --conditions react-server scripts/studio-mock-e2e.ts` → `E2E MOCK TEST PASSED ✅` (регрессия обычных заказов).
3. `npx tsx --conditions react-server scripts/fair-mock-e2e.ts` → `FAIR E2E MOCK TEST PASSED ✅`.
4. Дополни `scripts/fair-mock-e2e.ts` четырьмя проверками (существующие не ломать):
   - **FIX-1:** после одобрения макета отклонить его с комментарием → следующий тик создаёт успешный `FINAL_IMG_V2_CORRECTION`, а `humanRejectNote` очищается; заказ снова приходит на проверку с НОВЫМ артефактом (`outputArtifactPath` отличается от предыдущего).
   - **FIX-3:** нажать ❌ на dog заказа A, затем ❌ на text того же заказа без комментария → первое отклонение применилось (появился `HUMAN_REJECT_DOG`), владелец уведомлён; затем комментарий применяется ко второму.
   - **FIX-4:** `/start` → `/start` (без фото) не создаёт ни одного `studio_orders`; после фото+клички повторный `/start` отвечает подсказкой текущего шага, а не отказом.
   - **FIX-5:** `/fair` возвращает непустой список, пока заказ активен.
5. Прогон `fair-mock-e2e.ts` дважды подряд должен проходить оба раза (скрипт сам чистит свои данные).
6. **FIX-7** — новый скрипт `scripts/fair-parallel-e2e.ts` (`STUDIO_MOCK_AI=true`), проверки строго детерминированные, без замеров времени:
   - создать три ярмарочные заявки с РАЗНЫМИ кличками («Альфа», «Бета», «Гамма») и разными `chatId`;
   - **параллельность между заказами:** после ОДНОГО вызова `runStudioPipelineTick()` шаги выполнены минимум для двух разных `orderId` (сейчас за тик продвигается только один заказ). Проверять по `studio_step_runs`;
   - **параллельность внутри заказа:** у каждого заказа обе стадии дошли до `awaiting_approval`, при этом дорожки `dog` и `text` собирались в одном проходе (в `detail` тика присутствуют шаги обеих стадий одного `sheetOrderId`);
   - **отсутствие перепутывания:** для каждого заказа все его `studio_step_runs.outputArtifactPath` начинаются с `artifacts/<его orderId>/`, а `petNameRaw` совпадает с `studio_fair_orders.petName` того же `chatId`. Ни один артефакт не встречается у двух заказов;
   - **эксклюзивность дорожек:** два тика, запущенных одновременно (`Promise.all([tick(), tick()])`), не создают для одной пары (`orderId`, `stepKey`) больше успешных запусков, чем при последовательном прогоне;
   - **изоляция ошибок:** искусственно выставить дорожке `text` одного заказа `next_retry_at` в будущее → дорожка `dog` того же заказа продолжает работать, заказ НЕ уходит в `status='error'`;
   - скрипт сам чистит созданные данные, повторный прогон проходит.

## Не трогать

- Внутреннюю логику `resolveDogStepForFull` / `resolveTextStepForFull` — их можно только перемещать и вызывать из дорожек, содержимое менять нельзя (кроме FIX-1 в финальной стадии).
- `run-studio-step.ts` — там всё корректно (кроме случаев, явно названных выше).
- Модель и промты генерации изображений: `lib/studio/ai/*`, `prompt-defaults.ts`, `STUDIO_IMAGE_MODEL`. Качество картинок важнее скорости. Параллельность не должна менять НИ ОДИН промт и не должна сокращать число шагов — только выполнять независимые шаги одновременно.
- Существующие режимы `full` / `dog_only` / `name_only` / `dog_text` — их поведение должно остаться прежним (для непараллельных режимов дорожка одна, `legacy`).
- Пропуск авто-критики для `mode="fair"` — это осознанное решение ради скорости на мероприятии.
- Глобальный лок тика — он остаётся; параллельность добавляется ВНУТРИ тика, а не запуском нескольких тиков.

## Порядок работы

FIX-1 … FIX-6 — небольшие и независимые, делай их первыми и проверяй тестами после каждого. FIX-7 — крупный рефакторинг ядра оркестратора; берись за него только когда пункты 1–5 приёмки зелёные, и веди его отдельным коммитом.

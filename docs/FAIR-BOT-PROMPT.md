# ЗАДАЧА: клиентский Telegram-бот ярмарки + оплата ЮKassa (проект dogood-v2)

## 0. Правила работы

- Сначала прочитай `AGENTS.md`. Это Next.js 16 — перед созданием API-роутов сверься с `node_modules/next/dist/docs/`.
- НЕ трогай публичный сайт, форму заказа (`components/landing/order-form.tsx`), `app/api/order/route.ts`.
- НЕ добавляй npm-зависимости. ЮKassa — через обычный `fetch`, без SDK.
- Схема SQLite меняется ТОЛЬКО в двух местах сразу: `lib/studio/db/schema.ts` (drizzle) и `lib/studio/db/ensure-schema.ts` (сырой DDL + `addColumnIfMissing`). В проде нет drizzle-kit, схема создаётся рантаймом.
- Секреты только из env, ничего не хардкодить. Все сообщения клиенту — по-русски, дружелюбные, с эмодзи.
- Работай этапами 1→8 по порядку. После каждого этапа: `npx tsc --noEmit` без ошибок. Не переходи дальше, пока этап не компилируется.
- Если чего-то не хватает (например, не задан env) — код должен деградировать мягко (лог + понятное сообщение), а не падать.

## 1. Что уже готово — переиспользуй, не переписывай

| Файл | Что там |
|---|---|
| `app/api/telegram/webhook/route.ts` | Вебхук бота владельца. Паттерн: сразу `200 OK`, работа асинхронно после ACK. Копируй этот паттерн. |
| `lib/studio/telegram/manual-flow.ts` | FSM ручного меню + `downloadTelegramFileToOrder()` (скачивание фото Telegram → `data/studio/cache/<orderId>/`). |
| `lib/studio/telegram/review-bot.ts` | Бот владельца: `sendStudioReviewRequest(orderId, stage)`, кнопки approve/reject (`callback_data` = `a\|stage\|sheetOrderId`), `handleTelegramCallback`, `applyApprove`, `applyReject`, `sendStudioAlert`. |
| `lib/studio/pipeline/orchestrator.ts` | `runStudioPipelineTick()`, `resolveFullOrderStep`, `notifyAwaitingReviews`, лок тика, ретраи. |
| `lib/studio/pipeline/human-actions.ts` | `approveDogStage/approveTextStage/approveFinalStage`, `reject*Stage`, `maybeCompleteFullOrder`. |
| `lib/studio/pipeline/run-studio-step.ts` | Все шаги генерации. `FINAL_IMG_V1` уже собирает макет из `tpl.designAbs` + одобренной собаки + одобренной клички. |
| `lib/studio/templates/resolve.ts`, `lib/studio/config.ts` | Шаблоны и папки Drive. Мастер стиля life уже лежит в `data/studio/templates/life/design.png`. |
| `lib/studio/google/upload-artifact.ts` | `uploadBytesToDriveFolder({folderId,fileName,mimeType,bytes})` → `{ok,fileId,webViewLink?}`; `uploadStudioArtifactToFolder(...)`. |
| `lib/ops/sheet-repository.ts`, `lib/ops/sheet-columns.ts` | Доступ к таблице заказов сервис-аккаунтом; `ORDER_SHEET_HEADERS` — порядок колонок. |
| `lib/studio/db/index.ts` | `getStudioDb()`, `schema`. |

## 2. Целевой сценарий (то, что должно получиться)

1. Клиент на мероприятии открывает ВТОРОЙ бот (клиентский, отдельный токен) → `/start`.
2. Бот просит: фото собаки → кличку → email. Выбора стиля НЕТ, всегда `life` («Life is Better»).
3. Создаётся заказ студии, запускается пайплайн: иллюстрация собаки и иллюстрация клички.
4. Владельцу в ЕГО бот приходят по отдельности: иллюстрация собаки и иллюстрация клички, каждая с кнопками «Одобрить» / «На доработку». По «На доработку» бот спрашивает комментарий текстом → комментарий уходит в промт коррекции.
5. Когда обе одобрены — автоматически собирается финальный макет по мастер-референсу и приходит владельцу на такой же апрув с комментарием.
6. По апруву макета клиенту в клиентский бот приходит: картинка макета + дружелюбное сообщение с оффером на футболку (15% прибыли — приюту, если оформить сегодня на мероприятии) + кнопка оплаты ЮKassa.
7. Клиент платит → ЮKassa уведомляет систему → бот пишет «Спасибо за оплату» и собирает: размер, ФИО, телефон, службу доставки (Яндекс/СДЭК), адрес ПВЗ.
8. Всё это одной строкой падает в основную таблицу заказов с пометкой «ЯРМАРКА» и ссылкой на макет.

Решения, которые уже приняты (не переспрашивай, не изобретай альтернатив):

- Стиль всегда `life`, выбора нет.
- Цвет футболки и линия (муж/жен) НЕ спрашиваются. Спрашивается только размер.
- Размер/ФИО/телефон/ПВЗ спрашиваются ПОСЛЕ оплаты.
- Колонка «Приют» в таблице остаётся пустой.
- Один бесплатный макет на один Telegram-аккаунт.
- Оплата — через API ЮKassa (Checkout API), факт оплаты ловится автоматически.

## 3. Этап 1 — схема БД

В `lib/studio/db/schema.ts` добавь таблицу `studioFairOrders` (`studio_fair_orders`) и продублируй DDL в `ensure-schema.ts`:

```
id TEXT PK
order_id TEXT NOT NULL              -- studio_orders.id
chat_id TEXT NOT NULL               -- Telegram chat клиента
step TEXT NOT NULL DEFAULT 'awaiting_photo'
pet_name TEXT DEFAULT ''
email TEXT DEFAULT ''
makeup_url TEXT DEFAULT ''          -- ссылка на макет в Drive
payment_id TEXT DEFAULT ''
payment_status TEXT DEFAULT ''      -- '' | pending | succeeded | canceled
payment_url TEXT DEFAULT ''
amount_rub TEXT DEFAULT ''
size TEXT DEFAULT ''
fio TEXT DEFAULT ''
phone TEXT DEFAULT ''
delivery_service TEXT DEFAULT ''    -- yandex | cdek
pvz TEXT DEFAULT ''
sheet_row_written INTEGER NOT NULL DEFAULT 0
created_at / updated_at INTEGER
```

Индексы по `chat_id`, `order_id`, `payment_id`.

Значения `step`: `awaiting_photo` → `awaiting_pet_name` → `awaiting_email` → `generating` → `awaiting_payment` → `paid_awaiting_size` → `awaiting_fio` → `awaiting_phone` → `awaiting_delivery` → `awaiting_pvz` → `done`.

Режим заказа хранится в существующем поле `studio_orders.mode` значением `"fair"` — новых колонок в `studio_orders` не нужно.

## 4. Этап 2 — клиентский бот: приём заявки

Создай:

- `lib/studio/telegram/client-bot.ts` — низкоуровневые отправки ЧЕРЕЗ ДРУГОЙ ТОКЕН (`TELEGRAM_CLIENT_BOT_TOKEN`): `clientSend(chatId, text, keyboard?)`, `clientSendPhoto(chatId, absPath, caption, keyboard?)`, `clientDownloadFile(fileId)`.
- `lib/studio/telegram/fair-flow.ts` — FSM клиента: `handleFairCommand`, `handleFairText`, `handleFairPhoto`, `handleFairCallback`.
- `app/api/telegram/client-webhook/route.ts` — вебхук клиентского бота. Проверка заголовка `x-telegram-bot-api-secret-token` против `TELEGRAM_CLIENT_WEBHOOK_SECRET`, немедленный `200`, обработка после ACK (точно как в существующем `app/api/telegram/webhook/route.ts`).

Логика приёма:

1. `/start` → если для `chat_id` уже есть строка в `studio_fair_orders` со `step != 'canceled'` → вежливо отказать (лимит 1 макет) и предложить подойти к стенду. Иначе: приветствие + строка про согласие на обработку персональных данных со ссылкой `${NEXT_PUBLIC_SITE_URL}/legal/privacy` + просьба прислать фото.
2. Фото → скачать в заказ (переиспользуй логику `downloadTelegramFileToOrder`, вынеси её в общий хелпер с параметром токена, чтобы работали оба бота) → `step='awaiting_pet_name'`.
3. Текст на шаге `awaiting_pet_name` → сохранить кличку в `studio_orders.pet_name_raw` (+ `pet_name_script` через `inferPetNameScript`), `step='awaiting_email'`.
4. Текст на шаге `awaiting_email` → валидировать email простым regex; сохранить; перевести заказ студии в `status='assets_loaded'`, `step='generating'`; ответить «принято, готовлю макет»; вызвать `runStudioPipelineTick()` без await (как `kickTick()` в существующем вебхуке); уведомить владельца через `sendStudioAlert()`.

Заказ студии создаётся в момент первого фото:

```
sheetOrderId = `fair-${Date.now()}`
mode = "fair", designSlug = "life", status = "draft", customerName = "ярмарка"
```

## 5. Этап 3 — режим `fair` в пайплайне

1. Заведи хелпер `isParallelStageMode(mode) => mode === "full" || mode === "fair"` (положи в `lib/studio/step-keys.ts` или новый `lib/studio/pipeline/modes.ts`) и замени им ВСЕ сравнения `mode === "full"` в `orchestrator.ts`, `human-actions.ts`, `review-bot.ts`. Так `fair` получает параллельные стадии dog/text и авто-переход к финальной композиции, когда обе одобрены.
2. `mode="fair"` НИКОГДА не создаётся синхронизацией из таблицы — `sync-orders-from-sheet.ts` менять не нужно, но проверь это.
3. **Скип авто-критики для скорости.** На мероприятии важны скорость и цена. Для `mode="fair"` в `resolveDogStepForFull`, `resolveTextStepForFull` и в блоке Stage C: если успешная картинка стадии уже есть — сразу ставить стадию в `awaiting_approval`, НЕ запуская `*_LLM_CRITIQUE`. Коррекции запускаются только по комментарию человека.
4. **Важный баг, который надо починить:** шаг `FINAL_IMG_V2_CORRECTION` в `run-studio-step.ts` сейчас требует конверт от `FINAL_LLM_CRITIQUE` и без него падает («Run final critique LLM first»). Добавь в него ветку по `order.humanRejectNote` — точно такую же, как уже сделана в `DOG_IMG_V2_CORRECTION` (взять заметку, очистить поле, прогнать через LLM в корректирующий промт, с фолбэком на саму заметку). Иначе доработка макета по комментарию не заработает.
5. Финальная композиция: усиль дефолтный промт `final_composition_image_prompt` в `lib/studio/prompt-defaults.ts` явными правилами (в БД промт может быть уже переопределён — правь дефолт, редактирование из `/studio/prompts` должно продолжать работать): сохранить композицию мастера один-в-один — верхний текст «Life is Better with», четыре звёздочки, положение/масштаб/пропорции собаки, красный рукописный шрифт клички с росчерком снизу; заменить ТОЛЬКО собаку и кличку; фон белый; без обрезки и без новых элементов; выход — единая печатная иллюстрация.

## 6. Этап 4 — отклонение с комментарием в боте владельца

Сейчас «На доработку» сразу запускает перегенерацию с общей заметкой, а комментарий можно дать только командой `/reject_<stage>_<orderId> текст`. Сделай нормальный UX:

1. Новая таблица `studio_review_pending` (`chat_id` PK, `stage`, `sheet_order_id`, `updated_at`) — отдельно от `studio_tg_sessions`, чтобы не конфликтовать с ручным меню.
2. Нажатие «На доработку» → НЕ отклонять сразу. Записать pending, ответить: «Напишите комментарий одним сообщением — что поправить. Или нажмите «Без комментария».» + инлайн-кнопка `rj:none`.
3. Следующее текстовое сообщение из этого чата → если есть pending, вызвать `applyReject(stage, sheetOrderId, текст)`, очистить pending, подтвердить «Принято, перегенерирую». Эта проверка должна идти В `processUpdate` РАНЬШЕ вызова `handleManualText`, иначе комментарий съест ручное меню.
4. Кнопка `rj:none` → `applyReject(..., "")` (там уже есть `GENERIC_REJECT_NOTE`).
5. В заголовок сообщения ревью (`sendStudioReviewRequest`) для `mode="fair"` добавь строку «ЯРМАРКА • клиент: <email> • кличка: <кличка>».

## 7. Этап 5 — выдача макета клиенту + оффер + счёт ЮKassa

Хук на одобрение финала. В `approveFinalStage` (или сразу после него в `review-bot.applyApprove`) для `mode="fair"`:

1. Загрузить макет в Drive (`uploadBytesToDriveFolder` в папку `approved`), сохранить `makeup_url = https://drive.google.com/file/d/<fileId>/view`.
2. Создать платёж ЮKassa (см. этап 6), сохранить `payment_id`, `payment_url`, `payment_status='pending'`, `step='awaiting_payment'`.
3. Отправить клиенту фото макета + текст оффера + инлайн-кнопку с `url: payment_url`.

Текст клиенту (используй ровно этот, можно с минимальной правкой):

```
🎉 Готово! Вот ваш макет с <Кличка> — забирайте, он ваш.

Понравился? Можем напечатать его на футболке 👕
Оформите сегодня на мероприятии — и 15% прибыли уйдёт в приют 🐾

Цена — <N> ₽, доставка Яндексом или СДЭК оплачивается при получении.
Жмите кнопку ниже, это займёт минуту 💛
```

## 8. Этап 6 — ЮKassa

Новый файл `lib/payments/yookassa.ts` (без SDK, через `fetch`):

- `isYookassaEnabled()` — есть `YOOKASSA_SHOP_ID` + `YOOKASSA_SECRET_KEY` и `YOOKASSA_ENABLED === "true"`.
- `createPayment({amountRub, description, metadata, email})`:
  `POST https://api.yookassa.ru/v3/payments`
  заголовки: `Authorization: Basic base64(shopId:secretKey)`, `Idempotence-Key: <randomUUID()>`, `Content-Type: application/json`
  тело: `{ amount:{value:"2500.00",currency:"RUB"}, capture:true, confirmation:{type:"redirect",return_url}, description, metadata:{fairOrderId} }`
  `return_url` = `https://t.me/${TELEGRAM_CLIENT_BOT_USERNAME}`.
  Если `FAIR_SEND_RECEIPT === "true"` — добавь объект `receipt`: `{customer:{email}, items:[{description, quantity:"1.00", amount:{...}, vat_code: Number(FAIR_VAT_CODE ?? 1), payment_mode:"full_prepayment", payment_subject:"commodity"}]}`.
  Ответ: `{id, status, confirmation:{confirmation_url}}`.
- `getPayment(id)` — `GET https://api.yookassa.ru/v3/payments/{id}` с тем же Basic-auth.

Новый роут `app/api/payments/yookassa/webhook/route.ts`:

- Принять JSON `{event, object:{id}}`, СРАЗУ ответить `200` (ЮKassa ретраит на таймауты).
- Телу уведомления НЕ доверять: перезапросить платёж через `getPayment(object.id)` и смотреть на реальный `status`.
- Если `succeeded` и платёж ещё не обработан (`payment_status !== 'succeeded'`) — вызвать общую функцию `onFairPaymentSucceeded(fairOrderId)` (идемпотентно!).

Фолбэк-поллинг (обязателен — вебхук может быть не зарегистрирован или не дойти):

- Функция `pollPendingFairPayments()`: все `studio_fair_orders` с `payment_status='pending'` и `updated_at` за последние 6 часов → `getPayment` → при `succeeded` вызвать ту же `onFairPaymentSucceeded`.
- Дёргать её в начале `runStudioPipelineTick()` (крон уже настроен, см. `scripts/install-studio-cron.sh`).

`onFairPaymentSucceeded`: пометить `payment_status='succeeded'`, `step='paid_awaiting_size'`, написать клиенту благодарность и запросить размер, уведомить владельца через `sendStudioAlert`.

## 9. Этап 7 — анкета после оплаты и строка в таблицу

Шаги FSM (каждый ответ сохраняется в `studio_fair_orders`, следующий вопрос — сразу):

1. `paid_awaiting_size` → инлайн-кнопки XS / S / M / L / XL / XXL (`callback_data` = `fs:<size>`).
2. `awaiting_fio` → «Напишите ФИО получателя полностью».
3. `awaiting_phone` → телефон; валидировать (только цифры/+/пробелы/скобки, ≥10 цифр), при ошибке переспросить.
4. `awaiting_delivery` → кнопки «Яндекс Доставка» (`fd:yandex`) / «СДЭК» (`fd:cdek`); в тексте дать ссылки на карты ПВЗ: `https://dostavka.yandex.ru/pickup-point/` и `https://www.cdek.ru/ru/offices/`.
5. `awaiting_pvz` → «Пришлите адрес пункта выдачи одним сообщением».
6. → записать строку в таблицу, `step='done'`, поблагодарить клиента, уведомить владельца полным составом заказа.

Запись в таблицу. Добавь в `lib/ops/sheet-repository.ts` функцию `appendOrderRow(values: Record<string,string>)`: собрать массив по порядку `ORDER_SHEET_HEADERS` и `spreadsheets.values.append` (range `'<tab>'!A1`, `valueInputOption:"USER_ENTERED"`, `insertDataOption:"INSERT_ROWS"`). Маппинг для ярмарки:

| Колонка | Значение |
|---|---|
| Время | текущее время, `ru-RU` |
| Order ID | тот же `sheetOrderId` (`fair-…`) |
| Имя | ФИО |
| Email | email клиента |
| Телефон | телефон |
| Приют | **пусто** |
| Адрес | `Яндекс Доставка, ПВЗ: <адрес>` (или СДЭК) |
| Доставка | `yandex` / `cdek` |
| Футболки | `Кличка: <имя> \| Размер: <size> \| Стиль: Life is better` |
| Комментарий | `ЯРМАРКА • оплата ЮKassa <paymentId> • макет: <makeup_url>` |
| Папка с фото | **пусто (критично)** |
| Кол-во файлов | **пусто (критично)** |
| style_id | `life` |
| status | `APPROVED` |
| generated_image_url, approved_image_url | `<makeup_url>` |
| dog_photo_urls | ссылки на фото клиента в Drive (или пусто) |

«Папка с фото» и «Кол-во файлов» ОБЯЗАТЕЛЬНО пустые: иначе `isProcessableSheetRow` в `lib/studio/google/sync-orders-from-sheet.ts` подхватит строку и запустит генерацию заново.

Запись должна быть идемпотентной: перед append проверь `sheet_row_written`, после успеха — выставь `1`.

## 10. Этап 8 — скрипты, env и документация

- Расширь `scripts/telegram-set-webhook.mjs`: аргумент `--client` ставит вебхук второму боту на `/api/telegram/client-webhook` с его секретом.
- Добавь в `scripts/` мок-прогон `fair-mock-e2e.ts` по образцу `scripts/studio-mock-e2e.ts`: при `STUDIO_MOCK_AI=true` эмулирует апдейты Telegram (фото → кличка → email), прогоняет тик, эмулирует апрувы владельца, эмулирует `payment.succeeded`, эмулирует анкету и проверяет, что строка сформирована. Без реальных обращений к Telegram/ЮKassa/Sheets (мокай на уровне функций или ставь флаг «dry-run»).
- Обнови `.env.example` и напиши `docs/FAIR-BOT-SETUP.md`: создать бота у BotFather, прописать env, поставить вебхуки, зарегистрировать HTTP-уведомления в личном кабинете ЮKassa на `${OPS_PUBLIC_BASE_URL}/api/payments/yookassa/webhook` (события `payment.succeeded`, `payment.canceled`), сделать прогон.

Новые env (в `.env.example` c комментариями):

```
TELEGRAM_CLIENT_BOT_TOKEN=       # второй бот, для клиентов
TELEGRAM_CLIENT_BOT_USERNAME=    # без @, для return_url
TELEGRAM_CLIENT_WEBHOOK_SECRET=
FAIR_TSHIRT_PRICE_RUB=           # цена футболки на ярмарке, например 2500
FAIR_SEND_RECEIPT=false          # true — передавать чек 54-ФЗ в ЮKassa
FAIR_VAT_CODE=1                  # ставка НДС для чека
FAIR_ENABLED=true                # общий рубильник клиентского бота
```

Существующие и уже заведённые: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `YOOKASSA_ENABLED`, `OPS_PUBLIC_BASE_URL`, `NEXT_PUBLIC_SITE_URL`.

## 11. Критерии приёмки

1. `npx tsc --noEmit` и `npm run lint` — чисто.
2. `STUDIO_MOCK_AI=true npx tsx scripts/fair-mock-e2e.ts` проходит весь путь: заявка → две стадии на апрув → отклонение с комментарием ставит коррекцию в очередь → апрувы → финальный макет → апрув → оффер со ссылкой оплаты → «оплата» → анкета → сформированная строка таблицы с пометкой ЯРМАРКА и пустыми «Папка с фото»/«Кол-во файлов».
3. Повторный `/start` с того же `chat_id` даёт вежливый отказ (лимит 1 макет).
4. Повторный вебхук ЮKassa по тому же платежу не создаёт вторую строку и не шлёт второе сообщение.
5. Оба бота живут независимо: сообщения клиентского бота не попадают в ручное меню владельца и наоборот.
6. Ничего не сломано в существующем потоке: заказы `mode="full"` из таблицы и ручное меню `/menu` работают как раньше.

## 12. Чего НЕ делать

- Не менять публичный сайт, форму заказа и Apps Script без крайней необходимости.
- Не слать деньги/чеки в обход env-флагов; при `YOOKASSA_ENABLED != "true"` — только сообщение «оплата временно недоступна».
- Не запускать реальные генерации при тестах (только `STUDIO_MOCK_AI=true`).
- Не хранить токены/ключи в коде, логах и сообщениях.
- Не добавлять выбор стиля, цвета футболки и линии муж/жен в клиентский бот.

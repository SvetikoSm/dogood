/**
 * Google Apps Script — приём заявок с сайта DoGood (Next.js → JSON).
 *
 * --- Что это даёт (простыми словами) ---
 * Сайт после заказа шлёт сюда данные + фото. Скрипт: пишет строку в Google Таблицу
 * и складывает фотографии в папку на вашем Google Диске (отдельная подпапка на каждый заказ).
 *
 * --- Про права «все файлы Диска / все таблицы» ---
 * Google показывает так из‑за СЕРВИСОВ Apps Script (SpreadsheetApp, DriveApp): в списке разрешений
 * всегда формулировка «на весь Диск / на все таблицы», даже если ваш код трогает только два id.
 * Этот файл делает только: открыть таблицу по SHEET_ID, открыть папку по FOLDER_ID, создать внутри
 * подпапку заказа и файлы, дописать строку. Он НЕ сканирует весь Диск и НЕ перебирает таблицы —
 * но технически у вызванных API такой уровень доступа, поэтому текст экрана согласия широкий.
 * Если такие формулировки принципиально не подходят, альтернатива без OAuth на вашу личную учётку:
 * сервисный аккаунт Google Cloud + вы вручную даёте ему доступ только к одной таблице и одной папке
 * («Поделиться» с email вида ...@....iam.gserviceaccount.com), а сайт пишет в Google через API с ключом
 * сервисного аккаунта (это уже другая схема, не этот .gs файл).
 *
 * --- Что сделать вам (по шагам) ---
 *
 * 1) Таблица и папка
 *    - Создайте новую Google Таблицу (docs.google.com/spreadsheets) — туда будут строки заявок.
 *    - Создайте на Google Диске пустую папку — туда скрипт будет класть фото по заказам.
 *
 * 2) Apps Script и этот код
 *    - Откройте script.google.com → «Новый проект».
 *    - Удалите шаблонный код, вставьте весь файл google-apps-script-order-webapp.gs из репозитория.
 *    - Сохраните проект (Ctrl+S), дайте имя, например «DoGood заказы».
 *
 * 3) Script properties (секреты и id)
 *    Слева: ⚙ Project Settings → внизу «Script properties» → Add row. Нужны ТРИ свойства:
 *
 *    WEBHOOK_SECRET
 *      Любая длинная случайная строка (как пароль). Её же потом впишете на сайт в .env.local —
 *      сайт будет слать её в каждом запросе, скрипт сравнит: если не совпало — отклонит.
 *
 *    SHEET_ID
 *      Id таблицы из адреса в браузере. Ссылка вида:
 *      https://docs.google.com/spreadsheets/d/ВОТ_ЭТОТ_КУСОК/edit
 *      Скопируйте только среднюю часть между /d/ и /edit.
 *
 *    FOLDER_ID
 *      Id папки на Диске. Откройте папку в браузере — в адресе будет .../folders/ВОТ_ID
 *      или в конце URL после id= — скопируйте этот id.
 *
 * 4) Публикация как «веб-приложение»
 *    - Кнопка Deploy → New deployment.
 *    - Тип: выберите «Web app» (веб-приложение).
 *    - Execute as: Me (от вашего имени).
 *    - Who has access: чаще всего «Anyone» (любой с ссылкой) — тогда обязательно держите
 *      WEBHOOK_SECRET сложным; либо ограничьте доступ, если знаете, что делаете.
 *    - Deploy → скопируйте «Web app URL» — это длинная ссылка вида https://script.google.com/...
 *
 * 5) Сайт (локально или на хостинге)
 *    - В корне проекта создайте файл .env.local (его обычно не коммитят).
 *    - Скопируйте строки из .env.example и заполните:
 *        GOOGLE_ORDER_WEBHOOK_URL = URL из шага 4
 *        GOOGLE_ORDER_WEBHOOK_SECRET = тот же текст, что WEBHOOK_SECRET в Script properties
 *    - Перезапустите `npm run dev` или заново задеплойте сайт, чтобы подтянулись переменные.
 *
 * Первая строка листа (заголовки колонок) создаётся автоматически при первом запуске, если лист был пустой.
 */
function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var secretExpected = props.getProperty("WEBHOOK_SECRET");
  var sheetId = props.getProperty("SHEET_ID");
  var folderId = props.getProperty("FOLDER_ID");

  try {
    var body = JSON.parse(e.postData.contents);
    if (!body.secret || body.secret !== secretExpected) {
      return jsonResponse({ ok: false, error: "unauthorized" });
    }
    if (!sheetId || !folderId) {
      return jsonResponse({ ok: false, error: "missing SHEET_ID or FOLDER_ID" });
    }

    var order = body.order;
    var files = body.files || [];

    var rootFolder = DriveApp.getFolderById(folderId);
    var orderFolder = rootFolder.createFolder(order.orderId || "order");

    var fileLinks = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var bytes = Utilities.base64Decode(f.dataBase64);
      var blob = Utilities.newBlob(bytes, f.mimeType || "image/jpeg", f.originalName || "photo.jpg");
      var driveFile = orderFolder.createFile(blob);
      fileLinks.push(driveFile.getUrl());
    }

    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    ensureHeaderRow(sheet);

    var itemsSummary = "";
    if (order.items && order.items.length) {
      itemsSummary = order.items
        .map(function (it, idx) {
          return (
            "#" +
            (idx + 1) +
            ": " +
            (it.dogName || "") +
            " / " +
            (it.printStyleLabel || it.printStyle || "") +
            (it.sameAsPrevious ? " (как предыдущая)" : "")
          );
        })
        .join("\n");
    }

    sheet.appendRow([
      new Date(),
      order.orderId || "",
      order.customer ? order.customer.name : "",
      order.customer ? order.customer.email : "",
      order.customer ? order.customer.phone : "",
      order.shelter ? order.shelter.name : "",
      order.delivery ? order.delivery.address : "",
      order.delivery ? order.delivery.methodLabel : "",
      itemsSummary,
      order.comment || "",
      orderFolder.getUrl(),
      fileLinks.length,
    ]);

    return jsonResponse({ ok: true, folderUrl: orderFolder.getUrl(), fileCount: fileLinks.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ensureHeaderRow(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol > 0) return;
  sheet.appendRow([
    "Время",
    "Order ID",
    "Имя",
    "Email",
    "Телефон",
    "Приют",
    "Адрес",
    "Доставка",
    "Футболки",
    "Комментарий",
    "Папка с фото",
    "Кол-во файлов",
  ]);
}

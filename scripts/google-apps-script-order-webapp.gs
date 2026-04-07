/**
 * Google Apps Script — приём заявок с сайта DoGood (Next.js → JSON).
 *
 * Сайт шлёт сюда `order` + `files` (см. `lib/forward-order-to-google.ts`, `lib/save-order-submission.ts`).
 * Скрипт пишет строку в Google Таблицу и складывает фото в подпапку на Диске.
 *
 * Если в таблице уже есть старые заголовки (меньше колонок), новые названия дописываются в первую строку
 * справа — не удаляйте вручную старые колонки, чтобы не сбить порядок.
 *
 * Script properties: WEBHOOK_SECRET, SHEET_ID, FOLDER_ID (как в комментариях ниже).
 *
 * --- Про права «все файлы Диска / все таблицы» ---
 * Google показывает так из‑за СЕРВИСОВ Apps Script (SpreadsheetApp, DriveApp). Этот код открывает
 * только таблицу по SHEET_ID и папку по FOLDER_ID.
 *
 * --- Что сделать вам (по шагам) ---
 *
 * 1) Таблица и папка на Диске.
 * 2) script.google.com → новый проект → вставить этот файл целиком.
 * 3) Project Settings → Script properties: WEBHOOK_SECRET, SHEET_ID, FOLDER_ID.
 * 4) Deploy → Web app → скопировать URL в GOOGLE_ORDER_WEBHOOK_URL на сайте.
 * 5) .env.local: GOOGLE_ORDER_WEBHOOK_SECRET = тот же секрет, что WEBHOOK_SECRET.
 */
var ORDER_SHEET_HEADERS = [
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
  "Цвет футболки (1-я поз.)",
  "Стиль (id, 1-я)",
  "Цвет принта",
  "Пол / размер (1-я)",
  "Согласие ПДн",
  "Согласие оферта",
  "Ссылки на фото",
];

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

    /* files может быть пустым — строка в таблице и папка на Диске всё равно создаются */
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
          var parts = [
            "#" + (idx + 1),
            it.dogName || "",
            it.printStyleLabel || it.printStyle || "",
            (it.gender || "-") + "/" + (it.size || "-"),
            "футболка:" + (it.color || ""),
          ];
          if (it.printColor) parts.push("принт:" + it.printColor);
          if (it.sameAsPrevious) parts.push("(как предыдущая)");
          return parts.join(" | ");
        })
        .join("\n");
    }

    var firstIt = order.items && order.items[0];
    var shirtColor = firstIt && firstIt.color ? firstIt.color : "";
    var styleId = firstIt && firstIt.printStyle ? firstIt.printStyle : "";
    var printColor = firstIt && firstIt.printColor ? firstIt.printColor : "";
    var genderSize =
      firstIt && (firstIt.gender || firstIt.size)
        ? (firstIt.gender || "") + "/" + (firstIt.size || "")
        : "";

    var legal = order.legal || {};

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
      shirtColor,
      styleId,
      printColor,
      genderSize,
      legal.consentPersonalData ? "yes" : "no",
      legal.consentTerms ? "yes" : "no",
      fileLinks.join(","),
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
  if (lastCol === 0) {
    sheet.appendRow(ORDER_SHEET_HEADERS);
    return;
  }
  var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (ORDER_SHEET_HEADERS.length > existing.length) {
    var start = existing.length;
    var slice = ORDER_SHEET_HEADERS.slice(start);
    sheet.getRange(1, start + 1, 1, slice.length).setValues([slice]);
  }
}

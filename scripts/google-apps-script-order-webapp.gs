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
  "Позиция",
  "Имя",
  "Email",
  "Телефон",
  "Приют",
  "Адрес",
  "Доставка",
  "Кличка",
  "Стиль",
  "Цвет футболки",
  "Цвет принта",
  "Пол / размер",
  "Как предыдущая",
  "Сводка по всем позициям",
  "Комментарий",
  "Папка с фото",
  "Кол-во файлов",
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

    var itemLinksMap = {};
    var fileLinks = [];
    function parseItemIndex(field) {
      var m = String(field || "").match(/^items\[(\d+)\]\[photos\]$/);
      return m ? Number(m[1]) : null;
    }

    // Сначала только Таблица — без DriveApp. Так заказ не теряется, если Drive временно недоступен.
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

    var legal = order.legal || {};
    var items = order.items && order.items.length ? order.items : [null];
    for (var itemRow = 0; itemRow < items.length; itemRow++) {
      var it = items[itemRow];
      var isFirst = itemRow === 0;
      var orderRef = isFirst
        ? (order.orderId || "")
        : ("add-on to " + (order.orderId || ""));
      var positionLabel = it ? "#" + (itemRow + 1) : "#1";
      var genderSize =
        it && (it.gender || it.size)
          ? (it.gender || "") + "/" + (it.size || "")
          : "";

      sheet.appendRow([
        new Date(),
        orderRef,
        positionLabel,
        isFirst && order.customer ? order.customer.name : "",
        isFirst && order.customer ? order.customer.email : "",
        isFirst && order.customer ? order.customer.phone : "",
        isFirst && order.shelter ? order.shelter.name : "",
        isFirst && order.delivery ? order.delivery.address : "",
        isFirst && order.delivery ? order.delivery.methodLabel : "",
        it && it.dogName ? it.dogName : "",
        it ? (it.printStyleLabel || it.printStyle || "") : "",
        it && it.color ? it.color : "",
        it && it.printColor ? it.printColor : "",
        genderSize,
        it && it.sameAsPrevious ? "yes" : "no",
        isFirst ? itemsSummary : "",
        isFirst ? (order.comment || "") : "",
        "",
        0,
        isFirst ? (legal.consentPersonalData ? "yes" : "no") : "",
        isFirst ? (legal.consentTerms ? "yes" : "no") : "",
        "",
      ]);
    }

    var firstDataRow = sheet.getLastRow() - items.length + 1;
    var COL_FOLDER = 18;
    var COL_FILECOUNT = 19;
    var COL_LINKS = 22;

    var orderFolder = null;
    var driveError = null;

    try {
      var rootFolder = DriveApp.getFolderById(folderId);
      orderFolder = rootFolder.createFolder(order.orderId || "order");
      orderFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      for (var fi = 0; fi < files.length; fi++) {
        var f = files[fi];
        var bytes = Utilities.base64Decode(f.dataBase64);
        var blob = Utilities.newBlob(bytes, f.mimeType || "image/jpeg", f.originalName || "photo.jpg");
        var driveFile = orderFolder.createFile(blob);
        driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var viewUrl = drivePublicViewUrl(driveFile.getId());
        fileLinks.push(viewUrl);

        var itemIndex = parseItemIndex(f.field);
        var mapKey = itemIndex === null ? "_unmapped" : String(itemIndex);
        if (!itemLinksMap[mapKey]) itemLinksMap[mapKey] = [];
        itemLinksMap[mapKey].push(viewUrl);
      }

      if (orderFolder) {
        sheet.getRange(firstDataRow, COL_FOLDER).setValue(orderFolder.getUrl());
      }

      for (var ur = 0; ur < items.length; ur++) {
        var it2 = items[ur];
        var rowNum = firstDataRow + ur;
        var linksForRow =
          it2 && itemLinksMap[String(it2.lineIndex)]
            ? itemLinksMap[String(it2.lineIndex)].join(",")
            : "";
        var cnt =
          it2 && itemLinksMap[String(it2.lineIndex)]
            ? itemLinksMap[String(it2.lineIndex)].length
            : 0;
        sheet.getRange(rowNum, COL_FILECOUNT).setValue(cnt);
        sheet.getRange(rowNum, COL_LINKS).setValue(linksForRow);
      }
    } catch (driveErr) {
      driveError = String(driveErr);
    }

    return jsonResponse({
      ok: true,
      folderUrl: orderFolder ? orderFolder.getUrl() : "",
      fileCount: fileLinks.length,
      driveError: driveError,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function drivePublicViewUrl(fileId) {
  return "https://drive.google.com/uc?export=view&id=" + encodeURIComponent(fileId);
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

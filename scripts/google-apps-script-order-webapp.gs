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
 *
 * --- Дубликаты в таблице ---
 * Сайт при сбое первого POST может отправить второй (fallback без файлов). Без проверки
 * заказ дважды дописался бы в лист. Если в колонке «Order ID» уже есть этот orderId,
 * повторный вызов без файлов ничего не пишет (duplicateSkipped). Если пришли файлы —
 * догружаем их в папку заказа из колонки «Папка с фото» (или создаём папку заново).
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

    var orderIdKey = String(order.orderId || "").trim();
    var existingFirstRow = orderIdKey ? findFirstDataRowWithOrderId_(sheet, orderIdKey) : -1;
    if (existingFirstRow !== -1) {
      if (!files.length) {
        return jsonResponse({
          ok: true,
          duplicateSkipped: true,
          folderUrl: "",
          fileCount: 0,
          filesReceived: 0,
          uploadErrors: [],
          driveError: null,
        });
      }
      return mergePhotosIntoExistingOrder_(sheet, existingFirstRow, order, files, folderId);
    }

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
    var uploadErrors = [];

    try {
      var rootFolder = DriveApp.getFolderById(folderId);
      orderFolder = rootFolder.createFolder(order.orderId || "order");
      orderFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      // Каждый файл отдельно: если один битый (base64/HEIC/лимит), остальные всё равно загрузятся.
      for (var fi = 0; fi < files.length; fi++) {
        var f = files[fi];
        try {
          if (!f || !f.dataBase64 || String(f.dataBase64).length === 0) {
            uploadErrors.push({
              field: f && f.field ? f.field : String(fi),
              error: "empty dataBase64",
            });
            continue;
          }
          var bytes = decodeWebhookFileBytes_(f.dataBase64);
          if (!bytes || bytes.length === 0) {
            uploadErrors.push({
              field: f.field || String(fi),
              error: "base64 decode yielded empty bytes",
            });
            continue;
          }
          var mime = f.mimeType || "image/jpeg";
          var name = safeDriveFileName_(f.originalName || "photo.jpg");
          var blob = Utilities.newBlob(bytes, mime, name);
          var driveFile = orderFolder.createFile(blob);
          driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          var viewUrl = drivePublicViewUrl(driveFile.getId());
          fileLinks.push(viewUrl);

          var itemIndex = parseItemIndex(f.field);
          var mapKey = itemIndex === null ? "_unmapped" : String(itemIndex);
          if (!itemLinksMap[mapKey]) itemLinksMap[mapKey] = [];
          itemLinksMap[mapKey].push(viewUrl);
        } catch (oneFileErr) {
          uploadErrors.push({
            field: f && f.field ? f.field : String(fi),
            error: String(oneFileErr),
          });
        }
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
      filesReceived: files.length,
      uploadErrors: uploadErrors,
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

/** Убирает префикс data:image/...;base64, и пробелы — иначе decode падает или даёт пусто. */
function decodeWebhookFileBytes_(dataBase64) {
  var s = String(dataBase64 || "").trim();
  if (!s) return null;
  var dataIdx = s.indexOf("base64,");
  if (s.indexOf("data:") === 0 && dataIdx !== -1) {
    s = s.substring(dataIdx + 7);
  }
  s = s.replace(/\s/g, "");
  if (!s.length) return null;
  return Utilities.base64Decode(s);
}

function safeDriveFileName_(originalName) {
  var n = String(originalName || "photo.jpg").replace(/[^\w.\-()]/g, "_");
  if (n.length > 120) n = n.slice(-120);
  return n || "photo.jpg";
}

function extractDriveFolderIdFromUrl_(input) {
  var u = String(input || "").trim();
  if (!u) return "";
  var m = u.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return m[1];
  var m2 = u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2 && m2[1]) return m2[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(u)) return u;
  return "";
}

function parsePhotoFieldLineIndex_(field) {
  var m = String(field || "").match(/^items\[(\d+)\]\[photos\]$/);
  return m ? Number(m[1]) : null;
}

/**
 * Заказ уже есть в листе; пришли файлы (повторный POST с фото) — догружаем в папку,
 * суммируем счётчики и ссылки в строках позиций.
 */
function mergePhotosIntoExistingOrder_(sheet, firstDataRow, order, files, parentFolderId) {
  var COL_FOLDER = 18;
  var COL_FILECOUNT = 19;
  var COL_LINKS = 22;

  var items = order.items && order.items.length ? order.items : [null];
  var itemLinksMap = {};
  var fileLinks = [];
  var uploadErrors = [];
  var driveError = null;
  var orderFolder = null;

  try {
    var folderUrlCell = String(sheet.getRange(firstDataRow, COL_FOLDER).getValue() || "").trim();
    var fid = extractDriveFolderIdFromUrl_(folderUrlCell);
    if (fid) {
      orderFolder = DriveApp.getFolderById(fid);
    } else {
      var rootFolder = DriveApp.getFolderById(parentFolderId);
      orderFolder = rootFolder.createFolder(order.orderId || "order");
      orderFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      sheet.getRange(firstDataRow, COL_FOLDER).setValue(orderFolder.getUrl());
    }

    for (var fi = 0; fi < files.length; fi++) {
      var f = files[fi];
      try {
        if (!f || !f.dataBase64 || String(f.dataBase64).length === 0) {
          uploadErrors.push({
            field: f && f.field ? f.field : String(fi),
            error: "empty dataBase64",
          });
          continue;
        }
        var bytes = decodeWebhookFileBytes_(f.dataBase64);
        if (!bytes || bytes.length === 0) {
          uploadErrors.push({
            field: f.field || String(fi),
            error: "base64 decode yielded empty bytes",
          });
          continue;
        }
        var mime = f.mimeType || "image/jpeg";
        var name = safeDriveFileName_(f.originalName || "photo.jpg");
        var blob = Utilities.newBlob(bytes, mime, name);
        var driveFile = orderFolder.createFile(blob);
        driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var viewUrl = drivePublicViewUrl(driveFile.getId());
        fileLinks.push(viewUrl);
        var itemIndex = parsePhotoFieldLineIndex_(f.field);
        var mapKey = itemIndex === null ? "_unmapped" : String(itemIndex);
        if (!itemLinksMap[mapKey]) itemLinksMap[mapKey] = [];
        itemLinksMap[mapKey].push(viewUrl);
      } catch (oneFileErr) {
        uploadErrors.push({
          field: f && f.field ? f.field : String(fi),
          error: String(oneFileErr),
        });
      }
    }

    for (var ur = 0; ur < items.length; ur++) {
      var it2 = items[ur];
      var rowNum = firstDataRow + ur;
      var newLinksArr =
        it2 && itemLinksMap[String(it2.lineIndex)] ? itemLinksMap[String(it2.lineIndex)] : [];
      var newCnt = newLinksArr.length;
      if (newCnt === 0) continue;
      var prevCnt = Number(sheet.getRange(rowNum, COL_FILECOUNT).getValue()) || 0;
      var prevLinks = String(sheet.getRange(rowNum, COL_LINKS).getValue() || "").trim();
      var addLinks = newLinksArr.join(",");
      var combined = prevLinks ? prevLinks + "," + addLinks : addLinks;
      sheet.getRange(rowNum, COL_FILECOUNT).setValue(prevCnt + newCnt);
      sheet.getRange(rowNum, COL_LINKS).setValue(combined);
    }
  } catch (e) {
    driveError = String(e);
  }

  return jsonResponse({
    ok: true,
    duplicatePhotoMerge: true,
    folderUrl: orderFolder ? orderFolder.getUrl() : "",
    fileCount: fileLinks.length,
    filesReceived: files.length,
    uploadErrors: uploadErrors,
    driveError: driveError,
  });
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

/** Колонка B = «Order ID» (первая строка заказа совпадает с order.orderId). */
function findFirstDataRowWithOrderId_(sheet, orderId) {
  var id = String(orderId || "").trim();
  if (!id) return -1;
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var colOrderId = 2;
  var vals = sheet.getRange(2, colOrderId, last, colOrderId).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || "").trim() === id) return i + 2;
  }
  return -1;
}

/**
 * Google Apps Script — приём заявок с сайта DoGood (Next.js → JSON).
 *
 * Сайт шлёт сюда `order` + `files` (см. `lib/forward-order-to-google.ts`).
 * Скрипт пишет строку в Google Таблицу и складывает фото в подпапку на Диске.
 *
 * ВАЖНО (2026-07): запись в таблицу теперь идёт ПО НАЗВАНИЯМ КОЛОНОК, а не по
 * фиксированным номерам. Раньше номера были жёстко зашиты (папка = 18),
 * и если в таблице вручную добавляли/двигали колонки, ссылка на папку падала
 * не в ту ячейку. Теперь скрипт читает строку заголовков и кладёт каждое поле
 * в колонку с нужным заголовком — порядок колонок в таблице можно менять.
 *
 * Проверка перед боевым запуском: в редакторе выберите функцию `studioSelfTest`
 * и нажмите Run — в логах (View → Logs) будет карта «поле → колонка».
 * Убедитесь, что «Промокод» → P(16), «Папка с фото» → Q(17) и т.д.
 *
 * Script properties: WEBHOOK_SECRET, SHEET_ID, FOLDER_ID.
 */

/** Заголовки для СОВСЕМ пустой таблицы (иначе существующие не трогаем). */
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
  "Промокод",
  "Папка с фото",
  "Кол-во файлов",
  "Сводка по всем позициям",
  "Комментарий",
  "Согласие ПДн",
  "Согласие оферта",
  "Ссылки на фото",
];

/** Каноническое поле → возможные названия колонки (сравнение без регистра/пробелов). */
var FIELD_SYNONYMS = {
  time: ["Время"],
  orderId: ["Order ID", "OrderID", "ID заказа", "Номер заказа"],
  position: ["Позиция"],
  name: ["Имя"],
  email: ["Email", "E-mail", "Почта"],
  phone: ["Телефон", "Тел"],
  shelter: ["Приют"],
  address: ["Адрес"],
  delivery: ["Доставка"],
  dogName: ["Кличка"],
  style: ["Стиль"],
  shirtColor: ["Цвет футболки"],
  printColor: ["Цвет принта"],
  genderSize: ["Пол / размер", "Пол/размер", "Пол размер"],
  sameAsPrev: ["Как предыдущая"],
  promo: ["Промокод", "Промо-код", "Промо код", "Promo code", "Promo"],
  summary: ["Сводка по всем позициям", "Сводка"],
  comment: ["Комментарий", "Коммент"],
  folder: ["Папка с фото", "Папка с фото заказа"],
  fileCount: ["Кол-во файлов", "Количество файлов", "Кол во файлов", "Число файлов"],
  consentPdn: ["Согласие ПДн", "Согласие ПДн."],
  consentOferta: ["Согласие оферта", "Согласие оферты"],
  links: ["Ссылки на фото", "Ссылка на фото", "Ссылки"],
};

/** Промокод, если колонка не найдена по заголовку, кладём в P(16) — по указанию владельца. */
var PROMO_FALLBACK_COL = 16;

function normalizeHeader_(h) {
  return String(h == null ? "" : h).trim().toLowerCase().replace(/\s+/g, " ");
}

/** {нормализованный заголовок: номер колонки (1-индекс)} по первой строке. */
function buildHeaderMap_(sheet) {
  var map = {};
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return map;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    var norm = normalizeHeader_(headers[i]);
    if (norm && !(norm in map)) map[norm] = i + 1;
  }
  return map;
}

/** Номер колонки для поля: сначала точное совпадение, затем «содержит», затем fallback. */
function colFor_(hmap, synonyms, fallbackCol) {
  var i, key, syn;
  for (i = 0; i < synonyms.length; i++) {
    syn = normalizeHeader_(synonyms[i]);
    if (hmap[syn]) return hmap[syn];
  }
  for (key in hmap) {
    for (i = 0; i < synonyms.length; i++) {
      syn = normalizeHeader_(synonyms[i]);
      if (syn && (key.indexOf(syn) !== -1 || syn.indexOf(key) !== -1)) return hmap[key];
    }
  }
  return fallbackCol || -1;
}

/** Массив значений строки нужной ширины: каждое поле — в свою колонку по заголовку. */
function buildRowArray_(hmap, width, fields) {
  var arr = [];
  for (var i = 0; i < width; i++) arr.push("");
  for (var key in fields) {
    var syn = FIELD_SYNONYMS[key];
    if (!syn) continue;
    var fallback = key === "promo" ? PROMO_FALLBACK_COL : -1;
    var col = colFor_(hmap, syn, fallback);
    if (col > 0 && col <= width) arr[col - 1] = fields[key];
  }
  return arr;
}

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

    // Studio pipeline: загрузка одного готового артефакта в папку на Диске
    // ОТ ИМЕНИ владельца (у сервис-аккаунта нет квоты Диска).
    if (body.action === "studioUpload") {
      return handleStudioUpload_(body);
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

    // Сначала только Таблица — без DriveApp. Так заказ не теряется, если Drive недоступен.
    var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    ensureHeaderRow(sheet);
    var hmap = buildHeaderMap_(sheet);
    var width = Math.max(sheet.getLastColumn(), ORDER_SHEET_HEADERS.length);

    var colOrderId = colFor_(hmap, FIELD_SYNONYMS.orderId, 2);
    var orderIdKey = String(order.orderId || "").trim();
    var existingFirstRow = orderIdKey ? findFirstDataRowWithOrderId_(sheet, orderIdKey, colOrderId) : -1;
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
      return mergePhotosIntoExistingOrder_(sheet, existingFirstRow, order, files, folderId, hmap);
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
    var customer = order.customer || {};
    var items = order.items && order.items.length ? order.items : [null];
    for (var itemRow = 0; itemRow < items.length; itemRow++) {
      var it = items[itemRow];
      var isFirst = itemRow === 0;
      var genderSize =
        it && (it.gender || it.size) ? (it.gender || "") + "/" + (it.size || "") : "";

      var fields = {
        time: new Date(),
        orderId: isFirst ? (order.orderId || "") : ("add-on to " + (order.orderId || "")),
        position: it ? "#" + (itemRow + 1) : "#1",
        name: isFirst ? (customer.name || "") : "",
        email: isFirst ? (customer.email || "") : "",
        phone: isFirst ? (customer.phone || "") : "",
        shelter: isFirst && order.shelter ? order.shelter.name : "",
        address: isFirst && order.delivery ? order.delivery.address : "",
        delivery: isFirst && order.delivery ? order.delivery.methodLabel : "",
        dogName: it && it.dogName ? it.dogName : "",
        style: it ? (it.printStyleLabel || it.printStyle || "") : "",
        shirtColor: it && it.color ? it.color : "",
        printColor: it && it.printColor ? it.printColor : "",
        genderSize: genderSize,
        sameAsPrev: it && it.sameAsPrevious ? "yes" : "no",
        promo: isFirst ? (customer.promoCode || "") : "",
        summary: isFirst ? itemsSummary : "",
        comment: isFirst ? (order.comment || "") : "",
        folder: "",
        fileCount: 0,
        consentPdn: isFirst ? (legal.consentPersonalData ? "yes" : "no") : "",
        consentOferta: isFirst ? (legal.consentTerms ? "yes" : "no") : "",
        links: "",
      };
      sheet.appendRow(buildRowArray_(hmap, width, fields));
    }

    var firstDataRow = sheet.getLastRow() - items.length + 1;
    var colFolder = colFor_(hmap, FIELD_SYNONYMS.folder, -1);
    var colFileCount = colFor_(hmap, FIELD_SYNONYMS.fileCount, -1);
    var colLinks = colFor_(hmap, FIELD_SYNONYMS.links, -1);

    var orderFolder = null;
    var driveError = null;
    var uploadErrors = [];
    var sharingErrors = [];

    try {
      var rootFolder = DriveApp.getFolderById(extractDriveFolderIdFromUrl_(folderId) || folderId);
      orderFolder = rootFolder.createFolder(order.orderId || "order");
      trySetAnyoneWithLink_(orderFolder, sharingErrors, "orderFolder");

      /* Ссылку на папку пишем сразу: если что-то ниже упадёт, она уже в таблице.
       * В свой try — чтобы сбой записи в ячейку не оборвал загрузку фото. */
      if (colFolder > 0) {
        try {
          sheet.getRange(firstDataRow, colFolder).setValue(orderFolder.getUrl());
        } catch (folderCellErr) {
          uploadErrors.push({ field: "folderCell", error: String(folderCellErr).slice(0, 400) });
        }
      }

      for (var fi = 0; fi < files.length; fi++) {
        var f = files[fi];
        try {
          if (!f || !f.dataBase64 || String(f.dataBase64).length === 0) {
            uploadErrors.push({ field: f && f.field ? f.field : String(fi), error: "empty dataBase64" });
            continue;
          }
          var bytes = decodeWebhookFileBytes_(f.dataBase64);
          if (!bytes || bytes.length === 0) {
            uploadErrors.push({ field: f.field || String(fi), error: "base64 decode yielded empty bytes" });
            continue;
          }
          var mime = f.mimeType || "image/jpeg";
          var name = safeDriveFileName_(f.originalName || "photo.jpg");
          var blob = Utilities.newBlob(bytes, mime, name);
          var driveFile = orderFolder.createFile(blob);
          trySetAnyoneWithLink_(driveFile, sharingErrors, f.field || String(fi));
          var viewUrl = drivePublicViewUrl(driveFile.getId());
          fileLinks.push(viewUrl);

          var itemIndex = parseItemIndex(f.field);
          var mapKey = itemIndex === null ? "_unmapped" : String(itemIndex);
          if (!itemLinksMap[mapKey]) itemLinksMap[mapKey] = [];
          itemLinksMap[mapKey].push(viewUrl);
        } catch (oneFileErr) {
          uploadErrors.push({ field: f && f.field ? f.field : String(fi), error: String(oneFileErr) });
        }
      }

      for (var ur = 0; ur < items.length; ur++) {
        var it2 = items[ur];
        var rowNum = firstDataRow + ur;
        var linksForRow =
          it2 && itemLinksMap[String(it2.lineIndex)] ? itemLinksMap[String(it2.lineIndex)].join(",") : "";
        var cnt = it2 && itemLinksMap[String(it2.lineIndex)] ? itemLinksMap[String(it2.lineIndex)].length : 0;
        if (colFileCount > 0) sheet.getRange(rowNum, colFileCount).setValue(cnt);
        if (colLinks > 0) sheet.getRange(rowNum, colLinks).setValue(linksForRow);
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
      sharingErrors: sharingErrors,
      driveError: driveError,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Studio pipeline upload: create (or replace) one file in a given Drive folder.
 * Payload: { action:"studioUpload", secret, folderId, fileName, mimeType, dataBase64 }
 * Runs as the script owner, so it uses the owner's Drive quota.
 */
function handleStudioUpload_(body) {
  var folderId = String(body.folderId || "").trim();
  var fileName = safeDriveFileName_(body.fileName || "artifact.png");
  var mime = body.mimeType || "image/png";
  if (!folderId) return jsonResponse({ ok: false, error: "missing folderId" });
  try {
    var bytes = decodeWebhookFileBytes_(body.dataBase64);
    if (!bytes || bytes.length === 0) {
      return jsonResponse({ ok: false, error: "empty dataBase64" });
    }
    var folder = DriveApp.getFolderById(folderId);
    var existing = folder.getFilesByName(fileName);
    while (existing.hasNext()) {
      existing.next().setTrashed(true);
    }
    var blob = Utilities.newBlob(bytes, mime, fileName);
    var file = folder.createFile(blob);
    return jsonResponse({ ok: true, fileId: file.getId(), fileUrl: file.getUrl() });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
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

/**
 * Публичная ссылка «любой, у кого есть ссылка» — НЕОБЯЗАТЕЛЬНЫЙ шаг.
 *
 * Политики Google (домена или аккаунта) могут запрещать такое расшаривание, и тогда
 * setSharing бросает «Доступ запрещен: DriveApp». Раньше это исключение вылетало в общий
 * catch и обрывало ВЕСЬ блок Drive — папка создавалась, а фото не загружалось ни одно
 * (fileCount=0 при filesReceived=3). Теперь ошибка расшаривания только записывается
 * в sharingErrors: файлы всё равно попадают в папку, владелец их видит.
 */
function trySetAnyoneWithLink_(driveItem, sharingErrors, label) {
  try {
    driveItem.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return true;
  } catch (shareErr) {
    if (sharingErrors) {
      sharingErrors.push({ field: label || "", error: String(shareErr).slice(0, 400) });
    }
    return false;
  }
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

/**
 * Заказ уже есть в листе; пришли файлы (повторный POST с фото) — догружаем в папку,
 * суммируем счётчики и ссылки. Колонки ищем по заголовкам (hmap).
 */
function mergePhotosIntoExistingOrder_(sheet, firstDataRow, order, files, parentFolderId, hmap) {
  var colFolder = colFor_(hmap, FIELD_SYNONYMS.folder, -1);
  var colFileCount = colFor_(hmap, FIELD_SYNONYMS.fileCount, -1);
  var colLinks = colFor_(hmap, FIELD_SYNONYMS.links, -1);

  var items = order.items && order.items.length ? order.items : [null];
  var itemLinksMap = {};
  var fileLinks = [];
  var uploadErrors = [];
  var sharingErrors = [];
  var driveError = null;
  var orderFolder = null;

  try {
    var folderUrlCell =
      colFolder > 0 ? String(sheet.getRange(firstDataRow, colFolder).getValue() || "").trim() : "";
    var fid = extractDriveFolderIdFromUrl_(folderUrlCell);
    if (fid) {
      orderFolder = DriveApp.getFolderById(fid);
    } else {
      var rootFolder = DriveApp.getFolderById(
        extractDriveFolderIdFromUrl_(parentFolderId) || parentFolderId,
      );
      orderFolder = rootFolder.createFolder(order.orderId || "order");
      trySetAnyoneWithLink_(orderFolder, sharingErrors, "orderFolder");
      if (colFolder > 0) sheet.getRange(firstDataRow, colFolder).setValue(orderFolder.getUrl());
    }

    for (var fi = 0; fi < files.length; fi++) {
      var f = files[fi];
      try {
        if (!f || !f.dataBase64 || String(f.dataBase64).length === 0) {
          uploadErrors.push({ field: f && f.field ? f.field : String(fi), error: "empty dataBase64" });
          continue;
        }
        var bytes = decodeWebhookFileBytes_(f.dataBase64);
        if (!bytes || bytes.length === 0) {
          uploadErrors.push({ field: f.field || String(fi), error: "base64 decode yielded empty bytes" });
          continue;
        }
        var mime = f.mimeType || "image/jpeg";
        var name = safeDriveFileName_(f.originalName || "photo.jpg");
        var blob = Utilities.newBlob(bytes, mime, name);
        var driveFile = orderFolder.createFile(blob);
        trySetAnyoneWithLink_(driveFile, sharingErrors, f.field || String(fi));
        var viewUrl = drivePublicViewUrl(driveFile.getId());
        fileLinks.push(viewUrl);
        var itemIndex = parsePhotoFieldLineIndex_(f.field);
        var mapKey = itemIndex === null ? "_unmapped" : String(itemIndex);
        if (!itemLinksMap[mapKey]) itemLinksMap[mapKey] = [];
        itemLinksMap[mapKey].push(viewUrl);
      } catch (oneFileErr) {
        uploadErrors.push({ field: f && f.field ? f.field : String(fi), error: String(oneFileErr) });
      }
    }

    for (var ur = 0; ur < items.length; ur++) {
      var it2 = items[ur];
      var rowNum = firstDataRow + ur;
      var newLinksArr = it2 && itemLinksMap[String(it2.lineIndex)] ? itemLinksMap[String(it2.lineIndex)] : [];
      var newCnt = newLinksArr.length;
      if (newCnt === 0) continue;
      var prevCnt = colFileCount > 0 ? Number(sheet.getRange(rowNum, colFileCount).getValue()) || 0 : 0;
      var prevLinks = colLinks > 0 ? String(sheet.getRange(rowNum, colLinks).getValue() || "").trim() : "";
      var addLinks = newLinksArr.join(",");
      var combined = prevLinks ? prevLinks + "," + addLinks : addLinks;
      if (colFileCount > 0) sheet.getRange(rowNum, colFileCount).setValue(prevCnt + newCnt);
      if (colLinks > 0) sheet.getRange(rowNum, colLinks).setValue(combined);
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
    sharingErrors: sharingErrors,
    driveError: driveError,
  });
}

function parsePhotoFieldLineIndex_(field) {
  var m = String(field || "").match(/^items\[(\d+)\]\[photos\]$/);
  return m ? Number(m[1]) : null;
}

/** Только для СОВСЕМ пустой таблицы: проставляем заголовки. Существующие не трогаем. */
function ensureHeaderRow(sheet) {
  if (sheet.getLastColumn() === 0) {
    sheet.appendRow(ORDER_SHEET_HEADERS);
  }
}

/** Ищем первую строку заказа по колонке Order ID (номер передаём из hmap). */
function findFirstDataRowWithOrderId_(sheet, orderId, colOrderId) {
  var id = String(orderId || "").trim();
  if (!id) return -1;
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var col = colOrderId && colOrderId > 0 ? colOrderId : 2;
  var vals = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || "").trim() === id) return i + 2;
  }
  return -1;
}

/**
 * ПРОВЕРКА без боевого запуска: выберите эту функцию в редакторе и нажмите Run,
 * затем View → Logs. Покажет, в какую колонку попадёт каждое поле на ВАШЕЙ таблице.
 */
function studioSelfTest() {
  var sheetId = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
  var hmap = buildHeaderMap_(sheet);
  Logger.log("Заголовки таблицы (норм → колонка): " + JSON.stringify(hmap));
  var probe = [
    ["Order ID", FIELD_SYNONYMS.orderId, 2],
    ["Промокод", FIELD_SYNONYMS.promo, PROMO_FALLBACK_COL],
    ["Папка с фото", FIELD_SYNONYMS.folder, -1],
    ["Кол-во файлов", FIELD_SYNONYMS.fileCount, -1],
    ["Ссылки на фото", FIELD_SYNONYMS.links, -1],
  ];
  var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (var i = 0; i < probe.length; i++) {
    var col = colFor_(hmap, probe[i][1], probe[i][2]);
    var letter = col > 0 && col <= 26 ? letters.charAt(col - 1) : "?";
    Logger.log(probe[i][0] + " → колонка " + col + " (" + letter + ")");
  }
}

import "server-only";

import { google } from "googleapis";

type GoogleBundle = {
  sheets: ReturnType<typeof google.sheets>;
  drive: ReturnType<typeof google.drive>;
};

let cached: GoogleBundle | null = null;

function parseServiceAccountJson(): object | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as object;
  } catch {
    return null;
  }
}

/** Клиенты Google API (Sheets + Drive). null, если нет JSON сервисного аккаунта. */
export function getGoogleOpsClients(): GoogleBundle | null {
  if (cached) return cached;
  const credentials = parseServiceAccountJson();
  if (!credentials) return null;

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });

  cached = {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
  return cached;
}

export function getSpreadsheetId(): string | undefined {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || undefined;
}

export function getSheetTabName(): string {
  return process.env.GOOGLE_SHEETS_TAB_NAME?.trim() || "Лист1";
}

export function getLogisticsSheetTabName(): string {
  return process.env.GOOGLE_LOGISTICS_SHEET_TAB_NAME?.trim() || "Логистика";
}

export function getRevolutionPrintFolderUrl(): string | undefined {
  const u = process.env.GOOGLE_REVOLUTION_PRINT_FOLDER_URL?.trim();
  return u || undefined;
}

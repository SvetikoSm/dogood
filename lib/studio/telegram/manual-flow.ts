import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { normalizeStyleId, styleDisplayName } from "@/lib/ops/style-masters";
import type { StyleSlug } from "@/lib/ops/style-masters";
import { getStudioDb, schema } from "@/lib/studio/db";
import { getStudioDataDir } from "@/lib/studio/paths";
import { inferPetNameScript } from "@/lib/studio/script-detect";

const BOT_API = "https://api.telegram.org";

function token(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN?.trim();
}

type InlineKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] };
type ManualMode = "dog_only" | "name_only" | "dog_text";
type ManualFlow = "dog" | "name" | "pack";

async function tgSend(chatId: string, text: string, keyboard?: InlineKeyboard) {
  const t = token();
  if (!t) return;
  await fetch(`${BOT_API}/bot${t}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: keyboard,
    }),
  }).catch((e) => console.error("[manual-flow] tgSend", e));
}

const STYLES: StyleSlug[] = ["life", "speed", "rainy"];

function menuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "🎨 Создать комплект (собака + имя)", callback_data: "mm:pack" }],
      [{ text: "🐶 Только иллюстрация собаки", callback_data: "mm:dog" }],
      [{ text: "✍️ Только имя (кличка)", callback_data: "mm:name" }],
    ],
  };
}

function styleKeyboard(flow: ManualFlow): InlineKeyboard {
  return {
    inline_keyboard: [
      ...STYLES.map((s) => [
        { text: styleDisplayName(s), callback_data: `ms:${flow}:${s}` },
      ]),
      [{ text: "✖️ Отмена", callback_data: "mx" }],
    ],
  };
}

function photosDoneKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "➡️ Далее: кличка", callback_data: "mn" }],
      [{ text: "✖️ Отмена", callback_data: "mx" }],
    ],
  };
}

function generateKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "▶️ Сгенерировать", callback_data: "mg" }],
      [{ text: "✖️ Отмена", callback_data: "mx" }],
    ],
  };
}

/** Public: show the main menu (used by /start, /menu, and after each job). */
export async function sendStudioMenu(chatId: string): Promise<void> {
  await tgSend(
    chatId,
    "Меню студии. Что создать вручную?",
    menuKeyboard(),
  );
}

/* ---------------- session helpers ---------------- */

async function getSession(chatId: string) {
  const db = getStudioDb();
  return db
    .select()
    .from(schema.studioTgSessions)
    .where(eq(schema.studioTgSessions.chatId, chatId))
    .get();
}

async function setSession(
  chatId: string,
  patch: Partial<typeof schema.studioTgSessions.$inferInsert>,
) {
  const db = getStudioDb();
  await db
    .insert(schema.studioTgSessions)
    .values({ chatId, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.studioTgSessions.chatId,
      set: { ...patch, updatedAt: new Date() },
    });
}

async function clearSession(chatId: string) {
  const db = getStudioDb();
  await db.delete(schema.studioTgSessions).where(eq(schema.studioTgSessions.chatId, chatId));
}

async function deleteDraftOrder(orderId: string) {
  if (!orderId) return;
  const db = getStudioDb();
  const [o] = await db
    .select({ status: schema.studioOrders.status })
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .limit(1);
  if (!o || o.status !== "draft") return;
  await db.delete(schema.studioOrderPhotos).where(eq(schema.studioOrderPhotos.orderId, orderId));
  await db.delete(schema.studioOrders).where(eq(schema.studioOrders.id, orderId));
}

/* ---------------- manual order creation ---------------- */

async function createManualOrder(
  mode: ManualMode,
  slug: StyleSlug | "",
): Promise<string> {
  const db = getStudioDb();
  const id = randomUUID();
  const tag = mode === "dog_only" ? "dog" : mode === "name_only" ? "name" : "pack";
  const sheetOrderId = `manual-${tag}-${Date.now()}`;
  await db.insert(schema.studioOrders).values({
    id,
    sheetOrderId,
    customerName: "manual",
    petNameRaw: "",
    petNameScript: "unknown",
    designSlug: slug,
    status: "draft",
    mode,
    sheetPayloadJson: JSON.stringify({ manual: true }),
  });
  return id;
}

/* ---------------- Telegram photo download ---------------- */

async function downloadTelegramFileToOrder(
  orderId: string,
  fileId: string,
  sortOrder: number,
): Promise<boolean> {
  const t = token();
  if (!t) return false;
  try {
    const info = await fetch(`${BOT_API}/bot${t}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const infoJson = (await info.json()) as { ok?: boolean; result?: { file_path?: string } };
    const filePath = infoJson.result?.file_path;
    if (!filePath) return false;
    const bin = await fetch(`${BOT_API}/file/bot${t}/${filePath}`);
    if (!bin.ok) return false;
    const buf = Buffer.from(await bin.arrayBuffer());
    const ext = path.extname(filePath) || ".jpg";
    const rel = path.posix.join("cache", orderId, `${sortOrder}_${fileId}${ext}`);
    const abs = path.join(getStudioDataDir(), ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
    await getStudioDb().insert(schema.studioOrderPhotos).values({
      id: randomUUID(),
      orderId,
      sortOrder,
      driveFileId: "",
      originalName: path.basename(filePath),
      mimeType: ext === ".png" ? "image/png" : "image/jpeg",
      localRelativePath: rel,
    });
    return true;
  } catch (e) {
    console.error("[manual-flow] download", e);
    return false;
  }
}

async function countPhotos(orderId: string): Promise<number> {
  const db = getStudioDb();
  const rows = await db
    .select({ id: schema.studioOrderPhotos.id })
    .from(schema.studioOrderPhotos)
    .where(eq(schema.studioOrderPhotos.orderId, orderId));
  return rows.length;
}

async function applyPetName(orderId: string, name: string) {
  await getStudioDb()
    .update(schema.studioOrders)
    .set({
      petNameRaw: name,
      petNameScript: inferPetNameScript(name),
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, orderId));
}

/** After pack photos+name: ask for style. */
async function advancePackToStyle(chatId: string, orderId: string, name: string) {
  await applyPetName(orderId, name);
  await setSession(chatId, { flow: "pack", awaiting: "style", orderId });
  await tgSend(
    chatId,
    `Кличка «${name}». Выберите стиль футболки:`,
    styleKeyboard("pack"),
  );
}

/** Start generation for a finished pack draft. */
async function startPackOrder(
  chatId: string,
  orderId: string,
  slug: StyleSlug,
): Promise<ManualResult> {
  const n = await countPhotos(orderId);
  if (n === 0) {
    await tgSend(chatId, "Сначала пришлите хотя бы одно фото собаки.");
    return { handled: true };
  }
  const [o] = await getStudioDb()
    .select({ petNameRaw: schema.studioOrders.petNameRaw })
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .limit(1);
  const name = o?.petNameRaw?.trim() ?? "";
  if (!name) {
    await setSession(chatId, { flow: "pack", awaiting: "name", style: slug, orderId });
    await tgSend(chatId, "Напишите кличку (точно как нужно на печати).");
    return { handled: true };
  }
  await getStudioDb()
    .update(schema.studioOrders)
    .set({
      designSlug: slug,
      status: "assets_loaded",
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, orderId));
  await clearSession(chatId);
  await tgSend(
    chatId,
    `Принято: ${n} фото, кличка «${name}», стиль ${styleDisplayName(slug)}.\nГенерирую иллюстрацию и надпись — пришлю на проверку.`,
  );
  return { handled: true, triggerTick: true };
}

/* ---------------- handlers (return whether a tick should run) ---------------- */

export type ManualResult = { handled: boolean; triggerTick?: boolean };

/** Inline-button presses that belong to the manual flow (data starts with mm:/ms:/mg/mn/mx). */
export async function handleManualCallback(chatId: string, data: string): Promise<ManualResult> {
  if (data === "mm:pack") {
    const orderId = await createManualOrder("dog_text", "");
    await setSession(chatId, { flow: "pack", awaiting: "photos", style: "", orderId });
    await tgSend(
      chatId,
      "Пришлите фото собаки (можно несколько).\nКличку можно написать подписью к фото, отдельным сообщением, или нажать «Далее: кличка».",
      photosDoneKeyboard(),
    );
    return { handled: true };
  }
  if (data === "mm:dog") {
    await setSession(chatId, { flow: "dog", awaiting: "style", style: "", orderId: "" });
    await tgSend(chatId, "Выберите стиль иллюстрации:", styleKeyboard("dog"));
    return { handled: true };
  }
  if (data === "mm:name") {
    await setSession(chatId, { flow: "name", awaiting: "style", style: "", orderId: "" });
    await tgSend(chatId, "Выберите стиль надписи:", styleKeyboard("name"));
    return { handled: true };
  }
  if (data === "mx") {
    const s = await getSession(chatId);
    if (s?.orderId) await deleteDraftOrder(s.orderId);
    await clearSession(chatId);
    await tgSend(chatId, "Отменено.");
    await sendStudioMenu(chatId);
    return { handled: true };
  }
  if (data === "mn") {
    const s = await getSession(chatId);
    if (!s || s.flow !== "pack" || s.awaiting !== "photos" || !s.orderId) {
      return { handled: false };
    }
    const n = await countPhotos(s.orderId);
    if (n === 0) {
      await tgSend(chatId, "Сначала пришлите хотя бы одно фото собаки.");
      return { handled: true };
    }
    await setSession(chatId, { awaiting: "name" });
    await tgSend(chatId, "Напишите кличку (точно как нужно на печати).");
    return { handled: true };
  }
  const ms = data.match(/^ms:(dog|name|pack):(life|speed|rainy)$/);
  if (ms) {
    const flow = ms[1] as ManualFlow;
    const slug = ms[2] as StyleSlug;
    if (flow === "pack") {
      const s = await getSession(chatId);
      if (!s || s.flow !== "pack" || !s.orderId) {
        await tgSend(chatId, "Сессия сброшена. Откройте /menu и начните заново.");
        return { handled: true };
      }
      return startPackOrder(chatId, s.orderId, slug);
    }
    if (flow === "dog") {
      const orderId = await createManualOrder("dog_only", slug);
      await setSession(chatId, { flow, style: slug, awaiting: "photos", orderId });
      await tgSend(
        chatId,
        `Стиль: ${styleDisplayName(slug)}.\nПришлите фото собаки (можно несколько), затем нажмите «Сгенерировать».`,
        generateKeyboard(),
      );
    } else {
      const orderId = await createManualOrder("name_only", slug);
      await setSession(chatId, { flow, style: slug, awaiting: "name", orderId });
      await tgSend(
        chatId,
        `Стиль: ${styleDisplayName(slug)}.\nНапишите кличку (точно как нужно на печати).`,
      );
    }
    return { handled: true };
  }
  if (data === "mg") {
    const s = await getSession(chatId);
    if (!s || s.flow !== "dog" || s.awaiting !== "photos" || !s.orderId) {
      return { handled: false };
    }
    const n = await countPhotos(s.orderId);
    if (n === 0) {
      await tgSend(chatId, "Сначала пришлите хотя бы одно фото собаки.");
      return { handled: true };
    }
    await getStudioDb()
      .update(schema.studioOrders)
      .set({ status: "assets_loaded", updatedAt: new Date() })
      .where(eq(schema.studioOrders.id, s.orderId));
    await clearSession(chatId);
    await tgSend(chatId, `Принято (${n} фото). Генерирую иллюстрацию — пришлю на проверку.`);
    return { handled: true, triggerTick: true };
  }
  return { handled: false };
}

/**
 * A photo message: attach to the active dog/pack session.
 * Optional caption is treated as the pet name for the pack flow.
 */
export async function handleManualPhoto(
  chatId: string,
  fileId: string,
  caption?: string,
): Promise<ManualResult> {
  const s = await getSession(chatId);
  if (!s || !s.orderId) return { handled: false };
  if (s.flow === "dog" && s.awaiting === "photos") {
    const n = await countPhotos(s.orderId);
    const ok = await downloadTelegramFileToOrder(s.orderId, fileId, n);
    if (ok) {
      await tgSend(
        chatId,
        `Фото добавлено (${n + 1}). Пришлите ещё или нажмите «Сгенерировать».`,
        generateKeyboard(),
      );
    } else {
      await tgSend(chatId, "Не удалось сохранить фото, попробуйте ещё раз.");
    }
    return { handled: true };
  }
  if (s.flow === "pack" && (s.awaiting === "photos" || s.awaiting === "name")) {
    // Allow late photos even after they moved on to typing the name.
    const n = await countPhotos(s.orderId);
    const ok = await downloadTelegramFileToOrder(s.orderId, fileId, n);
    if (!ok) {
      await tgSend(chatId, "Не удалось сохранить фото, попробуйте ещё раз.");
      return { handled: true };
    }
    const captionName = caption?.trim() ?? "";
    if (captionName) {
      await advancePackToStyle(chatId, s.orderId, captionName);
      return { handled: true };
    }
    if (s.awaiting === "photos") {
      await tgSend(
        chatId,
        `Фото добавлено (${n + 1}). Пришлите ещё, напишите кличку сообщением, или нажмите «Далее».`,
        photosDoneKeyboard(),
      );
    } else {
      await tgSend(
        chatId,
        `Фото добавлено (${n + 1}). Теперь напишите кличку сообщением.`,
      );
    }
    return { handled: true };
  }
  return { handled: false };
}

/** A plain text message: pet name for name-only or pack flows. */
export async function handleManualText(chatId: string, text: string): Promise<ManualResult> {
  const s = await getSession(chatId);
  if (!s || !s.orderId) return { handled: false };

  const name = text.trim();
  if (!name) {
    await tgSend(chatId, "Пустая кличка. Напишите имя ещё раз.");
    return { handled: true };
  }

  // Pack: name may arrive while still on photos (after ≥1 photo) or while awaiting name.
  if (s.flow === "pack" && (s.awaiting === "photos" || s.awaiting === "name")) {
    if (s.awaiting === "photos") {
      const n = await countPhotos(s.orderId);
      if (n === 0) {
        await tgSend(chatId, "Сначала пришлите хотя бы одно фото собаки.");
        return { handled: true };
      }
    }
    await advancePackToStyle(chatId, s.orderId, name);
    return { handled: true };
  }

  if (s.flow === "name" && s.awaiting === "name") {
    await getStudioDb()
      .update(schema.studioOrders)
      .set({
        petNameRaw: name,
        petNameScript: inferPetNameScript(name),
        // name_only starts at the text stage (this status triggers it in the orchestrator)
        status: "dog_approved_idle",
        updatedAt: new Date(),
      })
      .where(eq(schema.studioOrders.id, s.orderId));
    await clearSession(chatId);
    await tgSend(chatId, `Кличка «${name}». Генерирую надпись — пришлю на проверку.`);
    return { handled: true, triggerTick: true };
  }

  return { handled: false };
}

/** True if this chat is mid-manual-flow (so we don't treat text as a name by accident elsewhere). */
export async function hasActiveManualSession(chatId: string): Promise<boolean> {
  const s = await getSession(chatId);
  return Boolean(s && s.awaiting);
}

/** Guard used elsewhere: is a style slug valid? (kept for reuse) */
export function isValidStyle(raw: string): boolean {
  return normalizeStyleId(raw) !== null;
}

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deliveryMethods, printStyles, shelters } from "@/lib/landing-data";
import { generatePublicOrderId } from "@/lib/order-id";
import type { GoogleWebhookFilePart } from "@/lib/forward-order-to-google";
import type { TrackedOrder, TrackedOrderLine } from "@/lib/order-tracking-types";

const SUBMISSIONS_ROOT = path.join(process.cwd(), "data", "order-submissions");

const ITEM_KEY_RE = /^items\[(\d+)\]\[([^\]]+)]$/;

export type SavedOrderResult = {
  orderId: string;
  savedToDisk: boolean;
  submissionDir?: string;
  error?: string;
  /** Заполняется при includeWebhookPayload; не зависит от успеха записи на диск (важно для Netlify) */
  googleWebhookPayload?: {
    order: TrackedOrder;
    files: GoogleWebhookFilePart[];
  };
};

function first(values: string[] | undefined): string | undefined {
  return values?.[0];
}

function collectItemIndices(
  stringKeys: Iterable<string>,
  fileKeys: Iterable<string>,
): number[] {
  const set = new Set<number>();
  for (const k of stringKeys) {
    const m = k.match(ITEM_KEY_RE);
    if (m) set.add(Number(m[1]));
  }
  for (const k of fileKeys) {
    const m = k.match(ITEM_KEY_RE);
    if (m) set.add(Number(m[1]));
  }
  return [...set].sort((a, b) => a - b);
}

function deliveryLabel(code: string): string {
  return deliveryMethods.find((d) => d.value === code)?.label ?? code;
}

function printStyleLabel(value: string): string {
  return printStyles.find((p) => p.value === value)?.label ?? value;
}

type FileBufferEntry = { key: string; file: File; buf: Buffer };

/**
 * Сохраняет заявку для трекинга (локально / VPS) и готовит payload для Google.
 * На Netlify запись в `data/` часто недоступна — заказ и файлы всё равно собираются в памяти,
 * чтобы вебхук в Google мог отработать.
 */
export async function saveOrderSubmission(
  formData: FormData,
  options?: { includeWebhookPayload?: boolean },
): Promise<SavedOrderResult> {
  const orderId = generatePublicOrderId();
  const now = new Date().toISOString();
  const submissionDir = path.join(SUBMISSIONS_ROOT, orderId);
  const uploadsDir = path.join(submissionDir, "uploads");

  const stringFields = new Map<string, string[]>();
  const pendingFiles: { key: string; file: File }[] = [];

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      const list = stringFields.get(key);
      if (list) list.push(value);
      else stringFields.set(key, [value]);
      continue;
    }
    /* В типах только File | string, но в Node multipart иногда приходит Blob без File */
    const blob = value as unknown as Blob;
    if (blob.size > 0) {
      const file =
        blob instanceof File
          ? blob
          : new File([blob], "photo.jpg", {
              type: blob.type || "application/octet-stream",
            });
      pendingFiles.push({ key, file });
    }
  }

  const fileBuffers: FileBufferEntry[] = [];
  for (const { key, file } of pendingFiles) {
    const buf = Buffer.from(await file.arrayBuffer());
    fileBuffers.push({ key, file, buf });
  }

  const googleFiles: GoogleWebhookFilePart[] = [];
  if (options?.includeWebhookPayload) {
    for (const { key, file, buf } of fileBuffers) {
      googleFiles.push({
        field: key,
        originalName: file.name || "photo",
        mimeType: file.type || "application/octet-stream",
        dataBase64: buf.toString("base64"),
      });
    }
  }

  let filesMeta: TrackedOrder["files"] = [];
  const photosByLine = new Map<number, string[]>();
  let diskError: string | undefined;

  try {
    await mkdir(uploadsDir, { recursive: true });

    let fileSeq = 0;
    for (const { key, file, buf } of fileBuffers) {
      const safeOriginal = (file.name || "file").replace(/[^\w.\-()]/g, "_");
      const savedAs = `${fileSeq}_${key.replace(/[^\w[\].-]/g, "_")}_${safeOriginal}`;
      const relativePath = path.posix.join("uploads", savedAs);
      await writeFile(path.join(submissionDir, relativePath), buf);

      filesMeta.push({
        field: key,
        relativePath,
        originalName: file.name,
        sizeBytes: file.size,
        mimeType: file.type || "application/octet-stream",
      });

      const m = key.match(ITEM_KEY_RE);
      if (m && m[2] === "photos") {
        const line = Number(m[1]);
        const arr = photosByLine.get(line) ?? [];
        arr.push(relativePath);
        photosByLine.set(line, arr);
      }
      fileSeq += 1;
    }
  } catch (e) {
    diskError = e instanceof Error ? e.message : String(e);
    console.error("[saveOrderSubmission] disk write failed:", diskError);
    filesMeta = [];
    photosByLine.clear();
  }

  const indices = collectItemIndices(stringFields.keys(), pendingFiles.map((p) => p.key));

  const items: TrackedOrderLine[] = indices.map((lineIndex) => {
    const sameRaw = first(stringFields.get(`items[${lineIndex}][sameAsPrevious]`));
    const sameAsPrevious = sameRaw === "true";
    const mirrorRaw = first(stringFields.get(`items[${lineIndex}][mirrorPhotosFrom]`));
    const mirrorPhotosFromLine =
      mirrorRaw !== undefined && mirrorRaw !== "" ? Number(mirrorRaw) : null;

    return {
      lineIndex,
      dogName: first(stringFields.get(`items[${lineIndex}][dogName]`)) ?? "",
      breed: first(stringFields.get(`items[${lineIndex}][breed]`)) ?? "",
      printStyle: first(stringFields.get(`items[${lineIndex}][printStyle]`)) ?? "",
      printStyleLabel: printStyleLabel(
        first(stringFields.get(`items[${lineIndex}][printStyle]`)) ?? "",
      ),
      color: first(stringFields.get(`items[${lineIndex}][color]`)) ?? "white",
      sameAsPrevious,
      mirrorPhotosFromLine: Number.isFinite(mirrorPhotosFromLine)
        ? mirrorPhotosFromLine
        : null,
      photoRelativePaths: photosByLine.get(lineIndex) ?? [],
    };
  });

  const shelterId = first(stringFields.get("shelterId")) ?? "";
  const shelter = shelters.find((s) => s.id === shelterId);

  const order: TrackedOrder = {
    schemaVersion: 1,
    orderId,
    status: "new",
    createdAt: now,
    updatedAt: now,
    customer: {
      name: first(stringFields.get("name")) ?? "",
      email: first(stringFields.get("email")) ?? "",
      phone: first(stringFields.get("phone")) ?? "",
      promoCode: first(stringFields.get("promoCode")) || null,
    },
    delivery: {
      address: first(stringFields.get("address")) ?? "",
      methodCode: first(stringFields.get("deliveryMethod")) ?? "",
      methodLabel: deliveryLabel(first(stringFields.get("deliveryMethod")) ?? ""),
    },
    shelter: {
      id: shelterId,
      name: shelter?.name ?? "",
      city: shelter?.city ?? "",
    },
    items,
    comment: first(stringFields.get("comment")) ?? "",
    files: filesMeta,
  };

  let savedToDisk = false;
  if (!diskError) {
    try {
      await writeFile(
        path.join(submissionDir, "order.json"),
        JSON.stringify(order, null, 2),
        "utf-8",
      );
      savedToDisk = true;
    } catch (e) {
      diskError = e instanceof Error ? e.message : String(e);
      console.error("[saveOrderSubmission] order.json write failed:", diskError);
    }
  }

  return {
    orderId,
    savedToDisk,
    submissionDir: savedToDisk ? submissionDir : undefined,
    ...(diskError ? { error: diskError } : {}),
    ...(options?.includeWebhookPayload
      ? { googleWebhookPayload: { order, files: googleFiles } }
      : {}),
  };
}

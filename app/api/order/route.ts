import { NextResponse } from "next/server";

import {
  forwardOrderToGoogleWebhook,
  type GoogleWebhookSummary,
} from "@/lib/forward-order-to-google";
import { saveOrderSubmission } from "@/lib/save-order-submission";
import {
  customerNoticeWhenPhotosMissing,
  customerNoticeWhenPhotosPartial,
} from "@/lib/order-customer-notices";
import {
  createOrderFolderViaDriveApi,
  getOrderDriveParentFolderId,
  uploadOrderPhotosToDriveFolder,
} from "@/lib/upload-order-photos-to-drive";

export const maxDuration = 120;

/**
 * Принимает multipart/form-data из формы заказа.
 * Сохраняет `order.json` и файлы в `data/order-submissions/<orderId>/uploads/`.
 *
 * Если заданы `GOOGLE_ORDER_WEBHOOK_URL` и `GOOGLE_ORDER_WEBHOOK_SECRET`, после сохранения
 * отправляет тот же заказ в Google Apps Script (строка в Таблице + файлы на Диск).
 * Обычную Google Form с сайта так не подключить — файлы туда не уходят; нужен скрипт из `scripts/`.
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, detail: message },
      { status: 413 },
    );
  }

  const summary: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (value instanceof File) {
      summary[key] = `File(${value.name}, ${value.size} bytes)`;
    } else {
      summary[key] = String(value);
    }
  });

  const webhookUrl = process.env.GOOGLE_ORDER_WEBHOOK_URL?.trim();
  const webhookSecret = process.env.GOOGLE_ORDER_WEBHOOK_SECRET?.trim() ?? "";
  const includeWebhookPayload = Boolean(webhookUrl && webhookSecret);

  const saved = await saveOrderSubmission(formData, {
    includeWebhookPayload,
  });
  const filesPreparedForGoogle = saved.googleWebhookPayload?.files.length ?? 0;
  const pendingFilesCount = saved.diagnostics?.pendingFilesCount ?? 0;
  const pendingTotalBytes = saved.diagnostics?.pendingTotalBytes ?? 0;
  const heicConvertedCount = saved.diagnostics?.heicConvertedCount ?? 0;

  let googleWebhookStatus: "skipped" | "ok" | "error" = "skipped";
  let googleWebhookError: string | null = null;
  let googleWebhookWarning: string | null = null;
  /** Только человеческий текст для экрана «Спасибо за заказ» — без DriveApp и т.п. */
  let customerNotice: string | null = null;
  let googleWebhookWithFilesSummary: GoogleWebhookSummary | undefined;
  let googleWebhookNoFilesSummary: GoogleWebhookSummary | undefined;
  let driveApiPhotoUpload: {
    uploaded: number;
    errors?: string[];
  } | null = null;

  /* Вебхук не привязываем к savedToDisk: даже если диск недоступен, заказ и файлы
   * уже собраны в памяти (googleWebhookPayload), и их можно отправить в Google. */
  if (includeWebhookPayload && saved.googleWebhookPayload && webhookUrl) {
    const payload = saved.googleWebhookPayload;
    const fwdWithFiles = await forwardOrderToGoogleWebhook({
      webhookUrl,
      secret: webhookSecret,
      order: payload.order,
      files: payload.files,
    });

    if (fwdWithFiles.ok) {
      googleWebhookWithFilesSummary = fwdWithFiles.summary;
      googleWebhookStatus = "ok";
      console.log("[api/order] google webhook ok:", saved.orderId);

      const gasFileCount = fwdWithFiles.summary?.fileCount ?? 0;
      const gasDriveError = fwdWithFiles.summary?.driveError;
      let folderTarget = fwdWithFiles.summary?.folderUrl?.trim() ?? "";

      if (payload.files.length > 0 && gasFileCount === 0) {
        if (!folderTarget) {
          const parentId = getOrderDriveParentFolderId();
          if (parentId) {
            const created = await createOrderFolderViaDriveApi(
              parentId,
              saved.orderId,
            );
            if (created) folderTarget = created.folderUrl;
          }
        }

        if (folderTarget) {
          const driveUp = await uploadOrderPhotosToDriveFolder({
            folderIdOrUrl: folderTarget,
            files: payload.files,
          });
          driveApiPhotoUpload = {
            uploaded: driveUp.uploaded,
            ...(driveUp.errors.length ? { errors: driveUp.errors.slice(0, 5) } : {}),
          };
          console.log(
            "[api/order] Drive API photo fallback:",
            saved.orderId,
            "gasDriveError:",
            gasDriveError ?? "(none)",
            driveUp.uploaded,
            "/",
            payload.files.length,
            driveUp.errors[0] ?? "",
          );
          if (driveUp.uploaded === 0) {
            googleWebhookWarning =
              "GAS fileCount=0; Drive API upload failed. Check GOOGLE_SERVICE_ACCOUNT_JSON and folder share.";
            customerNotice = customerNoticeWhenPhotosMissing(saved.orderId);
          } else if (driveUp.uploaded < payload.files.length) {
            googleWebhookWarning = `Drive API: ${driveUp.uploaded}/${payload.files.length} files`;
            customerNotice = customerNoticeWhenPhotosPartial(
              saved.orderId,
              driveUp.uploaded,
              payload.files.length,
            );
          }
        } else {
          googleWebhookWarning = `GAS fileCount=0; no folderUrl; driveError=${String(gasDriveError ?? "").slice(0, 200)}`;
          customerNotice = customerNoticeWhenPhotosMissing(saved.orderId);
          console.error("[api/order] photo rescue failed:", saved.orderId, googleWebhookWarning);
        }
      }
    } else {
      /* Заказ для клиента всегда принимаем: при сбое отправки с фото пробуем хотя бы строку в Таблице. */
      const fwdOrderOnly = await forwardOrderToGoogleWebhook({
        webhookUrl,
        secret: webhookSecret,
        order: payload.order,
        files: [],
      });
      if (fwdOrderOnly.ok) {
        googleWebhookNoFilesSummary = fwdOrderOnly.summary;
        googleWebhookStatus = "ok";
        googleWebhookWarning =
          payload.files.length > 0
            ? "Webhook with files failed; order-only fallback ok"
            : null;
        if (payload.files.length > 0) {
          customerNotice = customerNoticeWhenPhotosMissing(saved.orderId);
        }
        console.warn(
          "[api/order] google webhook degraded (order only):",
          saved.orderId,
          fwdWithFiles.error,
        );
      } else {
        googleWebhookStatus = "ok";
        googleWebhookWarning = "Google webhook fully failed; order saved on VPS only";
        customerNotice = customerNoticeWhenPhotosMissing(saved.orderId);
        googleWebhookError = `${fwdWithFiles.error}; fallback(no-files): ${fwdOrderOnly.error}`;
        console.error(
          "[api/order] google webhook failed, order still accepted:",
          saved.orderId,
          googleWebhookError,
        );
      }
    }

    if (googleWebhookStatus === "ok") {
      console.log(
        "[api/order] google summaries",
        saved.orderId,
        JSON.stringify({
          withFiles: googleWebhookWithFilesSummary,
          noFiles: googleWebhookNoFilesSummary,
        }),
      );
    }
  }

  console.log(
    "[api/order]",
    saved.orderId,
    saved.savedToDisk ? "saved" : "not saved",
    googleWebhookStatus,
    `pendingFiles:${pendingFilesCount}`,
    `pendingBytes:${pendingTotalBytes}`,
    `googleFiles:${filesPreparedForGoogle}`,
    `heicConverted:${heicConvertedCount}`,
    summary,
  );

  return NextResponse.json({
    ok: true,
    orderId: saved.orderId,
    savedToDisk: saved.savedToDisk,
    submissionDir: saved.submissionDir,
    googleWebhook: googleWebhookStatus,
    pendingFilesCount,
    pendingTotalBytes,
    filesPreparedForGoogle,
    heicConvertedCount,
    ...(googleWebhookWithFilesSummary || googleWebhookNoFilesSummary
      ? {
          googleWebhookSummaries: {
            ...(googleWebhookWithFilesSummary
              ? { withFiles: googleWebhookWithFilesSummary }
              : {}),
            ...(googleWebhookNoFilesSummary ? { noFiles: googleWebhookNoFilesSummary } : {}),
          },
        }
      : {}),
    ...(googleWebhookError ? { googleWebhookError } : {}),
    ...(driveApiPhotoUpload ? { driveApiPhotoUpload } : {}),
    ...(customerNotice ? { customerNotice } : {}),
    ...(googleWebhookWarning ? { googleWebhookWarning } : {}),
    ...(saved.error ? { warning: "disk_save_failed", detail: saved.error } : {}),
    received: Object.keys(summary),
  });
}

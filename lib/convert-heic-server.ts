import "server-only";

export type PreparedUploadImage = {
  buf: Buffer;
  mimeType: string;
  fileName: string;
  convertedFromHeic: boolean;
};

const HEIF_BRANDS = /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/i;

export function bufferLooksLikeHeic(
  buf: Buffer,
  mimeType: string,
  fileName: string,
): boolean {
  const base = fileName.split("?")[0] ?? fileName;
  if (/image\/hei[cf]/i.test(mimeType)) return true;
  if (/\.hei[cf]$/i.test(base)) return true;
  if (buf.length < 12) return false;
  const tag = buf.subarray(4, 8).toString("ascii");
  if (tag !== "ftyp") return false;
  const brand = buf.subarray(8, 12).toString("ascii");
  return HEIF_BRANDS.test(brand);
}

function jpegFileName(originalName: string): string {
  const base = (originalName || "photo").replace(/\.[^.]+$/i, "") || "photo";
  return `${base}.jpg`;
}

/**
 * HEIC/HEIF → JPEG на сервере (VPS/Docker). Надёжнее, чем только heic2any в браузере.
 */
export async function convertHeicBufferToJpeg(
  buf: Buffer,
  quality = 0.88,
): Promise<Buffer | null> {
  try {
    const convert = (await import("heic-convert")).default;
    const out = await convert({
      buffer: buf,
      format: "JPEG",
      quality,
    });
    const first = Array.isArray(out) ? out[0] : out;
    if (!first) return null;
    return Buffer.from(first);
  } catch (e) {
    console.error("[convertHeicBufferToJpeg]", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Перед записью на диск и в Google: HEIC всегда пытаемся отдать как JPEG. */
export async function prepareImageBufferForUpload(opts: {
  buf: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<PreparedUploadImage> {
  const { buf, mimeType, fileName } = opts;
  if (!bufferLooksLikeHeic(buf, mimeType, fileName)) {
    return { buf, mimeType, fileName, convertedFromHeic: false };
  }

  const jpeg = await convertHeicBufferToJpeg(buf);
  if (jpeg && jpeg.length > 0) {
    return {
      buf: jpeg,
      mimeType: "image/jpeg",
      fileName: jpegFileName(fileName),
      convertedFromHeic: true,
    };
  }

  console.warn(
    "[prepareImageBufferForUpload] HEIC conversion failed, sending original bytes:",
    fileName,
    mimeType,
    buf.length,
  );
  return { buf, mimeType, fileName, convertedFromHeic: false };
}

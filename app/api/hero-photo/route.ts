import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";

const HERO_IMAGE_PATH =
  "C:\\Users\\sveta\\.cursor\\projects\\c-Users-sveta-OneDrive-side-hustling-machiiine-pet-store-dogood-v2\\assets\\c__Users_sveta_AppData_Roaming_Cursor_User_workspaceStorage_aed80036e6d9612b64d6390c52b40adb_images_image-removebg-preview__4_-a95fa65d-2e60-4ed4-8a17-473c3fe189fb.png";

export async function GET() {
  try {
    const file = readFileSync(HERO_IMAGE_PATH);
    return new NextResponse(file, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "hero_image_not_found" },
      { status: 404 },
    );
  }
}

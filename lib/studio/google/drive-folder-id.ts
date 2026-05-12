/** Extract Google Drive folder id from common URL shapes. */
export function extractDriveFolderId(input: string): string {
  const u = input.trim();
  if (!u) return "";
  const m = u.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m?.[1]) return m[1];
  const m2 = u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2?.[1]) return m2[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(u)) return u;
  return "";
}

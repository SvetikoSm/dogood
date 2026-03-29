import { randomBytes } from "node:crypto";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Публичный код заявки: hvostik + 3 цифры + 2 латинские буквы (например hvostik042KP).
 */
export function generatePublicOrderId(): string {
  const b = randomBytes(4);
  const num = ((b[0]! << 8) | b[1]!) % 1000;
  const l1 = LETTERS[b[2]! % 26];
  const l2 = LETTERS[b[3]! % 26];
  return `hvostik${String(num).padStart(3, "0")}${l1}${l2}`;
}

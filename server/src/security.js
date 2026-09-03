import { createHash, randomBytes, timingSafeEqual, scryptSync } from "node:crypto";

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_PARAMS = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, PASSWORD_KEY_LENGTH, PASSWORD_PARAMS).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, expectedHex] = String(stored ?? "").split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex || !/^[0-9a-f]+$/i.test(expectedHex)) return false;
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = scryptSync(password, salt, expected.length, PASSWORD_PARAMS);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

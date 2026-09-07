import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(nodeScrypt);

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derived.toString("base64")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltText, hashText] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64");
  const actual = await scrypt(password, Buffer.from(saltText, "base64"), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

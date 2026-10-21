import { createHash, randomBytes } from "node:crypto";

const OPAQUE_TOKEN_BYTES = 32;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString("base64url");
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function isOpaqueToken(value: string): boolean {
  return OPAQUE_TOKEN_PATTERN.test(value);
}

import { randomUUID, createHash } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

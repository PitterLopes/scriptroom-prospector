/** Instagram handles are case-insensitive; store them lowercase, without "@" or URL noise. */
export function normalizeUsername(raw: string): string {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\/(www\.)?instagram\.com\//, "");
  value = value.replace(/^@/, "");
  value = value.split(/[/?#]/)[0] ?? "";
  if (!/^[a-z0-9._]{1,30}$/.test(value)) {
    throw new Error(`Invalid Instagram username: ${raw}`);
  }
  return value;
}

export function isValidUsername(raw: string): boolean {
  try {
    normalizeUsername(raw);
    return true;
  } catch {
    return false;
  }
}

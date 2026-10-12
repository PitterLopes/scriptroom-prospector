/** Time helpers. All persistence is UTC ISO; operating hours are evaluated in the operator's timezone. */

export function nowIso(): string {
  return new Date().toISOString();
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function isoDateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function minutesOfDayInZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function parseOperatingHours(spec: string): { start: number; end: number } {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(spec);
  if (!match) throw new Error(`Invalid operating hours: ${spec}`);
  const [, h1, m1, h2, m2] = match;
  const start = Number(h1) * 60 + Number(m1);
  const end = Number(h2) * 60 + Number(m2);
  if (start >= end) throw new Error(`Operating hours must start before they end: ${spec}`);
  return { start, end };
}

export function isWithinOperatingHours(date: Date, spec: string, timeZone: string): boolean {
  const { start, end } = parseOperatingHours(spec);
  const minutes = minutesOfDayInZone(date, timeZone);
  return minutes >= start && minutes < end;
}

/** First instant at or after `date` that falls inside the operating window (minute resolution). */
export function nextOperatingInstant(date: Date, spec: string, timeZone: string): Date {
  if (isWithinOperatingHours(date, spec, timeZone)) return date;
  const { start } = parseOperatingHours(spec);
  const probe = new Date(date.getTime());
  probe.setUTCSeconds(0, 0);
  for (let i = 0; i < 48 * 60; i += 1) {
    probe.setTime(probe.getTime() + 60_000);
    if (minutesOfDayInZone(probe, timeZone) === start) return probe;
  }
  throw new Error("Could not find the next operating instant within 48 hours");
}

export function randomIntBetween(min: number, max: number, random: () => number = Math.random): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / 86_400_000);
}

/** UTC instant of local midnight (start of the operator's day) for the date `date` falls on in `timeZone`. */
export function startOfDayInZone(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = wallAsUtc - date.getTime();
  const midnightWallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), 0, 0, 0);
  return new Date(midnightWallAsUtc - offsetMs);
}

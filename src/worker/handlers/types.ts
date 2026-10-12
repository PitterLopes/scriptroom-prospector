import type { Job } from "@/db/schema";
import type { WorkerContext } from "../context";

export type HandlerResult = { kind: "done"; note?: string } | { kind: "postpone"; runAt: Date; note: string } | { kind: "fail"; error: string };

export type JobHandler = (job: Job, ctx: WorkerContext) => Promise<HandlerResult>;

export const done = (note?: string): HandlerResult => ({ kind: "done", note });
export const postpone = (runAt: Date, note: string): HandlerResult => ({ kind: "postpone", runAt, note });
export const fail = (error: string): HandlerResult => ({ kind: "fail", error });

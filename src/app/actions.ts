"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { getLimitsOverride, getPause, getSetting, pauseSystem, resumeSystem, setLimitsOverride, setSetting } from "@/db/queries/settings";
import { audit, raiseException, recordLeadEvent, resolveException } from "@/db/queries/events";
import { enqueue, retryDeadJob } from "@/db/queries/jobs";
import { addDoNotContact, getLead, markDoNotContact, moveChannel, movePipeline, updateLeadFields, upsertDiscoveredLead } from "@/db/queries/leads";
import { setExperimentStatus } from "@/features/experiments/queries";
import { resumeBrowser } from "@/worker/safety";
import { env } from "@/lib/env";
import type { PipelineState } from "@/features/leads/states";
import { isValidUsername } from "@/features/leads/dedupe";
import { DISCOVERY_PER_QUERY } from "@/worker/scheduler";

function revalidateAll() {
  for (const path of ["/", "/leads", "/jobs", "/exceptions", "/experiments", "/ai", "/audit", "/settings"]) revalidatePath(path);
}

export async function togglePauseAction(): Promise<void> {
  const db = getDb();
  if (getPause(db).paused) {
    resumeSystem(db);
    resumeBrowser(db);
    audit(db, "operator", "system_resumed", null);
  } else {
    pauseSystem(db, "Pausa manual pelo painel", "operator");
    audit(db, "operator", "system_paused", null, { reason: "manual" });
  }
  revalidateAll();
}

export async function toggleSendAction(): Promise<void> {
  const db = getDb();
  const current = getSetting<boolean>(db, "browser.sendEnabled", false);
  setSetting(db, "browser.sendEnabled", !current);
  audit(db, "operator", current ? "real_send_disabled" : "real_send_enabled", null, { envFlag: env().BROWSER_SEND_ENABLED });
  revalidateAll();
}

export async function toggleDiscoveryAction(): Promise<void> {
  const db = getDb();
  const current = getSetting<boolean>(db, "discovery.enabled", true);
  setSetting(db, "discovery.enabled", !current);
  audit(db, "operator", current ? "discovery_disabled" : "discovery_enabled", null);
  revalidateAll();
}

export async function saveLimitsAction(formData: FormData): Promise<void> {
  const db = getDb();
  const e = env();
  const read = (key: string) => {
    const raw = formData.get(key);
    return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
  };
  const toInt = (value: string | null) => (value === null ? undefined : Number.parseInt(value, 10));
  const next = {
    maxDmsPerDay: Math.min(toInt(read("maxDmsPerDay")) ?? e.MAX_DMS_PER_DAY, e.MAX_DMS_PER_DAY),
    minSecondsBetweenDms: Math.max(toInt(read("minSecondsBetweenDms")) ?? e.MIN_SECONDS_BETWEEN_DMS, e.MIN_SECONDS_BETWEEN_DMS),
    maxSecondsBetweenDms: toInt(read("maxSecondsBetweenDms")) ?? e.MAX_SECONDS_BETWEEN_DMS,
    operatingHours: read("operatingHours") ?? e.OPERATING_HOURS,
  };
  if (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(next.operatingHours)) throw new Error("Horário de operação inválido. Use o formato 09:00-20:00.");
  if (next.minSecondsBetweenDms > next.maxSecondsBetweenDms) throw new Error("O intervalo mínimo não pode ser maior que o máximo.");
  const previous = getLimitsOverride(db);
  setLimitsOverride(db, next);
  audit(db, "operator", "limits_changed", null, { previous, next });
  revalidateAll();
}

export async function resolveExceptionAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = getDb();
  resolveException(db, id);
  audit(db, "operator", "exception_resolved", id);
  revalidateAll();
}

export async function retryJobAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = getDb();
  retryDeadJob(db, id);
  audit(db, "operator", "job_retried", id);
  revalidateAll();
}

export async function addDoNotContactAction(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim();
  if (!isValidUsername(username)) throw new Error("Nome de usuário inválido.");
  const db = getDb();
  addDoNotContact(db, username, "adicionado pelo operador");
  audit(db, "operator", "do_not_contact_added", username);
  revalidateAll();
}

export async function addLeadAction(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim();
  if (!isValidUsername(username)) throw new Error("Nome de usuário inválido.");
  const db = getDb();
  const result = upsertDiscoveredLead(db, "customers", { username, source: "manual", sourceDetail: "painel" });
  if (result.status === "created") {
    enqueue(db, "enrich_and_score", { leadId: result.lead.id }, { idempotencyKey: `enrich:${result.lead.id}`, leadId: result.lead.id });
    audit(db, "operator", "lead_added_manually", result.lead.id, { username });
  }
  revalidateAll();
}

export async function leadActionDispatcher(formData: FormData): Promise<void> {
  const db = getDb();
  const leadId = String(formData.get("leadId") ?? "");
  const action = String(formData.get("action") ?? "");
  const lead = getLead(db, leadId);
  if (!lead) return;
  switch (action) {
    case "close":
      moveChannel(db, lead, "completed", "operator", "encerrado pelo operador");
      movePipeline(db, getLead(db, leadId)!, "closed", "operator", "encerrado pelo operador");
      break;
    case "do_not_contact":
      markDoNotContact(db, lead, "marcado pelo operador", "operator");
      break;
    case "release_review":
      if (lead.channelState === "human_review_required") {
        moveChannel(db, lead, lead.igUserId ? "api_active" : "waiting_inbound_reply", "operator", "liberado da revisão humana");
      }
      break;
    case "mark_registered":
      movePipeline(db, lead, "registered" as PipelineState, "operator", "marcado pelo operador");
      break;
    case "mark_active_customer":
      movePipeline(db, lead, "active_customer" as PipelineState, "operator", "marcado pelo operador");
      break;
    case "note": {
      const note = String(formData.get("note") ?? "").trim();
      if (note) {
        updateLeadFields(db, leadId, { notes: [lead.notes, note].filter(Boolean).join("\n") });
        recordLeadEvent(db, leadId, "manual_note", "operator", { note });
      }
      break;
    }
    case "send_now":
      if (lead.pipelineState === "qualified" && lead.channelState === "browser_contact_pending") {
        const tags = (JSON.parse(lead.tags) as string[]).filter((t) => t !== "dry_run");
        updateLeadFields(db, leadId, { tags: JSON.stringify(tags) });
        enqueue(db, "send_first_dm", { leadId }, { idempotencyKey: `first_dm:${leadId}:manual:${Date.now()}`, leadId, maxAttempts: 2 });
      }
      break;
    default:
      return;
  }
  audit(db, "operator", `lead_${action}`, leadId);
  revalidateAll();
}

export async function runDiscoveryNowAction(formData: FormData): Promise<void> {
  const query = String(formData.get("query") ?? "").trim();
  if (!query) return;
  const db = getDb();
  enqueue(db, "discover_profiles", { funnel: "customers", query, limit: DISCOVERY_PER_QUERY }, { idempotencyKey: `discover:${query}:manual:${Date.now()}`, maxAttempts: 2 });
  audit(db, "operator", "discovery_requested", query);
  revalidateAll();
}

export async function experimentStatusAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["running", "paused", "concluded"].includes(status)) return;
  const db = getDb();
  setExperimentStatus(db, id, status as "running" | "paused" | "concluded");
  audit(db, "operator", "experiment_status_changed", id, { status });
  revalidateAll();
}

export async function reportProblemAction(formData: FormData): Promise<void> {
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return;
  const db = getDb();
  raiseException(db, "human_review", text);
  revalidateAll();
}

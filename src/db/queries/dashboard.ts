import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { leadEvents, leads } from "../schema";
import { countJobsByStatus } from "./jobs";
import { countLeadsByChannel, countLeadsByPipeline } from "./leads";
import { monthlySpendUsd } from "./ai";
import { countOpenExceptions } from "./events";

export type DashboardMetrics = {
  pipeline: Record<string, number>;
  channels: Record<string, number>;
  totals: { leads: number; contacted: number; replied: number; interested: number; activeCustomers: number; doNotContact: number };
  rates: { reply: number; interest: number };
  cost: { month: number; perContacted: number | null; perActiveCustomer: number | null };
  openExceptions: number;
  jobs: Record<string, number>;
  recentEvents: Array<{ id: string; leadId: string; username: string; type: string; payload: string; createdAt: string }>;
};

export function dashboardMetrics(db: Db, now: Date = new Date()): DashboardMetrics {
  const pipeline = countLeadsByPipeline(db, "customers");
  const channels = countLeadsByChannel(db);
  const sum = (keys: string[]) => keys.reduce((acc, k) => acc + (pipeline[k] ?? 0), 0);
  const total = Object.values(pipeline).reduce((a, b) => a + b, 0);
  const contacted = db.select({ count: sql<number>`count(*)` }).from(leads).where(sql`${leads.contactedAt} is not null`).get()?.count ?? 0;
  const replied = db.select({ count: sql<number>`count(*)` }).from(leads).where(sql`${leads.repliedAt} is not null`).get()?.count ?? 0;
  const interested = sum(["interested", "whatsapp_handoff", "registered", "active_customer"]);
  const activeCustomers = pipeline.active_customer ?? 0;
  const month = monthlySpendUsd(db, now);
  const recent = db
    .select({ id: leadEvents.id, leadId: leadEvents.leadId, username: leads.username, type: leadEvents.type, payload: leadEvents.payload, createdAt: leadEvents.createdAt })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .orderBy(desc(leadEvents.createdAt))
    .limit(25)
    .all();
  return {
    pipeline,
    channels,
    totals: { leads: total, contacted, replied, interested, activeCustomers, doNotContact: channels.do_not_contact ?? 0 },
    rates: { reply: contacted ? replied / contacted : 0, interest: replied ? interested / replied : 0 },
    cost: { month, perContacted: contacted ? month / contacted : null, perActiveCustomer: activeCustomers ? month / activeCustomers : null },
    openExceptions: countOpenExceptions(db),
    jobs: countJobsByStatus(db),
    recentEvents: recent,
  };
}

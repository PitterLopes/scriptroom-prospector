import Link from "next/link";
import { getDb } from "@/db/client";
import { dashboardMetrics } from "@/db/queries/dashboard";
import { getWarmupStart } from "@/db/queries/settings";
import { env } from "@/lib/env";
import { EVENT_LABELS, PIPELINE_LABELS, formatInt, formatPercent, formatRelative, formatUsd, label } from "@/lib/labels";
import { CUSTOMER_PIPELINE } from "@/features/leads/states";
import { dailyAllowance } from "@/features/campaigns/limits";
import { countBrowserDmsSentBetween } from "@/db/queries/leads";
import { startOfDayInZone } from "@/lib/time";
import { Card, EmptyState, PageHeader, Stat } from "./_components/ui";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const db = getDb();
  const e = env();
  const now = new Date();
  const m = dashboardMetrics(db, now);
  const warmup = getWarmupStart(db);
  const allowance = dailyAllowance(
    { maxDmsPerDay: e.MAX_DMS_PER_DAY, minSecondsBetweenDms: e.MIN_SECONDS_BETWEEN_DMS, maxSecondsBetweenDms: e.MAX_SECONDS_BETWEEN_DMS, operatingHours: e.OPERATING_HOURS, timeZone: e.OPERATING_TIMEZONE, warmupStartPerDay: e.WARMUP_START_PER_DAY, warmupStepPerWeek: e.WARMUP_STEP_PER_WEEK },
    warmup ? new Date(warmup) : null,
    now,
  );
  const sentToday = countBrowserDmsSentBetween(db, startOfDayInZone(now, e.OPERATING_TIMEZONE).toISOString(), now.toISOString());

  return (
    <>
      <PageHeader title="Visão geral" subtitle="O funil de clientes, o ritmo do dia e o que a IA está custando." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Mensagens hoje" value={`${formatInt(sentToday)} / ${formatInt(allowance)}`} hint={warmup ? "Limite do dia, com o aquecimento" : "Aquecimento começa na primeira mensagem real"} />
        <Stat label="Taxa de resposta" value={formatPercent(m.rates.reply)} hint={`${formatInt(m.totals.replied)} de ${formatInt(m.totals.contacted)} abordados`} />
        <Stat label="Interessados" value={formatInt(m.totals.interested)} hint={`${formatPercent(m.rates.interest)} de quem respondeu`} />
        <Stat label="Clientes ativos" value={formatInt(m.totals.activeCustomers)} hint="Marcados por você quando o dado existir" />
        <Stat label="Custo de IA no mês" value={formatUsd(m.cost.month)} hint={`Teto: ${formatUsd(e.OPENROUTER_MONTHLY_BUDGET_USD)}`} />
        <Stat label="Custo por lead abordado" value={m.cost.perContacted === null ? "—" : formatUsd(m.cost.perContacted)} />
        <Stat label="Custo por cliente ativo" value={m.cost.perActiveCustomer === null ? "—" : formatUsd(m.cost.perActiveCustomer)} hint="Sem isso não dá para saber se a automação dá lucro" />
        <Stat label="Exceções abertas" value={formatInt(m.openExceptions)} hint={m.openExceptions > 0 ? "Veja a aba Exceções" : "Tudo em dia"} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Funil de clientes" className="lg:col-span-1">
          <ul className="divide-y divide-[var(--line)] text-sm">
            {CUSTOMER_PIPELINE.map((state) => (
              <li key={state} className="flex items-center justify-between py-2">
                <Link href={`/leads?estado=${state}`} className="hover:underline">
                  {label(PIPELINE_LABELS, state)}
                </Link>
                <span className="tabular-nums font-medium">{formatInt(m.pipeline[state] ?? 0)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Fila de jobs" className="lg:col-span-1">
          <ul className="text-sm">
            {Object.entries(m.jobs).length === 0 ? <EmptyState>Nenhum job ainda. O worker cria os jobs do dia quando sobe.</EmptyState> : null}
            {Object.entries(m.jobs).map(([status, count]) => (
              <li key={status} className="flex justify-between py-1">
                <span>{status}</span>
                <span className="tabular-nums">{formatInt(count)}</span>
              </li>
            ))}
          </ul>
          <Link href="/jobs" className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline">
            Ver a fila
          </Link>
        </Card>
        <Card title="Atividade recente" className="lg:col-span-1">
          {m.recentEvents.length === 0 ? (
            <EmptyState>Sem atividade. Adicione um lead à mão em Leads ou espere a descoberta rodar.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--line)] text-sm">
              {m.recentEvents.slice(0, 12).map((ev) => (
                <li key={ev.id} className="py-2">
                  <Link href={`/leads/${ev.leadId}`} className="font-medium hover:underline">
                    @{ev.username}
                  </Link>{" "}
                  <span className="text-[var(--muted)]">{label(EVENT_LABELS, ev.type)}</span>
                  <div className="text-xs text-[var(--muted)]">{formatRelative(ev.createdAt, now)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

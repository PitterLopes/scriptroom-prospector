import Link from "next/link";
import { getDb } from "@/db/client";
import { monthlySpendUsd, recentAiCalls, spendByPurpose } from "@/db/queries/ai";
import { dashboardMetrics } from "@/db/queries/dashboard";
import { env } from "@/lib/env";
import { formatDateTime, formatInt, formatUsd } from "@/lib/labels";
import { Badge, Card, EmptyState, PageHeader, Stat } from "../_components/ui";

export const dynamic = "force-dynamic";

const PURPOSE: Record<string, string> = { opening: "Primeira mensagem", classify: "Classificar intenção", decide: "Decidir resposta", follow_up: "Follow-up" };

export default function AiCostPage() {
  const db = getDb();
  const e = env();
  const month = monthlySpendUsd(db);
  const byPurpose = spendByPurpose(db);
  const recent = recentAiCalls(db, 60);
  const m = dashboardMetrics(db);
  return (
    <>
      <PageHeader title="Custo de IA" subtitle={`Toda chamada grava modelo, tokens e custo. Ao chegar a ${formatUsd(e.OPENROUTER_MONTHLY_BUDGET_USD)} no mês o sistema pausa sozinho.`} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Gasto no mês" value={formatUsd(month)} hint={`Teto: ${formatUsd(e.OPENROUTER_MONTHLY_BUDGET_USD)}`} />
        <Stat label="Por lead abordado" value={m.cost.perContacted === null ? "—" : formatUsd(m.cost.perContacted)} />
        <Stat label="Por cliente ativo" value={m.cost.perActiveCustomer === null ? "—" : formatUsd(m.cost.perActiveCustomer)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Por finalidade e modelo (mês)">
          {byPurpose.length === 0 ? (
            <EmptyState>Nenhuma chamada neste mês.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="py-1 pr-3">Finalidade</th>
                  <th className="py-1 pr-3">Modelo</th>
                  <th className="py-1 pr-3">Chamadas</th>
                  <th className="py-1 pr-3">Falhas</th>
                  <th className="py-1 pr-3">Custo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {byPurpose.map((row) => (
                  <tr key={`${row.purpose}-${row.model}`}>
                    <td className="py-1 pr-3">{PURPOSE[row.purpose] ?? row.purpose}</td>
                    <td className="py-1 pr-3 text-xs">{row.model}</td>
                    <td className="py-1 pr-3 tabular-nums">{formatInt(row.calls)}</td>
                    <td className="py-1 pr-3 tabular-nums">{formatInt(row.failures)}</td>
                    <td className="py-1 pr-3 tabular-nums">{formatUsd(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Chamadas recentes">
          {recent.length === 0 ? (
            <EmptyState>Nenhuma chamada ainda.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--line)] text-sm">
              {recent.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <Badge tone={c.ok ? "ok" : "bad"}>{c.ok ? "ok" : "falhou"}</Badge>
                  <span>{PURPOSE[c.purpose] ?? c.purpose}</span>
                  <span className="text-xs text-[var(--muted)]">{c.model}</span>
                  <span className="text-xs tabular-nums text-[var(--muted)]">
                    {formatInt(c.promptTokens)}+{formatInt(c.completionTokens)} tokens · {formatUsd(c.costUsd)} · {formatInt(c.latencyMs)} ms
                  </span>
                  {c.leadId ? (
                    <Link href={`/leads/${c.leadId}`} className="text-xs text-[var(--accent)] hover:underline">
                      lead
                    </Link>
                  ) : null}
                  <span className="ml-auto text-xs text-[var(--muted)]">{formatDateTime(c.createdAt)}</span>
                  {c.error ? <div className="w-full text-xs text-red-700">{c.error}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

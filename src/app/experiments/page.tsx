import { getDb } from "@/db/client";
import { ensureOpeningExperiment, listExperiments, listVariants, variantStats } from "@/features/experiments/queries";
import { formatDateTime, formatInt, formatPercent } from "@/lib/labels";
import { experimentStatusAction } from "../actions";
import { Badge, Button, Card, PageHeader } from "../_components/ui";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { running: "Rodando", paused: "Pausado", concluded: "Concluído" };

export default function ExperimentsPage() {
  const db = getDb();
  ensureOpeningExperiment(db, "customers");
  const experiments = listExperiments(db);
  return (
    <>
      <PageHeader title="Experimentos" subtitle="Uma variável por vez, com grupo de controle. O sistema só move peso quando toda variante tem amostra mínima e a líder vence o controle por 5 pontos de taxa de resposta; nunca declara vencedor sozinho." />
      <div className="space-y-4">
        {experiments.map((exp) => {
          const variants = listVariants(db, exp.id);
          const stats = variantStats(db, exp.id);
          return (
            <Card
              key={exp.id}
              title={`${exp.name} · variável: ${exp.variable}`}
              action={
                <div className="flex items-center gap-2">
                  <Badge tone={exp.status === "running" ? "ok" : "neutral"}>{STATUS[exp.status] ?? exp.status}</Badge>
                  <form action={experimentStatusAction} className="flex gap-1">
                    <input type="hidden" name="id" value={exp.id} />
                    {exp.status === "running" ? <Button name="status" value="paused">Pausar</Button> : <Button name="status" value="running">Retomar</Button>}
                  </form>
                </div>
              }
            >
              <p className="mb-3 text-xs text-[var(--muted)]">
                Amostra mínima por variante: {formatInt(exp.minSampleSize)} envios · fatia de exploração: {formatPercent(exp.explorationShare)} · criado em {formatDateTime(exp.createdAt)}
              </p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="py-1 pr-3">Variante</th>
                    <th className="py-1 pr-3">Configuração</th>
                    <th className="py-1 pr-3">Peso</th>
                    <th className="py-1 pr-3">Enviadas</th>
                    <th className="py-1 pr-3">Responderam</th>
                    <th className="py-1 pr-3">Taxa</th>
                    <th className="py-1 pr-3">Interessados</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {variants.map((v) => {
                    const s = stats.find((x) => x.variantId === v.id);
                    const sent = s?.sent ?? 0;
                    return (
                      <tr key={v.id}>
                        <td className="py-2 pr-3 font-medium">
                          {v.name} {v.isControl ? <Badge>controle</Badge> : null}
                        </td>
                        <td className="py-2 pr-3 text-xs text-[var(--muted)]">{v.config}</td>
                        <td className="py-2 pr-3 tabular-nums">{v.weight}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatInt(sent)}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatInt(s?.replied ?? 0)}</td>
                        <td className="py-2 pr-3 tabular-nums">{sent ? formatPercent((s?.replied ?? 0) / sent) : "—"}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatInt(s?.interested ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          );
        })}
      </div>
    </>
  );
}

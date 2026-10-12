import Link from "next/link";
import { getDb } from "@/db/client";
import { listJobs } from "@/db/queries/jobs";
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS, formatDateTime, label } from "@/lib/labels";
import { retryJobAction } from "../actions";
import { Badge, Button, Card, EmptyState, PageHeader } from "../_components/ui";

export const dynamic = "force-dynamic";

export default function JobsPage() {
  const jobs = listJobs(getDb(), 200);
  return (
    <>
      <PageHeader title="Fila de jobs" subtitle="Cada passo do sistema é um job durável no SQLite. O worker pega um por vez e tenta de novo com espera crescente." />
      <Card>
        {jobs.length === 0 ? (
          <EmptyState>Fila vazia. Suba o worker (npm run dev) para ele agendar os jobs do dia.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="py-2 pr-3">Job</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3">Lead</th>
                  <th className="py-2 pr-3">Roda em</th>
                  <th className="py-2 pr-3">Tentativas</th>
                  <th className="py-2 pr-3">Última nota</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="py-2 pr-3 font-medium">{label(JOB_TYPE_LABELS, job.type)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={job.status === "done" ? "ok" : job.status === "dead" ? "bad" : job.status === "running" ? "accent" : "neutral"}>{label(JOB_STATUS_LABELS, job.status)}</Badge>
                    </td>
                    <td className="py-2 pr-3">
                      {job.leadId ? (
                        <Link href={`/leads/${job.leadId}`} className="text-[var(--accent)] hover:underline">
                          abrir
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{formatDateTime(job.runAt)}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {job.attempts}/{job.maxAttempts}
                    </td>
                    <td className="max-w-md truncate py-2 pr-3 text-xs text-[var(--muted)]" title={job.lastError ?? ""}>
                      {job.lastError ?? "—"}
                    </td>
                    <td className="py-2">
                      {job.status === "dead" ? (
                        <form action={retryJobAction}>
                          <input type="hidden" name="id" value={job.id} />
                          <Button>Tentar de novo</Button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

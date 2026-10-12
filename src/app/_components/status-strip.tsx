import { getDb } from "@/db/client";
import { getPause, getSetting } from "@/db/queries/settings";
import { monthlySpendUsd } from "@/db/queries/ai";
import { countOpenExceptions } from "@/db/queries/events";
import { env } from "@/lib/env";
import { formatUsd } from "@/lib/labels";
import { togglePauseAction, toggleSendAction } from "../actions";
import { Badge, Button } from "./ui";

export const dynamic = "force-dynamic";

/** Always-visible health line: pause, real-send switch, browser queue, AI budget and open exceptions. */
export function StatusStrip() {
  const db = getDb();
  const e = env();
  const pause = getPause(db);
  const sendSwitch = getSetting<boolean>(db, "browser.sendEnabled", false);
  const browserPause = getSetting<{ paused: boolean; reason?: string }>(db, "browser.pause", { paused: false });
  const spent = monthlySpendUsd(db);
  const open = countOpenExceptions(db);
  const realSend = e.BROWSER_SEND_ENABLED && sendSwitch;
  return (
    <div className="border-t border-[var(--line)] bg-slate-50">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2 text-sm">
        {pause.paused ? <Badge tone="bad">Sistema pausado{pause.reason ? `: ${pause.reason}` : ""}</Badge> : <Badge tone="ok">Sistema rodando</Badge>}
        {realSend ? <Badge tone="warn">Envio real ligado</Badge> : <Badge tone="accent">Modo simulação (nada é enviado)</Badge>}
        {browserPause.paused ? <Badge tone="warn">Chrome indisponível</Badge> : null}
        <Badge tone={spent >= e.OPENROUTER_MONTHLY_BUDGET_USD * 0.8 ? "warn" : "neutral"}>
          IA no mês: {formatUsd(spent)} de {formatUsd(e.OPENROUTER_MONTHLY_BUDGET_USD)}
        </Badge>
        {open > 0 ? <Badge tone="warn">{open} exceção(ões) aberta(s)</Badge> : null}
        <div className="ml-auto flex items-center gap-2">
          <form action={toggleSendAction}>
            <Button title={e.BROWSER_SEND_ENABLED ? "Liga e desliga o envio real pelo Chrome" : "Para ligar, defina BROWSER_SEND_ENABLED=true no .env e reinicie"}>
              {sendSwitch ? "Desligar envio real" : "Ligar envio real"}
            </Button>
          </form>
          <form action={togglePauseAction}>
            <Button tone={pause.paused ? "accent" : "bad"}>{pause.paused ? "Retomar tudo" : "Pausar tudo"}</Button>
          </form>
        </div>
      </div>
    </div>
  );
}

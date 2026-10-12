/**
 * End-to-end simulation against a disposable SQLite file: discovery → scoring → first DM (dry-run or
 * "sent" inside the fake browser) → a simulated webhook reply → handoff → AI reply through a fake Graph API.
 * With `--real-ai` and OPENROUTER_API_KEY set, the model calls are real (a few cents); everything else stays fake.
 * Usage: npm run simulate [-- --real-ai]
 */
import fs from "node:fs";
import path from "node:path";
import { loadDotenv } from "@/lib/dotenv";
import { openDatabase } from "@/db/client";
import { business } from "@/lib/config";
import { env } from "@/lib/env";
import { OpenRouterClient } from "@/integrations/openrouter/client";
import { FakeInstagramBrowser } from "@/integrations/browser/fake";
import { InstagramGraphClient } from "@/integrations/instagram/graph";
import { createContext } from "./context";
import { runOnce } from "./index";
import { enqueue, listJobs } from "@/db/queries/jobs";
import { getLeadByUsername, listMessages, listLeads } from "@/db/queries/leads";
import { setSetting } from "@/db/queries/settings";
import { listLeadEvents, listOpenExceptions } from "@/db/queries/events";
import { monthlySpendUsd } from "@/db/queries/ai";
import { CHANNEL_LABELS, EVENT_LABELS, MESSAGE_STATUS_LABELS, PIPELINE_LABELS, formatUsd, label } from "@/lib/labels";

const PROFILES = [
  { username: "dra.ana.sorriso", exists: true, isPrivate: false, fullName: "Dra. Ana Lima", bio: "Dentista · CRO-SP 12345 · Ortodontia e clareamento em Campinas. Dicas e vídeos toda semana. Agende pelo link.", category: "Dentista", followers: 4200, following: 500, posts: 180, isBusiness: true, externalUrl: "https://wa.me/5519999999999", location: "Campinas, SP", recentPostsSummary: "Reels sobre alinhadores e dúvidas de pacientes", recentPosts: [{ url: "https://www.instagram.com/reel/abc123/", caption: "Alinhador invisível dói? Gravei esse vídeo respondendo as 3 dúvidas que mais chegam no consultório.", postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), kind: "reel" as const }], lastPublicPostAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), keywords: ["dentista"] },
  { username: "dr.caio.advocacia", exists: true, isPrivate: false, fullName: "Caio Mendes", bio: "Advogado trabalhista · OAB/SP · Explico seus direitos em 1 minuto. Reels toda terça.", category: "Advogado", followers: 9800, following: 300, posts: 240, isBusiness: true, externalUrl: null, location: "São Paulo, SP", recentPostsSummary: "Reels sobre demissão e rescisão", recentPosts: [{ url: "https://www.instagram.com/reel/adv1/", caption: "Fui demitido sem justa causa: o que eu tenho direito a receber? Explico em 1 minuto.", postedAt: new Date(Date.now() - 86_400_000).toISOString(), kind: "reel" as const }], lastPublicPostAt: new Date(Date.now() - 86_400_000).toISOString(), keywords: ["advogado", "advocacia"] },
  { username: "estagiario.odonto", exists: true, isPrivate: false, fullName: "João", bio: "Estudante de odontologia · 4º período", followers: 300, posts: 10, isBusiness: false, externalUrl: null, location: null, recentPostsSummary: null, lastPublicPostAt: null, keywords: ["dentista"] },
  { username: "rede.sorriso.franquias", exists: true, isPrivate: false, fullName: "Rede Sorriso", bio: "Clínica odontológica · 14 unidades no Brasil · franquia", followers: 250_000, posts: 900, isBusiness: true, externalUrl: null, location: null, recentPostsSummary: null, lastPublicPostAt: new Date().toISOString(), keywords: ["dentista"] },
];

function fakeAiTransport() {
  return async (body: Record<string, unknown>) => {
    const schema = (body.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema?.name ?? "";
    const content =
      schema === "opening_message"
        ? { post_index: 1, detail_used: "o jeito de explicar alinhadores", message: "Oi, Ana! Vi que você publica Reels sobre alinhadores toda semana, e explica de um jeito que dá para entender. Eu sou o Pitter e estou desenvolvendo sozinho, sem investimento de fora, um app para quem grava vídeo para atrair clientes. Testar e me dizer o que achou me ajudaria a continuar; se não fizer sentido, só me diz que já ajuda. Posso te mandar para experimentar?" }
        : schema === "inbound_classification"
          ? { intent: "asked_info", confidence: 0.92, summary: "Perguntou o que é e como funciona.", objection: "" }
          : { action: "present", reply: "Sou o Pitter, fundador do Scriptroom: um app de iPhone que escreve o roteiro do seu vídeo a partir de um tema, com pesquisa e fontes, e abre a câmera com teleprompter. O primeiro roteiro é grátis. Você grava os Reels sozinha ou com alguém ajudando?", follow_up_hours: 0, pipeline_hint: "interested", reasoning: "pediu informação; apresentar uma vez e devolver pergunta" };
    return { status: 200, data: { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 120, cost: 0.0008 }, model: String(body.model) } };
  };
}

function fakeGraph(sent: Array<{ to: string; text: string }>): InstagramGraphClient {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/me/messages")) {
      const body = JSON.parse(String(init?.body)) as { recipient: { id: string }; message: { text: string } };
      sent.push({ to: body.recipient.id, text: body.message.text });
      return new Response(JSON.stringify({ message_id: `m_${sent.length}` }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "9001", username: "dra.ana.sorriso", name: "Ana" }), { status: 200 });
  };
  return new InstagramGraphClient({ accessToken: "fake", graphVersion: "v24.0", fetchImpl });
}

async function main(): Promise<void> {
  loadDotenv();
  const realAi = process.argv.includes("--real-ai");
  const file = path.resolve(process.cwd(), "data/simulation.db");
  for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(file + suffix)) fs.unlinkSync(file + suffix);
  const { db } = openDatabase(file);
  const e = { ...env(), BROWSER_SEND_ENABLED: true, OPERATING_HOURS: "00:00-23:59", DATABASE_URL: file, BACKUP_DIR: "./data/simulation-backups" };
  const config = business();
  const ai = realAi && e.OPENROUTER_API_KEY ? OpenRouterClient.fromEnv(db) : new OpenRouterClient(db, { apiKey: "fake", mainModel: e.OPENROUTER_MODEL, fastModel: e.OPENROUTER_MODEL_FAST, monthlyBudgetUsd: e.OPENROUTER_MONTHLY_BUDGET_USD, transport: fakeAiTransport() });
  const browser = new FakeInstagramBrowser({ profiles: PROFILES });
  const apiSent: Array<{ to: string; text: string }> = [];
  const ctx = createContext({ db, env: e, config, ai, browser, graph: fakeGraph(apiSent), sleep: async () => undefined });
  setSetting(db, "browser.sendEnabled", true);
  setSetting(db, "discovery.enabled", false);

  const out: string[] = [];
  const say = (line = "") => out.push(line);
  say(`# Simulação de ponta a ponta — ${new Date().toISOString()}`);
  say(`IA: ${realAi && e.OPENROUTER_API_KEY ? `REAL (${e.OPENROUTER_MODEL} / ${e.OPENROUTER_MODEL_FAST})` : "falsa (respostas fixas)"} · navegador: falso · API da Meta: falsa`);
  say();

  say("## 1. Descoberta e pontuação");
  enqueue(db, "discover_profiles", { funnel: "customers", query: "#dentista", limit: 10 }, { idempotencyKey: "sim:discover:dentista" });
  enqueue(db, "discover_profiles", { funnel: "customers", query: "advogado", limit: 10 }, { idempotencyKey: "sim:discover:advogado" });
  await runOnce(ctx, 50);
  await runOnce(ctx, 50);
  for (const lead of listLeads(db)) say(`- @${lead.username}: ${lead.icpScore} pts · ${label(PIPELINE_LABELS, lead.pipelineState)} · ${label(CHANNEL_LABELS, lead.channelState)} · ${lead.roleGuess}`);
  say();

  say("## 2. Primeira mensagem pelo navegador (falso)");
  await runOnce(ctx, 50);
  await runOnce(ctx, 50);
  for (const s of browser.sent) say(`- para @${s.username} (${s.dryRun ? "simulada" : "enviada"}): “${s.text}”`);
  say();

  say("## 3. Resposta chega pelo webhook e a conversa passa para a API");
  const ana = getLeadByUsername(db, "dra.ana.sorriso");
  if (!ana) throw new Error("simulation: lead missing");
  enqueue(db, "process_inbound", { mid: "sim_mid_1", senderId: "9001", recipientId: "page", text: "Oi Pitter! Que app é esse? Como funciona?", timestamp: new Date().toISOString(), attachments: 0 }, { idempotencyKey: "inbound:sim_mid_1" });
  await runOnce(ctx, 50);
  await runOnce(ctx, 50);
  const after = getLeadByUsername(db, "dra.ana.sorriso")!;
  say(`- @${after.username}: ${label(PIPELINE_LABELS, after.pipelineState)} · ${label(CHANNEL_LABELS, after.channelState)} · conta Meta vinculada: ${after.igUserId}`);
  for (const m of listMessages(db, after.id)) say(`- ${m.direction === "outbound" ? "NÓS" : "LEAD"} [${m.channel} · ${label(MESSAGE_STATUS_LABELS, m.status)}]: “${m.text}”`);
  say(`- mensagens que saíram pela API falsa: ${apiSent.length}`);
  say();

  say("## 4. O mesmo webhook de novo (idempotência) e um pedido para parar");
  enqueue(db, "process_inbound", { mid: "sim_mid_1", senderId: "9001", recipientId: "page", text: "Oi Pitter! Que app é esse? Como funciona?", timestamp: new Date().toISOString(), attachments: 0 }, { idempotencyKey: "inbound:sim_mid_1" });
  const apiSentBeforeOptOut = apiSent.length;
  enqueue(db, "process_inbound", { mid: "sim_mid_2", senderId: "9001", recipientId: "page", text: "Na verdade pode parar de me mandar mensagem, obrigada", timestamp: new Date().toISOString(), attachments: 0 }, { idempotencyKey: "inbound:sim_mid_2" });
  await runOnce(ctx, 50);
  await runOnce(ctx, 50);
  const final = getLeadByUsername(db, "dra.ana.sorriso")!;
  say(`- @${final.username}: ${label(PIPELINE_LABELS, final.pipelineState)} · ${label(CHANNEL_LABELS, final.channelState)}`);
  say(`- mensagens pela API depois do pedido de parar: ${apiSent.length - apiSentBeforeOptOut} nova(s) (esperado: 0)`);
  say(`- na lista de não contatar: ${final.channelState === "do_not_contact" ? "sim" : "NÃO"}`);
  say();

  say("## 5. Linha do tempo da lead");
  for (const ev of [...listLeadEvents(db, final.id)].reverse()) say(`- ${ev.createdAt} · ${label(EVENT_LABELS, ev.type)} (${ev.actor})`);
  say();
  say("## 6. Fila, exceções e custo");
  const byStatus: Record<string, number> = {};
  for (const j of listJobs(db, 500)) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
  say(`- jobs: ${JSON.stringify(byStatus)}`);
  say(`- exceções abertas: ${listOpenExceptions(db).map((x) => x.kind).join(", ") || "nenhuma"}`);
  say(`- custo de IA registrado: ${formatUsd(monthlySpendUsd(db))}`);
  say();
  say(`Banco da simulação: ${file} (apague quando quiser; o painel e o worker usam ${env().DATABASE_URL}).`);

  const report = out.join("\n");
  fs.mkdirSync(path.resolve(process.cwd(), "data"), { recursive: true });
  fs.writeFileSync(path.resolve(process.cwd(), "data/simulation-report.md"), report);
  process.stdout.write(`${report}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`simulation failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

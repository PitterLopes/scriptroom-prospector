import type { Db } from "@/db/client";
import { monthlySpendUsd, recordAiCall } from "@/db/queries/ai";
import { pauseSystem } from "@/db/queries/settings";
import { raiseException } from "@/db/queries/events";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const log = logger("openrouter");
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const EXCLUDED_HOSTS = ["deepseek", "baidu", "alibaba", "siliconflow", "streamlake"];
const ACCEPTED_QUANTIZATIONS = ["fp8", "mxfp8", "fp16", "bf16", "fp32", "unknown"];

export type JsonSchema = Record<string, unknown>;

export type ModelRequest = {
  purpose: string;
  tier: "main" | "fast";
  system: string;
  user: string;
  schema?: { name: string; schema: JsonSchema };
  maxTokens?: number;
  temperature?: number;
  leadId?: string | null;
};

export type ModelResponse<T> = { text: string; json: T; costUsd: number; model: string; promptTokens: number; completionTokens: number };

export class BudgetExceededError extends Error {
  constructor(readonly spent: number, readonly budget: number) {
    super(`Monthly AI budget reached: spent $${spent.toFixed(2)} of $${budget.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}

export class ModelCallError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "ModelCallError";
  }
}

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  model?: string;
  error?: { message?: string; code?: number };
};

export type ModelTransport = (body: Record<string, unknown>, apiKey: string) => Promise<{ status: number; data: OpenRouterResponse }>;

const defaultTransport: ModelTransport = async (body, apiKey) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "http-referer": "https://scriptroom.online",
        "x-title": "Scriptroom Prospector",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as OpenRouterResponse;
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * One function for every model call. It checks the monthly budget first (and pauses the whole system when it is
 * reached), asks for structured output when a schema is given, records model, tokens and cost in `ai_calls`,
 * and retries once on 429/5xx with the identical body.
 */
export class OpenRouterClient {
  constructor(
    private readonly db: Db,
    private readonly options: { apiKey: string; mainModel: string; fastModel: string; monthlyBudgetUsd: number; transport?: ModelTransport },
  ) {}

  static fromEnv(db: Db): OpenRouterClient {
    const e = env();
    if (!e.OPENROUTER_API_KEY) throw new ModelCallError("OPENROUTER_API_KEY is not set", null);
    return new OpenRouterClient(db, {
      apiKey: e.OPENROUTER_API_KEY,
      mainModel: e.OPENROUTER_MODEL,
      fastModel: e.OPENROUTER_MODEL_FAST,
      monthlyBudgetUsd: e.OPENROUTER_MONTHLY_BUDGET_USD,
    });
  }

  assertBudget(now: Date = new Date()): void {
    const spent = monthlySpendUsd(this.db, now);
    if (spent >= this.options.monthlyBudgetUsd) {
      pauseSystem(this.db, `AI budget reached: $${spent.toFixed(2)} of $${this.options.monthlyBudgetUsd.toFixed(2)}`, "worker");
      raiseException(this.db, "budget_exceeded", `Monthly AI budget reached ($${spent.toFixed(2)})`, { payload: { spent, budget: this.options.monthlyBudgetUsd } });
      throw new BudgetExceededError(spent, this.options.monthlyBudgetUsd);
    }
  }

  async call<T = unknown>(request: ModelRequest): Promise<ModelResponse<T>> {
    this.assertBudget();
    const model = request.tier === "main" ? this.options.mainModel : this.options.fastModel;
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      max_tokens: request.maxTokens ?? 700,
      temperature: request.temperature ?? 0.6,
      // Reasoning off by default (same choice as the Scriptroom server): it burns the token budget on text nobody reads.
      reasoning: { enabled: false },
      usage: { include: true },
      provider: {
        data_collection: "deny",
        require_parameters: true,
        sort: "throughput",
        ignore: EXCLUDED_HOSTS,
        quantizations: ACCEPTED_QUANTIZATIONS,
      },
    };
    if (request.schema) {
      body.response_format = { type: "json_schema", json_schema: { name: request.schema.name, strict: true, schema: request.schema.schema } };
    }
    const transport = this.options.transport ?? defaultTransport;
    const started = Date.now();
    let lastError: ModelCallError | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { status, data } = await transport(body, this.options.apiKey).catch((error: unknown) => ({
        status: 0,
        data: { error: { message: error instanceof Error ? error.message : String(error) } } as OpenRouterResponse,
      }));
      const latencyMs = Date.now() - started;
      const usage = data.usage ?? {};
      const retryable = status === 0 || status === 429 || status >= 500;
      if (status >= 200 && status < 300 && !data.error) {
        const text = data.choices?.[0]?.message?.content ?? "";
        const finish = data.choices?.[0]?.finish_reason;
        let json: T;
        try {
          json = (request.schema ? JSON.parse(text) : (text as unknown)) as T;
        } catch {
          this.record(request, model, usage, latencyMs, false, "response is not valid JSON");
          throw new ModelCallError(`Model returned invalid JSON (finish_reason=${finish ?? "?"})`, status);
        }
        if (finish === "length") {
          this.record(request, model, usage, latencyMs, false, "response truncated");
          throw new ModelCallError("Model response was truncated", status);
        }
        this.record(request, model, usage, latencyMs, true, null);
        return {
          text,
          json,
          costUsd: usage.cost ?? 0,
          model: data.model ?? model,
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
        };
      }
      const message = data.error?.message ?? `OpenRouter answered ${status}`;
      this.record(request, model, usage, latencyMs, false, message);
      lastError = new ModelCallError(message, status || null);
      if (!retryable) break;
      log.warn("model call failed; retrying once", { status, purpose: request.purpose });
    }
    throw lastError ?? new ModelCallError("unknown model failure", null);
  }

  private record(request: ModelRequest, model: string, usage: OpenRouterResponse["usage"], latencyMs: number, ok: boolean, error: string | null): void {
    recordAiCall(this.db, {
      leadId: request.leadId ?? null,
      purpose: request.purpose,
      model,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      costUsd: usage?.cost ?? 0,
      latencyMs,
      ok,
      error,
    });
  }
}

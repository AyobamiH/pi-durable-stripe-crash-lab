/**
 * Isolated Pi Durable / Stripe test-mode crash boundary.
 * No credentials in the worker. Live Stripe access is deliberately impossible.
 * Pi's real agent loop uses a deterministic faux model (no billable LLM).
 */
import { DurableObject } from "cloudflare:workers";
import { Lifecycle } from "agents/lifecycle";
import { PiHarness } from "agents/harness/pi";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  Type,
  type Message,
  type TranscriptContext
} from "@earendil-works/pi-ai";
import { createRegistry, Harness, type ToolRegistration } from "@earendil-works/pi-durable";

interface Env {
  PAYMENT_AGENT: DurableObjectNamespace<PaymentAgent>;
  STRIPE_TEST_GATEWAY_URL: string;
  STRIPE_GATEWAY?: Fetcher;
  LAB_CONTROL_TOKEN?: string;
  LAB_OPERATION_ID?: string;
  LAB_HOSTED?: string;
  LAB_CRASH_STAGE?: string;
}

function contentText(content: Message["content"] | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content.map((part) =>
    "text" in part && typeof part.text === "string" ? part.text : ""
  ).join("");
}

function deterministicModel(context: TranscriptContext) {
  const last = context.messages.filter((m) => m.role !== "system").at(-1);
  if (last?.role === "toolResult") {
    return fauxAssistantMessage([
      fauxText((last.isError ? "interrupted or failed: " : "completed: ") + contentText(last.content))
    ]);
  }
  const raw = last?.role === "user" ? contentText(last.content) : "";
  const match = /^pay (lab-[a-z0-9-]{1,70})$/.exec(raw);
  if (match) {
    return fauxAssistantMessage(
      [fauxToolCall("stripe_test_payment", { operationId: match[1] })],
      { stopReason: "toolUse" }
    );
  }
  return fauxAssistantMessage([fauxText("unsupported request")]);
}

const PaymentArguments = Type.Object({ operationId: Type.String() });

export class PaymentAgent extends DurableObject<Env> {
  readonly #faux = fauxProvider({ tokensPerSecond: 400, tokenSize: { min: 5, max: 8 } });
  readonly #registry = createRegistry();
  readonly instanceId = crypto.randomUUID();
  readonly harness = new PiHarness({
    harness: ({ storage, context }) => {
      this.#registry.install({
        name: "payment-test",
        sections: [{
          key: "preamble",
          render: () => "A deterministic test harness: only the registered Stripe test tool exists.",
          tag: false
        }],
        tools: [this.#paymentTool()]
      });
      const models = createModels();
      models.setProvider(this.#faux.provider);
      return Harness.open(storage, {
        models,
        registry: this.#registry,
        settings: { retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 } },
        onReport: (error) => console.warn("pi test report", error)
      }, context);
    },
    defaults: { model: this.#faux.getModel() }
  });
  readonly lifecycle = Lifecycle.install(this).use(this.harness);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#faux.setResponses(Array.from({ length: 100 }, () => deterministicModel));
  }

  #paymentTool(): ToolRegistration<typeof PaymentArguments> {
    const storage = this.ctx.storage;
    const gateway = this.env.STRIPE_TEST_GATEWAY_URL;
    const gatewayBinding = this.env.STRIPE_GATEWAY;
    const beforeProvider = this.env.LAB_HOSTED !== "true" && this.env.LAB_CRASH_STAGE === "before-provider";
    return {
      name: "stripe_test_payment",
      description: "Execute one isolated GBP 1 test-mode payment; never use live credentials.",
      parameters: PaymentArguments,
      // An interrupted externally consequential call MUST NOT run again automatically.
      replay: "unsafe",
      async execute({ operationId }, api, context) {
        if (!/^lab-[a-z0-9-]{1,70}$/.test(operationId)) {
          throw new Error("Invalid lab operation ID");
        }
        const calls = ((await storage.get<number>("tool_executions")) ?? 0) + 1;
        await storage.put("tool_executions", calls);
        if (beforeProvider) {
          await storage.put("phase", "before_external_request");
          while (true) { context.abortSignal?.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, 50)); }
        }
        await storage.put("phase", "external_request_started");
        api.output("Initiating test-mode external operation\n");

        const paymentRequest = new Request((gatewayBinding ? "https://gateway.internal" : gateway) + "/payment", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId, amount: 100, currency: "gbp" })
        });
        const response = gatewayBinding ? await gatewayBinding.fetch(paymentRequest) : await fetch(paymentRequest);
        const body = await response.json() as {
          id?: string; status?: string; mode?: string; error?: string; livemode?: boolean;
        };
        if (!response.ok || body.livemode !== false || body.status !== "succeeded") {
          await storage.put("phase", "external_operation_failed_or_uncertain");
          throw new Error("Test payment not proven: " + String(body.error ?? response.status));
        }
        await storage.put("provider_receipt", {
          operationId, id: body.id, status: body.status, mode: body.mode, livemode: body.livemode
        });
        await storage.put("phase", "provider_accepted_waiting");
        // Deliberate interruption window: external effect exists, Pi tool has NOT returned.
        // This marker is persisted in the DO before the test process is SIGKILLed.
        while (!(await storage.get<boolean>("release_after_crash"))) {
          context.abortSignal?.throwIfAborted();
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await storage.put("phase", "tool_result_returning");
        return { output: [{ type: "text", text: "payment " + body.id + " confirmed" }] };
      }
    };
  }

  submitPayment(operationId: string) {
    return this.harness.submit("pay " + operationId, { operationId });
  }
  waitForPayment(operationId: string) {
    return this.harness.wait(operationId);
  }
  async crash() {
    if (this.env.LAB_HOSTED !== "true" || await this.ctx.storage.get("phase") !== "provider_accepted_waiting") throw new Error("Crash boundary not reached");
    await this.ctx.storage.put("crash_injection", { instanceId: this.instanceId, at: new Date().toISOString() });
    this.ctx.abort("Intentional Pi laboratory crash after provider acceptance");
  }
  async release() {
    await this.ctx.storage.put("release_after_crash", true);
  }
  async status() {
    return {
      instanceId: this.instanceId,
      crashInjection: (await this.ctx.storage.get("crash_injection")) ?? null,
      phase: (await this.ctx.storage.get<string>("phase")) ?? "not_started",
      toolExecutions: (await this.ctx.storage.get<number>("tool_executions")) ?? 0,
      providerReceipt: (await this.ctx.storage.get("provider_receipt")) ?? null,
      alarmTime: await this.ctx.storage.getAlarm()
    };
  }
}

function getStub(env: Env, session: string) {
  return env.PAYMENT_AGENT.get(env.PAYMENT_AGENT.idFromName(session));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (env.LAB_HOSTED === "true") {
      if (!env.LAB_CONTROL_TOKEN || request.headers.get("authorization") !== "Bearer " + env.LAB_CONTROL_TOKEN) return Response.json({error:"Unauthorised"},{status:401});
      if (url.searchParams.get("session") !== env.LAB_OPERATION_ID) return Response.json({error:"Outside test scope"},{status:403});
    } else if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return Response.json({ error: "This safety test only accepts loopback requests" }, { status: 403 });
    }
    const session = url.searchParams.get("session") ?? "default";
    if (!/^lab-[a-z0-9-]{1,70}$/.test(session)) {
      return Response.json({ error: "Invalid test session" }, { status: 400 });
    }
    const stub = getStub(env, session);
    if (env.LAB_HOSTED === "true" && url.pathname === "/gateway-state" && request.method === "GET") return env.STRIPE_GATEWAY!.fetch("https://gateway.internal/state" + (url.searchParams.get("preflight") === "1" ? "?preflight=1" : ""));
    try {
      if (url.pathname === "/crash" && request.method === "POST" && env.LAB_HOSTED === "true") {
        await stub.crash();
        return Response.json({error:"Crash did not reset object"},{status:500});
      }
      if (url.pathname === "/start" && request.method === "POST") {
        const input = await request.json() as { operationId?: string };
        if ((env.LAB_HOSTED === "true" && input.operationId !== env.LAB_OPERATION_ID) || typeof input.operationId !== "string" ||
            !/^lab-[a-z0-9-]{1,70}$/.test(input.operationId)) {
          return Response.json({ error: "Invalid operation ID" }, { status: 400 });
        }
        return Response.json(await stub.submitPayment(input.operationId));
      }
      if (url.pathname === "/status" && request.method === "GET") {
        return Response.json(await stub.status());
      }
      if (url.pathname === "/release" && request.method === "POST" && env.LAB_HOSTED !== "true") {
        await stub.release();
        return Response.json({ released: true });
      }
      if (url.pathname === "/result" && request.method === "GET") {
        const operationId = url.searchParams.get("operationId") ?? "";
        if (!/^lab-[a-z0-9-]{1,70}$/.test(operationId)) {
          return Response.json({ error: "Invalid operation ID" }, { status: 400 });
        }
        const result = await stub.waitForPayment(operationId);
        return Response.json({
          operationId: result.operationId, status: result.status, text: result.text
        });
      }
      return Response.json({ ok: false, routes: ["/start", "/status", "/release", "/result"] }, { status: 404 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }
};

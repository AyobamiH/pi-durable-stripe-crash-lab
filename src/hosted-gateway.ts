import { DurableObject } from "cloudflare:workers";

interface Env {
  PAYMENT_LEDGER: DurableObjectNamespace<PaymentLedger>;
  STRIPE_TEST_SECRET_KEY: string;
  LAB_OPERATION_ID: string;
}
type Receipt = { operationId: string; status: string; id: string | null; mode: string; livemode: false; requestId?: string | null };
type Ledger = { gatewayRequests: number; stripeCreateRequests: number; accepted: Record<string, Receipt> };

export class PaymentLedger extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const state = (await this.ctx.storage.get<Ledger>("ledger")) ?? { gatewayRequests: 0, stripeCreateRequests: 0, accepted: {} };
    if (request.method === "GET" && url.pathname === "/state") {
      let preflight;
      if (url.searchParams.get("preflight") === "1") {
        preflight = [];
        for (const route of ["account", "balance"]) {
          try {
            const res = await fetch("https://api.stripe.com/v1/" + route, {headers:{authorization:"Bearer "+this.env.STRIPE_TEST_SECRET_KEY},redirect:"manual",signal:AbortSignal.timeout(10000)});
            const body = await res.json() as { id?:string; livemode?:boolean; error?:{code?:string;type?:string} };
            preflight.push({route,httpStatus:res.status,accountId:body.id,livemode:body.livemode,errorCode:body.error?.code??body.error?.type});
          } catch(error) {preflight.push({route,error:error instanceof Error?error.message:"Unknown error"});}
        }
      }
      return Response.json({mode:"stripe-test", ...state, preflight, credentialConfigured: /^sk_test_[A-Za-z0-9]{16,}$/.test(this.env.STRIPE_TEST_SECRET_KEY ?? ""), diagnostic: (await this.ctx.storage.get("diagnostic")) ?? null});
    }
    if (request.method !== "POST" || url.pathname !== "/payment") return new Response("Not found", {status:404});
    const payload = await request.json() as {operationId?:string;amount?:number;currency?:string};
    if (payload.operationId !== this.env.LAB_OPERATION_ID || payload.amount !== 100 || payload.currency !== "gbp") {
      return Response.json({error:"Outside fixed single-operation scope"},{status:403});
    }
    const operationId = this.env.LAB_OPERATION_ID;
    // A transaction commits the attempt before any outbound request. Concurrent
    // requests and replacement instances can only observe that same attempt.
    const admission = await this.ctx.storage.transaction(async txn => {
      const current = (await txn.get<Ledger>("ledger")) ?? { gatewayRequests: 0, stripeCreateRequests: 0, accepted: {} };
      current.gatewayRequests++;
      const prior = current.accepted[operationId];
      if (prior) { await txn.put("ledger", current); return { prior }; }
      current.accepted[operationId] = {operationId,status:"attempt_committed",id:null,mode:"stripe-test",livemode:false};
      await txn.put("ledger",current);
      return { prior: null };
    });
    if (admission.prior) return Response.json(admission.prior, {status:admission.prior.status === "succeeded"?200:409});
    const key = this.env.STRIPE_TEST_SECRET_KEY;
    if (!/^sk_test_[A-Za-z0-9]{16,}$/.test(key ?? "")) return Response.json({error:"Test credential unavailable"},{status:503});
    const get = async (route:string) => {
      const res = await fetch("https://api.stripe.com/v1/" + route, {headers:{authorization:"Bearer "+key},redirect:"manual",signal:AbortSignal.timeout(10000)});
      if (!res.ok) { const error = await res.json() as {error?:{code?:string;type?:string}}; throw new Error("Stripe preflight "+route+" HTTP "+res.status+" "+(error.error?.code ?? error.error?.type ?? "")); }
      return res.json() as Promise<Record<string,unknown>>;
    };
    try {
      const account = await get("account");
      const balance = await get("balance");
      if (account.id !== "acct_1QNKKrGbPfXt7ec5" || balance.livemode !== false) throw new Error("Wrong account or mode");
      await this.ctx.storage.put("accountVerification",{accountId:account.id,livemode:false});
      const current = (await this.ctx.storage.get<Ledger>("ledger"))!;
      current.stripeCreateRequests++;
      await this.ctx.storage.put("ledger",current);
      const response = await fetch("https://api.stripe.com/v1/payment_intents",{
        method:"POST",redirect:"manual",signal:AbortSignal.timeout(15000),
        headers:{authorization:"Bearer "+key,"content-type":"application/x-www-form-urlencoded","idempotency-key":"pi-crash-hosted-v1-"+operationId},
        body:new URLSearchParams({amount:"100",currency:"gbp",payment_method:"pm_card_visa",confirm:"true",
          "automatic_payment_methods[enabled]":"true","automatic_payment_methods[allow_redirects]":"never","metadata[lab_operation]":operationId})
      });
      const data = await response.json() as {id?:string;amount?:number;currency?:string;livemode?:boolean;status?:string};
      if (!response.ok || data.livemode !== false || data.amount !== 100 || data.currency !== "gbp" || data.status !== "succeeded" || !data.id?.startsWith("pi_")) {
        throw new Error("Payment unproven");
      }
      const receipt:Receipt = {operationId,id:data.id,status:"succeeded",mode:"stripe-test",livemode:false,requestId:response.headers.get("request-id")};
      await this.ctx.storage.transaction(async txn => {
        const latest = (await txn.get<Ledger>("ledger"))!;
        latest.accepted[operationId] = receipt;
        await txn.put("ledger",latest);
      });
      return Response.json(receipt);
    } catch (error) {
      const latest = (await this.ctx.storage.get<Ledger>("ledger"))!;
      await this.ctx.storage.put("diagnostic", { stage: latest.stripeCreateRequests === 0 ? "before_payment_request" : "payment_request_attempted", error: error instanceof Error ? error.message : "Unknown error" });
      return Response.json({error:"Outcome uncertain or rejected; no automatic retry"},{status:502});
    }
  }
}
export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    // No public route: this Worker is reachable only through a service binding.
    if (!/^lab-[a-z0-9-]{1,70}$/.test(env.LAB_OPERATION_ID ?? "")) return new Response("Disabled",{status:503});
    return env.PAYMENT_LEDGER.getByName(env.LAB_OPERATION_ID).fetch(request);
  }
};

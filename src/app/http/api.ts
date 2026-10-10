import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Result } from "../../kernel";
import type { OrderError, WorkOrder } from "../../orders";
import type { Shop } from "../shop";
import { readState } from "./state";

export interface ApiOptions {
  allowedHosts: readonly string[];
  onError?: (error: unknown) => void;
  devTools?: { mergePullRequest(orderId: string): Promise<boolean> };
}

const text = z.string().trim().min(1).max(4000);
const orderId = z.string().regex(/^WO-\d{4}$/);
const bucket = z.enum(["lt5", "5-15", "15-30", "gt30"]);

const STATUS_FOR: Record<OrderError["kind"], 400 | 404 | 409> = {
  not_found: 404,
  invalid_transition: 409,
  invalid_spec: 400,
};

export function createApi(shop: Shop, options: ApiOptions): Hono {
  const api = new Hono();

  api.use("*", async (context, next) => {
    const host = context.req.header("host") ?? "";
    if (!options.allowedHosts.includes(host)) return context.json({ error: "unknown host" }, 403);

    if (context.req.method === "POST") {
      const origin = context.req.header("origin");
      if (origin && new URL(origin).host !== host) return context.json({ error: "cross-origin request refused" }, 403);
      if (!context.req.header("content-type")?.startsWith("application/json")) {
        return context.json({ error: "send application/json" }, 415);
      }
    }
    await next();
  });

  api.get("/api/state", (context) => context.json({ ...readState(shop), simulated: Boolean(options.devTools) }));

  api.get("/api/events", (context) => {
    const after = Number(context.req.query("after") ?? context.req.header("last-event-id") ?? 0) || 0;
    return streamSSE(context, async (stream) => {
      let lastSent = after;
      const send = async (event: { sequence: number; type: string }) => {
        if (event.sequence <= lastSent) return;
        lastSent = event.sequence;
        await stream.writeSSE({ id: String(event.sequence), data: JSON.stringify(event) });
      };

      const buffered: Array<{ sequence: number; type: string }> = [];
      let replaying = true;
      const unsubscribe = shop.log.subscribe((event) => {
        if (replaying) buffered.push(event);
        else void send(event).catch(() => undefined);
      });
      stream.onAbort(unsubscribe);

      for (const event of await shop.log.readAfter(after)) await send(event);
      replaying = false;
      for (const event of buffered) await send(event);

      while (!stream.aborted) {
        await stream.sleep(15_000);
        if (!stream.aborted) await stream.write(": keepalive\n\n");
      }
    });
  });

  api.post("/api/commands/send-message", async (context) => {
    const body = z.object({ text }).safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: "text is required" }, 400);

    void shop.manager.handleMessage(body.data.text).catch((error) => options.onError?.(error));
    return context.json({ accepted: true }, 202);
  });

  api.post("/api/commands/answer-decision", async (context) => {
    const body = z.object({ decisionId: z.string().min(1), answer: text }).safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: "decisionId and answer are required" }, 400);

    const decision = shop.chat.decision(body.data.decisionId);
    if (!decision) return context.json({ error: `no question ${body.data.decisionId}` }, 404);
    if (decision.answer !== null) return context.json({ error: "that question was already answered" }, 409);

    void shop.manager.answerDecision(body.data.decisionId, body.data.answer).catch((error) => options.onError?.(error));
    return context.json({ accepted: true }, 202);
  });

  const orderCommand = (path: string, run: (id: string, body: unknown) => Promise<Result<WorkOrder, OrderError>>, extra?: z.ZodRawShape) =>
    api.post(`/api/commands/${path}`, async (context) => {
      const body = z.object({ orderId, ...extra }).safeParse(await context.req.json().catch(() => null));
      if (!body.success) return context.json({ error: "invalid request" }, 400);

      const result = await run(body.data.orderId, body.data);
      return result.ok
        ? context.json({ id: result.value.id, status: result.value.status })
        : context.json({ error: result.error.message }, STATUS_FOR[result.error.kind]);
    });

  orderCommand("sign-order", (id) => shop.orderService.sign(id));
  orderCommand("retry-order", (id) => shop.flow.retry(id));
  orderCommand("discard-order", (id) => shop.orderService.discard(id));
  orderCommand("record-minutes", (id, body) => shop.orderService.recordMinutes(id, (body as { bucket: z.infer<typeof bucket> }).bucket), { bucket });

  if (options.devTools) {
    const { mergePullRequest } = options.devTools;
    api.post("/api/dev/merge-pull-request", async (context) => {
      const body = z.object({ orderId }).safeParse(await context.req.json().catch(() => null));
      if (!body.success) return context.json({ error: "invalid request" }, 400);
      return (await mergePullRequest(body.data.orderId)) ? context.json({ merged: true }) : context.json({ error: "no open pull request for that order" }, 404);
    });
  }

  return api;
}

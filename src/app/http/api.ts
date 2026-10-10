import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { followUpFromReview } from "../../delivery";
import type { Result } from "../../kernel";
import type { OrderError, WorkOrder } from "../../orders";
import type { TeamChange, TeamError } from "../../team";
import type { Shop } from "../shop";
import { readState } from "./state";

export interface ApiOptions {
  allowedHosts: readonly string[];
  onError?: (error: unknown) => void;
  devTools?: { mergePullRequest(orderId: string): Promise<boolean> };
}

const text = z.string().trim().min(1).max(4000);
const orderId = z.string().regex(/^WO-\d{4}$/);
const projectId = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);
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

  api.get("/api/state", (context) => context.json({ ...readState(shop, context.req.query("project")), simulated: Boolean(options.devTools) }));

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
    const body = z.object({ text, project: projectId.optional() }).safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: "text is required" }, 400);
    const desk = body.data.project ? shop.desk(body.data.project) : shop.desks[0];
    if (!desk) return context.json({ error: `no project ${body.data.project}` }, 404);

    void desk.manager.handleMessage(body.data.text).catch((error) => options.onError?.(error));
    return context.json({ accepted: true }, 202);
  });

  api.post("/api/commands/answer-decision", async (context) => {
    const body = z.object({ decisionId: z.string().min(1), answer: text }).safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: "decisionId and answer are required" }, 400);

    const desk = shop.desks.find((candidate) => candidate.chat.decision(body.data.decisionId));
    const decision = desk?.chat.decision(body.data.decisionId);
    if (!desk || !decision) return context.json({ error: `no question ${body.data.decisionId}` }, 404);
    if (decision.answer !== null) return context.json({ error: "that question was already answered" }, 409);

    void desk.manager.answerDecision(body.data.decisionId, body.data.answer).catch((error) => options.onError?.(error));
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
  orderCommand("apply-review", (id) => {
    const review = shop.activity.linksFor(id).review;
    if (review?.verdict !== "changes_requested") return Promise.resolve({ ok: false as const, error: { kind: "invalid_transition" as const, message: `${id} has no requested changes to apply` } });
    return shop.flow.followUp(id, followUpFromReview(review));
  });
  orderCommand("start-now", (id) => shop.flow.startNow(id));
  orderCommand("review-order", async (id) => shop.flow.requestReview(id));
  orderCommand("reassign-order", (id, body) => shop.flow.reassign(id, (body as { worker: string }).worker), { worker: z.string().regex(/^[a-z][a-z0-9-]{1,23}$/) });
  orderCommand("stop-order", async (id) => shop.flow.stop(id));
  orderCommand("approve-protected-paths", (id) => shop.flow.approveProtected(id));
  orderCommand("follow-up", (id, body) => shop.flow.followUp(id, (body as { text: string }).text), { text });
  orderCommand("discard-order", (id) => shop.flow.discard(id));
  orderCommand("record-minutes", (id, body) => shop.orderService.recordMinutes(id, (body as { bucket: z.infer<typeof bucket> }).bucket), { bucket });

  api.post("/api/commands/recheck", async (context) => {
    await shop.readiness.refresh();
    return context.json({ findings: shop.readiness.findings().length });
  });

  api.post("/api/commands/stop-run", async (context) => {
    const body = z.object({ runId: z.string().regex(/^run_[0-9a-f-]+$/) }).safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: "invalid request" }, 400);

    return (await shop.scheduler.cancel(body.data.runId)) ? context.json({ stopped: true }) : context.json({ error: "that run is not live" }, 409);
  });

  api.post("/api/commands/pause-shop", async (context) => {
    const paused = await shop.control.pause("paused by the director");
    return paused.ok ? context.json({ paused: true }) : context.json({ error: paused.error }, 409);
  });
  api.post("/api/commands/resume-shop", async (context) => {
    const resumed = await shop.control.resume();
    return resumed.ok ? context.json({ paused: false }) : context.json({ error: resumed.error }, 409);
  });

  const changeId = z.string().regex(/^chg_[0-9a-f-]+$/);
  const teamCommand = (path: string, run: (id: string) => Promise<Result<TeamChange, TeamError>>) =>
    api.post(`/api/commands/${path}`, async (context) => {
      const body = z.object({ changeId }).safeParse(await context.req.json().catch(() => null));
      if (!body.success) return context.json({ error: "invalid request" }, 400);

      const result = await run(body.data.changeId);
      return result.ok
        ? context.json({ id: result.value.id, status: result.value.status })
        : context.json({ error: result.error.message }, result.error.kind === "not_found" ? 404 : 409);
    });

  const serviceOf = (id: string) => (shop.desks.find((desk) => desk.roster.change(id)) ?? shop.desks[0]!).teamService;
  teamCommand("sign-team-change", (id) => serviceOf(id).sign(id));
  teamCommand("discard-team-change", (id) => serviceOf(id).discard(id));

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

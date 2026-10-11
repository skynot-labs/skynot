import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { followUpFromReview } from "../../delivery";
import type { Result } from "../../kernel";
import type { OrderError, WorkOrder } from "../../orders";
import { MAX_PROJECT_DESCRIPTION, MAX_PROJECT_NAME, PROJECT_ID, type Project, type ProjectFile, type ProjectRegistry } from "../../projects";
import type { TeamChange, TeamError } from "../../team";
import { PREFERENCE_KEY, setPreference } from "../preferences";
import { registrationProblem, type ProjectsFolder } from "../projects";
import type { Shop } from "../shop";
import { issueSession, pairingDesk, sessionIsValid, type OfficeAccess } from "./access";
import { CONTRACT } from "./contract";
import { readState } from "./state";

export interface ApiOptions {
  allowedHosts: readonly string[];
  // Set when the office answers beyond this machine; without it nothing asks for a session.
  access?: OfficeAccess;
  onError?: (error: unknown) => void;
  devTools?: { mergePullRequest(orderId: string): Promise<boolean> };
  // Only the director's console registers or describes a project; without this both commands are refused.
  projects?: { registry: ProjectRegistry; folder: () => Promise<ProjectsFolder>; policyRepos: readonly string[] };
}

const text = z.string().trim().min(1).max(4000);
const orderId = z.string().regex(/^WO-\d{4}$/);
const projectId = z.string().regex(PROJECT_ID);
const bucket = z.enum(["lt5", "5-15", "15-30", "gt30"]);
const command = z.string().min(1);
const roleName = z.string().regex(/^[a-z][a-z0-9-]{1,23}$/);
const MAX_FOCUS = 300;
const registration = z.object({
  id: projectId,
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  baseBranch: z.string().min(1),
  verifyCommands: z.array(command).min(1),
  setupCommand: command.optional(),
  protectedPaths: z.array(command).optional(),
  name: z.string().trim().min(1).max(MAX_PROJECT_NAME).optional(),
  description: z.string().trim().min(1).max(MAX_PROJECT_DESCRIPTION).optional(),
});
const profile = z.object({ project: projectId, name: z.string().nullable().optional(), description: z.string().nullable().optional() });
const preference = z.object({ key: z.string().regex(PREFERENCE_KEY), value: z.record(z.string(), z.unknown()).nullable() });
const NOT_MANAGED = "projects are not managed from the console in this mode";
const invalid = (error: z.ZodError): string => `invalid request: ${error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ")}`;

function toProjectFile({ repo, baseBranch, verifyCommands, setupCommand, protectedPaths, name, description }: z.infer<typeof registration>): ProjectFile {
  return {
    version: 1,
    ...(name && { name }),
    ...(description && { description }),
    repo,
    base_branch: baseBranch,
    setup_command: setupCommand ?? null,
    verify_commands: verifyCommands,
    protected_paths: protectedPaths ?? [],
  };
}

const STATUS_FOR: Record<OrderError["kind"], 400 | 404 | 409> = {
  not_found: 404,
  invalid_transition: 409,
  invalid_spec: 400,
};

export function createApi(shop: Shop, options: ApiOptions): Hono {
  const api = new Hono();

  const { access } = options;
  const hosts = access ? [...options.allowedHosts, new URL(access.address).host] : options.allowedHosts;
  const pair = access && pairingDesk(access);

  api.use("*", async (context, next) => {
    const host = context.req.header("host") ?? "";
    if (!hosts.includes(host)) return context.json({ error: "unknown host" }, 403);

    const origin = context.req.header("origin");
    const fromStudio = origin !== undefined && access?.studios.includes(origin) === true;
    if (fromStudio) {
      context.header("access-control-allow-origin", origin);
      context.header("access-control-allow-headers", "authorization, content-type");
      context.header("vary", "origin");
      if (context.req.method === "OPTIONS") return context.body(null, 204);
    }

    if (context.req.method === "POST") {
      if (origin && !fromStudio && (!URL.canParse(origin) || new URL(origin).host !== host)) return context.json({ error: "cross-origin request refused" }, 403);
      if (!context.req.header("content-type")?.startsWith("application/json")) {
        return context.json({ error: "send application/json" }, 415);
      }
    }

    const { path } = context.req;
    const needsSession = path.startsWith("/api/") && path !== "/api/meta" && path !== "/api/sessions";
    if (access && needsSession && !sessionIsValid(access, context.req.header("authorization")?.replace(/^Bearer /, "") ?? "")) {
      return context.json({ error: "pair this studio with the office first" }, 401);
    }
    await next();
  });

  api.get("/api/meta", (context) => context.json({ contract: CONTRACT, requiresSession: Boolean(access) }));

  api.post("/api/sessions", async (context) => {
    if (!access || !pair) return context.json({ error: "this office takes no sessions: it answers on this machine only" }, 404);
    const body = z.object({ secret: z.string().min(1).max(200) }).safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: "the pairing secret is required" }, 400);

    const outcome = pair(body.data.secret);
    if (outcome === "locked") return context.json({ error: "too many wrong secrets: wait a minute" }, 429);
    return outcome === "paired" ? context.json(issueSession(access)) : context.json({ error: "that is not this office's pairing secret" }, 401);
  });

  api.get("/api/state", (context) => {
    const project = context.req.query("project");
    if (project && !shop.desk(project)) return context.json({ error: `no project ${project}` }, 404);
    return context.json({ ...readState(shop, project), simulated: Boolean(options.devTools) });
  });

  api.get("/api/events", (context) => {
    const after = Number(context.req.query("after") ?? context.req.header("last-event-id") ?? 0) || 0;
    return streamSSE(context, async (stream) => {
      await stream.write(": open\n\n");
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
  api.post("/api/commands/sign-plan", async (context) => {
    const body = z.object({ plan: orderId }).safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: "invalid request" }, 400);

    const result = await shop.orderService.signPlan(body.data.plan);
    return result.ok ? context.json({ plan: body.data.plan, signed: result.value.map((order) => order.id) }) : context.json({ error: result.error.message }, STATUS_FOR[result.error.kind]);
  });
  orderCommand("retry-order", (id) => shop.flow.retry(id));
  orderCommand("apply-review", (id) => {
    const review = shop.activity.linksFor(id).review;
    if (review?.verdict !== "changes_requested") return Promise.resolve({ ok: false as const, error: { kind: "invalid_transition" as const, message: `${id} has no requested changes to apply` } });
    return shop.flow.followUp(id, followUpFromReview(review));
  });
  orderCommand("answer-question", (id, body) => shop.flow.answerQuestion(id, (body as { answer: string }).answer), { answer: text });
  orderCommand("start-now", (id) => shop.flow.startNow(id));
  orderCommand("review-order", async (id) => shop.flow.requestReview(id));
  orderCommand("reassign-order", (id, body) => shop.flow.reassign(id, (body as { worker: string }).worker), { worker: roleName });
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

  for (const [path, run, paused] of [
    ["pause-project", (id: string) => shop.control.pauseProject(id, "paused by the director"), true],
    ["resume-project", (id: string) => shop.control.resumeProject(id), false],
  ] as const) {
    api.post(`/api/commands/${path}`, async (context) => {
      const body = z.object({ project: projectId }).safeParse(await context.req.json().catch(() => null));
      if (!body.success) return context.json({ error: "invalid request" }, 400);
      if (!shop.desk(body.data.project)) return context.json({ error: `no project ${body.data.project}` }, 404);

      const result = await run(body.data.project);
      return result.ok ? context.json({ project: body.data.project, paused }) : context.json({ error: result.error }, 409);
    });
  }

  const registered: Project[] = [];
  api.post("/api/commands/register-project", async (context) => {
    if (!options.projects) return context.json({ error: NOT_MANAGED }, 409);
    const { registry, folder, policyRepos } = options.projects;
    const body = registration.safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: invalid(body.error) }, 400);

    let problem: string | null;
    try {
      problem = registrationProblem(body.data, [...shop.desks.map((desk) => desk.project), ...registered], await folder(), policyRepos);
    } catch (error) {
      problem = (error as Error).message;
    }
    if (problem) return context.json({ error: problem }, 409);

    const result = await registry.register(body.data.id, toProjectFile(body.data));
    if (!result.ok) return context.json({ error: result.error }, 409);
    registered.push(result.value);
    await shop.log.record([{ type: "projects.registered", payload: { projectId: result.value.id } }]);
    return context.json({ id: result.value.id, restartRequired: true }, 201);
  });

  api.post("/api/commands/describe-project", async (context) => {
    if (!options.projects) return context.json({ error: NOT_MANAGED }, 409);
    const body = profile.safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: invalid(body.error) }, 400);
    const { project, name, description } = body.data;
    const desk = shop.desk(project);
    if (!desk) return context.json({ error: `no project ${project}` }, 404);

    const result = await options.projects.registry.describe(project, { ...(name !== undefined && { name }), ...(description !== undefined && { description }) });
    if (!result.ok) return context.json({ error: result.error }, 409);
    desk.project = { ...desk.project, name: result.value.name, description: result.value.description };
    await shop.log.record([{ type: "projects.described", payload: { projectId: project } }]);
    return context.json({ id: project, name: desk.project.name, description: desk.project.description });
  });

  api.post("/api/commands/set-preference", async (context) => {
    const body = preference.safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: "invalid request" }, 400);

    const result = await setPreference(shop.log, shop.preferences, body.data.key, body.data.value);
    return result.ok ? context.json({ key: body.data.key, value: body.data.value }) : context.json({ error: result.error.message }, result.error.kind === "too_large" ? 413 : 409);
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

  api.post("/api/commands/set-focus", async (context) => {
    const body = z.object({ project: projectId, role: roleName, focus: z.string().trim().min(3).max(MAX_FOCUS) }).safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: invalid(body.error) }, 400);
    const desk = shop.desk(body.data.project);
    if (!desk) return context.json({ error: `no project ${body.data.project}` }, 404);

    const result = await desk.teamService.refocus(body.data.role, body.data.focus);
    return result.ok ? context.json({ role: body.data.role, focus: body.data.focus }) : context.json({ error: result.error.message }, 409);
  });

  const serviceOf = (id: string) => (shop.desks.find((desk) => desk.roster.change(id)) ?? shop.desks[0]!).teamService;
  teamCommand("sign-team-change", (id) => serviceOf(id).sign(id));
  teamCommand("discard-team-change", (id) => serviceOf(id).discard(id));

  const briefingId = z.string().regex(/^brf_[0-9a-f-]+$/);
  for (const [path, run] of [
    ["sign-briefing-change", (id: string) => shop.briefingService.sign(id)],
    ["discard-briefing-change", (id: string) => shop.briefingService.discard(id)],
  ] as const) {
    api.post(`/api/commands/${path}`, async (context) => {
      const body = z.object({ changeId: briefingId }).safeParse(await context.req.json().catch(() => null));
      if (!body.success) return context.json({ error: "invalid request" }, 400);

      const result = await run(body.data.changeId);
      return result.ok ? context.json({ id: result.value.id, status: result.value.status }) : context.json({ error: result.error.message }, result.error.kind === "not_found" ? 404 : 409);
    });
  }

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

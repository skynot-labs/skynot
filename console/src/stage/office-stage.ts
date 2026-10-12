// The console's content security policy forbids eval; this swaps Pixi's generated shaders code for a plain one.
import "pixi.js/unsafe-eval";
import { Application, Container, Rectangle, Sprite, Texture, type FederatedPointerEvent } from "pixi.js";
import { avatarBounds, drawPixelAvatar } from "../ui/avatar-renderer";
import { assignStudioSeats, DECISION_SIGN, deskKit, floorPoint, getStudioLayout, officeLayout, seatSpots } from "../ui/office-layout";
import { Office, type Piece, type SceneAgent, type SceneState } from "../ui/office-renderer";
import { along, apart, idlePose, pathLength, route, TILES_PER_SECOND, type Floor, type Haunt, type IdlePose, type Spot } from "../studio/idle-life";
import { Ambient } from "./ambient";
import { Reactions } from "./reactions";
import { normalizeStudioPreferences } from "../studio/model";
import { AgentActor, AVATAR_SCALE } from "./agent-actor";
import { HOME, panBy, zoomAt, type View } from "./camera";
import { Plate, words } from "./plates";

export type StageHandlers = {
  onAgent: (id: string) => void;
  onBubble: (id: string) => void;
  onDecisions: () => void;
  onBoard: () => void;
};

const FRAME = { width: officeLayout.width, height: officeLayout.height };
const BEHIND = -1000;
const IN_FRONT = 1000;
const DRAG_STARTS_AT = 4;
// Places to stand that no piece of furniture owns.
const OPEN_HAUNTS: Haunt[] = [
  { u: 0.6, v: 3.4, doing: "looking outside" },
  { u: 0.6, v: 9.2, doing: "looking outside" },
  { u: 10.5, v: 0.8, doing: "reading the wall" },
  { u: 8.6, v: 6.6, doing: "stretching" },
  { u: 8.8, v: 12.3, doing: "thinking" },
];
const SOLES = 27;
const FIGURE_MARGIN = 1;
const MAX_FRAME_MS = 100;
const NIGHT_FROM = 20;
const NIGHT_UNTIL = 6;
const NIGHT_SHADE = 0.16;
const LIGHTS_OFF = 0.42;
const CONFETTI = ["#f3c299", "#b4debf", "#d2c3ed", "#f08a8f", "#f3e3a2", "#93b7d5"];
type Errand = { beside: string; doing: string; path: Spot[]; length: number; walked: number };

/**
 * The live office. The scenery is painted once by the still painter and cut into sprites ordered by depth; the team
 * are actors that move between them; labels sit above everything. The whole world sits under one camera.
 */
export class OfficeStage {
  private readonly world = new Container();
  private readonly scenery = new Container();
  private readonly overlay = new Container();
  private readonly seatLabels = new Container();
  // Above the name tags: the one sign the director is meant to act on.
  private readonly signs = new Container();
  private readonly actors = new Map<string, AgentActor>();
  private readonly figures = new Map<string, Texture>();
  private readonly decisions = new Plate({ fill: "#dae3d3", color: "#46514a", size: 15, bold: true, height: 52, padding: 16, minWidth: 190, tail: true });
  private readonly inbox = words("OPEN INBOX →", { fontSize: 11, fill: "#5e675a" });
  private readonly boardLabel = words("", { fontSize: 14, fontWeight: "bold", fill: "#a9a3b7" });
  private readonly more = new Plate({ fill: "#31363fe8", color: "#d7e6d8", size: 15, height: 28, padding: 10, minWidth: 200 });
  private readonly ambient = new Ambient(FRAME);
  private readonly reactions = new Reactions();
  private readonly errands = new Map<string, Errand>();
  private readonly seen = new Map<string, { failed: boolean; finished: boolean }>();
  private tallies: { delivered: number; pending: number } | null = null;
  private lastFrame = 0;
  private readonly still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private scene: SceneState | null = null;
  private seats: ReturnType<typeof assignStudioSeats<SceneAgent>> = [];
  private painted = "";
  private floor: Floor = { width: officeLayout.room.width, depth: officeLayout.room.depth, blocked: [] };
  private haunts: Haunt[] = OPEN_HAUNTS;
  private view: View = HOME;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private readonly unbind: Array<() => void> = [];

  private constructor(
    private readonly app: Application,
    private readonly handlers: () => StageHandlers,
  ) {
    this.scenery.sortableChildren = true;
    this.world.addChild(this.scenery, this.ambient, this.overlay, this.signs, this.reactions);
    app.stage.addChild(this.world);

    this.decisions.eventMode = "static";
    this.decisions.cursor = "pointer";
    this.decisions.on("pointertap", () => this.tap(() => this.handlers().onDecisions()));
    this.inbox.anchor.set(0.5, 0.5);
    this.inbox.y = 42;
    this.decisions.caption.y = 20;
    this.decisions.addChild(this.inbox);
    const [dx, dy] = floorPoint(DECISION_SIGN.u, DECISION_SIGN.v, DECISION_SIGN.z);
    this.decisions.position.set(dx, dy - 27);
    this.boardLabel.anchor.set(0.5, 1);
    this.boardLabel.position.set(...floorPoint(2.57, officeLayout.room.depth + 0.64, -30));
    const [mx, my] = floorPoint(6.5, officeLayout.room.depth + 1.1, -29);
    this.more.position.set(mx, my + 32);
    for (const still of [this.inbox, this.boardLabel, this.more]) still.eventMode = "none";
    this.overlay.addChild(this.seatLabels, this.boardLabel, this.more);
    this.signs.addChild(this.decisions);

    this.bindCamera();
    app.ticker.add(() => this.frame());
  }

  static async mount(host: HTMLElement, handlers: () => StageHandlers): Promise<OfficeStage> {
    const app = new Application();
    await app.init({
      ...FRAME,
      backgroundAlpha: 0,
      antialias: false,
      resolution: Math.min(2, Math.max(1, window.devicePixelRatio)),
      preference: "webgl",
    });
    host.appendChild(app.canvas);
    return new OfficeStage(app, handlers);
  }

  show(scene: SceneState): void {
    this.scene = scene;
    const settings = normalizeStudioPreferences(scene.settings);
    const seats = assignStudioSeats(scene.agents, getStudioLayout(settings.layout));
    this.seats = seats;
    const key = JSON.stringify([scene.name, scene.accent, settings, seats.map((seat) => [seat.u, seat.v, seat.agent?.name, deskKit(seat.agent)])]);
    if (key !== this.painted) {
      this.painted = key;
      this.paint(scene);
    }

    const seated = new Set<string>();
    for (const seat of seats) {
      const agent = seat.agent;
      if (!agent) continue;
      seated.add(agent.id);
      const actor = this.actors.get(agent.id);
      if (actor) actor.cast(agent, seat);
      else this.enter(agent, seat);
    }
    for (const [id, actor] of this.actors)
      if (!seated.has(id)) {
        actor.destroy();
        this.actors.delete(id);
      }

    const lit = scene.pending > 0;
    this.decisions.write(lit ? `${scene.pending} TO DECIDE` : "DECISION DESK", lit ? "#ecd0a7" : "#dae3d3");
    this.boardLabel.text = `BOARD · ${scene.openOrders} OPEN →`;
    const unseated = scene.agents.length - seated.size;
    this.more.visible = unseated > 0;
    this.more.write(`+${unseated} MORE ON THE TEAM`);
    const hour = new Date().getHours();
    const night = hour >= NIGHT_FROM || hour < NIGHT_UNTIL;
    this.ambient.set(settings.season, scene.paused ? LIGHTS_OFF : night ? NIGHT_SHADE : 0, !this.still && !scene.paused);
    this.frame();
    this.react(scene);
  }

  destroy(): void {
    this.unbind.forEach((off) => off());
    this.app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
  }

  private enter(agent: SceneAgent, seat: { u: number; v: number }): void {
    const actor = new AgentActor(agent, seat, (who, isSeated, frame) => this.figure(who, isSeated, frame), {
      agent: () => this.tap(() => this.handlers().onAgent(agent.id)),
      bubble: () => this.tap(() => this.handlers().onBubble(agent.id)),
    });
    this.actors.set(agent.id, actor);
    this.scenery.addChild(actor.body, actor.screen);
    this.overlay.addChild(actor.tags);
  }

  // What just changed says what to celebrate or flag; the first scene only sets the baseline.
  private react(scene: SceneState): void {
    const moving = !this.still;
    for (const agent of scene.agents) {
      const now = { failed: agent.status === "error", finished: agent.bubble?.tone === "done" };
      const before = this.seen.get(agent.id);
      this.seen.set(agent.id, now);
      const actor = this.actors.get(agent.id);
      if (!before || !actor || !moving) continue;
      if (now.failed && !before.failed) {
        this.reactions.say(actor.above.x, actor.above.y, "!", "#f08a8f");
        this.reactions.burst(actor.above.x, actor.above.y, ["#f08a8f", "#b9545a"], 10, 0.1);
      }
      if (now.finished && !before.finished) {
        this.reactions.say(actor.above.x, actor.above.y, "✓", "#b4debf");
        this.reactions.burst(actor.above.x, actor.above.y, ["#b4debf", "#f3e3a2", "#ffffff"], 16);
      }
    }
    const tallies = { delivered: scene.delivered ?? 0, pending: scene.pending };
    const before = this.tallies;
    this.tallies = tallies;
    if (!before || !moving) return;
    if (tallies.delivered > before.delivered) {
      const [x, y] = floorPoint(officeLayout.room.width / 2, officeLayout.room.depth / 2, 190);
      this.reactions.burst(x, y, CONFETTI, 70, 0.34);
      this.reactions.say(x, y, "DELIVERED", "#f3e3a2");
    }
    if (tallies.pending > before.pending)
      this.reactions.burst(this.decisions.x, this.decisions.y + 20, ["#ecd0a7", "#f3c299"], 14, 0.12);
  }

  // Work done beside someone is walked to: out while it lasts, back to the desk when it ends.
  private errand(agent: SceneAgent, seat: Spot, elapsed: number): IdlePose | undefined {
    const wanted = agent.errand ?? null;
    const host = wanted && this.seats.find((other) => other.agent?.id === wanted.beside);
    let errand = this.errands.get(agent.id);
    if (wanted && host && errand?.beside !== wanted.beside) {
      const path = route(this.floor, seatSpots(seat).standsUp, seatSpots(host).visitor);
      if (path) {
        errand = { beside: wanted.beside, doing: wanted.doing, path, length: pathLength(path), walked: 0 };
        this.errands.set(agent.id, errand);
      }
    }
    if (!errand) return undefined;
    const out = Boolean(host) && wanted?.beside === errand.beside;
    if (out) errand.doing = wanted!.doing;
    const step = this.still ? errand.length : (elapsed / 1000) * TILES_PER_SECOND;
    errand.walked = Math.max(0, Math.min(errand.length, errand.walked + (out ? step : -step)));
    if (!out && errand.walked === 0) {
      this.errands.delete(agent.id);
      return undefined;
    }
    const there = out && errand.walked === errand.length;
    return {
      ...along(errand.path, errand.walked),
      walking: !there,
      doing: there ? errand.doing : null,
      ...(there ? { beside: errand.beside } : {}),
    };
  }

  private frame(): void {
    const scene = this.scene;
    if (!scene) return;
    const time = this.still ? 0 : performance.now();
    const elapsed = Math.min(MAX_FRAME_MS, Math.max(0, time - this.lastFrame));
    this.lastFrame = time;
    const poses = new Map<string, IdlePose>();
    for (const seat of this.seats) {
      const agent = seat.agent;
      if (!agent) continue;
      const roams = agent.status === "idle" && !scene.paused;
      const haunts = this.haunts.filter((haunt) => haunt.owner !== agent.id);
      poses.set(
        agent.id,
        this.errand(agent, seat, elapsed) ??
          (roams ? idlePose(agent.id, seatSpots(seat).standsUp, this.floor, haunts, time) : null),
      );
    }
    const ids = [...poses.keys()];
    apart(ids.map((id) => poses.get(id) ?? null)).forEach((pose, index) => poses.set(ids[index]!, pose));
    // A visit is a conversation only while its host is at the desk to have it.
    const heard = new Set<string>();
    for (const pose of poses.values()) if (pose?.beside && poses.get(pose.beside) === null) heard.add(pose.beside);
    for (const [id, pose] of poses)
      this.actors
        .get(id)
        ?.frame(time, pose, pose?.beside && heard.has(pose.beside) ? "speaks" : heard.has(id) ? "listens" : null);
    this.reactions.tick(elapsed);
    this.ambient.tick(elapsed, time);
    this.decisions.pivot.y = scene.pending > 0 && time ? Math.round(Math.sin(time / 300) * 2) : 0;
  }

  private paint(scene: SceneState): void {
    for (const sprite of [...this.scenery.children, ...this.seatLabels.children])
      if (sprite.label === "scenery") sprite.destroy({ texture: true, textureSource: true });
    const scratch = document.createElement("canvas");
    scratch.width = FRAME.width;
    scratch.height = FRAME.height;
    const pieces = new Office(scratch).pieces(scene);
    for (const piece of pieces) this.place(piece);
    this.floor = { ...this.floor, blocked: pieces.flatMap((piece) => (piece.footprint ? [piece.footprint] : [])) };
    this.haunts = [...OPEN_HAUNTS, ...pieces.flatMap((piece) => (piece.haunt ? [piece.haunt] : []))];
  }

  private place(piece: Piece): void {
    const sprite = new Sprite(pixelTexture(piece.canvas));
    sprite.label = "scenery";
    // Under an interactive stage, Pixi lets anything that is not "none" swallow the click meant for what is behind it.
    sprite.eventMode = "none";
    sprite.position.set(piece.x, piece.y);
    if (piece.kind === "labels") {
      this.seatLabels.addChild(sprite);
      return;
    }
    sprite.zIndex = piece.kind === "base" ? BEHIND : piece.kind === "prop" ? piece.depth : IN_FRONT;
    if (piece.kind === "board") {
      sprite.eventMode = "static";
      sprite.cursor = "pointer";
      sprite.on("pointerover", () => (this.boardLabel.style.fill = "#ffffff"));
      sprite.on("pointerout", () => (this.boardLabel.style.fill = "#a9a3b7"));
      sprite.on("pointertap", () => this.tap(() => this.handlers().onBoard()));
    }
    this.scenery.addChild(sprite);
  }

  private figure(agent: SceneAgent, seated: boolean, frame: number): Texture {
    const key = `${JSON.stringify(agent.avatar)}|${seated}|${frame}`;
    const known = this.figures.get(key);
    if (known) return known;
    const bounds = avatarBounds(agent.avatar);
    const half = Math.max(8 - bounds.left, bounds.right - 8) + FIGURE_MARGIN;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(half * 2 * AVATAR_SCALE);
    canvas.height = Math.ceil((SOLES - bounds.top + FIGURE_MARGIN) * AVATAR_SCALE);
    drawPixelAvatar(
      canvas.getContext("2d")!,
      agent.avatar,
      (half - 8) * AVATAR_SCALE,
      (FIGURE_MARGIN - bounds.top) * AVATAR_SCALE,
      AVATAR_SCALE,
      seated,
      frame,
    );
    const texture = pixelTexture(canvas);
    this.figures.set(key, texture);
    return texture;
  }

  // A drag that moved the camera is not a click on what it started over.
  private tap(act: () => void): void {
    if (!this.drag?.moved) act();
  }

  private look(view: View): void {
    this.view = view;
    this.world.scale.set(view.scale);
    this.world.position.set(view.x, view.y);
  }

  private bindCamera(): void {
    const { stage, canvas } = this.app;
    const listen = <K extends keyof HTMLElementEventMap>(type: K, on: (event: HTMLElementEventMap[K]) => void) => {
      canvas.addEventListener(type, on as EventListener, { passive: false });
      this.unbind.push(() => canvas.removeEventListener(type, on as EventListener));
    };
    // A pinch arrives as a wheel with ctrl held; a plain wheel keeps scrolling the page.
    listen("wheel", (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = canvas.getBoundingClientRect();
      const at = {
        x: ((event.clientX - box.left) / box.width) * FRAME.width,
        y: ((event.clientY - box.top) / box.height) * FRAME.height,
      };
      this.look(zoomAt(this.view, Math.exp(-event.deltaY / 200), at, FRAME));
    });
    listen("dblclick", () => this.look(HOME));
    stage.eventMode = "static";
    stage.hitArea = new Rectangle(0, 0, FRAME.width, FRAME.height);
    stage.on("pointerdown", (event: FederatedPointerEvent) => {
      this.drag = { x: event.global.x, y: event.global.y, moved: false };
    });
    stage.on("pointermove", (event: FederatedPointerEvent) => {
      const drag = this.drag;
      if (!drag || !event.buttons || this.view.scale === 1) return;
      const dx = event.global.x - drag.x;
      const dy = event.global.y - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_STARTS_AT) return;
      this.look(panBy(this.view, dx, dy, FRAME));
      this.drag = { x: event.global.x, y: event.global.y, moved: true };
    });
  }
}

function pixelTexture(canvas: HTMLCanvasElement): Texture {
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

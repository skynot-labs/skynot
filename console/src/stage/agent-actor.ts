import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { avatarBounds } from "../ui/avatar-renderer";
import { deskKit, deskScreens, floorPoint, SEAT_LABEL_DROP, seatSpots } from "../ui/office-layout";
import { BUBBLE_FILL, BUBBLE_STEP_MS, SCREEN, SEATED_TOP, type SceneAgent } from "../ui/office-renderer";
import type { IdlePose, Spot } from "../studio/idle-life";
import { Plate } from "./plates";

export const AVATAR_SCALE = 3.2;
// Sprite rows from the top of the avatar grid to its soles, and how far a chair lifts them off the floor.
const SOLES = 27;
const CHAIR_LIFT = Math.round(SEATED_TOP - SOLES * AVATAR_SCALE);
const WALK_STEP_MS = 180;
const TYPE_STEP_MS = 500;
const TALK_TURN_MS = 1400;

export type Figures = (agent: SceneAgent, seated: boolean, frame: number) => Texture;
type Taps = { agent: () => void; bubble: () => void };

/** One member of the team in the office: a body among the furniture and its tags above everything. */
export class AgentActor {
  readonly body = new Container();
  readonly screen = new Graphics();
  readonly tags = new Container();
  private readonly shadow = new Graphics().ellipse(0, 0, 17, 7).fill({ color: 0x000000, alpha: 0.14 });
  private readonly figure = new Sprite();
  private readonly outline = new Graphics();
  private readonly name = new Plate({ fill: "#31363fe8", color: "#d7e6d8", size: 15, height: 28, padding: 10, minWidth: 70 });
  private readonly bubble = new Plate({ fill: "#c9c6d4", color: "#2f3340", size: 14, bold: true, height: 24, padding: 10, tail: true });
  private readonly note = new Plate({ fill: "#f4f1e6d9", color: "#5a6170", size: 12, height: 18, padding: 7 });
  private agent: SceneAgent;
  private seat: Spot;
  private lastX = 0;
  /** Just over this agent's head, where a reaction to something it did belongs. */
  readonly above = { x: 0, y: 0 };
  private hovered = false;

  constructor(agent: SceneAgent, seat: Spot, private readonly figures: Figures, taps: Taps) {
    this.agent = agent;
    this.seat = seat;
    this.figure.anchor.set(0.5, 1);
    this.body.addChild(this.shadow, this.figure);
    this.tags.addChild(this.outline, this.name, this.bubble, this.note);
    for (const still of [this.shadow, this.screen, this.outline, this.name, this.note]) still.eventMode = "none";
    this.figure.eventMode = "static";
    this.figure.cursor = "pointer";
    this.figure.on("pointerover", () => (this.hovered = true));
    this.figure.on("pointerout", () => (this.hovered = false));
    this.figure.on("pointertap", taps.agent);
    this.bubble.eventMode = "static";
    this.bubble.cursor = "pointer";
    this.bubble.on("pointertap", taps.bubble);
    this.cast(agent, seat);
  }

  cast(agent: SceneAgent, seat: Spot): void {
    this.agent = agent;
    this.seat = seat;
    this.screen.clear();
    for (const screen of deskScreens(seat, deskKit(agent))) {
      const corner = (du: number, z: number) => floorPoint(screen.u + du, screen.v - 0.015, z);
      this.screen
        .poly([corner(0.045, SCREEN.top - 3), corner(screen.width - 0.045, SCREEN.top - 3), corner(screen.width - 0.045, SCREEN.bottom + 4), corner(0.045, SCREEN.bottom + 4)].flat())
        .fill("#91b8bd");
    }
    this.screen.zIndex = seat.u + seat.v + 1.001;
    this.name.write(agent.name.slice(0, 17), undefined, agent.status === "working" ? "#d2c3ed" : "#d7e6d8");
  }

  /**
   * `time` is zero for a still office: nothing bobs, blinks or bounces. `talk` is this agent's side of a
   * conversation, when it is in one: the two take turns holding up the dots.
   */
  frame(time: number, pose: IdlePose, talk: "speaks" | "listens" | null = null): void {
    const { agent, seat } = this;
    const working = agent.status === "working";
    const stride = pose?.walking ? 1 + (Math.floor(time / WALK_STEP_MS) % 2) : 0;
    const spots = seatSpots(seat);
    const [x, y] = pose ? floorPoint(pose.u, pose.v) : floorPoint(spots.chair.u, spots.chair.v);
    const lift = pose ? (stride === 1 ? 2 : 0) : CHAIR_LIFT;
    const typing = !pose && working ? Math.floor(time / TYPE_STEP_MS) % 2 : 0;

    this.body.position.set(x, y);
    this.body.zIndex = pose ? pose.u + pose.v - 0.4 : seat.u + seat.v + 0.2;
    this.shadow.visible = pose !== null;
    this.figure.texture = this.figures(agent, pose === null, pose ? stride : typing);
    this.figure.y = -lift;
    if (pose?.walking && Math.abs(x - this.lastX) > 0.5) this.figure.scale.x = x < this.lastX ? -1 : 1;
    if (!pose) this.figure.scale.x = 1;
    this.lastX = x;

    this.screen.visible = working && pose === null;
    this.screen.alpha = 0.45 + 0.2 * Math.sin(time / 260);

    const top = -lift - (SOLES - avatarBounds(agent.avatar).top) * AVATAR_SCALE;
    this.tags.position.set(x, y);
    this.name.y = pose ? 9 : SEAT_LABEL_DROP;
    this.outline.clear();
    if (this.hovered)
      this.outline
        .rect(-this.figure.width / 2 - 3, top - 4, this.figure.width + 6, -lift - top + 8)
        .stroke({ color: "#d7efd9", width: 2 });

    const said = agent.bubble;
    this.bubble.visible = said !== null;
    if (said) {
      const step = Math.floor(time / BUBBLE_STEP_MS);
      const calls = said.tone !== "busy" && said.tone !== "wait";
      this.bubble.write(said.tone === "busy" ? "·".repeat(1 + (step % 3)).padEnd(3, " ") : said.text, BUBBLE_FILL[said.tone]);
      this.bubble.position.set(3, top - 38 - (calls && step % 2 ? 3 : 0));
    }
    const turn = Math.floor(time / TALK_TURN_MS) % 2;
    const dots = time > 0 && (talk === "speaks" ? turn === 0 : talk === "listens" && turn === 1);
    const noted = dots ? "· · ·" : (pose?.doing ?? null);
    this.note.visible = !said && noted !== null;
    if (noted) {
      this.note.write(noted);
      this.note.position.set(3, top - 26);
    }
    this.above.x = x;
    this.above.y = y + top - 30;
  }

  destroy(): void {
    this.body.destroy({ children: true });
    this.screen.destroy();
    this.tags.destroy({ children: true });
  }
}

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { avatarBounds } from "../ui/avatar-renderer";
import { deskKit, deskScreens, floorPoint, SEAT_LABEL_DROP, seatSpots } from "../ui/office-layout";
import { BUBBLE_FILL, BUBBLE_STEP_MS, busyDots, SCREEN, SEATED_TOP, type SceneAgent } from "../ui/office-renderer";
import type { IdlePose, Spot } from "../studio/idle-life";
import type { Box } from "./legible";
import { Plate } from "./plates";

export const AVATAR_SCALE = 3.2;
// Sprite rows from the top of the avatar grid to its soles, and how far a chair lifts them off the floor.
const SOLES = 27;
const CHAIR_LIFT = Math.round(SEATED_TOP - SOLES * AVATAR_SCALE);
const WALK_STEP_MS = 180;
const TYPE_STEP_MS = 500;
const TALK_TURN_MS = 1400;
const BUBBLE_HOP = 3;
export const BUBBLE_TEXT = 14;
export const NAME_TEXT = 12;

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
  private readonly name = new Plate({ fill: "#31363f99", color: "#aeb8b1", size: NAME_TEXT, height: 20, padding: 7 });
  private readonly bubble = new Plate({ fill: "#c9c6d4", color: "#2f3340", size: BUBBLE_TEXT, bold: true, height: 24, padding: 10, tail: true });
  private readonly note = new Plate({ fill: "#f4f1e6d9", color: "#5a6170", size: 12, height: 18, padding: 7 });
  private agent: SceneAgent;
  private seat: Spot;
  private lastX = 0;
  /** Just over this agent's head, where a reaction to something it did belongs. */
  readonly above = { x: 0, y: 0 };
  /** Where the bubble would sit were nothing in its way, for the stage to arrange among the others. */
  speech: Box | null = null;
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
    // The screens face away from the room: what shows of one that is on is the light spilling past its edges.
    for (const screen of deskScreens(seat, deskKit(agent))) {
      const edge = (du: number, z: number) => floorPoint(screen.u + du, screen.v, z);
      const strip = (fromU: number, toU: number, fromZ: number, toZ: number) =>
        this.screen.poly([edge(fromU, toZ), edge(toU, toZ), edge(toU, fromZ), edge(fromU, fromZ)].flat()).fill("#c9f0f3");
      strip(-0.03, screen.width + 0.03, SCREEN.top, SCREEN.top + 3);
      strip(-0.05, 0, SCREEN.bottom + 2, SCREEN.top + 3);
      strip(screen.width, screen.width + 0.05, SCREEN.bottom + 2, SCREEN.top + 3);
    }
    this.screen.zIndex = seat.u + seat.v + 1.001;
    this.name.write(agent.name.slice(0, 17), undefined, agent.status === "working" ? "#d2c3ed" : "#aeb8b1");
  }

  /**
   * `time` is zero for a still office: nothing bobs, blinks or bounces. `talk` is this agent's side of a
   * conversation, when it is in one: the two take turns holding up the dots. `look` is how the screen asks the
   * labels to be: how much the bubble grows to stay readable, and whether a name at its own size still reads.
   */
  frame(time: number, pose: IdlePose, talk: "speaks" | "listens" | null, look: { bubble: number; names: boolean }): void {
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
    this.screen.alpha = 0.7 + 0.3 * Math.sin(time / 260);

    const top = -lift - (SOLES - avatarBounds(agent.avatar).top) * AVATAR_SCALE;
    this.tags.position.set(x, y);
    this.name.y = pose ? 9 : SEAT_LABEL_DROP;
    this.name.visible = look.names;
    this.outline.clear();
    if (this.hovered)
      this.outline
        .rect(-this.figure.width / 2 - 3, top - 4, this.figure.width + 6, -lift - top + 8)
        .stroke({ color: "#d7efd9", width: 2 });

    const said = agent.bubble;
    this.bubble.visible = said !== null;
    this.speech = null;
    if (said) {
      const calls = said.tone !== "busy" && said.tone !== "wait";
      this.bubble.write(said.tone === "busy" ? busyDots(time) : said.text, BUBBLE_FILL[said.tone]);
      this.bubble.scale.set(look.bubble);
      this.bubble.pivot.y = calls && Math.floor(time / BUBBLE_STEP_MS) % 2 ? BUBBLE_HOP : 0;
      const height = this.bubble.tall * look.bubble;
      this.speech = { x: x + 3, y: y + top - 7 - height, width: this.bubble.span * look.bubble, height };
      this.say(this.speech);
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

  say(at: Box): void {
    this.bubble.position.set(at.x - this.tags.x, at.y - this.tags.y);
  }

  destroy(): void {
    this.body.destroy({ children: true });
    this.screen.destroy();
    this.tags.destroy({ children: true });
  }
}

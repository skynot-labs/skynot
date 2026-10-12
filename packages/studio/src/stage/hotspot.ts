import { Graphics } from "pixi.js";
import { Plate } from "./plates";

const RESTING = 0.3;
const LIT = 0.62;

/**
 * Something in the office that can be opened. A pool of light on the floor under it says so without a sign; under
 * the pointer the light grows and a small label says what it opens.
 */
export class Hotspot {
  /** Lies on the floor, under the furniture, and takes the click for everything standing on it. */
  readonly glow = new Graphics();
  readonly tip = new Plate({ fill: "#31363fe8", color: "#f1ead9", size: 13, height: 24, padding: 9, tail: true });

  /** `patch` is the lit piece of floor or wall, as the corners of a polygon. */
  constructor(patch: Array<[number, number]>, tipAt: [number, number], onTap: () => void) {
    this.place(patch, tipAt);
    this.glow.eventMode = "static";
    this.glow.cursor = "pointer";
    this.glow.on("pointerover", () => this.hover(true));
    this.glow.on("pointerout", () => this.hover(false));
    this.glow.on("pointertap", onTap);
    this.tip.eventMode = "none";
    this.hover(false);
  }

  place(patch: Array<[number, number]>, tipAt: [number, number]): void {
    this.glow
      .clear()
      .poly(patch.flat())
      .fill({ color: "#f6e7b0", alpha: 0.55 })
      .stroke({ color: "#fff6cf", width: 2 });
    this.tip.position.set(tipAt[0], tipAt[1] - 31);
  }

  hover(over: boolean): void {
    this.glow.alpha = over ? LIT : RESTING;
    this.tip.visible = over;
  }

  say(text: string): void {
    this.tip.write(text);
  }
}

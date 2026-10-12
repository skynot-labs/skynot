import { Container, Graphics } from "pixi.js";
import type { Size } from "./camera";

type Drift = { flake: Graphics; fall: number; sway: number; phase: number };

const FALLING: Record<string, { colors: string[]; fall: number } | undefined> = {
  spring: { colors: ["#f4b6cf", "#f9d3e2", "#e995b8"], fall: 0.035 },
  autumn: { colors: ["#d98b3a", "#c9652e", "#e2b04a"], fall: 0.045 },
  winter: { colors: ["#ffffff", "#e6eef5"], fall: 0.03 },
};
const FLAKES = 26;

/** The air of the office: what the season lets fall through it, and how dark it is. */
export class Ambient extends Container {
  private readonly shade = new Graphics();
  private drifting: Drift[] = [];
  private season = "";
  constructor(private readonly frame: Size) {
    super();
    this.eventMode = "none";
    this.addChild(this.shade);
  }

  /** `dim` is how much of the light is gone, from 0 to 1. */
  set(season: string, dim: number, moving: boolean): void {
    this.shade.clear();
    if (dim > 0) this.shade.rect(0, 0, this.frame.width, this.frame.height).fill({ color: "#141826", alpha: dim });
    const key = moving ? season : "";
    if (key === this.season) return;
    this.season = key;
    for (const drift of this.drifting) drift.flake.destroy();
    const falling = FALLING[key];
    this.drifting = falling
      ? Array.from({ length: FLAKES }, (_, index) => {
          const flake = new Graphics().rect(0, 0, 4, 4).fill(falling.colors[index % falling.colors.length]!);
          flake.position.set(Math.random() * this.frame.width, Math.random() * this.frame.height);
          flake.alpha = 0.75;
          this.addChild(flake);
          return { flake, fall: falling.fall * (0.6 + Math.random() * 0.8), sway: 8 + Math.random() * 14, phase: Math.random() * 6 };
        })
      : [];
  }

  tick(elapsed: number, time: number): void {
    for (const drift of this.drifting) {
      drift.flake.y += drift.fall * elapsed;
      drift.flake.x += Math.sin(time / 900 + drift.phase) * drift.sway * 0.002 * elapsed - 0.008 * elapsed;
      if (drift.flake.y > this.frame.height) drift.flake.position.set(Math.random() * this.frame.width, -6);
      if (drift.flake.x < -6) drift.flake.x = this.frame.width;
    }
  }
}

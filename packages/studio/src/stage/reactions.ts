import { Container, Graphics } from "pixi.js";
import { words } from "./plates";

type Spark = { dot: Graphics; vx: number; vy: number; left: number; life: number };
type Rising = { label: Container; left: number; life: number };

const GRAVITY = 0.00042;

/** Short-lived marks of something that just happened: a burst of sparks and a word that rises and fades. */
export class Reactions extends Container {
  private sparks: Spark[] = [];
  private rising: Rising[] = [];
  constructor() {
    super();
    this.eventMode = "none";
  }

  burst(x: number, y: number, colors: string[], count: number, reach = 0.16): void {
    for (let index = 0; index < count; index++) {
      const dot = new Graphics().rect(-3, -3, 6, 6).fill(colors[index % colors.length]!);
      dot.position.set(x, y);
      const angle = Math.random() * Math.PI * 2;
      const speed = reach * (0.35 + Math.random() * 0.65);
      const life = 1100 + Math.random() * 1100;
      this.sparks.push({ dot, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - reach * 0.6, left: life, life });
      this.addChild(dot);
    }
  }

  say(x: number, y: number, text: string, color: string): void {
    const label = words(text, { fontSize: 22, fontWeight: "bold", fill: color, stroke: { color: "#1d2028", width: 4 } });
    label.anchor.set(0.5, 1);
    label.position.set(x, y);
    this.rising.push({ label, left: 1500, life: 1500 });
    this.addChild(label);
  }

  tick(elapsed: number): void {
    for (const spark of this.sparks) {
      spark.vy += GRAVITY * elapsed;
      spark.dot.x += spark.vx * elapsed;
      spark.dot.y += spark.vy * elapsed;
      spark.left -= elapsed;
      spark.dot.alpha = Math.max(0, spark.left / spark.life);
    }
    for (const rise of this.rising) {
      rise.label.y -= 0.022 * elapsed;
      rise.left -= elapsed;
      rise.label.alpha = Math.min(1, (rise.left / rise.life) * 2);
    }
    this.sparks = this.sparks.filter((spark) => spark.left > 0 || (spark.dot.destroy(), false));
    this.rising = this.rising.filter((rise) => rise.left > 0 || (rise.label.destroy(), false));
  }
}

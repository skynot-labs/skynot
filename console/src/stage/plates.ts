import { Container, Graphics, Text, type TextStyleOptions } from "pixi.js";

export const MONO = "monospace";
// Text is rasterized: twice the size keeps it sharp on dense screens and under the camera's zoom.
const TEXT_RESOLUTION = 3;

export function words(text: string, style: TextStyleOptions): Text {
  const label = new Text({ text, style: { fontFamily: MONO, ...style } });
  label.resolution = TEXT_RESOLUTION;
  return label;
}

export type PlateLook = {
  fill: string;
  color: string;
  size: number;
  bold?: boolean;
  height: number;
  padding: number;
  minWidth?: number;
  tail?: boolean;
};

/** A filled rectangle with centered text, its origin at the middle of its top edge. */
export class Plate extends Container {
  private readonly back = new Graphics();
  private readonly caption: Text;
  private shown = "";
  constructor(private readonly look: PlateLook) {
    super();
    this.caption = words("", { fontSize: look.size, fontWeight: look.bold ? "bold" : "normal", fill: look.color });
    this.caption.anchor.set(0.5, 0.5);
    this.caption.y = look.height / 2;
    this.addChild(this.back, this.caption);
  }
  private get span(): number {
    return Math.max(this.look.minWidth ?? 0, this.caption.width + this.look.padding * 2);
  }
  write(text: string, fill = this.look.fill, color = this.look.color): void {
    const key = `${text}|${fill}|${color}`;
    if (key === this.shown) return;
    this.shown = key;
    this.caption.text = text;
    this.caption.style.fill = color;
    const width = this.span;
    this.back.clear().rect(-width / 2, 0, width, this.look.height).fill(fill);
    if (this.look.tail)
      this.back.poly([-6, this.look.height, 6, this.look.height, 0, this.look.height + 7]).fill(fill);
  }
}

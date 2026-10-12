import { describe, expect, it } from "vitest";
import { HOME, panBy, zoomAt } from "../src/stage/camera";

const frame = { width: 1440, height: 850 };

describe("the office camera", () => {
  it("zooms in keeping the point under the cursor where it is", () => {
    const at = { x: 1000, y: 300 };
    const view = zoomAt(HOME, 2, at, frame);
    expect(view.scale).toBe(2);
    expect({ x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale }).toEqual(at);
  });

  it("never zooms out past the whole office nor in past three times", () => {
    expect(zoomAt(HOME, 0.2, { x: 10, y: 10 }, frame)).toEqual(HOME);
    expect(zoomAt(HOME, 50, { x: 0, y: 0 }, frame).scale).toBe(3);
  });

  it("comes back to the whole office when zoomed all the way out from a corner", () => {
    const corner = zoomAt(HOME, 3, { x: 1440, y: 850 }, frame);
    expect(zoomAt(corner, 0.01, { x: 0, y: 0 }, frame)).toEqual(HOME);
  });

  it("pans only as far as the office reaches", () => {
    const zoomed = zoomAt(HOME, 2, { x: 720, y: 425 }, frame);
    expect(panBy(zoomed, 5000, 5000, frame)).toMatchObject({ x: 0, y: 0 });
    expect(panBy(zoomed, -5000, -5000, frame)).toMatchObject({ x: -1440, y: -850 });
    expect(panBy(HOME, 300, -200, frame)).toEqual(HOME);
  });
});

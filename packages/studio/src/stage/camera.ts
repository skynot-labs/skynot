export type View = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };

export const HOME: View = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 3;

// The world always covers the frame: no zooming out past the whole office, no panning into the void.
function held(view: View, frame: Size): View {
  const scale = Math.min(MAX_SCALE, Math.max(1, view.scale));
  return {
    scale,
    x: Math.min(0, Math.max(frame.width * (1 - scale), view.x)),
    y: Math.min(0, Math.max(frame.height * (1 - scale), view.y)),
  };
}

/** Zooms by `factor` keeping the point under `at` (frame coordinates) where it is. */
export function zoomAt(view: View, factor: number, at: { x: number; y: number }, frame: Size): View {
  const scale = Math.min(MAX_SCALE, Math.max(1, view.scale * factor));
  const ratio = scale / view.scale;
  return held({ scale, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio }, frame);
}

export function panBy(view: View, dx: number, dy: number, frame: Size): View {
  return held({ ...view, x: view.x + dx, y: view.y + dy }, frame);
}

export type View = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };

export const HOME: View = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 3;
const GLIDE_MS = 200;

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

/** Where the camera is `elapsed` ms into its way from one view to another: quick to leave, slow to arrive. */
export function glide(from: View, to: View, elapsed: number): View {
  const progress = Math.min(1, Math.max(0, elapsed / GLIDE_MS));
  if (progress === 1) return to;
  const eased = 1 - (1 - progress) ** 3;
  const between = (start: number, end: number) => start + (end - start) * eased;
  return { scale: between(from.scale, to.scale), x: between(from.x, to.x), y: between(from.y, to.y) };
}

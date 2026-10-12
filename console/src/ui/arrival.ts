const GLOW_MS = 1800;

// A panel that opens, or is asked for while already open, lights its edge for a moment so the eye finds it.
export function announceArrival(element: Element | null | undefined): void {
  if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches)
    return;
  element.animate(
    [
      { boxShadow: "0 0 0 2px #a9c8ff, 0 0 28px #a9c8ff80" },
      { boxShadow: "0 0 0 2px #a9c8ff00, 0 0 28px #a9c8ff00" },
    ],
    { duration: GLOW_MS, easing: "ease-out" },
  );
}

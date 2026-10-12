const GLOW_MS = 600;
const EDGE = "var(--sk-color-blue)";

// A dock card that is asked for lights its edge for a moment, so a click on one already open is seen to land.
export function announceArrival(element: Element | null | undefined): void {
  element?.animate(
    [
      { boxShadow: `0 0 0 2px ${EDGE}, 0 0 28px color-mix(in srgb, ${EDGE} 50%, transparent)` },
      { boxShadow: "0 0 0 2px transparent, 0 0 28px transparent" },
    ],
    { duration: GLOW_MS, easing: "ease-out" },
  );
}

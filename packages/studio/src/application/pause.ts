import type { PauseState } from "../contracts";

// An office from before the contract had `by` named the director only in the reason.
export function pausedByDirector(pause: PauseState): boolean {
  return pause.by ? pause.by === "director" : pause.reason === "paused by the director";
}

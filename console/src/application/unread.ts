import { useEffect, useState } from "preact/hooks";
import type { Message } from "../contracts";

// The chat only grows, so how many messages the director has seen is all there is to remember.
export function unreadReplies(chat: readonly Message[], seen: number | null): number {
  return seen === null ? 0 : chat.slice(seen).filter((message) => message.author !== "director").length;
}

const key = (project: string) => `skynot.chat-seen.${project}`;

function remembered(project: string): number | null {
  try {
    const stored = Number.parseInt(localStorage.getItem(key(project)) ?? "", 10);
    return Number.isNaN(stored) ? null : stored;
  } catch {
    return null;
  }
}

// Replies that landed while the chat was out of sight. A project met for the first time starts with everything read.
export function useUnreadReplies(project: string | undefined, chat: readonly Message[], watching: boolean): number {
  const [seen, setSeen] = useState<{ project: string | undefined; count: number | null }>({ project: undefined, count: null });
  const current = seen.project === project ? seen.count : project ? remembered(project) : null;
  const caughtUp = watching || current === null || current > chat.length;
  useEffect(() => {
    if (!project) return;
    const count = caughtUp ? chat.length : current;
    if (seen.project === project && seen.count === count) return;
    setSeen({ project, count });
    try {
      localStorage.setItem(key(project), String(count));
    } catch {
      // without storage the mark only lasts until the page reloads
    }
  }, [project, chat.length, caughtUp, current, seen]);
  return caughtUp ? 0 : unreadReplies(chat, current);
}

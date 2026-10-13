import { useEffect, useRef, useState } from "preact/hooks";
import type { Report } from "../contracts";

// Reports only pile up, so the time of the newest one seen is all there is to remember.
export function unreadReports(reports: readonly Report[], seenAt: string | null): number {
  return seenAt === null ? 0 : reports.filter((report) => report.at > seenAt).length;
}

const key = (project: string) => `skynot.reports-seen.${project}`;

function remembered(project: string): string | null {
  try {
    return localStorage.getItem(key(project));
  } catch {
    return null;
  }
}

// `unread` is what landed while the reports were out of sight; `fresh` is how many of them were new when they were opened.
// A project met for the first time starts with everything read.
export function useUnreadReports(project: string | undefined, reports: readonly Report[], watching: boolean): { unread: number; fresh: number } {
  const [seen, setSeen] = useState<{ project: string | undefined; at: string | null }>({ project: undefined, at: null });
  const current = seen.project === project ? seen.at : project ? remembered(project) : null;
  const newest = reports[0]?.at ?? "";
  const caughtUp = watching || current === null;
  const openedAt = useRef<string | null>(null);
  if (!watching) openedAt.current = null;
  else if (openedAt.current === null) openedAt.current = current ?? newest;

  useEffect(() => {
    if (!project) return;
    const at = caughtUp ? newest : current;
    if (seen.project === project && seen.at === at) return;
    setSeen({ project, at });
    try {
      localStorage.setItem(key(project), at ?? "");
    } catch {
      // without storage the mark only lasts until the page reloads
    }
  }, [project, newest, caughtUp, current, seen]);

  return { unread: caughtUp ? 0 : unreadReports(reports, current), fresh: watching ? unreadReports(reports, openedAt.current) : 0 };
}

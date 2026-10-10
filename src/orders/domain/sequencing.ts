import type { WorkOrder } from "./work-order";

const ACTIVE = ["signed", "on_bench", "in_review"];

const within = (parent: string, path: string) => path === parent || path.startsWith(parent.endsWith("/") ? parent : `${parent}/`);

const overlaps = (mine: readonly string[], theirs: readonly string[]) =>
  mine.some((a) => theirs.some((b) => within(a, b) || within(b, a)));

const signedBefore = (other: WorkOrder, order: WorkOrder): boolean =>
  other.signedAt !== null && order.signedAt !== null && (other.signedAt < order.signedAt || (other.signedAt === order.signedAt && other.id < order.id));

// Orders signed before this one that must be merged first: the ones it declares, and the ones touching the same files.
export function blockersOf(order: WorkOrder, everything: readonly WorkOrder[]): string[] {
  // two projects never share files, whatever their paths say
  const all = everything.filter((other) => other.projectId === order.projectId);
  const declared = (order.spec.dependsOn ?? []).filter((id) => all.find((other) => other.id === id)?.status !== "discarded");
  const earlier = all.filter((other) => signedBefore(other, order) && ACTIVE.includes(other.status) && overlaps(order.spec.likelyFiles, other.spec.likelyFiles));
  const pending = [...declared, ...earlier.map((other) => other.id)].filter((id) => all.find((other) => other.id === id)?.status !== "delivered");
  return [...new Set(pending)].sort();
}

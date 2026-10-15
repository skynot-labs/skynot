import type { OrderStatus, WorkOrder } from "./work-order";

export const CARD_WIDTH = 44;
const MAX_CRITERIA_ON_CARD = 3;

const STATUS_LINE: Record<OrderStatus, string> = {
  awaiting_signature: "? needs your signature",
  signed: "⧗ signed",
  on_bench: "⧗ on the bench",
  in_review: "⧗ in review",
  delivered: "✓ delivered",
  discarded: "discarded",
};

function nextStep(order: WorkOrder): string {
  switch (order.status) {
    case "awaiting_signature":
      return "director signature";
    case "signed":
      return "a worker picks it up";
    case "on_bench":
      return "worker builds, opens a PR";
    case "in_review":
      return "director reviews and merges";
    case "delivered":
      return order.minutes === null ? "director reports minutes" : "none";
    case "discarded":
      return "none";
  }
}

function wrap(text: string, firstPrefix: string, restPrefix: string): string[] {
  const lines: string[] = [];
  let line = firstPrefix;
  let lineHasWord = false;

  for (const word of text.split(/\s+/)) {
    if (lineHasWord && line.length + 1 + word.length > CARD_WIDTH) {
      lines.push(line);
      line = `${restPrefix}${word}`;
    } else {
      line += lineHasWord ? ` ${word}` : word;
    }
    lineHasWord = true;
  }
  lines.push(line);
  return lines;
}

export function renderCard(order: WorkOrder): string {
  const criteria = order.spec.acceptanceCriteria;
  const hidden = criteria.length - MAX_CRITERIA_ON_CARD;

  return [
    ...wrap(order.spec.title, `${order.id}  `, "         "),
    `status   ${STATUS_LINE[order.status]}`,
    ...criteria.slice(0, MAX_CRITERIA_ON_CARD).flatMap((criterion) => wrap(criterion.statement, "[ ] ", "    ")),
    ...(hidden > 0 ? [`    +${hidden} more in the issue`] : []),
    ...(order.spec.dependencies?.length ? wrap(order.spec.dependencies.map((dependency) => (dependency.dev ? `${dependency.name} (dev)` : dependency.name)).join(", "), "installs ", "         ") : []),
    `next     ${nextStep(order)}`,
  ].join("\n");
}

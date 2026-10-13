import type { Clock } from "../kernel";
import type { StandingSource } from "../manager";
import type { OrdersProjection } from "../orders";
import { readyToMerge, type OrderLinks } from "./activity";

const DAY_MS = 86_400_000;

export interface StandingDependencies {
  orders: OrdersProjection;
  linksFor(orderId: string): OrderLinks;
  spentOn(day: string): number;
  clock: Clock;
  projectId: string;
  reviewing: boolean;
  maxUsdPerDay?: number;
}

export function createStanding({ orders, linksFor, spentOn, clock, projectId, reviewing, maxUsdPerDay }: StandingDependencies): StandingSource {
  return {
    read() {
      const mine = orders.listFor(projectId);
      const now = clock.now();
      const at = now.toISOString();
      return {
        at,
        delivered: mine
          .flatMap((order) => (order.deliveredAt ? [{ orderId: order.id, title: order.spec.title, at: order.deliveredAt }] : []))
          .sort((a, b) => b.at.localeCompare(a.at)),
        toMerge: mine.flatMap((order) => {
          const links = linksFor(order.id);
          return order.status === "in_review" && links.pullRequestUrl !== null && readyToMerge(links, reviewing) ? [{ orderId: order.id, title: order.spec.title, url: links.pullRequestUrl }] : [];
        }),
        spentTodayUsd: spentOn(at.slice(0, 10)),
        spentYesterdayUsd: spentOn(new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10)),
        dailyCapUsd: maxUsdPerDay ?? null,
      };
    },
  };
}

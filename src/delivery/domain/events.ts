export type DeliveryEvent =
  | { type: "delivery.issue_opened"; payload: { orderId: string; repo: string; issue: number; url: string } }
  | { type: "delivery.work_blocked"; payload: { orderId: string; reason: string } }
  | { type: "delivery.work_retried"; payload: { orderId: string } }
  | { type: "delivery.pull_request_opened"; payload: { orderId: string; repo: string; number: number; url: string } };

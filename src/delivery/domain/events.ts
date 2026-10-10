export type DeliveryEvent =
  | { type: "delivery.issue_opened"; payload: { orderId: string; repo: string; issue: number; url: string } }
  | { type: "delivery.work_blocked"; payload: { orderId: string; reason: string } }
  | { type: "delivery.protected_paths_found"; payload: { orderId: string; paths: string[] } }
  | { type: "delivery.protected_paths_approved"; payload: { orderId: string; paths: string[] } }
  | { type: "delivery.work_retried"; payload: { orderId: string } }
  | { type: "delivery.follow_up_requested"; payload: { orderId: string; instruction: string } }
  | { type: "delivery.pull_request_updated"; payload: { orderId: string; number: number } }
  | { type: "delivery.pull_request_opened"; payload: { orderId: string; repo: string; number: number; url: string } };

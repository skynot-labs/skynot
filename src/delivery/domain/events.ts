export type DeliveryEvent =
  | { type: "delivery.issue_opened"; payload: { orderId: string; repo: string; issue: number; url: string } }
  | { type: "delivery.work_blocked"; payload: { orderId: string; reason: string } }
  | { type: "delivery.protected_paths_found"; payload: { orderId: string; paths: string[] } }
  | { type: "delivery.protected_paths_approved"; payload: { orderId: string; paths: string[] } }
  | { type: "delivery.work_waiting"; payload: { orderId: string; on: string[] } }
  | { type: "delivery.review_completed"; payload: { orderId: string; round: number; verdict: "approved" | "changes_requested"; summary: string; findings: string[] } }
  | { type: "delivery.review_failed"; payload: { orderId: string; reason: string } }
  | { type: "delivery.checks_changed"; payload: { orderId: string; state: "none" | "pending" | "passing" | "failing" } }
  | { type: "delivery.question_raised"; payload: { orderId: string; question: string } }
  | { type: "delivery.question_answered"; payload: { orderId: string; answer: string } }
  | { type: "delivery.worker_assigned"; payload: { orderId: string; worker: string } }
  | { type: "delivery.wait_skipped"; payload: { orderId: string } }
  | { type: "delivery.work_retried"; payload: { orderId: string } }
  | { type: "delivery.follow_up_requested"; payload: { orderId: string; instruction: string } }
  | { type: "delivery.pull_request_updated"; payload: { orderId: string; number: number } }
  | { type: "delivery.pull_request_opened"; payload: { orderId: string; repo: string; number: number; url: string } };

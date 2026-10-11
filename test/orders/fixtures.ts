import type { WorkOrderSpec } from "../../src/orders";

export function validSpec(overrides: Partial<WorkOrderSpec> = {}): WorkOrderSpec {
  return {
    title: "Export the inventory to CSV",
    summary: "A button on the items page downloads the whole inventory as a spreadsheet file.",
    approach: [],
    objective: "The director can download the whole inventory as a CSV file from the items page.",
    acceptanceCriteria: [
      {
        statement: "GET /items.csv returns every active item",
        verification: { kind: "test", detail: "items-csv.test.ts" },
      },
      {
        statement: "Archived items are not exported",
        verification: { kind: "behavior", detail: "an archived item is absent from the file" },
      },
    ],
    outOfScope: ["Excel export"],
    risk: "low",
    likelyFiles: ["src/items/export.ts"],
    ...overrides,
  };
}

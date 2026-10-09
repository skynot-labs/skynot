import { z } from "zod";

const UNSUPPORTED_BY_STRICT_OUTPUT = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "default",
]);

export function toEngineSchema(schema: z.ZodType): object {
  return strip(z.toJSONSchema(schema)) as object;
}

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !UNSUPPORTED_BY_STRICT_OUTPUT.has(key))
        .map(([key, value]) => [key, strip(value)]),
    );
  }
  return node;
}

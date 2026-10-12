import { z } from "zod";

// One line of the event stream. A studio only needs to know that something happened and in which order; it reads
// the state again to learn what.
export const StreamEventSchema = z.object({ sequence: z.number().int().nonnegative(), type: z.string() });
export type StreamEvent = z.infer<typeof StreamEventSchema>;

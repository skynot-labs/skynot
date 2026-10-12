import { z } from "zod";

// What an office says about itself to anyone who asks, before any session.
export const MetaSchema = z.object({ contract: z.number().int(), requiresSession: z.boolean() });
export type Meta = z.infer<typeof MetaSchema>;

export const PairingSchema = z.object({ secret: z.string().min(1).max(200) });
export type Pairing = z.infer<typeof PairingSchema>;

export const SessionSchema = z.object({ token: z.string().min(1), expiresAt: z.iso.datetime() });
export type Session = z.infer<typeof SessionSchema>;

// Every refusal carries its reason in words a person can read.
export const RefusalSchema = z.object({ error: z.string() });
export type Refusal = z.infer<typeof RefusalSchema>;

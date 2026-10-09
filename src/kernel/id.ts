import { randomUUID } from "node:crypto";

export type Id<Brand extends string> = string & { readonly __brand: Brand };

export function newId<Brand extends string>(brand: Brand): Id<Brand> {
  return `${brand}_${randomUUID()}` as Id<Brand>;
}

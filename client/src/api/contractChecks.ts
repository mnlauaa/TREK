import type { z } from 'zod';

/**
 * Validate a response payload against its @trek/shared Zod schema — but only in
 * dev, and never throwing. A drift between the server contract and the client's
 * expected shape is surfaced as a console warning during development; in
 * production (and on any mismatch) the data passes through untouched, so adding
 * validation can never break a working call. This is the typed-request helper
 * the FE adopts per domain as each backend module lands on @trek/shared.
 */
const API_DEV = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
export function parseInDev<S extends z.ZodTypeAny>(schema: S, data: unknown, label: string): z.infer<S> {
  if (API_DEV) {
    const result = schema.safeParse(data);
    if (!result.success) {
      console.warn(`[api] ${label}: response did not match the @trek/shared schema`, result.error.issues);
    }
  }
  return data as z.infer<S>;
}

/**
 * Same dev-only drift check as parseInDev, but passes the payload straight
 * through with its original inferred type instead of the schema type. Use this
 * for endpoints whose existing consumers rely on the loose `r.data` type — it
 * adds the development contract-drift warning without retyping the public
 * surface (so it can never break a consumer that worked before).
 */
export function checkInDev<T>(schema: z.ZodTypeAny, data: T, label: string): T {
  if (API_DEV) {
    const result = schema.safeParse(data);
    if (!result.success) {
      console.warn(`[api] ${label}: response did not match the @trek/shared schema`, result.error.issues);
    }
  }
  return data;
}

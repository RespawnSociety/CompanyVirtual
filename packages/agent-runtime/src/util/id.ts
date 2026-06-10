import { randomUUID } from "node:crypto";

/** Pembuat id default. Bisa di-override (mis. untuk test deterministik). */
export function defaultGenId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/** Pembuat id deterministik berbasis counter — berguna untuk test. */
export function makeSeqIdGen(): (prefix: string) => string {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}_${n}`;
  };
}

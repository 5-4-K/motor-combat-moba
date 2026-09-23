import { flow } from "../modes/active.js";

export type ValidateNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

export function normalizeName(raw: string): string {
  return raw.trim();
}

/**
 * Reads the ACTIVE MODE's `flow()` rather than the raw module-level flow-config global (2026-09-22 final
 * review) — its one call site, `ArenaRoom.onJoin`, already runs inside `scoped(this.modeConfig,
 * ...)`, and the client's join screen already treats this same bound as per-mode
 * (`join.ts`'s `maxLength: flow().nameMax`). A raw read here would let a mode's own `nameMax` accept
 * a name on the client that the server then rejects.
 */
export function validateName(raw: string): ValidateNameResult {
  const name = normalizeName(raw);
  const { nameMin, nameMax } = flow();
  if (name.length < nameMin || name.length > nameMax) {
    return {
      ok: false,
      error: `Name must be ${nameMin}–${nameMax} characters`,
    };
  }
  return { ok: true, name };
}

export function isNameTaken(existing: readonly string[], candidate: string): boolean {
  const normalized = normalizeName(candidate).toLowerCase();
  return existing.some((n) => normalizeName(n).toLowerCase() === normalized);
}

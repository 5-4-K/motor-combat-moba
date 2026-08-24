import { FLOW_CONFIG } from "../config/flow-config.js";

export type ValidateNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

export function normalizeName(raw: string): string {
  return raw.trim();
}

export function validateName(raw: string): ValidateNameResult {
  const name = normalizeName(raw);
  if (name.length < FLOW_CONFIG.nameMin || name.length > FLOW_CONFIG.nameMax) {
    return {
      ok: false,
      error: `Name must be ${FLOW_CONFIG.nameMin}–${FLOW_CONFIG.nameMax} characters`,
    };
  }
  return { ok: true, name };
}

export function isNameTaken(existing: readonly string[], candidate: string): boolean {
  const normalized = normalizeName(candidate).toLowerCase();
  return existing.some((n) => normalizeName(n).toLowerCase() === normalized);
}

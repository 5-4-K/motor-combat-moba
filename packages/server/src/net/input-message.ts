import type { InputMessage } from "@motor-arena/shared";

function isAxis(n: unknown): n is -1 | 0 | 1 {
  return n === -1 || n === 0 || n === 1;
}

export function isInputMessage(msg: unknown): msg is InputMessage {
  if (msg === null || typeof msg !== "object") return false;
  const rec = msg as Record<string, unknown>;
  return (
    Number.isInteger(rec.seq) &&
    Number.isFinite(rec.seq) &&
    isAxis(rec.steer) &&
    isAxis(rec.throttle) &&
    typeof rec.fire === "boolean"
  );
}

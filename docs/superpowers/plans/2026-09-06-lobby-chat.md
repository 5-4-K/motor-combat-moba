# Lobby Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chat panel to the multiplayer lobby screen — the last 20 messages, oldest at the top, each showing its sender's name in their lobby colour and a server-stamped `HH:MM` time, with a 100-character input beneath.

**Architecture:** The message buffer is Colyseus schema state on `ArenaState`, so history persists across a match and reaches late joiners without a second delivery path. The server owns validation, the 20-message cap, and an anti-spam cooldown; the client sends a `MSG_CHAT` intent and renders what comes back. The lobby's existing wholesale re-render is preserved — the in-progress draft lives on `LobbyScene` and focus, selection and scroll are captured and restored around each render.

**Tech Stack:** TypeScript, npm workspaces, Colyseus 0.15 / `@colyseus/schema` 2.x, Phaser 4 with a DOM overlay, Vitest (node environment on all three packages).

**Spec:** [`docs/superpowers/specs/2026-09-06-lobby-chat-design.md`](../specs/2026-09-06-lobby-chat-design.md) — decisions LC1–LC24. Read it alongside this plan; every task cites the decisions it implements.

## Global Constraints

- **This is a git worktree with no `node_modules`.** Run `npm install` from the worktree root before the first build, or every build silently inlines the *main checkout's* shared `dist` and your changes will not run. Task 1 Step 1.
- **Build with root `npm run build`, never `npm run build --workspaces`.** The server's tsup step inlines shared's `dist`; only the root script guarantees shared builds first.
- **After editing anything in `packages/shared`, rebuild shared before running server or client code.** Stale `dist` presents as "I changed a constant and nothing happened".
- **Verify with root `npm test`.** Per-workspace runs silently skip the server suite.
- `CHAT_CONFIG` values, verbatim: `maxLength: 100`, `maxMessages: 20`, `sendCooldownMs: 500`.
- **No magic numbers in logic** (invariant 2) — every chat number comes from `CHAT_CONFIG`.
- **Clients send intents, never authoritative state** (invariant 3) — the client's copy of the validator is a courtesy; the server decides.
- **Enum uint8 values are explicit and stable** (invariant 7) — this feature adds and renumbers nothing.
- **Client tests run in a `node` environment, not jsdom.** Every client test targets a pure function. Do not write a test that touches `document`.
- Do not read, cite, or plan against anything in `docs/ideas/` or `docs/invariants/`.

---

### Task 1: Shared chat config and text validation

Implements LC10, LC13, LC14.

**Files:**
- Create: `packages/shared/src/config/chat-config.ts`
- Create: `packages/shared/src/lobby/chat.ts`
- Test: `packages/shared/src/lobby/chat.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CHAT_CONFIG` (`{ maxLength: 100; maxMessages: 20; sendCooldownMs: 500 }`), `normalizeChatText(raw: string): string`, `validateChatText(raw: string): ValidateChatResult` where `ValidateChatResult = { ok: true; text: string } | { ok: false; error: string }`. All three re-exported from `@motor-combat-moba/shared`.

- [ ] **Step 1: Install dependencies in this worktree**

This worktree has no `node_modules`. Without this, every later build inlines the main checkout's shared and your changes will not run.

```bash
npm install
```

Then confirm it worked — this must print a path, not an error:

```bash
node -e "console.log(require.resolve('vitest/package.json'))"
```

- [ ] **Step 2: Write the failing test**

Create `packages/shared/src/lobby/chat.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CHAT_CONFIG } from "../config/chat-config.js";
import { normalizeChatText, validateChatText } from "./chat.js";

describe("CHAT_CONFIG", () => {
  it("carries the three chat numbers", () => {
    expect(CHAT_CONFIG.maxLength).toBe(100);
    expect(CHAT_CONFIG.maxMessages).toBe(20);
    expect(CHAT_CONFIG.sendCooldownMs).toBe(500);
  });
});

describe("normalizeChatText", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeChatText("  gl hf  ")).toBe("gl hf");
  });

  it("turns a newline into a space rather than deleting it", () => {
    // "glhf" would be wrong: they are two words, and the panel is one line per message.
    expect(normalizeChatText("gl\nhf")).toBe("gl hf");
  });

  it("replaces control and format characters", () => {
    expect(normalizeChatText("glhf")).toBe("gl hf");
    expect(normalizeChatText("gl‮hf")).toBe("gl hf");
  });

  it("collapses runs of whitespace", () => {
    expect(normalizeChatText("gl     hf")).toBe("gl hf");
  });

  it("leaves an ordinary message alone", () => {
    expect(normalizeChatText("bastion again i guess")).toBe("bastion again i guess");
  });
});

describe("validateChatText", () => {
  it("accepts an ordinary message", () => {
    expect(validateChatText("gl hf everyone")).toEqual({ ok: true, text: "gl hf everyone" });
  });

  it("returns the normalized text, not the raw input", () => {
    const result = validateChatText("  no   rush  ");
    expect(result).toEqual({ ok: true, text: "no rush" });
  });

  it("rejects an empty message", () => {
    expect(validateChatText("").ok).toBe(false);
  });

  it("rejects a whitespace-only message", () => {
    expect(validateChatText("     ").ok).toBe(false);
  });

  it("rejects a message that is only control characters", () => {
    expect(validateChatText("\n\n\n").ok).toBe(false);
  });

  it("accepts exactly maxLength characters", () => {
    const text = "a".repeat(CHAT_CONFIG.maxLength);
    expect(validateChatText(text)).toEqual({ ok: true, text });
  });

  it("rejects one character over maxLength", () => {
    expect(validateChatText("a".repeat(CHAT_CONFIG.maxLength + 1)).ok).toBe(false);
  });

  it("names the limit in the error", () => {
    const result = validateChatText("a".repeat(CHAT_CONFIG.maxLength + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(CHAT_CONFIG.maxLength));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/lobby/chat.test.ts`
Expected: FAIL — cannot resolve `../config/chat-config.js` and `./chat.js`.

- [ ] **Step 4: Write the config**

Create `packages/shared/src/config/chat-config.ts`:

```ts
/**
 * Lobby chat limits (LC10). Every chat number in the codebase comes from here — invariant 2.
 *
 * `sendCooldownMs` is wall-clock milliseconds, not ticks, deliberately (LC20): it is an anti-spam
 * guard with no relationship to the sim, and a tick-based one would silently halve when netcode
 * phase 1 takes TICK_RATE_HZ from 30 to 60.
 */
export const CHAT_CONFIG = {
  maxLength: 100,
  maxMessages: 20,
  sendCooldownMs: 500,
} as const;
```

- [ ] **Step 5: Write the validator**

Create `packages/shared/src/lobby/chat.ts`:

```ts
import { CHAT_CONFIG } from "../config/chat-config.js";

export type ValidateChatResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * A lobby message is one line. Control and format characters become spaces rather than vanishing —
 * "gl\nhf" is two words, not "glhf" — and runs then collapse, so a pasted block cannot smuggle in a
 * wide gap that breaks the panel's row alignment. \p{Cf} is in there for the bidi overrides, which
 * would otherwise let one message scramble the reading order of the whole list.
 */
export function normalizeChatText(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The single authority on whether a message may be sent (LC14). The client calls it to decide
 * whether Send does anything; the server calls it to actually decide. Length is measured on the
 * normalized text, and normalization only ever shrinks, so anything the client's `maxLength`
 * attribute allows through also passes here.
 */
export function validateChatText(raw: string): ValidateChatResult {
  const text = normalizeChatText(raw);
  if (text.length === 0) return { ok: false, error: "Message is empty" };
  if (text.length > CHAT_CONFIG.maxLength) {
    return { ok: false, error: `Message must be ${CHAT_CONFIG.maxLength} characters or fewer` };
  }
  return { ok: true, text };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run packages/shared/src/lobby/chat.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 7: Export from the shared barrel**

In `packages/shared/src/index.ts`, add these two export blocks near the other config and lobby exports:

```ts
export { CHAT_CONFIG } from "./config/chat-config.js";
export { normalizeChatText, validateChatText } from "./lobby/chat.js";
export type { ValidateChatResult } from "./lobby/chat.js";
```

- [ ] **Step 8: Build shared and run the full suite**

```bash
npm run build -w @motor-combat-moba/shared
npm test
```

Expected: shared builds clean; the whole suite passes.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/config/chat-config.ts packages/shared/src/lobby/chat.ts packages/shared/src/lobby/chat.test.ts packages/shared/src/index.ts
git commit -m "feat(chat): shared chat config and text validation (LC10, LC13, LC14)"
```

---

### Task 2: The `ChatMessageState` schema row

Implements LC1, LC7, LC11, LC12.

**Files:**
- Create: `packages/shared/src/schema/ChatMessageState.ts`
- Modify: `packages/shared/src/schema/ArenaState.ts`
- Test: `packages/shared/src/schema/schema.test.ts` (add a `describe` block)
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: class `ChatMessageState` with fields `seq: number`, `sessionId: string`, `name: string`, `colorId: number`, `text: string`, `at: string`, all defaulting to `0` / `""`. `ArenaState.chat: ArraySchema<ChatMessageState>`. Both re-exported from `@motor-combat-moba/shared`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/schema/schema.test.ts`, and add `ChatMessageState` to the existing import block at the top of that file (`import { ChatMessageState } from "./ChatMessageState.js";`):

```ts
describe("chat schema (LC11)", () => {
  it("constructs a message row with empty defaults", () => {
    const m = new ChatMessageState();
    expect(m.seq).toBe(0);
    expect(m.sessionId).toBe("");
    expect(m.name).toBe("");
    expect(m.colorId).toBe(0);
    expect(m.text).toBe("");
    expect(m.at).toBe("");
  });

  it("snapshots the sender rather than referencing them (LC1)", () => {
    // The row carries name and colour by value, so a message outlives its sender's PlayerState.
    const m = new ChatMessageState();
    m.name = "Redline";
    m.colorId = 3;
    expect(m).not.toHaveProperty("player");
    expect(m).not.toHaveProperty("sender");
  });

  it("ArenaState opens with an empty chat buffer", () => {
    const state = new ArenaState();
    expect(state.chat.length).toBe(0);
  });

  it("ArenaState.chat accepts message rows", () => {
    const state = new ArenaState();
    const m = new ChatMessageState();
    m.text = "gl hf";
    state.chat.push(m);
    expect(state.chat.length).toBe(1);
    expect(state.chat[0].text).toBe("gl hf");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/schema/schema.test.ts`
Expected: FAIL — cannot resolve `./ChatMessageState.js`.

- [ ] **Step 3: Write the schema class**

Create `packages/shared/src/schema/ChatMessageState.ts`:

```ts
import { Schema, type } from "@colyseus/schema";

/**
 * One lobby chat message (LC11).
 *
 * `name` and `colorId` are snapshotted at send time, not resolved through `ArenaState.players` at
 * render time (LC1). A message is a record of something that was said, so it has to outlive its
 * sender: a lookup would render every message from a player who left or was kicked as nameless and
 * grey the instant their PlayerState was deleted.
 *
 * `seq` is a monotonic id derived from the previous row (LC12). The client's render signature needs
 * it because `chat.length` cannot detect a new message once the buffer is at its cap — an append
 * plus a shift leaves the length unchanged — and comparing text fails on two identical messages in
 * the same minute. It doubles as a stable render key.
 *
 * `at` is a server-formatted HH:MM string (LC3), not an epoch: an epoch rendered per-machine shows
 * each viewer their own timezone, which is not "server time".
 *
 * Display-only. `stepSim` never reads any of it, which is why invariant 8 — a one-way rule — is not
 * strained here; chat is networked for the reason `winnerSessionId` is, so that a client which never
 * observed the event can still draw it.
 */
export class ChatMessageState extends Schema {
  @type("uint32") seq = 0;
  @type("string") sessionId = "";
  @type("string") name = "";
  @type("uint8") colorId = 0;
  @type("string") text = "";
  @type("string") at = "";
}
```

- [ ] **Step 4: Add the field to `ArenaState`**

In `packages/shared/src/schema/ArenaState.ts`, add the import beside the other schema imports:

```ts
import { ChatMessageState } from "./ChatMessageState.js";
```

Change the class's opening line to bring in `ArraySchema`:

```ts
import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
```

And add this field at the end of the class, after `weapons`:

```ts
  /**
   * The lobby chat buffer, capped at `CHAT_CONFIG.maxMessages` by the server (LC4). Oldest first.
   * Display-only — `stepSim` never reads it. Never cleared by any phase transition (LC5): a message
   * leaves only by being the oldest of twenty-one, and the whole buffer dies with the room.
   */
  @type([ChatMessageState]) chat = new ArraySchema<ChatMessageState>();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/shared/src/schema/schema.test.ts`
Expected: PASS, including the four new tests.

- [ ] **Step 6: Export from the shared barrel**

In `packages/shared/src/index.ts`, add beside the other schema exports:

```ts
export { ChatMessageState } from "./schema/ChatMessageState.js";
```

- [ ] **Step 7: Build shared and run the full suite**

```bash
npm run build -w @motor-combat-moba/shared
npm test
```

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/schema/ChatMessageState.ts packages/shared/src/schema/ArenaState.ts packages/shared/src/schema/schema.test.ts packages/shared/src/index.ts
git commit -m "feat(chat): ChatMessageState schema and ArenaState.chat buffer (LC1, LC7, LC11, LC12)"
```

---

### Task 3: The `MSG_CHAT` wire message and its payload guard

Implements LC15.

**Files:**
- Modify: `packages/shared/src/net/lobby-messages.ts`
- Test: `packages/shared/src/net/lobby-messages.test.ts` (add `describe` blocks)
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MSG_CHAT = "chat"` and `isChatPayload(msg: unknown): msg is { text: string }`, both re-exported from `@motor-combat-moba/shared`.

**Note for the implementer:** the two existing lobby guards (`isSetModePayload`, `isKickPayload`) are private functions at the bottom of `packages/server/src/rooms/ArenaRoom.ts`, not in shared. Chat's guard goes in **shared** anyway, matching `isPlaygroundSetup` and `isPracticeSetup`, because shared is where it can be unit-tested — the room's private guards have no direct coverage. Do not move the existing two; that is out of scope.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/net/lobby-messages.test.ts`, extending its existing import from `./lobby-messages.js` to include `MSG_CHAT` and `isChatPayload`:

```ts
describe("MSG_CHAT (LC15)", () => {
  it("exports the chat message type string", () => {
    expect(MSG_CHAT).toBe("chat");
  });
});

describe("isChatPayload", () => {
  it("accepts a well-formed payload", () => {
    expect(isChatPayload({ text: "gl hf" })).toBe(true);
  });

  it("accepts an empty string — length is the validator's job, not the guard's", () => {
    expect(isChatPayload({ text: "" })).toBe(true);
  });

  it("rejects a missing text field", () => {
    expect(isChatPayload({})).toBe(false);
  });

  it("rejects a non-string text field", () => {
    expect(isChatPayload({ text: 42 })).toBe(false);
    expect(isChatPayload({ text: null })).toBe(false);
    expect(isChatPayload({ text: ["gl"] })).toBe(false);
  });

  it("rejects text reaching in through the prototype chain", () => {
    expect(isChatPayload(Object.create({ text: "gl hf" }))).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isChatPayload(null)).toBe(false);
    expect(isChatPayload(undefined)).toBe(false);
    expect(isChatPayload("gl hf")).toBe(false);
    expect(isChatPayload(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/net/lobby-messages.test.ts`
Expected: FAIL — `MSG_CHAT` and `isChatPayload` are not exported.

- [ ] **Step 3: Add the message and guard**

Append to `packages/shared/src/net/lobby-messages.ts`:

```ts
/**
 * A lobby chat message from a client. An intent, not state (invariant 3): the server re-validates
 * the text, decides whether the sender is allowed to speak, and stamps the time.
 */
export const MSG_CHAT = "chat";

/**
 * Wire-shape only — whether the text is *sendable* is `validateChatText`'s question, which is why an
 * empty string passes here. `Object.hasOwn` rather than a bare property read so a payload cannot
 * satisfy the guard through its prototype.
 */
export function isChatPayload(msg: unknown): msg is { text: string } {
  if (msg === null || typeof msg !== "object") return false;
  if (!Object.hasOwn(msg, "text")) return false;
  return typeof (msg as { text: unknown }).text === "string";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/shared/src/net/lobby-messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Export from the shared barrel**

In `packages/shared/src/index.ts`, add `MSG_CHAT` and `isChatPayload` to the existing export block from `./net/lobby-messages.js`:

```ts
export {
  MSG_SWITCH_TEAM,
  MSG_SET_MODE,
  MSG_START_MATCH,
  MSG_KICK,
  MSG_START_ERROR,
  MSG_SELECT_CAR,
  MSG_PREVIEW_CAR,
  MSG_RETURN_TO_LOBBY,
  MSG_CHAT,
  isChatPayload,
} from "./net/lobby-messages.js";
```

- [ ] **Step 6: Build shared and run the full suite**

```bash
npm run build -w @motor-combat-moba/shared
npm test
```

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/net/lobby-messages.ts packages/shared/src/net/lobby-messages.test.ts packages/shared/src/index.ts
git commit -m "feat(chat): MSG_CHAT intent and payload guard (LC15)"
```

---

### Task 4: Server chat helpers — gating, retention, clock

Implements LC4, LC12, LC17, LC19, LC20.

**Files:**
- Create: `packages/server/src/rooms/chat.ts`
- Test: `packages/server/src/rooms/chat.test.ts`

**Interfaces:**
- Consumes: `CHAT_CONFIG`, `ChatMessageState` (Tasks 1–2).
- Produces:
  - `canSendChat(gate: ChatSendGate): boolean` where `ChatSendGate = { status: PlayerStatus; lastSentAt: number | undefined; now: number }`
  - `pushChatMessage(chat: ArraySchema<ChatMessageState>, row: { sender: ChatSender; text: string; at: string }): ChatMessageState` where `ChatSender = { sessionId: string; name: string; colorId: number }`
  - `formatClockTime(now: Date): string`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/rooms/chat.test.ts`:

```ts
import { ArraySchema } from "@colyseus/schema";
import { describe, expect, it } from "vitest";
import { CHAT_CONFIG, ChatMessageState, PlayerStatus } from "@motor-combat-moba/shared";
import { canSendChat, formatClockTime, pushChatMessage } from "./chat.js";

const SENDER = { sessionId: "s1", name: "Redline", colorId: 3 };

function push(chat: ArraySchema<ChatMessageState>, text: string): ChatMessageState {
  return pushChatMessage(chat, { sender: SENDER, text, at: "14:32" });
}

describe("canSendChat (LC17, LC20)", () => {
  it("lets a READY player speak when they have never sent", () => {
    expect(canSendChat({ status: PlayerStatus.READY, lastSentAt: undefined, now: 1000 })).toBe(true);
  });

  it("refuses a player who is in a match", () => {
    // READY is exactly the status viewFor maps to the lobby screen, so this gate and the UI that
    // shows the panel are the same predicate and cannot drift apart.
    expect(canSendChat({ status: PlayerStatus.IN_MATCH, lastSentAt: undefined, now: 1000 })).toBe(false);
  });

  it("refuses a player on the results screen", () => {
    expect(canSendChat({ status: PlayerStatus.POST_MATCH, lastSentAt: undefined, now: 1000 })).toBe(false);
  });

  it("refuses a second send inside the cooldown", () => {
    const now = 1000 + CHAT_CONFIG.sendCooldownMs - 1;
    expect(canSendChat({ status: PlayerStatus.READY, lastSentAt: 1000, now })).toBe(false);
  });

  it("allows a send exactly at the cooldown boundary", () => {
    const now = 1000 + CHAT_CONFIG.sendCooldownMs;
    expect(canSendChat({ status: PlayerStatus.READY, lastSentAt: 1000, now })).toBe(true);
  });

  it("allows a send well after the cooldown", () => {
    expect(canSendChat({ status: PlayerStatus.READY, lastSentAt: 1000, now: 99000 })).toBe(true);
  });
});

describe("pushChatMessage (LC4, LC12)", () => {
  it("copies the sender onto the row rather than referencing them (LC1)", () => {
    const chat = new ArraySchema<ChatMessageState>();
    const row = push(chat, "gl hf");
    expect(row.sessionId).toBe("s1");
    expect(row.name).toBe("Redline");
    expect(row.colorId).toBe(3);
    expect(row.text).toBe("gl hf");
    expect(row.at).toBe("14:32");
  });

  it("numbers the first message 1", () => {
    const chat = new ArraySchema<ChatMessageState>();
    expect(push(chat, "one").seq).toBe(1);
  });

  it("increments seq for each message", () => {
    const chat = new ArraySchema<ChatMessageState>();
    push(chat, "one");
    push(chat, "two");
    expect(push(chat, "three").seq).toBe(3);
  });

  it("holds maxMessages without dropping anything", () => {
    const chat = new ArraySchema<ChatMessageState>();
    for (let i = 0; i < CHAT_CONFIG.maxMessages; i += 1) push(chat, `m${i}`);
    expect(chat.length).toBe(CHAT_CONFIG.maxMessages);
    expect(chat[0].text).toBe("m0");
  });

  it("drops the oldest message on the one past the cap", () => {
    const chat = new ArraySchema<ChatMessageState>();
    for (let i = 0; i < CHAT_CONFIG.maxMessages + 1; i += 1) push(chat, `m${i}`);
    expect(chat.length).toBe(CHAT_CONFIG.maxMessages);
    expect(chat[0].text).toBe("m1");
    expect(chat[chat.length - 1].text).toBe(`m${CHAT_CONFIG.maxMessages}`);
  });

  it("keeps seq monotonic across a shift, which is why length cannot be the change signal (LC12)", () => {
    const chat = new ArraySchema<ChatMessageState>();
    for (let i = 0; i < CHAT_CONFIG.maxMessages; i += 1) push(chat, `m${i}`);
    const lengthBefore = chat.length;
    const seqBefore = chat[chat.length - 1].seq;
    push(chat, "one more");
    expect(chat.length).toBe(lengthBefore);
    expect(chat[chat.length - 1].seq).toBe(seqBefore + 1);
  });
});

describe("formatClockTime (LC3)", () => {
  it("formats an afternoon time 24-hour", () => {
    expect(formatClockTime(new Date(2026, 8, 6, 14, 32))).toBe("14:32");
  });

  it("zero-pads hours and minutes", () => {
    expect(formatClockTime(new Date(2026, 8, 6, 9, 5))).toBe("09:05");
  });

  it("renders midnight as 00:00", () => {
    expect(formatClockTime(new Date(2026, 8, 6, 0, 0))).toBe("00:00");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/server/src/rooms/chat.test.ts`
Expected: FAIL — cannot resolve `./chat.js`.

- [ ] **Step 3: Write the helpers**

Create `packages/server/src/rooms/chat.ts`:

```ts
import type { ArraySchema } from "@colyseus/schema";
import { CHAT_CONFIG, ChatMessageState, PlayerStatus } from "@motor-combat-moba/shared";

/**
 * Lobby chat's server-side rules, kept out of `ArenaRoom` so they can be tested directly — the same
 * shape `MSG_START_MATCH` already uses when it defers to `canStart`. The room tests in this package
 * exercise extracted helpers, never a live `onMessage` through a Colyseus room.
 */

export interface ChatSendGate {
  status: PlayerStatus;
  /** When this player last sent, or undefined if they never have. */
  lastSentAt: number | undefined;
  /** Wall-clock milliseconds. Passed in rather than read here so the cooldown is testable. */
  now: number;
}

/**
 * Both send gates in one predicate (LC17, LC20).
 *
 * `READY` is exactly the status `viewFor` maps to the lobby screen, so "may speak" and "is looking
 * at the chat panel" are the same question and cannot drift apart.
 */
export function canSendChat(gate: ChatSendGate): boolean {
  if (gate.status !== PlayerStatus.READY) return false;
  if (gate.lastSentAt === undefined) return true;
  return gate.now - gate.lastSentAt >= CHAT_CONFIG.sendCooldownMs;
}

export interface ChatSender {
  sessionId: string;
  name: string;
  colorId: number;
}

/**
 * Append a message and enforce the cap (LC4). `seq` is derived from the previous row rather than
 * held in a counter field somewhere (LC12) — there is nothing to keep in sync with the array, and a
 * uint32 cannot be exhausted at typing speed within one room's life.
 */
export function pushChatMessage(
  chat: ArraySchema<ChatMessageState>,
  row: { sender: ChatSender; text: string; at: string },
): ChatMessageState {
  const previous = chat.length > 0 ? chat[chat.length - 1] : undefined;
  const message = new ChatMessageState();
  message.seq = (previous?.seq ?? 0) + 1;
  message.sessionId = row.sender.sessionId;
  message.name = row.sender.name;
  message.colorId = row.sender.colorId;
  message.text = row.text;
  message.at = row.at;
  chat.push(message);
  while (chat.length > CHAT_CONFIG.maxMessages) chat.shift();
  return message;
}

/** `HH:MM`, 24-hour, zero-padded (LC3). Takes a Date so the format is testable without faking time. */
export function formatClockTime(now: Date): string {
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/server/src/rooms/chat.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/rooms/chat.ts packages/server/src/rooms/chat.test.ts
git commit -m "feat(chat): server gating, retention and clock helpers (LC4, LC12, LC17, LC19, LC20)"
```

---

### Task 5: Wire the chat handler into `ArenaRoom`

Implements LC16, LC18, LC20.

**Files:**
- Modify: `packages/server/src/rooms/ArenaRoom.ts` (imports; the `chatLastSentAt` field near the other per-session maps around line 100; a new `onMessage` in `onCreate` after the `MSG_RETURN_TO_LOBBY` handler around line 213; a delete in `onLeave` around line 262)

**Interfaces:**
- Consumes: `canSendChat`, `pushChatMessage`, `formatClockTime` (Task 4); `MSG_CHAT`, `isChatPayload`, `validateChatText` (Tasks 1, 3).
- Produces: nothing new for later tasks. This task has no new unit test — its logic lives in Task 4's tested helpers, and it is verified by the build plus the manual check in Step 5.

- [ ] **Step 1: Add the imports**

In `packages/server/src/rooms/ArenaRoom.ts`, add to the existing `@motor-combat-moba/shared` import block:

```ts
  MSG_CHAT,
  isChatPayload,
  validateChatText,
```

And add a new import beside the other `./` room imports:

```ts
import { canSendChat, formatClockTime, pushChatMessage } from "./chat.js";
```

- [ ] **Step 2: Add the cooldown map**

In the private-field block near the top of the class (beside `phaseCaps` and `postMatchIds`), add:

```ts
  /**
   * When each player last sent a chat message, in wall-clock ms (LC20). Not ticks: this is an
   * anti-spam guard with no relationship to the sim, and a tick-based one would silently halve when
   * netcode phase 1 takes TICK_RATE_HZ from 30 to 60.
   */
  private chatLastSentAt = new Map<string, number>();
```

- [ ] **Step 3: Add the handler**

In `onCreate`, immediately after the `MSG_RETURN_TO_LOBBY` handler, add:

```ts
    /**
     * Lobby chat (LC16). Every guard drops silently, matching MSG_SWITCH_TEAM, MSG_KICK and
     * MSG_SELECT_CAR above — MSG_START_ERROR is the file's one exception and earns it because a
     * host needs to know why a start was refused. A refused chat message does not: the client ran
     * `validateChatText` before sending, so anything rejected here is a stale or hostile client.
     */
    this.onMessage(MSG_CHAT, (client, msg: unknown) => {
      if (!isChatPayload(msg)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const now = Date.now();
      const gate = {
        status: player.status,
        lastSentAt: this.chatLastSentAt.get(client.sessionId),
        now,
      };
      if (!canSendChat(gate)) return;
      const result = validateChatText(msg.text);
      if (!result.ok) return;
      this.chatLastSentAt.set(client.sessionId, now);
      pushChatMessage(this.state.chat, {
        sender: { sessionId: player.sessionId, name: player.name, colorId: player.colorId },
        text: result.text,
        at: formatClockTime(new Date()),
      });
    });
```

- [ ] **Step 4: Clean up on leave**

In `onLeave`, beside the existing `this.phaseCaps.delete(client.sessionId);`, add:

```ts
    this.chatLastSentAt.delete(client.sessionId);
```

Note the messages themselves are deliberately **not** removed — a message is a record of what was said, not a property of current membership (LC1, LC5).

- [ ] **Step 5: Build and verify the handler actually reached the bundle**

```bash
npm run build
npm test
```

Then confirm the built server bundle really contains the new code — this is the check that catches a stale or escaped shared `dist`:

```bash
grep -c "chatLastSentAt" packages/server/dist/index.js
```

Expected: a number greater than 0. If it prints `0`, re-read the "Shared `dist` gotcha" section of `CLAUDE.md` before continuing.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/rooms/ArenaRoom.ts
git commit -m "feat(chat): accept and store MSG_CHAT in ArenaRoom (LC16, LC18, LC20)"
```

---

### Task 6: The client chat view-model

Implements LC24 (view-model half).

**Files:**
- Create: `packages/client/src/ui/chat-view.ts`
- Test: `packages/client/src/ui/chat-view.test.ts`

**Interfaces:**
- Consumes: `COLOR_TABLE` from shared.
- Produces: `ChatViewRow = { seq: number; sessionId: string; name: string; colorId: number; text: string; at: string }`, `ChatViewMessage = { key: string; label: string; hex: string; text: string; at: string }`, and `chatView(rows: readonly ChatViewRow[], mySessionId: string): ChatViewMessage[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/ui/chat-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COLOR_TABLE } from "@motor-combat-moba/shared";
import { chatView, type ChatViewRow } from "./chat-view.js";

function row(overrides: Partial<ChatViewRow> = {}): ChatViewRow {
  return {
    seq: 1,
    sessionId: "them",
    name: "Redline",
    colorId: 0,
    text: "gl hf",
    at: "14:32",
    ...overrides,
  };
}

describe("chatView", () => {
  it("returns nothing for an empty buffer", () => {
    expect(chatView([], "me")).toEqual([]);
  });

  it("labels another player by name", () => {
    expect(chatView([row()], "me")[0].label).toBe("Redline");
  });

  it("labels your own messages 'You'", () => {
    expect(chatView([row({ sessionId: "me" })], "me")[0].label).toBe("You");
  });

  it("paints the name in the sender's lobby colour", () => {
    expect(chatView([row({ colorId: 2 })], "me")[0].hex).toBe(COLOR_TABLE[2].hex);
  });

  it("falls back to grey for a colour id off the end of the table", () => {
    const view = chatView([row({ colorId: 99 })], "me");
    expect(view[0].hex).toBe("#888888");
  });

  it("keeps the sender's snapshotted name even when they are no longer in the room", () => {
    // Nothing here consults a player list, which is the whole point of LC1.
    expect(chatView([row({ name: "Ghost" })], "me")[0].label).toBe("Ghost");
  });

  it("passes text and time through untouched", () => {
    const view = chatView([row({ text: "no rush", at: "09:05" })], "me");
    expect(view[0].text).toBe("no rush");
    expect(view[0].at).toBe("09:05");
  });

  it("keys each message by its seq, which is unique across a shift", () => {
    const view = chatView([row({ seq: 21 }), row({ seq: 22 })], "me");
    expect(view.map((m) => m.key)).toEqual(["21", "22"]);
  });

  it("preserves buffer order — oldest first (LC2)", () => {
    const view = chatView([row({ seq: 1, text: "first" }), row({ seq: 2, text: "second" })], "me");
    expect(view.map((m) => m.text)).toEqual(["first", "second"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/client/src/ui/chat-view.test.ts`
Expected: FAIL — cannot resolve `./chat-view.js`.

- [ ] **Step 3: Write the view-model**

Create `packages/client/src/ui/chat-view.ts`:

```ts
import { COLOR_TABLE } from "@motor-combat-moba/shared";

/**
 * Chat rows to everything the panel draws. Pure and Phaser-free, for the same reason `lobby-view.ts`
 * is: the rules worth testing live here, leaving the screen module with nothing but markup.
 */

const FALLBACK_HEX = "#888888";

/** The shape of a `ChatMessageState` row, structurally typed so tests need no schema instance. */
export interface ChatViewRow {
  seq: number;
  sessionId: string;
  name: string;
  colorId: number;
  text: string;
  at: string;
}

export interface ChatViewMessage {
  key: string;
  label: string;
  hex: string;
  text: string;
  at: string;
}

/**
 * Nothing in here consults the player list — the row already carries the sender's name and colour
 * (LC1), which is what lets a message from someone who has left keep reading correctly.
 */
export function chatView(
  rows: readonly ChatViewRow[],
  mySessionId: string,
): ChatViewMessage[] {
  return rows.map((row) => ({
    key: String(row.seq),
    label: row.sessionId === mySessionId ? "You" : row.name,
    hex: COLOR_TABLE[row.colorId]?.hex ?? FALLBACK_HEX,
    text: row.text,
    at: row.at,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/client/src/ui/chat-view.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test
git add packages/client/src/ui/chat-view.ts packages/client/src/ui/chat-view.test.ts
git commit -m "feat(chat): client chat view-model (LC24)"
```

---

### Task 7: The chat panel markup and the scroll-pin predicate

Implements LC22, LC24 (markup half), and the layout section of the spec.

**Files:**
- Modify: `packages/client/src/ui/dom.ts` (move `icon` here so two screens can share it)
- Modify: `packages/client/src/ui/screens/lobby.ts` (delete its local `icon`, import it instead)
- Create: `packages/client/src/ui/screens/chat.ts`
- Test: `packages/client/src/ui/screens/chat.test.ts`

**Interfaces:**
- Consumes: `ChatViewMessage` (Task 6); `h`, `button`, `svg` from `dom.ts`.
- Produces:
  - `icon(markup: string, size: number, filled: boolean): SVGElement` — moved to `dom.ts`, same signature it had in `lobby.ts`.
  - `SCROLL_PIN_SLACK_PX: number`
  - `shouldPinToBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean`
  - `ChatHandlers = { onChatInput(text: string): void; onChatSend(): void }`
  - `chatPanel(messages: ChatViewMessage[], draft: string, handlers: ChatHandlers): HTMLElement`
  - The panel's input carries `data-chat-input` and its scroller carries `data-chat-list`; Task 9 finds them by those attributes.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/ui/screens/chat.test.ts`. Only the pure predicate is tested — client tests run in `node`, so nothing here may touch `document`:

```ts
import { describe, expect, it } from "vitest";
import { SCROLL_PIN_SLACK_PX, shouldPinToBottom } from "./chat.js";

describe("shouldPinToBottom (LC22)", () => {
  it("pins when the list is scrolled to the very bottom", () => {
    // 400 tall of content in a 200 tall box, scrolled the full 200 down.
    expect(shouldPinToBottom(200, 400, 200)).toBe(true);
  });

  it("pins when the list is shorter than its container", () => {
    expect(shouldPinToBottom(0, 120, 200)).toBe(true);
  });

  it("pins when within the slack of the bottom", () => {
    expect(shouldPinToBottom(200 - SCROLL_PIN_SLACK_PX, 400, 200)).toBe(true);
  });

  it("does not pin when the player has scrolled up to read history", () => {
    // Yanking them back down every time someone talks is the bug this prevents.
    expect(shouldPinToBottom(0, 400, 200)).toBe(false);
  });

  it("does not pin just past the slack", () => {
    expect(shouldPinToBottom(200 - SCROLL_PIN_SLACK_PX - 1, 400, 200)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/client/src/ui/screens/chat.test.ts`
Expected: FAIL — cannot resolve `./chat.js`.

- [ ] **Step 3: Move `icon` into `dom.ts`**

Append to `packages/client/src/ui/dom.ts`:

```ts
/**
 * A sized SVG icon from Lucide path markup. Lives here rather than in one screen because both the
 * lobby and the chat panel draw icons; `filled` picks between a solid glyph and a stroked one at the
 * design file's stroke-width.
 */
export function icon(markup: string, size: number, filled: boolean): SVGElement {
  const el = svg(markup);
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("viewBox", "0 0 24 24");
  if (filled) {
    el.setAttribute("fill", "currentColor");
  } else {
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", "currentColor");
    el.setAttribute("stroke-width", "2.75");
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
  }
  return el;
}
```

Then in `packages/client/src/ui/screens/lobby.ts`, **delete** its local `function icon(...)` definition and add `icon` to the existing import from `../dom.js`:

```ts
import { button, h, icon, svg } from "../dom.js";
```

If `svg` is then unused in `lobby.ts`, drop it from that import.

- [ ] **Step 4: Write the chat panel**

Create `packages/client/src/ui/screens/chat.ts`:

```ts
import { CHAT_CONFIG } from "@motor-combat-moba/shared";
import { button, h, icon } from "../dom.js";
import type { ChatViewMessage } from "../chat-view.js";

/**
 * The lobby's chat panel: a scrolling list of the last `CHAT_CONFIG.maxMessages` messages, oldest at
 * the top (LC2), over a one-line composer.
 *
 * The panel holds no state. The draft text lives on `LobbyScene` and arrives as a parameter (LC21),
 * because the lobby re-renders wholesale and an `<input>`'s value would not survive it. The two
 * `data-` attributes are how the scene finds the input and the scroller again after a render to put
 * focus, selection and scroll position back.
 */

/** Lucide `send`. */
const PAPER_PLANE = '<path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path>';

/** How near the bottom still counts as "at the bottom", in px. Covers sub-pixel and rounding drift. */
export const SCROLL_PIN_SLACK_PX = 24;

/**
 * Should the list jump to the newest message after a render? Only if it was already at the bottom —
 * otherwise a player scrolled up reading history is yanked back every time someone talks (LC22).
 *
 * A list shorter than its container yields a negative distance, which is correctly "at the bottom".
 */
export function shouldPinToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= SCROLL_PIN_SLACK_PX;
}

export interface ChatHandlers {
  onChatInput(text: string): void;
  onChatSend(): void;
}

function messageRow(message: ChatViewMessage): HTMLElement {
  return h("div", { style: "margin-bottom: 10px;" }, [
    h("div", { style: "display: flex; align-items: baseline; gap: 8px;" }, [
      h("span", { style: `font-size: 13px; font-weight: 600; color: ${message.hex};` }, [message.label]),
      h("span", { style: "font-size: 11px; color: var(--color-neutral-600);" }, [message.at]),
    ]),
    h("div", { style: "font-size: 13px; color: var(--color-text); word-break: break-word;" }, [message.text]),
  ]);
}

export function chatPanel(
  messages: ChatViewMessage[],
  draft: string,
  handlers: ChatHandlers,
): HTMLElement {
  const field = h("input", {
    type: "text",
    placeholder: "Say something...",
    value: draft,
    maxLength: CHAT_CONFIG.maxLength,
    "data-chat-input": "true",
    "aria-label": "Chat message",
    style:
      "flex: 1; min-width: 0; min-height: 40px; padding: 0 14px; font: inherit; font-size: 13px; " +
      "color: var(--color-text); background: var(--color-bg); border: 1px solid var(--color-divider); " +
      "border-radius: 4px; outline: none;",
  });

  field.addEventListener("input", () => handlers.onChatInput(field.value));
  field.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    // Stop here rather than letting it bubble: nothing else on this screen should treat Enter as a
    // press, and the scene is about to re-render underneath us.
    event.preventDefault();
    event.stopPropagation();
    handlers.onChatSend();
  });

  const list = h(
    "div",
    {
      "data-chat-list": "true",
      style: "flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px; background: var(--color-bg); border-radius: 4px;",
    },
    messages.length > 0
      ? messages.map((message) => messageRow(message))
      : [h("div", { style: "font-size: 13px; color: var(--color-neutral-600);" }, ["No messages yet."])],
  );

  return h(
    "div",
    {
      style:
        "display: flex; flex-direction: column; width: 100%; max-width: 652px; height: 100%; min-height: 0; gap: 12px; " +
        "padding: 16px 18px; background: var(--color-surface); border: 1px solid var(--color-divider);",
    },
    [
      h(
        "div",
        { style: "font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-accent);" },
        ["Chat"],
      ),
      list,
      h("div", { style: "display: flex; gap: 10px; align-items: stretch;" }, [
        field,
        button(
          {
            class: "btn btn-primary btn-icon",
            style: "width: 40px; min-height: 40px; flex: none;",
            "aria-label": "Send message",
          },
          [icon(PAPER_PLANE, 17, false)],
          handlers.onChatSend,
        ),
      ]),
    ],
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/client/src/ui/screens/chat.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck and run the full suite**

```bash
npm run build
npm test
```

Expected: the client builds — this is what proves the `icon` move left `lobby.ts` valid.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/ui/dom.ts packages/client/src/ui/screens/lobby.ts packages/client/src/ui/screens/chat.ts packages/client/src/ui/screens/chat.test.ts
git commit -m "feat(chat): chat panel markup and scroll-pin predicate (LC22, LC24)"
```

---

### Task 8: Teach the lobby render signature about chat

Implements LC12 (client half).

**Files:**
- Modify: `packages/client/src/scenes/lobby-signature.ts`
- Test: `packages/client/src/scenes/lobby-signature.test.ts` (add cases; existing fixtures need a `chat` field)

**Interfaces:**
- Consumes: nothing.
- Produces: `LobbySignatureState` gains a required `chat: { forEach(cb: (message: { seq: number }) => void): void }`. `lobbyRenderSignature` returns a string with the last message's `seq` appended.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/scenes/lobby-signature.test.ts`:

```ts
describe("lobbyRenderSignature and chat (LC12)", () => {
  const base = {
    mode: 0,
    hostSessionId: "a",
    players: { forEach: () => {} },
  };

  it("is stable when nothing changes", () => {
    const state = { ...base, chat: [{ seq: 3 }] };
    expect(lobbyRenderSignature(state)).toBe(lobbyRenderSignature(state));
  });

  it("changes when a message arrives", () => {
    const before = lobbyRenderSignature({ ...base, chat: [{ seq: 3 }] });
    const after = lobbyRenderSignature({ ...base, chat: [{ seq: 3 }, { seq: 4 }] });
    expect(after).not.toBe(before);
  });

  it("changes on a message that arrives at the cap, where length does not move", () => {
    // The buffer is full: one in, one out, length unchanged. This is the case seq exists for.
    const before = lobbyRenderSignature({ ...base, chat: [{ seq: 20 }, { seq: 21 }] });
    const after = lobbyRenderSignature({ ...base, chat: [{ seq: 21 }, { seq: 22 }] });
    expect(after).not.toBe(before);
  });

  it("changes on two identical messages a minute apart", () => {
    // Text and time would compare equal here; seq is what tells them apart.
    const before = lobbyRenderSignature({ ...base, chat: [{ seq: 7 }] });
    const after = lobbyRenderSignature({ ...base, chat: [{ seq: 7 }, { seq: 8 }] });
    expect(after).not.toBe(before);
  });

  it("handles an empty buffer", () => {
    expect(() => lobbyRenderSignature({ ...base, chat: [] })).not.toThrow();
  });
});
```

Then fix the file's **existing** tests: every state object they build now needs a `chat` field. Add `chat: []` to each one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/client/src/scenes/lobby-signature.test.ts`
Expected: FAIL — the new cases return equal signatures, because chat is not in the signature yet.

- [ ] **Step 3: Add chat to the signature**

In `packages/client/src/scenes/lobby-signature.ts`, add the field to the state type:

```ts
export type LobbySignatureState = {
  mode: number;
  hostSessionId: string;
  players: {
    forEach(callback: (player: LobbySignaturePlayer, sessionId: string) => void): void;
  };
  /**
   * Structurally typed on `forEach` alone, like `players` above — an ArraySchema and a plain array
   * both satisfy it, so tests need no schema instance.
   */
  chat: {
    forEach(callback: (message: { seq: number }) => void): void;
  };
};
```

And append the last seq to the returned string:

```ts
export function lobbyRenderSignature(state: LobbySignatureState): string {
  const rows: string[] = [];
  state.players.forEach((player, sessionId) => {
    rows.push(`${sessionId}:${player.name}:${player.team}:${player.status}:${player.colorId}`);
  });
  rows.sort();
  // The last message's seq, not the buffer's length: at the cap an append plus a shift leaves the
  // length unchanged, and comparing text cannot tell two identical messages apart (LC12).
  let lastSeq = 0;
  state.chat.forEach((message) => {
    lastSeq = message.seq;
  });
  return `${state.mode}|${state.hostSessionId}|${rows.join(";")}|${lastSeq}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/client/src/scenes/lobby-signature.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test
git add packages/client/src/scenes/lobby-signature.ts packages/client/src/scenes/lobby-signature.test.ts
git commit -m "feat(chat): lobby render signature tracks the newest message (LC12)"
```

---

### Task 9: Wire the panel into the lobby screen and scene

Implements LC21, LC22, LC23, and the layout section.

**Files:**
- Modify: `packages/client/src/ui/lobby-view.ts` (the `LobbyView` interface and the `lobbyView` function's input and return)
- Modify: `packages/client/src/ui/screens/lobby.ts` (`LobbyMenus`, `LobbyHandlers`, the layout body of `renderLobby`)
- Modify: `packages/client/src/scenes/LobbyScene.ts` (`freshMenus`, `render`, the two new handlers, focus/scroll capture and restore)

**Interfaces:**
- Consumes: `chatView`, `ChatViewRow`, `ChatViewMessage` (Task 6); `chatPanel`, `shouldPinToBottom`, `ChatHandlers` (Task 7); `MSG_CHAT`, `validateChatText` (Tasks 1, 3).
- Produces: no new exported names for later tasks.

**Note:** there is no unit test in this task. The client's test environment is `node`, so DOM wiring cannot be tested here — every piece of logic worth testing was already extracted into Tasks 6, 7 and 8. Step 7 is a manual verification and it is not optional.

- [ ] **Step 1: Add chat to the view-model**

In `packages/client/src/ui/lobby-view.ts`:

Add to the imports:

```ts
import { chatView, type ChatViewMessage, type ChatViewRow } from "./chat-view.js";
```

Add to the `LobbyView` interface:

```ts
  chat: ChatViewMessage[];
```

Add `chat: readonly ChatViewRow[];` to the state-input parameter type of `lobbyView`, and add this to the object it returns:

```ts
    chat: chatView(input.chat, mySessionId),
```

- [ ] **Step 2: Hold the draft in `LobbyMenus`**

In `packages/client/src/ui/screens/lobby.ts`, add to the `LobbyMenus` interface:

```ts
  /**
   * The chat composer's text. Lives here — caller-owned state passed back in, exactly like the menu
   * flags — because the lobby re-renders wholesale and an <input>'s own value would not survive it
   * (LC21).
   */
  chatDraft: string;
```

Add to the `LobbyHandlers` interface:

```ts
  onChatInput(text: string): void;
  onChatSend(): void;
```

- [ ] **Step 3: Place the panel in the layout**

In `packages/client/src/ui/screens/lobby.ts`, add the import:

```ts
import { chatPanel } from "./chat.js";
```

Then find this line in `renderLobby`'s body — the bare spacer that pushes the bottom row down:

```ts
      h("div", { style: "flex: 1; min-height: 0;" }),
```

Replace it with:

```ts
      // The chat panel occupies the space the spacer used to hold, left-aligned at about one team
      // panel's width. No chamfer: `teamPanel`'s own comment calls the cut corner a flourish for
      // those panels specifically, and the design reference shows this one square.
      h("div", { style: "flex: 1; min-height: 0; display: flex; align-items: stretch; margin-top: 22px; padding-bottom: 18px;" }, [
        chatPanel(view.chat, menus.chatDraft, {
          onChatInput: handlers.onChatInput,
          onChatSend: handlers.onChatSend,
        }),
      ]),
```

- [ ] **Step 4: Reset the draft in `freshMenus`**

In `packages/client/src/scenes/LobbyScene.ts`, add to the object `freshMenus()` returns:

```ts
    chatDraft: "",
```

- [ ] **Step 5: Feed chat rows into the view and add the handlers**

In `packages/client/src/scenes/LobbyScene.ts`, add to the shared import block:

```ts
  MSG_CHAT,
  validateChatText,
```

and add:

```ts
import { shouldPinToBottom } from "../ui/screens/chat.js";
import type { ChatViewRow } from "../ui/chat-view.js";
```

In `render()`, after the `players` loop, collect the chat rows:

```ts
    const chat: ChatViewRow[] = [];
    room.state.chat.forEach((message) => {
      chat.push({
        seq: message.seq,
        sessionId: message.sessionId,
        name: message.name,
        colorId: message.colorId,
        text: message.text,
        at: message.at,
      });
    });
```

and pass `chat` into the `lobbyView(...)` state argument alongside `mode`, `hostSessionId` and `players`.

Then add these two entries to the handlers object passed to `renderLobby`:

```ts
        // Deliberately does not re-render: the character is already on screen, and rebuilding the
        // whole lobby on every keystroke would be absurd.
        onChatInput: (text) => {
          this.menus = { ...this.menus, chatDraft: text };
        },
        onChatSend: () => this.sendChat(),
```

And add this method to the class:

```ts
  /**
   * Send if the draft is sendable, then clear it. The server re-validates (invariant 3); this call
   * only avoids sending something we already know it will refuse.
   */
  private sendChat(): void {
    const room = this.room;
    if (!room) return;
    const result = validateChatText(this.menus.chatDraft);
    if (!result.ok) return;
    room.send(MSG_CHAT, { text: result.text });
    this.menus = { ...this.menus, chatDraft: "" };
    this.render();
  }
```

- [ ] **Step 6: Capture and restore focus, selection and scroll around each render**

Still in `packages/client/src/scenes/LobbyScene.ts`, add this type above the class:

```ts
/** What has to survive the lobby's wholesale re-render (LC21, LC22). */
type ChatUiSnapshot = {
  focused: boolean;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  pinToBottom: boolean;
};
```

Add these two methods to the class. They query `document` rather than reaching into `ScreenOverlay`'s private root — the panel's two `data-` attributes exist nowhere else on the page:

```ts
  private captureChatUi(): ChatUiSnapshot | null {
    const input = document.querySelector<HTMLInputElement>("[data-chat-input]");
    const list = document.querySelector<HTMLElement>("[data-chat-list]");
    if (!input || !list) return null;
    return {
      focused: document.activeElement === input,
      selectionStart: input.selectionStart ?? input.value.length,
      selectionEnd: input.selectionEnd ?? input.value.length,
      scrollTop: list.scrollTop,
      pinToBottom: shouldPinToBottom(list.scrollTop, list.scrollHeight, list.clientHeight),
    };
  }

  /**
   * A null snapshot means this is the first render of the panel, which should open at the newest
   * message — so it pins. Selection is restored as a range, not a caret at the end: being teleported
   * out of the middle of a half-typed sentence is the same bug in a milder form.
   */
  private restoreChatUi(snapshot: ChatUiSnapshot | null): void {
    const input = document.querySelector<HTMLInputElement>("[data-chat-input]");
    const list = document.querySelector<HTMLElement>("[data-chat-list]");
    if (list) {
      list.scrollTop = snapshot === null || snapshot.pinToBottom ? list.scrollHeight : snapshot.scrollTop;
    }
    if (!input || snapshot === null || !snapshot.focused) return;
    input.focus();
    input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
```

Finally, wrap the existing `this.overlay.render(renderLobby(...))` call in `render()`:

```ts
    const chatUi = this.captureChatUi();
    this.overlay.render(
      renderLobby(view, this.menus, {
        // The handlers object already in this file, with Step 5's onChatInput and onChatSend
        // added to it. Do not retype the existing entries — leave them exactly as they are.
      }),
    );
    this.restoreChatUi(chatUi);
```

The capture must happen **before** `overlay.render`, which is what destroys the nodes, and the restore immediately after. Nothing between them may touch the DOM.

- [ ] **Step 7: Build, test, and verify it by hand**

```bash
npm run build
npm test
```

Then run the game and check the behaviour that no test in this repo can reach:

```bash
npm run dev
```

Open `http://localhost:5173` in two browser windows, join with two different names, and confirm:

1. A message sent in one window appears in the other, oldest at the top, newest just above the input.
2. The sender's name is in their lobby colour; your own messages read `You`.
3. The time is `HH:MM` and identical in both windows.
4. **Type a half-finished message in one window and send from the other.** The half-finished text must survive, with the caret where you left it — this is LC21, and it is the whole reason this task exists.
5. Scroll up in a full list, then have the other window send. The view must stay where you left it.
6. Scroll back to the bottom, send again — it must follow the newest message.
7. The input stops accepting characters at 100.
8. Press and hold Enter on a non-empty draft: exactly one message is sent.
9. Play a match in one window while the other sends messages. On returning to the lobby, those messages must be there (LC5).
10. **In that same window, immediately type a message containing W, A, S, D and a space.** Every character must appear. Phaser key captures outlive the arena scene, and `ArenaScene`'s `releaseKeyboardCaptures` on shutdown is the only thing stopping them eating these keystrokes — the bug `keyboard-captures.ts` documents against the join screen's Callsign field. Chat is the second text field in the game and inherits that fix; this is the check that it held (LC23).

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/ui/lobby-view.ts packages/client/src/ui/screens/lobby.ts packages/client/src/scenes/LobbyScene.ts
git commit -m "feat(chat): render the chat panel in the lobby, preserving draft and scroll (LC21, LC22)"
```

---

### Task 10: Documentation

Implements the spec's "Docs to update in the implementing commit" section.

**Files:**
- Modify: `docs/schema-reference.md`
- Modify: `docs/config-reference.md`
- Modify: `docs/networking.md`
- Modify: `docs/project-structure.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything built in Tasks 1–9.
- Produces: nothing code depends on.

- [ ] **Step 1: Document the schema**

In `docs/schema-reference.md`, add a `ChatMessageState` section in the style of the surrounding entries, covering all six fields (`seq`, `sessionId`, `name`, `colorId`, `text`, `at`) and the `ArenaState.chat` array. State that the row snapshots the sender's name and colour rather than referencing their `PlayerState`, and why (LC1), and that the buffer is display-only — `stepSim` never reads it.

- [ ] **Step 2: Document the config**

In `docs/config-reference.md`, add `CHAT_CONFIG` with its three values and what each governs. Note that `sendCooldownMs` is wall-clock rather than ticks, and why (LC20).

- [ ] **Step 3: Document the message**

In `docs/networking.md`, add `MSG_CHAT` to the list of client→server lobby intents. Record the three server-side gates it passes through — `READY`-only, cooldown, `validateChatText` — and that all three drop silently (LC18).

- [ ] **Step 4: Document the new files**

In `docs/project-structure.md`, add the six new source files: `packages/shared/src/config/chat-config.ts`, `packages/shared/src/lobby/chat.ts`, `packages/shared/src/schema/ChatMessageState.ts`, `packages/server/src/rooms/chat.ts`, `packages/client/src/ui/chat-view.ts`, `packages/client/src/ui/screens/chat.ts`.

- [ ] **Step 5: Add a paragraph to `CLAUDE.md`**

Add a short paragraph after the practice-mode paragraph, covering: chat is lobby-screen only, gated on `status === READY` which is exactly what `viewFor` maps to the lobby; the buffer is 20 messages on `ArenaState`, never cleared by a phase transition, and dies with the room; a row snapshots its sender's name and colour so a leaver's messages still read correctly; and `seq` exists because `chat.length` cannot detect a new message at the cap. Link the spec.

- [ ] **Step 6: Verify and commit**

```bash
npm test
```

The suite must still pass — `scripts/manual-page.test.ts` and `scripts/turn-tuning-doc.test.mjs` watch other documents, and nothing in this task should move either.

```bash
git add docs/schema-reference.md docs/config-reference.md docs/networking.md docs/project-structure.md CLAUDE.md
git commit -m "docs: lobby chat schema, config, message and structure"
```

---

## Final verification

- [ ] **Full clean build and suite**

```bash
npm run build
npm test
```

- [ ] **Confirm the server bundle carries the feature, not a stale shared `dist`**

```bash
grep -c "chatLastSentAt" packages/server/dist/index.js
grep -n "shared/dist" packages/server/dist/index.js | head -3
```

The first must print a number greater than 0. The second must show paths reading `../shared/dist/…` — a path reading `../../../../../packages/shared/dist/…` means the build escaped this worktree and is running the main checkout's sim.

- [ ] **No playtest or balance run is needed.** This feature touches nothing in `sim/`, no balance table, no tick order and no prediction path, so no probe measures anything it changes, and `balanceStamp` does not move (so `npm run build:manual` is not owed a run either). This line is here so the next reader does not have to work that out again.

# Motor Combat MOBA — Lobby Chat Design

**Designed:** 2026-09-06 · **Recorded in repo:** 2026-09-06
**Status:** Approved, not yet implemented.
**Builds on:** the shipped lobby (`ArenaRoom`, `ArenaState`, `LobbyScene`, `renderLobby`) and the
singleton-arena rule that keeps one room per server, which is what makes a single shared chat buffer
the whole feature rather than a routing problem.

Decisions are numbered **LC1–LC24** and referenced by number elsewhere.

---

## Problem

Six people sit in a lobby waiting for a host to press Start Match and have no way to say anything to
each other in the game. On a LAN they can talk across the room; the moment this becomes the online
game the roadmap is aimed at, they cannot. There is no text channel anywhere in the product.

The gap is worst in exactly the situation the lobby was built for: the room is a **singleton**, so
while a match runs, the players who are not in it are still sitting on the lobby screen watching
`IN MATCH` and `POST-MATCH` tags. Those people are waiting, together, with nothing to do and no way
to coordinate the next match.

**Lobby chat** is a panel on the lobby screen: the last twenty messages, oldest at the top, each
carrying its sender's name in their lobby colour and a server-stamped clock time, with a one-line
input beneath.

---

## Scope

**In:** a `ChatMessageState` schema class and a capped `chat` array on `ArenaState`; a `CHAT_CONFIG`
table; shared text validation; one client→server intent (`MSG_CHAT`) with server-side gating,
retention and an anti-spam cooldown; a chat panel on the lobby screen with its own view-model; the
focus- and scroll-preservation needed to make a live text input survive the lobby's wholesale
re-render.

**Out:** any change to `stepSim`, the drive model, the OBB hitbox model, collision-damage rules or
friendly-fire; any change to the tick pipeline, the tables, or prediction; chat in the arena,
car-select, reveal or results screens; chat in `PracticeRoom` or `PlaygroundRoom`; profanity
filtering; team-only or private messages; emotes or a quick-chat wheel; unread badges; editing or
deleting a message; persistence beyond the room's lifetime; any new playtest probe.

---

## The governing principle: a message is a record, not a view

**LC1. A chat row is a snapshot of something that was said, not a live projection of who is in the
room.**

The row carries the sender's name and `colorId` copied at send time. It does **not** resolve them
through `state.players` at render time. That single decision is what makes a leaver's, a kicked
player's, and a mid-match player's messages all keep reading correctly — a lookup would render them
nameless and grey the instant their `PlayerState` was deleted.

It is also what makes retention trivial: the buffer has no references into anything else, so
dropping the oldest row is a `shift()` and nothing has to be told about it.

---

## Ordering, timestamps, and retention

**LC2. Oldest at the top, newest at the bottom.** The original request said "descending order of
timestamp", but the supplied UI reference reads oldest-first (`0:02` at the top down to `1:20`), and
that is the convention every chat uses. The reference wins; the newest message is always the one
directly above the input.

**LC3. Timestamps are server wall-clock, formatted `HH:MM`, 24-hour, zero-padded.** The server
formats the string once, at send, and puts it on the row. Clients render it verbatim.

Formatting server-side rather than shipping an epoch and letting each client call
`toLocaleTimeString` is the point of the decision: an epoch rendered per-machine shows each viewer
their *own* timezone, which is not "server time" and diverges the moment the game leaves a single
LAN. One formatted string is unambiguous for every viewer.

This is a deliberate departure from the UI reference, which shows `m:ss` elapsed times (`0:02`,
`1:20`) counted from some shared zero. Elapsed room time was the alternative and was rejected: a
lobby left open for two hours would stamp `120:14`, which reads as nothing at all. The reference
governs layout and ordering (LC2); the clock format is decided here.

**LC4. The buffer holds `CHAT_CONFIG.maxMessages` (20) rows. The twenty-first push drops the
oldest.** Enforced server-side only, in one loop, in one function.

**LC5. Nothing ever clears the buffer.** No phase transition touches it — not `start`, not
`return_to_lobby`, not a kick. A message leaves only by being the oldest of twenty-one. A player
returning from a match therefore reads what the sitting-out players said while they were gone, and a
late joiner gets the backlog for free.

**LC6. The buffer dies with the room, and needs no code to do so.** `ArenaRoom` does not set
`autoDispose`, so Colyseus's default disposes the room when its last client leaves. There is no
"clear chat when empty" rule because there is nothing left to clear.

---

## Transport: the buffer is schema state

**LC7. Chat lives on `ArenaState` as an `ArraySchema<ChatMessageState>`, patched by Colyseus like
any other state.**

The alternative considered was `room.broadcast` with a client-side ring buffer. It is rejected
because LC5 requires history to persist: a returning or late-joining client must receive the
backlog, so the server has to keep the authoritative buffer regardless — at which point broadcasting
is a second delivery path, with its own ordering and dedup risk, bolted onto the work the schema
already does. A hybrid (authoritative buffer, broadcast live, replay on join) has the same cost and
hand-rolls the ordered-list sync Colyseus ships.

Two costs are accepted openly. `ArenaState` grows a display-only field — it already carries several
(`winnerSessionId`, `matchStartedAtTick`, `diedAtTick`). And a `shift()` on a twenty-element
`ArraySchema` sends a reshuffle rather than a tight diff, which is the exact cost the sim's
`statuses` array is deliberately sorted to avoid; twenty short rows at human typing speed do not
justify the same care.

**LC8. Chat does not conflict with the netcode rewrite.** Phase 2 of the 2026-09-04 plans moves
**sim** fields off the Colyseus schema into a hand-packed binary snapshot. Chat is not a sim field
and never becomes one, so it stays exactly where LC7 puts it.

**LC9. Invariant 8 is not strained.** It reads one way — if `stepSim` reads it, it must be a
networked schema field. `stepSim` never reads chat. Chat is networked for the same reason
`winnerSessionId` is: a client that never observed the event still has to be able to draw it.

---

## Shared surface

**LC10. `packages/shared/src/config/chat-config.ts`:**

```ts
export const CHAT_CONFIG = {
  maxLength: 100,
  maxMessages: 20,
  sendCooldownMs: 500,
} as const;
```

No chat number appears anywhere in logic (invariant 2).

**LC11. `packages/shared/src/schema/ChatMessageState.ts`:**

```ts
export class ChatMessageState extends Schema {
  @type("uint32") seq = 0;
  @type("string") sessionId = "";
  @type("string") name = "";
  @type("uint8") colorId = 0;
  @type("string") text = "";
  @type("string") at = "";
}
```

`ArenaState` gains one field: `@type([ChatMessageState]) chat = new ArraySchema<ChatMessageState>()`.
No enum is added or renumbered, so invariant 7 is untouched.

**LC12. `seq` exists because the client's render signature cannot otherwise notice a new message.**
At the twenty-message cap, an append plus a shift leaves `chat.length` unchanged, and comparing the
last row's text fails on two identical messages in the same minute ("lol" twice at 14:32). A
monotonic counter is unambiguous, and it doubles as a stable render key.

The counter is **derived, not stored**: a new row's `seq` is the last row's `seq` plus one, or 1 on
an empty buffer. There is no counter field on `ArenaRoom` to keep in sync with the array, and none on
the schema. A `uint32` cannot be exhausted at human typing speed within one room's life.

**LC13. `packages/shared/src/lobby/chat.ts` mirrors the shape of `names.ts`:**

```ts
export function normalizeChatText(raw: string): string
export function validateChatText(raw: string): ValidateChatResult   // { ok: true, text } | { ok: false, error }
```

Normalize trims and strips control characters and newlines — a lobby message is one line, the panel
has no room for a pasted wall of them, and a stray `\n` breaks row alignment. Validation rejects
empty-after-trim and anything over `CHAT_CONFIG.maxLength`.

**It strips the bidi controls specifically, not the whole `\p{Cf}` category.** An earlier draft of
this decision said `\p{Cf}`, which is wrong: that category contains ZERO WIDTH JOINER and ZERO WIDTH
NON-JOINER, so it silently rewrites ordinary player input — `👨‍👩‍👧‍👦` becomes four separate people,
and Persian `می‌روم` becomes two words, which is a spelling change rather than a formatting one. The
class to remove is `\p{Cc}` plus the bidi set (`U+200E`, `U+200F`, `U+061C`, `U+202A`–`U+202E`,
`U+2066`–`U+2069`), which is all the original rationale — one message reordering the whole list —
ever asked for.

**LC14. Both halves call the same validator.** The client calls it to decide whether Send does
anything; the server calls it to actually decide. The client's copy is a courtesy, never an
authority (invariant 3).

**LC15. `packages/shared/src/net/lobby-messages.ts` gains `MSG_CHAT = "chat"` and an `isChatPayload`
guard**, in the same style as `isSetModePayload` and `isKickPayload` — including rejecting
prototype-chain names, as the playground guards already do. All four additions are re-exported from
`index.ts`.

---

## Server

**LC16. One handler in `ArenaRoom.onCreate`, alongside the other lobby intents:**

```ts
this.onMessage(MSG_CHAT, (client, msg: unknown) => {
  if (!isChatPayload(msg)) return;
  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const now = Date.now();
  if (!canSendChat({ status: player.status, lastSentAt: this.chatLastSentAt.get(client.sessionId), now })) return;
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

The handler is a thin composition over pure functions, which is how `MSG_START_MATCH` is already
built — it defers to `canStart` in `lobby/start-rules.ts` rather than inlining the rules. That
precedent is what makes the gating testable: the server room tests in this codebase exercise
extracted helpers (`practice-rules.ts`, `select-next-host.ts`), never a live `onMessage` through a
Colyseus room, and chat follows suit.

**LC17. `status === PlayerStatus.READY` is the "is on the lobby screen" gate, and it is not a new
rule.** `viewFor` is the status the server-side gate and the UI agree on for any player the room's
state machine can actually produce: `READY` is the only status it maps to `"lobby"` in every reachable
case (its catch-all also answers `"lobby"` for a non-`READY` status when `phase` is `LOBBY`, but the
reducer never leaves a player in that combination — an in-match player is flipped to `POST_MATCH` in
the same transition that sets `phase` back to lobby). So in practice "may speak" and "is looking at
the chat panel" are the same predicate and cannot drift apart.

**LC18. Every guard drops silently.** This matches the file: `MSG_SWITCH_TEAM`, `MSG_KICK` and
`MSG_SELECT_CAR` all bail without a reply. `MSG_START_ERROR` is the sole exception and earns it
because a host needs to know why a start was refused. A refused chat message does not — the client
ran the same validator first, so anything the server rejects is a stale or hostile client.

**LC19. Retention and formatting live in a new `packages/server/src/rooms/chat.ts`, not inline.**
`ArenaRoom.ts` is already 577 lines and this is separable, testable logic:

- `canSendChat({ status, lastSentAt, now })` — the two gates of LC17 and LC20 as one pure predicate:
  the sender is `READY`, and `now - lastSentAt >= CHAT_CONFIG.sendCooldownMs` (an absent
  `lastSentAt` always passes). Takes `now` rather than reading the clock, so the cooldown is
  testable without faking time.
- `pushChatMessage(chat, row)` — stamps `seq` as the last row's plus one (LC12), appends, then
  `while (chat.length > CHAT_CONFIG.maxMessages) chat.shift()`. That loop is the whole of LC4.
- `formatClockTime(now: Date)` — `HH:MM`, 24-hour, zero-padded. Takes a `Date` rather than reading
  the ambient clock, for the same reason.

**LC20. The cooldown is wall-clock, not ticks.** `ArenaRoom` gains `chatLastSentAt:
Map<sessionId, number>` holding `Date.now()`, cleared in `onLeave` beside the six per-session maps
already cleaned up there. It is an anti-spam guard with
no relationship to the sim, and a tick-based one would silently halve when netcode phase 1 takes
`TICK_RATE_HZ` from 30 to 60. At 500 ms no real player notices it; a held Enter key or a scripted
client cannot flush the visible history in a second.

---

## Client

**LC21. The draft text lives on the scene, not in the DOM.**

`LobbyScene.render()` ends in `replaceChildren`, destroying every node. Today `lobbyRenderSignature`
gates that to mode/host/roster changes, which are rare; chat makes it happen on every message. An
`<input>`'s value, caret and focus are DOM state, so a player typing when a message lands would lose
what they had written.

The fix is the pattern the scene already uses for `menus`: `LobbyScene` gains `chatDraft: string`,
passes it in as the input's `value`, and `onChatInput(text)` writes it back **without** re-rendering
— the character is already on screen, and re-rendering per keystroke would be absurd. After each
`overlay.render`, if the input held focus before the swap, it is refocused and its **exact selection
range** restored, not merely the caret placed at the end.

The alternative — a persistent chat island exempt from `replaceChildren` — is rejected: it puts the
first stateful, self-updating component into a codebase whose `dom.ts` states it is "deliberately not
a framework", and leaves two rendering models coexisting in one screen.

**LC22. Scroll position is preserved, and the list auto-scrolls to the bottom only if it was already
at the bottom.** Otherwise a player scrolled up reading history is yanked back every time someone
talks. The predicate `shouldPinToBottom(scrollTop, scrollHeight, clientHeight)` is a pure function;
the DOM read and write around it are not, in keeping with every other screen module.

**LC23. Chat adds no Phaser key binding, which keeps an existing fix valid.**
`keyboard-captures.ts` documents a real past bug: arena key captures outlived their scene and ate
W/A/S/D/Space in the join screen's Callsign field. `ArenaScene` now clears captures on shutdown, so a
player going lobby → match → lobby arrives at a working chat box — chat inherits that fix rather than
needing a new one. Enter-to-send is a DOM `keydown` listener on the input, never a Phaser `addKey`,
so that file's warning ("grep `addKey` before adding a second one") stays satisfied.

**LC24. New client modules, following `screens/` organisation** rather than growing `lobby.ts` (357
lines) or `lobby-view.ts` (228):

- `ui/chat-view.ts` — a pure view-model mapping each row to `{ key, label, hex, text, at }`, where
  `label` is `"You"` for the local `sessionId` and the sender's name otherwise, and `hex` comes from
  the `COLOR_TABLE` lookup `lobby-view.ts` already does.
- `ui/screens/chat.ts` — the panel markup plus `shouldPinToBottom`.

`dom.ts` needs no change: `h("input", { value, maxLength })` already works because `PROPERTIES`
covers all three, and listeners attach to the returned node.

### Layout

`renderLobby` currently holds a bare `flex: 1; min-height: 0` spacer between the team-switch button
and the bottom row. The chat panel goes there, left-aligned at about one team panel's width, as the
UI reference places it; the bottom row with Start Match is untouched.

The panel matches `teamPanel`'s surface and divider treatment but takes **no chamfer** — that
file's own comment calls the cut corner "a small deliberate flourish, not applied to every panel",
and the reference shows a square panel. The `CHAT` header reuses the accent kicker treatment already
in `modesModal`: 11px, uppercase, 0.1em tracking, `--color-accent`. Each row is the sender's name in
their lobby colour with the timestamp in muted grey, and the message text beneath.

The input row is a one-line field placeholdered `Say something...` carrying
`maxLength: CHAT_CONFIG.maxLength`, beside a square accent send button with a paper-plane icon drawn
through the existing `icon()` helper.

XSS is not a concern at any point: `dom.ts` builds text with `createTextNode` and never `innerHTML`.

---

## Testing

Client tests run in a **node** environment (`packages/client/vitest.config.ts`), not jsdom, so every
new client test targets a pure function — the pattern `join.test.ts` already follows by testing
`practiceName` rather than any rendering.

| File | Asserts |
|---|---|
| `shared/src/lobby/chat.test.ts` | empty and whitespace-only rejected; exactly 100 accepted, 101 rejected; newlines and control characters stripped |
| `shared/src/net/lobby-messages.test.ts` | `MSG_CHAT` string; `isChatPayload` rejects non-objects and prototype-chain names |
| `shared/src/schema/schema.test.ts` | `ChatMessageState` fields and `ArenaState.chat` exist |
| `server/src/rooms/chat.test.ts` | twenty in; the twenty-first drops the oldest and preserves order; `seq` increments across a shift; `formatClockTime` zero-pads and handles midnight; `canSendChat` refuses `IN_MATCH` and `POST_MATCH`, refuses a send inside the cooldown, and passes a first-ever send |
| `client/src/ui/chat-view.test.ts` | `"You"` for the local sessionId, name otherwise; colour mapping; empty list |
| `client/src/ui/screens/chat.test.ts` | `shouldPinToBottom` at bottom, mid-scroll, and on a list shorter than its container |
| `client/src/scenes/lobby-signature.test.ts` | a new message changes the signature, **including two identical messages in the same minute** — the case LC12 exists for |

---

## What this does not touch

- **No playtest run is needed.** Chat reaches nothing in `sim/`, no balance table, no tick order and
  no prediction path; no probe measures anything it changes. Stated explicitly rather than left
  silent, per the repo's standing rule.
- **The balance harness, `balanceStamp`, `npm run build:manual` and the turn-tuning doc test are all
  unaffected** — no hashed table moves, so no generated page owes players a rebuild.
- **`PracticeRoom` and `PlaygroundRoom` get no chat.** `PracticeState` and `PlaygroundState` both
  extend `ArenaState`, so the `chat` field is there on their schema too — but neither room registers
  an `MSG_CHAT` handler, so nothing ever appends to it and the inherited buffer just stays empty.
- **Invariants hold.** `MSG_CHAT` is an intent the server adjudicates (3); no enum is renumbered (7);
  invariant 8 is one-way and `stepSim` never reads chat (LC9); the player cap is untouched (10).
- **Build order matters.** Shared changes, so it must be rebuilt with the root `npm run build`; and
  in a worktree `npm install` must run first, or every build silently inlines the main checkout's
  shared `dist`.

## Docs to update in the implementing commit

`docs/schema-reference.md` (the new class and field), `docs/config-reference.md` (`CHAT_CONFIG`),
`docs/networking.md` (a lobby intent beside the existing ones), `docs/project-structure.md` (the four
new source files), and a short paragraph in `CLAUDE.md`.

## Non-goals

No profanity filter, no team-only or private messages, no emotes or quick-chat wheel, no unread
badge, no editing or deleting, no chat outside the lobby screen, no persistence past the room's life.
Each is cheap to add later on top of LC7's buffer.

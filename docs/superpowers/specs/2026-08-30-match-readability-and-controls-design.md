# Motor Combat MOBA — Match Readability and Controls Design

**Designed:** 2026-08-30 · **Recorded in repo:** 2026-08-30
**Status:** Specified.
**Follows on from:**
[`2026-08-30-chassis-rename-and-weapon-redistribution-design.md`](2026-08-30-chassis-rename-and-weapon-redistribution-design.md),
which settled the three-chassis roster this reads from but does not change.

---

## Problem

A match is legible to the person who built it and to nobody else. Seven separate gaps, all of them
reported from the same play session, and all of them about the same thing: **you cannot tell what is
yours.**

1. The countdown ends and you do not know which car you are. Six cars spawn, the camera is already
   on yours, and there is nothing on screen that says so.
2. Every HP bar is the same three colours. The bar tells you how hurt a car is and never whose side
   it is on, so in a 3v3 you read six identical green bars and pick a target by guessing.
3. There is no roster. You cannot see who is in the match, what colour they are, or who is already
   dead — the only death signal is a car fading out somewhere you may not be looking.
4. Movement is arrow keys only. A player whose hands sit on WASD has to move them.
5. Powers are Space / Q / E — three keys in three different places on the keyboard, none of them
   under a hand that is already on WASD or the arrows.
6. `bulwark` is too big. A 60° cone out to 550 units is most of a lane.
7. Lingering ability zones draw **over** cars. Park in your own `bulwark` and you disappear under it.

None of this is a sim problem. Six of the seven are client-only; the seventh (`bulwark`'s size) is
one balance row. What ties them together is that the arena currently draws *the world* correctly and
draws *your place in it* not at all.

---

## The game-design case

### D1. Allegiance outranks health on the HP bar

The bar has two things it could say — "how hurt" and "whose side" — and one colour channel to say
them in. It currently spends that channel on health, which is the thing the bar's **length** already
says. Length and colour were saying the same sentence twice while the more urgent question went
unanswered.

So colour becomes allegiance and nothing else: **your car and your teammates are green, every enemy
is red**, at full HP and at one HP alike. Length remains the only health channel, which is enough —
it is the channel every player already reads.

This deliberately gives up the amber/red low-health warning. That was a real cue and it is a real
loss, but it was a cue about a car you can already see the bar of; the cue it replaces is about a car
you might otherwise shoot by mistake. In FFA every car but yours is an enemy, so the rule degrades to
"green is me, red is everyone else" with no special case.

The gradient is not preserved anywhere, not even on your own car. A rule with an exception for one
car is a rule players have to be taught; a rule with no exceptions is one they read off the screen.

### D2. Allegiance is fixed to *you*, never to who you are watching

A wreck becomes a spectator and can cycle through living cars. Allegiance does **not** follow the
camera. Green stays your team's green while you watch an enemy fill the screen, because the panel and
the bars are answering "who is on my side", and dying does not change the answer.

### D3. The roster is identity, not telemetry

The right panel carries a colour swatch, a name, and nothing else. It answers "who is here, what
colour are they, and are they still alive" — the three facts you cannot get from the field.

It deliberately does **not** carry an HP bar. Per-car health already has a channel (the bar over the
car) and duplicating it in the gutter builds a second place to look during a fight, which is exactly
the cost the panel exists to remove. The panel is glanced at between engagements; the bars are read
during them.

Dead players stay listed and grey out. Removing the row would make the list jump under your eye at
the worst possible moment, and "who is left" is a question the greyed rows answer better than a
shrinking list does.

### D4. The countdown arrow is a teaching aid, not a HUD element

It exists for the three seconds where you have not yet moved and therefore cannot find yourself by
wiggling. The instant the match starts it is gone — no fade, no tween — because from that tick
onward the car that responds to your keys is the answer, and an arrow still hanging over it is
clutter that teaches the player to rely on clutter.

It bobs, and it is always screen-up regardless of which way the car faces. A marker that rotated with
the chassis would be saying something about heading, which is the car's own job; the arrow's only
sentence is "this one".

### D5. Both hands should be able to drive, and the powers should sit under one of them

WASD and the arrows both steer, always, with no setting. Two players sharing a keyboard is not a mode
this game has, so there is no cost to accepting both.

Powers move to **J, K, L** — three adjacent keys under the right hand, which is where a hand rests
when the left one is on WASD. Space / Q / E stop firing entirely rather than lingering as hidden
alternates: an undocumented second binding is a thing that breaks quietly later, and Q and E in
particular are keys a future feature will want.

Spectator free-roam already pans with WASD, and that is not a conflict — free roam is only reachable
once you are dead and have no car to drive.

### D6. `bulwark` loses a fifth of its area, taken entirely out of reach

The zone is a 60° cone, so its area is `½·r²·θ` and 20% comes off either dimension. It comes off
**range**: 550 → 492, with `speed` moving 550 → 492 alongside it so the zone still grows out over
exactly one second and stays visible before it is dangerous.

Narrowing the cone instead would have been the same 20% on paper and a different weapon in play — a
tighter wedge is walked around the sides, which turns a **zone you must leave** into a **line you
must not cross**. Bastion is the slowest chassis on the roster and its area denial is what buys it
the fights it cannot drive to; the weapon should get smaller without changing what it is for.

Nothing else on the row moves. `damage`, `damageFrequencyMs`, `lifetimeMs`, `cooldownMs` and both
`applies` entries are untouched, so a target that stays in the zone takes exactly what it took
before. The nerf is entirely "the zone covers less ground".

### D7. Lingering zones belong under the cars

A car vanishing under its own `bulwark` is the bug, but the fix is a rule about **all** weapon
instances, not a classification of which ones linger. Every live instance draws below every car.

The cost is real and accepted: a `fireball` crossing behind a car is briefly hidden by it. That is
worth naming, because the alternative — a per-weapon "is this a ground effect" list — is a second
taxonomy on top of `kind`, and the one it would encode (`beam` vs `projectile`) is one the table
already has. Ship one rule, play it, and split it later if the hidden projectile turns out to matter
more than the simplicity.

This does not weaken "what you see is the hitbox". The drawn shape is still exactly the shape that
hits; it is now occluded by cars rather than occluding them.

### D8. The beam fade window is anchored to death, not to the start of linger

Today the fade is one rule for all four beams and it already ends exactly at the instance's death
tick, so visual and hitbox already vanish together. What makes it read as a slow dissolve is that the
fade **window** is the entire linger: `bulwark` fades for 2875 ms, `afterburner` for 2000 ms. A zone
that is a ghost for two seconds while still dealing full damage is lying about where it is safe to
stand.

So the window stops being the lifetime and becomes its own number, `BEAM_FADE_OUT_MS`, anchored to
the end:

```
today:  spawn ──flight──┤▓▓▓▓▓▓▓ fade across the whole lifetime ▒▒░░│ death
new:    spawn ──flight──┤████████ full opacity ████████████│▓▒░│ death
                                                       └─ X ms ─┘
```

X ships at **100 ms** — three ticks at 30 Hz, which reads as a clean snap-off rather than a dropped
frame. It stays one rule for all four beams and one constant to change; there is no per-weapon table
and no opt-out flag, because the thing that varies between beams is already their lifetime and
nothing has yet asked for two beams to cut differently.

`lifetimeMs` is untouched, so the damage window does not move, no TTK number changes, and the
manual's balance fingerprint does not see this at all.

---

## The technical case

### D9. Every one of these is client-only except `bulwark`'s two numbers

The schema gains no field. `stepSim` reads nothing new. No message crosses the wire that did not
before. Everything the arrow, the panel, the bar colours and the draw order need is already
networked: `sessionId`, `name`, `colorId`, `team`, `alive`, `hp`, `carId`, `status`, `phase`, `mode`.

`bulwark`'s `range` and `speed` are the only shared change, and they are two fields of one existing
`WEAPON_TABLE` row.

Invariant 8 ("if `stepSim` reads it, it is a networked schema field") is not engaged, because nothing
here is read by `stepSim`. Invariant 2 ("no magic numbers in logic") is: every number this
introduces — the arrow's size and bob, the panel's row height and greys, the fade window, the bar
colours — lands in a named client-side constant, not a literal at a call site.

### D10. Allegiance is a pure function, and it lives in `combat-visual.ts`

```ts
export type Allegiance = "ally" | "enemy";
export function allegianceOf(
  viewer: { sessionId: string; team: number },
  subject: { sessionId: string; team: number },
  mode: "ffa" | "team",
): Allegiance
```

Yourself is always `"ally"`, in both modes. In `"team"` mode a matching `team` is `"ally"`; in
`"ffa"` everyone else is `"enemy"`. It takes the viewer explicitly rather than reading
`room.sessionId` so it stays testable without a room, and so D2 (allegiance follows you, not the
camera) is enforced by the signature rather than by a comment.

`hpBarColor(fraction)` is **replaced**, not extended: it becomes `hpBarColor(allegiance)` and its
three existing tests are rewritten. Keeping a fraction parameter it no longer reads would leave a
trap for the next person to author a gradient into.

`ArenaScene` derives the mode it passes from `room.state.mode === GameMode.TEAM`, which is the same
derivation `renderCars` already does for the impact spark, so the two cannot disagree about what game
they are in.

### D11. The roster is a pure layout function plus a Text pool, like every other HUD piece

`roster-panel.ts` holds the layout — a pure function from a player list and the gutter box to row
rectangles — and `ArenaScene` owns a fixed pool of six `Text` objects created once in `create()` and
shown or hidden per frame. That is exactly the shape `weapon-hud.ts` / `slotBarLayout` and
`status-hud.ts` / `statusStripLayout` already use, and the reason is the same: pure layout is
testable in Node with no canvas, and a fixed pool never allocates during a match.

Six is `MAX_PLAYERS`, imported, not written as `6`.

Ordering is stable and derived, never insertion order: **team, then `joinedAtTick`, then
`sessionId`**. A row that moves when someone dies or a patch arrives is worse than no panel, and
`joinedAtTick` is already networked for exactly this kind of tie-break. In FFA every player is team 0
so the sort degrades to join order.

Rows list every player with `status === IN_MATCH`, alive or dead. A player who left the room is gone
from `state.players` and so drops off the panel — that is correct and different from being dead.

### D12. The gutter holds three things, and the panel's arrival re-budgets all of them

The gutter is 144 px wide and 720 tall and already holds **two** things, not one:

- the three weapon slots, vertically **centred** in the full column (`slotBarLayout`);
- the status badge strip, which is **bottom-aligned to the slots' top edge and grows upward**
  (`statusStripLayout`, whose `slotBarTop` argument is `slotBarLayout(...)[0].y`).

The panel goes at the top, so the slots must move down — and because the strip is anchored to the
slots, it moves with them. That coupling is the part that is easy to miss: pushing the slots down
does not merely make room, it also drags the strip down and hands it more headroom, and the strip
growing upward is then the thing that can collide with the panel.

`slotBarLayout` gains a `topInset` and centres the slots in **what is left below the panel** rather
than in the whole gutter. `statusStripLayout` needs no signature change at all — it already derives
its position from the slots, so it follows correctly for free. That is the reason to inset the slots
rather than to hard-code a new slot top: the one derivation keeps working.

**The worst case has to be arithmetic, not hope.** Six players (`MAX_PLAYERS`), six badges
(`STATUS_CONFIG.maxActive`) and three slots (`maxWeaponSlots`) is a reachable match, and it is the
match this game is designed around. At the shipped constants:

```
panel      10 + 6x18 + 5x2 + 10                     = 138   -> topInset 138
slots      3x64 + 2x28                              = 248
slot top   138 + (720 - 138 - 248) / 2              = 305
strip      bottom 305 - 16 = 289, height 6x24 - 4 = 140
strip top  289 - 140                                = 149   -> 11 px clear of the panel
```

Eleven pixels is not comfortable, and that is exactly why it is written down: the panel's row pitch
and padding are not free parameters, they are spending against a budget three other things also draw
from. A test asserts the worst case does not overlap, so a later nudge to the row height fails loudly
instead of sliding a badge under a name.

`HUD_GUTTER_WIDTH` does **not** change. Widening it is width the whole picture loses to `FIT`
(`display.ts` says so explicitly), and the panel is being asked to fit the column it was given. Names
truncate to the column with an ellipsis rather than the gutter growing to fit the longest name.

### D13. New objects must be assigned to exactly one camera, and one existing object is not

The scene renders across two cameras — a world camera clipped to the arena, and a HUD camera
covering the whole canvas — and Phaser draws the entire display list once per camera. `splitCameras`
therefore keeps two `ignore` lists, and its docstring states the rule: **every object must be ignored
by exactly one camera. Ignored by neither it double-draws; ignored by both it vanishes.**

This work adds two objects to that seam — the roster panel's `Text` pool (HUD) and the countdown
arrow's `Graphics` (world) — so both go in the right list.

While checking that, an existing object turns out to be in **neither** list: `lockGfx`, created at
`LOCK_DEPTH` and never registered. By the rule above the aim-assist lock bracket double-draws today —
once clipped inside the world viewport, and once unclipped across the whole canvas over the gutter.
It is a one-line fix (`lockGfx` joins `worldObjects`), it is in the file and the function this work
already edits, and leaving a known violation in the seam whose invariant this section is relying on
would be worse than fixing it. It ships here, called out rather than folded in silently.

### D14. The arrow is one `Graphics`, drawn in world space at its own depth

Not a `Container` per car and not a tween: it is one triangle redrawn each frame into a dedicated
`Graphics`, the same pattern `hpGfx`, `shotGfx` and `lockGfx` already use. Bob comes from
`performance.now()`, so it is frame-rate independent and needs no tween to cancel when the phase
flips.

It is drawn only when `phase === RoomPhase.COUNTDOWN` **and** the local player is `IN_MATCH`. Both
conditions, not just the phase: a player who joined mid-countdown and is not in the match has no car
to point at.

Its depth sits above cars and below the HP bars, so it never occludes a bar and is never occluded by
a car.

### D15. Draw order becomes one ordered block of constants with the cars named in it

The cars are currently at Phaser's implicit depth 0 — nothing sets it, and the whole layer stack is
therefore built on an unstated default. Weapon instances moving below them makes that default
load-bearing, so `CAR_DEPTH` becomes an explicit constant set on every car container, and the depth
block reads top to bottom as the layer stack:

```
HP_BAR_DEPTH     60   hp bars
LOCK_DEPTH       55   lock brackets
ARROW_DEPTH      52   countdown arrow          ← new
CAR_DEPTH         0   cars                     ← newly explicit
SHOT_DEPTH       -5   every weapon instance    ← moved from 50
ARENA_DEPTH     -10   arena floor
```

`SHOT_DEPTH` keeps its name — it is still every instance, it has simply moved layers.

### D16. `SLOT_KEYS` is where the rebind happens, and it is the only place

`SLOT_KEYS` already exists precisely so a rebind is a local change with no protocol consequence: the
server sees a slot bitmask and never a key. J/K/L is three `code`/`glyph` pairs edited in that table.
The HUD prints `glyph`, so the labels follow for free.

WASD-plus-arrows steering is `axisOf` fed by an OR of two key sets. `axisOf` itself does not change —
its "both directions down means zero" rule is what makes ORing two key sets safe, since holding A and
Right is exactly the same situation as holding Left and Right.

The spectator pan keys (`panLeft`/`panRight`/`panUp`/`panDown`, already W/A/S/D) stay as they are.

### D17. What this does *not* touch

Stated because each was considered and rejected, and a future reader should not have to re-derive it:

- **The sim.** No file under `packages/shared/src/sim/` changes.
- **The schema.** No field added, removed, renumbered or retyped.
- **`hpFraction`, `hpBarPoints`, `HP_BAR_GEOMETRY`.** The bar's geometry and its length-from-HP
  arithmetic are correct; only its fill colour is wrong.
- **`WEAPON_BEAM_STYLES` / `WEAPON_GLOW_STYLES`.** The fade change is about *when* alpha ramps, not
  about what any weapon looks like.
- **`lifetimeMs` on any weapon.** See D8.
- **The other eight weapon rows.** Only `bulwark`'s `range` and `speed`.

---

## What ships

| # | Change | Where |
|---|---|---|
| 1 | Countdown arrow over the local car, bobbing, screen-up, gone the tick the match starts | client |
| 2 | HP bar colour is allegiance: green ally, red enemy; hp gradient removed | client |
| 3 | Right-panel roster: swatch + name, up to `MAX_PLAYERS` rows, dead rows greyed | client |
| 4 | Weapon slots inset below the panel instead of centred in the whole gutter | client |
| 5 | WASD steers alongside the arrows | client |
| 6 | Powers rebind to J / K / L; Space / Q / E stop firing | client |
| 7 | `bulwark` `range` and `speed` 550 → 492 (−20% area) | shared |
| 8 | Every weapon instance draws below the cars | client |
| 9 | Beam fade becomes a 100 ms window ending at the death tick | client |
| 10 | `lockGfx` joins the world camera's ignore list — it is in neither today and double-draws | client |

### Balance impact

Exactly one number pair moves, and it moves reach only. `bulwark`'s per-tick damage, tick frequency,
lifetime, cooldown and both statuses are untouched, so **no time-to-kill changes** — `npm run ttk`
should print the same matrix it prints today. What changes is how much floor the zone denies.

### Doc and generated-artifact impact

- `docs/config-reference.md` — the `bulwark` row's `speed` and `range`.
- `docs/combat-model.md` — the HP-bar paragraph (it currently describes the gradient, and also still
  names a `WRECK_ALPHA` that no longer exists), plus a note that instances draw under cars.
- `docs/project-structure.md` — the new client files.
- `packages/client/public/manual.html` — **must be rebuilt.** `balanceStamp` hashes `WEAPON_TABLE`
  whole, so `bulwark`'s two fields move it and `scripts/manual-page.test.mjs` fails until
  `npm run build:manual` is run and the page committed.

### Playtest impact — flag, do not run

`packages/server/playtest/geometry.ts` measures beam reach for `bulwark` by name. Its numbers for
that weapon are stale the moment `range` moves 550 → 492. **This is the user's call to run**, and it
is called out here so it is not discovered later. The probe is not updated as part of this work
unless asked; if it stops compiling it is fixed on the spot, per the project's standing rule.

---

## Testing

Every new behaviour is a pure function tested in Node without a canvas — the constraint the client's
existing HUD tests already work under, and the reason `weapon-hud.ts` and `status-hud.ts` are shaped
the way they are.

| Function | What is pinned |
|---|---|
| `allegianceOf` | self is ally in both modes; team match in `team`; everyone enemy in `ffa`; a dead viewer's allegiance is unchanged |
| `hpBarColor` | ally green, enemy red, and the two are distinguishable |
| `rosterRows` | ordering is team → `joinedAtTick` → `sessionId`; dead rows present and flagged; capped at `MAX_PLAYERS`; non-`IN_MATCH` excluded |
| `rosterPanelLayout` | rows fit the gutter width; N rows for N players; stable row height |
| `slotBarLayout` | with `topInset`, slots are centred below the inset and never overlap it; with inset 0, identical to today |
| the gutter as a whole | worst case — 6 players, 6 badges, 3 slots — panel, status strip and slot stack do not overlap (D12) |
| `countdownArrowPoints` | triangle is screen-up regardless of car angle; bob is bounded and periodic |
| `beamFadeAlpha` | 1 until the last X ms; ramps down across the window; ends at the death tick; X = 0 gives no fade; X > lifetime is clamped |
| `slotMaskFrom` / `SLOT_KEYS` | table is J/K/L, is at least `maxWeaponSlots` long, and glyphs are what the HUD prints |
| `axisOf` under an OR | arrow-only, WASD-only, both-agreeing, and both-opposing all behave |

`golden.test.ts` must pass unchanged. Nothing here touches the drive integration, and if that fixture
moves, something in this work reached the sim and should not have.

---

## Future work

- **Split the draw-order rule if projectiles hiding behind cars turns out to matter.** D7 ships one
  rule on purpose; the data to split it comes from play, not from reasoning.
- **Per-weapon fade windows.** `BEAM_FADE_OUT_MS` is one constant. If two beams ever want different
  cut speeds, it becomes a table the same way `WEAPON_BEAM_STYLES` did.
- **HP on the roster.** Rejected in D3 for good reasons, but "who is nearly dead" is a real question
  in team play and the panel is where it would go if a second channel is ever wanted.
- **Rebindable keys.** `SLOT_KEYS` is already the seam; nothing about J/K/L makes a settings screen
  harder later.
- **An arrow for teammates.** The countdown arrow marks you. Marking allies during play is a
  different feature with a different cost, and the roster panel may already answer it.

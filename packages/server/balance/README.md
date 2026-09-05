# Balance harness

Headless win-rate and damage measurement for the sim. **Not part of the test suite and not part of
the release build** — `tsup` bundles only `src/index.ts`, and `scripts/build-release.mjs` copies only
the built `dist` folders, so nothing here can reach a player.

Where `packages/server/playtest/` asks "does the sim misbehave" (tunneling, crush, missed hits — bugs
you fix), this asks "is a chassis or a weapon too strong" (win rates, damage share, matchup
percentages — numbers you tune against). Same offline-probe shape, different question. See the root
`CLAUDE.md`'s Playtest section for the sibling harness, and
[`docs/superpowers/specs/2026-09-03-game-balance-harness-design.md`](../../../docs/superpowers/specs/2026-09-03-game-balance-harness-design.md)
for the design this implements.

---

## Before you trust a number

One thing distorts every run today, and two distorted runs before fixes that have since landed. Read
all three before you read a report.

**`wildcharge` was unpressable until 2026-09-04, so reports from before then understate Bastion.**
The bot's fire logic only pressed slot `i` when `distance < slotRanges[i]`, and `WEAPON_TABLE.wildcharge`
has `range: 0` (a charge dashes nowhere, so it was never meant to be range-gated) — a distance is
never negative, so that comparison could never be true. Bastion played every balance run, every
`PracticeRoom` and every dev playground with two thirds of its kit, so no report from before this fix
has usable Bastion numbers. The fix landed twice, same day: first as `triggerRangeOf`, gating a
range-0 weapon on the profile's own standoff band (hard 70u, medium 165u, easy 270u) inside the
legacy chaser bot; then that whole bot, `triggerRangeOf` included, was deleted and replaced by the
tiered human-like brain (below) — see [`docs/bot-behavior.md`](../../../docs/bot-behavior.md). Either
mechanism, `wildcharge`'s numbers were deliberately not touched — the table was always right. **Any
report whose header predates the first fix is not comparable to one after it**, the same way a report
from before a bot retune is not; the bot fingerprint cannot tell you so on its own for the first fix,
because that one was a change to the bot's logic with `BOT_PROFILES` untouched — see `BOT_BRAIN_VERSION`
below, which exists precisely to close that gap for every change since.

What the first fix actually moved, measured on a paired 50-match `casual` run either side of it (seed
1645463066): `wildcharge` went from 0 presses to 1179 (176 kills, 29.7% of Bastion's kit), and
Bastion's damage dealt rose 39% with its damage ratio going 0.4 to 0.6 — **and its win rate stayed at
0.0% (0.0–7.1).** So the unpressable ultimate was a real defect and was never the whole story: a
third of the kit came back and Bastion still won nothing. Whether that was the old fixed-standoff
pilot or Bastion itself was not yet answered when that run was made — the brain rewrite below is a
new pilot entirely, and a fresh comparison is needed to say anything about Bastion under it.

**`BOT_BRAIN_VERSION` 4.0.0 replaces the firing-decision gate above with a real EV solver, and gives
maneuvers a genuine hit-probability solution from the start — there is no "before" to discard.**
`solve()` and `chooseSlot`'s expected-value gate (`minShotValue`) are both new IN 4.0.0; no earlier
`BOT_BRAIN_VERSION` ever reasoned about a press in expected value at all, so there is no prior
EV-gated report for a maneuver-less solver to have contaminated. (A transient version of `solve()`
that returned `{ hits: 0, damage: 0 }` for every maneuver weapon existed only between two commits
during this feature's own development and was never released as a `BOT_BRAIN_VERSION` — it is not
part of this project's history.) `solution.ts`'s `marchManeuver` sweeps the shooter's own hull along
the maneuver's travel line, tick by tick, against the target's predicted hull — the same swept-hull
idea `marchOne` uses for a projectile — so `wildcharge` and `thunderclap` are pressed on a solved hit
chance rather than the plain range comparison the pre-4.0.0 bot used. **Reports from before
`BOT_BRAIN_VERSION` 4.0.0 are not invalid for this reason** — that older bot already pressed
`wildcharge` (1179 times, measured above) via the ordinary distance-gated firing logic; they are only
subject to the general rule that a `BOT_BRAIN_VERSION` bump invalidates comparison across it, the
same as any other behaviour change with `BOT_PROFILES` untouched.

**`corroded` contributes damage without ever dealing any.** Its row is a pure amplifier —
`modifiers: { damageTaken: 1.3 }` — so it does not hit anyone itself; it makes whatever hits the
carrier next land 30% harder, and that harder hit is credited entirely to the weapon that landed it.
`magmablast`'s explosion is `corroded`'s only source in the game
(`packages/shared/src/config/weapon-config.ts`), so `magmablast`'s real contribution to a match
includes damage it never dealt directly — credited instead to whatever other weapon (including
another player's) finished off a corroded target. No per-weapon attribution scheme can untangle this;
a damage table is blind to amplifiers by construction. Do not assume the `Damage` column sums to "the
truth," and do not read `magmablast`'s number as *only* what it hit.

(`overheated`, not `corroded`, is the game's only *damaging* status pulse — 8 damage every 400 ms,
applied only by `afterburner`. An earlier project draft had that backwards; the harness's own
`attribution.ts` carries the correction in its header. Don't reintroduce the swap.)

---

## Step by step: running a balance run

Everything here is offline — no server, no network, no browser — same as the playtest harness.

### 1. Install, once per checkout

```bash
cd <repo root>
npm install
```

In a **fresh git worktree this is not optional.** Without it Node walks up to the main checkout's
`node_modules`, where `@motor-combat-moba/shared` symlinks back to the main checkout — so every run
would silently measure master's sim instead of yours. See the root `CLAUDE.md`.

### 2. Build shared

```bash
npm run build -w @motor-combat-moba/shared
```

The harness imports the server's `src`, which consumes shared's built **`dist`** — exactly as the LAN
server bundle does. **A stale `dist` means you are measuring the previous sim.** If you have just
edited anything under `packages/shared/src`, this step is mandatory.

`npm run balance` from the repo root does this step for you (see `package.json`: it runs the shared
build, then the CLI). Running `tsx balance/run.ts` directly from `packages/server` does not.

### 3. Run

From the **repo root**:

```bash
npm run balance -- --shape=ffa --matches=100
```

Everything after `--` is the CLI's own flags (see the flag table below). With no flags at all it runs
50 six-car FFA matches, `pro` (hard) bots, arena-01, a random seed. The seed prints first, before
anything runs — write it down if the run turns out interesting; it is what lets you replay it
exactly.

A full-length default run can take minutes — `--match-seconds` and `--matches` are the two knobs that
control how long you wait. Progress prints as matches complete.

### 4. Read the report

Each run writes to `packages/server/balance/reports/<yyyy-MM-dd-NN>/`:

```
reports/2026-09-03-01/
  summary.md      <- start here
  matches.csv     <- one row per car per match
  weapons.csv     <- one row per weapon per match
  run.json        <- the aggregated record; also what --baseline reads back
```

`NN` counts up per day, from what is already on disk. **The folder is gitignored** — a report is a
record of one run on one machine, never source, the same rule `playtest/reports/` follows.

`summary.md` opens with the run's config, its git commit, and two fingerprints (below), then a
**Limitations** section stating this harness's own blind spots in prose — read it every time, not
just once, because it is easy to skim past a caveat you've seen before.

---

## The two shapes, and which question each answers

**`--shape=ffa`** (the default) seats a fixed 2/2/2 six-car match — as even a split of the active
three-chassis roster as `MAX_PLAYERS` allows. Equal representation makes the null win rate exactly
33.3% with no need to normalize by how often a chassis appeared. Use this for **overall chassis and
weapon strength**: is a chassis winning more than its fair share across a real melee.

**`--shape=duel`** cycles all nine ordered chassis pairs (three chassis squared, mirrors included) as
1v1s. A six-way FFA cannot answer "does Mirage beat Bastion" — with five other cars shooting, every
pairwise claim is confounded by who else is on the field. Use this for the **matchup matrix**: a
clean attacker-vs-defender read, one pair at a time. `duel` also defaults to `last-standing` mode
(one clean winner) rather than the deathmatch default the other shape uses.

`duel` runs `--matches` matches **per ordered pair**, not `--matches` matches total — nine pairs at
today's three-chassis roster, so `--matches=20 --shape=duel` is 180 matches, not 20.

---

## Every flag

`cli.ts` is the source of truth; this table is generated from reading it, not from a plan document.
An unknown flag, or a value that fails to parse, makes the CLI throw naming the flag rather than
silently ignoring it.

| Flag | Values | Default | Meaning |
|---|---|---|---|
| `--shape` | `ffa` \| `duel` | `ffa` | Which experiment shape (see above). |
| `--matches` | positive integer | `50` | Matches per run (`ffa`) or per ordered pair (`duel`). |
| `--mode` | `deathmatch` \| `last-standing` | `last-standing` for `duel`, `deathmatch` for everything else | Overrides the shape's default win condition. |
| `--skill` | `pro` \| `casual` \| `amateur` | `pro` | Player-type vocabulary; maps to bot difficulty `hard` \| `medium` \| `easy` (`SKILL_TO_DIFFICULTY` in `cli.ts` is the one place that mapping lives). The report prints both forms, e.g. `pro (hard)`. |
| `--seed` | integer | a fresh random seed, printed first | The whole run is a pure function of this seed — same seed, same matches, replayed exactly. |
| `--arena` | a known arena id | `arena-01` | Which arena to run every match on. Only one arena runs per report; arena geometry is itself a balance input this harness does not vary. |
| `--baseline` | a previous run's directory | none | Load that run's `run.json` and print a "Deltas vs baseline" section against it. Refuses to run (exits non-zero, before any match is simulated) if the config or bot fingerprint, the shape, the mode or the skill tier differs — see the paired-run workflow below. |
| `--force` | flag, no value | off | Overrides a refused `--baseline` comparison (B37) — the run proceeds instead of exiting non-zero. Meaningless without `--baseline`. The report's "Deltas vs baseline" section carries a prominent warning banner naming every mismatch, so a forced delta can never later be mistaken for a valid paired run. |
| `--match-seconds` | positive integer | `DEATHMATCH_CONFIG.matchSeconds` (180s) for deathmatch, a 300s (5 min) stalemate safety cap for last-standing | Per-match clock. For deathmatch this doubles as the real `matchEndsTick`, so it is not a mock of the game's clock — it is the game's clock. For last-standing it is a cap, not a target; hitting it is itself a finding (a matchup or bot pairing that cannot resolve). |
| `--out` | a directory path | a fresh dated folder under `reports/` | Write the report somewhere specific instead of the auto-numbered folder. |

---

## The paired-run workflow — the primary way to use this

A single 50- or 100-match run tells you what a chassis's win rate is *this run*. It does not by
itself tell you whether an edit changed anything, because two runs of the same config still differ by
sampling noise. The fix is to hold the sample fixed and vary only the edit:

```bash
# 1. Baseline, before the change.
npm run balance -- --shape=ffa --matches=100 --seed=7 --out=balance/reports/before

# 2. Make your balance edit (a WEAPON_TABLE or CAR_TABLE number), rebuild shared.
npm run build -w @motor-combat-moba/shared

# 3. Same seed, same shape, same everything else — only the config changed.
npm run balance -- --shape=ffa --matches=100 --seed=7 --baseline=balance/reports/before
```

**Both paths are relative to `packages/server`, not to the repo root you type the command from** —
`npm run balance` runs the CLI inside the server workspace, so a repo-root-looking
`packages/server/balance/reports/before` resolves to `packages/server/packages/server/...` and fails
`ENOENT` (harmlessly, before any match runs, but only after you have waited for the shared build).
An absolute path works too.

Same seed on both sides means every match starts from identical conditions — same spawns, same bot
draws — so whatever moved between the two reports was **caused by the edit**, not sampled around it.
That is a real A/B; two runs with different seeds are just two different samples of the same
experiment, which is a weaker claim.

`--baseline=<dir>` reads that directory's `run.json` and adds a "Deltas vs baseline" table to
`summary.md`, and it **refuses to run** — before simulating a single match — if:

- the **config fingerprint** differs (anything the sim or this harness's own match/respawn pipeline
  reads — `WEAPON_TABLE`, `CAR_TABLE`, `COMBAT_CONFIG`, `DRIVE_CONFIG`, `STATUS_TABLE`, `RAM_CONFIG`,
  `SLAM_CONFIG`, `AIM_CONFIG`, `WEAPON_SLOT_CONFIG`, `DEATHMATCH_CONFIG`, `TICK_RATE_HZ`, or any
  registered arena — changed between the two runs, i.e. this genuinely is not the isolated
  one-number edit it needs to be; `fingerprint.ts`'s header comment is the source of truth for the
  exact list), or
- the **bot fingerprint** differs (`BOT_PROFILES` or `BOT_BRAIN_VERSION` changed — the delta could
  be a bot retune or a brain behaviour change, not a balance change), or
- `--shape` or `--mode` differs (a duel win rate and an FFA win rate are not the same quantity), or
- `--skill` differs (a different tier flew the matches). This is checked as its own field rather
  than through the bot fingerprint, which hashes `BOT_PROFILES` WHOLE and so gives every tier the
  same hash — without the separate check, a pro run and a casual run compared as `ok`.

A differing `--seed` is not fatal — it just prints a warning that the comparison is a different
sample, not a clean paired one. Both fingerprints, along with the git commit, print in every report's
header, so an old `summary.md` stays self-describing without anyone having to reopen `run.json`.

**`--force` overrides a refusal** (B37) when you genuinely want the delta anyway — for example,
sanity-checking how much a bot retune alone moved the numbers. The run proceeds, but the report's
"Deltas vs baseline" section leads with a loud warning banner naming exactly which fingerprints
differed, so a forced comparison can never later be mistaken for the clean paired run this workflow
otherwise guarantees.

---

## How to read an interval, and why 38% is not a finding

Every win rate this report prints carries a **Wilson score interval**, inline, in one format:
`41.3% (32.1–50.9)` — never a bare percentage. That bracket is the honest range the true win rate
could plausibly be in, given how many matches actually ran.

At the fixed `ffa` composition (2/2/2, six cars) the **null hypothesis is exactly 33.3%** — a chassis
with no advantage at all wins one match in three by construction. Over 100 matches, that 95% interval
is roughly **±9 points wide**. A chassis reading 38% over 100 matches is sitting comfortably inside
the noise around 33.3%; it is not, on its own, evidence that chassis is strong. Only a gap that
survives — one where the interval itself sits clear of 33.3%, or that holds up across a paired-run
delta larger than either run's own interval width — is worth acting on. Widen the sample
(`--matches`) before concluding a borderline number means anything.

The same logic applies to hit rates, the "hit the clock" pace stat, and every other bracketed figure
in the report — read the interval, not the point estimate.

---

## The mirror noise floor (duel runs only)

`--shape=duel`'s nine ordered pairs include three **mirrors** — a chassis against itself: identical
chassis, identical kit, identical pilot on both sides. There is no game-side reason for a mirror to
land anywhere but **50%**, so `summary.md` prints the mirror table *before* the matchup matrix, and
you should read it first too.

**A mirror reading far from 50% (say, 58%) is not a fact about the game — it is proof of positional
bias in the rig itself**: which spawn seat gets called "attacker," resolution order between the two
seats, or some other asymmetry the harness itself introduces. If a mirror is off, every other cell in
that run's matchup matrix is suspect for the same reason, and the fix is in the harness or the match
setup, not in a weapon or chassis number. Check the mirrors before trusting anything else in a duel
report.

---

## What this harness measures, and what it does not

This is the limitations list `summary.md` itself prints (verbatim, from `report.ts`) — reproduced
here so it is discoverable without having run anything yet:

- **Bot skill is a model of skill, not skill.** Every number in a report compares chassis under one
  fixed, scripted pilot. "Amateurs find Bastion weak" is a claim about our bot, not about amateurs,
  until a human confirms it.
- **The pilot is a tiered human-like bot** (see
  [`docs/superpowers/specs/2026-09-04-human-like-bot-behavior-design.md`](../../../docs/superpowers/specs/2026-09-04-human-like-bot-behavior-design.md)
  and [`docs/bot-behavior.md`](../../../docs/bot-behavior.md)). It perceives with a tier-scaled
  latency and attention limit, chooses a stance, dodges, holds a range derived from its own kit, and
  presses ONE slot per tick. The bot fingerprint covers `BOT_PROFILES` and `BOT_BRAIN_VERSION`, so a
  report from before a bot retune or a brain change is not comparable to one after. Which TIER flew
  the matches is not in that hash — the whole table is hashed, so every tier hashes alike — it is
  recorded in the run config and checked separately. `--baseline` refuses all three mismatches
  rather than trusting a reader to remember.
- **Reports produced before 2026-09-04 measured a different pilot in a way worth naming.** The old
  bot ORed every in-range slot into one fire mask, and `beginFire` takes the lowest usable bit — so
  it pressed slot 0 almost exclusively. Any historical conclusion about a slot-1 or slot-2 weapon
  being weak is suspect for that reason alone.
- **The `easy`/`medium` bot profiles were retuned for a pleasant new-player experience, not faithful
  skill simulation.** The two goals usually agree — a beginner who over-commits is also easy to beat
  — but they can pull apart, and this report cannot tell you which case a given number is in.
- **No network.** No latency, no packet loss, no client-side prediction error. A LAN match has all
  three; this harness has none of them.
- **One arena.** Only the arena named in the report header, unless a future run says otherwise —
  arena geometry is itself a balance input this report does not vary.
- **No lobby, no team play.** `GameMode.TEAM` is out of scope for this harness.
- **Bot targeting drives kill distribution.** Who the bot chooses to shoot is a bot-tuning decision,
  not a chassis property, and it will move every per-car number here again when the bot improves.

Add to that `corroded`'s uncredited amplifier damage under "Before you trust a number" above (and,
for any report predating 2026-09-04, `wildcharge`'s unreachable range) — specific instances of the
same rule: this harness reports what the bot and the sim actually did, not what a human pilot or a
perfect attribution scheme would show.

Every report also carries a **bot fingerprint** (a hash of `BOT_PROFILES` and `BOT_BRAIN_VERSION`,
whole) precisely because every number above is conditioned on which bot tier ran it, and on which
version of the brain's behaviour ran it — a report from before a bot retune, or a brain behaviour
change with no table value moved, is not comparable to one after, and `--baseline` enforces that
mechanically rather than trusting a reader to remember.

---

## Files in this package

`cli.ts` (flag parsing), `run.ts` (the CLI entry point — prints the seed, checks `--baseline`, runs,
writes the report), `runner.ts` (the two shapes and `runAll`), `match.ts` (one match, bots included),
`stats.ts` (`aggregate`, Wilson intervals), `attribution.ts` (crediting pulse damage to the weapon
that caused it), `fingerprint.ts` (the two FNV-1a fingerprints), `baseline.ts` (loading and comparing
a previous run), `report.ts` (`summary.md`, the CSVs, `run.json`).

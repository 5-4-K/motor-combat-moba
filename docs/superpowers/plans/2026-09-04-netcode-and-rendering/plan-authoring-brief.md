# The plan-authoring brief

> **What this is:** the shared instruction set handed to every worker that writes one of the phase
> plans in this folder. It is committed so plan-writing can continue from a fresh session. It is
> **not** an implementation plan — to *execute* the plans, read
> [`00-execution-guide.md`](00-execution-guide.md). To see what is written and what is left, read
> [`PROGRESS.md`](PROGRESS.md), which also carries the per-plan assignment text that goes with this
> brief.
>
> One amendment learned in practice: the 500-1,400 line target below is a guide, not a cap. Every
> plan written so far runs 1,400-3,800 lines, because the No-Placeholders rule wins over the length
> target. Do not elide code to hit a number.

---

You are writing ONE implementation plan for the Motor Combat MOBA repo at /home/user/motor-combat-moba. You write a markdown file and nothing else: do not edit code, do not commit, do not read docs/ideas/ or docs/invariants/.

READ FIRST, in this order:
1. /root/.claude/plugins/cache/superpowers-dev/superpowers/6.3.0/skills/writing-plans/SKILL.md — follow its format exactly: the header block, Global Constraints, File Structure table, tasks with Files / Interfaces / checkbox steps, real code in every code step, tests before implementation, a commit step per task, and the Self-review section at the end. The "No Placeholders" rules are hard rules.
2. /home/user/motor-combat-moba/CLAUDE.md and packages/{shared,server,client}/CLAUDE.md — repo rules (shared dist gotcha, root `npm test`, playtest "say so loudly" rule, never create probes, docs/turn-tuning.md test, manual page fingerprint, no magic numbers in logic).
3. docs/superpowers/plans/2026-09-04-netcode-and-rendering/interfaces.md — THE LEDGER. Every name, signature, config key and file path you produce or consume must match it exactly. You may add exports beyond it; you may not rename or reshape a listed one. If you believe the ledger is wrong, keep to it and note the concern in your final message, not in the plan.
4. docs/superpowers/plans/2026-09-04-netcode-and-rendering/01-prep-arena-scene-split-and-render-frame.md — the preparation plan. Assume it has LANDED: the client has match/render-frame.ts, match/frame-builder.ts, match/arena-net.ts and scenes/arena/{arena-layers,hitbox-toggle,car-renderer,shot-renderer,hud-renderer,match-banners,spectate-camera}.ts with the shapes it defines, and ArenaScene.ts is the composer it describes. Reference those files by the paths and names in that plan, not by today's ArenaScene line numbers.
5. The spec sections named in your assignment below, in full. Netcode spec: docs/superpowers/specs/2026-09-04-online-netcode-and-client-architecture-design.md. Rendering spec: docs/superpowers/specs/2026-09-04-client-rendering-architecture-design.md.
6. The existing source files your plan modifies. Read them and cite current line ranges for anything you move or edit. Earlier phases in the same stream are assumed landed; consume their outputs by the ledger names and never re-specify them.

RULES FOR THE PLAN:
- Header: `**Spec:**` links use the relative path `../../specs/<file>.md#<anchor>`; also link `interfaces.md` and the prior phase's plan in the same folder.
- Global Constraints must include (copy verbatim): rebuild shared before testing (`npm run build -w @motor-combat-moba/shared`); verify with root `npm test`, never a per-workspace run alone; `.js` import specifiers; nothing under `packages/client/src/match/` imports Phaser and no test imports Phaser; do not touch `packages/server/playtest/` except to fix a compile break, and say loudly in the task's commit step which probe numbers your change moves; do not edit `docs/ideas/` or `docs/invariants/`; commit after every task on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch off it).
- Every task that changes a balance table, a drive constant, `TICK_RATE_HZ`, a weapon row, a status row, `COMBAT_CONFIG`, `DRIVE_CONFIG`, `AIM_CONFIG.lockRange` or `ARENA_WIDTH` must include the `npm run build:manual` + commit-the-page step and the `docs/turn-tuning.md` update step where the repo's CLAUDE.md requires them.
- Tests are vitest (client/shared/server) in the node environment; scripts under scripts/ use `node --test` (.test.mjs). Show real test code with real expected values computed from the actual config tables (read them).
- Where a task moves existing code, give the current file:line range and a substitution table (old expression → new expression), as the preparation plan does; do not reprint hundreds of lines.
- Where a task writes new code, print the code. Types and names must match the ledger.
- End every plan with an `## Acceptance` section quoting the phase's acceptance row from the spec's migration table and stating the command(s) that demonstrate each number, and a `## Handoff` section listing every export the plan produces beyond the ledger, so the next plan can consume it.
- Keep the plan between roughly 500 and 1,400 lines. Prefer fewer, complete tasks over many thin ones.
- Do NOT include any model name or AI product name anywhere in the plan.

WHEN DONE: write the file to the exact path in your assignment, then reply with: the path, the task list (one line each), every export beyond the ledger, and any ledger concern. Nothing else.

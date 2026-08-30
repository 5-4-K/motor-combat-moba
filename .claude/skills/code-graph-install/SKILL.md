---
name: code-graph-install
description: Set up the code-review-graph MCP server and build its local code graph on a machine that does not have it yet — installs uv, builds the graph from the committed .mcp.json, and verifies the server actually starts. Use this after cloning the repo on a new machine or in a fresh git worktree, and whenever the graph tools are missing, `uvx` or `code-review-graph` is "not recognized", the MCP server fails to launch, or an impact/blast-radius query returns stale or empty results.
---

# Install the code graph on this machine

Get `code-review-graph` working here: `uv` present, the graph built for **this** checkout, and the
MCP server verified to start. Reference doc is [`docs/code-review-graph.md`](../../../docs/code-review-graph.md).

Everything below is per-machine and per-checkout setup. Nothing here edits committed configuration
— `.mcp.json` and `.code-review-graphignore` are already in the repo and are the same for everyone.
If you find yourself wanting to change either, you are doing something other than onboarding.

## The thing to say up front

**You cannot make the MCP tools appear in the session you are running in.** Claude Code loads MCP
servers at startup. Everything this skill does is real work — installing `uv`, building the graph,
proving the server starts — but the 30 graph tools only become available after a restart. Say so
plainly at the end rather than implying the tools are live. Do not claim success by listing tools
you cannot actually call.

## 1. Find out what is actually missing

Do not install blindly; most of the time only one piece is absent.

```bash
uv --version
uvx --version
code-review-graph status
```

| What you see | What it means |
|---|---|
| All three succeed | Nothing to install. The graph exists — check the commit `status` prints and skip to step 3. |
| `uv`/`uvx` not found | Step 2. This is the usual case on a new machine. |
| `uv` fine, `code-review-graph` not found | Expected and harmless — the MCP server runs through `uvx`, which needs no install. Only step 4 (optional CLI) applies. |
| `uv` fine, `status` says `No graph found at …/.code-review-graph/graph.db` | Step 3. Usual case in a fresh worktree. Check the path it prints resolves to *this* checkout — that also confirms auto-detection is working. |

## 2. Install `uv` if it is missing

```bash
winget install --id astral-sh.uv --exact --scope user
```

`brew install uv` on macOS. `--scope user` avoids needing elevation, which matters because a
prompt for admin rights will hang a non-interactive shell rather than fail.

**`uv` modifies `PATH`, and the current process will not see it.** Do not conclude the install
failed when `uvx --version` still errors immediately afterwards — that is expected. Verify against
the installed binary directly instead of `PATH`:

- Windows: `~/AppData/Local/Microsoft/WinGet/Packages/astral-sh.uv_*/uvx.exe --version`
- macOS/Linux: `~/.local/bin/uvx --version`

Use that absolute path for the rest of this skill's commands, and let the restart at the end sort
out `PATH`.

## 3. Build the graph for this checkout

From the repo root:

```bash
uvx code-review-graph@2.3.8 build
```

Keep the version pinned to whatever `.mcp.json` pins — read it from the file rather than typing
`2.3.8` from memory here, because this document will go stale before `.mcp.json` does. A mismatched
CLI and server parser is exactly the kind of drift the pin exists to prevent.

Expect roughly 10 seconds and a final line resembling
`Full build: 176 files, 1675 nodes, 14870 edges`.

**Every worktree needs its own build.** The tool auto-detects the repository root by walking up from
the working directory, so a worktree resolves to itself and starts with no graph of its own. Run the
build from inside the worktree. Never "fix" an empty worktree graph by pointing `--repo` at the main
checkout — that makes every query silently report on the wrong tree.

If the build tries to parse `node_modules`, `.code-review-graphignore` is missing or you are not at
the repo root. Check before waiting on it.

## 4. Optional: the CLI on `PATH`

Only if they want `code-review-graph` in a terminal outside Claude Code:

```bash
uv tool install code-review-graph==2.3.8
uv tool update-shell
```

Skip this by default. The MCP server does not need it, and it is a second copy of the package to
keep in sync with the pin.

## 5. Verify before you claim anything

Two checks, both cheap:

```bash
code-review-graph status
code-review-graph impact --file packages/shared/src/sim/step.ts
```

`status` should print node and edge counts plus the branch and commit it was built from — confirm
that commit is the one currently checked out. `impact` on the sim step is the honest end-to-end
test: it exercises the parser, the edge resolution and the query path in one go, and on a healthy
graph it reports `stepSim` reaching `simTick` and a blast radius spanning roughly a dozen files. A
graph that builds but returns an empty or single-node radius is broken in a way `status` will not
tell you.

To prove the MCP server itself starts — worth doing when the complaint was that it failed to
launch — run it and confirm it does not exit immediately:

```bash
uvx code-review-graph@2.3.8 serve --help
```

A full stdio handshake is better evidence but needs a client; `serve --help` at least proves the
entry point resolves under `uvx`.

## 6. Hand off

Report, in this order:

- what was installed (or that nothing needed to be),
- the graph's size and the commit it was built from,
- the result of the `impact` check,
- and **restart Claude Code** — a genuinely new process, not a reload, so it picks up both the new
  `PATH` and the MCP server. Approve the project-scoped server when prompted.

## When it still does not work

| Symptom | Cause |
|---|---|
| Server fails to launch, `uvx` not recognised | Claude Code was started before `uv` was installed and inherited the old `PATH`. Restart it from a new shell. |
| Tools missing after restart | The project-scoped server prompt was declined, or the restart was a reload. Check `.mcp.json` parses as JSON. |
| Queries name deleted functions | Stale graph. `code-review-graph update`. `--auto-watch` only runs while the server is up, so changes made with Claude Code closed are not picked up. |
| Empty results in a worktree | That worktree has no graph. Build from inside it. |
| Graph built but impact radius is tiny | Build hit a parse failure, or `.code-review-graphignore` is excluding real source. Re-run `build` and read the parsed-file count. |
| Wants the graph committed so nobody rebuilds | No. It is machine-specific local state, gitignored on purpose, and cheap to rebuild. See the table in `docs/code-review-graph.md`. |

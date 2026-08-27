# Code graph (code-review-graph)

[code-review-graph](https://github.com/tirth8205/code-review-graph) parses the repo with Tree-sitter
into a local SQLite graph of files, functions, classes, imports and calls, and exposes it to Claude
Code over MCP. The point is blast radius: asking "what does changing `stepSim` touch?" and getting
the 11 files that actually matter instead of a whole-repo read.

Nothing leaves the machine. The graph is built and queried locally, and cloud embeddings stay off
unless explicitly opted into with `--embedding-provider`.

## Onboarding a new machine

Three steps, no repo-specific bootstrap.

1. **Install `uv`** — the only prerequisite.

   ```bash
   winget install --id astral-sh.uv --exact --scope user
   ```

   `brew install uv` on macOS; see [astral.sh/uv](https://docs.astral.sh/uv/) for other platforms.
   Restart the shell afterwards so `uvx` lands on `PATH`.

2. **Build the graph once**, from the repo root:

   ```bash
   uvx code-review-graph@2.3.8 build
   ```

   ~10s for this repo (176 files, ~1.7k nodes, ~14.9k edges).

3. **Start Claude Code** in the repo and approve the project-scoped MCP server when prompted.

The server itself needs no install step — `.mcp.json` runs it through `uvx`, which fetches the
pinned version into uv's own cache on first launch.

Optionally, for the CLI outside Claude Code:

```bash
uv tool install code-review-graph==2.3.8
```

That puts `code-review-graph` on `PATH` via `~/.local/bin` (run `uv tool update-shell` once if it
isn't there). Handy for `detect-changes` and `impact` from a terminal.

## What is committed, and what is not

| Path | In git | Why |
|---|---|---|
| `.mcp.json` | yes | Project scope is the shared scope. Holds no machine-specific paths — see below. |
| `.code-review-graphignore` | yes | Controls what gets indexed; must be identical for everyone. |
| `.code-review-graph/` | no | Local SQLite graph. Machine-specific, rebuilt in ~10s, gitignored. |

`.mcp.json` invokes `uvx` off `PATH` rather than an absolute interpreter path, which is what makes
it safe to commit. Claude Code also supports `${VAR}` and `${VAR:-default}` expansion in `command`,
`args` and `env` if a future server ever does need a per-machine value — reach for that rather than
hardcoding a path and gitignoring the file.

## Version pinning

`.mcp.json` and the `uv tool install` line both pin `2.3.8`. The pin is what keeps everyone's graph
built by the same parser; bump both together when upgrading, and rebuild:

```bash
uvx code-review-graph@<new> build
```

Graph schema migrations run automatically on first use of a newer version. Because the database is
local and gitignored, a stale graph on one machine never contaminates another.

## Keeping the graph fresh

`.mcp.json` passes `--auto-watch`, so the server updates the graph as files change while Claude Code
is running. Outside that, or after a large rebase:

```bash
code-review-graph update          # incremental, changed files only
code-review-graph build           # full re-parse
code-review-graph status          # node/edge counts, branch and commit it was built from
code-review-graph detect-changes --brief   # read-only impact of the current diff
```

`status` prints the commit the graph was built from — the quickest way to tell whether what you are
reading is current.

## Gotchas

**Worktrees.** This repo uses `git worktree` (`.claude/worktrees/`). `.mcp.json` deliberately does
**not** pass `--repo`: the tool auto-detects the repository root by walking up from the working
directory, so each worktree resolves to itself and gets its own graph. Hardcoding `--repo` would
point every worktree at the main checkout and silently report on the wrong tree — the same failure
shape as the stale-`dist` trap in `CLAUDE.md`, where everything looks fine while the answer comes
from the wrong source. Each worktree needs its own one-off `build`.

**A stale graph reads like a confident wrong answer.** It reports on the code as of its last update,
with no hint that it is behind. If an impact query names a function you just deleted, run `update`
before believing anything else it says.

**`languages.toml`.** If custom language support is ever needed, it lives at
`.code-review-graph/languages.toml` — inside the gitignored directory. Sharing it means a negation
rule (`!.code-review-graph/languages.toml`). Not needed today: TypeScript and JavaScript are both
natively supported, and that is all this repo contains.

**The graph indexes `src`, not `dist`.** That is what you want for review, but it means the graph
cannot see the stale-`dist` problem described in `CLAUDE.md`. A graph query saying two functions are
connected says nothing about whether the built bundle agrees.

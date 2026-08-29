#!/usr/bin/env bash
# SessionStart hook: keep the code-review-graph in step with this checkout.
#
# --auto-watch in .mcp.json only covers edits made while a session is running.
# This covers everything else: a fresh worktree with no graph at all, a branch
# switch, a pull or rebase, and edits made with no session open. `update` is
# incremental (changed files only, diffed from the commit the graph was built
# at), so the common case costs about a second.
#
# No --repo is passed anywhere: the tool walks up from the working directory,
# so a worktree refreshes itself and never the main checkout.
#
# stdout lands in the session's context, so `status` puts the built commit in
# front of Claude at the top of every session.
set -u

CRG="uvx --quiet code-review-graph@2.3.8"

if [ -f .code-review-graph/graph.db ]; then
  $CRG update -q || echo "code-review-graph: update failed; graph may be stale"
else
  echo "code-review-graph: no graph in this checkout, building one (~30s)"
  $CRG build -q || echo "code-review-graph: build failed; graph queries will return not_found"
fi

$CRG status || true

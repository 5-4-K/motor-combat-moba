/**
 * `?debug=1` turns on developer overlays — currently the car OBB outline in the arena. Off by any
 * other value, including a bare `?debug`, so the flag has to be asked for deliberately.
 */
export function isDebugEnabled(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get("debug") === "1";
}

export function detectServerEndpoint(
  loc: Pick<Location, "protocol" | "hostname" | "port"> = window.location,
): string {
  if (loc.port === "5173") return "ws://localhost:2567";
  const ws = loc.protocol === "https:" ? "wss" : "ws";
  return `${ws}://${loc.hostname}${loc.port ? `:${loc.port}` : ""}`;
}

/**
 * The dev tool requested by `?dev=<id>`, or `undefined` for ordinary play.
 *
 * One namespaced selector rather than a flag per tool: `?preview=1&balance=1` would need precedence
 * rules, `?dev=` cannot be ambiguous. Deliberately does *not* check whether the id names a real
 * tool — that is the registry's job, and keeping parsing separate from lookup keeps this testable
 * without importing the registry.
 *
 * The id alone is not enough: `BootScene` gates on `import.meta.env.DEV`, so in a release build no
 * value here can reach a tool, because no tool is in the bundle.
 */
export function devToolId(search: string = window.location.search): string | undefined {
  return new URLSearchParams(search).get("dev") || undefined;
}

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

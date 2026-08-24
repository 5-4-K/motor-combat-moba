export function detectServerEndpoint(
  loc: Pick<Location, "protocol" | "hostname" | "port"> = window.location,
): string {
  if (loc.port === "5173") return "ws://localhost:2567";
  const ws = loc.protocol === "https:" ? "wss" : "ws";
  return `${ws}://${loc.hostname}${loc.port ? `:${loc.port}` : ""}`;
}

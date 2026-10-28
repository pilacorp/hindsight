// /api routes reachable without a token. Page routes are not decided here.
const PUBLIC_API = ["/api/version", "/api/health", "/api/usage"];

export function isPublicApiPath(appPath: string): boolean {
  return PUBLIC_API.some((path) => appPath === path || appPath.startsWith(`${path}/`));
}

/** How middleware treats a path before any session lookup. */
export function apiAuthDecision(
  appPath: string,
  authorization: string | null
): "allow" | "unauthorized" | "page" {
  if (!appPath.startsWith("/api/")) return "page";
  if (isPublicApiPath(appPath) || authorization) return "allow";
  return "unauthorized";
}

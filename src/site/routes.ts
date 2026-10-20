export type RouteId = "table" | "daily";

export interface Route {
  id: RouteId;
  path: string;
  label: string;
  title: string;
}

export const ROUTES: readonly Route[] = [
  { id: "table", path: "/", label: "Table", title: "PokerFlipper" },
  { id: "daily", path: "/daily", label: "Daily", title: "PokerFlipper Daily" },
];

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed.toLowerCase();
}

/** Unknown paths fall back to the table so old links keep working. */
export function routeForPath(pathname: string): Route {
  const path = normalizePath(pathname);
  return ROUTES.find((r) => r.path === path) ?? ROUTES[0];
}

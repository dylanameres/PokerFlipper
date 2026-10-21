export type RouteId = "table" | "daily";

export interface Route {
  id: RouteId;
  path: string;
  label: string;
  title: string;
  description: string;
}

export const SITE_URL = "https://poker-flipper.vercel.app";

export const ROUTES: readonly Route[] = [
  {
    id: "table",
    path: "/",
    label: "Table",
    title: "PokerFlipper – Free Texas Hold'em & Omaha Table Simulator",
    description:
      "Deal Texas Hold'em and Omaha hands solo, or play online with friends using a room code. Free, no signup, runs in your browser.",
  },
  {
    id: "daily",
    path: "/daily",
    label: "Daily",
    title: "PokerFlipper Daily – A New Poker Puzzle Every Day",
    description:
      "A free daily poker puzzle. Everyone gets the same deal: solve it, keep your streak alive, and share your result with friends.",
  },
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

export function canonicalUrl(route: Route): string {
  return SITE_URL + route.path;
}

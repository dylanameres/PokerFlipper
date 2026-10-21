import { renderSiteHeader } from "./site/header";
import { canonicalUrl, routeForPath, type Route } from "./site/routes";

// index.html serves every path, so its static tags describe the table page;
// Google indexes the rendered DOM, so swap them to match the current route.
function applyRouteMeta(route: Route) {
  document.title = route.title;
  const url = canonicalUrl(route);
  const set = (selector: string, attr: string, value: string) =>
    document.querySelector(selector)?.setAttribute(attr, value);
  set('meta[name="description"]', "content", route.description);
  set('link[rel="canonical"]', "href", url);
  set('meta[property="og:url"]', "content", url);
  set('meta[property="og:title"]', "content", route.title);
  set('meta[property="og:description"]', "content", route.description);
}

const route = routeForPath(window.location.pathname);
applyRouteMeta(route);
document.documentElement.dataset.route = route.id;
document.getElementById("site-header")!.innerHTML = renderSiteHeader(route);

// Each page mounts into #app on import; full-page navigation between them
// keeps the table's socket and module state from leaking into other pages.
if (route.id === "daily") {
  void import("./daily/main");
} else {
  void import("./main");
}

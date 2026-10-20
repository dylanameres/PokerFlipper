import { renderSiteHeader } from "./site/header";
import { routeForPath } from "./site/routes";

const route = routeForPath(window.location.pathname);
document.title = route.title;
document.documentElement.dataset.route = route.id;
document.getElementById("site-header")!.innerHTML = renderSiteHeader(route);

// Each page mounts into #app on import; full-page navigation between them
// keeps the table's socket and module state from leaking into other pages.
if (route.id === "daily") {
  void import("./daily/main");
} else {
  void import("./main");
}

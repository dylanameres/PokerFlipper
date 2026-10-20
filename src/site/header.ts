import { ROUTES, type Route } from "./routes";

export function renderSiteHeader(active: Route): string {
  const links = ROUTES.map((route) => {
    const current = route.id === active.id;
    return `<a class="site-nav__link${current ? " site-nav__link--active" : ""}" href="${route.path}"${
      current ? ' aria-current="page"' : ""
    }>${route.label}</a>`;
  }).join("");

  return `
    <div class="site-header__inner">
      <a class="site-header__brand" href="/">
        <span class="site-header__mark" aria-hidden="true">♠</span>
        PokerFlipper
      </a>
      <nav class="site-nav" aria-label="Main">${links}</nav>
    </div>
  `;
}

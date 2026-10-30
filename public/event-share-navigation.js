// The server emits one trusted canonical relative destination for every UA.
// A normal link stays usable if JS is disabled, blocked, or navigation fails.
(() => {
  const link = document.querySelector("a[data-event-destination]");
  if (!(link instanceof HTMLAnchorElement)) return;
  const destination = new URL(link.href, location.origin);
  if (destination.origin !== location.origin || destination.search || destination.hash
    || !/^\/(ja|ko|en)\/events\/[1-9]\d*(?:\/[a-z0-9-]+)?$/.test(destination.pathname)
    || destination.pathname === location.pathname) return;
  location.replace(destination.pathname);
})();

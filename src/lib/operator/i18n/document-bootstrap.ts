import { OPERATOR_LOCALE_COOKIE } from "./resources";

/**
 * Runs while the initial document is being parsed, before React hydrates.
 * Chromium captures the root language early when deciding whether to offer
 * page translation, so changing it only in a client effect can miss that
 * detection window.
 */
export const OPERATOR_DOCUMENT_LANGUAGE_BOOTSTRAP = `(() => {
  try {
    const path = window.location.pathname;
    const isOperatorSurface = path === "/login" || path === "/operator" || path.startsWith("/operator/");
    if (!isOperatorSurface) return;

    const html = document.documentElement;
    html.setAttribute("translate", "yes");

    const cookiePrefix = "${OPERATOR_LOCALE_COOKIE}=";
    const localeCookie = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(cookiePrefix));
    if (!localeCookie) return;

    const locale = decodeURIComponent(localeCookie.slice(cookiePrefix.length));
    const isPashto = locale === "ps-AF";
    html.lang = isPashto ? "ps-AF" : "en";
    html.dir = isPashto ? "rtl" : "ltr";
  } catch {
    // A malformed client cookie must never prevent the application shell from loading.
  }
})();`;

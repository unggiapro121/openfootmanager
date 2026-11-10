/*
 * Runs in the head before the app's CSS paints (phase 5 M2b-9). The body is gray-100 until
 * `<html>` has `dark`, which ThemeProvider adds only after React's first render, so a phone showed
 * a light frame between the navy splash and the first screen. This decides as `getInitialTheme`
 * (src/context/ThemeContext.tsx) does: dark unless the coach chose light. A classic ES5 script in
 * its own file: the CSP allows no inline script, and an old WebView must parse it.
 */
// biome-ignore lint/complexity/useArrowFunction: ES5 on purpose, an old WebView must parse this file
(function () {
  var theme = null;
  try {
    theme = window.localStorage.getItem("ofm-theme");
  } catch (_blocked) {
    // Storage the WebView will not open: the default theme, dark.
  }
  if (theme !== "light") document.documentElement.classList.add("dark");
})();

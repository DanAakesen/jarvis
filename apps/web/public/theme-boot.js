// Runs before the first paint (a blocking script in <head>), so Jarvis opens in the right theme instead of
// flashing light first. It uses the theme Dan last saw on this device, or the OS theme when none is remembered;
// ThemePreferenceProvider then applies the saved settings once they load.
/* global window, document */
(function () {
  var saved = null;
  try {
    saved = window.localStorage.getItem('jarvis.lastTheme');
  } catch {
    // Storage can be blocked; fall back to the OS theme.
  }
  var theme = saved === 'light' || saved === 'dark'
    ? saved
    : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
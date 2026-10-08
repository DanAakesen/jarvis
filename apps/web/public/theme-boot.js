// Runs before the first paint (a blocking script in <head>), so Jarvis opens in the right theme instead of
// flashing light first. It uses the theme Dan last saw on this device, or the OS theme when none is remembered;
// ThemePreferenceProvider then applies the saved settings once they load.
(function () {
  var theme = null;
  try { theme = localStorage.getItem('jarvis.lastTheme'); } catch (error) { theme = null; }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();

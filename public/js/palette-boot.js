/* Runs render-blocking in <head> (classic script, not a module) so the saved
   palette is applied before first paint and nothing flashes. The interactive
   toggle lives in theme.js. Kept as an external file because the Content
   Security Policy (script-src 'self') blocks inline scripts. */
(function () {
  try {
    var p = localStorage.getItem('outfitler:palette');
    document.documentElement.dataset.palette = (p === 'bold' || p === 'muted') ? p : 'muted';
  } catch (e) {
    document.documentElement.dataset.palette = 'muted';
  }
})();

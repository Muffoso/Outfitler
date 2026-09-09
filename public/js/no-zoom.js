/* Keeps the page itself from zooming on touch devices. The viewport meta
   handles browsers that honour user-scalable=no; iOS Safari ignores it, so
   we also cancel the pinch-gesture events. touch-action: manipulation drops
   double-tap-to-zoom without swallowing taps. To see a garment larger the
   user opens it — the grid never zooms. External file because the Content
   Security Policy (script-src 'self') blocks inline scripts. */
(function () {
  document.documentElement.style.touchAction = 'manipulation';

  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (evt) {
    document.addEventListener(evt, function (e) { e.preventDefault(); }, { passive: false });
  });
})();

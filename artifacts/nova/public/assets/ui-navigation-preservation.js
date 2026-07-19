(function () {
  'use strict';
  [
    '/assets/mobile-chat-navigation.js',
    '/assets/continuous-voice-input.js',
    '/assets/durable-run-reconcile.js'
  ].forEach(function (src) {
    if (document.querySelector('script[src^="' + src + '"]')) return;
    var script = document.createElement('script');
    script.src = src;
    script.defer = true;
    document.head.appendChild(script);
  });
})();

/* NOVA app bundle — superseded by the inline scripts in index.html.
   Previously this file held a bundled build of the inline scripts plus
   the marked.min.js library. The bundle is now stale: the inline scripts
   in index.html have evolved (new tabs, new panels, the picture grid)
   while bob.js was never rebuilt, so loading it after the inline scripts
   would overwrite the latest UI handlers with old code.

   This stub exists to:
     1. Keep the <script src="/assets/bob.js"></script> tag in index.html
        working (no 404, no console error).
     2. Expose the few globals that other scripts (e.g. the inline ones in
        index.html) might still expect.
     3. Do nothing else — the inline scripts in index.html are the single
        source of truth for the Nova UI.

   When you add a new feature to index.html, the inline scripts pick it up
   automatically. There is no build step. To add the marked markdown
   parser back, see assets/marked.min.js. */
(function () {
  'use strict';
  if (window.__novaBobStubInstalled) return;
  window.__novaBobStubInstalled = true;
  // Provide a no-op marked stub so any code that calls window.marked.parse()
  // doesn't throw. Real markdown rendering isn't currently used by the
  // inline scripts; this is just defensive.
  if (typeof window.marked !== 'function' && typeof window.marked !== 'object') {
    window.marked = { parse: function (s) { return String(s || ''); } };
  }
})();

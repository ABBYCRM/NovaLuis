(function () {
  'use strict';

  function closeMobileSidebar() {
    if (window.matchMedia && !window.matchMedia('(max-width: 1024px)').matches) return;
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
    document.body.style.overflow = '';
    var input = document.getElementById('user-input');
    if (input) window.setTimeout(function () { input.focus(); }, 0);
  }

  function returnToChat() {
    window.setTimeout(closeMobileSidebar, 75);
  }

  var newChat = document.querySelector('#new-chat-btn');
  if (newChat) newChat.addEventListener('click', returnToChat);

  var history = document.getElementById('history-list');
  if (history) {
    history.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('.history-item') && !target.closest('.hi-del')) returnToChat();
    });

    function exposeDeleteControls() {
      history.querySelectorAll('.hi-del').forEach(function (control) {
        control.setAttribute('tabindex', '0');
        control.setAttribute('role', 'button');
        control.setAttribute('aria-label', 'Delete chat');
      });
    }

    exposeDeleteControls();
    new MutationObserver(exposeDeleteControls).observe(history, { childList: true, subtree: true });
  }

  var currentScript = document.currentScript;
  var versionQuery = '';
  if (currentScript && currentScript.src) {
    try { versionQuery = new URL(currentScript.src).search; } catch (_) {}
  }

  function scriptAlreadyLoaded(pathname) {
    return Array.prototype.some.call(document.scripts, function (script) {
      try { return new URL(script.src, window.location.href).pathname === pathname; }
      catch (_) { return false; }
    });
  }

  [
    '/assets/operator-session-auth.js',
    '/assets/continuous-voice-input.js',
    '/assets/durable-run-reconcile.js'
  ].forEach(function (src) {
    if (scriptAlreadyLoaded(src)) return;
    var script = document.createElement('script');
    script.src = src + versionQuery;
    script.defer = true;
    document.head.appendChild(script);
  });
})();

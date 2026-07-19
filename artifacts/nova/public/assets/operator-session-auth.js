(function () {
  'use strict';

  if (window.__novaOperatorSessionAuthInstalled) return;
  window.__novaOperatorSessionAuthInstalled = true;

  var protectedPath = /^\/api\/(?:workspaces(?:\/|$)|media(?:\/|$))/;
  var baseFetch = window.fetch.bind(window);
  var unlockPromise = null;

  function pathFor(input) {
    try {
      var raw = typeof input === 'string' ? input : (input && input.url) || '';
      return new URL(raw, window.location.href).pathname;
    } catch (_) {
      return '';
    }
  }

  function withCredentials(init) {
    return Object.assign({}, init || {}, { credentials: 'same-origin' });
  }

  function cloneForRetry(input) {
    try {
      return input instanceof Request ? input.clone() : input;
    } catch (_) {
      return input;
    }
  }

  async function unlockOperatorSession() {
    if (unlockPromise) return unlockPromise;
    unlockPromise = (async function () {
      var pin = window.prompt('Enter your NovaLuis operator PIN to unlock Workspaces and Pictures.');
      if (pin == null || !String(pin).trim()) return false;

      var response = await baseFetch('/api/operator/unlock', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: String(pin).trim() })
      });

      if (!response.ok) {
        var message = 'Workspace unlock failed (HTTP ' + response.status + ').';
        try {
          var payload = await response.json();
          if (payload && payload.error) message = String(payload.error);
        } catch (_) {}
        window.alert(message);
        return false;
      }
      return true;
    })().finally(function () {
      unlockPromise = null;
    });
    return unlockPromise;
  }

  window.fetch = async function (input, init) {
    var pathname = pathFor(input);
    var protectedRequest = protectedPath.test(pathname);
    var retryInput = protectedRequest ? cloneForRetry(input) : input;
    var first = await baseFetch(input, protectedRequest ? withCredentials(init) : init);
    if (!protectedRequest || first.status !== 401) return first;

    var unlocked = await unlockOperatorSession();
    if (!unlocked) return first;
    return baseFetch(retryInput, withCredentials(init));
  };

  // The handwritten workspace panel calls this helper directly. Route it through
  // the auth-aware fetch wrapper so GET, upload, edit, and delete all share the
  // same 401 -> PIN -> signed-cookie -> retry behavior.
  window.smFetch2 = function (path, options) {
    return window.fetch(path, options);
  };
})();

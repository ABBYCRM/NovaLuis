(function () {
  'use strict';

  if (window.__novaOperatorSessionAuthInstalled) return;
  window.__novaOperatorSessionAuthInstalled = true;

  var protectedPath = /^\/api\/(?:workspaces(?:\/|$)|media(?:\/|$))/;
  var protectedImagePath = /^\/api\/workspaces\/[^/]+\/files\/[^/]+\/raw(?:\?|$)/;
  var baseFetch = window.fetch.bind(window);
  var unlockPromise = null;
  var legacyObserver = null;

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

  function removeLegacyBrowserToken() {
    try {
      var raw = localStorage.getItem('bob-settings');
      if (!raw) return;
      var settings = JSON.parse(raw);
      if (!settings || typeof settings !== 'object' || !Object.prototype.hasOwnProperty.call(settings, 'novaApiToken')) return;
      delete settings.novaApiToken;
      localStorage.setItem('bob-settings', JSON.stringify(settings));
    } catch (_) {}
  }

  function replaceLegacyWorkspaceTokenCopy(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll('div,span,p,label,small,strong,button');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var text = String(el.textContent || '').trim();
      if (!text) continue;
      if (/NovaLuis Workspace Token not set/i.test(text)) {
        el.textContent = 'Workspace authentication required';
      } else if (/separate credential from your OpenAI, Anthropic/i.test(text)) {
        el.textContent = 'Use your NovaLuis operator PIN. The browser receives a signed HttpOnly session; no API master token is stored locally.';
      } else if (/Set the NovaLuis Workspace Token in Settings/i.test(text)) {
        el.textContent = 'Unlock with your NovaLuis operator PIN to view this image.';
      }
    }

    var inputs = scope.querySelectorAll('input');
    for (var j = 0; j < inputs.length; j++) {
      var input = inputs[j];
      var marker = [input.id, input.name, input.placeholder, input.getAttribute('aria-label')]
        .filter(Boolean)
        .join(' ');
      if (!/nova.*(?:api|workspace).*token/i.test(marker)) continue;
      var container = input.closest('label,.setting-row,.settings-row,.form-row,.field-row') || input.parentElement;
      if (container) container.style.display = 'none';
      input.value = '';
    }
  }

  function reloadProtectedImage(img) {
    if (!img || img.dataset.novaSessionRetry === '1') return;
    var pathname = pathFor(img.src || img.getAttribute('src'));
    if (!protectedImagePath.test(pathname)) return;
    img.dataset.novaSessionRetry = '1';
    unlockOperatorSession().then(function (unlocked) {
      if (!unlocked) return;
      try {
        var url = new URL(img.src, window.location.href);
        url.searchParams.delete('token');
        url.searchParams.set('_novaSession', String(Date.now()));
        img.src = url.toString();
      } catch (_) {
        img.src = img.src;
      }
    });
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

  window.novaUnlockWorkspace = unlockOperatorSession;

  window.smFetch2 = function (path, options) {
    return window.fetch(path, options);
  };

  document.addEventListener('error', function (event) {
    var target = event.target;
    if (target && target.tagName === 'IMG') reloadProtectedImage(target);
  }, true);

  function bootLegacyCleanup() {
    removeLegacyBrowserToken();
    replaceLegacyWorkspaceTokenCopy(document);
    legacyObserver = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes || [];
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) replaceLegacyWorkspaceTokenCopy(added[j]);
        }
      }
    });
    legacyObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLegacyCleanup, { once: true });
  } else {
    bootLegacyCleanup();
  }
})();

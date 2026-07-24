(function () {
  'use strict';

  if (window.__novaOperatorSessionAuthInstalled) return;
  window.__novaOperatorSessionAuthInstalled = true;

  var protectedPath = /^\/api\/(?:workspaces(?:\/|$)|media(?:\/|$))/;
  var protectedImagePath = /^\/api\/workspaces\/[^/]+\/files\/[^/]+\/raw(?:\?|$)/;
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

  function rewriteLegacyText(root) {
    var scope = root && root.nodeType ? root : document.body;
    if (!scope) return;
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var original = String(node.nodeValue || '');
      var updated = original
        .replace(/NovaLuis Workspace Token not set/gi, 'Workspace authentication required')
        .replace(
          /This is a separate credential from your OpenAI, Anthropic, or other LLM key\. It gates calls to \/api\/workspaces\/\* and \/api\/media\/\* only\. Set NOVA_API_TOKEN on the nova-luis api-server, then paste the same value here so the browser can authenticate the request\. The value never leaves your browser; the server only checks it on each request\./gi,
          'Use your NovaLuis operator PIN. The browser receives a signed HttpOnly session; no API master token is stored locally.'
        )
        .replace(/Set the NovaLuis Workspace Token in Settings to view this image\./gi, 'Unlock with your NovaLuis operator PIN to view this image.');
      if (updated !== original) node.nodeValue = updated;
    }
  }

  function hideLegacyTokenInputs(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var inputs = scope.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var marker = [input.id, input.name, input.placeholder, input.getAttribute('aria-label')]
        .filter(Boolean)
        .join(' ');
      if (!/nova.*(?:api|workspace).*token/i.test(marker)) continue;
      var container = input.closest('label,.setting-row,.settings-row,.form-row,.field-row') || input.parentElement;
      if (container) container.style.display = 'none';
      input.value = '';
    }
  }

  function cleanLegacyUi(root) {
    rewriteLegacyText(root);
    hideLegacyTokenInputs(root);
  }

  function reloadProtectedImage(img) {
    if (!img || img.dataset.novaSessionRetry === '1') return;
    var pathname = pathFor(img.src || img.getAttribute('src'));
    if (!protectedImagePath.test(pathname)) return;
    img.dataset.novaSessionRetry = '1';
    unlockOperatorSession().then(function (unlocked) {
      if (!unlocked || !img.isConnected) return;
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
    if (!target || target.tagName !== 'IMG') return;
    if (!protectedImagePath.test(pathFor(target.src || target.getAttribute('src')))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    reloadProtectedImage(target);
  }, true);

  function bootLegacyCleanup() {
    removeLegacyBrowserToken();
    cleanLegacyUi(document);
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes || [];
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) cleanLegacyUi(added[j]);
          if (added[j].nodeType === 3 && added[j].parentNode) rewriteLegacyText(added[j].parentNode);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLegacyCleanup, { once: true });
  } else {
    bootLegacyCleanup();
  }
})();

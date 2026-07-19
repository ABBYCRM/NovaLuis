(function () {
  'use strict';

  var markerPattern = /\[NOVA_RUN_ID:(\d+)\]/;
  var timers = Object.create(null);
  var chatsKey = 'bob-chats';

  function loadChats() {
    try {
      var value = JSON.parse(localStorage.getItem(chatsKey) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function saveChats(chats) {
    try { localStorage.setItem(chatsKey, JSON.stringify(chats)); } catch (_) {}
  }

  function cleanReport(report) {
    return String(report || '').replace(/^<!--sn-category:[^>]+-->\s*/i, '').trim();
  }

  function buildThinkingIndicator(runId) {
    var indicator = document.createElement('div');
    indicator.className = 'thinking-indicator durable-thinking-indicator';
    indicator.setAttribute('data-nova-run-id', String(runId));

    var cube = document.createElement('div');
    cube.className = 'cube3d';
    var cubeContainer = document.createElement('div');
    cubeContainer.className = 'cube3d-c';
    for (var index = 0; index < 6; index++) {
      var face = document.createElement('div');
      face.className = 'cube3d-f';
      cubeContainer.appendChild(face);
    }
    cube.appendChild(cubeContainer);
    indicator.appendChild(cube);

    var label = document.createElement('span');
    label.className = 'think-label';
    label.textContent = 'Working in background…';
    indicator.appendChild(label);
    return indicator;
  }

  function visibleBubblesForRun(runId) {
    var marker = '[NOVA_RUN_ID:' + runId + ']';
    return Array.prototype.filter.call(
      document.querySelectorAll('#chat-inner .bubble'),
      function (bubble) { return String(bubble.textContent || '').indexOf(marker) !== -1; }
    );
  }

  function ensureVisibleThinking(runId) {
    visibleBubblesForRun(runId).forEach(function (bubble) {
      var body = bubble.closest ? bubble.closest('.msg-body') : bubble.parentElement;
      if (!body) return;
      if (body.querySelector('.durable-thinking-indicator[data-nova-run-id="' + runId + '"]')) return;
      body.appendChild(buildThinkingIndicator(runId));
    });
  }

  function removeVisibleThinking(runId) {
    document.querySelectorAll(
      '.durable-thinking-indicator[data-nova-run-id="' + runId + '"]'
    ).forEach(function (indicator) { indicator.remove(); });
  }

  function replaceStoredMessage(runId, text) {
    var marker = '[NOVA_RUN_ID:' + runId + ']';
    var chats = loadChats();
    var changed = false;
    chats.forEach(function (chat) {
      if (!chat || !Array.isArray(chat.messages)) return;
      chat.messages.forEach(function (message) {
        if (!message || message.role !== 'assistant' || typeof message.content !== 'string') return;
        if (message.content.indexOf(marker) === -1) return;
        message.content = text;
        message.at = Date.now();
        changed = true;
      });
    });
    if (changed) {
      saveChats(chats);
      try { window.dispatchEvent(new CustomEvent('bob:chat-updated', { detail: { runId: runId } })); } catch (_) {}
    }
  }

  function replaceVisibleMessage(runId, text) {
    visibleBubblesForRun(runId).forEach(function (bubble) { bubble.textContent = text; });
  }

  function finish(runId, text) {
    removeVisibleThinking(runId);
    replaceStoredMessage(runId, text);
    replaceVisibleMessage(runId, text);
    if (timers[runId]) window.clearTimeout(timers[runId]);
    delete timers[runId];
  }

  function schedule(runId, delay) {
    if (timers[runId]) window.clearTimeout(timers[runId]);
    timers[runId] = window.setTimeout(function () { poll(runId); }, delay);
  }

  async function poll(runId) {
    ensureVisibleThinking(runId);
    try {
      var response = await fetch('/api/work-tree/runs/' + encodeURIComponent(runId), {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) {
        schedule(runId, response.status === 404 ? 10000 : 5000);
        return;
      }

      var payload = await response.json();
      var run = payload && payload.run ? payload.run : {};
      var status = String(run.status || 'pending');

      if (status === 'done') {
        finish(
          runId,
          '✅ Background run #' + runId + ' complete\n\n' +
            (cleanReport(run.report) || 'The run completed without a report.')
        );
        return;
      }

      if (status === 'failed' || status === 'cancelled') {
        finish(
          runId,
          '⚠ Background run #' + runId + ' ' + status + '\n\n' +
            String(run.error || 'No error detail was returned.')
        );
        return;
      }

      ensureVisibleThinking(runId);
      schedule(runId, 3500);
    } catch (_) {
      ensureVisibleThinking(runId);
      schedule(runId, 7000);
    }
  }

  function watch(runId) {
    if (!Number.isInteger(runId) || runId < 1 || timers[runId]) return;
    ensureVisibleThinking(runId);
    schedule(runId, 500);
  }

  function discover() {
    loadChats().forEach(function (chat) {
      if (!chat || !Array.isArray(chat.messages)) return;
      chat.messages.forEach(function (message) {
        if (!message || typeof message.content !== 'string') return;
        var match = markerPattern.exec(message.content);
        if (match) watch(Number(match[1]));
      });
    });

    document.querySelectorAll('#chat-inner .bubble').forEach(function (bubble) {
      var match = markerPattern.exec(String(bubble.textContent || ''));
      if (match) watch(Number(match[1]));
    });
  }

  discover();
  var chatInner = document.getElementById('chat-inner');
  if (chatInner) {
    new MutationObserver(discover).observe(chatInner, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  window.addEventListener('storage', function (event) {
    if (event.key === chatsKey) discover();
  });
})();

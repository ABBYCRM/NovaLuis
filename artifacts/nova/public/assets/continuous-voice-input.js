(function () {
  'use strict';

  var originalButton = document.getElementById('mic-btn');
  var input = document.getElementById('user-input');
  if (!originalButton || !input) return;

  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  var button = originalButton.cloneNode(true);
  originalButton.replaceWith(button);

  var recognition = null;
  var requested = false;
  var active = false;
  var baseText = '';
  var restartTimer = null;
  var fatalError = false;

  function combine(left, right) {
    var a = String(left || '').trim();
    var b = String(right || '').trim();
    return a && b ? a + ' ' + b : a || b;
  }

  function renderState() {
    button.classList.toggle('listening', requested);
    button.setAttribute('aria-pressed', requested ? 'true' : 'false');
    button.title = requested ? 'Stop voice input' : 'Start voice input';
    input.placeholder = requested ? 'Listening… tap the mic when finished' : 'Message NOVA…';
  }

  function createRecognition() {
    var instance = new SpeechRecognition();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = navigator.language || 'en-US';

    instance.onstart = function () {
      active = true;
      fatalError = false;
      baseText = String(input.value || '').trim();
      renderState();
    };

    instance.onresult = function (event) {
      var finalText = '';
      var interimText = '';
      for (var index = 0; index < event.results.length; index++) {
        var result = event.results[index];
        var transcript = result && result[0] ? String(result[0].transcript || '') : '';
        if (result && result.isFinal) finalText += transcript + ' ';
        else interimText += transcript;
      }
      input.value = combine(baseText, finalText + interimText);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    instance.onerror = function (event) {
      var error = String((event && event.error) || 'unknown');
      fatalError = error === 'not-allowed' || error === 'service-not-allowed' || error === 'audio-capture';
      if (fatalError) requested = false;
      active = false;
      renderState();
      if (error !== 'no-speech' && error !== 'aborted') {
        console.warn('[voice] recognition error', error);
      }
    };

    instance.onend = function () {
      active = false;
      renderState();
      if (!requested || fatalError || document.hidden) return;
      baseText = String(input.value || '').trim();
      window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(start, 250);
    };

    return instance;
  }

  function start() {
    if (!requested || active || document.hidden) return;
    recognition = createRecognition();
    try {
      recognition.start();
    } catch (_) {
      window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(start, 350);
    }
  }

  function stop() {
    requested = false;
    window.clearTimeout(restartTimer);
    renderState();
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
    }
  }

  button.addEventListener('click', function (event) {
    event.preventDefault();
    if (requested) {
      stop();
      return;
    }
    requested = true;
    fatalError = false;
    renderState();
    start();
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && requested && !active) start();
  });

  window.__novaVoiceInput = {
    isRequested: function () { return requested; },
    isActive: function () { return active; },
    stop: stop,
  };
})();

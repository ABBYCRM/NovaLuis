/* Instagram Reel guard
 *
 * The Social Media tab currently generates still images, not videos. Instagram
 * Reels require a public HTTPS video URL, so Reel requests are normalized to a
 * regular Instagram post until the UI has a real video upload/generation flow.
 */
(function () {
  "use strict";

  var originalFetch = window.fetch.bind(window);

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function rewriteJsonBody(init) {
    if (!init || typeof init.body !== "string") return init;
    try {
      var body = JSON.parse(init.body);
      if (body && body.platform === "instagram" && body.contentType === "reel") {
        body.contentType = "post";
        return Object.assign({}, init, { body: JSON.stringify(body) });
      }
    } catch (_) {
      // Non-JSON request bodies are passed through untouched.
    }
    return init;
  }

  window.fetch = async function (input, init) {
    var url = requestUrl(input);
    var nextInit = init;

    if (
      url.indexOf("/api/social/generate") !== -1 ||
      url.indexOf("/api/social/schedule") !== -1
    ) {
      nextInit = rewriteJsonBody(init);
    }

    var response = await originalFetch(input, nextInit);

    if (url.indexOf("/api/social/smart-suggest") !== -1) {
      try {
        var clone = response.clone();
        var data = await clone.json();
        if (data && data.platform === "instagram" && data.contentType === "reel") {
          data.contentType = "post";
          data.postingTip = "Instagram Reels are disabled until NOVA has a real video URL pipeline. A regular image post was selected.";
          return new Response(JSON.stringify(data), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
      } catch (_) {
        // Preserve the original response if it is not JSON.
      }
    }

    return response;
  };

  function enforceUiGuard() {
    document.querySelectorAll('.sm-type-btn[data-type="reel"]').forEach(function (button) {
      button.remove();
    });

    var list = document.getElementById("sm-type-list");
    if (list && !document.getElementById("sm-reel-disabled-note")) {
      var note = document.createElement("span");
      note.id = "sm-reel-disabled-note";
      note.textContent = "Reels require video upload";
      note.style.cssText = "font-size:10px;color:var(--muted);padding:4px 8px;white-space:nowrap;";
      list.appendChild(note);
    }
  }

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest
      ? event.target.closest('.sm-type-btn[data-type="reel"]')
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enforceUiGuard, { once: true });
  } else {
    enforceUiGuard();
  }

  new MutationObserver(enforceUiGuard).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();

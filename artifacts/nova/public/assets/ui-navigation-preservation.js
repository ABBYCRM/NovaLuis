/*
 * NovaLuis mobile chat navigation preservation
 *
 * The established inline chat/history code remains authoritative for creating,
 * loading, and deleting conversations. This file only closes the mobile sidebar
 * after a chat navigation action and makes the existing delete control keyboard
 * accessible. It does not replace storage keys, chat handlers, or persistence.
 */
(function () {
  'use strict';

  function isMobileSidebar() {
    return !window.matchMedia || window.matchMedia('(max-width: 1024px)').matches;
  }

  function closeMobileSidebar() {
    if (!isMobileSidebar()) return;
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
    document.body.style.overflow = '';
  }

  function focusComposer() {
    var input = document.getElementById('user-input');
    if (!input) return;
    try { input.focus({ preventScroll: true }); }
    catch (_) { input.focus(); }
  }

  function enhanceDeleteControls(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.hi-del').forEach(function (control) {
      if (!control.hasAttribute('tabindex')) control.setAttribute('tabindex', '0');
      if (control.dataset.keyboardDeleteWired === 'true') return;
      control.dataset.keyboardDeleteWired = 'true';
      control.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        control.click();
      });
    });
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;

    if (target.closest('#new-chat-btn')) {
      // Let the authoritative inline handler create and persist the new chat
      // first, then reveal the chat screen and return focus to the composer.
      window.setTimeout(function () {
        closeMobileSidebar();
        focusComposer();
      }, 75);
      return;
    }

    if (target.closest('.history-item') && !target.closest('.hi-del')) {
      // Loading an existing conversation is also navigation back to chat.
      window.setTimeout(function () {
        closeMobileSidebar();
        focusComposer();
      }, 75);
    }
  });

  var history = document.getElementById('history-list');
  if (history) {
    enhanceDeleteControls(history);
    new MutationObserver(function () { enhanceDeleteControls(history); }).observe(history, {
      childList: true,
      subtree: true,
    });
  }
})();

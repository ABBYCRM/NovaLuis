(function () {
  'use strict';
  function closeMobileSidebar() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
    document.body.style.overflow = '';
    var input = document.getElementById('user-input');
    if (input) input.focus();
  }
  var button = document.getElementById('new-chat-btn');
  if (button) button.addEventListener('click', function () {
    window.setTimeout(closeMobileSidebar, 75);
  });
})();

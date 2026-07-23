(function () {
  'use strict';

  if (window.__novaResponsePresentationInstalled) return;
  window.__novaResponsePresentationInstalled = true;

  var ROOT_SELECTOR = '.msg-row.bot .md-content, .msg-row.bot .message-content';
  var INTERNAL_BLOCK = /^(?:\[?scratchpad\]?|global_state\b|system\s+trace\s*:|internal\s+trace\s*:|database\s+dump\s+complete\.?$|baby\s+taking\s+orders\.?$|outgoing\s+requests\s+spawning\b|autonomous\s+pull\s+requests\s+running\b)/i;

  function normalizedText(node) {
    return String(node && node.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function removeLiteralThinkBlocks(root) {
    var nodes = root.querySelectorAll('think');
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();

    var blocks = root.querySelectorAll('p,div,pre,code,li');
    for (var j = 0; j < blocks.length; j++) {
      var block = blocks[j];
      var text = normalizedText(block);
      if (!text) continue;
      if (/^<think>[\s\S]*<\/think>$/i.test(text)) {
        block.remove();
        continue;
      }
      if (INTERNAL_BLOCK.test(text)) block.remove();
    }
  }

  function stripInlineThinkText(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var before = String(node.nodeValue || '');
      var after = before
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^\s*(?:system|internal)\s+trace\s*:.*$/gim, '')
        .replace(/^\s*\[?scratchpad\]?.*$/gim, '')
        .replace(/^\s*GLOBAL_STATE\b.*$/gim, '');
      if (after !== before) node.nodeValue = after;
    }
  }

  function removeConsecutiveDuplicateBlocks(root) {
    var children = Array.prototype.slice.call(root.children || []);
    var previousText = '';
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var text = normalizedText(child);
      if (text && text.length >= 24 && text === previousText) {
        child.remove();
        continue;
      }
      if (text) previousText = text;
    }
  }

  function sanitize(root) {
    if (!root || root.dataset.novaPresentationBusy === '1') return;
    root.dataset.novaPresentationBusy = '1';
    try {
      removeLiteralThinkBlocks(root);
      stripInlineThinkText(root);
      removeConsecutiveDuplicateBlocks(root);
      root.classList.add('nova-structured-response');
    } finally {
      delete root.dataset.novaPresentationBusy;
    }
  }

  function scan(scope) {
    var root = scope && scope.matches && scope.matches(ROOT_SELECTOR) ? scope : null;
    if (root) sanitize(root);
    if (!scope || !scope.querySelectorAll) return;
    var roots = scope.querySelectorAll(ROOT_SELECTOR);
    for (var i = 0; i < roots.length; i++) sanitize(roots[i]);
  }

  function boot() {
    scan(document);
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (record.target && record.target.nodeType === 1) scan(record.target);
        var added = record.addedNodes || [];
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) scan(added[j]);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

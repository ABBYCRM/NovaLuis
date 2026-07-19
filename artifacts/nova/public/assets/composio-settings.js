/* NOVA Composio settings + OpenClaw chat routing */
(function () {
  'use strict';

  if (window.__novaComposioInstalled) return;
  window.__novaComposioInstalled = true;

  var FEATURED = [
    { slug: 'github', name: 'GitHub', icon: 'GH', description: 'Repositories, files, commits, issues and pull requests' },
    { slug: 'gmail', name: 'Gmail', icon: 'GM', description: 'Read, search, organize and send email' },
    { slug: 'googlecalendar', name: 'Google Calendar', icon: 'GC', description: 'Events, availability and scheduling' },
    { slug: 'googledrive', name: 'Google Drive', icon: 'GD', description: 'Files, folders and shared drives' },
    { slug: 'googlesheets', name: 'Google Sheets', icon: 'GS', description: 'Read and update spreadsheets' },
    { slug: 'slack', name: 'Slack', icon: 'SL', description: 'Channels, messages and workspace activity' },
    { slug: 'notion', name: 'Notion', icon: 'NO', description: 'Pages, databases and team knowledge' },
    { slug: 'linear', name: 'Linear', icon: 'LI', description: 'Issues, projects and engineering workflow' },
    { slug: 'shopify', name: 'Shopify', icon: 'SH', description: 'Products, orders and storefront operations' },
    { slug: 'hubspot', name: 'HubSpot', icon: 'HS', description: 'CRM contacts, deals and communications' },
    { slug: 'supabase', name: 'Supabase', icon: 'SB', description: 'Projects, databases and backend services' },
    { slug: 'discord', name: 'Discord', icon: 'DC', description: 'Servers, channels and messages' }
  ];

  var state = {
    configured: false,
    connected: {},
    apps: [],
    loading: false,
    searchTimer: null,
    popupPoll: null
  };

  function esc(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function installAgentFetchRouter() {
    if (window.__novaAgentFetchRouter) return;
    window.__novaAgentFetchRouter = true;
    var previousFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      try {
        var raw = typeof input === 'string' ? input : (input && input.url);
        if (raw) {
          var parsed = new URL(raw, window.location.origin);
          if (parsed.origin === window.location.origin && parsed.pathname === '/api/v1/chat/completions') {
            parsed.pathname = '/api/agent/v1/chat/completions';
            var replacement = parsed.pathname + parsed.search + parsed.hash;
            if (typeof input === 'string') input = replacement;
            else input = new Request(replacement, input);
          }
        }
      } catch (_) {}
      return previousFetch(input, init);
    };
  }

  async function api(path, options) {
    var response = await fetch(path, options);
    var text = await response.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; }
    catch (_) { data = { raw: text }; }
    if (!response.ok) {
      var message = data && data.error ? data.error : ('HTTP ' + response.status);
      var error = new Error(message);
      error.details = data;
      throw error;
    }
    return data;
  }

  function injectStyles() {
    if (document.getElementById('composio-settings-style')) return;
    var style = document.createElement('style');
    style.id = 'composio-settings-style';
    style.textContent = [
      '#composio-settings{display:flex;flex-direction:column;gap:10px}',
      '.cmp-head{display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '.cmp-title-row{display:flex;align-items:center;gap:9px}',
      '.cmp-mark{width:29px;height:29px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(135deg,#f97316,#ec4899);font-size:11px;font-weight:800;color:#fff;box-shadow:0 7px 20px -8px var(--glow)}',
      '.cmp-status{font-size:10.5px;padding:3px 8px;border-radius:999px;border:1px solid var(--border);color:var(--muted);white-space:nowrap}',
      '.cmp-status.on{color:#86efac;border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.1)}',
      '.cmp-status.bad{color:#fca5a5;border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.1)}',
      '.cmp-config{display:grid;grid-template-columns:1fr 150px auto;gap:7px;align-items:center}',
      '.cmp-btn{border:1px solid var(--border);background:var(--surface2);color:var(--text);border-radius:8px;padding:8px 12px;font-size:12px;cursor:pointer;transition:.15s}',
      '.cmp-btn:hover{border-color:rgba(249,115,22,.5);background:var(--accent-dim)}',
      '.cmp-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.cmp-btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));border:0;color:#fff;font-weight:650}',
      '.cmp-picker{border:1px solid var(--border);border-radius:11px;background:var(--surface2);overflow:visible}',
      '.cmp-picker>summary{list-style:none;cursor:pointer;padding:11px 12px;display:flex;align-items:center;justify-content:space-between;font-size:12.5px;font-weight:650;color:var(--text)}',
      '.cmp-picker>summary::-webkit-details-marker{display:none}',
      '.cmp-picker>summary:after{content:"⌄";color:var(--muted);font-size:15px;transition:transform .15s}',
      '.cmp-picker[open]>summary:after{transform:rotate(180deg)}',
      '.cmp-dropdown{border-top:1px solid var(--border);padding:10px;display:flex;flex-direction:column;gap:9px}',
      '.cmp-search-wrap{position:relative}',
      '.cmp-search-wrap:before{content:"⌕";position:absolute;left:11px;top:7px;color:var(--muted);font-size:18px}',
      '#cmp-search{padding-left:34px}',
      '.cmp-featured{display:flex;gap:6px;overflow-x:auto;padding-bottom:3px}',
      '.cmp-chip{flex:0 0 auto;border:1px solid var(--border);background:rgba(255,255,255,.025);color:var(--muted);border-radius:999px;padding:6px 10px;font-size:11px;cursor:pointer}',
      '.cmp-chip:hover,.cmp-chip.active{color:var(--text);border-color:rgba(249,115,22,.45);background:var(--accent-dim)}',
      '.cmp-results{display:flex;flex-direction:column;gap:6px;max-height:330px;overflow:auto}',
      '.cmp-app{display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:10px;border:1px solid var(--border);border-radius:9px;padding:8px;background:rgba(10,10,11,.35)}',
      '.cmp-app:hover{border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.035)}',
      '.cmp-logo{width:38px;height:38px;border-radius:10px;background:#fff;display:grid;place-items:center;overflow:hidden;color:#111;font-size:10px;font-weight:800}',
      '.cmp-logo img{width:100%;height:100%;object-fit:contain;padding:5px}',
      '.cmp-app-copy{min-width:0}',
      '.cmp-app-name{font-size:12.5px;font-weight:650;color:var(--text);display:flex;align-items:center;gap:6px}',
      '.cmp-connected-dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 8px rgba(34,197,94,.55)}',
      '.cmp-connected-dot.bad{background:#fca5a5;box-shadow:0 0 8px rgba(252,165,165,.55)}',
      '.cmp-app-desc{font-size:10.8px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cmp-connect{padding:6px 10px;font-size:11px}',
      '.cmp-connect.connected{color:#86efac;border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.08)}',
      '.cmp-connections{display:flex;flex-direction:column;gap:8px}',
      '.cmp-conn-heading{font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);margin-bottom:4px}',
      '.cmp-conn-section{display:flex;flex-direction:column;gap:5px}',
      '.cmp-account{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border-radius:8px;border:1px solid rgba(34,197,94,.25);background:rgba(34,197,94,.07);color:#bbf7d0;font-size:10.5px}',
      '.cmp-account-bad{border-color:rgba(252,165,165,.35);background:rgba(252,165,165,.08);color:#fecaca}',
      '.cmp-reconnect{margin-left:6px;padding:2px 7px;font-size:10px;border-radius:6px;border:1px solid rgba(252,165,165,.4);background:rgba(252,165,165,.1);color:#fee2e2;cursor:pointer}',
      '.cmp-reconnect:hover{background:rgba(252,165,165,.2)}',
      '.cmp-empty{padding:17px;text-align:center;color:var(--muted);font-size:11.5px;border:1px dashed var(--border);border-radius:9px}',
      '#cmp-msg{min-height:17px}',
      '@media(max-width:680px){.cmp-config{grid-template-columns:1fr}.cmp-config .cmp-btn{width:100%}.cmp-app{grid-template-columns:34px minmax(0,1fr);}.cmp-logo{width:34px;height:34px}.cmp-connect{grid-column:1/-1;width:100%}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function injectPanel() {
    if (document.getElementById('composio-settings')) return;
    var integrationSave = document.getElementById('intg-save-btn');
    var anchor = integrationSave && integrationSave.closest('.form-group');
    if (!anchor) return;

    var divider = document.createElement('hr');
    divider.className = 'section-divider';

    var panel = document.createElement('section');
    panel.className = 'form-group';
    panel.id = 'composio-settings';
    panel.innerHTML = [
      '<div class="cmp-head">',
      '  <div class="cmp-title-row"><span class="cmp-mark">CO</span><div><div class="form-label" style="margin:0">Composio Apps</div><div class="ws-tiny ws-muted">Connect GitHub and 1,000+ apps for OpenClaw</div></div></div>',
      '  <span id="cmp-status" class="cmp-status">checking…</span>',
      '</div>',
      '<p class="ws-muted ws-tiny">OAuth happens on Composio’s hosted Connect Link. App passwords and OAuth tokens never pass through NOVA or the model.</p>',
      '<div class="cmp-config">',
      '  <input class="form-input" id="cmp-api-key" type="password" autocomplete="off" placeholder="Composio project API key — leave blank to keep current">',
      '  <input class="form-input" id="cmp-user-id" type="text" autocomplete="off" placeholder="User ID" value="nova-luis">',
      '  <button class="cmp-btn" id="cmp-save" type="button">Save</button>',
      '</div>',
      '<details class="cmp-picker" id="cmp-picker" open>',
      '  <summary><span>Connect an app</span><span id="cmp-count" class="ws-tiny ws-muted"></span></summary>',
      '  <div class="cmp-dropdown">',
      '    <div class="cmp-search-wrap"><input class="form-input" id="cmp-search" type="search" placeholder="Search GitHub, Gmail, Slack, Notion, Shopify…"></div>',
      '    <div class="cmp-featured" id="cmp-featured"></div>',
      '    <div class="cmp-results" id="cmp-results"><div class="cmp-empty">Loading app catalog…</div></div>',
      '  </div>',
      '</details>',
      '<div class="cmp-head"><span class="form-label" style="margin:0">Connected apps</span><button class="cmp-btn" id="cmp-refresh" type="button">Refresh</button></div>',
      '<div class="cmp-connections" id="cmp-connections"><span class="ws-tiny ws-muted">Checking connections…</span></div>',
      '<div class="ws-tiny ws-muted" id="cmp-msg"></div>'
    ].join('');

    anchor.insertAdjacentElement('afterend', divider);
    divider.insertAdjacentElement('afterend', panel);

    var featured = document.getElementById('cmp-featured');
    if (featured) {
      featured.innerHTML = FEATURED.map(function (app) {
        return '<button type="button" class="cmp-chip" data-cmp-search="' + esc(app.slug) + '">' + esc(app.name) + '</button>';
      }).join('');
    }
  }

  function setMessage(message, bad) {
    var el = document.getElementById('cmp-msg');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = bad ? '#fca5a5' : '';
  }

  function setConfigured(configured, label) {
    state.configured = Boolean(configured);
    var el = document.getElementById('cmp-status');
    if (!el) return;
    el.classList.toggle('on', state.configured);
    el.classList.toggle('bad', !state.configured);
    el.textContent = label || (state.configured ? 'ready' : 'API key needed');
  }

  // Healthy states per the Composio API: only ACTIVE (and the legacy CONNECTED
  // alias) mean the account can actually be used. Any other status — EXPIRED,
  // INITIATED, FAILED, INACTIVE, DISABLED, MISSING — must NOT appear as
  // connected in the UI or the agent tool preflight.
  function normalizeConnection(item) {
    var connection = item && (item.connected_account || item.connectedAccount || item.connection);
    var account = connection && (connection.connected_account || connection.connectedAccount || connection);
    var status = String((account && account.status) || '').toUpperCase();
    var statusReason = String((account && account.status_reason) || (account && account.state && account.state.val && account.state.val.status_reason) || '');
    var isHealthy = status === 'ACTIVE' || status === 'CONNECTED';
    return {
      active: isHealthy,
      id: account && account.id,
      status: status || 'UNKNOWN',
      statusReason: statusReason,
      isExpired: status === 'EXPIRED' || status === 'FAILED' || status === 'INACTIVE' || status === 'DISABLED'
    };
  }

  function updateConnectedMap(items) {
    state.connected = {};
    state.expired = {};
    (items || []).forEach(function (item) {
      var slug = String(item.slug || (item.toolkit && item.toolkit.slug) || '').toLowerCase();
      if (!slug) return;
      var info = normalizeConnection(item);
      if (info.active) state.connected[slug] = info;
      else if (info.isExpired || info.status === 'INITIATED' || info.status === 'UNKNOWN') state.expired[slug] = info;
    });
  }

  function renderConnections(items) {
    var box = document.getElementById('cmp-connections');
    if (!box) return;
    updateConnectedMap(items);
    var healthySlugs = Object.keys(state.connected);
    var unhealthySlugs = Object.keys(state.expired);
    if (!healthySlugs.length && !unhealthySlugs.length) {
      box.innerHTML = '<span class="ws-tiny ws-muted">No Composio apps connected yet.</span>';
      return;
    }
    var parts = [];
    if (healthySlugs.length) {
      parts.push('<div class="cmp-conn-section">');
      parts.push('<div class="cmp-conn-heading">Healthy</div>');
      parts.push(healthySlugs.sort().map(function (slug) {
        var info = state.connected[slug];
        return '<span class="cmp-account"><span class="cmp-connected-dot"></span>' + esc(slug) + (info.id ? ' · ' + esc(info.id) : '') + '</span>';
      }).join(''));
      parts.push('</div>');
    }
    if (unhealthySlugs.length) {
      parts.push('<div class="cmp-conn-section">');
      parts.push('<div class="cmp-conn-heading">Needs reconnect</div>');
      parts.push(unhealthySlugs.sort().map(function (slug) {
        var info = state.expired[slug];
        var reason = info.statusReason || info.status || 'expired';
        return '<span class="cmp-account cmp-account-bad" title="' + esc(reason) + '"><span class="cmp-connected-dot bad"></span>' + esc(slug) + ' · ' + esc(info.status || 'unknown') + ' — <button type="button" class="cmp-reconnect" data-cmp-reconnect="' + esc(slug) + '">Reconnect</button></span>';
      }).join(''));
      parts.push('</div>');
    }
    box.innerHTML = parts.join('');
  }

  function fallbackApps(filter) {
    var q = String(filter || '').toLowerCase();
    return FEATURED.filter(function (app) {
      return !q || app.slug.indexOf(q) !== -1 || app.name.toLowerCase().indexOf(q) !== -1 || app.description.toLowerCase().indexOf(q) !== -1;
    }).map(function (app) {
      return {
        slug: app.slug,
        name: app.name,
        meta: { description: app.description, logo: '' }
      };
    });
  }

  function renderApps(items) {
    state.apps = Array.isArray(items) ? items : [];
    var box = document.getElementById('cmp-results');
    var count = document.getElementById('cmp-count');
    if (count) count.textContent = state.apps.length ? state.apps.length + ' shown' : '';
    if (!box) return;
    if (!state.apps.length) {
      box.innerHTML = '<div class="cmp-empty">No matching apps.</div>';
      return;
    }

    box.innerHTML = state.apps.map(function (app) {
      var slug = String(app.slug || '').toLowerCase();
      var name = String(app.name || slug || 'App');
      var meta = app.meta || {};
      var description = String(meta.description || app.description || 'Composio toolkit');
      var logo = String(meta.logo || app.logo || '');
      var direct = normalizeConnection(app);
      var connected = direct.active || Boolean(state.connected[slug]);
      var initials = name.split(/\s+/).map(function (part) { return part.charAt(0); }).join('').slice(0, 2).toUpperCase();
      var logoHtml = logo
        ? '<img src="' + esc(logo) + '" alt="" loading="lazy" onerror="this.remove();this.parentNode.textContent=\'' + esc(initials) + '\'">'
        : esc(initials);
      return [
        '<div class="cmp-app" data-cmp-app="' + esc(slug) + '">',
        '  <div class="cmp-logo">' + logoHtml + '</div>',
        '  <div class="cmp-app-copy"><div class="cmp-app-name">' + esc(name) + (connected ? '<span class="cmp-connected-dot" title="Connected"></span>' : '') + '</div><div class="cmp-app-desc">' + esc(description) + '</div></div>',
        '  <button type="button" class="cmp-btn cmp-connect' + (connected ? ' connected' : ' primary') + '" data-cmp-connect="' + esc(slug) + '" ' + (connected ? 'disabled' : '') + '>' + (connected ? 'Connected' : 'Connect') + '</button>',
        '</div>'
      ].join('');
    }).join('');
  }

  async function loadStatus() {
    setMessage('Checking Composio…', false);
    try {
      var data = await api('/api/integrations/composio/status');
      setConfigured(Boolean(data && data.configured), data && data.configured ? 'ready' : 'API key needed');
      var user = document.getElementById('cmp-user-id');
      if (user && data && data.userId) user.value = data.userId;
      renderConnections((data && data.connected) || []);
      setMessage(data && data.configured ? 'OpenClaw can discover and execute connected app tools.' : 'Save a Composio project API key to activate live app discovery and OAuth connections.', !data || !data.configured);
      return data;
    } catch (error) {
      setConfigured(false, 'unavailable');
      renderConnections([]);
      setMessage('Composio status failed: ' + error.message, true);
      return null;
    }
  }

  // Pull the AUTHORITATIVE per-toolkit health from the server. The toolkits
  // listing endpoint can be stale (e.g. gmail shows ACTIVE there but the
  // /connected_accounts endpoint shows the new connection is EXPIRED), so we
  // always prefer the health endpoint when it's available.
  async function loadHealth() {
    try {
      var data = await api('/api/integrations/composio/health');
      if (!data || !data.configured) return;
      var toolkits = data.toolkits || {};
      var items = Object.keys(toolkits).map(function (slug) {
        var info = toolkits[slug];
        return {
          slug: slug,
          toolkit: { slug: slug, name: info.toolkitName || slug },
          connected_account: { id: info.id, status: info.status, status_reason: info.statusReason }
        };
      });
      renderConnections(items);
    } catch (error) {
      // Swallow — loadStatus() already surfaces a generic error message.
    }
  }

  async function loadApps(search) {
    var query = String(search || '').trim();
    var box = document.getElementById('cmp-results');
    if (state.loading) return;
    state.loading = true;
    if (box) box.innerHTML = '<div class="cmp-empty">Loading app catalog…</div>';
    try {
      if (!state.configured) {
        renderApps(fallbackApps(query));
        return;
      }
      var params = new URLSearchParams({ limit: '50' });
      if (query) params.set('search', query);
      var data = await api('/api/integrations/composio/toolkits?' + params.toString());
      var items = (data && data.items) || [];
      updateConnectedMap(items.concat(Object.keys(state.connected).map(function (slug) { return { slug: slug, connected_account: state.connected[slug] }; })));
      renderApps(items);
    } catch (error) {
      renderApps(fallbackApps(query));
      setMessage('Live catalog failed; showing featured apps. ' + error.message, true);
    } finally {
      state.loading = false;
    }
  }

  async function saveConfig() {
    var keyInput = document.getElementById('cmp-api-key');
    var userInput = document.getElementById('cmp-user-id');
    var rawKey = keyInput ? keyInput.value : '';
    var rawUser = userInput ? userInput.value : '';
    var fields = {};
    if (rawKey !== '') fields.api_key = rawKey.trim();
    if (rawUser !== '') fields.user_id = rawUser.trim() || 'nova-luis';
    if (!Object.keys(fields).length) {
      setMessage('Nothing new to save.', false);
      return;
    }

    setMessage('Saving Composio configuration…', false);
    try {
      await api('/api/integrations/composio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: fields })
      });
      if (keyInput) keyInput.value = '';
      await loadStatus();
      await loadApps(document.getElementById('cmp-search') && document.getElementById('cmp-search').value);
      setMessage('Composio configuration saved.', false);
    } catch (error) {
      setMessage('Save failed: ' + error.message, true);
    }
  }

  function startPopupPolling(popup) {
    if (state.popupPoll) clearInterval(state.popupPoll);
    var checks = 0;
    state.popupPoll = setInterval(function () {
      checks += 1;
      if (!popup || popup.closed || checks > 48) {
        clearInterval(state.popupPoll);
        state.popupPoll = null;
        loadStatus().then(function () { loadApps(document.getElementById('cmp-search') && document.getElementById('cmp-search').value); });
      }
    }, 2500);
  }

  async function connectToolkit(slug) {
    if (!slug) return;
    if (!state.configured) {
      setMessage('Save a Composio project API key before connecting apps.', true);
      var keyInput = document.getElementById('cmp-api-key');
      if (keyInput) keyInput.focus();
      return;
    }

    var popup = window.open('about:blank', 'nova-composio-connect', 'width=680,height=760,resizable=yes,scrollbars=yes');
    if (popup) popup.document.write('<title>Connecting ' + esc(slug) + '</title><body style="font-family:sans-serif;background:#0a0a0b;color:#eee;padding:30px">Creating secure Composio Connect Link…</body>');
    setMessage('Creating Connect Link for ' + slug + '…', false);
    try {
      var data = await api('/api/integrations/composio/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolkit: slug })
      });
      if (!data || !data.redirectUrl) throw new Error('No redirect URL returned');
      if (popup) {
        popup.location.replace(data.redirectUrl);
        startPopupPolling(popup);
      } else {
        window.location.href = data.redirectUrl;
      }
      setMessage('Complete the connection in the Composio window.', false);
    } catch (error) {
      if (popup) popup.close();
      setMessage('Connection failed: ' + error.message, true);
    }
  }

  function handleCallback() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('composio') !== 'connected') return;
    var message = {
      type: 'nova-composio-connected',
      toolkit: params.get('toolkit') || '',
      status: params.get('status') || 'returned',
      connectedAccountId: params.get('connected_account_id') || ''
    };
    if (window.opener && window.opener !== window) {
      try { window.opener.postMessage(message, window.location.origin); } catch (_) {}
      document.body.innerHTML = '<main style="min-height:100vh;display:grid;place-items:center;background:#0a0a0b;color:#e3e3e3;font-family:sans-serif"><div style="text-align:center"><h2>Connection returned to NOVA</h2><p>You can close this window.</p></div></main>';
      setTimeout(function () { window.close(); }, 900);
      return;
    }
    setTimeout(function () {
      var settings = document.getElementById('settings-btn');
      if (settings) settings.click();
      loadStatus().then(function () { loadHealth(); loadApps(''); });
      history.replaceState(null, '', window.location.pathname + window.location.hash);
    }, 250);
  }

  function bindEvents() {
    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('#settings-btn')) {
        setTimeout(function () { loadStatus().then(function () { loadHealth(); loadApps(document.getElementById('cmp-search') && document.getElementById('cmp-search').value); }); }, 80);
        return;
      }
      if (target.closest('#cmp-save')) { saveConfig(); return; }
      if (target.closest('#cmp-refresh')) {
        loadStatus().then(function () { loadHealth(); loadApps(document.getElementById('cmp-search') && document.getElementById('cmp-search').value); });
        return;
      }
      var chip = target.closest('[data-cmp-search]');
      if (chip) {
        var search = chip.getAttribute('data-cmp-search') || '';
        var input = document.getElementById('cmp-search');
        if (input) input.value = search;
        loadApps(search);
        return;
      }
      var connect = target.closest('[data-cmp-connect]');
      if (connect) connectToolkit(connect.getAttribute('data-cmp-connect') || '');
      var reconnect = target.closest('[data-cmp-reconnect]');
      if (reconnect) {
        var slug = reconnect.getAttribute('data-cmp-reconnect') || '';
        // Reconnect = start a fresh OAuth flow for the same toolkit.
        connectToolkit(slug);
        return;
      }
    });

    document.addEventListener('input', function (event) {
      var target = event.target;
      if (!target || target.id !== 'cmp-search') return;
      if (state.searchTimer) clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(function () { loadApps(target.value); }, 280);
    });

    window.addEventListener('message', function (event) {
      if (event.origin !== window.location.origin || !event.data || event.data.type !== 'nova-composio-connected') return;
      setMessage('Connection returned. Refreshing app status…', false);
      loadStatus().then(function () { loadApps(document.getElementById('cmp-search') && document.getElementById('cmp-search').value); });
    });

    window.addEventListener('focus', function () {
      if (document.getElementById('modal-overlay') && document.getElementById('modal-overlay').classList.contains('open')) {
        loadStatus();
      }
    });
  }

  installAgentFetchRouter();
  injectStyles();
  injectPanel();
  bindEvents();
  handleCallback();
})();

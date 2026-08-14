/* Reference pane script — plain JS, no build, no deps. This is a WORKING skeleton:
 * it lists whatever the declared grant reaches and shows the selected entry. Replace
 * loadItems()/rowHtml()/paintDetail() with your real surface; keep the rails.
 * The rails (each earned by a real production defect — GUIDE §8):
 *   esc() on every interpolated string · envelope normalization in api() ·
 *   latest-wins loads · a visible error surface with Retry · embed/theme/liveness
 *   wiring per SPEC 5.5 · lazy secondary views. */
(function () {
  'use strict';

  // ── embedding + theme contract (SPEC 5.5) ─────────────────────────────────
  var EMBEDDED = /[?&]embed=1\b/.test(location.search);
  if (EMBEDDED) document.body.classList.add('embed');
  var THEME = /[?&]theme=light/.test(location.search) ? 'light' : 'dark';
  if (THEME === 'light') document.body.classList.add('theme-light');

  // Liveness: the host uses this to tell a dead page from a quiet one. It is NOT
  // sizing — the host fixes the frame to its panel (100vh here IS that panel).
  function reportLiveness() {
    if (!EMBEDDED || !window.parent || window.parent === window) return;
    var h = Math.ceil(document.body.scrollHeight + 8);
    try { window.parent.postMessage({ type: 'lmui:height', uiId: (window.__UI_ID__ || ''), height: h }, '*'); } catch (e) {}
  }
  if (EMBEDDED) {
    window.addEventListener('load', reportLiveness);
    if (window.ResizeObserver) new ResizeObserver(reportLiveness).observe(document.body);
    setInterval(reportLiveness, 1500);
  }

  var $ = function (id) { return document.getElementById(id); };
  // Escape EVERY interpolated string — server data included; ids included.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── data plane ────────────────────────────────────────────────────────────
  // Some serving tiers wrap the backend's own envelope in an outer {status,data};
  // others pass it through. Normalize ONCE here so every caller sees {ok,status,data,error}
  // and the same page runs unchanged behind either tier. Non-JSON and transport
  // failures surface their real text — nothing is swallowed.
  function api(service, path, opts) {
    return lmui.call(service, path, opts).then(function (r) {
      return r.text().then(function (txt) {
        var b = null;
        try { b = txt ? JSON.parse(txt) : null; } catch (e) { b = null; }
        var wrapped = b && b.data !== undefined && b.status !== undefined;
        var body = wrapped ? b.data : b;
        var status = wrapped ? b.status : r.status;
        if (r.ok && (!wrapped || (status >= 200 && status < 300))) return { ok: true, status: status, data: body };
        var msg = (body && body.error && (body.error.message || body.error)) || (body && body.message)
          || (txt ? txt.slice(0, 600) : ('HTTP ' + status));
        return { ok: false, status: status, error: String(msg) };
      });
    }).catch(function (e) {
      return { ok: false, status: 0, error: String(e && e.message || e) };
    });
  }

  // ── state ─────────────────────────────────────────────────────────────────
  var state = { items: [], selected: null, filter: '', seq: 0, aboutLoaded: false };

  // Full-screen gate: unserved preview (no injected token) or a hard load failure.
  function gate(title, message, isErr, retry) {
    var old = $('gate-layer');
    if (old) old.remove();
    if (title == null) return;
    var d = document.createElement('div');
    d.className = 'gate';
    d.id = 'gate-layer';
    d.innerHTML = '<div class="gate-card' + (isErr ? ' err' : '') + '"><div class="gate-h"></div>'
      + '<pre class="gate-msg"></pre>' + (retry ? '<button class="primary" id="gate-retry" type="button">Retry</button>' : '') + '</div>';
    d.querySelector('.gate-h').textContent = title;
    d.querySelector('.gate-msg').textContent = message;
    document.body.appendChild(d);
    if (retry) $('gate-retry').onclick = function () { d.remove(); loadItems(); };
    reportLiveness();
  }

  // ── items (the primary view) — REPLACE from here down with your surface ───
  // The scaffold's declared grant reaches one listing endpoint; this renders whatever
  // array-of-objects it finds so the page works the moment it is registered.
  function firstArray(x) {
    if (Array.isArray(x)) return x;
    if (x && typeof x === 'object') {
      for (var k in x) if (Array.isArray(x[k])) return x[k];
    }
    return [];
  }
  function labelOf(it) {
    if (typeof it !== 'object' || it === null) return String(it);
    return String(it.name || it.title || it.id || JSON.stringify(it).slice(0, 60));
  }

  function loadItems() {
    // Latest-wins: a stale response must never paint over a newer one.
    var seq = ++state.seq;
    return api('platform', '/api/models').then(function (r) {
      if (seq !== state.seq) return;
      if (!r.ok) { gate('This page could not load its data', r.error, true, true); return; }
      state.items = firstArray(r.data);
      paintList();
    });
  }

  function paintList() {
    var q = state.filter.trim().toLowerCase();
    var vis = state.items.filter(function (it) { return !q || labelOf(it).toLowerCase().indexOf(q) >= 0; });
    $('list').innerHTML = vis.length
      ? vis.map(function (it, i) {
          var sel = state.selected === it ? ' sel' : '';
          return '<div class="row' + sel + '" data-i="' + state.items.indexOf(it) + '">' + esc(labelOf(it)) + '</div>';
        }).join('')
      : '<div class="counts">Nothing matches.</div>';
    $('counts').textContent = 'showing ' + vis.length + ' of ' + state.items.length;
    reportLiveness();
  }

  function paintDetail() {
    var el = $('detail');
    if (!state.selected) { el.className = 'detail empty'; el.textContent = 'Select an item on the left.'; return; }
    el.className = 'detail';
    el.innerHTML = '<h2></h2><pre class="mono"></pre>';
    el.querySelector('h2').textContent = labelOf(state.selected);
    el.querySelector('pre').textContent = JSON.stringify(state.selected, null, 2);
    reportLiveness();
  }

  // ── views (lazy secondary) ────────────────────────────────────────────────
  function switchView(v) {
    var about = v === 'about';
    $('tab-items').classList.toggle('on', !about);
    $('tab-about').classList.toggle('on', about);
    document.querySelector('.pane-list').hidden = about;
    document.querySelector('.pane-detail').hidden = about;
    document.querySelector('.pane-about').hidden = !about;
    if (about && !state.aboutLoaded) {
      state.aboutLoaded = true;
      $('about-out').textContent = 'uiId: ' + (lmui.uiId || '(unserved)') + '\nuiKey: ' + (lmui.uiKey || '—')
        + '\nembed: ' + EMBEDDED + '  theme: ' + THEME;
    }
    reportLiveness();
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  $('tab-items').addEventListener('click', function () { switchView('items'); });
  $('tab-about').addEventListener('click', function () { switchView('about'); });
  $('q').addEventListener('input', function (e) { state.filter = e.target.value; paintList(); });
  $('list').addEventListener('click', function (e) {
    var row = e.target.closest ? e.target.closest('.row') : null;
    if (!row) return;
    state.selected = state.items[Number(row.dataset.i)] || null;
    paintList();
    paintDetail();
  });

  // Identity rides the session, not the view token.
  $('uiid').textContent = lmui.uiId || 'unserved';
  fetch('/auth/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
    $('who-name').textContent = (d.claims && (d.claims.name || d.claims.email)) || d.userId || 'signed in';
  }).catch(function () { $('who-name').textContent = 'not signed in'; });

  // ── boot ──────────────────────────────────────────────────────────────────
  if (!window.__VIEW_TOKEN__) {
    // Bare `lmui dev` preview without a serving tier: the layout renders, data cannot.
    gate('Unserved preview', 'No view token was injected, so the data plane is offline.\n'
      + 'Serve this page behind a gateway (lmui register + dev) to see it live.', false, false);
  } else {
    loadItems();
  }
})();

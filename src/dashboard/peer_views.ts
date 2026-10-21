/**
 * Personal-memory views for the dashboard: Profile, Facts (with provenance,
 * edit/correct/delete, trust feedback), Ask, Deriver status.
 *
 * Rendering rule: every value from the API reaches the DOM through
 * textContent / value / setAttribute on fixed attribute names — never
 * innerHTML — so nothing a conversation said can become markup.
 * Client code below avoids backticks and "${" because it is spliced into the
 * main template literal.
 */

export const PEER_NAV_HTML = String.raw`
      <div class="sidebar-section">
        <div class="section-label">Personal Memory</div>
        <div class="nav-item" onclick="switchView('pm-profile')">
          <svg class="icon" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>Profile</span>
        </div>
        <div class="nav-item" onclick="switchView('pm-facts')">
          <svg class="icon" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          <span>Facts</span>
          <span class="nav-badge" id="pm-badge-facts">-</span>
        </div>
        <div class="nav-item" onclick="switchView('pm-ask')">
          <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Ask</span>
        </div>
        <div class="nav-item" onclick="switchView('pm-deriver')">
          <svg class="icon" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          <span>Deriver</span>
          <span class="nav-badge" id="pm-badge-queue">-</span>
        </div>
      </div>
`;

export const PEER_STYLE = String.raw`
    .pm { max-width: 1100px; color: var(--text-main); font-size: 13px; }
    .pm-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
    .pm input[type=text], .pm select, .pm textarea {
      background: var(--bg-subtle); color: var(--text-main); border: 1px solid var(--border-base);
      border-radius: 4px; padding: 6px 8px; font: inherit;
    }
    .pm textarea { width: 100%; min-height: 64px; resize: vertical; box-sizing: border-box; }
    .pm button { background: transparent; color: var(--text-main); border: 1px solid var(--border-base); border-radius: 4px; padding: 5px 10px; font: inherit; cursor: pointer; }
    .pm button:hover { border-color: var(--border-hover); }
    .pm button.pm-primary { background: #e5e7eb; color: #111827; border-color: #e5e7eb; }
    .pm button.pm-danger { color: #f87171; border-color: rgba(248,113,113,0.4); }
    .pm-box { border: 1px solid var(--border-subtle); border-radius: 6px; padding: 14px 16px; margin-bottom: 14px; background: var(--bg-surface); }
    .pm-label { color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
    .pm-muted { color: var(--text-muted); }
    .pm table { width: 100%; border-collapse: collapse; }
    .pm th { text-align: left; color: var(--text-dim); font-weight: 500; font-size: 11px; padding: 6px 8px; border-bottom: 1px solid var(--border-base); }
    .pm td { padding: 7px 8px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
    .pm tr.pm-row:hover td { background: var(--bg-surface-hover); cursor: pointer; }
    .pm tr.pm-off td { opacity: 0.5; text-decoration: line-through; }
    .pm-tag { display: inline-block; font-size: 11px; padding: 1px 6px; border: 1px solid var(--border-base); border-radius: 3px; color: var(--text-muted); white-space: nowrap; }
    .pm-trust { display: inline-block; width: 46px; height: 4px; background: var(--border-base); border-radius: 2px; vertical-align: middle; margin-right: 6px; }
    .pm-trust > i { display: block; height: 100%; background: #9ca3af; border-radius: 2px; }
    .pm-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; }
    .pm-kv { display: grid; grid-template-columns: 180px 1fr; gap: 6px 12px; }
    .pm-msg { border-left: 2px solid var(--border-base); padding: 4px 10px; margin: 6px 0; }
    .pm ul { margin: 0; padding-left: 18px; }
    .pm li { margin: 3px 0; }
`;

const VIEW = (id: string, title: string, sub: string, body: string) => String.raw`
      <div id="view-${id}" class="view-content">
        <div class="view-header"><div><div class="view-title">${title}</div><div class="view-sub">${sub}</div></div></div>
        <div class="pm">
          <div class="pm-bar"><span class="pm-muted">Peer</span><select class="pm-peer" onchange="pmSetPeer(this.value)"><option value="user">user</option></select></div>
          ${body}
        </div>
      </div>`;

export const PEER_VIEWS_HTML =
  VIEW(
    "pm-profile",
    "Profile",
    "Living summary and peer card, regenerated by the deriver from trusted facts.",
    String.raw`<div class="pm-bar"><button onclick="pmLoadProfile(true)">Regenerate summary</button><span id="pm-profile-meta" class="pm-muted"></span></div>
          <div class="pm-box"><div class="pm-label">Summary</div><div id="pm-profile-summary"></div></div>
          <div class="pm-box"><div class="pm-label">Peer card (trust &ge; 0.45, confidence &ge; 0.5)</div><ul id="pm-profile-card"></ul></div>`
  ) +
  VIEW(
    "pm-facts",
    "Facts",
    "Derived memories with confidence, trust, category and provenance. Click a row for source messages.",
    String.raw`<div class="pm-bar">
            <input type="text" id="pm-q" placeholder="Search facts" oninput="pmDebouncedFacts()">
            <select id="pm-cat" onchange="pmLoadFacts()"><option value="">All categories</option><option>profile</option><option>preferences</option><option>entities</option><option>events</option><option>cases</option><option>patterns</option></select>
            <select id="pm-kind" onchange="pmLoadFacts()"><option value="">All kinds</option><option>explicit</option><option>deductive</option><option>conclusion</option><option>insight</option><option>manual</option></select>
            <label class="pm-muted"><input type="checkbox" id="pm-inactive" onchange="pmLoadFacts()"> show superseded</label>
            <button onclick="pmNewConclusion()">Add conclusion</button>
          </div>
          <div class="pm-box" id="pm-detail" style="display:none"></div>
          <table><thead><tr><th>Fact (L0 abstract)</th><th>Category</th><th>Kind</th><th>Conf.</th><th>Trust</th><th>Created</th></tr></thead><tbody id="pm-facts-body"></tbody></table>`
  ) +
  VIEW(
    "pm-ask",
    "Ask",
    "Answers only from memory, with cited memory ids. Abstains when memory does not cover it.",
    String.raw`<div class="pm-box">
            <textarea id="pm-question" placeholder="What does this person prefer for ...?"></textarea>
            <div class="pm-bar" style="margin:8px 0 0">
              <select id="pm-depth"><option value="1">Depth 1: answer</option><option value="2">Depth 2: + self-audit</option><option value="3">Depth 3: + reconcile</option></select>
              <button class="pm-primary" onclick="pmAsk()">Ask</button><span id="pm-ask-state" class="pm-muted"></span>
            </div>
          </div>
          <div class="pm-box" id="pm-answer" style="display:none"></div>`
  ) +
  VIEW(
    "pm-deriver",
    "Deriver",
    "Background learner: queue, last run, last error, LLM endpoint. The API key is never shown.",
    String.raw`<div class="pm-bar"><button onclick="pmLoadDeriver()">Refresh</button><button class="pm-primary" onclick="pmRunDeriver()">Run now</button><span id="pm-deriver-state" class="pm-muted"></span></div>
          <div class="pm-box"><div class="pm-kv" id="pm-deriver-kv"></div></div>`
  );

export const PEER_SCRIPT = String.raw`
    // ---------------- Personal memory views ----------------
    let pmPeer = 'user';
    let pmTimer = null;
    let pmFactsCache = [];

    function pmEl(tag, props, children) {
      const node = document.createElement(tag);
      if (props) {
        for (const k of Object.keys(props)) {
          if (k === 'text') node.textContent = String(props[k] == null ? '' : props[k]);
          else if (k === 'className') node.className = props[k];
          else if (k === 'onclick') node.addEventListener('click', props[k]);
          else if (k === 'style') node.setAttribute('style', props[k]);
          else if (k === 'value') node.value = props[k];
          else if (k === 'title') node.title = String(props[k]);
        }
      }
      (children || []).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
      return node;
    }
    function pmClear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
    function pmDate(ms) { return ms ? new Date(Number(ms)).toLocaleString() : '-'; }
    function pmApi(path, opts) { return apiFetch('/v1/peers/' + encodeURIComponent(pmPeer) + path, opts).then(function (r) { return r.json(); }); }
    function pmJson(method, body) { return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }; }

    function pmSetPeer(p) {
      pmPeer = p || 'user';
      document.querySelectorAll('.pm-peer').forEach(function (s) { s.value = pmPeer; });
      if (currentView && currentView.indexOf('pm-') === 0) pmLoad(currentView);
    }

    async function pmLoadPeers() {
      try {
        const res = await apiFetch('/v1/peers').then(function (r) { return r.json(); });
        const peers = (res.peers || []).map(function (p) { return p.peer; });
        if (peers.indexOf('user') < 0) peers.unshift('user');
        document.querySelectorAll('.pm-peer').forEach(function (sel) {
          pmClear(sel);
          peers.forEach(function (p) { sel.appendChild(pmEl('option', { value: p, text: p })); });
          sel.value = pmPeer;
        });
      } catch (e) { console.error('peers', e); }
    }

    function pmLoad(viewId) {
      pmLoadPeers();
      if (viewId === 'pm-profile') pmLoadProfile(false);
      else if (viewId === 'pm-facts') pmLoadFacts();
      else if (viewId === 'pm-deriver') pmLoadDeriver();
    }

    async function pmLoadProfile(refresh) {
      const res = await pmApi('/representation' + (refresh ? '?refresh=1' : ''));
      const rep = res.representation || {};
      document.getElementById('pm-profile-summary').textContent = rep.summary || 'No summary yet. It appears after the deriver has learned a few facts.';
      document.getElementById('pm-profile-meta').textContent = (rep.fact_count || 0) + ' active facts · ' + (rep.pinned ? 'pinned card · ' : '') + 'source: ' + (rep.source || '-') + ' · updated ' + pmDate(rep.updated_at);
      const ul = pmClear(document.getElementById('pm-profile-card'));
      (rep.card || []).forEach(function (c) { ul.appendChild(pmEl('li', { text: c })); });
      if (!(rep.card || []).length) ul.appendChild(pmEl('li', { className: 'pm-muted', text: 'Empty' }));
    }

    function pmDebouncedFacts() { clearTimeout(pmTimer); pmTimer = setTimeout(pmLoadFacts, 250); }

    function pmTrust(t) {
      const bar = pmEl('span', { className: 'pm-trust' }, [pmEl('i', { style: 'width:' + Math.round(Math.max(0, Math.min(1, Number(t) || 0)) * 100) + '%' })]);
      return pmEl('span', null, [bar, (Number(t) || 0).toFixed(2)]);
    }

    function pmAbstract(s) { s = String(s || ''); return s.length > 400 ? s.slice(0, 400) + '…' : s; }

    async function pmLoadFacts() {
      const params = new URLSearchParams();
      const q = document.getElementById('pm-q').value.trim();
      if (q) params.set('q', q);
      const cat = document.getElementById('pm-cat').value; if (cat) params.set('category', cat);
      const kind = document.getElementById('pm-kind').value; if (kind) params.set('kind', kind);
      if (document.getElementById('pm-inactive').checked) params.set('include_inactive', '1');
      params.set('limit', '300');
      const res = await pmApi('/facts?' + params.toString());
      pmFactsCache = res.facts || [];
      const badge = document.getElementById('pm-badge-facts'); if (badge) badge.textContent = String(pmFactsCache.filter(function (f) { return f.is_active; }).length);
      const body = pmClear(document.getElementById('pm-facts-body'));
      if (!pmFactsCache.length) {
        body.appendChild(pmEl('tr', null, [pmEl('td', { className: 'pm-muted', text: 'No facts yet.' })]));
        return;
      }
      pmFactsCache.forEach(function (f) {
        const tr = pmEl('tr', { className: 'pm-row' + (f.is_active ? '' : ' pm-off'), onclick: function () { pmShowFact(f.id); } }, [
          pmEl('td', { text: pmAbstract(f.content) }),
          pmEl('td', null, [pmEl('span', { className: 'pm-tag', text: f.category })]),
          pmEl('td', null, [pmEl('span', { className: 'pm-tag', text: f.kind })]),
          pmEl('td', { className: 'pm-mono', text: (Number(f.confidence) || 0).toFixed(2) }),
          pmEl('td', { className: 'pm-mono' }, [pmTrust(f.trust)]),
          pmEl('td', { className: 'pm-muted', text: pmDate(f.created_at) })
        ]);
        body.appendChild(tr);
      });
    }

    async function pmShowFact(id) {
      const res = await pmApi('/facts/' + encodeURIComponent(id));
      const f = res.fact;
      const box = pmClear(document.getElementById('pm-detail'));
      box.style.display = 'block';
      if (!f) { box.appendChild(pmEl('div', { text: 'Fact not found.' })); return; }
      const catSel = pmEl('select', null, ['profile', 'preferences', 'entities', 'events', 'cases', 'patterns'].map(function (c) { return pmEl('option', { value: c, text: c }); }));
      catSel.value = f.category;
      const editor = pmEl('textarea', { value: f.content });
      box.appendChild(pmEl('div', { className: 'pm-bar' }, [
        pmEl('span', { className: 'pm-tag', text: f.category }), pmEl('span', { className: 'pm-tag', text: f.kind }),
        pmEl('span', { className: 'pm-tag', text: f.is_active ? 'active' : f.status }),
        pmEl('span', { className: 'pm-muted pm-mono', text: f.id }),
        pmEl('span', { className: 'pm-muted', text: 'conf ' + Number(f.confidence).toFixed(2) + ' · trust ' + Number(f.trust).toFixed(2) + ' · seen ' + f.observations + 'x' })
      ]));
      box.appendChild(pmEl('div', { className: 'pm-label', text: 'L1 · full fact' }));
      box.appendChild(editor);
      box.appendChild(pmEl('div', { className: 'pm-bar', style: 'margin-top:8px' }, f.is_active ? [
        catSel,
        pmEl('button', { className: 'pm-primary', text: 'Save correction', onclick: function () { pmSaveFact(f.id, editor.value, catSel.value); } }),
        pmEl('button', { text: 'Helpful', onclick: function () { pmFeedback(f.id, 'helpful'); } }),
        pmEl('button', { text: 'Not helpful', onclick: function () { pmFeedback(f.id, 'unhelpful'); } }),
        pmEl('button', { className: 'pm-danger', text: 'Delete (purge)', onclick: function () { pmDeleteFact(f.id); } }),
        pmEl('button', { text: 'Close', onclick: function () { box.style.display = 'none'; } })
      ] : [pmEl('button', { text: 'Close', onclick: function () { box.style.display = 'none'; } })]));
      box.appendChild(pmEl('div', { className: 'pm-label', style: 'margin-top:12px', text: 'L2 · provenance (' + (f.source_messages || []).length + ' source messages)' }));
      (f.source_messages || []).forEach(function (m) {
        box.appendChild(pmEl('div', { className: 'pm-msg' }, [
          pmEl('div', { className: 'pm-muted', text: '#' + m.id + ' · ' + m.role + ' · session ' + m.session + ' · ' + pmDate(m.ts) }),
          pmEl('div', { text: m.content })
        ]));
      });
      if ((f.source_memory_ids || []).length) box.appendChild(pmEl('div', { className: 'pm-muted pm-mono', text: 'derived from memories: ' + f.source_memory_ids.join(', ') }));
      if ((f.history || []).length) {
        box.appendChild(pmEl('div', { className: 'pm-label', style: 'margin-top:12px', text: 'Replaced versions' }));
        f.history.forEach(function (h) { box.appendChild(pmEl('div', { className: 'pm-msg pm-muted', text: h.content + ' (' + h.status + ', ' + pmDate(h.updated_at) + ')' })); });
      }
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function pmSaveFact(id, content, category) {
      const res = await pmApi('/facts/' + encodeURIComponent(id), pmJson('PATCH', { content: content, category: category }));
      if (!res.success) { showToast('Save failed: ' + (res.error || 'unknown')); return; }
      showToast(res.replaced ? 'Correction saved; old version kept as history' : 'Saved');
      await pmLoadFacts();
      pmShowFact(res.fact.id);
    }

    async function pmFeedback(id, verdict) {
      const res = await pmApi('/facts/' + encodeURIComponent(id) + '/feedback', pmJson('POST', { verdict: verdict }));
      if (res.success) { showToast('Trust now ' + Number(res.trust).toFixed(2)); pmLoadFacts(); pmShowFact(id); }
    }

    async function pmDeleteFact(id) {
      if (!confirm('Permanently purge this fact? This cannot be undone.')) return;
      const res = await pmApi('/facts/' + encodeURIComponent(id), { method: 'DELETE' });
      if (res.success) { showToast('Purged'); document.getElementById('pm-detail').style.display = 'none'; pmLoadFacts(); }
    }

    async function pmNewConclusion() {
      const text = prompt('New conclusion about ' + pmPeer + ':');
      if (!text || !text.trim()) return;
      const res = await pmApi('/conclusions', pmJson('POST', { content: text.trim() }));
      if (res.success) { showToast('Conclusion stored'); pmLoadFacts(); }
    }

    async function pmAsk() {
      const q = document.getElementById('pm-question').value.trim();
      if (!q) return;
      const state = document.getElementById('pm-ask-state');
      state.textContent = 'Thinking…';
      const res = await pmApi('/ask', pmJson('POST', { question: q, depth: Number(document.getElementById('pm-depth').value) }));
      state.textContent = '';
      const box = pmClear(document.getElementById('pm-answer'));
      box.style.display = 'block';
      if (!res.success) { box.appendChild(pmEl('div', { text: 'Error: ' + (res.error || 'unknown') })); return; }
      box.appendChild(pmEl('div', { className: 'pm-label', text: res.abstained ? 'Abstained' : 'Answer (depth ' + res.depth + ', ' + res.considered + ' memories considered)' }));
      box.appendChild(pmEl('div', { style: 'white-space:pre-wrap;margin-bottom:10px', text: res.answer }));
      if ((res.citations || []).length) {
        box.appendChild(pmEl('div', { className: 'pm-label', text: res.abstained ? 'Closest memories' : 'Citations' }));
        const ul = pmEl('ul');
        res.citations.forEach(function (c) {
          ul.appendChild(pmEl('li', null, [
            pmEl('a', { className: 'pm-mono', style: 'cursor:pointer;text-decoration:underline', text: String(c.id).slice(0, 8), onclick: function () { switchView('pm-facts'); setTimeout(function () { pmShowFact(c.id); }, 50); } }),
            ' ' + c.content
          ]));
        });
        box.appendChild(ul);
      }
    }

    async function pmLoadDeriver() {
      const res = await apiFetch('/v1/deriver/status').then(function (r) { return r.json(); });
      const s = res.status || {};
      const q = s.queue || {};
      const badge = document.getElementById('pm-badge-queue'); if (badge) badge.textContent = String(q.pending || 0);
      const kv = pmClear(document.getElementById('pm-deriver-kv'));
      const rows = [
        ['Worker', s.enabled ? (s.running ? 'running a batch' : 'idle (every ' + Math.round((s.interval_ms || 0) / 1000) + 's)') : 'not started in this process'],
        ['Queue pending', String(q.pending || 0) + ' (' + (q.due_now || 0) + ' due now)'],
        ['Next retry', q.next_retry_at ? pmDate(q.next_retry_at) : '-'],
        ['Processed / skipped', String(q.done || 0) + ' / ' + String(q.skipped || 0)],
        ['Facts written', String(s.facts_written_total || 0)],
        ['Last run', pmDate(s.last_run_at)],
        ['Last success', pmDate(s.last_success_at)],
        ['Last error', s.last_error ? s.last_error + ' (' + pmDate(s.last_error_at) + ')' : 'none'],
        ['LLM endpoint', s.llm && s.llm.configured ? s.llm.url : 'not configured (set MNEMO_LLM_URL)'],
        ['LLM model', s.llm && s.llm.model ? s.llm.model : '-']
      ];
      rows.forEach(function (r) { kv.appendChild(pmEl('div', { className: 'pm-muted', text: r[0] })); kv.appendChild(pmEl('div', { className: 'pm-mono', text: r[1] })); });
    }

    async function pmRunDeriver() {
      const st = document.getElementById('pm-deriver-state');
      st.textContent = 'Running…';
      await apiFetch('/v1/deriver/run', { method: 'POST' });
      st.textContent = '';
      pmLoadDeriver();
    }
`;

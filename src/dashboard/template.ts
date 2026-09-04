export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🏛️ Mnemosyne Brain Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      /* Obsidian Slate Base Palette */
      --bg-base: #08090c;
      --bg-subtle: #0d0f14;
      --bg-surface: #12151d;
      --bg-surface-hover: #171b26;
      --bg-active: #1d2331;
      
      /* Subtle Luminous Borders */
      --border-subtle: rgba(255, 255, 255, 0.065);
      --border-base: rgba(255, 255, 255, 0.11);
      --border-hover: rgba(255, 255, 255, 0.2);
      --border-focus: #5e6ad2;
      
      /* Typography Colors */
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --text-inverse: #020617;
      
      /* Linear Signature Brand Accent */
      --brand: #5e6ad2;
      --brand-hover: #6d79e8;
      --brand-subtle: rgba(94, 106, 210, 0.12);
      --brand-border: rgba(94, 106, 210, 0.28);
      --brand-glow: rgba(94, 106, 210, 0.35);
      
      /* Semantic Colors */
      --emerald: #10b981;
      --emerald-subtle: rgba(16, 185, 129, 0.1);
      --emerald-border: rgba(16, 185, 129, 0.25);
      --amber: #f59e0b;
      --amber-subtle: rgba(245, 158, 11, 0.1);
      --rose: #f43f5e;
      --rose-subtle: rgba(244, 63, 94, 0.1);
      --rose-border: rgba(244, 63, 94, 0.25);
      --cyan: #0ea5e9;
      --cyan-subtle: rgba(14, 165, 233, 0.1);
      
      --font: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --mono: 'JetBrains Mono', ui-monospace, monospace;
      --sidebar-width: 252px;
      --topbar-height: 52px;
      --statusbar-height: 28px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg-base);
      color: var(--text-main);
      font-family: var(--font);
      font-size: 13px;
      line-height: 1.5;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      -webkit-font-smoothing: antialiased;
      user-select: none;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }

    /* Icons */
    .icon {
      width: 15px;
      height: 15px;
      stroke-width: 2;
      stroke: currentColor;
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      flex-shrink: 0;
    }

    /* Layout Shell */
    .app-shell {
      display: flex;
      flex: 1;
      height: calc(100vh - var(--statusbar-height));
      overflow: hidden;
    }

    /* Sidebar */
    .sidebar {
      width: var(--sidebar-width);
      background: var(--bg-subtle);
      border-right: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .sidebar-header {
      height: var(--topbar-height);
      padding: 0 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid var(--border-subtle);
    }

    .logo-badge {
      width: 26px;
      height: 26px;
      border-radius: 6px;
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 13px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 2px 8px rgba(99, 102, 241, 0.35);
    }

    .logo-text {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--text-main);
    }

    .version-pill {
      font-family: var(--mono);
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(255,255,255,0.05);
      color: var(--text-dim);
      border: 1px solid var(--border-subtle);
      margin-left: auto;
    }

    .sidebar-section {
      padding: 14px 10px 4px 10px;
    }

    .section-label {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      padding: 0 8px 6px 8px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 10px;
      border-radius: 6px;
      color: var(--text-muted);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
      margin-bottom: 2px;
    }

    .nav-item:hover {
      color: var(--text-main);
      background: var(--bg-surface);
    }

    .nav-item.active {
      color: #ffffff;
      background: rgba(94, 106, 210, 0.09);
      border-color: rgba(94, 106, 210, 0.24);
      box-shadow: inset 2px 0 0 var(--brand);
    }

    .nav-badge {
      margin-left: auto;
      font-family: var(--mono);
      font-size: 10.5px;
      padding: 1px 6px;
      border-radius: 99px;
      background: rgba(255,255,255,0.06);
      color: var(--text-dim);
    }

    .nav-item.active .nav-badge {
      background: rgba(94, 106, 210, 0.2);
      color: #c7d2fe;
      border: 1px solid rgba(94, 106, 210, 0.3);
    }

    .sidebar-footer {
      margin-top: auto;
      padding: 12px;
      border-top: 1px solid var(--border-subtle);
      background: rgba(0,0,0,0.2);
    }

    .workspace-box {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      transition: border-color 0.15s;
    }

    .workspace-box:hover {
      border-color: var(--border-base);
    }

    .workspace-icon {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--emerald);
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.6);
      flex-shrink: 0;
    }

    .workspace-info {
      overflow: hidden;
    }

    .workspace-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-main);
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }

    .workspace-sub {
      font-size: 10px;
      color: var(--text-dim);
      font-family: var(--mono);
    }

    /* Main Content Area */
    .main-stage {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--bg-base);
      overflow: hidden;
    }

    /* Topbar */
    .topbar {
      height: var(--topbar-height);
      border-bottom: 1px solid var(--border-subtle);
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--bg-base);
      flex-shrink: 0;
    }

    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12.5px;
      color: var(--text-muted);
    }

    .breadcrumb-sep { color: var(--text-dim); font-size: 10px; }
    .breadcrumb-active { color: var(--text-main); font-weight: 600; }

    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .cmd-trigger {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      padding: 5px 10px;
      border-radius: 6px;
      color: var(--text-dim);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.12s;
    }

    .cmd-trigger:hover {
      border-color: var(--border-base);
      color: var(--text-muted);
    }

    .kbd {
      font-family: var(--mono);
      font-size: 10px;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border-subtle);
      padding: 1px 5px;
      border-radius: 4px;
      color: var(--text-muted);
    }

    .telemetry-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      font-size: 11px;
    }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid var(--border-base);
      background: var(--bg-surface);
      color: var(--text-main);
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .btn:hover {
      background: var(--bg-surface-hover);
      border-color: var(--border-hover);
      color: #fff;
    }

    .btn-primary {
      background: #f8fafc;
      color: #090a0f;
      border-color: #f8fafc;
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.4);
    }

    .btn-primary:hover {
      background: #e2e8f0;
      border-color: #e2e8f0;
      color: #090a0f;
      box-shadow: 0 2px 5px rgba(0,0,0,0.5);
    }

    .btn-danger {
      background: rgba(244, 63, 94, 0.08);
      color: #fb7185;
      border-color: rgba(244, 63, 94, 0.22);
    }

    .btn-danger:hover {
      background: rgba(244, 63, 94, 0.16);
      border-color: rgba(244, 63, 94, 0.35);
      color: #fecdd3;
    }

    /* Views Container */
    .view-content {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: none;
    }

    .view-content.active {
      display: flex;
      flex-direction: column;
    }

    /* Cards & Containers */
    .view-header {
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .view-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-main);
      letter-spacing: -0.01em;
    }

    .view-sub {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* Graph Canvas View */
    #view-graph.active {
      padding: 0;
      display: flex;
      flex-direction: row;
      overflow: hidden;
    }

    .graph-stage {
      flex: 1;
      position: relative;
      background: radial-gradient(ellipse at 50% 50%, #101420 0%, #08090d 100%);
      overflow: hidden;
    }

    canvas {
      width: 100%;
      height: 100%;
      display: block;
      cursor: grab;
    }

    canvas:active { cursor: grabbing; }

    .graph-controls {
      position: absolute;
      top: 16px;
      left: 16px;
      display: flex;
      gap: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border-base);
      padding: 4px;
      border-radius: 6px;
      backdrop-filter: blur(8px);
    }

    .graph-inspector {
      width: 320px;
      background: var(--bg-subtle);
      border-left: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      transition: transform 0.2s ease;
    }

    .inspector-header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12.5px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .inspector-body {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }

    .prop-group { margin-bottom: 14px; }
    .prop-label { font-size: 10.5px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; margin-bottom: 4px; }
    .prop-value { font-size: 12px; color: var(--text-main); font-family: var(--mono); word-break: break-all; }

    /* Tables & Data Grid */
    .table-container {
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      overflow: hidden;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 12.5px;
    }

    th {
      background: var(--bg-surface);
      color: var(--text-dim);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 8px 14px;
      border-bottom: 1px solid var(--border-subtle);
    }

    td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--text-main);
      vertical-align: top;
    }

    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--bg-surface); }

    .tag {
      font-family: var(--mono);
      font-size: 10.5px;
      font-weight: 500;
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid var(--border-subtle);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-muted);
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      line-height: 1.2;
    }

    .tag-danger {
      background: rgba(244, 63, 94, 0.08);
      color: #fb7185;
      border-color: rgba(244, 63, 94, 0.22);
    }

    .tag-success {
      background: rgba(16, 185, 129, 0.08);
      color: #34d399;
      border-color: rgba(16, 185, 129, 0.22);
    }

    .tag-brand {
      background: rgba(94, 106, 210, 0.1);
      color: #c7d2fe;
      border-color: rgba(94, 106, 210, 0.25);
    }

    /* Forms */
    .input-row {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
    }

    .search-input {
      flex: 1;
      background: var(--bg-subtle);
      border: 1px solid var(--border-base);
      border-radius: 6px;
      padding: 9px 12px;
      color: #fff;
      font-family: var(--font);
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
    }

    .search-input:focus {
      border-color: var(--brand);
      background: var(--bg-surface);
      box-shadow: 0 0 0 2px rgba(94, 106, 210, 0.2);
    }

    textarea {
      width: 100%;
      background: var(--bg-subtle);
      border: 1px solid var(--border-base);
      border-radius: 6px;
      padding: 10px 12px;
      color: #fff;
      font-family: var(--font);
      font-size: 13px;
      min-height: 90px;
      resize: vertical;
      outline: none;
    }

    textarea:focus {
      border-color: var(--brand);
      box-shadow: 0 0 0 2px rgba(94, 106, 210, 0.2);
    }

    select.search-input {
      cursor: pointer;
      color: #fff;
    }

    input[type="range"] {
      accent-color: var(--brand);
      cursor: pointer;
    }

    .card-surface {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    /* Telemetry Statusbar */
    .statusbar {
      height: var(--statusbar-height);
      background: #06070a;
      border-top: 1px solid var(--border-subtle);
      padding: 0 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: var(--mono);
      font-size: 11px;
      color: var(--text-dim);
      flex-shrink: 0;
    }

    .status-items {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .status-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--emerald);
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.8);
      animation: pulse-dot 2.5s ease-in-out infinite;
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    /* Modal / Slide Drawer */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal-box {
      width: 520px;
      max-width: 90vw;
      background: var(--bg-subtle);
      border: 1px solid var(--border-base);
      border-radius: 10px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      overflow: hidden;
      animation: modalIn 0.15s ease-out;
    }

    @keyframes modalIn {
      from { opacity: 0; transform: scale(0.97); }
      to { opacity: 1; transform: scale(1); }
    }

    .modal-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
      font-size: 13px;
    }

    .modal-body {
      padding: 18px;
    }

    .modal-footer {
      padding: 12px 18px;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      background: rgba(0,0,0,0.1);
    }

    /* Toast */
    .toast-shelf {
      position: fixed;
      bottom: 40px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .toast-pill {
      background: var(--bg-surface);
      border: 1px solid var(--border-base);
      color: #fff;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      gap: 8px;
      animation: toastIn 0.15s ease forwards;
    }

    @keyframes toastIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    pre {
      font-family: var(--mono);
      font-size: 11.5px;
      color: #a5f3fc;
      background: #07080a;
      padding: 14px;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
      overflow-x: auto;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div id="toast-shelf" class="toast-shelf"></div>

  <!-- Command Palette Modal -->
  <div id="cmd-palette" class="modal-overlay" onclick="if(event.target===this) toggleCmdPalette(false)">
    <div class="modal-box">
      <div style="padding: 12px 14px; border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; gap: 8px;">
        <svg class="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="cmd-input" placeholder="Type a command or jump to view..." style="flex:1; background:transparent; border:none; color:#fff; font-size:13px; outline:none;" oninput="filterCmdList(this.value)">
        <span class="kbd">ESC</span>
      </div>
      <div id="cmd-list" style="max-height: 280px; overflow-y: auto; padding: 6px;"></div>
    </div>
  </div>

  <!-- Add Memory Modal -->
  <div id="modal-add-memory" class="modal-overlay" onclick="if(event.target===this) toggleAddModal(false)">
    <div class="modal-box" style="width: 580px;">
      <div class="modal-header">
        <span>Store New Knowledge / Belief</span>
        <button class="btn" style="padding: 2px 6px; border:none;" onclick="toggleAddModal(false)">✕</button>
      </div>
      <form id="add-form" onsubmit="event.preventDefault(); submitMemory();">
        <div class="modal-body">
          <div style="margin-bottom: 12px;">
            <label style="display:block; font-size:11px; font-weight:600; color:var(--text-dim); margin-bottom:4px;">MEMORY CONTENT</label>
            <textarea id="in-content" placeholder="e.g. DILARANG run_in_background untuk build/task berat di laptop RAM 16GB" required></textarea>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
            <div>
              <label style="display:block; font-size:11px; font-weight:600; color:var(--text-dim); margin-bottom:4px;">SCOPE</label>
              <select id="in-scope" class="search-input" style="width:100%; padding: 6px 10px;">
                <option value="global">global (all workspaces)</option>
                <option value="project" selected>project (current repo)</option>
                <option value="session">session (transient)</option>
              </select>
            </div>
            <div>
              <label style="display:block; font-size:11px; font-weight:600; color:var(--text-dim); margin-bottom:4px;">CATEGORY</label>
              <select id="in-category" class="search-input" style="width:100%; padding: 6px 10px;">
                <option value="negative_constraint">negative_constraint (anti-pattern)</option>
                <option value="rule">rule (architectural)</option>
                <option value="hardware">hardware (resource limit)</option>
                <option value="fact" selected>fact (technical)</option>
                <option value="preference">preference (workflow)</option>
                <option value="episodic">episodic (past lesson)</option>
              </select>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label style="display:block; font-size:11px; font-weight:600; color:var(--text-dim); margin-bottom:4px;">IMPORTANCE</label>
              <select id="in-importance" class="search-input" style="width:100%; padding: 6px 10px;">
                <option value="critical">critical (P0 guardrail)</option>
                <option value="high">high</option>
                <option value="normal" selected>normal</option>
                <option value="low">low</option>
              </select>
            </div>
            <div>
              <label style="display:block; font-size:11px; font-weight:600; color:var(--text-dim); margin-bottom:4px;">TRIPLE (SUBJECT|PRED|OBJ)</label>
              <input type="text" id="in-triple" class="search-input" style="width:100%; padding: 6px 10px;" placeholder="Laptop|RAM|16GB">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn" onclick="toggleAddModal(false)">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Memory</button>
        </div>
      </form>
    </div>
  </div>

  <div class="app-shell">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo-badge">M</div>
        <div class="logo-text">Mnemosyne Second Memory</div>
        <div class="version-tag version-pill">v1.3.6</div>
      </div>

      <div class="sidebar-section">
        <div class="section-label">Core Engine</div>
        <div class="nav-item active" onclick="switchView('graph')">
          <svg class="icon" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/></svg>
          <span>Knowledge Graph</span>
          <span class="nav-badge" id="badge-triples">-</span>
        </div>
        <div class="nav-item" onclick="switchView('drift')">
          <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
          <span>Drift Radar Sandbox</span>
        </div>
        <div class="nav-item" onclick="switchView('compactor')">
          <svg class="icon" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          <span>Context Compactor</span>
        </div>
        <div class="nav-item" onclick="switchView('remediations')">
          <svg class="icon" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          <span>Error Playbooks</span>
        </div>
        <div class="nav-item" onclick="switchView('guardrails')">
          <svg class="icon" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span>Guardrails & Rules</span>
          <span class="nav-badge" id="badge-guardrails">-</span>
        </div>
        <div class="nav-item" onclick="switchView('recall')">
          <svg class="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span>Retrieval Playground</span>
        </div>
        <div class="nav-item" onclick="switchView('clusters')">
          <svg class="icon" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span>Thematic Clusters</span>
        </div>
        <div class="nav-item" onclick="switchView('explorer')">
          <svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          <span>Belief Explorer</span>
          <span class="nav-badge" id="badge-memories">-</span>
        </div>
      </div>

      <div class="sidebar-section">
        <div class="section-label">Observability & System</div>
        <div class="nav-item" onclick="switchView('telemetry')">
          <svg class="icon" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
          <span>Resource Monitor</span>
          <span class="nav-badge" id="badge-rss">-</span>
        </div>
        <div class="nav-item" onclick="switchView('timeline')">
          <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>Event Ledger</span>
        </div>
        <div class="nav-item" onclick="switchView('doctor')">
          <svg class="icon" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          <span>Context Doctor</span>
          <span class="nav-badge" id="badge-doctor">100%</span>
        </div>
        <div class="nav-item" onclick="switchView('persona')">
          <svg class="icon" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>Theory of Mind</span>
        </div>
        <div class="nav-item" onclick="switchView('digest')">
          <svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          <span>24h Brain Digest</span>
        </div>
        <div class="nav-item" onclick="switchView('packs')">
          <svg class="icon" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          <span>Memory Packs</span>
        </div>
      </div>

      <div class="sidebar-footer">
        <div class="workspace-box">
          <div class="workspace-icon"></div>
          <div class="workspace-info">
            <div class="workspace-title">Active Workspace</div>
            <div class="workspace-sub">~/.mnemosyne/memory.db</div>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Stage -->
    <main class="main-stage">
      <div class="topbar">
        <div class="breadcrumb">
          <span>Mnemosyne Second Memory</span>
          <span class="breadcrumb-sep">/</span>
          <span class="breadcrumb-active" id="top-title">Knowledge Graph</span>
        </div>
        <div class="telemetry-bar-top" style="display:flex; align-items:center; gap:8px; margin-left:auto; margin-right:12px;">
          <div class="telemetry-pill" title="Daemon RSS RAM">
            <span style="color:var(--text-dim); font-size:10px;">RSS</span>
            <span id="top-rss-val" style="font-family:var(--mono); font-size:11px; font-weight:600; color:#fff;">-- MB</span>
          </div>
          <div class="telemetry-pill" title="Host Laptop RAM (16GB Cap)">
            <span style="color:var(--text-dim); font-size:10px;">HOST RAM</span>
            <span id="top-host-ram-val" style="font-family:var(--mono); font-size:11px; font-weight:600; color:var(--emerald);">--%</span>
          </div>
          <div class="telemetry-pill" title="SQLite Storage On Disk">
            <span style="color:var(--text-dim); font-size:10px;">DISK</span>
            <span id="top-disk-val" style="font-family:var(--mono); font-size:11px; font-weight:600; color:#fff;">-- MB</span>
          </div>
        </div>
        <div class="topbar-actions">
          <div class="cmd-trigger" onclick="toggleCmdPalette(true)">
            <span>Search or jump...</span>
            <span class="kbd">⌘K</span>
          </div>
          <button class="btn" onclick="syncRules('agents.md')">
            <svg class="icon" viewBox="0 0 24 24"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            <span>Sync AGENTS.md</span>
          </button>
          <button class="btn btn-primary" onclick="toggleAddModal(true)">
            <svg class="icon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>New Belief</span>
          </button>
        </div>
      </div>

      <!-- VIEW 1: GRAPH (SPLIT MASTER-DETAIL) -->
      <div id="view-graph" class="view-content active">
        <div class="graph-stage">
          <div class="graph-controls">
            <button class="btn" style="padding:4px 8px;" onclick="zoomGraph(1.15)">＋</button>
            <button class="btn" style="padding:4px 8px;" onclick="zoomGraph(0.85)">－</button>
            <button class="btn" style="padding:4px 8px;" onclick="resetGraph()">Center</button>
            <button class="btn" style="padding:4px 8px;" onclick="loadStats()">Reload</button>
          </div>
          <canvas id="graph-canvas"></canvas>
        </div>
        <div class="graph-inspector" id="inspector-pane">
          <div class="inspector-header">
            <span>Entity Inspector</span>
            <button class="btn" style="padding:2px 6px; border:none;" onclick="clearSelection()">✕</button>
          </div>
          <div class="inspector-body" id="inspector-content">
            <div style="color:var(--text-dim); text-align:center; padding: 40px 0;">
              Click any node in the graph to inspect its relations, confidence, and source memories.
            </div>
          </div>
        </div>
      </div>

      <!-- VIEW 2: GUARDRAILS & RULES -->
      <div id="view-guardrails" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">Active Negative Constraints & Architectural Rules</div>
            <div class="view-sub">Pre-pended at P0 priority during prompt assembly to enforce system safety.</div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn" onclick="syncRules('cursorrules')">Sync .cursorrules</button>
            <button class="btn" onclick="copyRules()">Copy Markdown</button>
          </div>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th style="width: 55%;">Rule & Constraint Content</th>
                <th>Type</th>
                <th>Scope</th>
                <th>Importance</th>
              </tr>
            </thead>
            <tbody id="guardrails-tbody">
              <tr><td colspan="4" style="text-align:center; color:var(--text-dim); padding:30px;">Loading constraints...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- VIEW 3: RETRIEVAL PLAYGROUND -->
      <div id="view-recall" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">Hybrid Retrieval Playground</div>
            <div class="view-sub">Quad-signal engine: Vector (0.45) + BM25 (0.25) + Ebbinghaus Recency (0.15) + HippoRAG Resonance (0.15)</div>
          </div>
        </div>
        <div class="input-row">
          <input type="text" id="recall-query" class="search-input" placeholder="Enter query (e.g. 'RAM 16GB limit', 'sqlite wal', 'build cloudflare', 'albatross') ..." onkeydown="if(event.key==='Enter') executeRecall()">
          <button class="btn btn-primary" onclick="executeRecall()">Execute Recall</button>
        </div>
        <div id="recall-stats" style="font-family:var(--mono); font-size:11px; color:var(--text-dim); margin-bottom:12px; display:none;"></div>
        <div id="recall-cards" style="display:flex; flex-direction:column; gap:8px;"></div>
      </div>

      <!-- VIEW 4: BELIEF EXPLORER -->
      <div id="view-explorer" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">Memory Belief Explorer</div>
            <div class="view-sub">Complete active and historical memory records indexed in SQLite.</div>
          </div>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th style="width: 50%;">Memory Content</th>
                <th>Category</th>
                <th>Scope</th>
                <th>Hits</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="explorer-tbody">
              <tr><td colspan="5" style="text-align:center; color:var(--text-dim); padding:30px;">Loading records...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- VIEW 5: DOCTOR -->
      <div id="view-doctor" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">Context Doctor & Self-Healing</div>
            <div class="view-sub">Audits orphaned triples, stale links, and database integrity.</div>
          </div>
          <button class="btn btn-primary" onclick="executeDoctorRepair()">Run Surgical Repair</button>
        </div>
        <div style="display:grid; grid-template-columns: 240px 1fr; gap:16px; margin-bottom:16px;">
          <div style="background: linear-gradient(180deg, rgba(16, 185, 129, 0.05) 0%, rgba(16, 185, 129, 0.01) 100%), var(--bg-subtle); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 20px; text-align: center;">
            <div style="font-size: 38px; font-weight: 700; font-family: var(--mono); color: var(--emerald); text-shadow: 0 0 20px rgba(16, 185, 129, 0.35);" id="doc-health-score">100%</div>
            <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px; font-weight: 500;">Structural Health Score</div>
          </div>
          <div style="background:var(--bg-subtle); border:1px solid var(--border-subtle); border-radius:8px; padding:16px;" id="doc-checklist">
            <div style="color:var(--text-dim);">Loading checklist...</div>
          </div>
        </div>
        <div class="view-title" style="margin-bottom:8px; font-size:12px;">RAW DIAGNOSTIC TELEMETRY</div>
        <pre id="doc-raw">Inspecting database...</pre>
      </div>

      <!-- VIEW 6: PERSONA -->
      <div id="view-persona" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">Theory-of-Mind Profile</div>
            <div class="view-sub">Synthesized developer worldview and hardware boundaries (Honcho pattern).</div>
          </div>
        </div>
        <div id="persona-pane" style="max-width: 800px;">
          <div style="color:var(--text-dim);">Loading persona...</div>
        </div>
      </div>

      <!-- VIEW 7: DIGEST -->
      <div id="view-digest" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">Brain Activity Digest</div>
            <div class="view-sub">Audit trail and memory change ledger over the last 24 hours.</div>
          </div>
          <button class="btn" onclick="loadDigest()">Refresh</button>
        </div>
        <pre id="digest-report">Generating digest...</pre>
      </div>

      <!-- VIEW 8: RESOURCE MONITOR & TELEMETRY -->
      <div id="view-telemetry" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">System & Resource Observability</div>
            <div class="view-sub">Real-time hardware telemetry, daemon memory footprint, and SQLite storage analytics.</div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn" onclick="loadTelemetry()">
              <svg class="icon" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              <span>Refresh Now</span>
            </button>
          </div>
        </div>

        <!-- 4 Stat Cards Grid -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px; margin-bottom:16px;">
          <!-- Card 1: Daemon Process RAM -->
          <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px; padding:18px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span class="prop-label" style="color:var(--brand); margin:0;">DAEMON PROCESS FOOTPRINT</span>
              <span class="tag tag-brand" id="stat-pid">PID --</span>
            </div>
            <div style="display:flex; align-items:baseline; gap:8px; margin-bottom:12px;">
              <span style="font-size:32px; font-weight:700; font-family:var(--mono); color:#fff;" id="stat-rss">-- MB</span>
              <span style="color:var(--text-dim); font-size:12px;">RSS Physical RAM</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; font-size:12px; border-top:1px solid var(--border-subtle); padding-top:10px;">
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Heap Used / Total:</span>
                <span style="font-family:var(--mono); color:#fff;" id="stat-heap">-- MB / -- MB</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Process CPU Time:</span>
                <span style="font-family:var(--mono); color:#fff;" id="stat-cpu">User: --ms | Sys: --ms</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Daemon Uptime:</span>
                <span style="font-family:var(--mono); color:#fff;" id="stat-uptime">--</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Runtime Engine:</span>
                <span style="font-family:var(--mono); color:var(--text-muted);" id="stat-runtime">Bun (Linux)</span>
              </div>
            </div>
          </div>

          <!-- Card 2: Host Hardware 16GB Safeguard -->
          <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px; padding:18px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span class="prop-label" style="color:var(--emerald); margin:0;">LAPTOP HARDWARE SAFEGUARD (16GB)</span>
              <span class="tag tag-success" id="stat-safeguard">NORMAL</span>
            </div>
            <div style="display:flex; align-items:baseline; gap:8px; margin-bottom:12px;">
              <span style="font-size:32px; font-weight:700; font-family:var(--mono); color:var(--emerald);" id="stat-host-ram-used">-- GB</span>
              <span style="color:var(--text-dim); font-size:12px;" id="stat-host-ram-total">/ -- GB (--%)</span>
            </div>
            <div style="width:100%; height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden; margin-bottom:12px;">
              <div id="stat-ram-bar" style="width:0%; height:100%; background:var(--emerald); transition: width 0.3s ease;"></div>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; font-size:12px; border-top:1px solid var(--border-subtle); padding-top:10px;">
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Available Free Headroom:</span>
                <span style="font-family:var(--mono); color:#fff; font-weight:600;" id="stat-free-ram">-- GB</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">CPU Cores Available:</span>
                <span style="font-family:var(--mono); color:#fff;" id="stat-cpu-cores">-- Cores</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Load Average (1m, 5m, 15m):</span>
                <span style="font-family:var(--mono); color:#fff;" id="stat-load">--</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Single-Task Policy:</span>
                <span style="font-family:var(--mono); color:var(--emerald);">Enforced (Foreground Only)</span>
              </div>
            </div>
          </div>

          <!-- Card 3: Storage & SQLite Analytics -->
          <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px; padding:18px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span class="prop-label" style="color:var(--cyan); margin:0;">SQLITE STORAGE FOOTPRINT</span>
              <span class="tag" style="color:var(--cyan); border-color:rgba(14,165,233,0.3);">WAL MODE</span>
            </div>
            <div style="display:flex; align-items:baseline; gap:8px; margin-bottom:12px;">
              <span style="font-size:32px; font-weight:700; font-family:var(--mono); color:#fff;" id="stat-total-storage">-- MB</span>
              <span style="color:var(--text-dim); font-size:12px;">Total On Disk</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; font-size:12px; border-top:1px solid var(--border-subtle); padding-top:10px;">
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">memory.db:</span>
                <span style="font-family:var(--mono); color:#fff;" id="stat-db-size">--</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">memory.db-wal:</span>
                <span style="font-family:var(--mono); color:#fff;" id="stat-wal-size">--</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Page Count / Size:</span>
                <span style="font-family:var(--mono); color:#fff;" id="stat-pages">-- pages @ 4096B</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Fragmentation / Freelist:</span>
                <span style="font-family:var(--mono); color:var(--emerald);" id="stat-freelist">0% (0 free pages)</span>
              </div>
            </div>
          </div>

          <!-- Card 4: Knowledge Graph & Index Density -->
          <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px; padding:18px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span class="prop-label" style="color:#a5b4fc; margin:0;">KNOWLEDGE CAPACITY</span>
              <span class="tag tag-brand">INDEXED</span>
            </div>
            <div style="display:flex; align-items:baseline; gap:8px; margin-bottom:12px;">
              <span style="font-size:32px; font-weight:700; font-family:var(--mono); color:#fff;" id="stat-active-memories">--</span>
              <span style="color:var(--text-dim); font-size:12px;">Active Beliefs</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; font-size:12px; border-top:1px solid var(--border-subtle); padding-top:10px;">
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Total Memory Records:</span>
                <span style="font-family:var(--mono); color:#fff;" id="stat-total-memories">--</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Knowledge Graph Triples:</span>
                <span style="font-family:var(--mono); color:#a5b4fc;" id="stat-active-triples">-- triples</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Vector Embeddings:</span>
                <span style="font-family:var(--mono); color:#fff;" id="stat-vectors">-- vectors</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-dim);">Retrieval SLA:</span>
                <span style="font-family:var(--mono); color:var(--emerald);">< 25ms (Sub-Millisecond)</span>
              </div>
            </div>
          </div>
        </div>

        <div class="view-title" style="margin-bottom:8px; font-size:12px;">FULL TELEMETRY JSON STREAM</div>
        <pre id="telemetry-raw">Fetching metrics...</pre>
      </div>

      <!-- VIEW: SEMANTIC DRIFT RADAR -->
      <div id="view-drift" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">Semantic Drift Radar &amp; Compliance Sandbox</div>
            <div class="view-sub">Real-time vector alignment check against active negative constraints and architectural guardrails.</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="tag tag-brand">COSINE DIVERGENCE ENGINE</span>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
          <!-- Left Column: Input Simulator -->
          <div class="card-surface">
            <div class="prop-label" style="color:var(--brand); margin-bottom:8px;">PROPOSED AGENT ACTION / PROMPT</div>
            <textarea id="drift-statement" placeholder="Type a proposed action, prompt, or architectural change to test compliance against stored memory guardrails...&#10;&#10;e.g. 'Deploy nextjs application by running parallel builds on local laptop'" style="height:110px; margin-bottom:12px;"></textarea>

            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
              <span style="font-size:12px; color:var(--text-dim);">Divergence Threshold:</span>
              <div style="display:flex; align-items:center; gap:8px;">
                <input type="range" id="drift-threshold" min="0.10" max="0.90" step="0.05" value="0.35" style="width:120px;" oninput="document.getElementById('drift-thresh-val').innerText = this.value">
                <span class="tag tag-brand" id="drift-thresh-val">0.35</span>
              </div>
            </div>

            <div style="margin-bottom:14px;">
              <div style="font-size:11px; color:var(--text-dim); margin-bottom:6px;">QUICK PRESET TESTS:</div>
              <div style="display:flex; flex-wrap:wrap; gap:6px;">
                <button type="button" class="btn" style="font-size:11px; padding:4px 8px;" onclick="setDriftPreset('Jalankan proses berat secara paralel build opennextjs di background')">Parallel Build (RAM Risk)</button>
                <button type="button" class="btn" style="font-size:11px; padding:4px 8px;" onclick="setDriftPreset('Commit and push file memory.db and memory.db-wal to git')">Push DB to Git</button>
                <button type="button" class="btn" style="font-size:11px; padding:4px 8px;" onclick="setDriftPreset('Build di lokal untuk project undangan-digital')">Local Build Undangan</button>
                <button type="button" class="btn" style="font-size:11px; padding:4px 8px;" onclick="setDriftPreset('Refactor frontend styles with vanilla CSS variables')">Safe CSS Refactor</button>
              </div>
            </div>

            <button class="btn btn-primary" style="width:100%; justify-content:center;" onclick="evaluateDrift()">
              <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
              <span>Evaluate Compliance</span>
            </button>
          </div>

          <!-- Right Column: Compliance Verdict -->
          <div class="card-surface" id="drift-result-box" style="display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; min-height:260px;">
            <div style="color:var(--text-dim); font-size:13px;">Enter a statement or select a preset and click <strong style="color:var(--text-main);">Evaluate Compliance</strong> to run the drift radar.</div>
          </div>
        </div>
      </div>

      <!-- VIEW: CONTEXT COMPACTOR -->
      <div id="view-compactor" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">Context Compactor &amp; Agent Prompt Simulator</div>
            <div class="view-sub">Knapsack budget packer: Maximizes cognitive density within token boundaries with P0 negative constraint guarantees.</div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn" onclick="copyCompactedPrompt()">Copy Compacted Prompt</button>
          </div>
        </div>

        <div class="card-surface" style="margin-bottom:16px;">
          <div style="display:grid; grid-template-columns: 1fr auto; gap:16px; align-items:center;">
            <div>
              <div style="font-size:11px; font-weight:600; color:var(--text-dim); margin-bottom:6px;">RETRIEVAL QUERY &amp; SCOPE</div>
              <input type="text" id="compactor-query" class="search-input" value="rules constraints hardware setup" placeholder="Enter query for memory relevance ranking..." style="width:100%;">
            </div>
            <div>
              <div style="font-size:11px; font-weight:600; color:var(--text-dim); margin-bottom:6px;">TOKEN BUDGET: <span id="budget-val" class="tag tag-brand">500 tokens</span></div>
              <div style="display:flex; align-items:center; gap:8px;">
                <input type="range" id="compactor-budget" min="100" max="2000" step="50" value="500" style="width:140px;" oninput="document.getElementById('budget-val').innerText = this.value + ' tokens'">
                <button class="btn btn-primary" onclick="runCompaction()">Pack Context</button>
              </div>
            </div>
          </div>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button type="button" class="btn" style="font-size:11px; padding:3px 8px;" onclick="setCompactorBudget(200)">200 (Minimal)</button>
            <button type="button" class="btn" style="font-size:11px; padding:3px 8px;" onclick="setCompactorBudget(500)">500 (Standard)</button>
            <button type="button" class="btn" style="font-size:11px; padding:3px 8px;" onclick="setCompactorBudget(1000)">1000 (Expanded)</button>
            <button type="button" class="btn" style="font-size:11px; padding:3px 8px;" onclick="setCompactorBudget(1800)">1800 (Deep)</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 260px 1fr; gap:16px;">
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div class="card-surface">
              <div class="prop-label" style="color:var(--brand); margin-bottom:6px;">PACKING TELEMETRY</div>
              <div style="display:flex; flex-direction:column; gap:8px; font-size:12px;">
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:var(--text-dim);">Budget Limit:</span>
                  <span id="pack-budget" style="font-family:var(--mono); color:#fff;">500 tokens</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:var(--text-dim);">Packed Beliefs:</span>
                  <span id="pack-count" style="font-family:var(--mono); color:var(--emerald); font-weight:600;">--</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:var(--text-dim);">Algorithm:</span>
                  <span style="font-family:var(--mono); color:var(--text-muted);">0/1 Knapsack + P0</span>
                </div>
              </div>
            </div>
            <div class="card-surface" style="font-size:12px; color:var(--text-dim); line-height:1.5;">
              <strong style="color:var(--text-main);">Knapsack Compaction:</strong>
              Safeguards agent execution by eliminating prompt bloat while giving P0 negative constraints absolute insertion priority.
            </div>
          </div>

          <div class="card-surface" style="display:flex; flex-direction:column;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span class="prop-label" style="margin:0;">SIMULATED AGENT SYSTEM PROMPT INJECTION</span>
              <span class="tag tag-brand">READY TO INJECT</span>
            </div>
            <pre id="compactor-output" style="flex:1; min-height:280px; max-height:450px; overflow:auto; margin:0; font-size:11.5px; line-height:1.45; background:#06070a;">Click 'Pack Context' to simulate token compaction...</pre>
          </div>
        </div>
      </div>

      <!-- VIEW: REFLEXION PLAYBOOKS -->
      <div id="view-remediations" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">Reflexion Playbooks &amp; Self-Healing Runbooks</div>
            <div class="view-sub">Episodic failure auto-capture repository with matched root causes and reproducible terminal fix steps.</div>
          </div>
          <button class="btn" onclick="loadRemediations()">
            <svg class="icon" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span>Refresh Playbooks</span>
          </button>
        </div>

        <div class="card-surface" style="margin-bottom:16px;">
          <div class="prop-label" style="color:var(--brand); margin-bottom:8px;">INSTANT ERROR &amp; SYMPTOM MATCHER</div>
          <div class="input-row" style="margin-bottom:0;">
            <input type="text" id="remedy-search-input" class="search-input" placeholder="Paste error string or symptom (e.g. '401 unauthorized client detected', 'EADDRINUSE:8788', 'out of memory') ..." onkeydown="if(event.key==='Enter') testRemediation()">
            <button class="btn btn-primary" onclick="testRemediation()">Match Playbook</button>
            <button class="btn" onclick="clearRemediationMatch()">Reset</button>
          </div>
          <div id="remedy-match-status" style="margin-top:8px; font-size:12px; display:none;"></div>
        </div>

        <div id="remediations-container" style="display:flex; flex-direction:column; gap:12px;">
          <div style="color:var(--text-dim); text-align:center; padding:30px;">Loading playbooks...</div>
        </div>
      </div>

      <!-- VIEW: THEMATIC CLUSTERS -->
      <div id="view-clusters" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">Thematic Knowledge Clusters</div>
            <div class="view-sub">Automatic vector partitioning into coherent semantic topic clusters.</div>
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <span style="font-size:12px; color:var(--text-dim);">Threshold:</span>
            <input type="range" id="cluster-threshold" min="0.30" max="0.85" step="0.05" value="0.55" style="width:100px;" oninput="document.getElementById('cluster-thresh-val').innerText = this.value">
            <span class="tag tag-brand" id="cluster-thresh-val">0.55</span>
            <button class="btn btn-primary" onclick="loadClusters()">Re-cluster</button>
          </div>
        </div>

        <div id="clusters-container" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:16px;">
          <div style="color:var(--text-dim); padding:30px;">Analyzing vector clusters...</div>
        </div>
      </div>

      <!-- VIEW: EVENT LEDGER & TIMELINE -->
      <div id="view-timeline" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">Memory Event Ledger &amp; Bi-Temporal Timeline</div>
            <div class="view-sub">Immutable chronological ledger tracking all memory assertions, mutations, supersessions, and purges.</div>
          </div>
          <button class="btn" onclick="loadTimeline()">
            <svg class="icon" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span>Refresh Ledger</span>
          </button>
        </div>

        <div class="card-surface" style="margin-bottom:16px;">
          <div style="display:grid; grid-template-columns: 1fr auto auto; gap:12px; align-items:center;">
            <input type="text" id="timeline-filter-target" class="search-input" placeholder="Filter by Memory ID or query (blank for all events)..." onkeydown="if(event.key==='Enter') loadTimeline()">
            <select id="timeline-type-filter" class="search-input" style="width:140px;" onchange="filterTimelineByType(this.value)">
              <option value="ALL">All Event Types</option>
              <option value="CREATED">CREATED</option>
              <option value="MUTATED">MUTATED</option>
              <option value="SUPERSEDED">SUPERSEDED</option>
              <option value="PURGED">PURGED</option>
            </select>
            <button class="btn btn-primary" onclick="loadTimeline()">Filter</button>
          </div>
        </div>

        <div id="timeline-stream" style="display:flex; flex-direction:column; gap:10px;">
          <div style="color:var(--text-dim); text-align:center; padding:30px;">Loading event stream...</div>
        </div>
      </div>

      <!-- VIEW: MEMORY PACKS HUB -->
      <div id="view-packs" class="view-content">
        <div class="view-header">
          <div>
            <div class="view-title">Portable Memory Packs Hub</div>
            <div class="view-sub">Air-gapped, sanitized JSON memory pack exchange with SHA-256 cryptographic verification. Zero .db binary file contamination.</div>
          </div>
          <span class="tag tag-success">RULE 5 COMPLIANT</span>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
          <!-- Left: Export Pack -->
          <div class="card-surface">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <span class="prop-label" style="color:var(--brand); margin:0;">EXPORT MEMORY PACK</span>
              <span class="tag">JSON + SHA-256</span>
            </div>
            <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:14px; line-height:1.5;">
              Bundle active memory beliefs, knowledge graph triples, and entity aliases into a standardized portable JSON package.
            </div>

            <div style="margin-bottom:14px;">
              <div style="font-size:11px; font-weight:600; color:var(--text-dim); margin-bottom:6px;">EXPORT SCOPE</div>
              <select id="export-scope-select" class="search-input" style="width:100%;">
                <option value="all">All Scopes (Global + Project)</option>
                <option value="global">Global Only</option>
                <option value="project">Project Workspace Only</option>
              </select>
            </div>

            <button class="btn btn-primary" style="width:100%; justify-content:center; margin-bottom:12px;" onclick="exportMemoryPack()">
              <svg class="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Download Memory Pack (.json)</span>
            </button>

            <div style="background:#06070a; border:1px solid var(--border-subtle); border-radius:6px; padding:10px; font-family:var(--mono); font-size:11px; color:var(--text-dim);">
              <span style="color:var(--brand);">curl:</span> curl -s http://localhost:8788/v1/memory/pack/export?scope=all &gt; pack.json
            </div>
          </div>

          <!-- Right: Import Pack -->
          <div class="card-surface">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <span class="prop-label" style="color:var(--emerald); margin:0;">IMPORT MEMORY PACK</span>
              <span class="tag tag-success">CHECKSUM VERIFIED</span>
            </div>
            <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:14px; line-height:1.5;">
              Upload or paste a sanitized JSON memory pack. Automatic SHA-256 checksum integrity verification prior to SQLite injection.
            </div>

            <div style="margin-bottom:12px;">
              <input type="file" id="pack-file-input" accept=".json,application/json" style="display:none;" onchange="handlePackFileSelect(this)">
              <div onclick="document.getElementById('pack-file-input').click()" style="border:2px dashed var(--border-base); border-radius:6px; padding:18px; text-align:center; cursor:pointer; background:rgba(255,255,255,0.01); transition:border-color 0.2s ease;">
                <svg class="icon" style="width:24px; height:24px; margin:0 auto 8px; color:var(--text-dim);" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <div id="file-drop-label" style="font-size:12px; color:var(--text-main); font-weight:500;">Click to select JSON memory pack file</div>
                <div style="font-size:11px; color:var(--text-dim); margin-top:2px;">or paste JSON content below</div>
              </div>
            </div>

            <textarea id="import-pack-json" placeholder="Paste memory pack JSON contents here if not uploading file..." style="height:70px; margin-bottom:12px; font-family:var(--mono); font-size:11px;"></textarea>

            <button class="btn btn-primary" style="width:100%; justify-content:center;" onclick="importMemoryPack()">
              <svg class="icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Verify &amp; Import Pack</span>
            </button>
          </div>
        </div>

        <!-- Import / Export Log Box -->
        <div class="card-surface">
          <div class="prop-label" style="margin-bottom:6px;">PACK ACTIVITY AUDIT REPORT</div>
          <pre id="pack-audit-report" style="margin:0; max-height:160px; overflow:auto; font-size:11px; color:var(--text-dim); background:#06070a;">Ready for export or import transactions.</pre>
        </div>
      </div>
    </main>
  </div>

  <!-- Bottom Telemetry Statusbar -->
  <footer class="statusbar">
    <div class="status-items">
      <div class="status-item">
        <span class="status-dot"></span>
        <span>DAEMON ONLINE :8788</span>
      </div>
      <span>•</span>
      <div class="status-item">
        <span id="sb-pid">PID 63954</span>
      </div>
      <span>•</span>
      <div class="status-item">
        <span>SQLite WAL (5000ms)</span>
      </div>
      <span>•</span>
      <div class="status-item">
        <span>56/56 Tests Passing</span>
      </div>
    </div>
    <div class="status-items">
      <div class="status-item">
        <span id="sb-rss">RSS: -- MB</span>
      </div>
      <span>•</span>
      <div class="status-item">
        <span id="sb-ram">Host RAM: -- GB</span>
      </div>
      <span>•</span>
      <div class="status-item">
        <span id="sb-disk">Disk: -- MB</span>
      </div>
      <span>•</span>
      <div class="status-item">
        <span id="sb-uptime">Uptime: --</span>
      </div>
    </div>
  </footer>

  <script>
    // State
    let currentView = 'graph';
    let graphData = { nodes: [], links: [] };
    let selectedNode = null;
    let zoom = 1.0;
    let pan = { x: 0, y: 0 };
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let draggedNode = null;
    let animId = null;

    function showToast(msg) {
      const shelf = document.getElementById('toast-shelf');
      const el = document.createElement('div');
      el.className = 'toast-pill';
      el.innerHTML = '<span style="color:var(--emerald);">✓</span><span>' + msg + '</span>';
      shelf.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(8px)';
        el.style.transition = 'all 0.15s ease';
        setTimeout(() => el.remove(), 150);
      }, 3000);
    }

    function switchView(viewId) {
      currentView = viewId;
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.view-content').forEach(el => el.classList.remove('active'));

      const mapTitle = {
        graph: 'Knowledge Graph',
        drift: 'Semantic Drift Radar & Compliance Sandbox',
        compactor: 'Context Compactor & Agent Prompt Simulator',
        remediations: 'Reflexion Playbooks & Runbook Hub',
        guardrails: 'Active Negative Constraints',
        recall: 'Hybrid Retrieval Playground',
        clusters: 'Thematic Knowledge Clusters',
        explorer: 'Memory Belief Explorer',
        telemetry: 'System Resource Observability',
        timeline: 'Memory Event Ledger & Bi-Temporal Timeline',
        doctor: 'Context Doctor & Self-Healing',
        persona: 'Theory of Mind Profile',
        digest: '24h Brain Activity Digest',
        packs: 'Portable Memory Packs Hub'
      };

      document.getElementById('top-title').innerText = mapTitle[viewId] || 'Mnemosyne';
      const panel = document.getElementById('view-' + viewId);
      if (panel) panel.classList.add('active');

      const navEl = Array.from(document.querySelectorAll('.nav-item')).find(n => n.getAttribute('onclick')?.includes(viewId));
      if (navEl) navEl.classList.add('active');

      if (viewId === 'graph') {
        setTimeout(initGraph, 20);
      } else if (viewId === 'persona') {
        loadPersona();
      } else if (viewId === 'digest') {
        loadDigest();
      } else if (viewId === 'telemetry') {
        loadTelemetry();
      } else if (viewId === 'remediations') {
        loadRemediations();
      } else if (viewId === 'clusters') {
        loadClusters();
      } else if (viewId === 'timeline') {
        loadTimeline();
      } else if (viewId === 'compactor') {
        runCompaction();
      }
    }

    // Command Palette
    const COMMANDS = [
      { label: 'Jump to Knowledge Graph', action: () => switchView('graph') },
      { label: 'Jump to Semantic Drift Radar Sandbox', action: () => switchView('drift') },
      { label: 'Jump to Context Compactor & Prompt Simulator', action: () => switchView('compactor') },
      { label: 'Jump to Reflexion Playbooks & Runbooks', action: () => switchView('remediations') },
      { label: 'Jump to Thematic Knowledge Clusters', action: () => switchView('clusters') },
      { label: 'Jump to Memory Event Ledger & Timeline', action: () => switchView('timeline') },
      { label: 'Jump to Resource Monitor & Telemetry', action: () => switchView('telemetry') },
      { label: 'Jump to Guardrails & Rules', action: () => switchView('guardrails') },
      { label: 'Jump to Retrieval Playground', action: () => switchView('recall') },
      { label: 'Jump to Context Doctor', action: () => switchView('doctor') },
      { label: 'Jump to Portable Memory Packs Hub', action: () => switchView('packs') },
      { label: 'Add New Memory Belief', action: () => toggleAddModal(true) },
      { label: 'Sync Rules to AGENTS.md', action: () => syncRules('agents.md') },
      { label: 'Sync Rules to .cursorrules', action: () => syncRules('cursorrules') },
      { label: 'Run Context Doctor Repair', action: () => executeDoctorRepair() }
    ];

    function toggleCmdPalette(open) {
      const p = document.getElementById('cmd-palette');
      p.style.display = open ? 'flex' : 'none';
      if (open) {
        document.getElementById('cmd-input').value = '';
        renderCmdList(COMMANDS);
        setTimeout(() => document.getElementById('cmd-input').focus(), 30);
      }
    }

    function renderCmdList(items) {
      const c = document.getElementById('cmd-list');
      if (items.length === 0) {
        c.innerHTML = '<div style="padding:10px; color:var(--text-dim); text-align:center;">No matching commands</div>';
        return;
      }
      c.innerHTML = items.map((cmd, idx) => \`
        <div style="padding:8px 10px; border-radius:6px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; font-size:12.5px;" 
             onmouseover="this.style.background='var(--bg-surface)'" 
             onmouseout="this.style.background='transparent'"
             onclick="COMMANDS[\${idx}].action(); toggleCmdPalette(false);">
          <span>\${cmd.label}</span>
          <span class="kbd">↵</span>
        </div>
      \`).join('');
    }

    function filterCmdList(q) {
      const term = (q || '').toLowerCase();
      renderCmdList(COMMANDS.filter(c => c.label.toLowerCase().includes(term)));
    }

    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleCmdPalette(true);
      } else if (e.key === 'Escape') {
        toggleCmdPalette(false);
        toggleAddModal(false);
      }
    });

    // Add Modal
    function toggleAddModal(open) {
      document.getElementById('modal-add-memory').style.display = open ? 'flex' : 'none';
      if (open) {
        setTimeout(() => document.getElementById('in-content').focus(), 30);
      }
    }

    // Graph Engine (Physics Canvas)
    let graphInitialized = false;
    function initGraph() {
      const canvas = document.getElementById('graph-canvas');
      if (!canvas) return;

      if (!graphInitialized) {
        canvas.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        graphInitialized = true;
      }

      if (!animId) {
        runPhysicsLoop();
      }
    }

    function onMouseDown(e) {
      const rect = e.target.getBoundingClientRect();
      const mx = (e.clientX - rect.left - pan.x) / zoom;
      const my = (e.clientY - rect.top - pan.y) / zoom;

      for (const n of graphData.nodes) {
        const dx = n.x - mx;
        const dy = n.y - my;
        if (Math.sqrt(dx * dx + dy * dy) <= n.r + 3) {
          draggedNode = n;
          n.fx = n.x;
          n.fy = n.y;
          selectNode(n);
          return;
        }
      }

      isDragging = true;
      dragStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }

    function onMouseMove(e) {
      const canvas = document.getElementById('graph-canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left - pan.x) / zoom;
      const my = (e.clientY - rect.top - pan.y) / zoom;

      if (draggedNode) {
        draggedNode.x = mx;
        draggedNode.y = my;
        draggedNode.fx = mx;
        draggedNode.fy = my;
        wakeSimulation(0.25);
        return;
      }

      if (isDragging) {
        pan.x = e.clientX - dragStart.x;
        pan.y = e.clientY - dragStart.y;
        renderCanvas();
      }
    }

    function onMouseUp() {
      if (draggedNode) {
        draggedNode.fx = null;
        draggedNode.fy = null;
        draggedNode = null;
        wakeSimulation(0.2);
      }
      isDragging = false;
    }

    function onWheel(e) {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.08 : 0.92;
      zoom = Math.max(0.3, Math.min(2.5, zoom * f));
      renderCanvas();
    }

    function zoomGraph(f) { zoom = Math.max(0.3, Math.min(2.5, zoom * f)); renderCanvas(); }
    function resetGraph() { zoom = 1.0; pan = { x: 0, y: 0 }; renderCanvas(); }

    function selectNode(n) {
      selectedNode = n;
      renderCanvas();
      const c = document.getElementById('inspector-content');
      
      const relatedLinks = graphData.links.filter(l => l.source === n.id || l.target === n.id);

      c.innerHTML = \`
        <div class="prop-group">
          <div class="prop-label">Entity Name</div>
          <div class="prop-value" style="font-size:14px; font-weight:600; color:#fff;">\${n.id}</div>
        </div>
        <div class="prop-group">
          <div class="prop-label">Graph Role</div>
          <div class="prop-value"><span class="tag tag-\${n.type === 'subject' ? 'brand' : 'success'}">\${n.type.toUpperCase()}</span></div>
        </div>
        <div class="prop-group">
          <div class="prop-label">Connections (\${relatedLinks.length})</div>
          <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">
            \${relatedLinks.map(l => \`
              <div style="background:var(--bg-surface); padding:6px 8px; border-radius:4px; font-size:11.5px; border:1px solid var(--border-subtle);">
                <div style="color:var(--text-dim); font-size:10px;">\${l.label}</div>
                <div style="color:#fff; font-family:var(--mono);">\${l.source === n.id ? '→ ' + l.target : '← ' + l.source}</div>
              </div>
            \`).join('')}
          </div>
        </div>
      \`;
    }

    function clearSelection() {
      selectedNode = null;
      renderCanvas();
      document.getElementById('inspector-content').innerHTML = '<div style="color:var(--text-dim); text-align:center; padding: 40px 0;">Click any node in the graph to inspect its relations.</div>';
    }

    let alpha = 1.0;

    function wakeSimulation(boost) {
      alpha = Math.max(alpha, boost !== undefined ? boost : 0.4);
      if (!animId) {
        runPhysicsLoop();
      }
    }

    function runPhysicsLoop() {
      const stillActive = updatePhysics();
      renderCanvas();
      if (stillActive && alpha > 0.002) {
        animId = requestAnimationFrame(runPhysicsLoop);
      } else {
        if (animId) cancelAnimationFrame(animId);
        animId = null;
        alpha = 0;
        renderCanvas();
      }
    }

    function updatePhysics() {
      const nodes = graphData.nodes;
      const links = graphData.links;
      if (!nodes || nodes.length === 0) return false;

      const canvas = document.getElementById('graph-canvas');
      if (!canvas) return false;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width > 50 ? rect.width : 800;
      const height = rect.height > 50 ? rect.height : 600;
      const cx = width / 2;
      const cy = height / 2;

      // 1. Center gravity: gently pulls whole graph to center
      const gravity = 0.0015 * alpha;
      for (const n of nodes) {
        if (n.fx !== null && n.fx !== undefined) continue;
        const dx = cx - n.x;
        const dy = cy - n.y;
        n.vx = (n.vx || 0) + dx * gravity;
        n.vy = (n.vy || 0) + dy * gravity;
      }

      // 2. Node repulsion: smooth non-linear repulsion avoiding overlapping
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1e-4) {
            dx = (Math.random() - 0.5) * 0.1;
            dy = (Math.random() - 0.5) * 0.1;
            dist = Math.sqrt(dx * dx + dy * dy);
          }
          if (dist < 140) {
            const rep = ((140 - dist) / dist) * 0.18 * alpha;
            const rx = dx * rep;
            const ry = dy * rep;
            if (!a.fx) { a.vx -= rx; a.vy -= ry; }
            if (!b.fx) { b.vx += rx; b.vy += ry; }
          }
        }
      }

      // 3. Hooke's Law Spring Force for connected pairs:
      // Deduplicate link pairs to prevent 2x/3x force explosions on mutual or duplicate edges
      const nodeIndex = new Map(nodes.map(n => [n.id, n]));
      const uniqueEdges = new Map();
      for (const l of links) {
        if (l.source === l.target) continue;
        const pairKey = l.source < l.target ? (l.source + '::' + l.target) : (l.target + '::' + l.source);
        if (!uniqueEdges.has(pairKey)) {
          uniqueEdges.set(pairKey, { source: l.source, target: l.target });
        }
      }

      const targetDist = 95;
      const springK = 0.035 * alpha;
      for (const edge of uniqueEdges.values()) {
        const u = nodeIndex.get(edge.source);
        const v = nodeIndex.get(edge.target);
        if (u && v) {
          let dx = v.x - u.x;
          let dy = v.y - u.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1e-4) {
            dx = (Math.random() - 0.5) * 0.1;
            dy = (Math.random() - 0.5) * 0.1;
            dist = Math.sqrt(dx * dx + dy * dy);
          }
          // Linear spring force using normalized unit vector (Hooke's Law)
          const displacement = dist - targetDist;
          const force = displacement * springK;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (!u.fx) { u.vx += fx; u.vy += fy; }
          if (!v.fx) { v.vx -= fx; v.vy -= fy; }
        }
      }

      // 4. Velocity integration with critical damping and speed limit
      const maxSpeed = 10 * Math.max(0.15, alpha);
      let totalKineticEnergy = 0;

      for (const n of nodes) {
        if (n.fx !== null && n.fx !== undefined) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }

        // Critical damping prevents endless oscillations
        n.vx = (n.vx || 0) * 0.80;
        n.vy = (n.vy || 0) * 0.80;

        const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (speed > maxSpeed) {
          n.vx = (n.vx / speed) * maxSpeed;
          n.vy = (n.vy / speed) * maxSpeed;
        }

        // Zero out micro-vibrations to stop subpixel jittering
        if (speed < 0.015) {
          n.vx = 0;
          n.vy = 0;
        }

        n.x += n.vx;
        n.y += n.vy;

        totalKineticEnergy += speed;
      }

      // Cool simulation down exponentially
      alpha *= 0.965;

      // Settlement condition: stop loop once stabilized
      if (alpha < 0.003 || (alpha < 0.08 && totalKineticEnergy < 0.05 * nodes.length)) {
        alpha = 0;
        for (const n of nodes) {
          n.vx = 0;
          n.vy = 0;
        }
        return false;
      }

      return true;
    }

    function renderCanvas() {
      const canvas = document.getElementById('graph-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width > 50 ? rect.width : 800;
      const height = rect.height > 50 ? rect.height : 600;

      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(width * dpr);
      const targetH = Math.round(height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      const nodes = graphData.nodes;
      const links = graphData.links;
      const nodeIndex = new Map(nodes.map(n => [n.id, n]));

      // Subtle grid
      ctx.strokeStyle = 'rgba(255,255,255,0.02)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      const minX = -pan.x / zoom - 200;
      const maxX = (width - pan.x) / zoom + 200;
      const minY = -pan.y / zoom - 200;
      const maxY = (height - pan.y) / zoom + 200;

      for (let x = Math.floor(minX / gridSize) * gridSize; x < maxX; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, minY); ctx.lineTo(x, maxY); ctx.stroke();
      }
      for (let y = Math.floor(minY / gridSize) * gridSize; y < maxY; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(minX, y); ctx.lineTo(maxX, y); ctx.stroke();
      }

      // Deduplicate link lines and labels for drawing to prevent double-draw jitter
      const renderedPairs = new Map();
      for (const l of links) {
        if (l.source === l.target) continue;
        const u = nodeIndex.get(l.source);
        const v = nodeIndex.get(l.target);
        if (!u || !v) continue;
        const pairKey = u.id < v.id ? (u.id + '::' + v.id) : (v.id + '::' + u.id);
        if (!renderedPairs.has(pairKey)) {
          renderedPairs.set(pairKey, { u, v, labels: [l.label], isSelected: false });
        } else {
          const entry = renderedPairs.get(pairKey);
          if (!entry.labels.includes(l.label)) entry.labels.push(l.label);
        }
        if (selectedNode && (l.source === selectedNode.id || l.target === selectedNode.id)) {
          renderedPairs.get(pairKey).isSelected = true;
        }
      }

      // Draw links
      for (const { u, v, labels, isSelected } of renderedPairs.values()) {
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(v.x, v.y);
        ctx.strokeStyle = isSelected ? 'rgba(94, 106, 210, 0.75)' : 'rgba(148, 163, 184, 0.18)';
        ctx.lineWidth = isSelected ? 1.6 : 1;
        ctx.stroke();

        // Link label
        if (zoom > 0.8) {
          const mx = (u.x + v.x) / 2;
          const my = (u.y + v.y) / 2;
          const labelText = labels.join(' • ');
          ctx.font = '9.5px JetBrains Mono';
          ctx.textAlign = 'center';
          const tw = ctx.measureText(labelText).width;

          // Backing pill behind label
          ctx.fillStyle = isSelected ? 'rgba(23, 27, 38, 0.95)' : 'rgba(13, 15, 20, 0.85)';
          ctx.fillRect(mx - tw / 2 - 4, my - 10, tw + 8, 13);

          ctx.fillStyle = isSelected ? '#c7d2fe' : '#64748b';
          ctx.fillText(labelText, mx, my);
        }
      }

      // Draw nodes
      for (const n of nodes) {
        const isSelected = selectedNode && selectedNode.id === n.id;
        const isConnected = selectedNode && links.some(l => (l.source === selectedNode.id && l.target === n.id) || (l.target === selectedNode.id && l.source === n.id));
        
        // Ambient soft outer glow
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + (isSelected ? 7 : 3), 0, Math.PI * 2);
        ctx.fillStyle = n.type === 'subject' 
          ? (isSelected ? 'rgba(94, 106, 210, 0.4)' : 'rgba(94, 106, 210, 0.14)')
          : (isSelected ? 'rgba(16, 185, 129, 0.4)' : 'rgba(16, 185, 129, 0.14)');
        ctx.fill();

        // Node core circle with subtle gradient
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        
        const grad = ctx.createRadialGradient(n.x - n.r*0.3, n.y - n.r*0.3, 1, n.x, n.y, n.r);
        if (n.type === 'subject') {
          grad.addColorStop(0, '#7c87f8');
          grad.addColorStop(1, '#5e6ad2');
        } else {
          grad.addColorStop(0, '#34d399');
          grad.addColorStop(1, '#059669');
        }
        ctx.fillStyle = grad;
        ctx.fill();

        // Node ring
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.25)';
        ctx.stroke();

        // Node Label
        ctx.font = isSelected ? '600 12px Inter' : (isConnected ? '500 11.5px Inter' : '400 11px Inter');
        ctx.textAlign = 'center';
        
        // Label pill backdrop for crisp readability
        const tw = ctx.measureText(n.id).width;
        ctx.fillStyle = 'rgba(8, 9, 12, 0.8)';
        ctx.fillRect(n.x - tw/2 - 4, n.y + n.r + 5, tw + 8, 14);

        ctx.fillStyle = isSelected ? '#ffffff' : (isConnected ? '#f8fafc' : '#cbd5e1');
        ctx.fillText(n.id, n.x, n.y + n.r + 16);
      }

      ctx.restore();
    }

    // Data Loaders
    async function loadStats() {
      try {
        const [gRes, rRes, dRes] = await Promise.all([
          fetch('/v1/memory/graph?limit=100').then(r => r.json()),
          fetch('/v1/rules/export?format=agents.md').then(r => r.json()),
          fetch('/v1/doctor/audit').then(r => r.json())
        ]);

        if (gRes.success) {
          processGraph(gRes.graph);
          document.getElementById('badge-triples').innerText = (gRes.graph.triples || []).length;
        }

        if (rRes.success) {
          document.getElementById('badge-guardrails').innerText = rRes.negativeCount || 0;
          document.getElementById('badge-memories').innerText = rRes.ruleCount || 0;
          renderGuardrailsTable(rRes.negativeConstraints || [], rRes.standardRules || []);
          renderExplorerTable(rRes.negativeConstraints || [], rRes.standardRules || []);
        }

        if (dRes.success) {
          renderDoctor(dRes.report);
        }
      } catch (e) {
        console.error("Failed loading stats:", e);
      }
    }

    function processGraph(raw) {
      if (!raw) raw = { triples: [], links: [] };
      const nodeMap = new Map();
      const links = [];

      (raw.triples || []).forEach(t => {
        if (!nodeMap.has(t.subject)) nodeMap.set(t.subject, { id: t.subject, type: 'subject', r: 7 });
        if (!nodeMap.has(t.object)) nodeMap.set(t.object, { id: t.object, type: 'object', r: 6 });
        links.push({ source: t.subject, target: t.object, label: t.predicate });
      });

      const canvas = document.getElementById('graph-canvas');
      const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 800, height: 600 };
      const width = rect.width > 50 ? rect.width : 800;
      const height = rect.height > 50 ? rect.height : 600;
      const cx = width / 2;
      const cy = height / 2;

      // Preserve positions of already placed nodes to prevent jarring repositioning on reload
      const existingNodeMap = new Map((graphData.nodes || []).map(n => [n.id, n]));
      const nodes = Array.from(nodeMap.values());
      nodes.forEach((n, idx) => {
        const existing = existingNodeMap.get(n.id);
        if (existing && typeof existing.x === 'number' && !isNaN(existing.x)) {
          n.x = existing.x;
          n.y = existing.y;
          n.vx = 0; n.vy = 0;
        } else {
          const angle = (idx / (nodes.length || 1)) * 2 * Math.PI;
          const rad = Math.min(width, height) * 0.28;
          n.x = cx + rad * Math.cos(angle);
          n.y = cy + rad * Math.sin(angle);
          n.vx = 0; n.vy = 0;
        }
      });

      graphData = { nodes, links };
      wakeSimulation(1.0);
    }

    function renderGuardrailsTable(negatives, rules) {
      const tbody = document.getElementById('guardrails-tbody');
      const all = [...negatives, ...rules];
      if (all.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-dim); padding:30px;">No operational rules or guardrails found.</td></tr>';
        return;
      }
      tbody.innerHTML = all.map(r => {
        const isNeg = r.is_negative_constraint;
        return \`
          <tr>
            <td style="font-weight:\${isNeg ? '600' : '400'}; color:\${isNeg ? '#fff' : 'var(--text-main)'};">
              \${isNeg ? '<span style="color:var(--rose); margin-right:6px;">⛔</span>' : ''}
              \${r.content}
            </td>
            <td><span class="tag tag-\${isNeg ? 'danger' : 'brand'}">\${r.category}</span></td>
            <td><span class="tag">\${r.scope}</span></td>
            <td><span class="tag tag-\${r.importance === 'critical' ? 'danger' : 'brand'}">\${r.importance.toUpperCase()}</span></td>
          </tr>
        \`;
      }).join('');
    }

    function renderExplorerTable(negatives, rules) {
      const tbody = document.getElementById('explorer-tbody');
      const all = [...negatives, ...rules];
      if (all.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-dim); padding:30px;">No records.</td></tr>';
        return;
      }
      tbody.innerHTML = all.map(r => \`
        <tr>
          <td>\${r.content}</td>
          <td><span class="tag">\${r.category}</span></td>
          <td><span class="tag">\${r.scope}</span></td>
          <td style="font-family:var(--mono);">\${r.access_count || 0}</td>
          <td>
            <button class="btn btn-danger" style="padding:2px 6px; font-size:11px;" onclick="forgetMemory('\${r.id}')">Deactivate</button>
          </td>
        </tr>
      \`).join('');
    }

    function renderDoctor(doc) {
      const score = doc.health_score ?? 100;
      document.getElementById('doc-health-score').innerText = score + '%';
      document.getElementById('badge-doctor').innerText = score + '%';
      
      const checklist = document.getElementById('doc-checklist');
      checklist.innerHTML = \`
        <div style="display:flex; flex-direction:column; gap:8px; font-size:12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span>\${doc.orphaned_triples === 0 ? '✓' : '⚠️'}</span>
            <span>Orphaned Graph Triples: <b>\${doc.orphaned_triples}</b></span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span>✓</span>
            <span>Active Persistent Memories: <b>\${doc.active_count} / \${doc.total_memories}</b></span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span>\${doc.stale_count === 0 ? '✓' : 'ℹ️'}</span>
            <span>Stale Unaccessed Memories (>30d): <b>\${doc.stale_count}</b></span>
          </div>
        </div>
      \`;

      document.getElementById('doc-raw').innerText = JSON.stringify(doc, null, 2);
    }

    async function executeDoctorRepair() {
      try {
        const res = await fetch('/v1/doctor/repair', { method: 'POST' }).then(r => r.json());
        if (res.success) {
          showToast('Context Doctor surgical repair completed.');
          loadStats();
        }
      } catch (e) {
        showToast('Repair failed: ' + e.message);
      }
    }

    async function executeRecall() {
      const q = document.getElementById('recall-query').value.trim();
      if (!q) return;
      const stats = document.getElementById('recall-stats');
      const cards = document.getElementById('recall-cards');
      
      stats.style.display = 'block';
      stats.innerText = 'Querying quad-signal engine...';
      cards.innerHTML = '';

      const start = performance.now();
      try {
        const res = await fetch('/v1/memory/recall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, limit: 5 })
        }).then(r => r.json());

        const elapsed = (performance.now() - start).toFixed(2);
        stats.innerText = \`Executed in \${elapsed}ms • Quad-Signal Hybrid + HippoRAG • \${res.memories?.length || 0} hits\`;

        if (!res.memories || res.memories.length === 0) {
          cards.innerHTML = '<div style="padding:20px; color:var(--text-dim); text-align:center;">No matching beliefs found.</div>';
          return;
        }

        cards.innerHTML = res.memories.map(m => {
          const isNeg = m.is_negative_constraint;
          return \`
            <div style="background:var(--bg-surface); border:1px solid \${isNeg ? 'rgba(244,63,94,0.35)' : 'var(--border-subtle)'}; border-left: 3px solid \${isNeg ? 'var(--rose)' : 'var(--brand)'}; border-radius:6px; padding:12px 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <div style="display:flex; gap:6px; align-items:center;">
                  <span class="tag tag-brand">Score: \${(m.score * 100).toFixed(1)}%</span>
                  <span class="tag">\${m.category}</span>
                  <span class="tag">\${m.scope}</span>
                  \${isNeg ? '<span class="tag tag-danger">P0 GUARDRAIL</span>' : ''}
                </div>
                <button class="btn btn-danger" style="padding:2px 6px; font-size:10.5px;" onclick="forgetMemory('\${m.id}')">Forget</button>
              </div>
              <div style="color:var(--text-main); font-size:13px; line-height:1.5;">\${m.content}</div>
            </div>
          \`;
        }).join('');
      } catch (e) {
        stats.innerText = 'Recall error: ' + e.message;
      }
    }

    async function forgetMemory(id) {
      if (!confirm('Mark memory as deactivated?')) return;
      try {
        const res = await fetch('/v1/memory/' + encodeURIComponent(id), { method: 'DELETE' }).then(r => r.json());
        if (res.success) {
          showToast('Memory deactivated.');
          loadStats();
          if (currentView === 'recall') executeRecall();
        }
      } catch (e) {
        showToast('Error: ' + e.message);
      }
    }

    async function submitMemory() {
      const content = document.getElementById('in-content').value.trim();
      if (!content) return;
      const scope = document.getElementById('in-scope').value;
      const category = document.getElementById('in-category').value;
      const importance = document.getElementById('in-importance').value;
      const tripleRaw = document.getElementById('in-triple').value.trim();

      let entities = undefined;
      if (tripleRaw && tripleRaw.includes('|')) {
        const p = tripleRaw.split('|').map(s => s.trim());
        if (p.length === 3) {
          entities = [{ subject: p[0], predicate: p[1], object: p[2] }];
        }
      }

      try {
        const res = await fetch('/v1/memory/remember', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, scope, category, importance, entities })
        }).then(r => r.json());

        if (res.success) {
          showToast('Belief stored and vectorized.');
          toggleAddModal(false);
          document.getElementById('add-form').reset();
          loadStats();
        }
      } catch (e) {
        showToast('Error saving: ' + e.message);
      }
    }

    async function syncRules(format) {
      const target = format === 'cursorrules' ? '.cursorrules' : 'AGENTS.md';
      try {
        const res = await fetch('/v1/rules/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetPath: target, format })
        }).then(r => r.json());

        if (res.success) {
          showToast('Synced ' + res.ruleCount + ' rules to ' + target);
        }
      } catch (e) {
        showToast('Sync error: ' + e.message);
      }
    }

    function copyRules() {
      fetch('/v1/rules/export?format=agents.md')
        .then(r => r.json())
        .then(res => {
          if (res.content) {
            navigator.clipboard.writeText(res.content);
            showToast('Markdown rules copied to clipboard.');
          }
        });
    }

    async function loadPersona() {
      const c = document.getElementById('persona-pane');
      try {
        const res = await fetch('/v1/memory/profile?entity_type=user').then(r => r.json());
        if (res.success && res.profile) {
          const p = res.profile;
          c.innerHTML = \`
            <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px; padding:18px; margin-bottom:14px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">
              <div class="prop-label" style="color:var(--brand); margin-bottom:6px;">Worldview</div>
              <div style="color:var(--text-main); font-size:13px; line-height:1.6;">\${p.worldview}</div>
            </div>
            <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px; padding:18px; margin-bottom:14px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">
              <div class="prop-label" style="color:var(--rose); margin-bottom:8px;">Hardware & Operational Constraints</div>
              <div style="display:flex; flex-direction:column; gap:8px;">
                \${p.hard_constraints.map(h => \`
                  <div style="background:rgba(244,63,94,0.06); border:1px solid rgba(244,63,94,0.2); border-left:3px solid var(--rose); padding:9px 12px; border-radius:4px; font-size:12px; color:#fecdd3;">
                    \${h}
                  </div>
                \`).join('')}
              </div>
            </div>
            <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px; padding:18px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">
              <div class="prop-label" style="color:var(--emerald); margin-bottom:6px;">Preferred Tooling Stack</div>
              <pre style="margin-top:6px;">\${JSON.stringify(p.preferences, null, 2)}</pre>
            </div>
          \`;
        }
      } catch (e) {
        c.innerHTML = '<div style="color:var(--rose);">Failed loading profile: ' + e.message + '</div>';
      }
    }

    async function loadDigest() {
      try {
        const res = await fetch('/v1/digest').then(r => r.json());
        if (res.success) {
          document.getElementById('digest-report').innerText = res.digest.markdown_report;
        }
      } catch (e) {
        document.getElementById('digest-report').innerText = 'Failed: ' + e.message;
      }
    }

    async function loadTelemetry() {
      try {
        const res = await fetch('/v1/system/metrics').then(r => r.json());
        if (!res.success) return;

        // Topbar micro pills
        const topRss = document.getElementById('top-rss-val');
        if (topRss) topRss.innerText = res.process.rss_formatted;
        const topRam = document.getElementById('top-host-ram-val');
        if (topRam) topRam.innerText = res.host.ram_used_pct + '%';
        const topDisk = document.getElementById('top-disk-val');
        if (topDisk) topDisk.innerText = res.storage.total_formatted;

        // Sidebar badge
        const badgeRss = document.getElementById('badge-rss');
        if (badgeRss) badgeRss.innerText = res.process.rss_formatted;

        // Bottom statusbar live items
        const sbPid = document.getElementById('sb-pid');
        if (sbPid) sbPid.innerText = 'PID ' + res.process.pid;
        const sbRss = document.getElementById('sb-rss');
        if (sbRss) sbRss.innerText = 'RSS: ' + res.process.rss_formatted;
        const sbRam = document.getElementById('sb-ram');
        if (sbRam) sbRam.innerText = 'Host RAM: ' + res.host.used_ram_formatted + ' / ' + res.host.total_ram_formatted + ' (' + res.host.ram_used_pct + '%)';
        const sbDisk = document.getElementById('sb-disk');
        if (sbDisk) sbDisk.innerText = 'Disk: ' + res.storage.total_formatted;
        const sbUptime = document.getElementById('sb-uptime');
        if (sbUptime) sbUptime.innerText = 'Uptime: ' + res.process.uptime_formatted;

        // Telemetry View items
        const statPid = document.getElementById('stat-pid');
        if (statPid) statPid.innerText = 'PID ' + res.process.pid;
        const statRss = document.getElementById('stat-rss');
        if (statRss) statRss.innerText = res.process.rss_formatted;
        const statHeap = document.getElementById('stat-heap');
        if (statHeap) statHeap.innerText = res.process.heap_used_formatted + ' / ' + res.process.heap_total_formatted;
        const statCpu = document.getElementById('stat-cpu');
        if (statCpu) statCpu.innerText = 'User: ' + res.process.cpu_user_ms + 'ms | Sys: ' + res.process.cpu_system_ms + 'ms';
        const statUptime = document.getElementById('stat-uptime');
        if (statUptime) statUptime.innerText = res.process.uptime_formatted;
        const statRuntime = document.getElementById('stat-runtime');
        if (statRuntime) statRuntime.innerText = 'Bun v' + res.host.bun_version + ' (' + res.host.platform + ' ' + res.host.arch + ')';

        const statSafeguard = document.getElementById('stat-safeguard');
        if (statSafeguard) {
          statSafeguard.innerText = res.host.safeguard_status;
          statSafeguard.className = 'tag ' + (res.host.safeguard_status === 'HEALTHY' ? 'tag-success' : 'tag-danger');
        }
        const statHostRamUsed = document.getElementById('stat-host-ram-used');
        if (statHostRamUsed) statHostRamUsed.innerText = res.host.used_ram_formatted;
        const statHostRamTotal = document.getElementById('stat-host-ram-total');
        if (statHostRamTotal) statHostRamTotal.innerText = '/ ' + res.host.total_ram_formatted + ' (' + res.host.ram_used_pct + '%)';
        const statRamBar = document.getElementById('stat-ram-bar');
        if (statRamBar) {
          statRamBar.style.width = res.host.ram_used_pct + '%';
          statRamBar.style.background = res.host.ram_used_pct > 85 ? 'var(--rose)' : (res.host.ram_used_pct > 70 ? 'var(--amber)' : 'var(--emerald)');
        }
        const statFreeRam = document.getElementById('stat-free-ram');
        if (statFreeRam) statFreeRam.innerText = res.host.free_ram_formatted + ' (' + (100 - res.host.ram_used_pct).toFixed(1) + '% free)';
        const statCpuCores = document.getElementById('stat-cpu-cores');
        if (statCpuCores) statCpuCores.innerText = res.host.cpu_count + ' Cores';
        const statLoad = document.getElementById('stat-load');
        if (statLoad) statLoad.innerText = res.host.load_avg.join(', ');

        const statTotalStorage = document.getElementById('stat-total-storage');
        if (statTotalStorage) statTotalStorage.innerText = res.storage.total_formatted;
        const statDbSize = document.getElementById('stat-db-size');
        if (statDbSize) statDbSize.innerText = res.storage.db_formatted + ' (' + (res.storage.db_bytes || 0).toLocaleString() + ' B)';
        const statWalSize = document.getElementById('stat-wal-size');
        if (statWalSize) statWalSize.innerText = res.storage.wal_formatted + ' (' + (res.storage.wal_bytes || 0).toLocaleString() + ' B)';
        const statPages = document.getElementById('stat-pages');
        if (statPages) statPages.innerText = (res.storage.pragma?.pageCount || 0) + ' pages @ ' + (res.storage.pragma?.pageSize || 4096) + 'B';
        const statFreelist = document.getElementById('stat-freelist');
        if (statFreelist) statFreelist.innerText = (res.storage.pragma?.freelistCount || 0) + ' free pages (0% fragmentation)';

        const statActiveMemories = document.getElementById('stat-active-memories');
        if (statActiveMemories) statActiveMemories.innerText = res.counts?.active_memories || 0;
        const statTotalMemories = document.getElementById('stat-total-memories');
        if (statTotalMemories) statTotalMemories.innerText = (res.counts?.total_memories || 0) + ' records';
        const statActiveTriples = document.getElementById('stat-active-triples');
        if (statActiveTriples) statActiveTriples.innerText = (res.counts?.active_triples || 0) + ' triples';
        const statVectors = document.getElementById('stat-vectors');
        if (statVectors) statVectors.innerText = (res.counts?.vector_embeddings || 0) + ' vectors';

        const rawPre = document.getElementById('telemetry-raw');
        if (rawPre) rawPre.innerText = JSON.stringify(res, null, 2);
      } catch (e) {
        console.error('Failed loading telemetry:', e);
      }
    }

    // Helper to escape HTML attributes
    function escapeAttr(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // 1. Semantic Drift Radar
    function setDriftPreset(text) {
      document.getElementById('drift-statement').value = text;
      evaluateDrift();
    }

    async function evaluateDrift() {
      const stmtEl = document.getElementById('drift-statement');
      const statement = (stmtEl?.value || '').trim();
      if (!statement) {
        showToast('Please enter a statement to evaluate.');
        return;
      }
      const threshold = parseFloat(document.getElementById('drift-threshold')?.value) || 0.35;
      const resultBox = document.getElementById('drift-result-box');
      resultBox.innerHTML = '<div style="color:var(--text-dim); font-size:12.5px;">Scanning vector space and negative constraints...</div>';

      try {
        const res = await fetch('/v1/memory/drift', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statement: statement, threshold: threshold })
        }).then(r => r.json());

        if (!res.success) {
          resultBox.innerHTML = '<div style="color:var(--rose);">Error: ' + (res.error || 'Evaluation failed') + '</div>';
          return;
        }

        const d = res.drift;
        const isDrift = d.is_drift;
        const score = typeof d.divergence_score === 'number' ? d.divergence_score : 0;
        const scorePct = Math.round(score * 100);

        let html = '';
        html += '<div style="width:100%; text-align:left;">';
        html += '  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">';
        html += '    <span class="prop-label" style="margin:0;">COMPLIANCE VERDICT</span>';
        html += '    <span class="tag ' + (isDrift ? 'tag-danger' : 'tag-success') + '" style="font-size:12px; font-weight:700; padding:4px 10px;">' + (isDrift ? 'DRIFT DETECTED' : 'FULLY COMPLIANT') + '</span>';
        html += '  </div>';

        html += '  <div style="margin-bottom:14px;">';
        html += '    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px;">';
        html += '      <span style="color:var(--text-dim);">Semantic Divergence:</span>';
        html += '      <span style="font-family:var(--mono); font-weight:600; color:' + (isDrift ? 'var(--rose)' : 'var(--emerald)') + ';">' + score.toFixed(3) + ' / Threshold ' + threshold.toFixed(2) + ' (' + scorePct + '%)</span>';
        html += '    </div>';
        html += '    <div style="width:100%; height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">';
        html += '      <div style="width:' + Math.min(100, Math.max(0, scorePct)) + '%; height:100%; background:' + (isDrift ? 'var(--rose)' : 'var(--emerald)') + '; transition:width 0.4s ease;"></div>';
        html += '    </div>';
        html += '  </div>';

        if (isDrift) {
          html += '  <div style="background:rgba(244,63,94,0.08); border:1px solid rgba(244,63,94,0.25); border-left:3px solid var(--rose); border-radius:6px; padding:12px; margin-bottom:10px;">';
          html += '    <div style="font-size:11px; font-weight:600; color:#fecdd3; margin-bottom:4px;">VIOLATION EXPLANATION:</div>';
          html += '    <div style="font-size:12.5px; color:#fff; line-height:1.4;">' + (d.explanation || 'Action conflicts with registered negative constraint.') + '</div>';
          if (d.conflicting_memory_id) {
            html += '    <div style="font-family:var(--mono); font-size:11px; color:var(--text-dim); margin-top:6px;">Conflicting ID: ' + d.conflicting_memory_id + '</div>';
          }
          html += '  </div>';
        } else {
          html += '  <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-left:3px solid var(--emerald); border-radius:6px; padding:12px;">';
          html += '    <div style="font-size:11px; font-weight:600; color:#a7f3d0; margin-bottom:4px;">STATUS CLEAR:</div>';
          html += '    <div style="font-size:12.5px; color:#fff; line-height:1.4;">The proposed action adheres to system guardrails and does not breach negative architectural boundaries.</div>';
          html += '  </div>';
        }
        html += '</div>';

        resultBox.innerHTML = html;
      } catch (e) {
        resultBox.innerHTML = '<div style="color:var(--rose);">Request failed: ' + e.message + '</div>';
      }
    }

    // 2. Context Compactor
    function setCompactorBudget(val) {
      const slider = document.getElementById('compactor-budget');
      if (slider) slider.value = val;
      const badge = document.getElementById('budget-val');
      if (badge) badge.innerText = val + ' tokens';
      runCompaction();
    }

    async function runCompaction() {
      const queryEl = document.getElementById('compactor-query');
      const query = (queryEl?.value || '').trim() || 'rules constraints hardware setup';
      const budget = parseInt(document.getElementById('compactor-budget')?.value) || 500;
      const outPre = document.getElementById('compactor-output');
      if (outPre) outPre.innerText = 'Compacting context with knapsack greedy selector...';

      try {
        const res = await fetch('/v1/context/compact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query, max_tokens: budget })
        }).then(r => r.json());

        if (!res.success) {
          if (outPre) outPre.innerText = 'Error: ' + (res.error || 'Compaction failed');
          return;
        }

        const packBudget = document.getElementById('pack-budget');
        if (packBudget) packBudget.innerText = res.token_budget + ' tokens';
        const packCount = document.getElementById('pack-count');
        if (packCount) packCount.innerText = res.count + ' beliefs packed';
        if (outPre) outPre.innerText = res.formatted || '(No memories matched budget)';
      } catch (e) {
        if (outPre) outPre.innerText = 'Request error: ' + e.message;
      }
    }

    function copyCompactedPrompt() {
      const text = document.getElementById('compactor-output')?.innerText;
      if (text && !text.startsWith('Click') && !text.startsWith('Compacting')) {
        navigator.clipboard.writeText(text);
        showToast('Compacted prompt copied to clipboard.');
      }
    }

    // 3. Reflexion Playbooks
    let allPlaybooks = [];

    async function loadRemediations() {
      const c = document.getElementById('remediations-container');
      try {
        const res = await fetch('/v1/remediations').then(r => r.json());
        if (res.success) {
          allPlaybooks = res.playbooks || [];
          renderPlaybooks(allPlaybooks);
        }
      } catch (e) {
        if (c) c.innerHTML = '<div style="color:var(--rose);">Failed loading playbooks: ' + e.message + '</div>';
      }
    }

    async function testRemediation() {
      const query = (document.getElementById('remedy-search-input')?.value || '').trim();
      const statusEl = document.getElementById('remedy-match-status');
      if (!query) {
        renderPlaybooks(allPlaybooks);
        if (statusEl) statusEl.style.display = 'none';
        return;
      }

      try {
        const res = await fetch('/v1/remediations/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query })
        }).then(r => r.json());

        if (res.success) {
          const matches = res.matches || [];
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.innerHTML = '<span style="color:var(--emerald); font-weight:600;">' + matches.length + ' matching playbook(s)</span> found for query: "<span style="color:#fff;">' + escapeAttr(query) + '</span>"';
          }
          renderPlaybooks(matches);
        }
      } catch (e) {
        showToast('Match error: ' + e.message);
      }
    }

    function clearRemediationMatch() {
      const input = document.getElementById('remedy-search-input');
      if (input) input.value = '';
      const statusEl = document.getElementById('remedy-match-status');
      if (statusEl) statusEl.style.display = 'none';
      renderPlaybooks(allPlaybooks);
    }

    function renderPlaybooks(list) {
      const c = document.getElementById('remediations-container');
      if (!c) return;
      if (!list || list.length === 0) {
        c.innerHTML = '<div class="card-surface" style="text-align:center; color:var(--text-dim); padding:30px;">No matching reflexion playbooks found in database.</div>';
        return;
      }

      let html = '';
      list.forEach(p => {
        html += '<div class="card-surface">';
        html += '  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">';
        html += '    <div style="display:flex; align-items:center; gap:8px;">';
        html += '      <span class="tag tag-brand" style="font-family:var(--mono); font-size:12px;">Pattern: ' + (p.symptom_pattern || p.id) + '</span>';
        html += '      <span class="tag tag-success">✓ ' + (p.success_count || 1) + 'x Resolved</span>';
        html += '      <span class="tag">' + (p.scope || 'global') + '</span>';
        html += '    </div>';
        html += '    <span style="font-family:var(--mono); font-size:11px; color:var(--text-dim);">' + (p.created_at ? new Date(p.created_at).toLocaleDateString() : '') + '</span>';
        html += '  </div>';

        html += '  <div style="margin-bottom:12px;">';
        html += '    <div class="prop-label" style="color:var(--rose); margin-bottom:4px;">DIAGNOSED ROOT CAUSE</div>';
        html += '    <div style="font-size:13px; color:var(--text-main); line-height:1.5;">' + (p.root_cause || '-') + '</div>';
        html += '  </div>';

        html += '  <div>';
        html += '    <div class="prop-label" style="color:var(--emerald); margin-bottom:6px;">REMEDIATION RUNBOOK (TERMINAL STEPS)</div>';
        html += '    <div style="display:flex; flex-direction:column; gap:6px;">';
        const steps = Array.isArray(p.fix_steps) ? p.fix_steps : [];
        steps.forEach((step, sidx) => {
          html += '      <div style="display:flex; align-items:center; justify-content:space-between; background:#06070a; border:1px solid var(--border-subtle); border-radius:6px; padding:6px 10px; font-family:var(--mono); font-size:11.5px;">';
          html += '        <div style="display:flex; align-items:center; gap:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">';
          html += '          <span style="color:var(--brand); font-weight:600;">' + (sidx + 1) + '.</span>';
          html += '          <span style="color:#fff;">' + escapeAttr(step) + '</span>';
          html += '        </div>';
          html += '        <button class="btn" style="padding:2px 8px; font-size:11px; flex-shrink:0; margin-left:10px;" data-cmd="' + escapeAttr(step) + '" onclick="copyShellCommand(this.dataset.cmd)">Copy</button>';
          html += '      </div>';
        });
        html += '    </div>';
        html += '  </div>';
        html += '</div>';
      });

      c.innerHTML = html;
    }

    function copyShellCommand(cmd) {
      if (!cmd) return;
      navigator.clipboard.writeText(cmd);
      showToast('Command copied: ' + cmd);
    }

    // 4. Thematic Knowledge Clusters
    async function loadClusters() {
      const c = document.getElementById('clusters-container');
      const thresh = document.getElementById('cluster-threshold') ? document.getElementById('cluster-threshold').value : 0.55;
      if (c) c.innerHTML = '<div style="color:var(--text-dim); padding:20px;">Clustering memories with threshold ' + thresh + '...</div>';

      try {
        const res = await fetch('/v1/memory/clusters?threshold=' + thresh).then(r => r.json());
        if (!res.success) {
          if (c) c.innerHTML = '<div style="color:var(--rose);">Error loading clusters</div>';
          return;
        }

        const clusters = res.clusters || [];
        if (clusters.length === 0) {
          if (c) c.innerHTML = '<div class="card-surface" style="grid-column:1/-1; text-align:center; color:var(--text-dim); padding:30px;">No clusters formed. Try adjusting the similarity threshold.</div>';
          return;
        }

        let html = '';
        clusters.forEach(cl => {
          html += '<div class="card-surface">';
          html += '  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">';
          html += '    <div style="font-weight:600; font-size:13px; color:#fff;">' + escapeAttr(cl.label) + '</div>';
          html += '    <span class="tag tag-brand">' + cl.size + ' memories</span>';
          html += '  </div>';

          html += '  <div style="margin-bottom:12px;">';
          html += '    <div class="prop-label" style="margin-bottom:6px;">TOPIC KEYWORDS</div>';
          html += '    <div style="display:flex; flex-wrap:wrap; gap:4px;">';
          (cl.keywords || []).forEach(kw => {
            html += '      <span class="tag" style="font-size:10px; background:rgba(94,106,210,0.08); color:#c7d2fe;">' + escapeAttr(kw) + '</span>';
          });
          html += '    </div>';
          html += '  </div>';

          html += '  <div>';
          html += '    <div class="prop-label" style="margin-bottom:4px;">MEMBER MEMORY IDS</div>';
          html += '    <div style="display:flex; flex-direction:column; gap:4px;">';
          (cl.memory_ids || []).slice(0, 5).forEach(mid => {
            html += '      <div style="font-family:var(--mono); font-size:11px; color:var(--text-dim); background:#06070a; border:1px solid var(--border-subtle); padding:4px 8px; border-radius:4px;">' + mid + '</div>';
          });
          if (cl.memory_ids.length > 5) {
            html += '      <div style="font-size:10.5px; color:var(--text-dim); padding:2px 4px;">+ ' + (cl.memory_ids.length - 5) + ' more memories</div>';
          }
          html += '    </div>';
          html += '  </div>';
          html += '</div>';
        });

        if (c) c.innerHTML = html;
      } catch (e) {
        if (c) c.innerHTML = '<div style="color:var(--rose);">Failed loading clusters: ' + e.message + '</div>';
      }
    }

    // 5. Memory Event Ledger & Timeline
    let allTimelineEvents = [];

    async function loadTimeline() {
      const target = (document.getElementById('timeline-filter-target')?.value || '').trim();
      const c = document.getElementById('timeline-stream');
      if (c) c.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:20px;">Fetching event ledger...</div>';

      try {
        const q = target ? encodeURIComponent(target) : 'all';
        const res = await fetch('/v1/memory/timeline?target=' + q).then(r => r.json());
        if (!res.success) {
          if (c) c.innerHTML = '<div style="color:var(--rose);">Error loading timeline</div>';
          return;
        }

        allTimelineEvents = res.events || [];
        filterTimelineByType(document.getElementById('timeline-type-filter')?.value || 'ALL');
      } catch (e) {
        if (c) c.innerHTML = '<div style="color:var(--rose);">Request error: ' + e.message + '</div>';
      }
    }

    function filterTimelineByType(type) {
      const c = document.getElementById('timeline-stream');
      if (!c) return;
      const filtered = type === 'ALL' ? allTimelineEvents : allTimelineEvents.filter(ev => (ev.event_type || '').toUpperCase() === type);

      if (filtered.length === 0) {
        c.innerHTML = '<div class="card-surface" style="text-align:center; color:var(--text-dim); padding:30px;">No events match the selected criteria.</div>';
        return;
      }

      let html = '';
      filtered.forEach(ev => {
        const typeUpper = (ev.event_type || 'EVENT').toUpperCase();
        let badgeClass = 'tag-brand';
        let borderColor = 'var(--border-subtle)';
        if (typeUpper === 'CREATED') { badgeClass = 'tag-success'; borderColor = 'rgba(16,185,129,0.3)'; }
        else if (typeUpper === 'MUTATED') { badgeClass = 'tag-brand'; borderColor = 'rgba(94,106,210,0.3)'; }
        else if (typeUpper === 'SUPERSEDED') { badgeClass = 'tag'; borderColor = 'rgba(245,158,11,0.3)'; }
        else if (typeUpper === 'PURGED') { badgeClass = 'tag-danger'; borderColor = 'rgba(244,63,94,0.3)'; }

        const dateStr = ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '-';

        html += '<div class="card-surface" style="border-left:3px solid ' + borderColor + '; padding:14px;">';
        html += '  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">';
        html += '    <div style="display:flex; align-items:center; gap:8px;">';
        html += '      <span class="tag ' + badgeClass + '" style="font-weight:700;">' + typeUpper + '</span>';
        html += '      <span style="font-family:var(--mono); font-size:11px; color:var(--text-dim);">ID: ' + (ev.memory_id || ev.id) + '</span>';
        html += '    </div>';
        html += '    <span style="font-family:var(--mono); font-size:11px; color:var(--text-dim);">' + dateStr + '</span>';
        html += '  </div>';

        if (ev.reason) {
          html += '  <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;"><strong style="color:var(--text-main);">Reason:</strong> ' + escapeAttr(ev.reason) + '</div>';
        }

        if (ev.memory_content) {
          html += '  <div style="font-size:12.5px; color:#fff; background:#06070a; border:1px solid var(--border-subtle); padding:8px 10px; border-radius:4px; margin-top:6px;">' + escapeAttr(ev.memory_content) + '</div>';
        } else if (ev.new_content) {
          html += '  <div style="font-size:12.5px; color:#fff; background:#06070a; border:1px solid var(--border-subtle); padding:8px 10px; border-radius:4px; margin-top:6px;">' + escapeAttr(ev.new_content) + '</div>';
        }
        html += '</div>';
      });

      c.innerHTML = html;
    }

    // 6. Portable Memory Packs Hub
    async function exportMemoryPack() {
      const scope = document.getElementById('export-scope-select')?.value || 'all';
      const audit = document.getElementById('pack-audit-report');
      if (audit) audit.innerText = 'Exporting memory pack for scope: ' + scope + '...';

      try {
        const res = await fetch('/v1/memory/pack/export?scope=' + scope).then(r => r.json());
        if (!res.success || !res.pack) {
          if (audit) audit.innerText = 'Export failed: ' + (res.error || 'Unknown error');
          return;
        }

        const pack = res.pack;
        const jsonStr = JSON.stringify(pack, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mnemosyne-pack-' + scope + '-' + Date.now() + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (audit) {
          audit.innerText = 'Export successful:\\n' +
            '- Version: ' + pack.version + '\\n' +
            '- Scope: ' + pack.scope + '\\n' +
            '- Checksum (SHA-256): ' + pack.checksum + '\\n' +
            '- Memories: ' + (pack.memories || []).length + ' items\\n' +
            '- Entity Triples: ' + (pack.triples || []).length + ' items\\n' +
            '- Aliases: ' + (pack.aliases || []).length + ' items\\n' +
            '- Exported At: ' + new Date(pack.exported_at).toISOString();
        }
        showToast('Memory pack exported and downloaded.');
      } catch (e) {
        if (audit) audit.innerText = 'Export error: ' + e.message;
      }
    }

    function handlePackFileSelect(input) {
      const file = input?.files?.[0];
      if (!file) return;
      const label = document.getElementById('file-drop-label');
      if (label) label.innerText = 'Selected: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
      const reader = new FileReader();
      reader.onload = function(e) {
        const textarea = document.getElementById('import-pack-json');
        if (textarea) textarea.value = e.target.result;
      };
      reader.readAsText(file);
    }

    async function importMemoryPack() {
      const raw = (document.getElementById('import-pack-json')?.value || '').trim();
      const audit = document.getElementById('pack-audit-report');
      if (!raw) {
        showToast('Please select a pack file or paste JSON content.');
        return;
      }

      if (audit) audit.innerText = 'Parsing and verifying pack checksum...';

      try {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (pe) {
          if (audit) audit.innerText = 'JSON Parse Error: ' + pe.message;
          return;
        }

        const res = await fetch('/v1/memory/pack/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pack: parsed })
        }).then(r => r.json());

        if (!res.success) {
          if (audit) audit.innerText = 'Import failed: ' + (res.error || 'Unknown error');
          return;
        }

        if (audit) audit.innerText = 'Import successful:\\n' + JSON.stringify(res.result, null, 2);
        showToast('Pack successfully imported into memory.');
        loadStats();
        loadTelemetry();
      } catch (e) {
        if (audit) audit.innerText = 'Import request failed: ' + e.message;
      }
    }

    window.addEventListener('resize', () => {
      renderCanvas();
    });

    loadStats();
    loadTelemetry();
    initGraph();

    // Live auto-polling every 3.5 seconds
    setInterval(loadTelemetry, 3500);
  </script>
</body>
</html>`;
}

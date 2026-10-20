// Ponte: web UI. Talks to the C# host through window.chrome.webview.

const bridge = window.chrome?.webview;

// ---------------- tiny helpers ----------------

const $ = (s, r = document) => r.querySelector(s);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith('--')) el.style.setProperty(p, val ?? ''); else el.style[p] = val;
      }
    }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  x: '<path d="M7 7l10 10M17 7 7 17"/>',
  edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 20h14"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  up: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  newfolder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/><path d="M12 10v6M9 13h6"/>',
  bot: '<rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 4v4M9.5 13v1M14.5 13v1"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  enter: '<path d="M20 5v7a3 3 0 0 1-3 3H6M9.5 11.5 6 15l3.5 3.5"/>',
  maximize: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  power: '<path d="M12 3v8M6.3 7a8 8 0 1 0 11.4 0"/>',
  import: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
};

function icon(name, size = 16) {
  return h('span', {
    class: 'ic', 'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`,
  });
}

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => el.replaceWith(icon(el.dataset.icon)));
}

function toast(text, { error = false, action, onAction, ms = 4200 } = {}) {
  const el = h('div', { class: 'toast' + (error ? ' err' : '') }, h('span', null, text),
    action && h('button', { onclick: () => { onAction?.(); el.remove(); } }, action));
  $('#toasts').append(el);
  setTimeout(() => el.remove(), error ? ms + 2500 : ms);
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}

function fmtDate(ms) {
  const d = new Date(ms), now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString('pt-BR', sameYear
    ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

const shq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const joinPath = (dir, name) => dir.endsWith('/') ? dir + name : `${dir}/${name}`;

// ---------------- bridge ----------------

const pending = new Map();
let seq = 0;

function call(t, payload = {}, files) {
  if (!bridge) return Promise.reject(new Error('Abra pelo app Ponte.'));
  const id = String(++seq);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const msg = { t, id, ...payload };
    if (files) bridge.postMessageWithAdditionalObjects(msg, files);
    else bridge.postMessage(msg);
  });
}

function send(t, payload = {}) { bridge?.postMessage({ t, ...payload }); }

bridge?.addEventListener('message', e => {
  const m = e.data;
  switch (m.t) {
    case 'reply': {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || 'Algo deu errado.'));
      break;
    }
    case 'state': setState(m.data); break;
    case 'term.data': onTermData(m.sid, m.data); break;
    case 'session.closed': onSessionClosed(m.sid, m.reason); break;
    case 'status': onStatus(m.sid, m.text); break;
  }
});

// ---------------- state ----------------

const S = { connections: [], agents: [], mremoteng: false };
const workspaces = [];          // open tabs
const sessions = new Map();     // sid -> { ws, kind, term? }
const earlyData = new Map();    // output that arrived before its terminal registered
let route = 'home';
let boardCols = Number(localStorage.getItem('ponte.cols')) || 2;
let lastTerm = null;
let overlayCount = 0;

const COLORS = ['', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#64748b'];
const AGENT_PRESETS = [
  { name: 'Claude Code', command: 'claude' },
  { name: 'Codex', command: 'codex' },
  { name: 'Gemini', command: 'gemini' },
  { name: 'Aider', command: 'aider' },
  { name: 'PowerShell', command: 'powershell -NoLogo' },
  { name: 'Bash', command: 'bash' },
];

function setState(data) {
  Object.assign(S, data);
  for (const ws of workspaces) {
    if (ws.connId) { const c = conn(ws.connId); if (c) { ws.title = c.name; ws.color = c.color; updateWsBar(ws); } }
  }
  renderHome();
  renderTabs();
}

const conn = id => S.connections.find(c => c.id === id);
const agent = id => S.agents.find(a => a.id === id);
const hasDesktop = c => c.desktop !== 'none';
const hasShell = c => c.ssh;
const defaultView = c => hasDesktop(c) ? 'desktop' : 'term';

// ---------------- routing & tabs ----------------

function go(to) {
  route = to;
  $('#view-home').hidden = to !== 'home';
  $('#view-board').hidden = to !== 'board';
  for (const ws of workspaces) ws.el.hidden = ws.id !== to;
  if (to === 'board') renderBoard(); else returnTermsHome();
  const ws = workspaces.find(w => w.id === to);
  if (ws) requestAnimationFrame(() => { fitVisible(ws); focusWs(ws); });
  renderTabs();
  layoutRdp();
}

function renderTabs() {
  const tabs = $('#tabs');
  tabs.replaceChildren();
  const live = [...sessions.values()].filter(s => !s.ended).length;
  tabs.append(
    h('button', { class: 'tab' + (route === 'home' ? ' active' : ''), onclick: () => go('home'), title: 'Início' },
      icon('home'), h('span', { class: 'name' }, 'Início')),
    h('button', { class: 'tab' + (route === 'board' ? ' active' : ''), onclick: () => go('board'), title: 'Tudo o que está aberto, lado a lado' },
      icon('grid'), h('span', { class: 'name' }, 'Quadro'), live ? h('span', { class: 'count' }, live) : null),
  );
  workspaces.forEach((ws, i) => {
    const running = [...sessions.values()].some(s => s.ws === ws && !s.ended);
    tabs.append(h('button', {
      class: 'tab' + (route === ws.id ? ' active' : ''), title: `${ws.title} (Ctrl+${i + 3})`,
      onclick: () => go(ws.id),
      onauxclick: e => { if (e.button === 1) closeWs(ws); },
    },
      h('span', { class: 'dot' + (running ? ' live' : ''), style: { '--c': ws.color || (running ? 'var(--ok)' : '') } }),
      h('span', { class: 'name' }, ws.title),
      h('span', { class: 'close', title: 'Fechar', onclick: e => { e.stopPropagation(); closeWs(ws); } }, icon('x', 13)),
    ));
  });
}

// ---------------- home ----------------

let homeFilter = '';

function renderHome() {
  const root = $('#view-home');
  const keepFocus = document.activeElement?.classList.contains('filter');
  const q = homeFilter.trim().toLowerCase();
  const match = c => !q || [c.name, c.host, c.user, c.group].some(v => v?.toLowerCase().includes(q));
  const conns = S.connections.filter(match).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

  const filter = h('input', {
    class: 'filter', placeholder: 'Filtrar conexões', value: homeFilter,
    oninput: e => { homeFilter = e.target.value; renderHome(); },
  });

  let connBody;
  if (!S.connections.length) {
    connBody = h('div', { class: 'empty' },
      h('div', null, 'Nenhuma conexão salva ainda.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => editConnection() }, icon('plus'), 'Nova conexão'),
        S.mremoteng && h('button', { class: 'btn', onclick: importMremote }, icon('import'), 'Trazer do mRemoteNG')));
  } else if (!conns.length) {
    connBody = h('div', { class: 'empty' }, `Nada encontrado para "${homeFilter}".`);
  } else {
    connBody = h('div');
    const groups = Map.groupBy ? Map.groupBy(conns, c => c.group) : conns.reduce((m, c) => m.set(c.group, [...(m.get(c.group) || []), c]), new Map());
    for (const [group, list] of groups) {
      if (group) connBody.append(h('div', { class: 'group-label' }, group));
      connBody.append(h('div', { class: 'grid' }, list.map(connCard)));
    }
  }

  const agentBody = S.agents.length
    ? h('div', { class: 'grid' }, S.agents.map(agentCard))
    : h('div', { class: 'empty' },
      h('div', null, 'Coloque aqui o Claude Code, o Codex, o Gemini ou qualquer programa de terminal. Cada um roda no seu PC ou num servidor Linux.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => editAgent() }, icon('plus'), 'Novo agente')));

  root.replaceChildren(h('div', { class: 'home-inner' },
    h('div', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', null, 'Conexões'),
        S.connections.length ? h('span', { class: 'hint' }, S.connections.length) : null,
        h('span', { class: 'spacer' }),
        S.connections.length > 5 ? filter : null,
        S.connections.length ? h('button', { class: 'btn', onclick: () => editConnection() }, icon('plus'), 'Nova conexão') : null),
      connBody),
    h('div', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', null, 'Agentes'),
        h('span', { class: 'hint' }, 'IA e terminais que ficam rodando'),
        h('span', { class: 'spacer' }),
        S.agents.length > 1 ? h('button', { class: 'btn', onclick: startAllAgents }, icon('play'), 'Abrir todos no quadro') : null,
        S.agents.length ? h('button', { class: 'btn', onclick: () => editAgent() }, icon('plus'), 'Novo agente') : null),
      agentBody),
  ));
  if (keepFocus) { const f = $('.filter', root); f?.focus(); f?.setSelectionRange(f.value.length, f.value.length); }
}

function connCard(c) {
  const actions = [];
  if (hasDesktop(c)) actions.push(h('button', { class: 'btn', onclick: e => { e.stopPropagation(); openConn(c.id, 'desktop'); } }, icon('monitor', 14), 'Tela'));
  if (hasShell(c)) {
    actions.push(h('button', { class: 'btn', onclick: e => { e.stopPropagation(); openConn(c.id, 'term'); } }, icon('term', 14), 'Terminal'));
    actions.push(h('button', { class: 'btn', onclick: e => { e.stopPropagation(); openConn(c.id, 'files'); } }, icon('folder', 14), 'Arquivos'));
  }
  return h('div', {
    class: 'card', tabindex: 0, style: { '--c': c.color || 'transparent' },
    onclick: () => openConn(c.id), onkeydown: e => { if (e.key === 'Enter') openConn(c.id); },
    title: 'Clique para conectar',
  },
    h('div', { class: 'card-top' },
      h('span', { class: 'pill' }, c.os === 'windows' ? 'Windows' : 'Linux'),
      c.desktop === 'vnc' ? h('span', { class: 'pill' }, 'VNC') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn icon ghost edit', title: 'Editar', onclick: e => { e.stopPropagation(); editConnection(c); } }, icon('edit', 14))),
    h('div', { class: 'card-name' }, c.name),
    h('div', { class: 'card-sub' }, c.user ? `${c.user}@${c.host}` : c.host),
    h('div', { class: 'card-actions' }, actions));
}

function agentCard(a) {
  const where = a.target === 'local' ? 'Este PC' : (conn(a.target)?.name || 'Conexão removida');
  return h('div', {
    class: 'card', tabindex: 0, onclick: () => openAgent(a.id), onkeydown: e => { if (e.key === 'Enter') openAgent(a.id); },
    title: 'Clique para abrir',
  },
    h('div', { class: 'card-top' }, icon('bot', 14), h('span', null, where), h('span', { class: 'spacer' }),
      h('button', { class: 'btn icon ghost edit', title: 'Editar', onclick: e => { e.stopPropagation(); editAgent(a); } }, icon('edit', 14))),
    h('div', { class: 'card-name' }, a.name),
    h('div', { class: 'card-sub' }, a.command + (a.cwd ? `  ·  ${a.cwd}` : '')));
}

// ---------------- workspaces ----------------

function openConn(connId, view) {
  const c = conn(connId);
  if (!c) return;
  let ws = workspaces.find(w => w.connId === connId);
  if (!ws) ws = createConnWs(c);
  go(ws.id);
  setView(ws, view || ws.active || defaultView(c));
}

function createConnWs(c) {
  const ws = {
    id: 'ws' + Math.random().toString(36).slice(2, 8), connId: c.id, title: c.name, color: c.color,
    active: null, term: null, rdp: null, vnc: null, files: { path: '', items: [], sel: null },
  };
  const views = [];
  if (hasDesktop(c)) views.push(['desktop', 'monitor', 'Tela']);
  if (hasShell(c)) views.push(['term', 'term', 'Terminal'], ['files', 'folder', 'Arquivos']);

  ws.seg = h('div', { class: 'seg' }, views.map(([v, ic, label]) =>
    h('button', { 'data-v': v, onclick: () => setView(ws, v) }, icon(ic, 14), label)));
  ws.reconnectBtn = h('button', { class: 'btn small', hidden: true, onclick: () => reconnect(ws) }, icon('refresh', 14), 'Conectar de novo');
  ws.titleEl = h('span', { class: 'title' });
  ws.hostEl = h('span', { class: 'host selectable' });
  ws.panes = {
    desktop: h('div', { class: 'pane pane-desktop', hidden: true }),
    term: h('div', { class: 'pane pane-term', hidden: true }),
    files: h('div', { class: 'pane pane-files', hidden: true }),
  };
  ws.el = h('section', { class: 'ws', hidden: true },
    h('div', { class: 'ws-bar' },
      h('span', { class: 'dot', style: { '--c': c.color || 'var(--faint)' } }), ws.titleEl, ws.hostEl,
      views.length > 1 ? ws.seg : null,
      h('span', { class: 'spacer' }),
      ws.reconnectBtn,
      h('button', { class: 'btn small ghost', onclick: () => closeWs(ws), title: 'Fecha tudo desta conexão (Ctrl+Shift+W)' }, icon('power', 14), 'Desconectar')),
    h('div', { class: 'ws-body' }, Object.values(ws.panes)));
  $('#views').append(ws.el);
  workspaces.push(ws);
  updateWsBar(ws);
  return ws;
}

function updateWsBar(ws) {
  if (!ws.titleEl) return;
  ws.titleEl.textContent = ws.title;
  const c = ws.connId && conn(ws.connId);
  ws.hostEl.textContent = c ? (c.user ? `${c.user}@${c.host}` : c.host) : (ws.subtitle || '');
}

function setView(ws, v) {
  ws.active = v;
  ws.seg?.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  for (const [k, pane] of Object.entries(ws.panes)) pane.hidden = k !== v;
  const c = conn(ws.connId);
  if (v === 'desktop' && !ws.rdp && !ws.vnc) startDesktop(ws, c);
  if (v === 'term') { if (!ws.term) startShell(ws); else requestAnimationFrame(() => { ws.term.fit.fit(); ws.term.xterm.focus(); }); }
  if (v === 'files' && !ws.files.loaded) loadFiles(ws, ws.files.path || '~');
  updateReconnect(ws);
  layoutRdp();
}

function focusWs(ws) {
  if (ws.active === 'term' && ws.term) ws.term.xterm.focus();
  if (ws.active === 'desktop' && ws.rdp?.ready) send('rdp.focus', { sid: ws.rdp.sid });
}

function closeWs(ws) {
  for (const [sid, s] of [...sessions]) if (s.ws === ws) { send('close', { sid }); sessions.delete(sid); s.term?.xterm.dispose(); }
  try { ws.vnc?.rfb?.disconnect(); } catch { }
  ws.el.remove();
  workspaces.splice(workspaces.indexOf(ws), 1);
  if (route === ws.id) go(workspaces.at(-1)?.id || 'home'); else renderTabs();
  layoutRdp();
}

function updateReconnect(ws) {
  const v = ws.active;
  const dead = (v === 'term' && ws.term?.ended) || (v === 'desktop' && (ws.rdp?.ended || ws.vnc?.ended));
  ws.reconnectBtn.hidden = !dead;
}

function reconnect(ws) {
  if (ws.active === 'term' && ws.term) {
    const old = ws.term;
    sessions.delete(old.sid);
    old.xterm.dispose(); old.el.remove();
    ws.term = null;
    if (ws.agentId || ws.local) startAgentTerm(ws); else startShell(ws);
  } else if (ws.active === 'desktop') {
    if (ws.rdp) { send('close', { sid: ws.rdp.sid }); sessions.delete(ws.rdp.sid); ws.rdp = null; }
    try { ws.vnc?.rfb?.disconnect(); } catch { }
    ws.vnc = null;
    ws.panes.desktop.replaceChildren();
    startDesktop(ws, conn(ws.connId));
  }
  updateReconnect(ws);
}

// ---------------- terminals ----------------

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function termTheme() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    background: cssVar('--term-bg'), foreground: cssVar('--term-fg'), cursor: cssVar('--accent'),
    cursorAccent: cssVar('--term-bg'),
    selectionBackground: dark ? '#3f3f46' : '#d6d3d1',
    black: dark ? '#27272a' : '#1c1917', brightBlack: dark ? '#52525b' : '#78716c',
    red: dark ? '#f87171' : '#b91c1c', green: dark ? '#4ade80' : '#15803d', yellow: dark ? '#facc15' : '#a16207',
    blue: dark ? '#60a5fa' : '#1d4ed8', magenta: dark ? '#c084fc' : '#7e22ce', cyan: dark ? '#22d3ee' : '#0e7490',
    white: dark ? '#e4e4e7' : '#e7e5e4', brightWhite: '#fafafa',
  };
}

const BASE_FONT = 13.5;

function createTerm(ws, home) {
  const el = h('div', { class: 'term-host' });
  home.append(el);
  const xterm = new Terminal({
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace', fontSize: BASE_FONT, lineHeight: 1.15,
    cursorBlink: true, scrollback: 20000, theme: termTheme(), allowProposedApi: true, macOptionIsMeta: true,
  });
  const fit = new FitAddon.FitAddon();
  xterm.loadAddon(fit);
  xterm.open(el);
  const T = { el, home, xterm, fit, ws, sid: null, ended: false };

  xterm.onData(d => { if (T.sid && !T.ended) send('term.input', { sid: T.sid, data: d }); });
  xterm.onResize(({ cols, rows }) => { if (T.sid && !T.ended) send('term.resize', { sid: T.sid, cols, rows }); });
  xterm.textarea?.addEventListener('focus', () => { lastTerm = T; });
  xterm.attachCustomKeyEventHandler(e => {
    if (e.type !== 'keydown') return true;
    if (globalShortcut(e)) return false;
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c' && xterm.hasSelection()) {
      navigator.clipboard.writeText(xterm.getSelection()); xterm.clearSelection(); return false;
    }
    if (e.ctrlKey && (e.key.toLowerCase() === 'v' || (e.shiftKey && e.key === 'V'))) {
      navigator.clipboard.readText().then(t => t && xterm.paste(t)); return false;
    }
    return true;
  });
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (xterm.hasSelection()) { navigator.clipboard.writeText(xterm.getSelection()); xterm.clearSelection(); }
    else navigator.clipboard.readText().then(t => t && xterm.paste(t));
  });
  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (el.offsetParent && el.clientWidth > 20) { try { fit.fit(); } catch { } } });
  }).observe(el);
  requestAnimationFrame(() => { try { fit.fit(); } catch { } });
  return T;
}

function registerTerm(T, sid, kind = 'term') {
  T.sid = sid;
  sessions.set(sid, { ws: T.ws, kind, term: T });
  const early = earlyData.get(sid);
  if (early) { early.forEach(d => T.xterm.write(d)); earlyData.delete(sid); }
  // the size may have changed while we waited for the session id
  send('term.resize', { sid, cols: T.xterm.cols, rows: T.xterm.rows });
  renderTabs();
}

function onTermData(sid, data) {
  const s = sessions.get(sid);
  if (s?.term) s.term.xterm.write(data);
  else earlyData.set(sid, [...(earlyData.get(sid) || []), data]);
}

async function startShell(ws) {
  const c = conn(ws.connId);
  const T = createTerm(ws, ws.panes.term);
  ws.term = T;
  T.xterm.write(`\x1b[2mConectando a ${c.host}…\x1b[0m\r\n`);
  try {
    const { sid } = await call('open.term', { connId: c.id, cols: T.xterm.cols, rows: T.xterm.rows });
    registerTerm(T, sid);
    T.xterm.focus();
  } catch (err) { T.ended = true; T.xterm.write(`\x1b[31m${err.message}\x1b[0m\r\n`); updateReconnect(ws); }
}

// ---------------- agents ----------------

function openAgent(agentId) {
  const a = agent(agentId);
  if (!a) return;
  let ws = workspaces.find(w => w.agentId === agentId);
  if (!ws) { ws = createTermWs({ agentId, title: a.name, subtitle: a.target === 'local' ? a.command : `${a.command} em ${conn(a.target)?.name || '?'}` }); startAgentTerm(ws); }
  go(ws.id);
  return ws;
}

function openLocalTerminal() {
  const ws = createTermWs({ local: true, title: 'Terminal', subtitle: 'PowerShell neste PC' });
  startAgentTerm(ws);
  go(ws.id);
}

function createTermWs({ agentId, local, title, subtitle }) {
  const ws = { id: 'ws' + Math.random().toString(36).slice(2, 8), agentId, local, title, subtitle, active: 'term', term: null };
  ws.reconnectBtn = h('button', { class: 'btn small', hidden: true, onclick: () => reconnect(ws) }, icon('refresh', 14), 'Iniciar de novo');
  ws.titleEl = h('span', { class: 'title' });
  ws.hostEl = h('span', { class: 'host selectable' });
  ws.panes = { term: h('div', { class: 'pane pane-term' }) };
  ws.el = h('section', { class: 'ws', hidden: true },
    h('div', { class: 'ws-bar' }, icon('bot', 15), ws.titleEl, ws.hostEl, h('span', { class: 'spacer' }), ws.reconnectBtn,
      h('button', { class: 'btn small ghost', onclick: () => closeWs(ws), title: 'Encerra o programa e fecha a aba' }, icon('power', 14), 'Encerrar')),
    h('div', { class: 'ws-body' }, ws.panes.term));
  $('#views').append(ws.el);
  workspaces.push(ws);
  updateWsBar(ws);
  return ws;
}

async function startAgentTerm(ws) {
  ws.el.hidden = false;   // xterm needs a visible box to measure
  const T = createTerm(ws, ws.panes.term);
  ws.term = T;
  if (route !== ws.id) ws.el.hidden = true;
  try {
    const payload = ws.agentId ? { agentId: ws.agentId } : { command: 'powershell -NoLogo' };
    const { sid } = await call('open.term', { ...payload, cols: T.xterm.cols, rows: T.xterm.rows });
    registerTerm(T, sid);
    if (route === ws.id) T.xterm.focus();
  } catch (err) { T.ended = true; T.xterm.write(`\x1b[31m${err.message}\x1b[0m\r\n`); updateReconnect(ws); }
}

async function startAllAgents() {
  for (const a of S.agents) if (!workspaces.some(w => w.agentId === a.id)) {
    const ws = createTermWs({ agentId: a.id, title: a.name, subtitle: a.command });
    await startAgentTerm(ws);
  }
  go('board');
}

// ---------------- session events ----------------

function onSessionClosed(sid, reason) {
  const s = sessions.get(sid);
  if (!s) return;
  s.ended = true;
  if (s.term) {
    s.term.ended = true;
    s.term.xterm.write(`\r\n\x1b[2m${reason || 'Sessão encerrada.'}\x1b[0m\r\n`);
  }
  if (s.kind === 'rdp' && s.ws.rdp?.sid === sid) {
    s.ws.rdp.ended = true; s.ws.rdp.ready = false;
    desktopMessage(s.ws, reason || 'Sessão encerrada.', true);
    layoutRdp();
  }
  updateReconnect(s.ws);
  renderTabs();
  if (route === 'board') renderBoard();
}

function onStatus(sid, text) {
  const s = sessions.get(sid);
  if (s?.kind !== 'rdp') return;
  if (!text) { s.ws.rdp.ready = true; desktopMessage(s.ws, null); }
  else desktopMessage(s.ws, text);
  layoutRdp();
}

// ---------------- desktop (RDP / VNC) ----------------

function desktopMessage(ws, text, withRetry = false) {
  let msg = ws.panes.desktop.querySelector('.pane-msg');
  if (!text) { msg?.remove(); return; }
  if (!msg) { msg = h('div', { class: 'pane-msg' }); ws.panes.desktop.append(msg); }
  msg.replaceChildren(h('div', { class: 'box' },
    withRetry ? null : h('div', { class: 'spinner' }),
    h('div', null, text),
    withRetry ? h('button', { class: 'btn', onclick: () => reconnect(ws) }, icon('refresh', 14), 'Conectar de novo') : null));
}

function rectOf(el) {
  const r = el.getBoundingClientRect(), d = devicePixelRatio;
  return { x: Math.round(r.left * d), y: Math.round(r.top * d), w: Math.round(r.width * d), h: Math.round(r.height * d) };
}

async function startDesktop(ws, c) {
  const pane = ws.panes.desktop;
  if (c.desktop === 'vnc') return startVnc(ws, c);
  const host = h('div', { class: 'rdp-host' });
  pane.replaceChildren(host);
  new ResizeObserver(() => layoutRdp()).observe(host);
  desktopMessage(ws, `Conectando a ${c.host}…`);
  await new Promise(r => requestAnimationFrame(r));
  ws.rdp = { sid: null, host, ready: false };
  try {
    const { sid } = await call('open.rdp', { connId: c.id, ...rectOf(host) });
    ws.rdp.sid = sid;
    sessions.set(sid, { ws, kind: 'rdp' });
    renderTabs();
  } catch (err) {
    ws.rdp.ended = true;
    desktopMessage(ws, err.message, true);
  }
  updateReconnect(ws);
}

async function startVnc(ws, c) {
  const pane = ws.panes.desktop;
  const host = h('div', { class: 'vnc-host' });
  pane.replaceChildren(host);
  desktopMessage(ws, `Conectando a ${c.host}…`);
  ws.vnc = { rfb: null };
  try {
    const [{ default: RFB }, info] = await Promise.all([import('./vendor/novnc/core/rfb.js'), call('open.vnc', { connId: c.id })]);
    const rfb = new RFB(host, info.url, { credentials: { password: info.password } });
    rfb.scaleViewport = true;
    rfb.resizeSession = true;
    rfb.background = '#000';
    ws.vnc.rfb = rfb;
    rfb.addEventListener('connect', () => desktopMessage(ws, null));
    rfb.addEventListener('disconnect', e => {
      ws.vnc.ended = true;
      desktopMessage(ws, e.detail.clean ? 'Sessão encerrada.' : 'A conexão VNC caiu ou não foi aceita.', true);
      updateReconnect(ws);
    });
    rfb.addEventListener('credentialsrequired', async () => {
      const pass = await promptText('Senha do VNC', 'Este servidor pediu senha.', { password: true });
      if (pass != null) rfb.sendCredentials({ password: pass }); else rfb.disconnect();
    });
    rfb.addEventListener('securityfailure', () => desktopMessage(ws, 'O servidor VNC recusou a senha.', true));
  } catch (err) {
    ws.vnc.ended = true;
    desktopMessage(ws, err.message, true);
  }
}

// The RDP control is a native window that sits above the page, so it is shown only when nothing should cover it.
function layoutRdp() {
  for (const ws of workspaces) {
    if (!ws.rdp?.sid) continue;
    const visible = route === ws.id && ws.active === 'desktop' && ws.rdp.ready && overlayCount === 0;
    send('rdp.bounds', { sid: ws.rdp.sid, visible, ...rectOf(ws.rdp.host) });
  }
}
addEventListener('resize', layoutRdp);

// ---------------- files (SFTP) ----------------

async function loadFiles(ws, path) {
  const f = ws.files;
  const pane = ws.panes.files;
  if (!pane.firstChild) buildFilesUi(ws);
  f.list.replaceChildren(h('div', { class: 'loading' }, 'Carregando…'));
  try {
    const res = await call('sftp.list', { connId: ws.connId, path });
    f.path = res.path; f.items = res.items; f.loaded = true; f.sel = null;
    renderFiles(ws);
  } catch (err) {
    f.list.replaceChildren(h('div', { class: 'msg' }, err.message, h('div', { style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: () => loadFiles(ws, f.path || '~') }, icon('refresh', 14), 'Tentar de novo'))));
  }
}

function buildFilesUi(ws) {
  const f = ws.files;
  f.crumbs = h('div', { class: 'crumbs' });
  f.list = h('div', { class: 'files-list' });
  const bar = h('div', { class: 'files-bar' },
    h('button', { class: 'btn icon ghost', title: 'Pasta de cima', onclick: () => loadFiles(ws, parentOf(f.path)) }, icon('up')),
    f.crumbs,
    h('button', { class: 'btn small ghost', title: 'Atualizar', onclick: () => loadFiles(ws, f.path) }, icon('refresh', 14)),
    h('button', { class: 'btn small ghost', onclick: () => newFolder(ws) }, icon('newfolder', 14), 'Nova pasta'),
    h('button', { class: 'btn small ghost', title: 'Abre o terminal nesta pasta', onclick: () => terminalHere(ws) }, icon('term', 14), 'Terminal aqui'),
    h('button', { class: 'btn small', onclick: () => upload(ws) }, icon('upload', 14), 'Enviar arquivos'));
  ws.panes.files.replaceChildren(bar, f.list);

  // Drag files from Explorer straight into the folder.
  let depth = 0, zone = null;
  const pane = ws.panes.files;
  pane.addEventListener('dragenter', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); depth++;
    if (!zone) { zone = h('div', { class: 'dropzone' }, `Solte para enviar para ${f.path}`); f.list.append(zone); }
  });
  pane.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  pane.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; zone?.remove(); zone = null; } });
  pane.addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; zone?.remove(); zone = null;
    if (!e.dataTransfer.files.length) return;
    const dir = f.path;
    toast(`Enviando ${e.dataTransfer.files.length} item(ns)…`);
    try {
      const { count } = await call('sftp.drop', { connId: ws.connId, dir }, e.dataTransfer.files);
      toast(count ? `Enviado: ${count} item(ns) para ${dir}` : 'Nada foi enviado.');
      loadFiles(ws, dir);
    } catch (err) { toast(err.message, { error: true }); }
  });
}

const parentOf = p => { if (!p || p === '/') return '/'; const i = p.replace(/\/$/, '').lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };

function renderFiles(ws) {
  const f = ws.files;
  // breadcrumbs, click the empty area to type a path
  const parts = f.path.split('/').filter(Boolean);
  f.crumbs.replaceChildren(
    h('button', { onclick: () => loadFiles(ws, '/') }, '/'),
    ...parts.flatMap((p, i) => [
      i ? h('span', { class: 'sep' }, '/') : null,
      h('button', { onclick: () => loadFiles(ws, '/' + parts.slice(0, i + 1).join('/')) }, p),
    ]).filter(Boolean),
  );
  f.crumbs.ondblclick = e => {
    if (e.target !== f.crumbs) return;
    const input = h('input', { class: 'path-input', value: f.path });
    input.onkeydown = ev => { if (ev.key === 'Enter') loadFiles(ws, input.value.trim() || '/'); if (ev.key === 'Escape') renderFiles(ws); };
    input.onblur = () => renderFiles(ws);
    f.crumbs.replaceWith(input); input.focus(); input.select();
    f.crumbs = input;
  };
  if (f.crumbs.tagName === 'INPUT') { const div = h('div', { class: 'crumbs' }); f.crumbs.replaceWith(div); f.crumbs = div; return renderFiles(ws); }

  const items = [...f.items].sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
  if (!items.length) { f.list.replaceChildren(h('div', { class: 'msg' }, 'Pasta vazia. Arraste arquivos para cá para enviar.')); return; }

  const rows = items.map(it => {
    const full = joinPath(f.path, it.name);
    const tr = h('tr', {
      class: 'row' + (it.dir ? ' dir' : '') + (f.sel === it.name ? ' sel' : ''),
      onclick: () => { f.sel = it.name; f.list.querySelectorAll('tr.sel').forEach(r => r.classList.remove('sel')); tr.classList.add('sel'); },
      ondblclick: () => it.dir ? loadFiles(ws, full) : download(ws, full),
    },
      h('td', null, h('div', { class: 'fname' }, icon(it.dir ? 'folder' : 'file', 15), h('span', { class: 'selectable' }, it.name))),
      h('td', { class: 'num' }, it.dir ? '' : fmtSize(it.size)),
      h('td', { class: 'date' }, fmtDate(it.mtime)),
      h('td', { class: 'acts' },
        it.dir ? null : h('button', { class: 'btn small ghost', title: 'Baixar para a pasta Downloads', onclick: e => { e.stopPropagation(); download(ws, full); } }, icon('download', 14)),
        h('button', { class: 'btn small ghost', title: 'Renomear', onclick: e => { e.stopPropagation(); renameItem(ws, it); } }, icon('edit', 14)),
        h('button', { class: 'btn small ghost danger', title: 'Excluir', onclick: e => { e.stopPropagation(); deleteItem(ws, it); } }, icon('trash', 14))));
    return tr;
  });
  f.list.replaceChildren(h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Nome'), h('th', { style: { textAlign: 'right' } }, 'Tamanho'), h('th', null, 'Modificado'), h('th'))),
    h('tbody', null, rows)));
}

async function download(ws, path) {
  toast(`Baixando ${path.split('/').pop()}…`);
  try {
    const { local } = await call('sftp.download', { connId: ws.connId, path });
    toast(`Salvo em Downloads: ${local.split('\\').pop()}`, { action: 'Mostrar', onAction: () => call('reveal', { path: local }) });
  } catch (err) { toast(err.message, { error: true }); }
}

async function upload(ws) {
  try {
    const { count } = await call('sftp.upload', { connId: ws.connId, dir: ws.files.path });
    if (count) { toast(`Enviado: ${count} arquivo(s).`); loadFiles(ws, ws.files.path); }
  } catch (err) { toast(err.message, { error: true }); }
}

async function newFolder(ws) {
  const name = await promptText('Nova pasta', `Dentro de ${ws.files.path}`, { placeholder: 'nome-da-pasta' });
  if (!name) return;
  try { await call('sftp.mkdir', { connId: ws.connId, path: joinPath(ws.files.path, name) }); loadFiles(ws, ws.files.path); }
  catch (err) { toast(err.message, { error: true }); }
}

async function renameItem(ws, it) {
  const name = await promptText('Renomear', it.name, { value: it.name });
  if (!name || name === it.name) return;
  try { await call('sftp.rename', { connId: ws.connId, from: joinPath(ws.files.path, it.name), to: joinPath(ws.files.path, name) }); loadFiles(ws, ws.files.path); }
  catch (err) { toast(err.message, { error: true }); }
}

async function deleteItem(ws, it) {
  const ok = await confirmBox(`Excluir ${it.name}?`, it.dir ? 'A pasta e tudo o que está dentro dela vão ser apagados no servidor.' : 'O arquivo vai ser apagado no servidor.', 'Excluir');
  if (!ok) return;
  try { await call('sftp.delete', { connId: ws.connId, path: joinPath(ws.files.path, it.name) }); loadFiles(ws, ws.files.path); }
  catch (err) { toast(err.message, { error: true }); }
}

function terminalHere(ws) {
  const path = ws.files.path;
  const cd = () => send('term.input', { sid: ws.term.sid, data: `cd ${shq(path)}\r` });
  setView(ws, 'term');
  if (ws.term?.sid) cd();
  else { const wait = setInterval(() => { if (ws.term?.sid) { clearInterval(wait); setTimeout(cd, 600); } }, 200); setTimeout(() => clearInterval(wait), 15000); }
}

// ---------------- board ----------------

const FONT_BY_COLS = { 1: 13.5, 2: 12.5, 3: 11.5, 4: 10.5, 5: 9.5, 6: 9 };
const ZOOM_LABEL = { 1: 'Perto', 2: '2 por linha', 3: '3 por linha', 4: '4 por linha', 5: '5 por linha', 6: 'Tudo' };

function boardItems() {
  const items = [];
  for (const ws of workspaces) {
    if (ws.term) items.push({ ws, kind: 'term', T: ws.term });
    if (ws.rdp || ws.vnc) items.push({ ws, kind: 'desktop' });
  }
  return items;
}

function renderBoard() {
  const root = $('#view-board');
  const items = boardItems();
  const zoom = h('div', { class: 'zoom' },
    h('button', { class: 'zbtn', title: 'Afastar e ver mais de uma vez (Ctrl+roda do mouse)', disabled: boardCols >= 6, onclick: () => setCols(boardCols + 1) }, icon('minus', 14)),
    h('span', null, ZOOM_LABEL[boardCols]),
    h('button', { class: 'zbtn', title: 'Aproximar', disabled: boardCols <= 1, onclick: () => setCols(boardCols - 1) }, icon('plus', 14)));
  const head = h('div', { class: 'board-head' },
    h('span', { class: 'hint' }, items.length ? 'Digite direto em qualquer quadro. Clique duas vezes no título para assumir em tela cheia.' : ''),
    S.agents.length ? h('button', { class: 'btn small', onclick: startAllAgents }, icon('play', 14), 'Abrir todos os agentes') : null,
    h('button', { class: 'btn small', onclick: openLocalTerminal }, icon('term', 14), 'Terminal do Windows'),
    zoom);

  if (!items.length) {
    root.replaceChildren(head, h('div', { class: 'empty' },
      h('div', null, 'Nada aberto. O que você abrir aparece aqui, lado a lado.'),
      h('div', { class: 'row' },
        S.agents.length ? h('button', { class: 'btn primary', onclick: startAllAgents }, icon('play'), 'Abrir todos os agentes') : h('button', { class: 'btn primary', onclick: () => editAgent() }, icon('plus'), 'Novo agente'),
        h('button', { class: 'btn', onclick: () => go('home') }, 'Ver conexões'))));
    return;
  }

  const rows = Math.ceil(items.length / boardCols);
  const tiles = h('div', { class: 'tiles', style: { '--cols': boardCols, '--row-h': rows <= 2 ? '1fr' : `${Math.max(180, 900 / boardCols)}px` } });
  for (const it of items) {
    const body = h('div', { class: 'tile-body' });
    const takeOver = () => { if (it.kind === 'desktop') setView(it.ws, 'desktop'); else if (it.ws.connId) setView(it.ws, 'term'); go(it.ws.id); };
    const ended = it.kind === 'term' ? it.T.ended : (it.ws.rdp?.ended || it.ws.vnc?.ended);
    const where = it.ws.connId ? (conn(it.ws.connId)?.host || '') : (it.ws.subtitle || '');
    tiles.append(h('div', { class: 'tile' },
      h('div', { class: 'tile-head', ondblclick: takeOver },
        h('span', { class: 'dot' + (ended ? '' : ' live'), style: { '--c': ended ? 'var(--faint)' : (it.ws.color || 'var(--ok)') } }),
        h('span', { class: 'name' }, it.ws.title),
        h('span', { class: 'where' }, it.kind === 'desktop' ? 'tela' : where),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn icon ghost small', title: 'Assumir em tela cheia', onclick: takeOver }, icon('maximize', 14)),
        h('button', { class: 'btn icon ghost small', title: 'Fechar', onclick: () => closeWs(it.ws) }, icon('x', 14))),
      body));
    if (it.kind === 'term') {
      it.T.xterm.options.fontSize = FONT_BY_COLS[boardCols];
      body.append(it.T.el);
    } else {
      body.append(h('div', { class: 'tile-placeholder', onclick: takeOver },
        h('div', null, icon('monitor', 22), h('div', { style: { marginTop: '8px' } }, ended ? 'Sessão encerrada' : 'Área de trabalho remota. Clique para abrir.'))));
    }
  }
  root.replaceChildren(head, tiles);
  requestAnimationFrame(() => items.forEach(it => { if (it.T) try { it.T.fit.fit(); } catch { } }));
}

function setCols(n) {
  boardCols = Math.min(6, Math.max(1, n));
  try { localStorage.setItem('ponte.cols', boardCols); } catch { }
  renderBoard();
}

// Put every terminal back in its own tab after leaving the board.
function returnTermsHome() {
  for (const ws of workspaces) {
    const T = ws.term;
    if (T && T.el.parentElement !== T.home) {
      T.home.append(T.el);
      T.xterm.options.fontSize = BASE_FONT;
    }
  }
}

function fitVisible(ws) { if (ws.term && !ws.panes.term.hidden) try { ws.term.fit.fit(); } catch { } }

$('#view-board').addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setCols(boardCols + (e.deltaY > 0 ? 1 : -1));
}, { passive: false });

// ---------------- dialogs ----------------

function overlay(content, { onClose } = {}) {
  const ov = h('div', { class: 'overlay' }, content);
  const close = () => {
    if (!ov.isConnected) return;
    ov.remove(); overlayCount--; layoutRdp(); onClose?.();
    document.removeEventListener('keydown', esc, true);
  };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  document.addEventListener('keydown', esc, true);
  document.body.append(ov);
  overlayCount++; layoutRdp();
  return close;
}

function modal(title, body, foot) {
  let close;
  const el = h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
    h('div', { class: 'modal-head' }, title), h('div', { class: 'modal-body' }, body), h('div', { class: 'modal-foot' }, foot));
  close = overlay(el);
  setTimeout(() => el.querySelector('input:not([type=checkbox]), select, button.primary')?.focus(), 30);
  return close;
}

function promptText(title, hint, { value = '', placeholder = '', password = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const input = h('input', { value, placeholder, type: password ? 'password' : 'text' });
    const finish = v => { if (done) return; done = true; resolve(v); close(); };
    input.onkeydown = e => { if (e.key === 'Enter') finish(input.value.trim()); };
    const close = modal(title, h('label', { class: 'field' }, hint ? h('span', null, hint) : null, input), [
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: () => finish(input.value.trim()) }, 'OK')]);
    const obs = new MutationObserver(() => { if (!input.isConnected) { obs.disconnect(); if (!done) { done = true; resolve(null); } } });
    obs.observe(document.body, { childList: true });
    setTimeout(() => input.select(), 40);
  });
}

function confirmBox(title, text, okLabel = 'Confirmar') {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); close(); };
    const close = modal(title, h('div', { style: { color: 'var(--muted)' } }, text), [
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: () => finish(true) }, okLabel)]);
    const obs = new MutationObserver(() => { if (!document.querySelector('.overlay')) { obs.disconnect(); if (!done) { done = true; resolve(false); } } });
    obs.observe(document.body, { childList: true });
  });
}

function seg(options, value, onChange) {
  const el = h('div', { class: 'seg' });
  const draw = v => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  options.forEach(([v, label]) => el.append(h('button', { type: 'button', 'data-v': v, onclick: () => { draw(v); onChange(v); } }, label)));
  draw(value);
  return el;
}

function field(label, input, small) {
  return h('label', { class: 'field' }, h('span', null, label), input, small ? h('small', null, small) : null);
}

function editConnection(existing) {
  const c = existing ? { ...existing } : {
    id: '', name: '', os: 'linux', host: '', user: '', domain: '', keyPath: '', desktop: 'none', ssh: true,
    sshPort: 22, rdpPort: 3389, vncPort: 5900, group: '', color: '', redirectDrives: false, redirectClipboard: true,
  };
  const inp = (key, attrs = {}) => h('input', { value: c[key] ?? '', ...attrs, oninput: e => { c[key] = attrs.type === 'number' ? Number(e.target.value) : e.target.value; } });
  let password, vncPassword;

  const passInput = h('input', { type: 'password', placeholder: existing?.hasPassword ? 'Salva. Digite só se quiser trocar.' : '', autocomplete: 'new-password', oninput: e => { password = e.target.value; } });
  const keyInput = inp('keyPath', { placeholder: 'Opcional' });
  const groups = [...new Set(S.connections.map(x => x.group).filter(Boolean))];
  const groupInput = inp('group', { list: 'groups-list', placeholder: 'Opcional, ex.: Casa, Clientes' });

  const desktopBox = h('div');
  const sshBox = h('div');
  const swatches = h('div', { class: 'swatches' }, COLORS.map(col => h('button', {
    type: 'button', class: 'swatch' + (col ? '' : ' none') + (c.color === col ? ' on' : ''), style: { '--c': col }, title: col ? '' : 'Sem cor',
    onclick: e => { c.color = col; swatches.querySelectorAll('.swatch').forEach(s => s.classList.remove('on')); e.currentTarget.classList.add('on'); },
  })));

  const drawOs = () => {
    if (c.os === 'windows') {
      c.desktop = 'rdp';
      desktopBox.replaceChildren();
      sshBox.replaceChildren(h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: c.ssh, onchange: e => { c.ssh = e.target.checked; } }),
        'Esta máquina tem SSH (dá terminal e arquivos além da tela)'));
    } else {
      desktopBox.replaceChildren(field('Tela', seg([['none', 'Só terminal'], ['rdp', 'RDP (xrdp)'], ['vnc', 'VNC']], c.desktop, v => { c.desktop = v; }),
        'Terminal e arquivos usam SSH. A tela é opcional.'));
      c.ssh = true;
      sshBox.replaceChildren(field('Chave SSH', h('div', { class: 'with-btn' }, keyInput,
        h('button', { type: 'button', class: 'btn', onclick: async () => { const { path } = await call('pick.key'); if (path) { keyInput.value = path; c.keyPath = path; } } }, 'Escolher')),
        'Se usar chave, a senha acima vale como senha da chave.'));
    }
  };
  drawOs();

  const body = [
    field('Nome', inp('name', { placeholder: 'Servidor de casa' })),
    field('Sistema', seg([['linux', 'Linux'], ['windows', 'Windows']], c.os, v => { c.os = v; if (v === 'linux' && c.desktop === 'rdp' && !existing) c.desktop = 'none'; drawOs(); })),
    field('Endereço', inp('host', { placeholder: '192.168.0.10 ou servidor.exemplo.com', spellcheck: 'false' })),
    h('div', { class: 'row2' }, field('Usuário', inp('user', { spellcheck: 'false' })), field('Senha', passInput)),
    desktopBox,
    sshBox,
    h('div', { class: 'row2' }, field('Grupo', groupInput), field('Cor', swatches)),
    h('datalist', { id: 'groups-list' }, groups.map(g => h('option', { value: g }))),
    h('details', { class: 'more' }, h('summary', null, 'Mais opções'), h('div', null,
      h('div', { class: 'row3' },
        field('Porta SSH', inp('sshPort', { type: 'number', min: 1, max: 65535 })),
        field('Porta RDP', inp('rdpPort', { type: 'number', min: 1, max: 65535 })),
        field('Porta VNC', inp('vncPort', { type: 'number', min: 1, max: 65535 }))),
      h('div', { class: 'row2' },
        field('Domínio (Windows)', inp('domain', { placeholder: 'Opcional' })),
        field('Senha do VNC', h('input', { type: 'password', placeholder: existing?.hasVncPassword ? 'Salva' : 'Se for diferente da senha', oninput: e => { vncPassword = e.target.value; } }))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.redirectClipboard, onchange: e => { c.redirectClipboard = e.target.checked; } }), 'Copiar e colar entre os computadores (RDP)'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.redirectDrives, onchange: e => { c.redirectDrives = e.target.checked; } }), 'Mostrar meus discos na máquina remota (RDP)'))),
  ];

  const save = async connect => {
    if (!c.host.trim()) { toast('Falta o endereço.', { error: true }); return; }
    const payload = { ...c };
    if (password !== undefined) payload.password = password;
    if (vncPassword !== undefined) payload.vncPassword = vncPassword;
    try {
      const id = await call('conn.save', { conn: payload });
      close();
      // reopen tabs with the new settings next time
      const ws = workspaces.find(w => w.connId === id);
      if (ws && existing) toast('Salvo. Feche e abra a aba para usar as mudanças.');
      if (connect) setTimeout(() => openConn(id), 50);
    } catch (err) { toast(err.message, { error: true }); }
  };

  const close = modal(existing ? `Editar ${existing.name}` : 'Nova conexão', body, [
    existing ? h('button', { class: 'btn ghost danger', onclick: async () => {
      if (await confirmBox(`Apagar ${existing.name}?`, 'A conexão e a senha salva saem do Ponte. Nada muda no servidor.', 'Apagar')) {
        await call('conn.delete', { connId: existing.id }); close();
      }
    } }, 'Apagar') : null,
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', onclick: () => close() }, 'Cancelar'),
    h('button', { class: 'btn', onclick: () => save(false) }, 'Salvar'),
    h('button', { class: 'btn primary', onclick: () => save(true) }, 'Salvar e conectar')]);
}

function editAgent(existing) {
  const a = existing ? { ...existing } : { id: '', name: '', command: 'claude', cwd: '', target: 'local' };
  const nameInput = h('input', { value: a.name, placeholder: 'Ex.: Claude no projeto X', oninput: e => { a.name = e.target.value; } });
  const cmdInput = h('input', { value: a.command, spellcheck: 'false', oninput: e => { a.command = e.target.value; drawChips(); } });
  const chips = h('div', { class: 'chips' });
  const drawChips = () => chips.replaceChildren(...AGENT_PRESETS.map(p => h('button', {
    type: 'button', class: 'chip' + (a.command === p.command ? ' on' : ''),
    onclick: () => { a.command = p.command; cmdInput.value = p.command; if (!a.name || AGENT_PRESETS.some(x => x.name === a.name)) { a.name = p.name; nameInput.value = p.name; } drawChips(); },
  }, p.name)));
  drawChips();

  const linux = S.connections.filter(c => c.ssh);
  const cwdInput = h('input', { value: a.cwd, spellcheck: 'false', oninput: e => { a.cwd = e.target.value; } });
  const pickBtn = h('button', { type: 'button', class: 'btn', onclick: async () => { const { path } = await call('pick.dir'); if (path) { cwdInput.value = path; a.cwd = path; } } }, 'Escolher');
  const drawTarget = () => {
    pickBtn.hidden = a.target !== 'local';
    cwdInput.placeholder = a.target === 'local' ? 'C:\\projetos\\meu-app' : '/home/voce/projeto';
  };
  const targetSel = h('select', { onchange: e => { a.target = e.target.value; drawTarget(); } },
    h('option', { value: 'local', selected: a.target === 'local' }, 'Este PC'),
    linux.map(c => h('option', { value: c.id, selected: a.target === c.id }, `${c.name} (SSH)`)));
  drawTarget();

  const save = async start => {
    if (!a.command.trim()) { toast('Falta o comando.', { error: true }); return; }
    try {
      const id = await call('agent.save', { agent: a });
      close();
      if (start) setTimeout(() => openAgent(id), 50);
    } catch (err) { toast(err.message, { error: true }); }
  };

  const close = modal(existing ? `Editar ${existing.name}` : 'Novo agente', [
    field('Programa', chips),
    field('Comando', cmdInput, 'O que você digitaria no terminal. Ex.: claude --continue'),
    field('Nome', nameInput),
    h('div', { class: 'row2' }, field('Onde roda', targetSel), field('Pasta', h('div', { class: 'with-btn' }, cwdInput, pickBtn))),
  ], [
    existing ? h('button', { class: 'btn ghost danger', onclick: async () => { await call('agent.delete', { agentId: existing.id }); close(); } }, 'Apagar') : null,
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', onclick: () => close() }, 'Cancelar'),
    h('button', { class: 'btn', onclick: () => save(false) }, 'Salvar'),
    h('button', { class: 'btn primary', onclick: () => save(true) }, 'Salvar e abrir')]);
}

function newMenu() {
  let close;
  const pick = fn => () => { close(); fn(); };
  const item = (ic, title, sub, fn) => h('button', { class: 'card', style: { flexDirection: 'row', alignItems: 'center', gap: '12px' }, onclick: pick(fn) },
    icon(ic, 20), h('div', null, h('div', { class: 'card-name' }, title), h('div', { style: { color: 'var(--muted)', fontSize: '12.5px' } }, sub)));
  close = modal('Criar', [
    item('monitor', 'Conexão', 'Windows ou Linux: tela, terminal e arquivos', () => editConnection()),
    item('bot', 'Agente', 'Claude Code, Codex, Gemini ou outro programa', () => editAgent()),
    item('term', 'Terminal do Windows', 'PowerShell neste PC, sem salvar', openLocalTerminal),
  ], [h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => close() }, 'Fechar')]);
}

function settings() {
  let close;
  close = modal('Ajustes', [
    h('div', { class: 'field' }, h('span', null, 'mRemoteNG'),
      h('div', { class: 'with-btn' },
        h('button', { class: 'btn', onclick: () => { close(); importMremote(); } }, icon('import', 14), 'Trazer conexões do mRemoteNG'),
        h('button', { class: 'btn ghost', onclick: () => { close(); importMremote(true); } }, 'Escolher outro arquivo')),
      h('small', null, 'Lê o confCons.xml e traz RDP, SSH e VNC com as senhas.')),
    h('div', { class: 'field' }, h('span', null, 'Chaves de servidores SSH'),
      h('div', null, h('button', { class: 'btn', onclick: async () => { await call('hostkey.forget'); toast('Pronto. Na próxima conexão o Ponte aceita a chave nova.'); } }, icon('key', 14), 'Esquecer chaves salvas')),
      h('small', null, 'Use se um servidor foi reinstalado e o Ponte avisa que a chave mudou.')),
    h('div', { class: 'field' }, h('span', null, 'Atalhos'),
      h('small', { style: { fontSize: '12.5px', lineHeight: '1.8' } },
        'Ctrl+K busca · Ctrl+N nova conexão · Ctrl+1 início · Ctrl+2 quadro · Ctrl+3 em diante, abas · Ctrl+Tab próxima aba · Ctrl+Shift+W fecha a aba')),
  ], [h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => close() }, 'Fechar')]);
}

async function importMremote(pick = false) {
  try {
    const { count } = await call('import.mremoteng', { pick });
    toast(count ? `${count} conexão(ões) trazidas do mRemoteNG.` : 'Nenhuma conexão RDP, SSH ou VNC encontrada no arquivo.');
  } catch (err) { toast(err.message, { error: true }); }
}

// ---------------- command palette ----------------

function palette() {
  if (document.querySelector('.palette')) return;
  const input = h('input', { placeholder: 'Conectar, abrir agente ou fazer algo…', spellcheck: 'false' });
  const list = h('ul');
  let items = [], sel = 0;

  const all = () => [
    ...S.connections.map(c => ({ ic: c.os === 'windows' ? 'monitor' : 'term', title: c.name, sub: c.host, keys: `${c.name} ${c.host} ${c.group} ${c.user}`, run: () => openConn(c.id) })),
    ...S.connections.filter(hasShell).map(c => ({ ic: 'folder', title: `Arquivos de ${c.name}`, sub: c.host, keys: `arquivos files sftp ${c.name} ${c.host}`, run: () => openConn(c.id, 'files') })),
    ...S.agents.map(a => ({ ic: 'bot', title: a.name, sub: a.command, keys: `agente ${a.name} ${a.command}`, run: () => openAgent(a.id) })),
    ...workspaces.map(ws => ({ ic: 'enter', title: `Ir para ${ws.title}`, sub: 'aba aberta', keys: `aba ${ws.title}`, run: () => go(ws.id) })),
    { ic: 'plus', title: 'Nova conexão', keys: 'nova conexao criar adicionar', run: () => editConnection() },
    { ic: 'plus', title: 'Novo agente', keys: 'novo agente claude codex gemini', run: () => editAgent() },
    { ic: 'term', title: 'Terminal do Windows', keys: 'terminal powershell local', run: openLocalTerminal },
    { ic: 'grid', title: 'Quadro', keys: 'quadro board tudo', run: () => go('board') },
    { ic: 'play', title: 'Abrir todos os agentes', keys: 'abrir todos agentes', run: startAllAgents },
    { ic: 'import', title: 'Trazer do mRemoteNG', keys: 'importar mremoteng', run: () => importMremote() },
    { ic: 'gear', title: 'Ajustes', keys: 'ajustes configuracoes', run: settings },
  ];

  const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const draw = () => {
    const q = norm(input.value).split(/\s+/).filter(Boolean);
    items = all().filter(it => q.every(w => norm(`${it.title} ${it.keys}`).includes(w))).slice(0, 40);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.replaceChildren(...(items.length ? items.map((it, i) => h('li', {
      class: i === sel ? 'on' : '', onmousemove: () => { if (sel !== i) { sel = i; draw(); } }, onclick: () => runItem(i),
    }, icon(it.ic), h('span', null, it.title), it.sub ? h('span', { class: 'sub' }, it.sub) : null)) : [h('div', { class: 'none' }, 'Nada encontrado.')]));
    list.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
  };
  const runItem = i => { const it = items[i]; if (!it) return; close(); setTimeout(it.run, 10); };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = (sel + 1) % Math.max(1, items.length); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + items.length) % Math.max(1, items.length); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') runItem(sel);
  };
  const close = overlay(h('div', { class: 'palette' }, input, list));
  draw();
  setTimeout(() => input.focus(), 20);
}

// ---------------- voice ----------------

let listening = false;
async function voice() {
  const btn = $('#btn-voice');
  if (listening) { call('voice.stop'); return; }
  const target = lastTerm && !lastTerm.ended ? lastTerm : null;
  if (!target) { toast('Clique num terminal primeiro. O que você falar vai ser digitado nele.'); return; }
  listening = true; btn.classList.add('listening'); btn.title = 'Ouvindo… clique para parar';
  try {
    const { text } = await call('voice.listen');
    if (text) { send('term.input', { sid: target.sid, data: text }); target.xterm.focus(); }
    else toast('Não entendi. Tente de novo, mais perto do microfone.');
  } catch (err) { toast(err.message, { error: true }); }
  finally { listening = false; btn.classList.remove('listening'); btn.title = 'Falar para o terminal'; }
}

// ---------------- shortcuts ----------------

function globalShortcut(e) {
  const k = e.key.toLowerCase();
  const inTerm = e.target?.classList?.contains('xterm-helper-textarea');
  if (e.ctrlKey && k === 'k' && (!inTerm || e.shiftKey)) { palette(); return true; }
  if (e.ctrlKey && e.shiftKey && k === 'w') { const ws = workspaces.find(w => w.id === route); if (ws) closeWs(ws); return true; }
  if (e.ctrlKey && k === 'tab') {
    const order = ['home', 'board', ...workspaces.map(w => w.id)];
    const i = order.indexOf(route);
    go(order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length]);
    return true;
  }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
    const n = Number(e.key);
    const target = n === 1 ? 'home' : n === 2 ? 'board' : workspaces[n - 3]?.id;
    if (target) { go(target); return true; }
  }
  if (e.ctrlKey && !e.shiftKey && k === 'n' && !inTerm) { editConnection(); return true; }
  return false;
}

document.addEventListener('keydown', e => {
  if (document.querySelector('.overlay')) return;
  if (globalShortcut(e)) e.preventDefault();
});

// ---------------- boot ----------------

hydrateIcons();
$('#btn-search').onclick = palette;
$('#btn-new').onclick = newMenu;
$('#btn-settings').onclick = settings;
$('#btn-voice').onclick = voice;

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  for (const ws of workspaces) if (ws.term) ws.term.xterm.options.theme = termTheme();
});

renderTabs();
renderHome();
call('ready').then(setState).catch(err => toast(err.message, { error: true }));

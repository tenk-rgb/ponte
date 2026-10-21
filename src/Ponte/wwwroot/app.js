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

import { ICONS } from './icons.js';
import { PONTE_ICONS } from './icons-ponte.js';
// Ponte's own set wins; Lucide fills the generic actions. Old names map onto the set.
const ICON_ALIAS = { monitor: 'pc', laptop: 'pc', cpu: 'chip', bot: 'agent', term: 'terminal', folder: 'files', grid: 'board' };

function icon(name, size = 16) {
  return h('span', {
    class: 'ic', 'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PONTE_ICONS[ICON_ALIAS[name] || name] || ICONS[name] || ''}</svg>`,
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
    case 'win.state':
      document.body.classList.toggle('max', !!m.max);
      $('#win-max').title = m.max ? 'Restaurar' : 'Maximizar';
      layoutRdp();
      break;
  }
});

// ---------------- state ----------------

const S = { connections: [], agents: [] };
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
  if (to === 'home') { renderHome(); probe(); }
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
    h('button', { class: 'tab fixed' + (route === 'home' ? ' active' : ''), onclick: () => go('home'), title: 'Início' },
      icon('home'), h('span', { class: 'name' }, 'Início')),
    h('button', { class: 'tab fixed' + (route === 'board' ? ' active' : ''), onclick: () => go('board'), title: 'Tudo o que está aberto, lado a lado' },
      icon('grid'), h('span', { class: 'name' }, 'Quadro'), live ? h('span', { class: 'count' }, live) : null),
  );
  workspaces.forEach((ws, i) => {
    const running = [...sessions.values()].some(s => s.ws === ws && !s.ended);
    tabs.append(h('button', {
      class: 'tab' + (route === ws.id ? ' active' : ''), title: `${ws.title} (Ctrl+${i + 3})`,
      onclick: () => go(ws.id),
      onauxclick: e => { if (e.button === 1) closeWs(ws); },
    },
      h('span', { class: 'dot' + (running ? ' live' : ''), style: { '--c': ws.color || '' } }),
      h('span', { class: 'name' }, ws.title),
      h('span', { class: 'close', title: 'Fechar', onclick: e => { e.stopPropagation(); closeWs(ws); } }, icon('x', 13)),
    ));
  });
}

// ---------------- home ----------------
// Focal point: one field that searches, filters and connects. Below it, recents, then a dense list.

let homeQuery = '';
const reach = new Map();          // connId -> true | false (port answered)
let homeBuilt = false;
const home = {};

function timeAgo(iso) {
  if (!iso) return 'nunca';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'ontem' : d < 30 ? `há ${d} dias` : new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

const looksLikeHost = q => /^[\w.-]+@[\w.-]+(:\d+)?$|^[\w-]+(\.[\w-]+)+(:\d+)?$|^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(q.trim());

function matches(c, q) {
  if (!q) return true;
  const n = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return n(q).split(/\s+/).every(w => [c.name, c.host, c.user, c.group].some(v => n(v).includes(w)));
}

function buildHome() {
  const root = $('#view-home');
  home.input = h('input', {
    placeholder: 'Nome, endereço ou usuario@servidor', spellcheck: 'false', 'aria-label': 'Conectar a',
    oninput: e => { homeQuery = e.target.value; renderHome(); },
    onkeydown: e => {
      if (e.key === 'Enter') connectFromQuery();
      if (e.key === 'Escape') { e.target.value = homeQuery = ''; renderHome(); }
    },
  });
  home.hint = h('p', { class: 'hint' });
  home.list = h('div');
  home.side = h('aside', { class: 'home-side' });
  root.replaceChildren(h('div', { class: 'home-inner' },
    h('div', { class: 'home-main' },
      h('div', { class: 'hero' },
        h('h1', null, 'Conectar'),
        h('label', { class: 'connect' }, icon('link', 20), home.input, h('kbd', null, 'Enter')),
        home.hint),
      home.list),
    home.side));
  homeBuilt = true;
}

// ----- side column: reachability with latency, and the agents -----

const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  el.append(...kids.filter(Boolean));
  return el;
}

// reach: connId -> connect time in ms, or -1 when the port did not answer
const isUp = id => (reach.get(id) ?? -1) >= 0;

function machineIcon(c) {
  if (c.os === 'windows') return 'pc';
  if (/raspberry|pi\b|arduino|esp/i.test(c.name)) return 'chip';
  return hasDesktop(c) ? 'pc' : 'server';
}

// ----- groups: one collapse state shared by the list and the Rede panel, remembered between runs -----
let collapsedGroups = {};
try { collapsedGroups = JSON.parse(localStorage.getItem('ponte.groups') || '{}'); } catch { }

// With many machines, groups start collapsed; a group the user opened or closed keeps that choice.
function isCollapsed(group) {
  return group in collapsedGroups ? collapsedGroups[group] : S.connections.length > 12;
}

function setCollapsed(groups, value) {
  for (const g of groups) collapsedGroups[g] = value;
  try { localStorage.setItem('ponte.groups', JSON.stringify(collapsedGroups)); } catch { }
  renderHome();
}

function groupStats(items) {
  const up = items.filter(c => isUp(c.id));
  const checked = items.filter(c => reach.has(c.id)).length;
  const avg = up.length ? Math.round(up.reduce((s, c) => s + reach.get(c.id), 0) / up.length) : null;
  return { total: items.length, up: up.length, down: checked - up.length, checked, avg };
}

function statsLine(st) {
  const machines = `${st.total} ${st.total === 1 ? 'máquina' : 'máquinas'}`;
  if (!st.checked) return h('span', { class: 'gstats' }, h('span', null, machines), h('span', null, 'verificando…'));
  return h('span', { class: 'gstats' },
    h('span', null, machines),
    h('span', { class: 'on' }, h('i', { class: 'led on' }), `${st.up} online`),
    h('span', { class: 'off' }, h('i', { class: 'led' }), `${st.down} offline`),
    st.avg != null ? h('span', { class: 'ms' }, `${st.avg} ms`) : null);
}

const groupLabel = g => g || 'Sem grupo';
// named groups alphabetically, the ungrouped ones last
const groupsOf = list => [...Map.groupBy(list, c => c.group || '')].sort((a, b) => (!a[0]) - (!b[0]) || a[0].localeCompare(b[0]));

function reachRow(c) {
  const ms = reach.get(c.id);
  const known = reach.has(c.id);
  const up = isUp(c.id);
  const pct = up ? Math.max(6, Math.round(100 - Math.min(ms, 1000) / 10)) : 0;
  return h('button', {
    class: 'reach-row ' + (up ? 'on' : known ? 'off' : ''), onclick: () => openConn(c.id),
    title: up ? `${c.name} respondeu em ${ms} ms` : known ? `${c.name} não respondeu` : `${c.name}, ainda verificando`,
  },
    icon(machineIcon(c), 18),
    h('span', { class: 'name' }, c.name),
    h('span', { class: 'bar' }, h('i', { style: { '--w': pct + '%' } })),
    h('span', { class: 'ms' }, up ? `${ms} ms` : known ? 'sem resposta' : '…'));
}

const byReach = (a, b) => {
  const ua = isUp(a.id), ub = isUp(b.id);
  if (ua !== ub) return ua ? -1 : 1;
  return (reach.get(a.id) ?? 9999) - (reach.get(b.id) ?? 9999) || a.name.localeCompare(b.name);
};

function reachList() {
  const groups = groupsOf(S.connections);
  if (groups.length <= 1) return h('div', { class: 'reach' }, [...S.connections].sort(byReach).map(reachRow));
  return h('div', { class: 'reach' }, groups.map(([g, items]) => {
    const st = groupStats(items);
    const open = !isCollapsed(g);
    return [
      h('button', {
        class: 'reach-group' + (open ? ' open' : ''), 'aria-expanded': String(open),
        onclick: () => setCollapsed([g], open),
        title: open ? 'Recolher' : 'Mostrar as máquinas',
      },
        icon('chevron', 16),
        h('span', { class: 'gtext' }, h('span', { class: 'name' }, groupLabel(g)), statsLine(st)),
        h('span', { class: 'gright', title: `${st.up} de ${st.total} respondendo` },
          h('span', { class: 'gms' + (st.avg != null ? ' on' : '') }, st.avg != null ? `${st.avg} ms` : '—'),
          h('span', { class: 'ratio' }, h('i', { style: { '--w': (st.total ? Math.round(st.up / st.total * 100) : 0) + '%' } })))),
      open ? h('div', { class: 'reach-children' }, [...items].sort(byReach).map(reachRow)) : null,
    ];
  }).flat().filter(Boolean));
}

function lastLines(T, n = 3) {
  const b = T.xterm.buffer.active;
  const out = [];
  for (let y = b.baseY + b.cursorY; y >= 0 && out.length < n; y--) {
    const line = b.getLine(y)?.translateToString(true).trimEnd();
    if (line) out.unshift(line);
  }
  return out.join('\n');
}

function agentTail(a) {
  const ws = workspaces.find(w => w.agentId === a.id);
  if (!ws?.term) return 'Parado. Clique para abrir.';
  if (ws.term.ended) return 'Terminou. Clique para ver.';
  return lastLines(ws.term) || 'Iniciando…';
}

function renderSide() {
  const online = S.connections.filter(c => isUp(c.id)).length;
  const net = S.connections.length
    ? h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', null, 'Rede'),
        h('span', { class: 'hint' }, reach.size ? `${online} de ${S.connections.length} respondendo` : 'verificando…')),
      reachList(),
      h('div', { class: 'reach-foot' },
        h('span', null, icon('activity', 13), 'tempo até a porta responder'),
        h('span', null, icon('refresh', 13), 'a cada 30 s')))
    : null;

  const agents = S.agents.map(a => {
    const ws = workspaces.find(w => w.agentId === a.id);
    const live = ws?.term && !ws.term.ended;
    const where = a.target === 'local' ? 'Este PC' : (conn(a.target)?.name || 'Conexão removida');
    return h('div', {
      class: 'agent' + (live ? ' live' : ''), tabindex: 0, role: 'button', 'aria-label': `Abrir ${a.name}`,
      onclick: () => openAgent(a.id), onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openAgent(a.id); },
    },
      h('div', { class: 't' }, h('span', { class: 'dot' + (live ? ' live' : '') }), a.name,
        h('span', { class: 'st' }, live ? 'rodando' : 'parado'),
        h('button', { class: 'btn ghost icon small edit', title: 'Editar', 'aria-label': `Editar ${a.name}`, onclick: e => { e.stopPropagation(); editAgent(a); } }, icon('edit', 14))),
      h('div', { class: 'where' }, `${where}: ${a.command}`),
      h('pre', { 'data-agent': a.id }, agentTail(a)));
  });

  home.side.replaceChildren(...[
    net,
    h('section', null,
      h('div', { class: 'section-head' },
        h('h2', null, 'Agentes'),
        h('span', { class: 'spacer' }),
        S.agents.length > 1 ? h('button', { class: 'btn ghost small', onclick: startAllAgents, title: 'Abrir todos no quadro' }, icon('play', 16), 'Todos') : null,
        h('button', { class: 'btn small', onclick: () => editAgent() }, icon('plus', 16), 'Novo')),
      S.agents.length ? h('div', { class: 'agents' }, agents)
        : h('div', { class: 'empty-line' }, 'Agentes de IA ou qualquer programa de terminal, no seu PC ou num servidor Linux.'))].filter(Boolean));
}

// keep the agents' tails live while Início is on screen
setInterval(() => {
  if (route !== 'home' || document.hidden) return;
  for (const pre of document.querySelectorAll('#view-home pre[data-agent]')) {
    const a = agent(pre.dataset.agent);
    if (a) { const t = agentTail(a); if (pre.textContent !== t) pre.textContent = t; }
  }
}, 1500);

function filteredConnections() {
  return S.connections.filter(c => matches(c, homeQuery));
}

function connectFromQuery() {
  const q = homeQuery.trim();
  const list = filteredConnections();
  if (list.length && q) return openConn(list[0].id);
  if (looksLikeHost(q)) return quickConnect(q);
}

// An address that isn't saved yet opens the new-connection form, already filled in.
function quickConnect(q) {
  let user = '', host = q;
  if (q.includes('@')) [user, host] = q.split('@');
  editConnection(null, { host, user, name: host });
}

function stateMark(c) {
  const up = isUp(c.id), known = reach.has(c.id);
  return h('span', {
    class: 'state ' + (up ? 'on' : known ? 'off' : 'unknown'),
    style: { '--c': c.color || '' },
    title: up ? `Respondeu em ${reach.get(c.id)} ms` : known ? 'Não respondeu agora' : '',
  });
}

function connActions(c, small = true) {
  const b = (ic, label, view) => h('button', {
    class: `btn ghost icon${small ? ' small' : ''}`, title: label, 'aria-label': `${label} de ${c.name}`,
    onclick: e => { e.stopPropagation(); openConn(c.id, view); },
  }, icon(ic, 16));
  const out = [];
  if (hasDesktop(c)) out.push(b('screen', 'Tela', 'desktop'));
  if (hasShell(c)) out.push(b('term', 'Terminal', 'term'), b('folder', 'Arquivos', 'files'));
  out.push(h('button', { class: 'btn ghost icon small', title: 'Editar', 'aria-label': `Editar ${c.name}`, onclick: e => { e.stopPropagation(); editConnection(c); } }, icon('edit', 16)));
  return out;
}

function renderHome() {
  if (!homeBuilt) buildHome();
  const q = homeQuery.trim();
  const list = filteredConnections().sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const live = [...sessions.values()].filter(s => !s.ended).length;

  // hint under the field says what Enter will do
  home.hint.replaceChildren();
  if (q && list.length) home.hint.append('Enter conecta a ', h('b', null, list[0].name), '.');
  else if (q && looksLikeHost(q)) home.hint.append('Enter abre uma conexão nova com ', h('b', null, q), '.');
  else if (q) home.hint.append('Nada salvo com esse nome.');
  else if (S.connections.length) home.hint.append(`${S.connections.length} ${S.connections.length === 1 ? 'conexão salva' : 'conexões salvas'}` + (live ? `, ${live} ${live === 1 ? 'sessão aberta' : 'sessões abertas'}.` : '.'));
  else home.hint.append('Digite um endereço para a primeira conexão, ou importe suas configurações em Ajustes.');

  const out = [];

  // recents: only when not searching
  const recent = S.connections.filter(c => c.lastUsed).sort((a, b) => b.lastUsed.localeCompare(a.lastUsed)).slice(0, 3);
  if (!q && recent.length) {
    out.push(h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, 'Recentes')),
      h('div', { class: 'recents' }, recent.map(c => h('button', { class: 'recent', onclick: () => openConn(c.id) },
        h('div', { class: 'top' }, stateMark(c), c.os === 'windows' ? 'Windows' : 'Linux', h('span', { style: { marginLeft: 'auto' } }, timeAgo(c.lastUsed))),
        h('div', { class: 'name' }, c.name),
        h('div', { class: 'sub' }, c.user ? `${c.user}@${c.host}` : c.host),
        h('div', { class: 'go' }, hasDesktop(c) ? icon('screen', 16) : icon('terminal', 16), hasDesktop(c) ? 'Abrir a tela' : 'Abrir o terminal'))))));
  }

  // all connections
  const head = h('div', { class: 'section-head' },
    h('h2', null, q ? 'Resultados' : 'Todas as conexões'),
    h('span', { class: 'spacer' }),
    !q && groupsOf(S.connections).length > 1 ? (() => {
      const names = groupsOf(S.connections).map(([g]) => g);
      const allClosed = names.every(isCollapsed);
      return h('button', { class: 'btn ghost small', onclick: () => setCollapsed(names, !allClosed) },
        icon(allClosed ? 'maximize' : 'minus', 16), allClosed ? 'Expandir tudo' : 'Recolher tudo');
    })() : null,
    !S.connections.length ? h('button', { class: 'btn ghost small', onclick: importConfig }, icon('import', 16), 'Importar configurações') : null,
    h('button', { class: 'btn small', onclick: () => editConnection() }, icon('plus', 16), 'Nova conexão'));
  const body = [];
  if (!S.connections.length) {
    body.push(h('div', { class: 'empty-line' }, 'Nenhuma conexão ainda. Uma conexão pede só endereço, usuário e senha.'));
  } else if (!list.length) {
    body.push(looksLikeHost(q)
      ? h('div', { class: 'quick' }, icon('plus', 18), h('div', { class: 'txt' }, h('b', null, q), ' ainda não está salvo. O formulário abre com o endereço preenchido; falta a senha.'),
        h('button', { class: 'btn primary small', onclick: () => quickConnect(q) }, 'Preencher conexão'))
      : h('div', { class: 'empty-line' }, `Nenhuma conexão com "${q}".`));
  } else {
    const groups = groupsOf(list);
    for (const [group, items] of groups) {
      // while searching every group stays open, so a match is never hidden
      const open = !!q || !isCollapsed(group);
      if (group || groups.length > 1) {
        body.push(h('button', {
          class: 'group-head' + (open ? ' open' : ''), 'aria-expanded': String(open), disabled: !!q,
          onclick: () => setCollapsed([group], open), title: open ? 'Recolher o grupo' : 'Mostrar as máquinas',
        },
          icon('chevron', 16),
          h('span', { class: 'gname' }, groupLabel(group)),
          statsLine(groupStats(items))));
      }
      if (!open) continue;
      body.push(h('div', { class: 'rows' }, items.map(c => h('div', {
        class: 'row', tabindex: 0, role: 'button', 'aria-label': `Conectar a ${c.name}`,
        onclick: () => openConn(c.id), onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openConn(c.id); },
      },
        stateMark(c),
        h('div', { class: 'who' }, h('span', { class: 'name' }, c.name), h('span', { class: 'sub' }, c.user ? `${c.user}@${c.host}` : c.host)),
        h('span', { class: 'os' }, (c.os === 'windows' ? 'Windows' : 'Linux') + (c.desktop === 'vnc' ? ', VNC' : '')),
        h('span', { class: 'when' }, timeAgo(c.lastUsed)),
        h('div', { class: 'acts' }, connActions(c))))));
    }
  }
  out.push(h('section', { class: 'section' }, head, body));

  home.list.replaceChildren(...out);
  renderSide();
}

async function probe() {
  if (!S.connections.length || route !== 'home' || document.hidden) return;
  try {
    const res = await call('probe');
    for (const [id, ok] of Object.entries(res)) reach.set(id, ok);
    renderHome();
  } catch { }
}
setInterval(probe, 30000);


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
    id: 'ws' + Math.random().toString(36).slice(2, 8), since: Date.now(), connId: c.id, title: c.name, color: c.color,
    active: null, term: null, rdp: null, vnc: null, files: { path: '', items: [], sel: null },
  };
  const views = [];
  if (hasDesktop(c)) views.push(['desktop', 'screen', 'Tela']);
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
      h('span', { class: 'dot', style: { '--c': c.color || 'var(--tinta-4)' } }), ws.titleEl, ws.hostEl,
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
  if (route === ws.id) go(workspaces.at(-1)?.id || 'home');
  else { renderTabs(); if (route === 'board') renderBoard(); }
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
    background: cssVar('--terminal'), foreground: cssVar('--terminal-tinta'), cursor: cssVar('--acento'),
    cursorAccent: cssVar('--terminal'),
    selectionBackground: dark ? '#2f3336' : '#cfd9de',
    black: dark ? '#16181c' : '#0f1419', brightBlack: dark ? '#5b6167' : '#536471',
    red: dark ? '#f4212e' : '#c4181f', green: dark ? '#00ba7c' : '#00843f', yellow: dark ? '#ffd400' : '#8a6700',
    blue: dark ? '#1d9bf0' : '#1a6fb0', magenta: dark ? '#f91880' : '#b0105e', cyan: dark ? '#4fd3e7' : '#0e7490',
    white: dark ? '#e7e9ea' : '#cfd9de', brightWhite: '#ffffff',
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
  noteActivity(sid);
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
  const ws = { id: 'ws' + Math.random().toString(36).slice(2, 8), since: Date.now(), agentId, local, title, subtitle, active: 'term', term: null };
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
      class: 'row-f' + (it.dir ? ' dir' : '') + (f.sel === it.name ? ' sel' : ''),
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
// Mission control: everything you can open sits in a launcher strip, and every open session is a live tile
// with an activity sparkline (output per 2 s over the last minute).

const FONT_BY_COLS = { 1: 13.5, 2: 12.5, 3: 11.5, 4: 10.5, 5: 9.5, 6: 9 };
const ZOOM_LABEL = { 1: 'Perto', 2: '2 por linha', 3: '3 por linha', 4: '4 por linha', 5: '5 por linha', 6: 'Tudo' };

const activity = new Map();   // sid -> [timestamps of output chunks in the last 60 s]

function noteActivity(sid) {
  const now = Date.now();
  let list = activity.get(sid);
  if (!list) activity.set(sid, list = []);
  list.push(now);
  if (list.length > 2000 || list[0] < now - 60000) {
    const cut = list.findIndex(t => t >= now - 60000);
    list.splice(0, cut < 0 ? list.length : cut);
  }
  if (route === 'board') bumpTile(sid);
}

function bumpTile(sid) {
  const head = document.querySelector(`.tile[data-sid="${sid}"] .tile-head`);
  if (!head) return;
  head.classList.add('bump');
  clearTimeout(head._bump);
  head._bump = setTimeout(() => head.classList.remove('bump'), 120);
}

function sparkline(sid) {
  const now = Date.now(), bins = 30, span = 60000 / bins;
  const counts = new Array(bins).fill(0);
  for (const t of activity.get(sid) || []) {
    const i = Math.floor((now - t) / span);
    if (i >= 0 && i < bins) counts[bins - 1 - i]++;
  }
  const max = Math.max(1, ...counts);
  const svg = s('svg', { class: 'spark', viewBox: `0 0 ${bins * 2.4} 20`, 'aria-hidden': 'true' });
  counts.forEach((c, i) => {
    const hgt = c ? Math.max(2, Math.round((c / max) * 18)) : 1;
    svg.append(s('rect', { x: i * 2.4, y: 20 - hgt, width: 1.6, height: hgt, rx: .6, class: i >= bins - 2 && c ? 'hot' : '' }));
  });
  return svg;
}

function lastActivity(sid) {
  const list = activity.get(sid);
  return list?.length ? list[list.length - 1] : null;
}

function agoShort(ts) {
  if (!ts) return '';
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 3) return 'agora';
  if (sec < 60) return `há ${sec} s`;
  return `há ${Math.round(sec / 60)} min`;
}

function boardItems() {
  const items = [];
  for (const ws of workspaces) {
    if (ws.term) items.push({ ws, kind: 'term', T: ws.term, sid: ws.term.sid });
    if (ws.rdp || ws.vnc) items.push({ ws, kind: 'desktop', sid: ws.rdp?.sid || ws.id });
  }
  return items;
}

// Everything that can still be opened into the board.
function launchables() {
  const out = [];
  for (const c of S.connections) if (!workspaces.some(w => w.connId === c.id))
    out.push({ kind: 'conn', id: c.id, name: c.name, sub: c.user ? `${c.user}@${c.host}` : c.host,
      ic: machineIcon(c), on: isUp(c.id), run: () => openIntoBoard(() => openConn(c.id)) });
  for (const a of S.agents) if (!workspaces.some(w => w.agentId === a.id))
    out.push({ kind: 'agent', id: a.id, name: a.name, sub: a.command, ic: 'bot', on: null, run: () => openIntoBoard(() => openAgent(a.id)) });
  return out;
}

// Open something, then come straight back to the board so it shows up as a tile.
function openIntoBoard(fn) {
  fn();
  setTimeout(() => go('board'), 60);
}

function renderBoard() {
  const root = $('#view-board');
  const items = boardItems();
  const open = launchables();
  const zoom = h('div', { class: 'zoom' },
    h('button', { class: 'zbtn', title: 'Afastar e ver mais de uma vez (Ctrl+roda do mouse)', disabled: boardCols >= 6, onclick: () => setCols(boardCols + 1) }, icon('minus', 14)),
    h('span', null, ZOOM_LABEL[boardCols]),
    h('button', { class: 'zbtn', title: 'Aproximar', disabled: boardCols <= 1, onclick: () => setCols(boardCols - 1) }, icon('plus', 14)));
  const live = items.filter(it => !(it.kind === 'term' ? it.T.ended : (it.ws.rdp?.ended || it.ws.vnc?.ended))).length;
  const head = h('div', { class: 'board-head' },
    h('h2', null, 'Quadro'),
    h('span', { class: 'hint' }, items.length
      ? `${live} ${live === 1 ? 'sessão ao vivo' : 'sessões ao vivo'}. Digite direto em qualquer quadro; clique duas vezes no título para assumir.`
      : 'Tudo o que estiver aberto aparece aqui, lado a lado e ao vivo.'),
    h('button', { class: 'btn small', onclick: () => openIntoBoard(openLocalTerminal) }, icon('term', 14), 'Terminal'),
    items.length ? zoom : null);

  if (!items.length) {
    const cards = open.map((o, i) => h('button', { class: 'launch-card', style: { '--i': i }, onclick: o.run },
      h('span', { class: 'ic' }, icon(o.ic, 22)),
      h('span', null, h('b', null, o.name), h('small', null, o.sub)),
      h('span', { class: 'go' }, icon('play', 16))));
    root.replaceChildren(head, h('div', { class: 'board-empty' },
      h('p', null, open.length ? 'Escolha o que abrir. Dá para abrir vários e acompanhar todos de uma vez.' : 'Salve uma conexão ou um agente no Início para montar o quadro.'),
      open.length ? h('div', { class: 'launch-grid' }, cards) : null,
      S.agents.length > 1 ? h('div', null, h('button', { class: 'btn primary', onclick: startAllAgents }, icon('play', 16), 'Abrir todos os agentes')) : null));
    return;
  }

  const launch = open.length ? h('div', { class: 'launch' },
    h('span', { class: 'lbl' }, 'Abrir também'),
    open.map(o => h('button', { class: 'chip-l', onclick: o.run, title: o.sub },
      o.kind === 'conn' ? h('span', { class: 'led' + (o.on ? ' on' : '') }) : icon('bot', 14), o.name))) : null;

  const rows = Math.ceil(items.length / boardCols);
  const tiles = h('div', { class: 'tiles', style: { '--cols': boardCols, '--row-h': rows <= 2 ? '1fr' : `${Math.max(200, 900 / boardCols)}px` } });
  items.forEach((it, i) => {
    const body = h('div', { class: 'tile-body' });
    const takeOver = () => { if (it.kind === 'desktop') setView(it.ws, 'desktop'); else if (it.ws.connId) setView(it.ws, 'term'); go(it.ws.id); };
    const ended = it.kind === 'term' ? it.T.ended : (it.ws.rdp?.ended || it.ws.vnc?.ended);
    const c = it.ws.connId ? conn(it.ws.connId) : null;
    const where = c ? (c.user ? `${c.user}@${c.host}` : c.host) : (it.ws.subtitle || '');
    const last = lastActivity(it.sid);
    tiles.append(h('div', { class: 'tile', 'data-sid': it.sid, style: { '--i': i } },
      h('div', { class: 'tile-head', ondblclick: takeOver },
        h('span', { class: 'dot' + (ended ? '' : ' live'), style: { '--c': ended ? 'var(--tinta-4)' : (it.ws.color || '') } }),
        h('span', { class: 'name' }, it.ws.title),
        h('span', { class: 'where' }, it.kind === 'desktop' ? 'tela remota' : where),
        h('span', { class: 'spacer' }),
        it.kind === 'term' && !ended ? sparkline(it.sid) : null,
        it.kind === 'term' ? h('span', { class: 'ago' + (last && Date.now() - last < 3000 ? ' now' : ''), 'data-ago': it.sid }, ended ? 'encerrado' : agoShort(last)) : null,
        h('button', { class: 'btn icon ghost small', title: 'Assumir em tela cheia', onclick: takeOver }, icon('maximize', 14)),
        h('button', { class: 'btn icon ghost small', title: 'Fechar', onclick: () => closeWs(it.ws) }, icon('x', 14))),
      body));
    if (it.kind === 'term') {
      it.T.xterm.options.fontSize = FONT_BY_COLS[boardCols];
      body.append(it.T.el);
    } else {
      const since = it.ws.since ? Math.round((Date.now() - it.ws.since) / 60000) : 0;
      body.append(h('div', { class: 'tile-desk' + (ended ? '' : ' live'), onclick: takeOver },
        h('div', { class: 'box' },
          h('span', { class: 'big' }, icon('screen', 26)),
          h('b', null, ended ? 'Sessão encerrada' : 'Área de trabalho ao vivo'),
          h('small', null, ended ? 'Clique para reconectar.' : `${where}${since ? `, aberta há ${since} min` : ''}. A tela remota só aparece na aba dela.`),
          h('span', { class: 'btn small' }, icon('maximize', 14), ended ? 'Abrir' : 'Assumir'))));
    }
  });
  root.replaceChildren(...[head, launch, tiles].filter(Boolean));
  requestAnimationFrame(() => items.forEach(it => { if (it.T) try { it.T.fit.fit(); } catch { } }));
}

// keep sparklines and "há X s" fresh while the board is on screen
setInterval(() => {
  if (route !== 'board' || document.hidden) return;
  for (const tile of document.querySelectorAll('.tile[data-sid]')) {
    const sid = tile.dataset.sid;
    const old = tile.querySelector('.spark');
    if (old) old.replaceWith(sparkline(sid));
    const ago = tile.querySelector('[data-ago]');
    if (ago && ago.textContent !== 'encerrado') {
      const last = lastActivity(sid);
      ago.textContent = agoShort(last);
      ago.classList.toggle('now', !!last && Date.now() - last < 3000);
    }
  }
}, 2000);

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
    const close = modal(title, h('div', { style: { color: 'var(--tinta-2)' } }, text), [
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

function editConnection(existing, prefill) {
  const c = existing ? { ...existing } : {
    id: '', name: '', os: 'linux', host: '', user: '', domain: '', keyPath: '', desktop: 'none', ssh: true,
    sshPort: 22, rdpPort: 3389, vncPort: 5900, group: '', color: '', redirectDrives: false, redirectClipboard: true,
    ...prefill,
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
  const nameInput = h('input', { value: a.name, placeholder: 'Ex.: Agente do projeto X', oninput: e => { a.name = e.target.value; } });
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
  const item = (ic, title, sub, fn) => h('button', { class: 'card-pick', onclick: pick(fn) },
    icon(ic, 22), h('div', null, h('b', null, title), h('small', null, sub)));
  close = modal('Criar', [
    item('monitor', 'Conexão', 'Windows ou Linux: tela, terminal e arquivos', () => editConnection()),
    item('bot', 'Agente', 'Um agente de IA ou outro programa de terminal', () => editAgent()),
    item('term', 'Terminal do Windows', 'PowerShell neste PC, sem salvar', openLocalTerminal),
  ], [h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => close() }, 'Fechar')]);
}

function settings() {
  let close;
  close = modal('Ajustes', [
    h('div', { class: 'field' }, h('span', null, 'Configurações'),
      h('div', { class: 'with-btn' },
        h('button', { class: 'btn', onclick: () => { close(); importConfig(); } }, icon('import', 14), 'Importar configurações'),
        h('button', { class: 'btn ghost', onclick: () => { close(); exportConfig(); } }, icon('download', 14), 'Exportar')),
      h('small', null, 'Importa um backup do Ponte (.json). As senhas de um backup só abrem no mesmo PC e usuário do Windows.')),
    h('div', { class: 'field' }, h('span', null, 'Chaves de servidores SSH'),
      h('div', null, h('button', { class: 'btn', onclick: async () => { await call('hostkey.forget'); toast('Pronto. Na próxima conexão o Ponte aceita a chave nova.'); } }, icon('key', 14), 'Esquecer chaves salvas')),
      h('small', null, 'Use se um servidor foi reinstalado e o Ponte avisa que a chave mudou.')),
    h('div', { class: 'field' }, h('span', null, 'Atalhos'),
      h('small', { style: { fontSize: '12.5px', lineHeight: '1.8' } },
        'Ctrl+K busca · Ctrl+N nova conexão · Ctrl+1 início · Ctrl+2 quadro · Ctrl+3 em diante, abas · Ctrl+Tab próxima aba · Ctrl+Shift+W fecha a aba')),
  ], [h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => close() }, 'Fechar')]);
}

async function importConfig() {
  try {
    const { count } = await call('config.import');
    if (count) toast(`${count} ${count === 1 ? 'item importado' : 'itens importados'}.`);
  } catch (err) { toast(err.message, { error: true }); }
}

async function exportConfig() {
  try {
    const { path } = await call('config.export');
    if (path) toast('Backup salvo.', { action: 'Mostrar', onAction: () => call('reveal', { path }) });
  } catch (err) { toast(err.message, { error: true }); }
}

// ---------------- command palette ----------------

function palette() {
  if (document.querySelector('.palette')) return;
  const input = h('input', { placeholder: 'Conectar, abrir agente ou fazer algo…', spellcheck: 'false' });
  const list = h('ul');
  let items = [], sel = 0;

  const all = () => [
    ...S.connections.map(c => ({ ic: machineIcon(c), title: c.name, sub: c.host, keys: `${c.name} ${c.host} ${c.group} ${c.user}`, run: () => openConn(c.id) })),
    ...S.connections.filter(hasShell).map(c => ({ ic: 'folder', title: `Arquivos de ${c.name}`, sub: c.host, keys: `arquivos files sftp ${c.name} ${c.host}`, run: () => openConn(c.id, 'files') })),
    ...S.agents.map(a => ({ ic: 'bot', title: a.name, sub: a.command, keys: `agente ${a.name} ${a.command}`, run: () => openAgent(a.id) })),
    ...workspaces.map(ws => ({ ic: 'enter', title: `Ir para ${ws.title}`, sub: 'aba aberta', keys: `aba ${ws.title}`, run: () => go(ws.id) })),
    { ic: 'plus', title: 'Nova conexão', keys: 'nova conexao criar adicionar', run: () => editConnection() },
    { ic: 'plus', title: 'Novo agente', keys: 'novo agente claude codex gemini', run: () => editAgent() },
    { ic: 'term', title: 'Terminal do Windows', keys: 'terminal powershell local', run: openLocalTerminal },
    { ic: 'grid', title: 'Quadro', keys: 'quadro board tudo', run: () => go('board') },
    { ic: 'play', title: 'Abrir todos os agentes', keys: 'abrir todos agentes', run: startAllAgents },
    { ic: 'import', title: 'Importar configurações', keys: 'importar backup configuracoes', run: importConfig },
    { ic: 'download', title: 'Exportar configurações', keys: 'exportar backup configuracoes', run: exportConfig },
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

// Window chrome. CSS app-region handles dragging when WebView2 supports it; the mousedown path covers the rest.
$('#win-min').onclick = () => send('win.min');
$('#win-max').onclick = () => send('win.max');
$('#win-close').onclick = () => send('win.close');
$('#resize-top').addEventListener('mousedown', e => { if (e.button === 0) { e.preventDefault(); send('win.resize-top'); } });
const isBarBackground = el => el.closest('#bar') && !el.closest('button, input, .winctl, #resize-top');
$('#bar').addEventListener('mousedown', e => {
  if (e.button === 0 && e.detail === 1 && isBarBackground(e.target)) send('win.drag');
});
$('#bar').addEventListener('dblclick', e => { if (isBarBackground(e.target)) send('win.max'); });

$('#btn-search').onclick = palette;
$('#btn-new').onclick = newMenu;
$('#btn-settings').onclick = settings;
$('#btn-voice').onclick = voice;

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  for (const ws of workspaces) if (ws.term) ws.term.xterm.options.theme = termTheme();
});

renderTabs();
renderHome();
call('ready').then(data => { setState(data); probe(); }).catch(err => toast(err.message, { error: true }));

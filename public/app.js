(() => {
  const svg = document.querySelector('#graph-svg');
  const stage = document.querySelector('#graph-stage');
  const empty = document.querySelector('#empty-state');
  const panel = document.querySelector('#admin-panel');
  const log = document.querySelector('#event-log');
  const toast = document.querySelector('#toast');
  let graph = { nodes: [], edges: [] };
  let selectedId = null;
  let knownNodes = new Set();
  let toastTimer;
  const colors = ['#a78bfa', '#22d3ee', '#f472b6', '#fbbf24', '#34d399', '#fb7185'];
  const fmt = (s) => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const id = (s) => s.trim().replace(/^@/, '').toLowerCase();
  function setConnection(ok) {
    document.querySelector('#connection-label').textContent = ok ? 'GRAPH CONNECTED' : 'RECONNECTING';
    document.querySelector('.live-dot').style.background = ok ? '#55dfab' : '#fbbf24';
  }
  async function loadGraph() {
    try { const res = await fetch('/api/graph'); if (res.ok) render(await res.json()); }
    catch (_) { /* WebSocket reconnect will recover. */ }
  }
  async function loadHealth() {
    try {
      const response = await fetch('/api/health');
      const health = await response.json();
      const twitch = health.integrations?.twitchApi;
      const label = document.querySelector('#source-label');
      label.textContent = !twitch?.configured ? 'SAMPLE DATA' : twitch.error ? 'API ERROR' : twitch.lastUpdated ? 'API READY' : 'CONNECTING';
      label.title = twitch?.error || (twitch?.lastUpdated ? `Twitch profile lookup checked at ${fmt(twitch.lastUpdated)}. Lineage links and credit are still examples.` : 'Add Twitch credentials to .env and restart the server.');
    } catch (_) { document.querySelector('#source-label').textContent = 'SAMPLE DATA'; }
  }
  function connect() {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    socket.onopen = () => setConnection(true);
    socket.onclose = () => { setConnection(false); setTimeout(connect, 1500); };
    socket.onerror = () => socket.close();
    socket.onmessage = (event) => { try { const data = JSON.parse(event.data); if (data.type === 'graph:update') render(data.graph); } catch (_) {} };
  }
  function render(next) {
    const previous = knownNodes;
    render.previousNodes = previous;
    graph = next; knownNodes = new Set(graph.nodes.map(n => n.id)); empty.hidden = graph.nodes.length > 0;
    document.querySelector('#node-count').textContent = String(graph.nodes.length).padStart(2, '0');
    document.querySelector('#last-updated').textContent = graph.updatedAt ? `UPDATED ${fmt(graph.updatedAt).toUpperCase()}` : 'AWAITING FIRST EVENT';
    drawGraph();
    if (!selectedId && graph.nodes.length) selectedId = graph.nodes.find(n => n.id === 'clip_remixer')?.id || graph.nodes[0].id;
    if (selectedId && graph.nodes.some(n => n.id === selectedId)) inspect(selectedId);
    graph.edges.slice(0, Math.max(0, graph.edges.length - (render.lastEdgeCount ?? 0))).forEach(addLog);
    render.lastEdgeCount = graph.edges.length;
    document.querySelector('#event-count').textContent = `${String(graph.edges.length).padStart(2, '0')} EVENTS`;
    if (previous.size && graph.nodes.some(n => !previous.has(n.id))) showToast(`NEW CREATOR NODE · ${graph.nodes.find(n => !previous.has(n.id)).name.toUpperCase()}`);
  }
  function positions() {
    const rect = stage.getBoundingClientRect(), w = rect.width, h = rect.height;
    const n = graph.nodes.length;
    const cx = w * .5, cy = h * .46;
    const rx = Math.max(80, Math.min(w * .36, n <= 3 ? w * .25 : w * .38));
    const ry = Math.max(75, Math.min(h * .31, n <= 3 ? h * .23 : h * .34));
    return new Map(graph.nodes.map((node, i) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * i / Math.max(n, 1));
      return [node.id, { x: n === 1 ? cx : cx + Math.cos(angle) * rx, y: n === 1 ? cy : cy + Math.sin(angle) * ry }];
    }));
  }
  function el(name, attrs = {}) { const e = document.createElementNS('http://www.w3.org/2000/svg', name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
  function drawGraph() {
    svg.replaceChildren();
    if (!graph.nodes.length) return;
    const pos = positions();
    const defs = el('defs'); svg.append(defs);
    graph.edges.forEach((edge, i) => {
      const a = pos.get(edge.parentChannel), b = pos.get(edge.childChannel); if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, sx = a.x + ux * 25, sy = a.y + uy * 25, ex = b.x - ux * 30, ey = b.y - uy * 30;
      const curve = (i % 2 ? 1 : -1) * Math.min(30, len * .09), mx = (sx + ex) / 2 - uy * curve, my = (sy + ey) / 2 + ux * curve;
      const color = edge.contributionType === 'raid' ? '#a78bfa' : edge.contributionType === 'clip-remix' || edge.contributionType === 'reaction' ? '#35d7e8' : edge.contributionType === 'co-stream' ? '#fbbf24' : '#42d6e5';
      const curvePath = `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
      const marker = el('marker', { id: `arrow-${edge.id}`, markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto', markerUnits: 'strokeWidth' });
      marker.append(el('path', { d: 'M0,0 L0,6 L7,3 z', fill: color })); defs.append(marker);
      const path = el('path', { d: curvePath, class: `edge ${edge.contributionType}`, fill: 'none', stroke: color, 'marker-end': `url(#arrow-${edge.id})` }); svg.append(path);
      const particle = el('circle', { r: 2.6, fill: color, class: 'edge-particle' });
      const motion = el('animateMotion', { dur: `${1.8 + (i % 4) * .25}s`, repeatCount: 'indefinite', path: curvePath, begin: `${(i % 7) * -.32}s` }); particle.append(motion); svg.append(particle);
      const label = el('text', { x: mx, y: my - 6, class: 'edge-label', 'text-anchor': 'middle' }); label.textContent = `${edge.splitPercentage}%`; svg.append(label);
    });
    graph.nodes.forEach((node, i) => {
      const p = pos.get(node.id), color = node.color || colors[i % colors.length];
      const group = el('g', { class: `node${selectedId === node.id ? ' selected' : ''}`, transform: `translate(${p.x} ${p.y})`, tabindex: 0, role: 'button', 'aria-label': `Inspect ${node.name}` });
      if (!previousNode(node.id)) group.classList.add('node-enter');
      group.append(el('circle', { r: 25, class: 'node-halo', stroke: color }));
      group.append(el('circle', { r: 17, class: 'node-core', fill: `${color}30`, stroke: color }));
      const initials = el('text', { y: 4, fill: color, 'font-size': 10, 'font-family': 'DM Mono', 'text-anchor': 'middle' }); initials.textContent = node.name.slice(0, 2).toUpperCase(); group.append(initials);
      const label = el('text', { y: 38, class: 'node-label' }); label.textContent = node.name; group.append(label);
      const sub = el('text', { y: 51, class: 'node-sub' });
      const sources = graph.edges.filter(e => e.childChannel === node.id).length;
      const derivatives = graph.edges.filter(e => e.parentChannel === node.id).length;
      sub.textContent = `${sources} source · ${derivatives} uses`; group.append(sub);
      group.addEventListener('click', () => inspect(node.id)); group.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inspect(node.id); } }); svg.append(group);
    });
  }
  function previousNode(nodeId) { return render.previousNodes?.has(nodeId) ?? true; }
  function inspect(nodeId) {
    selectedId = nodeId; const node = graph.nodes.find(n => n.id === nodeId); if (!node) return;
    document.querySelector('#inspector-empty').hidden = true;
    document.querySelector('#inspector-content').hidden = false;
    document.querySelector('#selected-name').textContent = node.name;
    document.querySelector('#selected-avatar').textContent = node.name.slice(0, 2).toUpperCase();
    const upstream = graph.edges.filter(e => e.childChannel === nodeId), downstream = graph.edges.filter(e => e.parentChannel === nodeId);
    document.querySelector('#follower-badge').textContent = node.followers != null
      ? `${Number(node.followers).toLocaleString()} FOLLOWERS`
      : node.demoProfile ? 'FOLLOWER COUNT N/A · DEMO' : 'FOLLOWER COUNT NOT AVAILABLE';
    const avatar = document.querySelector('#selected-avatar');
    avatar.textContent = node.profileImageUrl ? '' : node.name.slice(0, 2).toUpperCase();
    avatar.style.backgroundImage = node.profileImageUrl ? `url("${node.profileImageUrl}")` : '';
    avatar.style.backgroundSize = 'cover'; avatar.style.backgroundPosition = 'center';
    document.querySelector('#live-badge').textContent = node.demoProfile ? 'SAMPLE' : node.isLive ? '● LIVE' : '○ OFFLINE';
    document.querySelector('#live-badge').classList.toggle('offline', !node.isLive);
    document.querySelector('#live-badge').classList.toggle('sample', Boolean(node.demoProfile));
    document.querySelector('#stream-title').textContent = `${node.category || 'VARIETY'}  /  ${node.streamTitle || 'Live demo stream'}`;
    document.querySelector('#upstream-count').textContent = String(upstream.length).padStart(2, '0');
    document.querySelector('#downstream-count').textContent = String(downstream.length).padStart(2, '0');
    const upstreamNames = upstream.map(e => graph.nodes.find(n => n.id === e.parentChannel)?.name).filter(Boolean);
    const downstreamNames = downstream.map(e => graph.nodes.find(n => n.id === e.childChannel)?.name).filter(Boolean);
    document.querySelector('#upstream-list').textContent = upstreamNames.join('  ·  ') || 'ORIGIN NODE';
    document.querySelector('#downstream-list').textContent = downstreamNames.join('  ·  ') || 'NO DERIVATIVES';
    document.querySelector('#selected-stats').textContent = `${upstream.length + downstream.length} content link${upstream.length + downstream.length === 1 ? '' : 's'}`;
    const edges = [...upstream, ...downstream]; document.querySelector('#card-count').textContent = String(edges.length).padStart(2, '0');
    const creditToCreator = downstream.reduce((sum, edge) => sum + Number(edge.royaltyPoolUsd || 1240) * Number(edge.splitPercentage || 0) / 100, 0);
    const creditAttributed = upstream.reduce((sum, edge) => sum + Number(edge.royaltyPoolUsd || 1240) * Number(edge.splitPercentage || 0) / 100, 0);
    const money = value => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.querySelector('#credit-earned').textContent = money(creditToCreator);
    document.querySelector('#credit-attributed').textContent = money(creditAttributed);
    updatePreview(node);
    const container = document.querySelector('#attribution-cards'); container.replaceChildren();
    edges.forEach(edge => {
      const incoming = edge.childChannel === nodeId, other = graph.nodes.find(n => n.id === (incoming ? edge.parentChannel : edge.childChannel));
      const card = document.createElement('article'); card.className = 'attribution-card';
      const top = document.createElement('div'); top.className = 'card-top';
      const typeNames = { raid: 'Raid', reaction: 'Reaction', 'clip-remix': 'Clip remix', 'co-stream': 'Co-stream', 'chat-command': 'Chat attribution', fork: 'Content reuse' };
      const type = document.createElement('span'); type.className = 'card-type'; type.textContent = `${incoming ? 'INSPIRED BY' : 'USED BY'} ${other?.name || 'creator'} · ${typeNames[edge.contributionType] || 'Content reuse'}`;
      const split = document.createElement('span'); split.className = 'card-split'; split.textContent = `${edge.splitPercentage}% ${incoming ? 'to source' : 'to this creator'}`; top.append(type, split);
      const summary = document.createElement('p'); summary.className = 'card-summary'; summary.textContent = edge.summary;
      if (edge.contextSnippet && edge.contextSnippet !== edge.summary) { const context = document.createElement('p'); context.className = 'context-snippet'; context.textContent = edge.contextSnippet; card.append(top, summary, context); }
      const time = document.createElement('span'); time.className = 'card-time'; time.textContent = fmt(edge.createdAt);
      if (!edge.contextSnippet || edge.contextSnippet === edge.summary) card.append(top, summary);
      card.append(time); container.append(card);
    });
    if (!edges.length) { const p = document.createElement('p'); p.className = 'card-summary'; p.textContent = 'No attribution links yet. Forked content will appear here.'; container.append(p); }
    drawGraph();
  }
  function addLog(edge) {
    document.querySelector('.log-placeholder')?.remove();
    const li = document.createElement('li'); li.innerHTML = `<b>${edge.contributionType.toUpperCase()}</b> · ${escapeText(edge.parentChannel)} → ${escapeText(edge.childChannel)} · ${edge.splitPercentage}%`;
    log.prepend(li); while (log.children.length > 12) log.lastElementChild.remove();
    document.querySelector('#event-count').textContent = `${String(graph.edges.length).padStart(2, '0')} EVENTS`;
  }
  function updatePreview(node) {
    document.querySelector('#preview-name').textContent = node.name;
    document.querySelector('#preview-category').textContent = node.category || 'VARIETY';
    document.querySelector('#preview-caption').textContent = `${node.demoProfile ? 'SAMPLE' : node.isLive ? 'LIVE' : 'OFFLINE'} · ${node.streamTitle || 'Stream details'}`;
    document.querySelector('#preview-viewers').textContent = node.viewerCount != null
      ? `${Number(node.viewerCount).toLocaleString()} viewers` : node.demoProfile ? 'EXAMPLE' : node.isLive ? 'LIVE' : 'OFFLINE';
    const image = document.querySelector('#preview-image');
    image.hidden = !node.streamThumbnailUrl;
    image.src = node.streamThumbnailUrl || '';
    const preview = document.querySelector('#stream-preview');
    preview.classList.toggle('real-feed', Boolean(node.streamThumbnailUrl));
    document.querySelector('#preview-label').textContent = node.streamThumbnailUrl ? 'TWITCH THUMBNAIL' : 'SAMPLE PREVIEW';
  }
  function escapeText(value) { const d = document.createElement('div'); d.textContent = value; return d.innerHTML; }
  async function simulate(kind) {
    const samples = {
      raid: { parentChannel: 'original_creator', childChannel: 'raid_guest', contributionType: 'raid', splitPercentage: 10, context: 'Example only: a raid creates a new relationship between these sample creators.' },
      reaction: { parentChannel: 'original_creator', childChannel: 'remix_creator', contributionType: 'clip-remix', splitPercentage: 15, context: 'Example only: remix_creator reuses a clip from original_creator. The suggested 15% credit goes to the source.' },
      chat: { parentChannel: 'clip_remixer', childChannel: 'chat_attributor', contributionType: 'chat-command', splitPercentage: 20, context: 'Example only: a viewer uses !fork to record clip_remixer as the source.' },
    };
    try {
      if (kind === 'chat') showToast('Example chat command · !fork clip_remixer');
      const response = await fetch('/api/simulate-fork', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(samples[kind]) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Simulation failed');
      selectedId = result.edge.childChannel; inspect(selectedId); showToast(`${kind === 'chat' ? 'Example !fork link added' : kind === 'raid' ? 'Example raid link added' : 'Example clip reuse added'} · sample data`);
    } catch (error) { showToast(error.message || 'Could not reach the server'); }
  }
  function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2400); }
  const backdrop = document.querySelector('#modal-backdrop');
  function toggleAdmin(show) { const open = show ?? !panel.classList.contains('open'); panel.classList.toggle('open', open); backdrop.classList.toggle('open', open); panel.setAttribute('aria-hidden', String(!open)); document.querySelector('#admin-toggle').setAttribute('aria-expanded', String(open)); }
  document.querySelector('#admin-toggle').addEventListener('click', () => toggleAdmin());
  document.querySelector('#admin-close').addEventListener('click', () => toggleAdmin(false));
  backdrop.addEventListener('click', () => toggleAdmin(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleAdmin(false); });
  document.querySelectorAll('[data-seed]').forEach(button => button.addEventListener('click', () => { const kind = button.dataset.seed; toggleAdmin(false); simulate(kind); }));
  new ResizeObserver(drawGraph).observe(stage);
  loadGraph(); loadHealth(); connect();
  setInterval(loadHealth, 30000);
})();

export function getDashboardHtml(token: string, chatId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>ClaudeClaw</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body { background: #0f0f0f; color: #e0e0e0; -webkit-tap-highlight-color: transparent; }
  .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .pill-active { background: #064e3b; color: #6ee7b7; }
  .pill-paused { background: #422006; color: #fbbf24; }
  .pill-connected { background: #064e3b; color: #6ee7b7; }
  .pill-disconnected { background: #3b0f0f; color: #f87171; }
  .stat-val { font-size: 24px; font-weight: 700; color: #fff; }
  .stat-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  details summary { cursor: pointer; list-style: none; }
  details summary::-webkit-details-marker { display: none; }
  .fade-text { color: #f87171; }
  .top-text { color: #6ee7b7; }
  .gauge-bg { fill: #2a2a2a; }
  .refresh-spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .device-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 600; letter-spacing: 0.5px; }
  .device-mobile { background: #1e3a5f; color: #60a5fa; }
  .device-desktop { background: #3b1f5e; color: #c084fc; }
  /* Drawer */
  .drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 40; opacity: 0; pointer-events: none; transition: opacity 0.2s; }
  .drawer-overlay.open { opacity: 1; pointer-events: auto; }
  .drawer { position: fixed; bottom: 0; left: 0; right: 0; z-index: 50; background: #141414; border-top: 1px solid #2a2a2a; border-radius: 16px 16px 0 0; max-height: 85vh; transform: translateY(100%); transition: transform 0.3s ease; display: flex; flex-direction: column; }
  .drawer.open { transform: translateY(0); }
  .drawer-handle { width: 36px; height: 4px; background: #444; border-radius: 2px; margin: 10px auto 0; flex-shrink: 0; }
  .drawer-body { overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 16px; flex: 1; }
  .mem-item { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; padding: 12px; margin-bottom: 8px; cursor: pointer; transition: border-color 0.15s; }
  .mem-item:active, .mem-item.expanded { border-color: #444; }
  .mem-item .mem-content { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .mem-item.expanded .mem-content { display: block; -webkit-line-clamp: unset; }
  .salience-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; flex-shrink: 0; }
  .clickable-card { cursor: pointer; transition: border-color 0.15s; }
  .clickable-card:hover, .clickable-card:active { border-color: #444; }
  /* Info tooltips */
  .info-tip { position: relative; display: inline-block; vertical-align: middle; margin-left: 6px; }
  .info-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: #333; color: #888; font-size: 11px; cursor: pointer; user-select: none; line-height: 1; transition: background 0.15s, color 0.15s; }
  .info-icon:hover { background: #444; color: #bbb; }
  .info-tooltip { position: absolute; left: 50%; transform: translateX(-50%); top: calc(100% + 8px); background: #252525; border: 1px solid #3a3a3a; color: #bbb; font-size: 12px; font-weight: 400; line-height: 1.5; padding: 10px 12px; border-radius: 8px; max-width: 280px; min-width: 200px; z-index: 30; opacity: 0; pointer-events: none; transition: opacity 0.15s; white-space: normal; text-transform: none; letter-spacing: normal; }
  .info-tooltip::before { content: ''; position: absolute; top: -6px; left: 50%; transform: translateX(-50%); border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 6px solid #3a3a3a; }
  .info-tooltip::after { content: ''; position: absolute; top: -5px; left: 50%; transform: translateX(-50%); border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 5px solid #252525; }
  .info-tip.active .info-tooltip { opacity: 1; pointer-events: auto; }
  /* Chat FAB */
  .chat-fab { position: fixed; bottom: 24px; right: 24px; z-index: 60; width: 56px; height: 56px; border-radius: 50%; background: #4f46e5; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(79,70,229,0.4); transition: transform 0.15s, background 0.15s; }
  .chat-fab:hover { transform: scale(1.08); background: #4338ca; }
  .chat-fab:active { transform: scale(0.95); }
  .chat-fab-badge { position: absolute; top: -2px; right: -2px; width: 18px; height: 18px; border-radius: 50%; background: #ef4444; color: #fff; font-size: 10px; font-weight: 700; display: none; align-items: center; justify-content: center; border: 2px solid #0f0f0f; }
  /* Chat overlay */
  .chat-overlay { position: fixed; inset: 0; z-index: 70; background: #0f0f0f; display: flex; flex-direction: column; transform: translateY(100%); transition: transform 0.3s ease; }
  .chat-overlay.open { transform: translateY(0); }
  .chat-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #141414; border-bottom: 1px solid #2a2a2a; flex-shrink: 0; }
  .chat-header-title { font-size: 16px; font-weight: 700; color: #fff; }
  .chat-status-dot { width: 8px; height: 8px; border-radius: 50%; margin-left: 8px; display: inline-block; }
  .chat-messages { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .chat-bubble { max-width: 85%; padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.5; word-wrap: break-word; overflow-wrap: break-word; }
  .chat-bubble-user { background: #3730a3; color: #e0e7ff; align-self: flex-end; border-bottom-right-radius: 4px; }
  .chat-bubble-assistant { background: #1e1e1e; color: #d4d4d8; align-self: flex-start; border-bottom-left-radius: 4px; border: 1px solid #2a2a2a; }
  .chat-bubble-source { font-size: 10px; color: #6b7280; margin-top: 4px; }
  .chat-bubble code { background: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 3px; font-size: 13px; }
  .chat-bubble pre { background: #111; padding: 8px 10px; border-radius: 6px; overflow-x: auto; margin: 6px 0; font-size: 12px; }
  .chat-bubble pre code { background: none; padding: 0; }
  .chat-progress-bar { display: none; align-items: center; gap: 10px; padding: 10px 16px; background: #141414; border-top: 1px solid #2a2a2a; flex-shrink: 0; position: relative; overflow: hidden; }
  .chat-progress-bar.active { display: flex; }
  .chat-progress-pulse { width: 10px; height: 10px; border-radius: 50%; background: #4f46e5; flex-shrink: 0; animation: progressPulse 1.5s ease-in-out infinite; }
  @keyframes progressPulse { 0%,100% { opacity: 0.4; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
  .chat-progress-label { font-size: 13px; color: #9ca3af; }
  .chat-stop-btn { margin-left: auto; background: none; border: 1px solid #4f46e5; color: #4f46e5; border-radius: 6px; width: 28px; height: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s, color 0.15s; }
  .chat-stop-btn:hover { background: #4f46e5; color: #fff; }
  .chat-progress-shimmer { position: absolute; bottom: 0; left: 0; height: 2px; width: 100%; background: linear-gradient(90deg, transparent, #4f46e5, transparent); animation: shimmer 2s ease-in-out infinite; }
  @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
  .chat-input-area { display: flex; gap: 8px; padding: 12px 16px; background: #141414; border-top: 1px solid #2a2a2a; flex-shrink: 0; }
  .chat-textarea { flex: 1; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; color: #e0e0e0; padding: 10px 14px; font-size: 14px; resize: none; outline: none; max-height: 120px; font-family: inherit; }
  .chat-textarea:focus { border-color: #4f46e5; }
  .chat-send-btn { background: #4f46e5; color: #fff; border: none; border-radius: 12px; padding: 0 16px; cursor: pointer; font-size: 14px; font-weight: 600; transition: background 0.15s; flex-shrink: 0; }
  .chat-send-btn:hover { background: #4338ca; }
  .chat-send-btn:disabled { background: #2a2a2a; color: #666; cursor: not-allowed; }
</style>
</head>
<body class="p-4 select-none">

<!-- Outer wrapper: single column on mobile, wide 2-col on desktop -->
<div class="max-w-lg lg:max-w-6xl mx-auto">

<!-- Top bar -->
<div class="flex items-center justify-between mb-1">
  <div class="flex items-center gap-3">
    <h1 class="text-xl font-bold text-white">ClaudeClaw</h1>
    <span id="device-badge" class="device-badge"></span>
  </div>
  <div class="flex items-center gap-3">
    <span id="last-updated" class="text-xs text-gray-500"></span>
    <button id="refresh-btn" onclick="refreshAll()" class="text-gray-400 hover:text-white transition">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
      </svg>
    </button>
  </div>
</div>
<div id="bot-info" class="flex items-center gap-3 mb-4 text-xs text-gray-500"></div>

<!-- Desktop: 2-column grid. Mobile: stacked. -->
<div class="lg:grid lg:grid-cols-2 lg:gap-6">

<!-- LEFT COLUMN -->
<div>

<!-- Scheduled Tasks -->
<div id="tasks-section">
  <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Scheduled Tasks<span class="info-tip"><span class="info-icon">\u24D8</span><span class="info-tooltip">Automated tasks scheduled by the bot (e.g. reminders, checks). Shows the schedule, status, and time until next run.</span></span></h2>
  <div id="tasks-container"><div class="card text-gray-500 text-sm">Loading...</div></div>
</div>

<!-- Memory Landscape -->
<div id="memory-section" class="mt-5">
  <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Memory Landscape</h2>
  <div class="grid grid-cols-2 gap-3 mb-3">
    <div class="card clickable-card text-center" onclick="openMemoryDrawer('semantic')">
      <div class="stat-val" id="mem-semantic">-</div>
      <div class="stat-label">Semantic<span class="info-tip"><span class="info-icon">\u24D8</span><span class="info-tooltip">Number of semantic memories \u2014 general knowledge and long-lasting facts retained by the bot.</span></span></div>
      <div class="text-xs text-gray-600 mt-1">Tap to browse</div>
    </div>
    <div class="card clickable-card text-center" onclick="openMemoryDrawer('episodic')">
      <div class="stat-val" id="mem-episodic">-</div>
      <div class="stat-label">Episodic<span class="info-tip"><span class="info-icon">\u24D8</span><span class="info-tooltip">Number of episodic memories \u2014 specific events and conversations remembered by the bot.</span></span></div>
      <div class="text-xs text-gray-600 mt-1">Tap to browse</div>
    </div>
  </div>
  <div class="card">
    <div class="text-xs text-gray-400 mb-2">Salience Distribution<span class="info-tip"><span class="info-icon">\u24D8</span><span class="info-tooltip">Distribution of memories by importance level (salience). Higher scores mean the memory is deemed more important and will be retained longer.</span></span></div>
    <canvas id="salience-chart" height="120"></canvas>
  </div>
  <div class="card">
    <div class="text-xs text-gray-400 mb-1">Fading Soon <span class="text-gray-600">(salience &lt; 0.5)</span><span class="info-tip"><span class="info-icon">\u24D8</span><span class="info-tooltip">Memories about to fade away (importance &lt; 0.5). They will soon be forgotten by the bot unless reinforced.</span></span></div>
    <div id="fading-list" class="text-sm"></div>
  </div>
  <div class="card">
    <div class="text-xs text-gray-400 mb-1">Most Accessed<span class="info-tip"><span class="info-icon">\u24D8</span><span class="info-tooltip">Memories most frequently accessed by the bot. A high score means this memory is often useful.</span></span></div>
    <div id="top-accessed-list" class="text-sm"></div>
  </div>
  <div class="card">
    <div class="text-xs text-gray-400 mb-2">Memory Creation (30d)<span class="info-tip"><span class="info-icon">\u24D8</span><span class="info-tooltip">Number of new memories created per day over the last 30 days, broken down by type (semantic vs episodic).</span></span></div>
    <canvas id="memory-timeline-chart" height="140"></canvas>
  </div>
</div>

</div><!-- end LEFT COLUMN -->

<!-- RIGHT COLUMN -->
<div>

<!-- System Health -->
<div id="health-section" class="mt-5 lg:mt-0">
  <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">System Health</h2>
  <div class="card flex items-center gap-4">
    <div class="relative">
      <svg id="context-gauge" width="90" height="90" viewBox="0 0 90 90"></svg>
      <span class="info-tip" style="position:absolute;top:0;right:-4px;"><span class="info-icon">\u24D8</span><span class="info-tooltip">Percentage of the context window in use. The higher it is, the closer the bot is to its working memory limit.</span></span>
    </div>
    <div class="flex-1">
      <div class="grid grid-cols-3 gap-2 text-center">
        <div>
          <div class="stat-val text-base" id="health-turns">-</div>
          <div class="stat-label">Turns</div>
        </div>
        <div>
          <div class="stat-val text-base" id="health-age">-</div>
          <div class="stat-label">Age</div>
        </div>
        <div>
          <div class="stat-val text-base" id="health-compactions">-</div>
          <div class="stat-label">Compactions</div>
        </div>
      </div>
      <div class="text-center mt-1"><span class="info-tip"><span class="info-icon">\u24D8</span><span class="info-tooltip">Turns = number of exchanges in the session. Age = session duration. Compactions = how many times context was compressed to free up space.</span></span></div>
    </div>
  </div>
  <div class="flex gap-3 mt-1">
    <span class="pill" id="tg-pill">Telegram</span>
    <span class="pill" id="wa-pill">WhatsApp</span>
    <span class="pill" id="slack-pill">Slack</span>
    <span class="info-tip"><span class="info-icon">\u24D8</span><span class="info-tooltip">Connection status for messaging platforms (Telegram, WhatsApp, Slack). Green = connected, Red = disconnected.</span></span>
  </div>
</div>

<!-- Token / Cost -->
<div id="token-section" class="mt-5 mb-8">
  <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Tokens &amp; Cost<span class="info-tip"><span class="info-icon">\u24D8</span><span class="info-tooltip">Token consumption (text units processed by the AI) and associated cost in dollars. Today's totals and all-time cumulative.</span></span></h2>
  <div class="card">
    <div class="flex justify-between items-baseline">
      <div>
        <div class="stat-val" id="token-today-cost">-</div>
        <div class="stat-label">Today's spend</div>
      </div>
      <div class="text-right">
        <div class="stat-val text-base" id="token-today-turns">-</div>
        <div class="stat-label">Turns today</div>
      </div>
    </div>
    <div class="mt-2 text-xs text-gray-500">All-time: <span id="token-alltime-cost">-</span> across <span id="token-alltime-turns">-</span> turns</div>
  </div>
  <div class="card">
    <div class="text-xs text-gray-400 mb-2">Cost Timeline (30d)<span class="info-tip"><span class="info-icon">\u24D8</span><span class="info-tooltip">Daily cost trend in dollars over the last 30 days.</span></span></div>
    <canvas id="cost-chart" height="140"></canvas>
  </div>
  <div class="card">
    <div class="text-xs text-gray-400 mb-2">Cache Hit Rate<span class="info-tip"><span class="info-icon">\u24D8</span><span class="info-tooltip">Cache reuse rate. A high percentage means the bot is efficiently reusing previously processed data, which reduces costs.</span></span></div>
    <canvas id="cache-chart" height="140"></canvas>
  </div>
</div>

</div><!-- end RIGHT COLUMN -->

</div><!-- end grid -->
</div><!-- end outer wrapper -->

<!-- Memory drill-down drawer -->
<div id="drawer-overlay" class="drawer-overlay" onclick="closeDrawer()"></div>
<div id="drawer" class="drawer">
  <div class="drawer-handle"></div>
  <div class="flex items-center justify-between px-4 pt-3 pb-1">
    <h3 class="text-base font-bold text-white" id="drawer-title">Memories</h3>
    <button onclick="closeDrawer()" class="text-gray-500 hover:text-white text-xl leading-none">&times;</button>
  </div>
  <div class="px-4 pb-2 flex items-center gap-2">
    <span class="text-xs text-gray-500" id="drawer-count"></span>
    <span class="text-xs text-gray-600">|</span>
    <span class="text-xs text-gray-500" id="drawer-avg-salience"></span>
  </div>
  <div class="drawer-body" id="drawer-body"></div>
  <div id="drawer-load-more" class="px-4 pb-4 hidden">
    <button onclick="loadMoreMemories()" class="w-full py-2 text-sm text-gray-400 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg hover:text-white transition">Load more</button>
  </div>
</div>

<script>
const TOKEN = \${JSON.stringify(token)};
const CHAT_ID = \${JSON.stringify(chatId)};
const BASE = location.origin;

// Device detection
function detectDevice() {
  const ua = navigator.userAgent;
  const badge = document.getElementById('device-badge');
  const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)
    || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
  if (isMobile) {
    badge.textContent = 'MOBILE';
    badge.className = 'device-badge device-mobile';
  } else {
    badge.textContent = 'DESKTOP';
    badge.className = 'device-badge device-desktop';
  }
}
detectDevice();
window.addEventListener('resize', detectDevice);

// Memory drawer state
let drawerSector = '';
let drawerOffset = 0;
let drawerTotal = 0;
const DRAWER_PAGE = 30;

function salienceColor(s) {
  if (s >= 4) return '#10b981';
  if (s >= 3) return '#22c55e';
  if (s >= 2) return '#84cc16';
  if (s >= 1) return '#eab308';
  if (s >= 0.5) return '#f97316';
  return '#ef4444';
}

function formatDate(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderMemoryItem(m) {
  return '<div class="mem-item" onclick="this.classList.toggle(&quot;expanded&quot;)">' +
    '<div class="flex items-center gap-2 mb-1">' +
      '<span class="salience-dot" style="background:' + salienceColor(m.salience) + '"></span>' +
      '<span class="text-xs font-semibold" style="color:' + salienceColor(m.salience) + '">' + m.salience.toFixed(2) + '</span>' +
      '<span class="text-xs text-gray-600 ml-auto">' + formatDate(m.created_at) + '</span>' +
    '</div>' +
    '<div class="text-sm text-gray-300 mem-content">' + escapeHtml(m.content) + '</div>' +
    (m.topic_key ? '<div class="text-xs text-gray-600 mt-1">' + escapeHtml(m.topic_key) + '</div>' : '') +
  '</div>';
}

async function openMemoryDrawer(sector) {
  drawerSector = sector;
  drawerOffset = 0;
  document.getElementById('drawer-title').textContent = sector.charAt(0).toUpperCase() + sector.slice(1) + ' Memories';
  document.getElementById('drawer-body').innerHTML = '<div class="text-gray-500 text-sm text-center py-8">Loading...</div>';
  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
  await loadDrawerPage();
}

async function loadDrawerPage() {
  const data = await api('/api/memories/list?chatId=' + CHAT_ID + '&sector=' + drawerSector + '&limit=' + DRAWER_PAGE + '&offset=' + drawerOffset);
  drawerTotal = data.total;
  const body = document.getElementById('drawer-body');
  if (drawerOffset === 0) body.innerHTML = '';
  body.innerHTML += data.memories.map(renderMemoryItem).join('');
  drawerOffset += data.memories.length;
  document.getElementById('drawer-count').textContent = drawerTotal + ' total';
  // Calculate avg salience from visible items
  const avgSal = data.memories.length > 0
    ? (data.memories.reduce((s, m) => s + m.salience, 0) / data.memories.length).toFixed(2)
    : '0';
  document.getElementById('drawer-avg-salience').textContent = 'avg salience ' + avgSal;
  const btn = document.getElementById('drawer-load-more');
  if (drawerOffset < drawerTotal) btn.classList.remove('hidden');
  else btn.classList.add('hidden');
}

async function loadMoreMemories() {
  await loadDrawerPage();
}

function closeDrawer() {
  document.getElementById('drawer-overlay').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
  document.body.style.overflow = '';
}

function api(path) {
  const sep = path.includes('?') ? '&' : '?';
  return fetch(BASE + path + sep + 'token=' + TOKEN).then(r => r.json());
}

let salienceChart, memTimelineChart, costChart, cacheChart;

function cronToHuman(cron) {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const time = (hour !== '*' ? hour.padStart(2,'0') : '*') + ':' + (min !== '*' ? min.padStart(2,'0') : '*');
  if (dow === '*' && dom === '*') return 'Daily at ' + time;
  if (dow !== '*' && dom === '*') {
    if (dow === '1-5') return 'Weekdays at ' + time;
    const d = dow.split(',').map(n => days[parseInt(n)] || n).join(', ');
    return d + ' at ' + time;
  }
  return cron;
}

function timeAgo(ts) {
  const diff = Math.floor(Date.now()/1000) - ts;
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}

function countdown(ts) {
  const diff = ts - Math.floor(Date.now()/1000);
  if (diff <= 0) return 'now';
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff/60) + 'm';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ' + Math.floor((diff%3600)/60) + 'm';
  return Math.floor(diff/86400) + 'd';
}

async function loadTasks() {
  try {
    const data = await api('/api/tasks');
    const c = document.getElementById('tasks-container');
    if (!data.tasks || data.tasks.length === 0) {
      c.innerHTML = '<div class="card text-gray-500 text-sm">No scheduled tasks</div>';
      return;
    }
    c.innerHTML = data.tasks.map(t => {
      const statusCls = t.status === 'active' ? 'pill-active' : 'pill-paused';
      const lastResult = t.last_result ? '<details class="mt-2"><summary class="text-xs text-gray-500">Last result</summary><pre class="text-xs text-gray-400 mt-1 whitespace-pre-wrap break-words">' + escapeHtml(t.last_result) + '</pre></details>' : '';
      return '<div class="card"><div class="flex justify-between items-start"><div class="flex-1 mr-2"><div class="text-sm text-white">' + escapeHtml(t.prompt) + '</div><div class="text-xs text-gray-500 mt-1">' + cronToHuman(t.schedule) + ' &middot; next in <span class="countdown" data-ts="' + t.next_run + '">' + countdown(t.next_run) + '</span></div></div><span class="pill ' + statusCls + '">' + t.status + '</span></div>' + lastResult + '</div>';
    }).join('');
  } catch(e) {
    document.getElementById('tasks-container').innerHTML = '<div class="card text-red-400 text-sm">Failed to load tasks</div>';
  }
}

async function loadMemories() {
  try {
    const data = await api('/api/memories?chatId=' + CHAT_ID);
    document.getElementById('mem-semantic').textContent = data.stats.semantic;
    document.getElementById('mem-episodic').textContent = data.stats.episodic;

    // Salience chart
    const bucketLabels = ['0-0.5','0.5-1','1-2','2-3','3-4','4-5'];
    const bucketColors = ['#ef4444','#f97316','#eab308','#84cc16','#22c55e','#10b981'];
    const bucketData = bucketLabels.map(b => {
      const found = data.stats.salienceDistribution.find(d => d.bucket === b);
      return found ? found.count : 0;
    });
    if (salienceChart) salienceChart.destroy();
    salienceChart = new Chart(document.getElementById('salience-chart'), {
      type: 'bar',
      data: { labels: bucketLabels, datasets: [{ data: bucketData, backgroundColor: bucketColors, borderRadius: 4 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: '#666' }, grid: { color: '#222' } }, x: { ticks: { color: '#666' }, grid: { display: false } } } }
    });

    // Fading
    const fading = document.getElementById('fading-list');
    if (data.fading.length === 0) {
      fading.innerHTML = '<span class="text-gray-600">None fading</span>';
    } else {
      fading.innerHTML = data.fading.map(m => '<div class="fade-text truncate py-0.5">' + m.salience.toFixed(2) + ' &middot; ' + escapeHtml(m.content.slice(0,80)) + '</div>').join('');
    }

    // Top accessed
    const top = document.getElementById('top-accessed-list');
    if (data.topAccessed.length === 0) {
      top.innerHTML = '<span class="text-gray-600">No memories yet</span>';
    } else {
      top.innerHTML = data.topAccessed.map(m => '<div class="top-text truncate py-0.5">' + m.salience.toFixed(2) + ' &middot; ' + escapeHtml(m.content.slice(0,80)) + '</div>').join('');
    }

    // Timeline
    if (memTimelineChart) memTimelineChart.destroy();
    if (data.timeline.length > 0) {
      memTimelineChart = new Chart(document.getElementById('memory-timeline-chart'), {
        type: 'line',
        data: {
          labels: data.timeline.map(d => d.date.slice(5)),
          datasets: [
            { label: 'Semantic', data: data.timeline.map(d => d.semantic), borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', fill: true, tension: 0.3 },
            { label: 'Episodic', data: data.timeline.map(d => d.episodic), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.3 }
          ]
        },
        options: { responsive: true, plugins: { legend: { labels: { color: '#888', boxWidth: 12 } } }, scales: { y: { ticks: { color: '#666' }, grid: { color: '#222' } }, x: { ticks: { color: '#666', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } } } }
      });
    }
  } catch(e) {
    console.error('Memory load error', e);
  }
}

function drawGauge(pct) {
  const svg = document.getElementById('context-gauge');
  const r = 36, cx = 45, cy = 45, sw = 8;
  const circ = 2 * Math.PI * r;
  const clampedPct = Math.min(Math.max(pct, 0), 100);
  const dashOffset = circ - (circ * clampedPct / 100);
  let color = '#22c55e';
  if (clampedPct >= 75) color = '#ef4444';
  else if (clampedPct >= 50) color = '#f59e0b';
  svg.innerHTML =
    '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="#2a2a2a" stroke-width="'+sw+'"/>' +
    '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+color+'" stroke-width="'+sw+'" stroke-linecap="round" stroke-dasharray="'+circ+'" stroke-dashoffset="'+dashOffset+'" transform="rotate(-90 '+cx+' '+cy+')"/>' +
    '<text x="'+cx+'" y="'+cy+'" text-anchor="middle" dominant-baseline="central" fill="'+color+'" font-size="16" font-weight="700">'+clampedPct+'%</text>';
}

async function loadHealth() {
  try {
    const data = await api('/api/health?chatId=' + CHAT_ID);
    drawGauge(data.contextPct);
    document.getElementById('health-turns').textContent = data.turns;
    document.getElementById('health-compactions').textContent = data.compactions;
    document.getElementById('health-age').textContent = data.sessionAge;

    const tgPill = document.getElementById('tg-pill');
    tgPill.className = 'pill ' + (data.telegramConnected ? 'pill-connected' : 'pill-disconnected');
    const waPill = document.getElementById('wa-pill');
    waPill.className = 'pill ' + (data.waConnected ? 'pill-connected' : 'pill-disconnected');
    const slackPill = document.getElementById('slack-pill');
    slackPill.className = 'pill ' + (data.slackConnected ? 'pill-connected' : 'pill-disconnected');
  } catch(e) {
    drawGauge(0);
  }
}

async function loadTokens() {
  try {
    const data = await api('/api/tokens?chatId=' + CHAT_ID);
    document.getElementById('token-today-cost').textContent = '$' + data.stats.todayCost.toFixed(2);
    document.getElementById('token-today-turns').textContent = data.stats.todayTurns;
    document.getElementById('token-alltime-cost').textContent = '$' + data.stats.allTimeCost.toFixed(2);
    document.getElementById('token-alltime-turns').textContent = data.stats.allTimeTurns;

    // Cost timeline
    if (costChart) costChart.destroy();
    if (data.costTimeline.length > 0) {
      costChart = new Chart(document.getElementById('cost-chart'), {
        type: 'line',
        data: {
          labels: data.costTimeline.map(d => d.date.slice(5)),
          datasets: [{ label: 'Cost ($)', data: data.costTimeline.map(d => d.cost), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.1)', fill: true, tension: 0.3, pointRadius: 2 }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: '#666', callback: v => '$'+v.toFixed(2) }, grid: { color: '#222' } }, x: { ticks: { color: '#666', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } } } }
      });
    }

    // Cache doughnut
    if (cacheChart) cacheChart.destroy();
    if (data.recentUsage.length > 0) {
      let totalCache = 0, totalInput = 0;
      data.recentUsage.forEach(r => { totalCache += r.cache_read; totalInput += r.input_tokens; });
      const hitPct = totalInput > 0 ? Math.round((totalCache / totalInput) * 100) : 0;
      cacheChart = new Chart(document.getElementById('cache-chart'), {
        type: 'doughnut',
        data: {
          labels: ['Cache Hit', 'Cache Miss'],
          datasets: [{ data: [hitPct, 100 - hitPct], backgroundColor: ['#22c55e', '#2a2a2a'], borderWidth: 0 }]
        },
        options: { responsive: true, cutout: '70%', plugins: { legend: { labels: { color: '#888' } } } }
      });
    }
  } catch(e) {
    console.error('Token load error', e);
  }
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function loadInfo() {
  try {
    const r = await fetch(BASE + '/api/info?token=' + TOKEN + '&chatId=' + CHAT_ID);
    const d = await r.json();
    const el = document.getElementById('bot-info');
    const parts = [];
    if (d.botName) parts.push('<span class="font-semibold text-white">' + d.botName + '</span>' + (d.botUsername ? ' <span class="text-gray-600">@' + d.botUsername + '</span>' : ''));
    if (d.pid) parts.push('PID ' + d.pid);
    if (d.chatId) parts.push('Chat ' + d.chatId);
    el.innerHTML = parts.join(' <span class="text-gray-700">|</span> ');
  } catch {}
}

// Tooltip open/close \u2014 capture phase to intercept before inline onclick handlers
document.addEventListener('click', function(e) {
  const icon = e.target.closest('.info-icon');
  if (icon) {
    e.stopPropagation();
    e.preventDefault();
    const tip = icon.parentElement;
    const wasActive = tip.classList.contains('active');
    document.querySelectorAll('.info-tip.active').forEach(t => t.classList.remove('active'));
    if (!wasActive) tip.classList.add('active');
    return;
  }
  const tooltip = e.target.closest('.info-tooltip');
  if (tooltip) {
    e.stopPropagation();
    e.preventDefault();
    return;
  }
  document.querySelectorAll('.info-tip.active').forEach(t => t.classList.remove('active'));
}, true);

async function refreshAll() {
  const btn = document.getElementById('refresh-btn').querySelector('svg');
  btn.classList.add('refresh-spin');
  await Promise.all([loadInfo(), loadTasks(), loadMemories(), loadHealth(), loadTokens()]);
  btn.classList.remove('refresh-spin');
  document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
}

// Live countdown tickers
setInterval(() => {
  document.querySelectorAll('.countdown').forEach(el => {
    const ts = parseInt(el.dataset.ts);
    if (ts) el.textContent = countdown(ts);
  });
}, 1000);

// Auto-refresh every 60s
setInterval(refreshAll, 60000);

// Initial load
refreshAll();

// \u2500\u2500 Chat \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
let chatOpen = false;
let chatSSE = null;
let chatHistoryLoaded = false;
let unreadCount = 0;

function openChat() {
  chatOpen = true;
  unreadCount = 0;
  updateFabBadge();
  document.getElementById('chat-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  if (!chatHistoryLoaded) loadChatHistory();
  connectChatSSE();
  // Focus input
  setTimeout(() => document.getElementById('chat-input').focus(), 350);
}

function closeChat() {
  chatOpen = false;
  document.getElementById('chat-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function updateFabBadge() {
  const badge = document.getElementById('chat-fab-badge');
  if (unreadCount > 0) {
    badge.style.display = 'flex';
    badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
  } else {
    badge.style.display = 'none';
  }
}

async function loadChatHistory() {
  if (!CHAT_ID) return;
  try {
    const data = await api('/api/chat/history?chatId=' + CHAT_ID + '&limit=40');
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    if (data.turns && data.turns.length > 0) {
      // Reverse: API returns newest first, we want oldest first
      const turns = data.turns.slice().reverse();
      turns.forEach(t => appendChatBubble(t.role, t.content, t.source, false));
    }
    chatHistoryLoaded = true;
    scrollChatBottom();
  } catch(e) {
    console.error('Chat history load error', e);
  }
}

function connectChatSSE() {
  if (chatSSE) { chatSSE.close(); chatSSE = null; }
  const url = BASE + '/api/chat/stream?token=' + TOKEN;
  chatSSE = new EventSource(url);

  chatSSE.addEventListener('user_message', function(e) {
    const ev = JSON.parse(e.data);
    appendChatBubble('user', ev.content, ev.source, true);
    if (!chatOpen) { unreadCount++; updateFabBadge(); }
  });

  chatSSE.addEventListener('assistant_message', function(e) {
    const ev = JSON.parse(e.data);
    appendChatBubble('assistant', ev.content, ev.source, true);
    hideTyping();
    if (!chatOpen) { unreadCount++; updateFabBadge(); }
  });

  chatSSE.addEventListener('processing', function(e) {
    const ev = JSON.parse(e.data);
    if (ev.processing) showTyping(); else hideTyping();
  });

  chatSSE.addEventListener('progress', function(e) {
    const ev = JSON.parse(e.data);
    showProgress(ev.description);
  });

  chatSSE.addEventListener('error', function(e) {
    // SSE error event
    try {
      const ev = JSON.parse(e.data);
      appendChatBubble('assistant', ev.content || 'Error', 'system', true);
    } catch {}
    hideTyping();
  });

  chatSSE.addEventListener('ping', function() { /* keepalive */ });

  chatSSE.onerror = function() {
    // Auto-reconnect handled by EventSource
    updateChatStatus(false);
    setTimeout(() => updateChatStatus(true), 3000);
  };

  chatSSE.onopen = function() { updateChatStatus(true); };
}

function updateChatStatus(connected) {
  const dot = document.getElementById('chat-status-dot');
  dot.style.background = connected ? '#22c55e' : '#ef4444';
}

function appendChatBubble(role, content, source, scroll) {
  const container = document.getElementById('chat-messages');
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble ' + (role === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant');
  bubble.innerHTML = role === 'assistant' ? renderMarkdown(content) : escapeHtml(content);
  if (source) {
    const srcBadge = document.createElement('div');
    srcBadge.className = 'chat-bubble-source';
    srcBadge.textContent = 'Via ' + source.charAt(0).toUpperCase() + source.slice(1);
    bubble.appendChild(srcBadge);
  }
  container.appendChild(bubble);
  if (scroll) scrollChatBottom();
}

function showTyping() {
  const bar = document.getElementById('chat-progress-bar');
  const label = document.getElementById('chat-progress-label');
  if (bar) { bar.classList.add('active'); }
  if (label) { label.textContent = 'Thinking...'; }
  scrollChatBottom();
}

function hideTyping() {
  const bar = document.getElementById('chat-progress-bar');
  if (bar) { bar.classList.remove('active'); }
}

function showProgress(desc) {
  const bar = document.getElementById('chat-progress-bar');
  const label = document.getElementById('chat-progress-label');
  if (bar) { bar.classList.add('active'); }
  if (label) { label.textContent = desc; }
  scrollChatBottom();
}

function scrollChatBottom() {
  const container = document.getElementById('chat-messages');
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
}

function renderMarkdown(text) {
  if (!text) return '';
  // Extract code blocks first
  var blocks = [];
  var s = text.replace(/\\\x60\\\x60\\\x60(?:\\\\w*\\\\n)?([\\\\s\\\\S]*?)\\\x60\\\x60\\\x60/g, function(_, code) {
    blocks.push('<pre><code>' + escapeHtml(code.trim()) + '</code></pre>');
    return '\\\\x00BLK' + (blocks.length - 1) + '\\\\x00';
  });
  // Escape HTML in remaining text
  s = escapeHtml(s);
  // Inline code
  s = s.replace(/\\\x60([^\\\x60]+?)\\\x60/g, '<code>$1</code>');
  // Bold
  s = s.replace(/\\\\*\\\\*([^*]+)\\\\*\\\\*/g, '<b>$1</b>');
  // Italic (single *)
  s = s.replace(/\\\\*([^*]+)\\\\*/g, '<i>$1</i>');
  // Line breaks
  s = s.replace(/\\\\n/g, '<br>');
  // Restore code blocks
  s = s.replace(/\\\\x00BLK(\\\\d+)\\\\x00/g, function(_, i) { return blocks[parseInt(i)]; });
  return s;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autoResizeInput();
  // Disable send while processing
  document.getElementById('chat-send-btn').disabled = true;
  try {
    await fetch(BASE + '/api/chat/send?token=' + TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
  } catch(e) {
    console.error('Send error', e);
  }
  // Re-enable after a short delay (SSE will deliver the actual messages)
  setTimeout(() => { document.getElementById('chat-send-btn').disabled = false; }, 1000);
}

function autoResizeInput() {
  const el = document.getElementById('chat-input');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

async function abortProcessing() {
  try {
    await fetch(BASE + '/api/chat/abort?token=' + TOKEN, { method: 'POST' });
  } catch(e) { console.error('Abort error', e); }
}
</script>

<!-- Chat FAB -->
<button class="chat-fab" id="chat-fab" onclick="openChat()">
  <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
  <span class="chat-fab-badge" id="chat-fab-badge"></span>
</button>

<!-- Chat overlay -->
<div class="chat-overlay" id="chat-overlay">
  <div class="chat-header">
    <div class="flex items-center">
      <span class="chat-header-title">Chat</span>
      <span class="chat-status-dot" id="chat-status-dot" style="background:#6b7280"></span>
    </div>
    <button onclick="closeChat()" class="text-gray-500 hover:text-white text-2xl leading-none">&times;</button>
  </div>
  <div class="chat-messages" id="chat-messages"></div>
  <div class="chat-progress-bar" id="chat-progress-bar">
    <div class="chat-progress-pulse"></div>
    <span class="chat-progress-label" id="chat-progress-label">Thinking...</span>
    <button class="chat-stop-btn" id="chat-stop-btn" onclick="abortProcessing()" title="Stop">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect width="14" height="14" rx="2"/></svg>
    </button>
    <div class="chat-progress-shimmer"></div>
  </div>
  <div class="chat-input-area">
    <textarea class="chat-textarea" id="chat-input" rows="1" placeholder="Send a message..." oninput="autoResizeInput()" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage()}"></textarea>
    <button class="chat-send-btn" id="chat-send-btn" onclick="sendChatMessage()">Send</button>
  </div>
</div>

</body>
</html>`;
}

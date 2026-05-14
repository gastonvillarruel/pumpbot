// app.js — Status Page frontend logic

let allSymbols = [];
let sortKey = 'last_score';
let sortDir = -1;
let filterState = 'ALL';
let searchStr = '';

const stateOrder = { IGNITION: 0, CONFIRMED: 1, PRE_PUMP: 2, WATCH: 3, LATE_DANGER: 4, NORMAL: 5 };

function fmt(n, d = 2) {
  if (n === null || n === undefined) return '—';
  return Number(n).toFixed(d);
}

function scoreBarHtml(score) {
  const w = Math.round(score ?? 0);
  const cls = w >= 80 ? 'score-hi' : w >= 70 ? 'score-md' : w >= 40 ? 'score-lo' : 'score-no';
  return `<span class="score-bar"><span class="score-fill ${cls}" style="width:${w}%"></span></span>`;
}

function timeAgo(ms) {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function renderTable() {
  let data = allSymbols.filter(s => {
    if (filterState !== 'ALL' && s.current_state !== filterState) return false;
    if (searchStr && !s.symbol.toLowerCase().includes(searchStr)) return false;
    return true;
  });

  data.sort((a, b) => {
    if (sortKey === 'current_state') {
      return ((stateOrder[a.current_state] ?? 9) - (stateOrder[b.current_state] ?? 9)) * sortDir;
    }
    return ((a[sortKey] ?? 0) - (b[sortKey] ?? 0)) * sortDir;
  });

  const tbody = document.getElementById('symbols-body');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">Sin resultados</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(s => {
    const features = {}; // En futuro: cargar features del /api/symbols detallado
    return `<tr class="symbol-row" data-symbol="${s.symbol}">
      <td style="font-weight:600">${s.symbol}</td>
      <td><span class="state state-${s.current_state}">${s.current_state.replace('_', ' ')}</span></td>
      <td>${fmt(s.last_score, 1)} ${scoreBarHtml(s.last_score)}</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td style="color:var(--muted)">${s.state_since ? timeAgo(s.state_since) : '—'}</td>
    </tr>`;
  }).join('');

  // Add click listeners to rows
  document.querySelectorAll('.symbol-row').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.symbol));
  });
}

function updateStats() {
  const byState = (st) => allSymbols.filter(s => s.current_state === st).length;
  document.getElementById('stat-symbols').textContent = allSymbols.length;
  document.getElementById('stat-watch').textContent = byState('WATCH');
  document.getElementById('stat-prepump').textContent = byState('PRE_PUMP');
  document.getElementById('stat-ignition').textContent = byState('IGNITION');
}

async function loadAlerts() {
  const res = await fetch('/api/alerts');
  const alerts = await res.json();
  const el = document.getElementById('alerts-list');
  if (!alerts.length) { el.innerHTML = '<div class="loading">Sin alertas aún</div>'; return; }
  el.innerHTML = alerts.slice(0, 20).map(a => `
    <div class="alert-item">
      <span class="al-state state state-${a.state}">${a.state.replace('_', ' ')}</span>
      <span class="al-symbol">${a.symbol}</span>
      <span class="al-score">${fmt(a.score, 1)}/100</span>
      <span class="al-ts">${timeAgo(a.sent_at)}</span>
    </div>
  `).join('');
}

async function loadStatus() {
  const res = await fetch('/api/status');
  const st = await res.json();
  document.getElementById('cycle-info').textContent = `Ciclo #${st.cycleCount}`;
  document.getElementById('stat-cycle-ms').textContent = `${st.lastCycleDurationMs}ms`;
  const uptimeSec = Math.floor((st.uptime ?? 0) / 1000);
  const h = Math.floor(uptimeSec / 3600), m = Math.floor((uptimeSec % 3600) / 60);
  document.getElementById('uptime').textContent = `Uptime: ${h}h ${m}m`;
  const badge = document.getElementById('mode-badge');
  badge.textContent = st.mode?.toUpperCase() ?? 'SHADOW';
  if (st.mode === 'live') badge.classList.add('live');
  const health = document.getElementById('api-health');
  health.textContent = `API: ${st.apiHealth ?? 'OK'}`;
  health.className = st.apiHealth === 'OK' ? 'health-ok' : 'health-err';
}

// SSE
function connectSSE() {
  const dot = document.getElementById('sse-dot');
  const es = new EventSource('/events');
  es.addEventListener('cycle', e => {
    const d = JSON.parse(e.data);
    if (d.symbols) { allSymbols = d.symbols; renderTable(); updateStats(); }
    if (d.status) updateBotStatusUI(d.status);
    loadAlerts();
  });
  es.onopen = () => { dot.className = 'sse-dot connected'; };
  es.onerror = () => {
    dot.className = 'sse-dot disconnected';
    setTimeout(connectSSE, 5000);
  };
}

function updateBotStatusUI(st) {
  if (st.cycleCount !== undefined) document.getElementById('cycle-info').textContent = `Ciclo #${st.cycleCount}`;
  if (st.lastCycleDurationMs !== undefined) document.getElementById('stat-cycle-ms').textContent = `${st.lastCycleDurationMs}ms`;
}

// Sort headers
document.querySelectorAll('thead th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = -1; }
    renderTable();
  });
});

// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterState = btn.dataset.filter;
    renderTable();
  });
});

// Search
document.getElementById('search').addEventListener('input', e => {
  searchStr = e.target.value.toLowerCase();
  renderTable();
});

// Modal Logic
const modal = document.getElementById('symbol-modal');
const closeBtn = document.getElementById('modal-close');

closeBtn.onclick = () => modal.style.display = "none";
window.onclick = (e) => { if (e.target == modal) modal.style.display = "none"; };

async function openModal(symbol) {
  modal.style.display = "block";
  document.getElementById('modal-title').textContent = symbol;
  document.getElementById('modal-state').textContent = '...';
  document.getElementById('modal-state').className = 'badge';
  document.getElementById('modal-score').textContent = '...';
  document.getElementById('modal-body').innerHTML = '<div class="loading">Cargando detalles...</div>';

  try {
    const res = await fetch(`/api/symbol/${symbol}`);
    if (!res.ok) throw new Error('No data');
    const data = await res.json();
    renderModalContent(data);
  } catch (err) {
    document.getElementById('modal-body').innerHTML = '<div class="health-err">Error cargando detalles o no hay datos suficientes.</div>';
  }
}

function renderModalContent(data) {
  const { symbol, state, details } = data;
  const current_state = state.current_state || 'NORMAL';
  
  document.getElementById('modal-state').textContent = current_state.replace('_', ' ');
  document.getElementById('modal-state').className = `badge state-${current_state}`;
  
  if (!details) {
    document.getElementById('modal-body').innerHTML = '<div>Aún no hay datos analizados para este símbolo.</div>';
    return;
  }

  const f = details.features;
  const bk = details.scoreBreakdown || {};
  const pen = details.penalties || {};
  
  document.getElementById('modal-score').textContent = `${fmt(details.score, 1)} pts`;

  // Score Breakdown HTML
  const bkHtml = Object.entries(bk).map(([k, v]) => `
    <div class="bk-item">
      <span>${k}</span>
      <span style="font-weight:600; color:var(--primary)">+${fmt(v, 1)}</span>
    </div>
  `).join('');

  // Penalties HTML
  const penHtml = Object.entries(pen).length ? `
    <div class="penalties-section">
      <h4>🚨 Penalizaciones Aplicadas</h4>
      ${Object.entries(pen).map(([k, v]) => `
        <div class="bk-item" style="color:#ef4444">
          <span>${k}</span>
          <span style="font-weight:600">${v}</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  // Features HTML
  const featHtml = `
    <div class="feat-grid">
      <div class="feat-card">
        <div class="feat-label">RVOL (1h)</div>
        <div class="feat-val">${fmt(f.rvol_1h, 2)}x</div>
      </div>
      <div class="feat-card">
        <div class="feat-label">OI Change (1h)</div>
        <div class="feat-val">${fmt(f.oi_change_1h, 2)}%</div>
      </div>
      <div class="feat-card">
        <div class="feat-label">Funding Rate</div>
        <div class="feat-val">${fmt((f.funding_rate ?? 0) * 100, 4)}%</div>
      </div>
      <div class="feat-card">
        <div class="feat-label">BB Width (1h)</div>
        <div class="feat-val">${fmt(f.bbw, 2)}%</div>
      </div>
      <div class="feat-card">
        <div class="feat-label">Extensión MA20</div>
        <div class="feat-val">${fmt(f.price_extension, 2)}%</div>
      </div>
      <div class="feat-card">
        <div class="feat-label">High 24h</div>
        <div class="feat-val">${fmt(f.high_24h, 4)}</div>
      </div>
    </div>
  `;

  document.getElementById('modal-body').innerHTML = `
    <div class="modal-grid">
      <div class="modal-col">
        <h3>Desglose de Score</h3>
        ${bkHtml || '<div class="muted">Sin desglose</div>'}
        ${penHtml}
      </div>
      <div class="modal-col">
        <h3>Métricas Clave</h3>
        ${featHtml}
      </div>
    </div>
  `;
}

// Init
(async () => {
  await loadStatus();
  const res = await fetch('/api/symbols');
  allSymbols = await res.json();
  renderTable();
  updateStats();
  await loadAlerts();
  connectSSE();
})();

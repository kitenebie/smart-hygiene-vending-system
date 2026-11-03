// ============================================================
// 4Peace Admin Dashboard — front-end logic
// Fetches live data from api/*.php and renders each tab.
// ============================================================

const statusMeta = {
  ok:    { color: 'var(--sage)',  tag: 'ok',    label: 'In stock' },
  low:   { color: 'var(--amber)', tag: 'low',   label: 'Low stock' },
  empty: { color: 'var(--rust)',  tag: 'empty', label: 'Empty' },
};
const levelMeta = {
  info:     { icon: '✓', color: 'var(--sage)',  bg: 'var(--sage-bg)' },
  warning:  { icon: '!', color: 'var(--amber)', bg: 'var(--amber-bg)' },
  critical: { icon: '✕', color: 'var(--rust)',  bg: 'var(--rust-bg)' },
};
let overviewCharts = null;
let healthCharts = [];
let currentSlots = [];

function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => el.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = 'login.php';
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Request failed');
  }
  return res.json();
}

function escapeHTML(value) {
  const node = document.createElement('span');
  node.textContent = value ?? '';
  return node.innerHTML;
}

function maskPaymentReference(reference) {
  const value = String(reference ?? '');
  if (value.length <= 2) return '*'.repeat(value.length);
  if (value.length <= 6) return value[0] + '*'.repeat(value.length - 2) + value.slice(-1);
  return value.slice(0, 3) + '*'.repeat(value.length - 6) + value.slice(-3);
}

// ---------- OVERVIEW ----------
async function loadOverview() {
  try {
    const d = await api('api/overview.php');

    document.getElementById('overviewStats').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Units left</div>
        <div class="stat-value mono">${d.units_left}</div>
        <div class="stat-delta">of ${d.units_capacity} capacity</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Today's sales</div>
        <div class="stat-value mono">₱${Number(d.today_sales).toFixed(0)}</div>
        <div class="stat-delta ${d.sales_delta_pct < 0 ? 'down' : ''}">${d.sales_delta_pct === null ? 'No data yesterday' : (d.sales_delta_pct >= 0 ? '↑' : '↓') + ' ' + Math.abs(d.sales_delta_pct) + '% vs yesterday'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Dispenses today</div>
        <div class="stat-value mono">${d.dispenses_today}</div>
        <div class="stat-delta">GCash ${d.gcash_count} · Coin ${d.coin_count}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Coin box level</div>
        <div class="stat-value mono">${d.coin_box_pct}%</div>
        <div class="stat-delta ${d.coin_box_pct >= 80 ? 'down' : ''}">${d.coin_box_pct >= 80 ? 'Nearing capacity' : 'Within normal range'}</div>
      </div>`;

    const lowBody = document.querySelector('#overviewLowStockTable tbody');
    lowBody.innerHTML = d.low_stock_slots.length ? d.low_stock_slots.map(s => {
      const meta = statusMeta[s.status];
      return `<tr>
        <td class="slot-id">${s.slot_code}</td>
        <td>${s.product_name}</td>
        <td class="mono">${s.stock}</td>
        <td><span class="tag ${meta.tag}"><span class="dot"></span>${meta.label}</span></td>
      </tr>`;
    }).join('') : `<tr><td colspan="4" class="empty-note">Nothing needs attention — every slot is stocked.</td></tr>`;

    const actWrap = document.getElementById('overviewActivity');
    actWrap.innerHTML = d.activity.length ? d.activity.map(a => {
      const meta = levelMeta[a.level] || levelMeta.info;
      return `<div class="log-row">
        <div class="log-icon" style="background:${meta.bg}; color:${meta.color};">${meta.icon}</div>
        <div><div class="log-text">${a.text}</div><div class="log-time">${a.time_label}</div></div>
      </div>`;
    }).join('') : `<div class="empty-note">No activity yet.</div>`;

    const syncText = d.last_sync ? (timeAgoLabel(d.last_sync) === 'just now' ? 'synced just now' : 'last sync ' + timeAgoLabel(d.last_sync)) : 'No telemetry received yet';
    const connected = Boolean(d.last_sync) && (Date.now() - parseDateTime(d.last_sync).getTime()) < 150000;
    document.getElementById('machinePill').title = syncText;
    document.getElementById('esp32StatusDot').classList.toggle('inactive', !connected);
    const statusLabel = document.getElementById('lastSyncPill');
    statusLabel.className = 'esp32-status ' + (connected ? 'connected' : 'waiting');
    statusLabel.textContent = connected ? 'ESP32 connected · ' + syncText : 'Waiting for ESP32';
    renderOverviewCharts(d);
  } catch (e) {
    toast('Could not load overview: ' + e.message, true);
  }
}

function renderOverviewCharts(d) {
  const common = {
    chart: { background: 'transparent', foreColor: '#9b939e', fontFamily: "'Work Sans', sans-serif", toolbar: { show: false }, zoom: { enabled: false } },
    dataLabels: { enabled: false },
    grid: { borderColor: '#252229', strokeDashArray: 3 },
    tooltip: { theme: 'dark', style: { fontSize: '12px' } },
  };
  const charts = [
    {
      el: '#overviewTrendChart', type: 'area', height: 280,
      options: { ...common, chart: { ...common.chart, type: 'area' }, colors: ['#d97b93', '#0072de', '#8fb389'], stroke: { curve: 'smooth', width: [3, 2, 2] }, fill: { type: ['gradient', 'solid', 'solid'], gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05, stops: [0, 90, 100] } }, xaxis: { categories: d.trend_dates, axisBorder: { color: '#252229' }, axisTicks: { color: '#252229' }, labels: { style: { fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" } } }, yaxis: [{ title: { text: 'Revenue (₱)', style: { color: '#d97b93', fontSize: '11px', fontWeight: 600 } }, labels: { formatter: v => `₱${Number(v).toFixed(0)}`, style: { fontFamily: "'JetBrains Mono', monospace" } } }, { opposite: true, title: { text: 'Dispenses (Count)', style: { color: '#9b939e', fontSize: '11px', fontWeight: 600 } }, labels: { formatter: v => Number(v).toFixed(0), style: { fontFamily: "'JetBrains Mono', monospace" } } }], legend: { position: 'top', horizontalAlign: 'right', labels: { colors: '#f1ece6' }, markers: { size: 6, strokeWidth: 0 } }, tooltip: { theme: 'dark', style: { fontSize: '12px' }, y: { formatter: (v, opts) => opts?.seriesIndex === 0 ? `₱${Number(v).toFixed(2)}` : `${v} units` } } },
      series: [{ name: 'Total Revenue (₱)', type: 'area', data: d.trend_sales }, { name: 'GCash Dispenses', type: 'line', data: d.trend_gcash }, { name: 'Coin Dispenses', type: 'line', data: d.trend_coin }],
    },
    {
      el: '#overviewProductChart', type: 'bar', height: 260,
      options: { ...common, chart: { ...common.chart, type: 'bar' }, colors: ['#d97b93', '#8fb389'], plotOptions: { bar: { columnWidth: '46%', borderRadius: 4 } }, xaxis: { categories: d.product_labels, axisBorder: { color: '#252229' }, labels: { style: { fontSize: '10.5px' } } }, yaxis: { title: { text: 'Units / Volume', style: { color: '#9b939e', fontSize: '11px' } }, labels: { style: { fontFamily: "'JetBrains Mono', monospace" } } }, legend: { position: 'top', horizontalAlign: 'right', labels: { colors: '#f1ece6' }, markers: { size: 6, strokeWidth: 0 } } },
      series: [{ name: 'Total Dispensed', data: d.product_dispenses }, { name: 'Remaining Stock', data: d.product_stocks }],
    },
    {
      el: '#overviewPaymentChart', type: 'donut', height: 260,
      options: { ...common, chart: { ...common.chart, type: 'donut' }, colors: ['#0072de', '#d97b93'], labels: ['GCash Online', 'Coin Acceptor'], stroke: { colors: ['#151318'], width: 2 }, dataLabels: { enabled: true, formatter: val => `${Number(val).toFixed(0)}%`, style: { fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" } }, legend: { position: 'bottom', labels: { colors: '#f1ece6' }, markers: { size: 6, strokeWidth: 0 } }, plotOptions: { pie: { donut: { size: '68%', labels: { show: true, total: { show: true, label: 'Total Dispenses', color: '#9b939e', fontSize: '11px', formatter: () => d.payment_counts.reduce((a, b) => a + b, 0) }, value: { color: '#f1ece6', fontSize: '22px', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 } } } } }, tooltip: { theme: 'dark', y: { formatter: (value, opts) => `${value} transactions (₱${(d.payment_amounts[opts?.seriesIndex ?? 0] || 0).toFixed(2)})` } } },
      series: d.payment_counts,
    },
    {
      el: '#overviewStockChart', type: 'pie', height: 240,
      options: { ...common, chart: { ...common.chart, type: 'pie' }, colors: ['#d97b93', '#8fb389', '#e0ab4c', '#0072de', '#e0715a'], labels: d.stock_labels, stroke: { colors: ['#151318'], width: 2 }, dataLabels: { enabled: true, formatter: val => `${Number(val).toFixed(0)}%`, style: { fontSize: '10.5px', fontFamily: "'JetBrains Mono', monospace" } }, legend: { position: 'bottom', labels: { colors: '#f1ece6' }, markers: { size: 5, strokeWidth: 0 } }, tooltip: { theme: 'dark', y: { formatter: value => `${value} units in rack` } } },
      series: d.stock_values,
    },
  ];
  if (!overviewCharts) {
    overviewCharts = charts.map(config => {
      const chart = new ApexCharts(document.querySelector(config.el), { ...config.options, series: config.series, chart: { ...config.options.chart, height: config.height } });
      chart.render();
      return chart;
    });
  } else {
    charts.forEach((config, i) => {
      overviewCharts[i].updateOptions(config.options);
      overviewCharts[i].updateSeries(config.series);
    });
  }
}

function parseDateTime(value) {
  const text = String(value).trim().replace(' ', 'T');
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
}

function timeAgoLabel(datetime) {
  const diff = (Date.now() - parseDateTime(datetime)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
  return Math.floor(diff / 86400) + ' day(s) ago';
}

// ---------- SLOTS ----------
async function loadSlots() {
  try {
    const slots = await api('api/slots.php');
    currentSlots = slots;
    const rackFrame = document.getElementById('rackFrame');
    const slotBody = document.getElementById('slotBody');
    rackFrame.innerHTML = '';
    slotBody.innerHTML = '';

    slots.forEach(s => {
      const pct = Math.round((s.stock / s.capacity) * 100);
      const meta = statusMeta[s.status];
      rackFrame.innerHTML += `
        <div class="rack-slot">
          <div class="rack-fill" style="width:${pct}%; background:${meta.color};"></div>
          <span>${s.slot_code} ${pct}%</span>
        </div>`;
      slotBody.innerHTML += `
        <tr>
          <td class="slot-id">${escapeHTML(s.slot_code)}</td>
          <td>${escapeHTML(s.product_name)}</td>
          <td class="mono">${s.stock} / ${s.capacity}</td>
          <td><div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${meta.color};"></div></div></td>
          <td><span class="tag ${meta.tag}"><span class="dot"></span>${meta.label}</span></td>
          <td><button class="btn small" type="button" data-restock-id="${Number(s.id)}" ${s.stock >= s.capacity ? 'disabled' : ''}>${s.stock >= s.capacity ? 'Full' : 'Add stock'}</button></td>
        </tr>`;
    });
  } catch (e) {
    toast('Could not load slots: ' + e.message, true);
  }
}

function closeRestockModal() {
  document.getElementById('stockModalRoot').innerHTML = '';
}

function openRestockModal(slot) {
  const available = slot.capacity - slot.stock;
  document.getElementById('stockModalRoot').innerHTML = `
    <div class="stock-modal-backdrop" id="stockModalBackdrop" role="presentation">
      <section class="stock-modal" role="dialog" aria-modal="true" aria-labelledby="restock-title">
        <header><div><h2 id="restock-title" class="display">Add stock — ${escapeHTML(slot.slot_code)}</h2><p>${escapeHTML(slot.product_name)} currently has ${slot.stock} of ${slot.capacity} items.</p></div>
          <button class="pin-modal-close" type="button" data-close-restock aria-label="Close add stock dialog">×</button></header>
        <form id="restockForm"><label for="stockQuantity">Quantity to add</label>
          <input id="stockQuantity" class="input mono" type="number" min="1" max="${available}" value="1" required autofocus>
          <div class="field-hint">Maximum: ${available} item(s)</div>
          <div class="stock-modal-actions"><button class="btn ghost" type="button" data-close-restock>Cancel</button><button class="btn" type="submit">Add stock</button></div>
        </form>
      </section>
    </div>`;
  document.getElementById('stockModalBackdrop').addEventListener('mousedown', event => { if (event.target.id === 'stockModalBackdrop') closeRestockModal(); });
  document.querySelectorAll('[data-close-restock]').forEach(button => button.addEventListener('click', closeRestockModal));
  document.getElementById('restockForm').addEventListener('submit', event => {
    event.preventDefault();
    submitRestock(slot, available);
  });
  document.getElementById('stockQuantity').focus();
}

async function submitRestock(slot, available) {
  const input = document.getElementById('stockQuantity');
  const quantity = Number(input.value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > available) {
    toast(`Only ${available} item(s) fit in ${slot.slot_code}.`, true);
    return;
  }
  const submit = document.querySelector('#restockForm button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Adding…';
  try {
    const result = await api('api/slot_restock.php', { method: 'POST', body: JSON.stringify({ slot_id: slot.id, quantity }) });
    closeRestockModal();
    toast(`${result.added} item(s) added to ${slot.slot_code}. Stock: ${result.stock}/${result.capacity}.`);
    await loadSlots();
  } catch (error) {
    submit.disabled = false;
    submit.textContent = 'Add stock';
    toast(error.message || 'Could not add stock.', true);
  }
}

// ---------- TRANSACTIONS ----------
async function loadTransactions() {
  try {
    const txs = await api('api/transactions.php?limit=30');
    const txBody = document.getElementById('txBody');
    txBody.innerHTML = txs.length ? txs.map(t => `
      <tr>
        <td class="slot-id">${t.method === 'gcash' ? maskPaymentReference(t.ref_code) : escapeHTML(t.ref_code)}</td>
        <td><div class="tx-method"><div class="method-chip ${t.method}">${t.method === 'gcash' ? 'G' : '₱'}</div>${t.method === 'gcash' ? 'GCash' : 'Coin'}</div></td>
        <td class="slot-id">${t.slot}</td>
        <td class="tx-amount">₱${Number(t.amount).toFixed(2)}</td>
        <td class="tx-time">${t.time}</td>
      </tr>`).join('') : `<tr><td colspan="5" class="empty-note">No transactions yet.</td></tr>`;
  } catch (e) {
    toast('Could not load transactions: ' + e.message, true);
  }
  loadGcashPending();
}

// ---------- GCASH APPROVALS ----------
const gcashStatusMeta = {
  pending:  { tag: 'pending',  label: 'Pending' },
  approved: { tag: 'approved', label: 'Approved' },
  rejected: { tag: 'rejected', label: 'Rejected' },
  consumed: { tag: 'approved', label: 'Dispensed' },
};

async function loadGcashPending() {
  try {
    const rows = await api('api/gcash_pending.php');
    const body = document.getElementById('gcashBody');
    body.innerHTML = rows.length ? rows.map(g => {
      const state = g.consumed_at ? 'consumed' : g.status;
      const meta = gcashStatusMeta[state];
      const actions = g.status === 'pending' && !g.consumed_at
        ? `<div class="gcash-actions">
             <button class="btn small approve" data-id="${g.id}" data-action="approve">Approve</button>
             <button class="btn small reject" data-id="${g.id}" data-action="reject">Reject</button>
           </div>`
        : '';
      return `<tr>
        <td class="slot-id">${maskPaymentReference(g.ref_code)}</td>
        <td class="slot-id">${escapeHTML(g.slot_code)}</td>
        <td class="tx-amount">₱${Number(g.amount).toFixed(2)}</td>
        <td class="tx-time">${g.time}</td>
        <td><span class="tag ${meta.tag}"><span class="dot"></span>${meta.label}</span></td>
        <td>${actions}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="6" class="empty-note">No GCash references submitted yet.</td></tr>`;

    body.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => resolveGcash(btn.dataset.id, btn.dataset.action));
    });
  } catch (e) {
    toast('Could not load GCash approvals: ' + e.message, true);
  }
}

async function resolveGcash(id, action) {
  try {
    await api('api/gcash_approve.php', {
      method: 'POST',
      body: JSON.stringify({ id: Number(id), action }),
    });
    toast(action === 'approve' ? 'GCash reference approved.' : 'GCash reference rejected.');
    loadGcashPending();
    loadNotifBadge();
  } catch (e) {
    toast('Could not update payment: ' + e.message, true);
  }
}

// ---------- HEALTH ----------
async function loadHealth() {
  try {
    const d = await api('api/health.php');
    const grid = document.getElementById('healthGrid');
    grid.innerHTML = d.metrics.map(m => {
      const color = m.status === 'ok' ? 'var(--sage)' : m.status === 'warn' ? 'var(--amber)' : m.status === 'crit' ? 'var(--rust)' : 'var(--clay)';
      return `<div class="health-card">
        <div class="health-top">
          <div class="health-name">${m.name}</div>
          <div class="pulse" style="background:${color}; color:${color};"></div>
        </div>
        <div class="health-metric">${m.value}</div>
        <div class="health-bar"><div class="health-bar-fill" style="width:${m.pct}%; background:${color};"></div></div>
      </div>`;
    }).join('');

    const logList = document.getElementById('logList');
    logList.innerHTML = d.logs.length ? d.logs.map(l => {
      const meta = levelMeta[l.level] || levelMeta.info;
      return `<div class="log-row">
        <div class="log-icon" style="background:${meta.bg}; color:${meta.color};">${meta.icon}</div>
        <div><div class="log-text">${l.text}</div><div class="log-time">${l.time}</div></div>
      </div>`;
    }).join('') : `<div class="empty-note">No log entries yet.</div>`;
    renderHealthResources(d.resources || []);
  } catch (e) {
    toast('Could not load device health: ' + e.message, true);
  }
}

function renderHealthResources(resources) {
  healthCharts.forEach(chart => chart.destroy());
  healthCharts = [];
  const history = [...resources].reverse();
  const latest = resources[0];
  const setChartState = (chartId, emptyId, show, message) => {
    const chart = document.getElementById(chartId);
    const empty = document.getElementById(emptyId);
    chart.style.display = show ? 'block' : 'none';
    empty.hidden = show;
    if (message) empty.textContent = message;
  };
  const timeLabel = value => parseDateTime(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const common = { chart: { background: 'transparent', foreColor: '#9b939e', toolbar: { show: false }, zoom: { enabled: false } }, dataLabels: { enabled: false }, grid: { borderColor: '#252229', strokeDashArray: 3 }, tooltip: { theme: 'dark' } };

  setChartState('memoryChart', 'memoryEmpty', history.length > 0);
  if (history.length) {
    const chart = new ApexCharts(document.getElementById('memoryChart'), {
      ...common, chart: { ...common.chart, type: 'line', height: 260 }, colors: ['#8fb389', '#0072de'], stroke: { curve: 'smooth', width: 3 },
      xaxis: { categories: history.map(sample => timeLabel(sample.collected_at)) },
      yaxis: { title: { text: 'Free memory (KiB)' }, labels: { formatter: value => `${Math.round(value)} KiB` } },
      legend: { position: 'top', horizontalAlign: 'right', labels: { colors: '#f1ece6' } },
      tooltip: { theme: 'dark', y: { formatter: value => `${value.toFixed(0)} KiB free` } },
      series: [
        { name: 'Internal SRAM', data: history.map(sample => Math.round(Number(sample.internal_sram_free_bytes) / 1024)) },
        { name: 'External PSRAM', data: history.map(sample => Math.round(Number(sample.external_psram_free_bytes) / 1024)) },
      ],
    });
    healthCharts.push(chart);
    chart.render();
  }

  setChartState('storageChart', 'storageEmpty', Boolean(latest));
  const storageNote = document.getElementById('storageNote');
  storageNote.hidden = !latest;
  if (latest) {
    const externalFlashFree = Math.max(0, Number(latest.external_flash_total_bytes) - Number(latest.external_flash_used_bytes) - Number(latest.filesystem_total_bytes));
    const chart = new ApexCharts(document.getElementById('storageChart'), {
      ...common, chart: { ...common.chart, type: 'donut', height: 260 }, colors: ['#645f6a', '#d97b93', '#8fb389', '#0072de', '#e0ab4c'],
      labels: ['Internal flash (not present)', 'Firmware in external flash', 'File system partition', 'Available external flash', 'ROM'],
      stroke: { colors: ['#151318'], width: 2 }, dataLabels: { enabled: true, formatter: value => `${Number(value).toFixed(0)}%` },
      legend: { position: 'bottom', labels: { colors: '#f1ece6' } },
      tooltip: { theme: 'dark', y: { formatter: value => formatBytes(value) } },
      series: [0, Number(latest.external_flash_used_bytes), Number(latest.filesystem_total_bytes), externalFlashFree, Number(latest.rom_total_bytes)],
    });
    healthCharts.push(chart);
    chart.render();
    storageNote.textContent = `Internal flash: not present on ESP32-WROOM; firmware uses external SPI flash. File system used: ${formatBytes(latest.filesystem_used_bytes)}.`;
  }

  const reported = new Map();
  for (const sample of history) {
    if (sample.cpu_temperature_c === null || sample.cpu_temperature_c === '') continue;
    const timestamp = parseDateTime(sample.collected_at).getTime();
    if (Number.isFinite(timestamp)) reported.set(Math.floor(timestamp / 60000) * 60000, Number(sample.cpu_temperature_c));
  }
  const points = [...reported.entries()].sort((a, b) => a[0] - b[0]);
  let timeline = [];
  if (points.length) {
    const nowMinute = Math.floor(Date.now() / 60000) * 60000;
    const end = Math.max(nowMinute, points.at(-1)[0]);
    const start = Math.max(points[0][0], end - 6 * 60 * 60 * 1000);
    let previous = null;
    let nextIndex = 0;
    while (nextIndex < points.length && points[nextIndex][0] < start) previous = points[nextIndex++];
    for (let timestamp = start; timestamp <= end; timestamp += 60000) {
      const value = reported.get(timestamp);
      if (value !== undefined) { timeline.push({ timestamp, value }); previous = [timestamp, value]; while (nextIndex < points.length && points[nextIndex][0] <= timestamp) nextIndex++; continue; }
      const next = points[nextIndex];
      let interpolated = 0;
      if (previous && next && next[0] - previous[0] <= 180000) interpolated = previous[1] + ((timestamp - previous[0]) / (next[0] - previous[0])) * (next[1] - previous[1]);
      else if (previous && !next && timestamp - previous[0] <= 180000) interpolated = previous[1];
      timeline.push({ timestamp, value: interpolated });
    }
  }
  setChartState('temperatureChart', 'temperatureEmpty', timeline.length > 0);
  const highest = points.length ? Math.max(...points.map(point => point[1])) : null;
  const highestBadge = document.getElementById('highestTemperature');
  highestBadge.hidden = highest === null;
  if (highest !== null) highestBadge.innerHTML = `<span aria-hidden="true"></span>Highest recorded: ${highest.toFixed(1)}°C`;
  if (timeline.length) {
    const chart = new ApexCharts(document.getElementById('temperatureChart'), {
      ...common, chart: { ...common.chart, type: 'line', height: 260 }, colors: ['#e0ab4c'], stroke: { curve: 'straight', width: 3 },
      xaxis: { categories: timeline.map(point => timeLabel(new Date(point.timestamp).toISOString())) },
      yaxis: { title: { text: 'Temperature (°C)' }, labels: { formatter: value => `${value.toFixed(1)}°C` } },
      tooltip: { theme: 'dark', y: { formatter: value => value === 0 ? '0°C — no ESP32 telemetry' : `${value.toFixed(1)}°C` } },
      series: [{ name: 'Internal CPU temperature', data: timeline.map(point => point.value) }],
    });
    healthCharts.push(chart);
    chart.render();
  }
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

// ---------- NOTIFICATIONS ----------
async function loadNotifications() {
  try {
    const d = await api('api/notifications.php');
    const list = document.getElementById('notifList');
    list.innerHTML = d.notifications.length ? d.notifications.map(n => {
      const meta = levelMeta[n.level] || levelMeta.info;
      return `<div class="log-row ${n.is_read ? '' : 'unread'}">
        <div class="log-icon" style="background:${meta.bg}; color:${meta.color};">${meta.icon}</div>
        <div style="flex:1;"><div class="log-text">${n.message}</div><div class="log-time">${n.time}</div></div>
        ${n.is_read ? '' : '<div class="unread-dot"></div>'}
      </div>`;
    }).join('') : `<div class="empty-note">No notifications yet.</div>`;
    updateNotifBadge(d.unread_count);
  } catch (e) {
    toast('Could not load notifications: ' + e.message, true);
  }
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notifBadge');
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

async function loadNotifBadge() {
  try {
    const d = await api('api/notifications.php');
    updateNotifBadge(d.unread_count);
  } catch { /* silent — badge is a nice-to-have */ }
}

async function markAllNotifsRead() {
  try {
    await api('api/notifications_read.php', { method: 'POST' });
    loadNotifications();
  } catch (e) {
    toast('Could not mark as read: ' + e.message, true);
  }
}

async function loadSmsLogs() {
  try {
    const rows = await api('api/sms_logs.php');
    const eventLabels = { dispensed_product: 'Product dispensed', payment: 'Payment', theft_alert: 'Theft alert', low_stock: 'Low stock' };
    document.getElementById('smsLogsEmpty').hidden = rows.length > 0;
    document.getElementById('smsLogsBody').innerHTML = rows.length ? rows.map(row => `
      <tr><td><div class="sms-event">${escapeHTML(eventLabels[row.event_type] || row.event_type)}</div><div class="sms-machine mono">${escapeHTML(row.machine_id)}</div></td>
      <td class="mono">${escapeHTML(row.recipient)}</td><td><div class="sms-message">${escapeHTML(row.message)}</div>${row.last_error && row.status === 'pending' ? `<div class="sms-error">${escapeHTML(row.last_error)}</div>` : ''}</td>
      <td><span class="tag ${row.status === 'sent' ? 'sent' : 'pending'}"><span class="dot"></span> ${escapeHTML(row.status)}</span><div class="log-time">${row.status === 'sent' ? (row.sent_at ? 'Sent ' + timeAgoLabel(row.sent_at) : 'Sent') : Number(row.attempt_count) === 0 ? 'Queued for sending' : `Retry ${Number(row.attempt_count)}${row.last_attempt_at ? ' · ' + timeAgoLabel(row.last_attempt_at) : ''}`}</div></td>
      <td class="tx-time">${timeAgoLabel(row.created_at)}</td></tr>`).join('') : '';
  } catch (e) { toast('Could not load SMS logs: ' + e.message, true); }
}

async function loadEsp32Logs() {
  try {
    const rows = await api('api/esp32_logs.php');
    document.getElementById('esp32LogsEmpty').hidden = rows.length > 0;
    document.getElementById('esp32LogsBody').innerHTML = rows.length ? rows.map(row => `
      <tr><td class="tx-time" title="${escapeHTML(row.created_at)}">${timeAgoLabel(row.created_at)}</td><td><span class="sms-event mono">${escapeHTML(row.category)}</span><div class="sms-machine mono">${escapeHTML(row.machine_id)}</div></td>
      <td><div class="sms-message">${escapeHTML(row.message)}</div></td><td><span class="tag ${row.level === 'error' ? 'failed' : row.level === 'warning' ? 'pending' : 'sent'}"><span class="dot"></span> ${escapeHTML(row.level)}</span></td></tr>`).join('') : '';
  } catch (e) { toast('Could not load ESP32 logs: ' + e.message, true); }
}

// ---------- SETTINGS ----------
const esp32Pins = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,21,22,23,25,26,27,32,33,34,35,36,37,38,39];
const pinLabels = { 4:'Tamper Sensor',13:'S1 Relay',14:'S2 Relay',18:'S3 Relay',19:'S4 Relay',23:'S5 Relay',21:'I2C SDA (LCD)',22:'I2C SCL (LCD)',25:'Buzzer',26:'Coin Acceptor',27:'S5 Sensor',32:'S3 Sensor',33:'S4 Sensor',34:'S1 Sensor',35:'S2 Sensor',36:'Buck 1 ADC',39:'Buck 2 ADC',16:'SIM800L RX',17:'SIM800L TX' };

function closePinModal(updateDetection = false) {
  document.getElementById('pinModalRoot').innerHTML = '';
  if (!updateDetection) return;
  const pinSwitch = document.getElementById('setPinDetection');
  pinSwitch.classList.add('off');
  api('api/pin_detection.php', { method: 'POST', body: JSON.stringify({ enabled: false }) }).catch(error => {
    pinSwitch.classList.remove('off');
    toast(error.message || 'Could not turn off ESP32 PIN connection detection.', true);
    openPinModal();
  });
}

async function openPinModal() {
  document.getElementById('pinModalRoot').innerHTML = '<div class="pin-modal-backdrop"><section class="pin-modal"><div class="empty-note">Loading ESP32 PIN status…</div></section></div>';
  try {
    const data = await api('api/pin_status.php');
    renderPinModal(data);
  } catch (error) {
    toast('Could not load ESP32 PIN status: ' + error.message, true);
    closePinModal();
  }
}

function renderPinModal(data) {
  const pinMap = new Map(data.pins.map(pin => [Number(pin.gpio), pin]));
  const deviceMap = new Map(data.devices.map(device => [Number(device.id), device]));
  const rows = esp32Pins.map(gpio => {
    const status = pinMap.get(gpio) || { gpio, pin_label: '', current_mode: 'Waiting for ESP32', connection_status: 'disconnected', realtime_value: '—', updated_at: '' };
    const connected = status.connection_status === 'connected' && status.updated_at && (Date.now() - parseDateTime(status.updated_at).getTime()) < 15000;
    const device = deviceMap.get(Number(status.device_id));
    return { ...status, gpio, connected, device, label: status.pin_label || pinLabels[gpio] || '' };
  }).sort((a, b) => Number(Boolean(pinLabels[b.gpio])) - Number(Boolean(pinLabels[a.gpio])) || Number(b.connected) - Number(a.connected) || a.gpio - b.gpio);
  const body = rows.map(row => `
    <tr><td><span class="pin-number${pinLabels[row.gpio] ? ' priority' : ''}">D${row.gpio}${row.label ? ' - ' + escapeHTML(row.label) : ''}</span></td>
      <td><div class="pin-device-display"><span class="pin-device-image" aria-hidden="true">${row.device?.image_url ? `<img src="${escapeHTML(row.device.image_url)}" alt="">` : escapeHTML(row.device?.name?.slice(0,1).toUpperCase() || '—')}</span><span>${escapeHTML(row.device?.name || 'No device selected')}</span></div></td>
      <td><span class="pin-mode">${escapeHTML(row.current_mode)}</span></td>
      <td>${row.connected ? '<span class="pin-badge connected"><span class="pin-pulse"></span>Device Connected</span>' : '<span class="pin-badge disconnected">No Device Connected</span>'}</td>
      <td class="pin-value">${row.connected ? escapeHTML(row.realtime_value) : '—'}</td>
      <td class="pin-action-cell"><div class="pin-device-picker"><button class="pin-device-select" type="button" data-pin-picker="${row.gpio}" aria-expanded="false">${row.device ? 'Change device' : 'Select device'} <span aria-hidden="true">⌄</span></button>
        <div class="pin-device-menu" data-pin-menu="${row.gpio}" hidden><input class="pin-device-search" type="search" placeholder="Search devices" aria-label="Search devices"><div class="pin-device-options">${data.devices.map(device => `<button class="pin-device-option" type="button" data-pin-assign="${row.gpio}" data-device-id="${device.id}" data-device-name="${escapeHTML(device.name.toLowerCase())}"><span class="pin-device-image" aria-hidden="true">${device.image_url ? `<img src="${escapeHTML(device.image_url)}" alt="">` : escapeHTML(device.name.slice(0,1).toUpperCase())}</span>${escapeHTML(device.name)}</button>`).join('')}<p class="pin-device-empty" data-no-matching hidden>No matching device.</p></div><button type="button" class="pin-create-device" data-pin-create="${row.gpio}">+ Create new device</button></div>
      </div></td></tr>`).join('');
  document.getElementById('pinModalRoot').innerHTML = `<div class="pin-modal-backdrop" id="pinModalBackdrop" role="presentation"><section class="pin-modal" role="dialog" aria-modal="true" aria-labelledby="pin-status-title"><header class="pin-modal-head"><div><h2 id="pin-status-title" class="display">ESP32 Real-Time Hardware PIN Status</h2><p>Connection probing runs only while this panel is enabled.</p></div><button class="pin-modal-close" type="button" data-close-pin aria-label="Close ESP32 PIN status">×</button></header><div class="pin-table-wrap"><table class="pin-status-table"><thead><tr><th>PIN Number</th><th>Device</th><th>Current Mode</th><th>Connection Status</th><th>Real-Time Value</th><th>Actions</th></tr></thead><tbody>${body}</tbody></table></div></section></div>`;
  document.getElementById('pinModalBackdrop').addEventListener('mousedown', event => { if (event.target.id === 'pinModalBackdrop') closePinModal(true); });
  document.querySelector('[data-close-pin]').addEventListener('click', () => closePinModal(true));
  document.querySelectorAll('[data-pin-picker]').forEach(button => button.addEventListener('click', () => {
    const menu = document.querySelector(`[data-pin-menu="${button.dataset.pinPicker}"]`);
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('input').focus();
  }));
  document.querySelectorAll('.pin-device-search').forEach(input => input.addEventListener('input', () => {
    const menu = input.closest('.pin-device-menu');
    let visible = 0;
    menu.querySelectorAll('[data-pin-assign]').forEach(button => {
      button.hidden = !button.dataset.deviceName.includes(input.value.trim().toLowerCase());
      if (!button.hidden) visible++;
    });
    menu.querySelector('[data-no-matching]').hidden = visible > 0;
  }));
  document.querySelectorAll('[data-pin-assign]').forEach(button => button.addEventListener('click', async () => {
    try {
      await api('api/pin_assign.php', { method: 'POST', body: JSON.stringify({ gpio: Number(button.dataset.pinAssign), device_id: Number(button.dataset.deviceId) }) });
      const refreshed = await api('api/pin_status.php');
      renderPinModal(refreshed);
    } catch (error) { toast(error.message || 'Unable to save the device assignment.', true); }
  }));
  document.querySelectorAll('[data-pin-create]').forEach(button => button.addEventListener('click', () => openPinDeviceForm(Number(button.dataset.pinCreate))));
}

function openPinDeviceForm(gpio) {
  const form = document.createElement('div');
  form.className = 'pin-device-form-backdrop';
  form.innerHTML = `<section class="pin-device-form-modal" role="dialog" aria-modal="true" aria-labelledby="new-device-title"><header><div><h3 id="new-device-title" class="display">Create device for D${gpio}</h3><p>Save a name and image link, then assign it to this PIN.</p></div><button type="button" class="pin-modal-close" data-close-device aria-label="Close new device form">×</button></header><form id="pinDeviceForm"><label for="pin-device-name">Device name</label><input id="pin-device-name" class="input" maxlength="100" required><label for="pin-device-image-url">Image link</label><input id="pin-device-image-url" class="input" type="url" placeholder="https://example.com/device.jpg"><p class="pin-device-error" id="pinDeviceError" role="alert" hidden></p><div class="pin-device-form-actions"><button type="button" class="btn ghost" data-close-device>Cancel</button><button type="submit" class="btn">Create and assign</button></div></form></section>`;
  document.getElementById('pinModalRoot').append(form);
  form.addEventListener('mousedown', event => { if (event.target === form) form.remove(); });
  form.querySelectorAll('[data-close-device]').forEach(button => button.addEventListener('click', () => form.remove()));
  form.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
      const device = await api('api/pin_device_create.php', { method: 'POST', body: JSON.stringify({ name: form.querySelector('#pin-device-name').value, image_url: form.querySelector('#pin-device-image-url').value }) });
      form.remove();
      const refreshed = await api('api/pin_status.php');
      renderPinModal(refreshed);
      await api('api/pin_assign.php', { method: 'POST', body: JSON.stringify({ gpio, device_id: device.id }) });
      renderPinModal(await api('api/pin_status.php'));
    } catch (error) {
      if (!form.isConnected) {
        toast(error.message || 'Unable to assign the device.', true);
        return;
      }
      const message = form.querySelector('#pinDeviceError');
      message.textContent = error.message || 'Unable to create the device.';
      message.hidden = false;
      submit.disabled = false;
      submit.textContent = 'Create and assign';
    }
  });
  form.querySelector('#pin-device-name').focus();
}

async function loadProductsTable() {
  try {
    const slots = await api('api/slots.php');
    const body = document.getElementById('productsBody');
    body.innerHTML = slots.map(s => `
      <tr>
        <td class="slot-id">${s.slot_code}</td>
        <td><input class="input" data-field="name" value="${s.product_name.replace(/"/g, '&quot;')}" style="max-width:260px;"></td>
        <td><input class="input mono" data-field="capacity" value="${s.capacity}" style="max-width:90px;"></td>
        <td><button class="btn small" data-id="${s.id}">Save</button></td>
      </tr>`).join('');

    body.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', () => saveProduct(btn));
    });
  } catch (e) {
    toast('Could not load products: ' + e.message, true);
  }
}

async function saveProduct(btn) {
  const row = btn.closest('tr');
  const name = row.querySelector('[data-field="name"]').value.trim();
  const capacity = parseInt(row.querySelector('[data-field="capacity"]').value, 10);

  if (!name) {
    toast('Product name cannot be empty.', true);
    return;
  }

  try {
    await api('api/slots_save.php', {
      method: 'POST',
      body: JSON.stringify({ id: Number(btn.dataset.id), product_name: name, capacity }),
    });
    toast('Product updated.');
  } catch (e) {
    toast('Could not save product: ' + e.message, true);
  }
}

async function loadSettings() {
  try {
    const d = await api('api/settings_get.php');

    document.getElementById('profFullName').value = d.profile.full_name || '';
    document.getElementById('profUsername').value = d.profile.username || '';
    document.getElementById('profEmail').value = d.profile.email || '';
    document.getElementById('profPhone').value = d.profile.phone || '';
    document.getElementById('profPassword').value = '';
    document.getElementById('profLastLogin').textContent = d.profile.last_login;
    document.getElementById('profRoleTag').textContent = d.profile.role;

    document.getElementById('setUnitPrice').value = '₱' + Number(d.machine.unit_price).toFixed(2);
    document.getElementById('setLowStock').value = d.machine.low_stock_threshold + ' units';
    document.getElementById('setCoinAlert').value = d.machine.coin_box_alert_pct + '%';
    document.getElementById('setSmsNumber').value = d.machine.admin_sms_number || '';
    document.getElementById('setDeviceKey').value = d.machine.device_api_key || '';
    document.getElementById('setWifiSsid').value = d.machine.wifi_ssid || '';
    const wifiPassword = document.getElementById('setWifiPassword');
    wifiPassword.value = '';
    wifiPassword.placeholder = d.machine.wifi_password_set
      ? 'Leave blank to keep current password'
      : 'Enter Wi-Fi password';

    setSwitch('setTamper', d.machine.tamper_alarm_enabled);
    setSwitch('setAutoReset', d.machine.auto_reset_coin_count);
    setSwitch('setPinDetection', d.machine.enable_pin_connection_detection);
  } catch (e) {
    toast('Could not load settings: ' + e.message, true);
  }
  loadProductsTable();
}

function setSwitch(id, on) {
  const el = document.getElementById(id);
  el.classList.toggle('off', !on);
}

function parseNumber(str) {
  const n = parseFloat(String(str).replace(/[^\d.]/g, ''));
  return isNaN(n) ? 0 : n;
}

async function saveMachineSettings() {
  try {
    await api('api/settings_save.php', {
      method: 'POST',
      body: JSON.stringify({
        unit_price: parseNumber(document.getElementById('setUnitPrice').value),
        low_stock_threshold: parseNumber(document.getElementById('setLowStock').value),
        coin_box_alert_pct: parseNumber(document.getElementById('setCoinAlert').value),
        admin_sms_number: document.getElementById('setSmsNumber').value.trim(),
        tamper_alarm_enabled: !document.getElementById('setTamper').classList.contains('off'),
        auto_reset_coin_count: !document.getElementById('setAutoReset').classList.contains('off'),
        enable_pin_connection_detection: !document.getElementById('setPinDetection').classList.contains('off'),
        device_api_key: document.getElementById('setDeviceKey').value.trim(),
        wifi_ssid: document.getElementById('setWifiSsid').value.trim(),
        wifi_password: document.getElementById('setWifiPassword').value,
      }),
    });
    toast('Machine settings saved.');
    loadSettings();
  } catch (e) {
    toast('Could not save settings: ' + e.message, true);
  }
}

async function saveProfile() {
  try {
    await api('api/profile_save.php', {
      method: 'POST',
      body: JSON.stringify({
        full_name: document.getElementById('profFullName').value.trim(),
        username: document.getElementById('profUsername').value.trim(),
        email: document.getElementById('profEmail').value.trim(),
        phone: document.getElementById('profPhone').value.trim(),
        password: document.getElementById('profPassword').value,
      }),
    });
    toast('Profile updated.');
    loadSettings();
  } catch (e) {
    toast('Could not save profile: ' + e.message, true);
  }
}

// ---------- NAV ----------
const titles = {
  overview:      ['Overview', 'Snapshot of the machine right now'],
  slots:         ['Slots & Inventory', 'Live stock levels for every dispensing slot'],
  transactions:  ['Transactions', 'GCash and coin payments confirmed by the machine'],
  health:        ['Device Health', 'Real-time sensor and power diagnostics'],
  notifications: ['Notifications', 'Stock, coin box, tamper, GCash and system alerts'],
  sms_logs:      ['SMS Logs', 'Queue and delivery history for the admin phone number'],
  esp32_logs:    ['ESP32 Logs', 'Live machine activity saved by the ESP32'],
  settings:      ['Settings', 'Your account and machine configuration'],
};
const loaders = {
  overview: loadOverview,
  slots: loadSlots,
  transactions: loadTransactions,
  health: loadHealth,
  notifications: loadNotifications,
  sms_logs: loadSmsLogs,
  esp32_logs: loadEsp32Logs,
  settings: loadSettings,
};

let activeView = document.body.dataset.activeView || 'overview';
let syncPromise = null;
let lastSyncAt = 0;
async function refreshFromBackup(view = activeView) {
  activeView = view;
  if (!syncPromise && Date.now() - lastSyncAt >= 30000) {
    syncPromise = api('api/supabase_sync.php', { method: 'POST' })
      .then(result => { lastSyncAt = Date.now(); return result; })
      .catch(e => toast('Supabase sync unavailable; showing MySQL backup. ' + e.message, true))
      .finally(() => { syncPromise = null; });
  }
  const pendingSync = syncPromise;
  if (activeView === view) await loaders[view]();
  if (pendingSync) await pendingSync;
  if (pendingSync && activeView === view) await loaders[view]();
  if (activeView === view) {
    loadNotifBadge();
  }
}

function activateView(view, updateUrl = true) {
  if (!Object.hasOwn(loaders, view)) view = 'overview';
  activeView = view;
  closeMobileMenu();
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  document.querySelectorAll('.view').forEach(section => section.classList.toggle('active', section.id === 'view-' + view));
  document.getElementById('pageTitle').textContent = titles[view][0];
  document.getElementById('pageSub').textContent = titles[view][1];
  if (updateUrl) {
    const url = new URL(window.location.href);
    if (view === 'overview') url.searchParams.delete('view');
    else url.searchParams.set('view', view);
    history.pushState({ view }, '', url);
  }
  refreshFromBackup(view);
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => activateView(btn.dataset.view));
});
document.getElementById('slotBody').addEventListener('click', event => {
  const button = event.target.closest('[data-restock-id]');
  if (button) {
    const slot = currentSlots.find(item => item.id === Number(button.dataset.restockId));
    if (slot) openRestockModal(slot);
  }
});
window.addEventListener('popstate', () => activateView(new URLSearchParams(location.search).get('view') || 'overview', false));

const menuToggle = document.getElementById('menuToggle');
const menuBackdrop = document.getElementById('menuBackdrop');
function closeMobileMenu() {
  document.getElementById('sidebar').classList.remove('menu-open');
  menuToggle.classList.remove('open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open navigation menu');
  menuBackdrop.hidden = true;
}
menuToggle.addEventListener('click', () => {
  const open = !document.getElementById('sidebar').classList.contains('menu-open');
  document.getElementById('sidebar').classList.toggle('menu-open', open);
  menuToggle.classList.toggle('open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  menuBackdrop.hidden = !open;
});
menuBackdrop.addEventListener('click', closeMobileMenu);
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  closeMobileMenu();
  const deviceForm = document.querySelector('.pin-device-form-backdrop');
  if (deviceForm) deviceForm.remove();
  else if (document.querySelector('.pin-modal-backdrop')) closePinModal(true);
});

document.querySelectorAll('.switch').forEach(sw => {
  sw.addEventListener('click', () => sw.classList.toggle('off'));
});
document.getElementById('setPinDetection').addEventListener('click', async event => {
  const enabled = !event.currentTarget.classList.contains('off');
  event.currentTarget.setAttribute('aria-busy', 'true');
  try {
    await api('api/pin_detection.php', { method: 'POST', body: JSON.stringify({ enabled }) });
    if (enabled) await openPinModal();
    else closePinModal();
  } catch (error) {
    event.currentTarget.classList.toggle('off', enabled);
    toast(error.message || 'Could not update ESP32 PIN connection detection.', true);
  } finally {
    event.currentTarget.removeAttribute('aria-busy');
  }
});

document.getElementById('saveMachineBtn').addEventListener('click', saveMachineSettings);
document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
document.getElementById('markReadBtn').addEventListener('click', markAllNotifsRead);

// initial load
refreshFromBackup(activeView);
setInterval(() => refreshFromBackup(activeView), 30000);

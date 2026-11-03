<?php
require_once __DIR__ . '/includes/auth_check.php';
require_login();
$viewTitles = [
    'overview' => ['Overview', 'Snapshot of the machine right now'],
    'slots' => ['Slots & Inventory', 'Live stock levels for every dispensing slot'],
    'transactions' => ['Transactions', 'GCash and coin payments confirmed by the machine'],
    'health' => ['Device Health', 'Real-time sensor and power diagnostics'],
    'notifications' => ['Notifications', 'Stock, coin box, tamper, GCash and system alerts'],
    'sms_logs' => ['SMS Logs', 'Real-time queue and delivery history for the admin phone number'],
    'esp32_logs' => ['ESP32 Logs', 'Live machine activity saved by the ESP32'],
    'settings' => ['Settings', 'Your account and machine configuration'],
];
$activeView = $_GET['view'] ?? 'overview';
if (!is_string($activeView) || !isset($viewTitles[$activeView])) $activeView = 'overview';
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>4Peace — Admin Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Work+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/style.css">
<script src="https://cdn.jsdelivr.net/npm/apexcharts@7.1.0"></script>
</head>
<body data-active-view="<?= htmlspecialchars($activeView, ENT_QUOTES, 'UTF-8') ?>">
<div class="app">

  <button type="button" class="menu-toggle" id="menuToggle" aria-label="Open navigation menu" aria-expanded="false"><span></span><span></span><span></span></button>
  <button type="button" class="menu-backdrop" id="menuBackdrop" aria-label="Close navigation menu" hidden></button>

  <!-- SIDEBAR -->
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <div class="brand-mark">
        <div class="brand-glyph">4P</div>
        <div>
          <div class="brand-name">4Peace</div>
          <div class="brand-sub">MACHINE ADMIN</div>
        </div>
      </div>
    </div>

    <nav class="nav">
      <button class="nav-item<?= $activeView === 'overview' ? ' active' : '' ?>" data-view="overview">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></svg>
        <span>Overview</span>
      </button>
      <button class="nav-item<?= $activeView === 'slots' ? ' active' : '' ?>" data-view="slots">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/></svg>
        <span>Slots &amp; Inventory</span>
      </button>
      <button class="nav-item<?= $activeView === 'transactions' ? ' active' : '' ?>" data-view="transactions">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10h18M7 15h1M12 15h1"/><rect x="3" y="6" width="18" height="13" rx="2"/></svg>
        <span>Transactions</span>
      </button>
      <button class="nav-item<?= $activeView === 'health' ? ' active' : '' ?>" data-view="health">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12h4l2 7 4-14 2 7h6"/></svg>
        <span>Device Health</span>
      </button>
      <button class="nav-item<?= $activeView === 'notifications' ? ' active' : '' ?>" data-view="notifications">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span>Notifications</span>
        <span class="nav-badge" id="notifBadge" style="display:none;">0</span>
      </button>
      <button class="nav-item<?= $activeView === 'sms_logs' ? ' active' : '' ?>" data-view="sms_logs">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 9.46 9.46 0 0 1-4.78-1.28L3 20l1.38-3.68A8.48 8.48 0 0 1 3 11.5a8.5 8.5 0 0 1 17 0Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" stroke-width="2.4" stroke-linecap="round"/></svg>
        <span>SMS Logs</span>
      </button>
      <button class="nav-item<?= $activeView === 'esp32_logs' ? ' active' : '' ?>" data-view="esp32_logs">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 9h8M8 13h5M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg>
        <span>ESP32 Logs</span>
      </button>
      <button class="nav-item<?= $activeView === 'settings' ? ' active' : '' ?>" data-view="settings">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.36.4.65.75.8"/></svg>
        <span>Settings</span>
      </button>
    </nav>

    <div class="sidebar-foot">
      <div class="status-dot"></div>
      <span>Unit #001 — Online</span>
    </div>
  </aside>

  <!-- MAIN -->
  <main class="main">
    <div class="topbar">
      <div>
        <div class="page-title display" id="pageTitle"><?= htmlspecialchars($viewTitles[$activeView][0], ENT_QUOTES, 'UTF-8') ?></div>
        <div class="page-sub" id="pageSub"><?= htmlspecialchars($viewTitles[$activeView][1], ENT_QUOTES, 'UTF-8') ?></div>
      </div>
      <div class="machine-pill" id="machinePill" title="No telemetry received yet">
        <div class="status-dot inactive" id="esp32StatusDot"></div>
        <span class="esp32-status waiting" id="lastSyncPill">Waiting for ESP32</span>
      </div>
    </div>

    <div class="content">

      <!-- ===== OVERVIEW VIEW ===== -->
      <div class="view<?= $activeView === 'overview' ? ' active' : '' ?>" id="view-overview">
        <div class="stat-row" id="overviewStats">
          <div class="stat-card skeleton"></div>
          <div class="stat-card skeleton"></div>
          <div class="stat-card skeleton"></div>
          <div class="stat-card skeleton"></div>
        </div>

        <div class="panel">
          <div class="panel-head"><div><div class="panel-title display">Revenue &amp; Dispense Trends</div><div class="panel-title-sub">Multi-metric daily trajectory: Total Revenue (₱) vs GCash &amp; Coin Volume</div></div></div>
          <div class="chart-body"><div id="overviewTrendChart"></div></div>
        </div>

        <div class="charts-grid-2">
          <div class="panel"><div class="panel-head"><div><div class="panel-title display">Product Demand vs Stock</div><div class="panel-title-sub">Total dispenses compared against remaining units per slot</div></div></div><div class="chart-body"><div id="overviewProductChart"></div></div></div>
          <div class="panel"><div class="panel-head"><div><div class="panel-title display">Payment Method Share</div><div class="panel-title-sub">Transaction volume split between GCash and Cash Coins</div></div></div><div class="chart-body"><div id="overviewPaymentChart"></div></div></div>
        </div>

        <div class="charts-grid-2">
          <div class="panel"><div class="panel-head"><div><div class="panel-title display">Current Inventory Allocation</div><div class="panel-title-sub">Proportional stock distribution across physical slots</div></div></div><div class="chart-body"><div id="overviewStockChart"></div></div></div>
          <div class="panel">
            <div class="panel-head"><div><div class="panel-title display">Attention needed</div><div class="panel-title-sub">Slots that are low or empty right now</div></div></div>
            <table class="slot-table" id="overviewLowStockTable"><thead><tr><th>Slot</th><th>Product</th><th>Stock</th><th>Status</th></tr></thead><tbody></tbody></table>
          </div>
        </div>

        <div class="panel" style="margin-top:20px">
          <div class="panel-head"><div><div class="panel-title display">Recent activity</div><div class="panel-title-sub">Latest transactions and machine alerts</div></div></div>
          <div class="log-list" id="overviewActivity"></div>
        </div>
      </div>

      <!-- ===== SLOTS VIEW ===== -->
      <div class="view<?= $activeView === 'slots' ? ' active' : '' ?>" id="view-slots">
        <div class="panel">
          <div class="machine-view">
            <div class="machine-rack">
              <div class="rack-frame" id="rackFrame"></div>
              <div class="rack-slot-lcd" id="lcdText">READY · INSERT COIN OR<br>SCAN GCASH TO DISPENSE</div>
              <div class="rack-label">Physical layout mirrors the<br>ESP32 slot wiring order</div>
            </div>
            <div>
              <table class="slot-table" id="slotTable">
                <thead><tr><th>Slot</th><th>Product</th><th>Stock</th><th>Level</th><th>Status</th><th></th></tr></thead>
                <tbody id="slotBody"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== TRANSACTIONS VIEW ===== -->
      <div class="view<?= $activeView === 'transactions' ? ' active' : '' ?>" id="view-transactions">
        <div class="panel">
          <div class="panel-head">
            <div>
              <div class="panel-title display">GCash approvals</div>
              <div class="panel-title-sub">Confirm each reference number against the SMS your SIM800L receives</div>
            </div>
          </div>
          <table class="slot-table gcash-table">
            <thead><tr><th>Reference</th><th>Slot</th><th>Amount</th><th>Time</th><th>Status</th><th></th></tr></thead>
            <tbody id="gcashBody"></tbody>
          </table>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <div class="panel-title display">Recent transactions</div>
              <div class="panel-title-sub">Every dispense confirmed by an IR sensor is logged here</div>
            </div>
            <a class="btn ghost" href="api/transactions_export.php">Export CSV</a>
          </div>
          <table class="slot-table tx-table">
            <thead><tr><th>Ref / Pulse ID</th><th>Method</th><th>Slot</th><th>Amount</th><th>Time</th></tr></thead>
            <tbody id="txBody"></tbody>
          </table>
        </div>
      </div>

      <!-- ===== HEALTH VIEW ===== -->
      <div class="view<?= $activeView === 'health' ? ' active' : '' ?>" id="view-health">
        <div class="panel">
          <div class="panel-head">
            <div>
              <div class="panel-title display">Device health</div>
              <div class="panel-title-sub">Live readings from onboard sensors</div>
            </div>
          </div>
          <div class="health-grid" id="healthGrid"></div>
        </div>

        <div class="charts-grid-2">
          <div class="panel">
            <div class="panel-head"><div><div class="panel-title display">Memory availability</div><div class="panel-title-sub">Internal SRAM and external PSRAM free memory</div></div></div>
            <div class="chart-body"><div class="empty-note" id="memoryEmpty">Waiting for the first ESP32 telemetry sample.</div><div id="memoryChart" style="display:none"></div></div>
          </div>
          <div class="panel">
            <div class="panel-head"><div><div class="panel-title display">Storage &amp; ROM</div><div class="panel-title-sub">Firmware, file system, available external flash, and ROM capacity</div></div></div>
            <div class="chart-body"><div class="empty-note" id="storageEmpty">Waiting for the first ESP32 telemetry sample.</div><div id="storageChart" style="display:none"></div><div class="health-resource-note" id="storageNote" hidden></div></div>
          </div>
        </div>

        <div class="panel" style="margin-top:20px">
          <div class="panel-head"><div><div class="temperature-title-row"><div class="panel-title display">ESP32 internal CPU temperature</div><div class="temperature-highest" id="highestTemperature" hidden></div></div><div class="panel-title-sub">On-chip temperature history · 0°C means no ESP32 telemetry for 3+ minutes</div></div></div>
          <div class="chart-body"><div class="empty-note" id="temperatureEmpty">Waiting for a CPU-temperature telemetry sample.</div><div id="temperatureChart" style="display:none"></div></div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <div class="panel-title display">Machine health log</div>
              <div class="panel-title-sub">Alerts saved to machine_health_logs</div>
            </div>
          </div>
          <div class="log-list" id="logList"></div>
        </div>
      </div>

      <!-- ===== NOTIFICATIONS VIEW ===== -->
      <div class="view<?= $activeView === 'notifications' ? ' active' : '' ?>" id="view-notifications">
        <div class="panel">
          <div class="panel-head">
            <div>
              <div class="panel-title display">All notifications</div>
              <div class="panel-title-sub">Stock, coin box, tamper, GCash and system alerts from the machine</div>
            </div>
            <button class="btn ghost" id="markReadBtn">Mark all as read</button>
          </div>
          <div class="log-list" id="notifList"></div>
        </div>
      </div>

      <div class="view<?= $activeView === 'sms_logs' ? ' active' : '' ?>" id="view-sms_logs">
        <div class="panel"><div class="panel-head"><div><div class="panel-title display">SMS delivery logs</div><div class="panel-title-sub">Every SMS is queued to the configured admin phone number before the ESP32 sends it.</div></div><span class="sms-live"><span class="status-dot"></span>Live</span></div>
          <div class="table-scroll"><table class="slot-table tx-table sms-table"><thead><tr><th>Event</th><th>Recipient</th><th>Message</th><th>Delivery</th><th>Created</th></tr></thead><tbody id="smsLogsBody"></tbody></table></div><div class="empty-note" id="smsLogsEmpty" hidden>No SMS events yet.</div>
        </div>
      </div>
      <div class="view<?= $activeView === 'esp32_logs' ? ' active' : '' ?>" id="view-esp32_logs">
        <div class="panel"><div class="panel-head"><div><div class="panel-title display">ESP32 logs</div><div class="panel-title-sub">Server-timestamped Wi-Fi, Supabase, LCD, payment, relay, and sensor events.</div></div><span class="sms-live"><span class="status-dot"></span>Live</span></div>
          <div class="table-scroll"><table class="slot-table tx-table sms-table"><thead><tr><th>Timestamp</th><th>Category</th><th>Event</th><th>Level</th></tr></thead><tbody id="esp32LogsBody"></tbody></table></div><div class="empty-note" id="esp32LogsEmpty" hidden>No ESP32 events yet.</div>
        </div>
      </div>

      <!-- ===== SETTINGS VIEW ===== -->
      <div class="view<?= $activeView === 'settings' ? ' active' : '' ?>" id="view-settings">

        <div class="panel">
          <div class="panel-head">
            <div>
              <div class="panel-title display">Products per slot</div>
              <div class="panel-title-sub">Rename what's loaded in each dispensing slot. Stock count still comes from the IR sensors.</div>
            </div>
          </div>
          <table class="slot-table" id="productsTable">
            <thead><tr><th>Slot</th><th>Product name</th><th>Capacity</th><th></th></tr></thead>
            <tbody id="productsBody"></tbody>
          </table>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <div class="panel-title display">Admin profile</div>
              <div class="panel-title-sub">Your account information</div>
            </div>
            <button class="btn" id="saveProfileBtn">Save changes</button>
          </div>
          <div class="settings-grid" id="profileForm">
            <div class="field-row">
              <div><div class="field-label">Full name</div><div class="field-hint">Shown across the dashboard</div></div>
              <input class="input" id="profFullName" style="max-width:280px;">
            </div>
            <div class="field-row">
              <div><div class="field-label">Username</div><div class="field-hint">Used to log in</div></div>
              <input class="input" id="profUsername" style="max-width:280px;">
            </div>
            <div class="field-row">
              <div><div class="field-label">Email</div><div class="field-hint">For account recovery and reports</div></div>
              <input class="input" id="profEmail" style="max-width:280px;">
            </div>
            <div class="field-row">
              <div><div class="field-label">Phone</div><div class="field-hint">Contact number on file</div></div>
              <input class="input" id="profPhone" style="max-width:280px;">
            </div>
            <div class="field-row">
              <div><div class="field-label">New password</div><div class="field-hint">Leave blank to keep current password</div></div>
              <input class="input" type="password" id="profPassword" placeholder="••••••••" style="max-width:280px;">
            </div>
            <div class="field-row">
              <div><div class="field-label">Last login</div><div class="field-hint">Most recent successful sign-in</div></div>
              <div class="mono" id="profLastLogin" style="color:var(--text-soft); font-size:13px;">—</div>
            </div>
          </div>
          <div class="settings-foot">
            <div class="field-hint">Signed in as <span id="profRoleTag" class="mono"></span></div>
            <a href="logout.php" class="btn ghost logout-btn">Log out</a>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <div class="panel-title display">Machine settings</div>
              <div class="panel-title-sub">Configuration used by the firmware and dashboard</div>
            </div>
            <button class="btn" id="saveMachineBtn">Save changes</button>
          </div>
          <div class="settings-grid" id="machineForm">
            <div class="field-row">
              <div><div class="field-label">Unit price</div><div class="field-hint">Fixed price per dispense, all slots</div></div>
              <input class="input" id="setUnitPrice" style="max-width:160px;">
            </div>
            <div class="field-row">
              <div><div class="field-label">Low-stock threshold</div><div class="field-hint">Triggers SMS alert via SIM800L</div></div>
              <input class="input" id="setLowStock" style="max-width:160px;">
            </div>
            <div class="field-row">
              <div><div class="field-label">Coin box alert level</div><div class="field-hint">Admin gets notified past this fill %</div></div>
              <input class="input" id="setCoinAlert" style="max-width:160px;">
            </div>
            <div class="field-row">
              <div><div class="field-label">Admin SMS number</div><div class="field-hint">Receives GSM alerts from the unit</div></div>
              <input class="input" id="setSmsNumber" style="max-width:220px;">
            </div>
            <div class="field-row">
              <div><div class="field-label">Tamper alarm (SW-420)</div><div class="field-hint">Buzzer + SMS on vibration trigger</div></div>
              <div class="switch" id="setTamper"></div>
            </div>
            <div class="field-row">
              <div><div class="field-label">Auto-reset coin count</div><div class="field-hint">Resets running total after admin pickup</div></div>
              <div class="switch off" id="setAutoReset"></div>
            </div>
            <div class="field-row">
              <div><div class="field-label">Enable ESP32 PIN Connection Detection</div><div class="field-hint">Temporarily probes relay and buzzer connections only while this switch is on.</div></div>
              <div class="switch off" id="setPinDetection"></div>
            </div>
            <div class="field-row">
              <div><div class="field-label">Device API key</div><div class="field-hint">ESP32 sends this on gcash_verify / gcash_status</div></div>
              <input class="input mono" id="setDeviceKey" style="max-width:280px;">
            </div>
            <div class="field-row">
              <div><div class="field-label">Machine Wi-Fi name (SSID)</div><div class="field-hint">ESP32 must first connect to its default firmware Wi-Fi, then it switches to this network</div></div>
              <input class="input" id="setWifiSsid" maxlength="32" placeholder="Wi-Fi name" style="max-width:280px;" autocomplete="off">
            </div>
            <div class="field-row">
              <div><div class="field-label">Machine Wi-Fi password</div><div class="field-hint">Leave blank to keep the current password. The ESP32 stores this locally after it downloads settings.</div></div>
              <input class="input" type="password" id="setWifiPassword" maxlength="63" placeholder="••••••••" style="max-width:280px;" autocomplete="new-password">
            </div>
          </div>
        </div>

      </div>

    </div>
  </main>
</div>

<div class="toast" id="toast"></div>
<div id="stockModalRoot"></div>
<div id="pinModalRoot"></div>

<script src="assets/js/app.js"></script>
</body>
</html>

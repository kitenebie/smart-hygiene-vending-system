# 🌸 4Peace — IoT-Based Smart Feminine Hygiene Access System
### Modern Admin Dashboard & Firmware Interface (React 19 + TypeScript + Supabase)

> **Team 4Peace** · Veritas College of Irosin  
> An automated, accessible, and IoT-connected dispensing solution engineered to provide reliable access to feminine hygiene products with real-time telemetry, dual-payment processing (Coins & GCash), and remote administrative monitoring.

---

## 📑 Table of Contents
1. [System Architecture & Overview](#-system-architecture--overview)
2. [Hardware Stack & Telemetry](#-hardware-stack--telemetry)
3. [End-to-End Operational Workflows](#-end-to-end-operational-workflows)
   - [A. Coin Pulse Dispense Workflow](#a-coin-pulse-dispense-workflow)
   - [B. GCash Payment & Verification Workflow](#b-gcash-payment--verification-workflow)
   - [C. Tamper & Low-Stock Alerts (GSM SIM800L)](#c-tamper--low-stock-alerts-gsm-sim800l)
4. [Database Schema Specification (Supabase / PostgreSQL)](#-database-schema-specification-supabase--postgresql)
5. [Frontend Architecture & Component Tree](#-frontend-architecture--component-tree)
6. [Dashboard Views & Features](#-dashboard-views--features)
7. [Installation & Setup Guide](#-installation--setup-guide)
8. [ESP32 Firmware Integration & REST API Reference](#-esp32-firmware-integration--rest-api-reference)
9. [Default Credentials & Configuration](#-default-credentials--configuration)
10. [Troubleshooting & FAQ](#-troubleshooting--faq)

---

## ✨ Recent ESP32, Dashboard & Inventory Updates

- **Reliable ESP32 presence:** the firmware sends an authenticated heartbeat every 10 seconds. The dashboard shows **ESP32 connected** only while the latest heartbeat is fresh (25 seconds); otherwise it shows **Waiting for ESP32**.
- **Telemetry repair and CPU history:** health data is sent through `sync_device_telemetry` using `POST`, which restores the `device_health` row if it was cleared. The CPU-temperature graph avoids false `0°C` dips for brief missing samples and shows `0°C` only after at least three consecutive minutes without telemetry. Its header also shows the highest real recorded temperature.
- **Traceable ESP32 logs:** Wi-Fi, Supabase HTTP requests/responses, payment selection, coins, relays, IR drop detection, dispense outcomes, and LCD messages are stored in `esp32_logs` with a server timestamp and displayed on the new **ESP32 Logs** page.
- **Safer vending flow:** coin payments enforce sufficient credit before vending, relay output is read back for diagnostics, IR confirms the product drop, and a successful vend locks payment input while the LCD shows **Dispensed Successfully** for five seconds.
- **Privacy and admin safety:** GCash references are masked in the LCD, logs, and dashboard (for example `1234567890` becomes `123****890`). Settings no longer auto-refresh or subscribe in real time, preventing an administrator's unsaved edits from being overwritten.
- **Restocking from the dashboard:** each product has an **Add stock** action with a quantity modal. The database RPC validates the input and never allows stock to exceed slot capacity.

---

## 🏗️ System Architecture & Overview

The 4Peace system bridges physical automated dispensing hardware with a high-performance cloud monitoring dashboard:

```
                      ┌───────────────────────────────────────┐
                      │            PHYSICAL VENDING           │
                      │               UNIT #001               │
                      └──────────────────┬────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
        ┌────────┴────────┐                             ┌────────┴────────┐
        │  COIN ACCEPTOR  │                             │  KEYPAD & LCD   │
        │  Multi-coin IR  │                             │  GCash Ref Entry│
        └────────┬────────┘                             └────────┬────────┘
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         │
                                ┌────────▼────────┐
                                │   ESP32 MCU     │ ◄─── SW-420 Tamper Sensor
                                │   Main Controller│ ◄─── IR Drop Sensors (S1-S5)
                                └────────┬────────┘ ◄─── SIM800L GSM Module
                                         │
               HTTPS / REST (WiFi)       │  GSM / SMS Cellular
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
                 ▼                                               ▼
     ┌───────────────────────┐                       ┌───────────────────────┐
     │   SUPABASE DATABASE   │                       │    ADMIN MOBILE       │
     │   PostgreSQL + Auth   │                       │   Direct SMS Alerts   │
     └───────────┬───────────┘                       └───────────────────────┘
                 │
                 ▼ Realtime REST API
     ┌────────────────────────────────────────────────────────┐
     │               4PEACE REACT WEB DASHBOARD               │
     │     Vite + React 19 + TypeScript + Custom Theme        │
     └────────────────────────────────────────────────────────┘
```

---

## ⚡ Hardware Stack & Telemetry

| Hardware Component | Model / Type | Interface / Protocol | Primary Function |
| :--- | :--- | :--- | :--- |
| **Microcontroller** | ESP32-WROOM-32 | SPI / I2C / UART / GPIO | Main controller for logic, sensor reading & cloud sync |
| **GSM Module** | SIM800L GPRS/GSM | UART (Hardware Serial) | Receives GCash SMS and dispatches emergency SMS alerts |
| **Coin Acceptor** | Multi-Coin Intelligent | GPIO Pulse Counter Interrupt | Accepts ₱1, ₱5, ₱10 coins with interrupt counting |
| **Tamper Sensor** | SW-420 Vibration Sensor | Digital GPIO Interrupt | Triggers buzzer alarm and immediate SMS upon vibration |
| **Optical Sensors** | TCRT5000 / IR Obstacle | Digital GPIO (S1 to S5) | Confirms item physical drop after servo/relay actuation |
| **Actuators** | 5V / 12V Relays or Servos | Digital Output GPIOs | Dispensing spirals/motors for Slots 1 to 5 |
| **Power Stage 1** | LM2596 Step-Down (Buck 1) | DC-DC (Adjusted to 5.0V) | Powers ESP32, LCD, Relays, and IR Sensors |
| **Power Stage 2** | LM2596 Step-Down (Buck 2) | DC-DC (Adjusted to 4.2V) | Dedicated 4.2V 2A rail for SIM800L peak transmission |
| **User Display** | 16x2 / 20x4 I2C LCD | I2C (`0x27` / `0x3F`) | User prompts ("READY · INSERT COIN OR SCAN GCASH") |
| **Keypad** | 4x4 Matrix Membrane Keypad | GPIO Scan Rows/Columns | Inputting GCash reference numbers & slot selection |

---

## 🔄 End-to-End Operational Workflows

### A. Coin Pulse Dispense Workflow
1. User inserts coins into the coin acceptor.
2. The coin slot generates pulse trains received by the ESP32 via GPIO hardware interrupt.
3. Once total credit reaches `unit_price` (default: ₱10.00), the user selects a slot (S1–S5).
4. ESP32 actuates the corresponding relay/motor to drop the product.
5. Physical drop is confirmed when the product passes the slot's **IR sensor**.
6. Stock count is decremented in memory and synced to Supabase `slots` table.
7. A dispense record is inserted into `transactions` with `method = 'coin'`.

### B. GCash Payment & Verification Workflow
1. User selects a slot on the keypad and chooses **GCash Payment**.
2. User scans the machine's printed GCash QR code and pays on their phone.
3. User enters the **GCash Reference Number** (e.g., `GC-99231`) via the 4x4 keypad. The LCD, logs, and dashboard show a masked form only; the unmasked value is used only by the payment workflow.
4. ESP32 submits the reference to Supabase `gcash_payments` with status `pending`.
5. A high-priority notification is logged in the `notifications` table.
6. The Admin checks the **Transactions** view on the web dashboard, verifies the reference against the SMS received by the SIM800L, and clicks **Approve** (or **Reject**).
7. The ESP32 polls `gcash_payments` (or listens via Realtime). Upon reading `status = 'approved'`, it actuates the dispensing motor.
8. Physical drop is confirmed by the IR sensor, and the transaction is recorded.

### C. Tamper & Low-Stock Alerts (GSM SIM800L)
- **Vibration/Tamper:** If the SW-420 sensor detects impact/movement while in armed mode, ESP32 sounds the buzzer, sends an immediate SMS to `admin_sms_number`, and logs a critical alert to `machine_health_logs` and `notifications`.
- **Low Stock / Out of Stock:** If any slot drops below `low_stock_threshold` (default: 5 units), an SMS notification is dispatched to the admin.

---

## 🗄️ Database Schema Specification (Supabase / PostgreSQL)

The database includes the primary operational tables below, plus telemetry, presence, SMS, and ESP32 event-log tables introduced by the firmware migrations:

```
┌─────────────────┐       ┌─────────────────┐       ┌──────────────────────┐
│     admins      │       │      slots      │       │     transactions     │
├─────────────────┤       ├─────────────────┤       ├──────────────────────┤
│ id (PK)         │       │ id (PK)         │◄──────┤ id (PK)              │
│ username (UQ)   │       │ slot_code (UQ)  │       │ ref_code             │
│ password_hash   │       │ product_name    │       │ method (gcash/coin)  │
│ full_name       │       │ stock           │       │ slot_id (FK -> slots)│
│ email           │       │ capacity        │       │ amount               │
│ phone           │       │ updated_at      │       │ created_at           │
│ role            │       └────────┬────────┘       └──────────────────────┘
│ last_login      │                │
│ created_at      │                │                ┌──────────────────────┐
└─────────────────┘                │                │    gcash_payments    │
                                   │                ├──────────────────────┤
┌─────────────────────────┐        │                │ id (PK)              │
│      device_health      │        │                │ ref_code             │
├─────────────────────────┤        └───────────────►│ slot_id (FK -> slots)│
│ id (PK)                 │                         │ amount               │
│ esp32_uptime_seconds    │                         │ status (pending/...) │
│ coin_pulses_session     │                         │ created_at           │
│ sim800l_signal_pct      │                         │ resolved_at          │
│ buck1_voltage           │                         └──────────────────────┘
│ buck2_voltage           │
│ tamper_status           │       ┌───────────────────────┐ ┌────────────────────┐
│ coin_box_pulses_total   │       │  machine_health_logs  │ │  machine_settings  │
│ coin_box_capacity_pulses│       ├───────────────────────┤ ├────────────────────┤
│ last_sync               │       │ id (PK)               │ │ id (PK)            │
└─────────────────────────┘       │ level (info/warn/crit)│ │ unit_price         │
                                  │ message               │ │ low_stock_threshold│
┌─────────────────────────┐       │ created_at            │ │ coin_box_alert_pct │
│      notifications      │       └───────────────────────┘ │ admin_sms_number   │
├─────────────────────────┤                                 │ tamper_alarm_enable│
│ id (PK)                 │                                 │ auto_reset_coin_cnt│
│ type (gcash/stock/...)  │                                 │ device_api_key     │
│ level (info/warn/crit)  │                                 │ updated_at         │
│ message                 │                                 └────────────────────┘
│ is_read                 │
│ created_at              │
└─────────────────────────┘
```

Additional device tables: `device_resource_logs` (minute-level resource and CPU telemetry), `esp32_device_presence` (last authenticated heartbeat), `esp32_logs` (server-timestamped firmware events), and `sms_messages` / `sms_outbox` (GSM message workflow). Device-facing RPCs authenticate the configured `machine_settings.device_api_key` before writing telemetry, heartbeats, pin status, dispense records, or logs.

---

## 💻 Frontend Architecture & Component Tree

Built with **React 19**, **TypeScript**, **Vite**, and an embedded **Custom Design System**:

```
react-app/
├── .env                                    # Supabase connection credentials
├── index.html                              # Web entry point & Google Fonts
├── package.json                            # Scripts & dependencies
├── tsconfig.json                           # TypeScript configuration
├── vite.config.ts                          # Vite build bundler configuration
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql          # Base PostgreSQL schema + table definitions
│       └── 002_mock_data.sql               # Comprehensive seed data for testing
└── src/
    ├── main.tsx                            # Root application bootstrap
    ├── App.tsx                             # Router setup with AuthGuard & ToastProvider
    ├── index.css                           # Full theme stylesheet & dark styling
    ├── utils/
    │   ├── supabase.ts                     # Supabase client singleton
    │   └── helpers.ts                      # Time formatting, calculations, CSV export
    ├── hooks/
    │   └── useAuth.tsx                     # Authentication context & session persistence
    ├── components/
    │   ├── AuthGuard.tsx                   # Route protection wrapper
    │   ├── Sidebar.tsx                     # Navigation bar with dynamic badge counter
    │   ├── Topbar.tsx                      # Header displaying active view & sync pill
    │   ├── StatCard.tsx                    # Overview metric cards with delta indicators
    │   ├── SlotTag.tsx                     # Dynamic status badge (ok/low/empty/pending)
    │   ├── Switch.tsx                      # Toggle switch component for settings
    │   ├── Toast.tsx                       # Global toast notification provider
    │   └── Esp32PinStatusModal.tsx          # Per-pin live diagnostics panel
    ├── pages/
    │   ├── LoginPage.tsx                   # Secure administrative login screen
    │   └── DashboardPage.tsx               # Main layout container & view switcher
    └── views/
        ├── OverviewView.tsx                # High-level KPIs, low stock table, recent feed
        ├── SlotsView.tsx                   # Interactive rack schematic & inventory table
        ├── TransactionsView.tsx            # GCash approval cards, history, & CSV export
        ├── HealthView.tsx                  # Hardware diagnostics & CPU-temperature history
        ├── Esp32LogsView.tsx               # Server-timestamped ESP32 event stream
        ├── NotificationsView.tsx           # Full notification history & mark-all-read
        ├── SmsLogsView.tsx                 # GSM/SMS message history
        └── SettingsView.tsx                # Slot editor, admin profile & machine controls
```

---

## 🖥️ Dashboard Views & Features

| View | Purpose & Functionality |
| :--- | :--- |
| **📊 Overview** | Live snapshot of machine metrics: Units Left, Today's Sales with % delta vs yesterday, Dispense Count (GCash vs Coin), and Coin Box fill %. Includes an "Attention Needed" table for low/empty slots and recent activity stream. |
| **📦 Slots & Inventory** | Visual machine rack schematic mirroring the physical ESP32 wiring order. Displays fill bars and stock tags (`In stock`, `Low stock`, `Empty`), plus an **Add stock** modal that safely caps stock at capacity. |
| **💳 Transactions** | Two-tier payment management: (1) **GCash Approvals Queue** with interactive **Approve** and **Reject** buttons, and (2) **Dispense History** with instant **Export CSV** download. GCash references are masked in the UI. |
| **🩺 Device Health** | Hardware telemetry grid and historical logs. The ESP32 CPU chart uses minute samples, avoids false zero dips for brief gaps, displays `0°C` after a 3+ minute telemetry outage, and shows the highest real recorded temperature. |
| **📋 ESP32 Logs** | Live/polled event timeline from `esp32_logs`, including Wi-Fi and Supabase connection events, HTTP result codes, coins, payment selection, relay state, IR detection, dispense result, and LCD text. |
| **🔔 Notifications** | Real-time alert feed for low stock alerts, coin box threshold warnings, vibration tamper events, and GCash submissions. Includes auto-updating sidebar unread badge and "Mark all as read". |
| **⚙️ Settings** | Comprehensive configuration panel: (1) **Products per Slot** name/capacity editor, (2) **Admin Profile** credentials updater with password change, and (3) **Machine Settings** (Unit Price, Low Stock Threshold, GSM Number, Tamper Toggle, Auto-Reset, Device Key). It loads on entry and after an explicit save/reload only, so edits are not interrupted by real-time updates. |

---

## 🚀 Installation & Setup Guide

### 1. Clone & Install Dependencies
Ensure you have **Node.js (v18+)** installed.

```powershell
# Navigate into the React application directory
cd c:\Users\kenne\Desktop\em-res\4peace-app\react-app

# Install dependencies (@supabase/supabase-js, react-router-dom)
npm install
```

### 2. Configure Environment Variables
Verify that `react-app/.env` contains your Supabase credentials:

```env
VITE_SUPABASE_URL=https://fjexweubnccjrinhxrct.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_DRZfiimKuXLYdLvE-7iVxQ_yZLMr2OS
```

### 3. Initialize or Upgrade the Database
1. Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/fjexweubnccjrinhxrct/sql/new).
2. For a new database, run [`001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql) first. Run [`002_mock_data.sql`](supabase/migrations/002_mock_data.sql) only when you need demo data; do not use its reset/seed statements on a production database.
3. Then run every timestamped migration in this order:

   ```text
   20260910053637_firmware_connection.sql
   20260911090000_enable_dashboard_realtime.sql
   20260911100000_sms_outbox.sql
   20260911110000_device_resource_telemetry.sql
   20260911120000_authenticated_device_telemetry.sql
   20260911130000_esp32_pin_connection_detection.sql
   20260911140000_esp32_pin_devices.sql
   20260912100000_esp32_realtime_heartbeat.sql
   20260912110000_repair_device_health_telemetry.sql
   20260915100000_esp32_event_logs.sql
   20260915110000_slot_restock.sql
   ```

4. The last four migrations are required for accurate online/offline state, repairable health telemetry, ESP32 Logs, and the Add stock modal. Re-flash the ESP32 firmware after applying them.

### 4. Run Development Server
```powershell
npm run dev
```
Open **`http://localhost:5173`** in your browser.

### 5. Build for Production
```powershell
npm run build
```
Creates an optimized static build in `react-app/dist/` ready to be served by Nginx, Vercel, Netlify, or any static web host.

---

## 🔌 ESP32 Firmware Integration & REST API Reference

The ESP32 communicates with Supabase directly via standard HTTPS PostgREST requests using the `HTTPClient` library in Arduino / ESP-IDF.

### Required HTTP Headers:
```http
apikey: YOUR_SUPABASE_PUBLISHABLE_KEY
Authorization: Bearer YOUR_SUPABASE_PUBLISHABLE_KEY
Content-Type: application/json
```

---

### Endpoints:

#### 1. Submit GCash Reference Number
- **Method:** `POST`
- **URL:** `https://<project-id>.supabase.co/rest/v1/gcash_payments`
- **Payload:**
```json
{
  "ref_code": "GC-99301",
  "slot_id": 1,
  "amount": 10.00,
  "status": "pending"
}
```

#### 2. Poll GCash Reference Approval Status
- **Method:** `GET`
- **URL:** `https://<project-id>.supabase.co/rest/v1/gcash_payments?ref_code=eq.GC-99301&select=status`
- **Response:**
```json
[
  { "status": "approved" }
]
```
*(When status is `"approved"`, the ESP32 actuates the dispensing motor).*

#### 3. Log Coin Dispense Transaction
- **Method:** `POST`
- **URL:** `https://<project-id>.supabase.co/rest/v1/transactions`
- **Payload:**
```json
{
  "ref_code": "PLS-0525",
  "method": "coin",
  "slot_id": 2,
  "amount": 10.00
}
```

#### 4. Update Slot Stock Level
- **Method:** `PATCH`
- **URL:** `https://<project-id>.supabase.co/rest/v1/slots?slot_code=eq.S1`
- **Payload:**
```json
{
  "stock": 21,
  "updated_at": "NOW()"
}
```

#### 5. Sync Hardware Telemetry & Health
- **Method:** `POST`
- **URL:** `https://<project-id>.supabase.co/rest/v1/rpc/sync_device_telemetry`
- **Payload:**
```json
{
  "p_device_key": "YOUR_DEVICE_KEY",
  "p_machine_id": "VM001",
  "p_device_health_id": 1,
  "p_health": {
    "esp32_uptime_seconds": 612800,
    "coin_pulses_session": 50,
    "sim800l_signal_pct": 85,
    "buck1_voltage": 5.03,
    "buck2_voltage": 4.19,
    "tamper_status": "idle"
  },
  "p_resource": {
    "cpu_temperature_c": 54.2
  }
}
```

#### 6. ESP32 Heartbeat & Event Logs
- **Heartbeat:** `POST /rest/v1/rpc/heartbeat_esp32` every 10 seconds. The dashboard treats the device as connected for 25 seconds after the latest successful heartbeat.
- **Event log:** `POST /rest/v1/rpc/write_esp32_log`. The firmware records Wi-Fi/Supabase connections, HTTP responses, payment and coin events, relay/IR events, dispense results, and displayed LCD text. The server supplies `created_at`, so timestamps do not depend on the ESP32 clock.

### Serial Monitor

Flash `firmware/4peace_esp32_firmware` and open Serial Monitor at **115200 baud**. Connection, Supabase request/response, telemetry, relay, IR, coin, workflow, and LCD events print there and also send to `esp32_logs` when Wi-Fi and Supabase are available. A relay `COMMAND OK` entry confirms ESP32 GPIO command/readback; physical motor and wiring validation still requires the actual vending hardware.

---

## 🔑 Default Credentials & Configuration

- **Dashboard Login URL:** `http://localhost:5173/login`
- **Default Username:** `admin`
- **Default Password:** `4peace2026`
- **Device API Key:** `4peace-esp32-live-token-2026`

> **Security Note:** Once logged in, navigate to **Settings ➔ Admin Profile** to update your password and administrator contact details.

---

## ❓ Troubleshooting & FAQ

#### Q: I get `401 Unauthorized` or empty tables when fetching data.
**A:** Apply the base schema and all timestamped migrations in the order listed above. Confirm the `.env` URL/key and the ESP32 `DEVICE_API_KEY` match `machine_settings.device_api_key`.

#### Q: The dashboard says “Waiting for ESP32” although the hardware is powered.
**A:** Check Serial Monitor at 115200 baud for Wi-Fi and `heartbeat_esp32` success. Apply `20260912100000_esp32_realtime_heartbeat.sql`, then re-flash the firmware. The status becomes connected only after a successful, recent authenticated heartbeat (within 25 seconds).

#### Q: Device Health still waits for a telemetry sample.
**A:** Apply `20260912110000_repair_device_health_telemetry.sql` and check Serial Monitor for `sync_device_telemetry` responses. The RPC recreates the main health record if it was previously deleted or cleared.

#### Q: How do I export transaction records?
**A:** Navigate to the **Transactions** view and click the **Export CSV** button in the top right. A `.csv` file will be generated containing reference IDs, payment methods, slot IDs, amounts, and timestamps.

#### Q: How does the dashboard update notifications without reloading?
**A:** The `DashboardPage` component runs a background poller every 20 seconds to sync unread alert counters and update the sidebar badge automatically.

---

## 👥 Authors & Academic Attribution

- **Project:** 4Peace — IoT-Based Smart Feminine Hygiene Access System
- **Institution:** Veritas College of Irosin
- **Development Stack:** ESP32 · SIM800L · Supabase · React 19 · TypeScript · Vite

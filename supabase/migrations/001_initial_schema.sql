-- ============================================================
-- 4Peace Admin Dashboard — Supabase (PostgreSQL) Schema
-- Run this in your Supabase project → SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- Admins (Normal username + password authentication)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL DEFAULT '4peace2026',
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(150),
  phone         VARCHAR(20),
  role          VARCHAR(30) DEFAULT 'Administrator',
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Default admin credentials:
-- Username: admin
-- Password: 4peace2026
INSERT INTO admins (username, password_hash, full_name, email, phone, role)
VALUES ('admin', '4peace2026', 'Grace (Team 4Peace)', 'team4peace@veritas.edu.ph', '+63 900 000 0000', 'Administrator')
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- ------------------------------------------------------------
-- Slots
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slots (
  id           SERIAL PRIMARY KEY,
  slot_code    VARCHAR(10) NOT NULL UNIQUE,
  product_name VARCHAR(100) NOT NULL,
  stock        INT NOT NULL DEFAULT 0,
  capacity     INT NOT NULL DEFAULT 30,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO slots (slot_code, product_name, stock, capacity) VALUES
  ('S1', 'Slot 1', 20, 30),
  ('S2', 'Slot 2', 20, 30),
  ('S3', 'Slot 3', 20, 30),
  ('S4', 'Slot 4', 20, 30),
  ('S5', 'Slot 5', 20, 30)
ON CONFLICT (slot_code) DO NOTHING;

-- ------------------------------------------------------------
-- Transactions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id         SERIAL PRIMARY KEY,
  ref_code   VARCHAR(30) NOT NULL,
  method     TEXT NOT NULL CHECK (method IN ('gcash','coin')),
  slot_id    INT REFERENCES slots(id) ON DELETE CASCADE,
  amount     NUMERIC(6,2) NOT NULL DEFAULT 10.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO transactions (ref_code, method, slot_id, amount, created_at) VALUES
  ('GC-88213', 'gcash', 1, 10.00, NOW() - INTERVAL '2 minutes'),
  ('PLS-0417',  'coin',  4, 10.00, NOW() - INTERVAL '14 minutes'),
  ('GC-88209', 'gcash', 5, 10.00, NOW() - INTERVAL '26 minutes'),
  ('PLS-0416',  'coin',  2, 10.00, NOW() - INTERVAL '41 minutes'),
  ('GC-88201', 'gcash', 3, 10.00, NOW() - INTERVAL '1 hour'),
  ('PLS-0415',  'coin',  1, 10.00, NOW() - INTERVAL '1 hour');

-- ------------------------------------------------------------
-- Device health
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_health (
  id                       SERIAL PRIMARY KEY,
  esp32_uptime_seconds     INT DEFAULT 0,
  coin_pulses_session      INT DEFAULT 0,
  sim800l_signal_pct       INT DEFAULT 0,
  buck1_voltage            NUMERIC(4,2) DEFAULT 0.00,
  buck2_voltage            NUMERIC(4,2) DEFAULT 0.00,
  tamper_status            TEXT DEFAULT 'idle' CHECK (tamper_status IN ('idle','triggered')),
  coin_box_pulses_total    INT DEFAULT 0,
  coin_box_capacity_pulses INT DEFAULT 1000,
  last_sync                TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO device_health
  (esp32_uptime_seconds, coin_pulses_session, sim800l_signal_pct, buck1_voltage, buck2_voltage, tamper_status, coin_box_pulses_total, coin_box_capacity_pulses)
VALUES (570240, 41, 78, 5.02, 4.18, 'idle', 680, 1000);

-- ------------------------------------------------------------
-- Machine health logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machine_health_logs (
  id         SERIAL PRIMARY KEY,
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','critical')),
  message    VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO machine_health_logs (level, message, created_at) VALUES
  ('warning',  'Slot S3 (Tampon — Regular) dropped below threshold (6 units left)', NOW() - INTERVAL '18 minutes'),
  ('critical', 'Slot S5 (Sanitary Pad — Overnight) is now empty — SMS alert sent',  NOW() - INTERVAL '52 minutes'),
  ('info',     'Coin box level check — 68% capacity, within normal range',           NOW() - INTERVAL '2 hours'),
  ('info',     'Daily boot self-test passed — all sensors responding',               NOW() - INTERVAL '6 hours');

-- ------------------------------------------------------------
-- Machine settings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machine_settings (
  id                    SERIAL PRIMARY KEY,
  unit_price            NUMERIC(6,2) NOT NULL DEFAULT 10.00,
  low_stock_threshold   INT NOT NULL DEFAULT 5,
  coin_box_alert_pct    INT NOT NULL DEFAULT 80,
  admin_sms_number      VARCHAR(20),
  tamper_alarm_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  auto_reset_coin_count BOOLEAN NOT NULL DEFAULT FALSE,
  device_api_key        VARCHAR(64),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO machine_settings
  (unit_price, low_stock_threshold, coin_box_alert_pct, admin_sms_number, tamper_alarm_enabled, auto_reset_coin_count, device_api_key)
VALUES (10.00, 5, 80, '+63 900 000 0000', TRUE, FALSE, '4peace-dev-key-2026');

-- ------------------------------------------------------------
-- GCash payments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gcash_payments (
  id          SERIAL PRIMARY KEY,
  ref_code    VARCHAR(30) NOT NULL,
  amount      NUMERIC(6,2) NOT NULL DEFAULT 10.00,
  slot_id     INT REFERENCES slots(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

INSERT INTO gcash_payments (ref_code, amount, slot_id, status, created_at, resolved_at) VALUES
  ('GC-99231', 10.00, 3, 'pending',  NOW() - INTERVAL '3 minutes', NULL),
  ('GC-88213', 10.00, 1, 'approved', NOW() - INTERVAL '40 minutes', NOW() - INTERVAL '38 minutes'),
  ('GC-88190', 10.00, 5, 'rejected', NOW() - INTERVAL '2 hours',    NOW() - INTERVAL '2 hours');

-- ------------------------------------------------------------
-- Notifications
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  type       TEXT NOT NULL DEFAULT 'system' CHECK (type IN ('gcash','stock','coin_box','tamper','system','sms')),
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','critical')),
  message    VARCHAR(255) NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO notifications (type, level, message, is_read, created_at) VALUES
  ('gcash',    'info',     'New GCash reference GC-99231 submitted — awaiting your approval', FALSE, NOW() - INTERVAL '3 minutes'),
  ('stock',    'warning',  'Slot S3 (Tampon — Regular) dropped below threshold (6 units left)', FALSE, NOW() - INTERVAL '18 minutes'),
  ('gcash',    'info',     'GCash reference GC-88213 approved — dispense allowed', TRUE, NOW() - INTERVAL '38 minutes'),
  ('stock',    'critical', 'Slot S5 (Sanitary Pad — Overnight) is now empty — SMS alert sent', TRUE, NOW() - INTERVAL '52 minutes'),
  ('gcash',    'warning',  'GCash reference GC-88190 rejected — no matching SMS found', TRUE, NOW() - INTERVAL '2 hours'),
  ('coin_box', 'info',     'Coin box level check — 68% capacity, within normal range', TRUE, NOW() - INTERVAL '2 hours'),
  ('system',   'info',     'Daily boot self-test passed — all sensors responding', TRUE, NOW() - INTERVAL '6 hours');

-- ============================================================
-- Row Level Security & Permissions
-- ============================================================
ALTER TABLE admins              DISABLE ROW LEVEL SECURITY;
ALTER TABLE slots               DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions        DISABLE ROW LEVEL SECURITY;
ALTER TABLE device_health       DISABLE ROW LEVEL SECURITY;
ALTER TABLE machine_health_logs  DISABLE ROW LEVEL SECURITY;
ALTER TABLE machine_settings    DISABLE ROW LEVEL SECURITY;
ALTER TABLE gcash_payments      DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications       DISABLE ROW LEVEL SECURITY;

-- Grant access to the API (anon & authenticated roles)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;


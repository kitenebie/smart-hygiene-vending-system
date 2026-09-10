-- ============================================================
-- 4Peace Admin Dashboard — Comprehensive Mock Data Seed Script
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/fjexweubnccjrinhxrct/sql/new
-- ============================================================

-- 1. Ensure Table Permissions & RLS
ALTER TABLE IF EXISTS public.admins              DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.slots               DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transactions        DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.device_health       DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.machine_health_logs  DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.machine_settings    DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.gcash_payments      DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications       DISABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

-- 2. Clear / Reset existing data cleanly
TRUNCATE TABLE public.notifications RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.gcash_payments RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.transactions RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.machine_health_logs RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.device_health RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.machine_settings RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.slots RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.admins RESTART IDENTITY CASCADE;

-- ------------------------------------------------------------
-- 3. Admins
-- ------------------------------------------------------------
INSERT INTO public.admins (username, password_hash, full_name, email, phone, role, last_login, created_at)
VALUES 
  ('operator1', '4peace2026', 'Mark Santos', 'marksantos@veritas.edu.ph', '+63 918 555 0144', 'Machine Technician', NOW() - INTERVAL '1 day', NOW() - INTERVAL '15 days');

-- ------------------------------------------------------------
-- 4. Slots & Inventory
-- ------------------------------------------------------------
INSERT INTO public.slots (slot_code, product_name, stock, capacity, updated_at)
VALUES 
  ('S1', 'Sanitary Pad — Regular (Wings)', 22, 30, NOW() - INTERVAL '15 minutes'),
  ('S2', 'Sanitary Pad — Overnight Long',  14, 30, NOW() - INTERVAL '40 minutes'),
  ('S3', 'Tampon — Regular Flow',          3,  30, NOW() - INTERVAL '1 hour'),     -- LOW STOCK (Threshold <= 5)
  ('S4', 'Panty Liner — Breathable 20s',   19, 30, NOW() - INTERVAL '2 hours'),
  ('S5', 'Feminine Cleansing Wipes 10s',   0,  30, NOW() - INTERVAL '3 hours');    -- EMPTY

-- ------------------------------------------------------------
-- 5. Transactions (Confirmed Dispenses)
-- Includes dispenses from today, yesterday, and earlier
-- ------------------------------------------------------------
INSERT INTO public.transactions (ref_code, method, slot_id, amount, created_at)
VALUES 
  -- Today's Transactions
  ('GC-99245', 'gcash', 1, 10.00, NOW() - INTERVAL '8 minutes'),
  ('PLS-0524', 'coin',  2, 10.00, NOW() - INTERVAL '25 minutes'),
  ('GC-99238', 'gcash', 4, 10.00, NOW() - INTERVAL '52 minutes'),
  ('PLS-0523', 'coin',  1, 10.00, NOW() - INTERVAL '1 hour 15 minutes'),
  ('GC-99230', 'gcash', 1, 10.00, NOW() - INTERVAL '2 hours 5 minutes'),
  ('PLS-0522', 'coin',  3, 10.00, NOW() - INTERVAL '2 hours 40 minutes'),
  ('PLS-0521', 'coin',  4, 10.00, NOW() - INTERVAL '3 hours 10 minutes'),
  ('GC-99219', 'gcash', 2, 10.00, NOW() - INTERVAL '4 hours 20 minutes'),
  ('PLS-0520', 'coin',  1, 10.00, NOW() - INTERVAL '5 hours 45 minutes'),
  ('GC-99210', 'gcash', 4, 10.00, NOW() - INTERVAL '6 hours 10 minutes'),

  -- Yesterday's Transactions
  ('GC-98101', 'gcash', 1, 10.00, NOW() - INTERVAL '1 day 2 hours'),
  ('PLS-0480', 'coin',  2, 10.00, NOW() - INTERVAL '1 day 3 hours'),
  ('PLS-0479', 'coin',  3, 10.00, NOW() - INTERVAL '1 day 4 hours'),
  ('GC-98095', 'gcash', 4, 10.00, NOW() - INTERVAL '1 day 6 hours'),
  ('PLS-0478', 'coin',  1, 10.00, NOW() - INTERVAL '1 day 8 hours'),
  ('GC-98088', 'gcash', 5, 10.00, NOW() - INTERVAL '1 day 10 hours'),

  -- 2 Days Ago
  ('GC-97302', 'gcash', 2, 10.00, NOW() - INTERVAL '2 days 1 hour'),
  ('PLS-0440', 'coin',  1, 10.00, NOW() - INTERVAL '2 days 4 hours'),
  ('PLS-0439', 'coin',  5, 10.00, NOW() - INTERVAL '2 days 7 hours');

-- ------------------------------------------------------------
-- 6. Device Health Snapshot
-- ------------------------------------------------------------
INSERT INTO public.device_health 
  (esp32_uptime_seconds, coin_pulses_session, sim800l_signal_pct, buck1_voltage, buck2_voltage, tamper_status, coin_box_pulses_total, coin_box_capacity_pulses, last_sync)
VALUES 
  (612450, 48, 85, 5.03, 4.19, 'idle', 740, 1000, NOW());

-- ------------------------------------------------------------
-- 7. Machine Health Logs
-- ------------------------------------------------------------
INSERT INTO public.machine_health_logs (level, message, created_at)
VALUES 
  ('warning',  'Slot S3 (Tampon — Regular Flow) dropped below threshold (3 units left)', NOW() - INTERVAL '1 hour'),
  ('critical', 'Slot S5 (Feminine Cleansing Wipes 10s) is EMPTY — SMS alert dispatched to admin', NOW() - INTERVAL '3 hours'),
  ('info',     'GCash auto-verification handshake sync completed successfully', NOW() - INTERVAL '4 hours'),
  ('info',     'Coin box level check: 740/1000 pulses (74% capacity - normal)', NOW() - INTERVAL '6 hours'),
  ('warning',  'SIM800L temporary signal dip (42%) recovered to 85%', NOW() - INTERVAL '12 hours'),
  ('info',     'Daily scheduled sensor calibration and self-test passed', NOW() - INTERVAL '18 hours');

-- ------------------------------------------------------------
-- 8. Machine Settings
-- ------------------------------------------------------------
INSERT INTO public.machine_settings 
  (unit_price, low_stock_threshold, coin_box_alert_pct, admin_sms_number, tamper_alarm_enabled, auto_reset_coin_count, device_api_key, updated_at)
VALUES 
  (10.00, 5, 80, '+63 917 555 0199', TRUE, FALSE, '4peace-esp32-live-token-2026', NOW());

-- ------------------------------------------------------------
-- 9. GCash Payments Workflow
-- ------------------------------------------------------------
INSERT INTO public.gcash_payments (ref_code, amount, slot_id, status, created_at, resolved_at)
VALUES 
  -- Pending references (waiting for admin to confirm matching SMS)
  ('GC-99301', 10.00, 1, 'pending', NOW() - INTERVAL '4 minutes', NULL),
  ('GC-99298', 10.00, 4, 'pending', NOW() - INTERVAL '12 minutes', NULL),

  -- Approved references
  ('GC-99245', 10.00, 1, 'approved', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '8 minutes'),
  ('GC-99238', 10.00, 4, 'approved', NOW() - INTERVAL '55 minutes', NOW() - INTERVAL '52 minutes'),
  ('GC-99230', 10.00, 1, 'approved', NOW() - INTERVAL '2 hours 8 minutes', NOW() - INTERVAL '2 hours 5 minutes'),

  -- Rejected references
  ('GC-99180', 10.00, 3, 'rejected', NOW() - INTERVAL '3 hours 30 minutes', NOW() - INTERVAL '3 hours 25 minutes'),
  ('GC-99142', 10.00, 2, 'rejected', NOW() - INTERVAL '5 hours 10 minutes', NOW() - INTERVAL '5 hours 5 minutes');

-- ------------------------------------------------------------
-- 10. Notifications Feed
-- ------------------------------------------------------------
INSERT INTO public.notifications (type, level, message, is_read, created_at)
VALUES 
  -- Unread notifications
  ('gcash',    'info',     'New GCash reference GC-99301 submitted for Slot S1 — awaiting SMS approval', FALSE, NOW() - INTERVAL '4 minutes'),
  ('gcash',    'info',     'New GCash reference GC-99298 submitted for Slot S4 — awaiting SMS approval', FALSE, NOW() - INTERVAL '12 minutes'),
  ('stock',    'warning',  'Slot S3 (Tampon — Regular Flow) is LOW on stock (3 units left)', FALSE, NOW() - INTERVAL '1 hour'),
  ('stock',    'critical', 'Slot S5 (Feminine Cleansing Wipes 10s) is EMPTY — restock needed immediately', FALSE, NOW() - INTERVAL '3 hours'),

  -- Read notifications
  ('gcash',    'info',     'GCash reference GC-99245 approved — dispense signal sent to ESP32', TRUE, NOW() - INTERVAL '8 minutes'),
  ('coin_box', 'info',     'Coin box reached 74% fill level (740 / 1000 pulses)', TRUE, NOW() - INTERVAL '6 hours'),
  ('gcash',    'warning',  'GCash reference GC-99180 rejected — no matching SMS reference found', TRUE, NOW() - INTERVAL '3 hours 25 minutes'),
  ('system',   'info',     'Daily self-test routine completed with all optical IR sensors OK', TRUE, NOW() - INTERVAL '18 hours'),
  ('sms',      'info',     'SIM800L module connected to network (Globe Telecom 85% RSSI)', TRUE, NOW() - INTERVAL '1 day');

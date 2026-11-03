<?php
require_once __DIR__ . '/../includes/auth_check.php';
require_login();
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/supabase_sync.php';
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

if (!$pdo->query("SHOW COLUMNS FROM machine_settings LIKE 'wifi_ssid'")->fetch()) {
    $pdo->exec('ALTER TABLE machine_settings ADD wifi_ssid VARCHAR(64) DEFAULT NULL');
}
if (!$pdo->query("SHOW COLUMNS FROM machine_settings LIKE 'wifi_password'")->fetch()) {
    $pdo->exec('ALTER TABLE machine_settings ADD wifi_password VARCHAR(64) DEFAULT NULL');
}

$data = json_decode(file_get_contents('php://input'), true);

$unitPrice   = (float)($data['unit_price'] ?? 10);
$lowStock    = (int)($data['low_stock_threshold'] ?? 5);
$coinAlert   = (int)($data['coin_box_alert_pct'] ?? 80);
$smsNumber   = trim($data['admin_sms_number'] ?? '');
$tamperOn    = !empty($data['tamper_alarm_enabled']) ? 1 : 0;
$autoReset   = !empty($data['auto_reset_coin_count']) ? 1 : 0;
$pinDetection = !empty($data['enable_pin_connection_detection']) ? 1 : 0;
$deviceKey   = trim($data['device_api_key'] ?? '');
$wifiSsid    = trim($data['wifi_ssid'] ?? '');
$wifiPassword = (string)($data['wifi_password'] ?? '');

if (strlen($wifiSsid) > 32) {
    http_response_code(400);
    echo json_encode(['error' => 'Wi-Fi name (SSID) must be 32 characters or fewer.']);
    exit;
}
if (strlen($wifiPassword) > 63) {
    http_response_code(400);
    echo json_encode(['error' => 'Wi-Fi password must be 63 characters or fewer.']);
    exit;
}

$row = $pdo->query("SELECT id, device_api_key, wifi_ssid, wifi_password FROM machine_settings ORDER BY id DESC LIMIT 1")->fetch();
// Never let the key be blanked out accidentally — keep the old one if the field was left empty.
if ($deviceKey === '' && $row) {
    $deviceKey = $row['device_api_key'];
}
if ($wifiPassword === '' && $row) {
    $wifiPassword = (string)($row['wifi_password'] ?? '');
}

$settings = [
    'unit_price' => $unitPrice,
    'low_stock_threshold' => $lowStock,
    'coin_box_alert_pct' => $coinAlert,
    'admin_sms_number' => $smsNumber,
    'tamper_alarm_enabled' => (bool)$tamperOn,
    'auto_reset_coin_count' => (bool)$autoReset,
    'enable_pin_connection_detection' => (bool)$pinDetection,
    'device_api_key' => $deviceKey,
    'wifi_ssid' => $wifiSsid !== '' ? $wifiSsid : null,
    'wifi_password' => $wifiPassword !== '' ? $wifiPassword : null,
];
$wifiRequested = array_key_exists('wifi_ssid', $data) || array_key_exists('wifi_password', $data);
try {
    if ($row) write_supabase_rows('machine_settings', ['id' => 'eq.' . $row['id']], 'PATCH', $settings);
    else write_supabase_rows('machine_settings', [], 'POST', $settings);
} catch (Throwable $exception) {
    $message = $exception->getMessage();
    $missingWifiColumns = stripos($message, 'wifi_ssid') !== false || stripos($message, 'wifi_password') !== false;
    if (!$missingWifiColumns) {
        error_log('Supabase settings update failed: ' . $message);
        http_response_code(502);
        echo json_encode(['error' => 'Could not save settings to Supabase.']);
        exit;
    }

    $settingsWithoutWifi = $settings;
    unset($settingsWithoutWifi['wifi_ssid'], $settingsWithoutWifi['wifi_password']);
    try {
        if ($row) write_supabase_rows('machine_settings', ['id' => 'eq.' . $row['id']], 'PATCH', $settingsWithoutWifi);
        else write_supabase_rows('machine_settings', [], 'POST', $settingsWithoutWifi);
    } catch (Throwable $fallbackException) {
        error_log('Supabase settings update failed: ' . $fallbackException->getMessage());
        http_response_code(502);
        echo json_encode(['error' => 'Could not save settings to Supabase.']);
        exit;
    }

    if ($wifiRequested && ($wifiSsid !== '' || $wifiPassword !== '')) {
        http_response_code(502);
        echo json_encode(['error' => 'Other settings saved, but Wi-Fi columns are missing in Supabase. Ask the original programmer to add wifi_ssid and wifi_password to machine_settings, then try again.']);
        exit;
    }
}

if ($row) {
    $stmt = $pdo->prepare("UPDATE machine_settings SET
        unit_price = ?, low_stock_threshold = ?, coin_box_alert_pct = ?,
        admin_sms_number = ?, tamper_alarm_enabled = ?, auto_reset_coin_count = ?, enable_pin_connection_detection = ?, device_api_key = ?,
        wifi_ssid = ?, wifi_password = ?
        WHERE id = ?");
    $stmt->execute([$unitPrice, $lowStock, $coinAlert, $smsNumber, $tamperOn, $autoReset, $pinDetection, $deviceKey, $wifiSsid !== '' ? $wifiSsid : null, $wifiPassword !== '' ? $wifiPassword : null, $row['id']]);
} else {
    $stmt = $pdo->prepare("INSERT INTO machine_settings
        (unit_price, low_stock_threshold, coin_box_alert_pct, admin_sms_number, tamper_alarm_enabled, auto_reset_coin_count, enable_pin_connection_detection, device_api_key, wifi_ssid, wifi_password)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([$unitPrice, $lowStock, $coinAlert, $smsNumber, $tamperOn, $autoReset, $pinDetection, $deviceKey, $wifiSsid !== '' ? $wifiSsid : null, $wifiPassword !== '' ? $wifiPassword : null]);
}

echo json_encode(['success' => true]);

<?php
require_once __DIR__ . '/../includes/auth_check.php';
require_login();
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/functions.php';
header('Content-Type: application/json');

$settings = get_setting($pdo);

$stmt = $pdo->prepare("SELECT id, username, full_name, email, phone, role, last_login FROM admins WHERE id = ?");
$stmt->execute([$_SESSION['admin_id']]);
$admin = $stmt->fetch();

echo json_encode([
    'machine' => [
        'unit_price'            => (float)$settings['unit_price'],
        'low_stock_threshold'   => (int)$settings['low_stock_threshold'],
        'coin_box_alert_pct'    => (int)$settings['coin_box_alert_pct'],
        'admin_sms_number'      => $settings['admin_sms_number'],
        'tamper_alarm_enabled'  => (bool)$settings['tamper_alarm_enabled'],
        'auto_reset_coin_count' => (bool)$settings['auto_reset_coin_count'],
        'enable_pin_connection_detection' => (bool)($settings['enable_pin_connection_detection'] ?? false),
        'device_api_key'        => $settings['device_api_key'],
        'wifi_ssid'             => $settings['wifi_ssid'] ?? '',
        'wifi_password_set'     => !empty($settings['wifi_password']),
    ],
    'profile' => [
        'full_name'  => $admin['full_name'],
        'username'   => $admin['username'],
        'email'      => $admin['email'],
        'phone'      => $admin['phone'],
        'role'       => $admin['role'],
        'last_login' => $admin['last_login'] ? time_ago($admin['last_login']) : 'This is your first login',
    ],
]);

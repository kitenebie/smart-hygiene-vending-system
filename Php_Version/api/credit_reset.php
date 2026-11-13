<?php
require_once __DIR__ . '/../includes/auth_check.php';
require_login();
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/functions.php';
require_once __DIR__ . '/../includes/supabase_sync.php';
header('Content-Type: application/json');

ensure_credit_reset_column($pdo);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $settings = get_setting($pdo);
    echo json_encode([
        'success' => true,
        'credit_reset_token' => (int)($settings['credit_reset_token'] ?? 0),
        'current_credit' => latest_machine_credit($pdo),
    ]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$row = $pdo->query('SELECT id, credit_reset_token FROM machine_settings ORDER BY id DESC LIMIT 1')->fetch();
if (!$row) {
    http_response_code(404);
    echo json_encode(['error' => 'Machine settings not found.']);
    exit;
}

$token = (int)($row['credit_reset_token'] ?? 0) + 1;
$message = 'Coin balance reset requested — the machine will set inserted credit to ₱0';

try {
    write_supabase_rows('machine_settings', ['id' => 'eq.' . $row['id']], 'PATCH', [
        'credit_reset_token' => $token,
    ]);
} catch (Throwable $exception) {
    error_log('Supabase credit reset update failed: ' . $exception->getMessage());
    http_response_code(502);
    echo json_encode([
        'error' => 'Could not send the reset to Supabase. Ask the original programmer to add an integer column named credit_reset_token (default 0) on machine_settings, then try again.',
    ]);
    exit;
}

try {
    write_supabase_rows('notifications', [], 'POST', [
        'type' => 'system',
        'level' => 'info',
        'message' => $message,
    ]);
} catch (Throwable $exception) {
    error_log('Supabase credit reset notification failed: ' . $exception->getMessage());
}

$pdo->prepare('UPDATE machine_settings SET credit_reset_token = ? WHERE id = ?')->execute([$token, $row['id']]);
add_notification($pdo, 'system', 'info', $message);

echo json_encode([
    'success' => true,
    'credit_reset_token' => $token,
    'message' => 'Reset sent. The machine will clear coin credit on its next settings poll (usually within a few seconds when nobody is using the keypad).',
]);

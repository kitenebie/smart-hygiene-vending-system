<?php
/**
 * Shared helper functions for the 4Peace dashboard.
 */

function slot_status(int $stock, int $lowStockThreshold): string {
    if ($stock <= 0) return 'empty';
    if ($stock <= $lowStockThreshold) return 'low';
    return 'ok';
}

function time_ago(string $datetime): string {
    $timestamp = strtotime($datetime);
    $diff = time() - $timestamp;

    if ($diff < 60)   return 'just now';
    if ($diff < 3600) return floor($diff / 60) . ' min ago';
    if ($diff < 86400) return floor($diff / 3600) . ' hr ago';
    return floor($diff / 86400) . ' day(s) ago';
}

function format_uptime(int $seconds): string {
    $days = floor($seconds / 86400);
    $hours = floor(($seconds % 86400) / 3600);
    return "{$days}d {$hours}h";
}

function get_setting(PDO $pdo, string $key = null) {
    $stmt = $pdo->query("SELECT * FROM machine_settings ORDER BY id DESC LIMIT 1");
    $row = $stmt->fetch();
    if ($key !== null) {
        return $row[$key] ?? null;
    }
    return $row;
}

/**
 * Guards device-facing endpoints (called by the ESP32, not the browser).
 * Expects a `device_key` field in the decoded JSON body or query string and
 * checks it against machine_settings.device_api_key. Ends the request with
 * 401 if it doesn't match.
 */
function require_device_key(PDO $pdo, ?string $providedKey): void {
    $validKey = get_setting($pdo, 'device_api_key');
    header('Content-Type: application/json');
    if (empty($validKey) || $providedKey === null || !hash_equals((string)$validKey, (string)$providedKey)) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid or missing device_key']);
        exit;
    }
}

function add_notification(PDO $pdo, string $type, string $level, string $message): void {
    $stmt = $pdo->prepare("INSERT INTO notifications (type, level, message) VALUES (?, ?, ?)");
    $stmt->execute([$type, $level, $message]);
}

function ensure_credit_reset_column(PDO $pdo): void {
    if (!$pdo->query("SHOW COLUMNS FROM machine_settings LIKE 'credit_reset_token'")->fetch()) {
        $pdo->exec('ALTER TABLE machine_settings ADD credit_reset_token INT NOT NULL DEFAULT 0');
    }
}

function latest_machine_credit(PDO $pdo): ?float {
    if (!$pdo->query("SHOW TABLES LIKE 'esp32_logs'")->fetchColumn()) {
        return null;
    }
    $message = $pdo->query(
        "SELECT message FROM esp32_logs
         WHERE message LIKE '%credit%'
         ORDER BY id DESC LIMIT 1"
    )->fetchColumn();
    if (!is_string($message) || !preg_match('/credit[= ]P?([0-9]+(?:\.[0-9]+)?)/i', $message, $match)) {
        return null;
    }
    return (float)$match[1];
}

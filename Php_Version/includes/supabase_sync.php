<?php
declare(strict_types=1);

function fetch_supabase_rows(string $table, array $columns, ?int $afterId = null, string $orderColumn = 'id'): array
{
    $env = is_file(__DIR__ . '/../.env') ? parse_ini_file(__DIR__ . '/../.env', false, INI_SCANNER_RAW) : [];
    $url = rtrim((string)($env['SUPABASE_URL'] ?? ''), '/');
    $key = (string)($env['SUPABASE_KEY'] ?? '');
    if ($url === '' || $key === '') throw new RuntimeException('Set SUPABASE_URL and SUPABASE_KEY in Php_Version/.env.');
    if (!function_exists('curl_init')) throw new RuntimeException('Enable PHP cURL to sync Supabase data.');

    $rows = [];
    $offset = 0;
    $pageSize = 500;
    do {
        if (!in_array($orderColumn, $columns, true)) throw new InvalidArgumentException('Invalid Supabase order column.');
        $query = ['select' => implode(',', $columns), 'order' => $orderColumn . '.asc'];
        if ($afterId !== null) $query['id'] = 'gt.' . $afterId;
        $curl = curl_init($url . '/rest/v1/' . rawurlencode($table) . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986));
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'apikey: ' . $key,
                'Authorization: Bearer ' . $key,
                'Range-Unit: items',
                'Range: ' . $offset . '-' . ($offset + $pageSize - 1),
            ],
            CURLOPT_TIMEOUT => 20,
        ]);
        $body = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $error = curl_error($curl);
        curl_close($curl);
        if ($body === false) throw new RuntimeException('Supabase connection failed: ' . $error);
        $page = json_decode($body, true);
        if ($status < 200 || $status >= 300 || !is_array($page)) {
            $message = is_array($page) ? ($page['message'] ?? 'Supabase request failed.') : 'Invalid Supabase response.';
            throw new RuntimeException($table . ': ' . $message);
        }
        $rows = [...$rows, ...$page];
        $offset += count($page);
    } while (count($page) === $pageSize);

    return $rows;
}

function write_supabase_rows(string $table, array $query, string $method, array $body): array
{
    $env = is_file(__DIR__ . '/../.env') ? parse_ini_file(__DIR__ . '/../.env', false, INI_SCANNER_RAW) : [];
    $url = rtrim((string)($env['SUPABASE_URL'] ?? ''), '/');
    $key = (string)($env['SUPABASE_KEY'] ?? '');
    if ($url === '' || $key === '' || !function_exists('curl_init')) throw new RuntimeException('Supabase is not configured.');
    $curl = curl_init($url . '/rest/v1/' . rawurlencode($table) . ($query ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : ''));
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => ['apikey: ' . $key, 'Authorization: Bearer ' . $key, 'Content-Type: application/json', 'Prefer: return=representation'],
        CURLOPT_POSTFIELDS => json_encode($body, JSON_THROW_ON_ERROR),
        CURLOPT_TIMEOUT => 20,
    ]);
    $response = curl_exec($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $curlError = curl_error($curl);
    curl_close($curl);
    if ($response === false) throw new RuntimeException('Supabase connection failed: ' . $curlError);
    $data = json_decode($response, true);
    if ($status < 200 || $status >= 300 || !is_array($data)) {
        $message = is_array($data) ? ($data['message'] ?? 'Supabase request failed.') : 'Invalid Supabase response.';
        throw new RuntimeException($message);
    }
    return $data;
}

function call_supabase_rpc(string $function, array $body): array
{
    if (!preg_match('/^[a-z_]+$/', $function)) throw new InvalidArgumentException('Invalid Supabase function.');
    $env = is_file(__DIR__ . '/../.env') ? parse_ini_file(__DIR__ . '/../.env', false, INI_SCANNER_RAW) : [];
    $url = rtrim((string)($env['SUPABASE_URL'] ?? ''), '/');
    $key = (string)($env['SUPABASE_KEY'] ?? '');
    if ($url === '' || $key === '' || !function_exists('curl_init')) throw new RuntimeException('Supabase is not configured.');
    $curl = curl_init($url . '/rest/v1/rpc/' . rawurlencode($function));
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['apikey: ' . $key, 'Authorization: Bearer ' . $key, 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($body, JSON_THROW_ON_ERROR),
        CURLOPT_TIMEOUT => 20,
    ]);
    $response = curl_exec($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error = curl_error($curl);
    curl_close($curl);
    if ($response === false) throw new RuntimeException('Supabase connection failed: ' . $error);
    $result = json_decode($response, true);
    if ($status < 200 || $status >= 300 || !is_array($result)) {
        throw new RuntimeException(is_array($result) ? ($result['message'] ?? 'Supabase request failed.') : 'Invalid Supabase response.');
    }
    return $result;
}

function sync_supabase_to_mysql(PDO $pdo): array
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS supabase_sync_state (table_name VARCHAR(64) PRIMARY KEY, last_id BIGINT NOT NULL DEFAULT 0) ENGINE=InnoDB');
    if (!$pdo->query("SHOW COLUMNS FROM machine_settings LIKE 'enable_pin_connection_detection'")->fetch()) {
        $pdo->exec('ALTER TABLE machine_settings ADD enable_pin_connection_detection TINYINT(1) NOT NULL DEFAULT 0');
    }
    if (!$pdo->query("SHOW COLUMNS FROM machine_settings LIKE 'wifi_ssid'")->fetch()) {
        $pdo->exec('ALTER TABLE machine_settings ADD wifi_ssid VARCHAR(64) DEFAULT NULL');
    }
    if (!$pdo->query("SHOW COLUMNS FROM machine_settings LIKE 'wifi_password'")->fetch()) {
        $pdo->exec('ALTER TABLE machine_settings ADD wifi_password VARCHAR(64) DEFAULT NULL');
    }
    if (!$pdo->query("SHOW COLUMNS FROM gcash_payments LIKE 'consumed_at'")->fetch()) {
        $pdo->exec('ALTER TABLE gcash_payments ADD consumed_at DATETIME DEFAULT NULL');
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS sms (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, client_event_id VARCHAR(100) NOT NULL UNIQUE,
        machine_id VARCHAR(32) NOT NULL, event_type ENUM('dispensed_product','payment','theft_alert','low_stock') NOT NULL,
        recipient VARCHAR(30) NOT NULL, message VARCHAR(320) NOT NULL, status ENUM('pending','sent') NOT NULL DEFAULT 'pending',
        attempt_count INT NOT NULL DEFAULT 0, last_attempt_at DATETIME DEFAULT NULL, last_error VARCHAR(255) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, sent_at DATETIME DEFAULT NULL, INDEX sms_created_idx (created_at)
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS esp32_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, machine_id VARCHAR(32) NOT NULL,
        level ENUM('info','warning','error') NOT NULL DEFAULT 'info', category VARCHAR(64) NOT NULL,
        message VARCHAR(500) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX esp32_logs_machine_created_idx (machine_id,created_at)
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS device_resource_logs (
        id BIGINT PRIMARY KEY, machine_id VARCHAR(32) NOT NULL,
        internal_sram_total_bytes BIGINT NOT NULL, internal_sram_free_bytes BIGINT NOT NULL,
        external_psram_total_bytes BIGINT NOT NULL, external_psram_free_bytes BIGINT NOT NULL,
        external_flash_total_bytes BIGINT NOT NULL, external_flash_used_bytes BIGINT NOT NULL,
        filesystem_total_bytes BIGINT NOT NULL, filesystem_used_bytes BIGINT NOT NULL,
        rom_total_bytes BIGINT NOT NULL, cpu_temperature_c DECIMAL(5,2) DEFAULT NULL,
        collected_at DATETIME NOT NULL, INDEX device_resource_logs_collected_idx (collected_at)
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS esp32_pin_status (
        id BIGINT PRIMARY KEY, machine_id VARCHAR(32) NOT NULL, gpio SMALLINT NOT NULL,
        pin_label VARCHAR(100) NOT NULL DEFAULT '', current_mode VARCHAR(100) NOT NULL,
        connection_status VARCHAR(20) NOT NULL, realtime_value VARCHAR(100) NOT NULL,
        updated_at DATETIME NOT NULL, UNIQUE KEY esp32_pin_status_gpio (machine_id,gpio)
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS esp32_pin_devices (
        id BIGINT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE,
        image_url TEXT NOT NULL, created_at DATETIME NOT NULL
    ) ENGINE=InnoDB");
    $imageUrlColumn = $pdo->query("SHOW COLUMNS FROM esp32_pin_devices LIKE 'image_url'")->fetch();
    if ($imageUrlColumn && str_starts_with(strtolower($imageUrlColumn['Type']), 'varchar')) {
        $pdo->exec('ALTER TABLE esp32_pin_devices MODIFY image_url TEXT NOT NULL');
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS esp32_pin_device_assignments (
        machine_id VARCHAR(32) NOT NULL, gpio SMALLINT NOT NULL, device_id BIGINT NOT NULL,
        updated_at DATETIME NOT NULL, PRIMARY KEY (machine_id,gpio)
    ) ENGINE=InnoDB");
    $tables = [
        'slots' => [['id','slot_code','product_name','stock','capacity','updated_at'], false],
        'machine_settings' => [['id','unit_price','low_stock_threshold','coin_box_alert_pct','admin_sms_number','tamper_alarm_enabled','auto_reset_coin_count','enable_pin_connection_detection','device_api_key','wifi_ssid','wifi_password','updated_at'], false],
        'device_health' => [['id','esp32_uptime_seconds','coin_pulses_session','sim800l_signal_pct','buck1_voltage','buck2_voltage','tamper_status','coin_box_pulses_total','coin_box_capacity_pulses','last_sync'], false],
        'transactions' => [['id','ref_code','method','slot_id','amount','created_at'], true],
        'machine_health_logs' => [['id','level','message','created_at'], true],
        'device_resource_logs' => [['id','machine_id','internal_sram_total_bytes','internal_sram_free_bytes','external_psram_total_bytes','external_psram_free_bytes','external_flash_total_bytes','external_flash_used_bytes','filesystem_total_bytes','filesystem_used_bytes','rom_total_bytes','cpu_temperature_c','collected_at'], true],
        'esp32_pin_status' => [['id','machine_id','gpio','pin_label','current_mode','connection_status','realtime_value','updated_at'], false],
        'esp32_pin_devices' => [['id','name','image_url','created_at'], false],
        'gcash_payments' => [['id','ref_code','amount','slot_id','status','consumed_at','created_at','resolved_at'], false],
        'notifications' => [['id','type','level','message','is_read','created_at'], false],
        'sms' => [['id','client_event_id','machine_id','event_type','recipient','message','status','attempt_count','last_attempt_at','last_error','created_at','sent_at'], false],
        'esp32_logs' => [['id','machine_id','level','category','message','created_at'], true],
    ];
    $timeColumns = ['updated_at','last_sync','created_at','resolved_at','last_attempt_at','sent_at','consumed_at','collected_at'];
    $booleanColumns = ['tamper_alarm_enabled','auto_reset_coin_count','enable_pin_connection_detection','is_read'];
    $counts = [];

    foreach ($tables as $table => [$columns, $incremental]) {
        $lastId = null;
        if ($incremental) {
            $state = $pdo->prepare('SELECT last_id FROM supabase_sync_state WHERE table_name = ?');
            $state->execute([$table]);
            $lastId = (int)($state->fetchColumn() ?: 0);
        }
        try {
            $rows = fetch_supabase_rows($table, $columns, $lastId);
        } catch (Throwable $exception) {
            if ($table !== 'machine_settings') {
                throw $exception;
            }
            $columns = array_values(array_filter(
                $columns,
                static fn(string $column): bool => $column !== 'wifi_ssid' && $column !== 'wifi_password'
            ));
            $rows = fetch_supabase_rows($table, $columns, $lastId);
        }
        if (!$rows) { $counts[$table] = 0; continue; }

        $quoted = array_map(static fn(string $column): string => '`' . $column . '`', $columns);
        $updates = array_values(array_filter($quoted, static fn(string $column): bool => $column !== '`id`'));
        $sql = 'INSERT INTO `' . $table . '` (' . implode(',', $quoted) . ') VALUES (' . implode(',', array_fill(0, count($columns), '?')) . ') ON DUPLICATE KEY UPDATE ' . implode(',', array_map(static fn(string $column): string => $column . '=VALUES(' . $column . ')', $updates));
        $insert = $pdo->prepare($sql);
        $maxId = $lastId ?? 0;
        $pdo->beginTransaction();
        try {
            foreach ($rows as $row) {
                $values = [];
                foreach ($columns as $column) {
                    $value = $row[$column] ?? null;
                    if ($value !== null && in_array($column, $timeColumns, true)) $value = (new DateTimeImmutable((string)$value))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
                    if ($value !== null && in_array($column, $booleanColumns, true)) $value = (int)(bool)$value;
                    $values[] = $value;
                }
                $insert->execute($values);
                if ($incremental) $maxId = max($maxId, (int)$row['id']);
            }
            if ($incremental) {
                $saveState = $pdo->prepare('INSERT INTO supabase_sync_state (table_name,last_id) VALUES (?,?) ON DUPLICATE KEY UPDATE last_id=VALUES(last_id)');
                $saveState->execute([$table, $maxId]);
            }
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
        $counts[$table] = count($rows);
    }

    $assignments = fetch_supabase_rows('esp32_pin_device_assignments', ['machine_id','gpio','device_id','updated_at'], null, 'gpio');
    $pdo->beginTransaction();
    try {
        $pdo->exec('DELETE FROM esp32_pin_device_assignments');
        $insertAssignment = $pdo->prepare('INSERT INTO esp32_pin_device_assignments (machine_id,gpio,device_id,updated_at) VALUES (?,?,?,?)');
        foreach ($assignments as $assignment) {
            $updatedAt = $assignment['updated_at'] ? (new DateTimeImmutable($assignment['updated_at']))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s') : gmdate('Y-m-d H:i:s');
            $insertAssignment->execute([$assignment['machine_id'], (int)$assignment['gpio'], (int)$assignment['device_id'], $updatedAt]);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $exception;
    }
    $counts['esp32_pin_device_assignments'] = count($assignments);

    return $counts;
}

// Arduino IDE tab: 08_supabase.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// HTTP / Supabase
// ============================================================================

// Keep request logs useful without exposing API keys, payment references,
// phone numbers, or request bodies in the Serial Monitor.
void logSupabaseRequest(const char *method, const char *endpoint, size_t bodyBytes = 0) {
  Serial.printf("[HTTP] %s Supabase %s", method, endpoint);
  if (bodyBytes > 0) Serial.printf(" | body=%u bytes", (unsigned int)bodyBytes);
  Serial.println();
}

void logSupabaseResponse(const char *method, const char *endpoint, int statusCode) {
  Serial.printf("[HTTP] %s Supabase %s -> HTTP %d\n", method, endpoint, statusCode);
}

void logSupabaseBeginFailure(const char *method, const char *endpoint) {
  Serial.printf("[HTTP] %s Supabase %s -> connection setup FAILED\n", method, endpoint);
}

void configureSecureClient(WiFiClientSecure &client) {
#if TLS_ALLOW_INSECURE
  client.setInsecure();
  Serial.println("[SUPABASE] TLS certificate verification: DISABLED");
#else
  static bool timeConfigured = false;
  if (!timeConfigured) {
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    timeConfigured = true;
  }
  if (time(nullptr) < 1704067200) {
    struct tm now;
    if (!getLocalTime(&now, 5000)) {
      Serial.println("[TLS] Waiting for network time; check NTP access.");
    } else {
      Serial.println("[TLS] Network time synchronized; certificate validation ready.");
    }
  }
  client.setCACert(SUPABASE_CA_CERTS);
#endif
}

void addSupabaseHeaders(HTTPClient &http, bool json) {
  http.addHeader("apikey", SUPABASE_KEY);
  http.setTimeout(10000);
  // Publishable keys use apikey. Bearer is only needed for legacy anon JWTs.
  if (String(SUPABASE_KEY).startsWith("eyJ")) {
    http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  }

  if (json) {
    http.addHeader("Content-Type", "application/json");
  }
}

bool httpFetchConfig() {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  configureSecureClient(client);

  HTTPClient http;

  String url =
    String(SUPABASE_URL) +
    "/rest/v1/machine_settings?select=*&order=id.desc&limit=1";

  logSupabaseRequest("GET", "machine_settings");
  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("GET", "machine_settings");
    return false;
  }
  addSupabaseHeaders(http);

  int code = http.GET();
  logSupabaseResponse("GET", "machine_settings", code);

  if (code != 200) {
    Serial.printf("[CONFIG] machine_settings HTTP %d\n", code);
    http.end();
    return false;
  }

  String payload = http.getString();
  http.end();

  StaticJsonDocument<1024> doc;
  if (deserializeJson(doc, payload)) {
    Serial.println("[CONFIG] JSON parse failed.");
    return false;
  }

  if (!doc.is<JsonArray>() || doc.size() == 0) {
    return false;
  }

  JsonObject obj = doc[0].as<JsonObject>();

  unitPrice = obj["unit_price"] | unitPrice;
  lowStockThreshold = obj["low_stock_threshold"] | lowStockThreshold;

  if (obj["admin_sms_number"].is<const char*>()) {
    adminSmsNumber = obj["admin_sms_number"].as<String>();
  }

  tamperAlarmEnabled =
    obj["tamper_alarm_enabled"] | tamperAlarmEnabled;

  bool previousPinDetection = pinConnectionDetectionEnabled;
  pinConnectionDetectionEnabled = obj["enable_pin_connection_detection"] | false;
  if (previousPinDetection && !pinConnectionDetectionEnabled) {
    restorePinDiagnosticOutputs();
  }

  Serial.printf(
    "[CONFIG] Price P%.2f | LowStock %d | Tamper %s\n",
    unitPrice,
    lowStockThreshold,
    tamperAlarmEnabled ? "ON" : "OFF"
  );

  return true;
}

bool httpFetchPinMonitoringState() {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  configureSecureClient(client);
  HTTPClient http;
  String url = String(SUPABASE_URL) +
    "/rest/v1/machine_settings?select=enable_pin_connection_detection&order=id.desc&limit=1";

  logSupabaseRequest("GET", "machine_settings (pin monitoring)");
  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("GET", "machine_settings (pin monitoring)");
    return false;
  }
  addSupabaseHeaders(http);
  int code = http.GET();
  logSupabaseResponse("GET", "machine_settings (pin monitoring)", code);
  String payload = http.getString();
  http.end();
  if (code != 200) return false;

  StaticJsonDocument<192> doc;
  if (deserializeJson(doc, payload) || !doc.is<JsonArray>() || doc.size() == 0) return false;

  bool enabled = doc[0]["enable_pin_connection_detection"] | false;
  if (pinConnectionDetectionEnabled && !enabled) {
    restorePinDiagnosticOutputs();
  }
  pinConnectionDetectionEnabled = enabled;
  return true;
}

bool httpFetchSlots() {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (hasPendingTransactions()) return false; // Also protects startup replay.

  WiFiClientSecure client;
  configureSecureClient(client);

  HTTPClient http;

  String url =
    String(SUPABASE_URL) +
    "/rest/v1/slots?select=id,slot_code,product_name,stock,capacity&order=id.asc";

  logSupabaseRequest("GET", "slots");
  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("GET", "slots");
    return false;
  }
  addSupabaseHeaders(http);

  int code = http.GET();
  logSupabaseResponse("GET", "slots", code);

  if (code != 200) {
    Serial.printf("[SLOTS] HTTP %d\n", code);
    http.end();
    return false;
  }

  String payload = http.getString();
  http.end();

  DynamicJsonDocument doc(2048);

  if (deserializeJson(doc, payload)) {
    Serial.println("[SLOTS] JSON parse failed.");
    return false;
  }

  if (!doc.is<JsonArray>()) return false;

  JsonArray arr = doc.as<JsonArray>();

  for (JsonObject obj : arr) {
    int id = obj["id"] | -1;
    String slotCode = obj["slot_code"] | "";
    String productName = obj["product_name"] | "";
    int stock = obj["stock"] | 0;
    int capacity = obj["capacity"] | 0;

    for (int i = 0; i < 5; i++) {
      if (slots[i].id == id || slots[i].slotCode == slotCode) {
        slots[i].id = id;
        if (slotCode.length()) slots[i].slotCode = slotCode;
        if (productName.length()) slots[i].productName = productName;
        slots[i].stock = stock;
        slots[i].capacity = capacity;
        persistStock(i);
        break;
      }
    }
  }

  Serial.println("[SLOTS] Cloud inventory synchronized.");
  return true;
}

int httpSubmitGcashPayment(
  const String &refCode,
  int slotId,
  float amount
) {
  if (WiFi.status() != WL_CONNECTED) return -1;

  WiFiClientSecure client;
  configureSecureClient(client);

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/gcash_payments";

  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("POST", "gcash_payments");
    return -1;
  }
  addSupabaseHeaders(http, true);

  http.addHeader("Prefer", "return=minimal");

  StaticJsonDocument<384> doc;
  doc["ref_code"] = refCode;
  doc["slot_id"] = slotId;
  doc["amount"] = amount;
  doc["status"] = "pending";

  String body;
  serializeJson(doc, body);

  logSupabaseRequest("POST", "gcash_payments", body.length());
  int code = http.POST(body);
  logSupabaseResponse("POST", "gcash_payments", code);

  Serial.printf("[GCASH] Submit HTTP %d\n", code);

  http.end();

  if (code == 200 || code == 201) {
    httpPostNotification(
      "gcash",
      "info",
      "New GCash ref " + refCode + " awaiting approval"
    );
  }

  return code;
}

String httpCheckGcashStatus(const String &refCode) {
  if (WiFi.status() != WL_CONNECTED) return "offline";
  // An item already dropped but awaiting a cloud ACK must not vend again.
  for (int i = 0; i < PENDING_QUEUE_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "tx%02d", i);
    String saved = prefs.getString(keyName, "");
    if (!saved.length()) continue;
    StaticJsonDocument<384> queued;
    if (deserializeJson(queued, saved)) return "error";
    if (queued["ref_code"].as<String>() == refCode) return "consumed";
  }

  WiFiClientSecure client;
  configureSecureClient(client);

  HTTPClient http;

  String url =
    String(SUPABASE_URL) +
    "/rest/v1/gcash_payments?ref_code=eq." +
    refCode +
    "&select=status,consumed_at,slot_id,amount&limit=1";

  logSupabaseRequest("GET", "gcash_payments status");
  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("GET", "gcash_payments status");
    return "error";
  }
  addSupabaseHeaders(http);

  int code = http.GET();
  logSupabaseResponse("GET", "gcash_payments status", code);

  if (code != 200) {
    http.end();
    return "error";
  }

  String payload = http.getString();
  http.end();

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, payload)) {
    return "error";
  }

  if (!doc.is<JsonArray>() || doc.size() == 0) {
    return "missing";
  }

  JsonObject obj = doc[0].as<JsonObject>();

  if (selectedSlotIndex < 0 || selectedSlotIndex >= 5 ||
      (obj["slot_id"] | -1) != slots[selectedSlotIndex].id ||
      fabs((obj["amount"] | 0.0f) - unitPrice) > 0.005f) {
    return "rejected";
  }
  if (!obj["consumed_at"].isNull()) {
    return "consumed";
  }

  return obj["status"] | "pending";
}

bool httpCompleteVend(const PendingTx &tx, int &serverStock) {
  serverStock = -1;

  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  configureSecureClient(client);

  HTTPClient http;

  String url =
    String(SUPABASE_URL) +
    "/rest/v1/rpc/complete_vend";

  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("POST", "rpc/complete_vend");
    return false;
  }
  addSupabaseHeaders(http, true);

  StaticJsonDocument<768> doc;
  doc["p_device_key"] = DEVICE_API_KEY;
  doc["p_device_tx_id"] = tx.txId;
  doc["p_machine_id"] = MACHINE_ID;
  doc["p_ref_code"] = tx.refCode;
  doc["p_method"] = tx.method;
  doc["p_slot_id"] = tx.slotId;
  doc["p_amount"] = tx.amount;

  String body;
  serializeJson(doc, body);

  logSupabaseRequest("POST", "rpc/complete_vend", body.length());
  int code = http.POST(body);
  String payload = http.getString();
  logSupabaseResponse("POST", "rpc/complete_vend", code);

  Serial.printf("[VEND RPC] HTTP %d | %s\n", code, payload.c_str());

  http.end();

  if (code != 200) {
    return false;
  }

  StaticJsonDocument<512> response;

  if (deserializeJson(response, payload)) {
    return false;
  }

  bool ok = response["success"] | false;
  serverStock = response["stock"] | -1;

  return ok;
}

DeviceResourceSnapshot readDeviceResourceSnapshot() {
  DeviceResourceSnapshot snapshot = {};
  snapshot.internalSramTotalBytes = heap_caps_get_total_size(
    MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT
  );
  snapshot.internalSramFreeBytes = heap_caps_get_free_size(
    MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT
  );
  snapshot.externalPsramTotalBytes = ESP.getPsramSize();
  snapshot.externalPsramFreeBytes = ESP.getFreePsram();
  snapshot.externalFlashTotalBytes = ESP.getFlashChipSize();
  snapshot.externalFlashUsedBytes = ESP.getSketchSize();
  snapshot.romTotalBytes = 448UL * 1024UL;  // ESP32 boot ROM size

  if (filesystemMounted) {
    snapshot.filesystemTotalBytes = LittleFS.totalBytes();
    snapshot.filesystemUsedBytes = LittleFS.usedBytes();
  }

  snapshot.cpuTemperatureC = temperatureRead();
  return snapshot;
}

bool httpSyncDeviceHealth() {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  configureSecureClient(client);

  HTTPClient http;

  String url = String(SUPABASE_URL) + "/rest/v1/rpc/sync_device_telemetry";

  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("POST", "rpc/sync_device_telemetry");
    return false;
  }
  addSupabaseHeaders(http, true);

  const DeviceResourceSnapshot resources = readDeviceResourceSnapshot();
  StaticJsonDocument<2048> doc;
  doc["p_device_key"] = DEVICE_API_KEY;
  doc["p_machine_id"] = MACHINE_ID;
  doc["p_device_health_id"] = DEVICE_HEALTH_ID;

  JsonObject health = doc.createNestedObject("p_health");
  health["esp32_uptime_seconds"] = millis() / 1000UL;
  health["coin_pulses_session"] = sessionCoinPulses;
  health["coin_box_pulses_total"] = totalCoinBoxPulses;
  health["tamper_status"] = "idle";

  if (gsmSignalPct >= 0) {
    health["sim800l_signal_pct"] = gsmSignalPct;
  }

#if ENABLE_VOLTAGE_MONITOR
  health["buck1_voltage"] = readRailVoltage(
    BUCK1_ADC_PIN,
    BUCK1_DIVIDER_RATIO
  );

  health["buck2_voltage"] = readRailVoltage(
    BUCK2_ADC_PIN,
    BUCK2_DIVIDER_RATIO
  );
#endif

  JsonObject resource = doc.createNestedObject("p_resource");
  resource["internal_sram_total_bytes"] = resources.internalSramTotalBytes;
  resource["internal_sram_free_bytes"] = resources.internalSramFreeBytes;
  resource["external_psram_total_bytes"] = resources.externalPsramTotalBytes;
  resource["external_psram_free_bytes"] = resources.externalPsramFreeBytes;
  resource["external_flash_total_bytes"] = resources.externalFlashTotalBytes;
  resource["external_flash_used_bytes"] = resources.externalFlashUsedBytes;
  resource["filesystem_total_bytes"] = resources.filesystemTotalBytes;
  resource["filesystem_used_bytes"] = resources.filesystemUsedBytes;
  resource["rom_total_bytes"] = resources.romTotalBytes;
  resource["cpu_temperature_c"] = resources.cpuTemperatureC;

  String body;
  serializeJson(doc, body);

  // PostgREST RPC functions are invoked with POST. PATCH is only for table
  // rows and causes this telemetry RPC to be rejected before it can update
  // device_health or create a device_resource_logs sample.
  logSupabaseRequest("POST", "rpc/sync_device_telemetry", body.length());
  int code = http.POST(body);
  String response = http.getString();
  logSupabaseResponse("POST", "rpc/sync_device_telemetry", code);
  http.end();
  StaticJsonDocument<256> ack;
  DeserializationError parseError = deserializeJson(ack, response);
  bool ok = code == 200 && !parseError && (ack["success"] | false);
  const char *message = ack["message"] | (parseError ? "invalid JSON response" : "");
  Serial.printf("[HEALTH] Telemetry sync %s (HTTP %d)%s%s\n",
                ok ? "SUCCESS" : "FAILED", code,
                message[0] ? ": " : "", message);
  return ok;
}

bool httpLogMachineAlert(
  const String &level,
  const String &message
) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  configureSecureClient(client);

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/machine_health_logs";

  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("POST", "machine_health_logs");
    return false;
  }
  addSupabaseHeaders(http, true);

  StaticJsonDocument<384> doc;
  doc["level"] = level;
  doc["message"] = message;

  String body;
  serializeJson(doc, body);

  logSupabaseRequest("POST", "machine_health_logs", body.length());
  int code = http.POST(body);
  logSupabaseResponse("POST", "machine_health_logs", code);
  http.end();

  return code == 200 || code == 201;
}

bool httpPostNotification(
  const String &type,
  const String &level,
  const String &message
) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  configureSecureClient(client);

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/notifications";

  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("POST", "notifications");
    return false;
  }
  addSupabaseHeaders(http, true);

  StaticJsonDocument<512> doc;
  doc["type"] = type;
  doc["level"] = level;
  doc["message"] = message;
  doc["is_read"] = false;

  String body;
  serializeJson(doc, body);

  logSupabaseRequest("POST", "notifications", body.length());
  int code = http.POST(body);
  logSupabaseResponse("POST", "notifications", code);
  http.end();

  return code == 200 || code == 201;
}

// ---------------------------------------------------------------------------
// SMS outbox API
// ---------------------------------------------------------------------------

bool httpQueueSmsEvent(const SmsEvent &event) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  configureSecureClient(client);

  HTTPClient http;
  String url = String(SUPABASE_URL) +
               "/rest/v1/sms?on_conflict=client_event_id";

  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("POST", "sms outbox");
    return false;
  }
  addSupabaseHeaders(http, true);
  // A retry with the same client_event_id must not create a second SMS.
  http.addHeader("Prefer", "resolution=ignore-duplicates,return=minimal");

  StaticJsonDocument<768> doc;
  doc["client_event_id"] = event.clientEventId;
  doc["machine_id"] = MACHINE_ID;
  doc["event_type"] = event.eventType;
  doc["recipient"] = event.recipient;
  doc["message"] = event.message;
  doc["status"] = "pending";

  String body;
  serializeJson(doc, body);

  logSupabaseRequest("POST", "sms outbox", body.length());
  int code = http.POST(body);
  logSupabaseResponse("POST", "sms outbox", code);
  http.end();

  Serial.printf("[SMS] Queue HTTP %d for %s\n",
                code, event.clientEventId.c_str());
  return code == 200 || code == 201;
}

bool httpMarkSmsSent(uint32_t smsId) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  configureSecureClient(client);

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/sms?id=eq." +
               String(smsId) + "&status=eq.pending";

  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("PATCH", "sms (mark sent)");
    return false;
  }
  addSupabaseHeaders(http, true);
  http.addHeader("Prefer", "return=minimal");

  StaticJsonDocument<96> doc;
  doc["status"] = "sent";
  String body;
  serializeJson(doc, body);

  logSupabaseRequest("PATCH", "sms (mark sent)", body.length());
  int code = http.PATCH(body);
  logSupabaseResponse("PATCH", "sms (mark sent)", code);
  http.end();

  // PostgREST returns 204 for a successful minimal PATCH. The request filter
  // includes status=pending, so a stale/replayed row is never changed back.
  bool ok = code == 204;
  Serial.printf("[SMS] Mark sent id=%lu HTTP %d ok=%s\n",
                (unsigned long)smsId, code, ok ? "yes" : "no");
  return ok;
}

bool httpRecordSmsFailure(
  uint32_t smsId,
  int nextAttemptCount,
  const String &error
) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  configureSecureClient(client);

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/sms?id=eq." +
               String(smsId) + "&status=eq.pending";

  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("PATCH", "sms (record failure)");
    return false;
  }
  addSupabaseHeaders(http, true);
  http.addHeader("Prefer", "return=minimal");

  StaticJsonDocument<192> doc;
  doc["attempt_count"] = nextAttemptCount;
  doc["last_error"] = error;
  String body;
  serializeJson(doc, body);

  logSupabaseRequest("PATCH", "sms (record failure)", body.length());
  int code = http.PATCH(body);
  logSupabaseResponse("PATCH", "sms (record failure)", code);
  http.end();

  bool ok = code == 204;
  Serial.printf("[SMS] Mark failed id=%lu HTTP %d ok=%s\n",
                (unsigned long)smsId, code, ok ? "yes" : "no");
  return ok;
}

void httpProcessPendingSms() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  configureSecureClient(client);

  HTTPClient http;
  String url = String(SUPABASE_URL) +
               "/rest/v1/sms?status=eq.pending"
               "&select=id,recipient,message,attempt_count"
               "&order=id.asc&limit=" + String(SMS_PROCESS_BATCH_SIZE);

  logSupabaseRequest("GET", "sms pending queue");
  if (!http.begin(client, url)) {
    logSupabaseBeginFailure("GET", "sms pending queue");
    return;
  }
  addSupabaseHeaders(http);

  int code = http.GET();
  logSupabaseResponse("GET", "sms pending queue", code);
  if (code != 200) {
    Serial.printf("[SMS] Fetch pending HTTP %d\n", code);
    http.end();
    return;
  }

  String payload = http.getString();
  http.end();

  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, payload) || !doc.is<JsonArray>()) {
    Serial.println("[SMS] Pending response JSON parse failed.");
    return;
  }

  JsonArray pending = doc.as<JsonArray>();
  for (JsonObject sms : pending) {
    uint32_t smsId = sms["id"] | 0;
    String recipient = sms["recipient"] | "";
    String message = sms["message"] | "";
    int attempts = sms["attempt_count"] | 0;

    if (smsId == 0 || !recipient.length() || !message.length()) {
      Serial.println("[SMS] Skipping malformed pending SMS row.");
      continue;
    }

    // Deliberately continue the loop after a modem failure. This prevents one
    // bad number or a transient GSM error from blocking newer pending alerts.
    if (gsmSendSMS(recipient, message)) {
      if (!httpMarkSmsSent(smsId)) {
        Serial.printf("[SMS] Sent id=%lu but Supabase ACK failed; status will be retried.\n",
                      (unsigned long)smsId);
      }
    } else {
      httpRecordSmsFailure(smsId, attempts + 1, "SIM800L send failed");
      Serial.printf("[SMS] Send failed id=%lu; continuing to next pending row.\n",
                    (unsigned long)smsId);
    }
  }
}

// ============================================================================

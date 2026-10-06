// Arduino IDE tab: 06_persistence.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.
// Guide: this file keeps the machine usable offline. LittleFS stores
// config/slot snapshots using temp-file then rename, habang Preferences/NVS
// stores credit, stock copy, prepared vend journal, and durable SMS outbox.
// Prepared-but-unresolved or corrupt sales lock vending for safety. Completed
// transactions and SMS events are replayed to Supabase later, then removed
// only after acknowledgement para hindi mawala ang offline work.

// Persistence / offline journal
// ============================================================================

static const char *MACHINE_CONFIG_CACHE_FILE = "/machine_config.json";
static const char *SLOTS_CACHE_FILE = "/slots.json";

// Write through a temporary file, then replace the old cache. A power loss
// therefore leaves either the previous complete JSON file or a temporary file
// that is ignored on the next boot -- never a partially-written live cache.
static bool writeJsonCache(const char *path, JsonDocument &doc) {
  if (!filesystemMounted) return false;

  String temporaryPath = String(path) + ".tmp";
  LittleFS.remove(temporaryPath);
  File file = LittleFS.open(temporaryPath, FILE_WRITE);
  if (!file) {
    Serial.printf("[LittleFS] Cannot open %s for writing.\n", temporaryPath.c_str());
    return false;
  }

  const size_t written = serializeJson(doc, file);
  file.flush();
  file.close();
  if (written == 0) {
    LittleFS.remove(temporaryPath);
    return false;
  }

  if (!LittleFS.rename(temporaryPath, path)) {
    Serial.printf("[LittleFS] Cannot replace %s.\n", path);
    return false;
  }
  return true;
}

bool saveMachineConfigCache() {
  DynamicJsonDocument doc(1024);
  doc["version"] = 1;
  doc["unit_price"] = unitPrice;
  doc["low_stock_threshold"] = lowStockThreshold;
  doc["admin_sms_number"] = adminSmsNumber;
  doc["tamper_alarm_enabled"] = tamperAlarmEnabled;
  doc["enable_pin_connection_detection"] = pinConnectionDetectionEnabled;

  const bool saved = writeJsonCache(MACHINE_CONFIG_CACHE_FILE, doc);
  Serial.printf("[LittleFS] machine_config %s.\n", saved ? "saved" : "save failed");
  return saved;
}

bool saveSlotsCache() {
  DynamicJsonDocument doc(2048);
  doc["version"] = 1;
  JsonArray cachedSlots = doc.createNestedArray("slots");
  for (int i = 0; i < 5; i++) {
    JsonObject item = cachedSlots.createNestedObject();
    item["id"] = slots[i].id;
    item["slot_code"] = slots[i].slotCode;
    item["product_name"] = slots[i].productName;
    item["stock"] = slots[i].stock;
    item["capacity"] = slots[i].capacity;
  }

  const bool saved = writeJsonCache(SLOTS_CACHE_FILE, doc);
  Serial.printf("[LittleFS] slots %s.\n", saved ? "saved" : "save failed");
  return saved;
}

static bool loadMachineConfigCache() {
  if (!filesystemMounted || !LittleFS.exists(MACHINE_CONFIG_CACHE_FILE)) return false;
  File file = LittleFS.open(MACHINE_CONFIG_CACHE_FILE, FILE_READ);
  if (!file) return false;

  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error || doc["version"] != 1) return false;

  unitPrice = doc["unit_price"] | unitPrice;
  lowStockThreshold = doc["low_stock_threshold"] | lowStockThreshold;
  adminSmsNumber = doc["admin_sms_number"] | adminSmsNumber;
  tamperAlarmEnabled = doc["tamper_alarm_enabled"] | tamperAlarmEnabled;
  pinConnectionDetectionEnabled = doc["enable_pin_connection_detection"] | false;
  return isfinite(unitPrice) && unitPrice > 0.0f && lowStockThreshold >= 0;
}

static bool loadSlotsCache() {
  if (!filesystemMounted || !LittleFS.exists(SLOTS_CACHE_FILE)) return false;
  File file = LittleFS.open(SLOTS_CACHE_FILE, FILE_READ);
  if (!file) return false;

  DynamicJsonDocument doc(2048);
  DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error || doc["version"] != 1 || !doc["slots"].is<JsonArray>()) return false;

  int loaded = 0;
  for (JsonObject item : doc["slots"].as<JsonArray>()) {
    int id = item["id"] | -1;
    String code = item["slot_code"] | "";
    for (int i = 0; i < 5; i++) {
      if (id != slots[i].id && code != slots[i].slotCode) continue;
      String product = item["product_name"] | "";
      int stock = item["stock"] | -1;
      int capacity = item["capacity"] | -1;
      if (!code.length() || !product.length() || stock < 0 || capacity < 0) return false;
      slots[i].id = id;
      slots[i].slotCode = code;
      slots[i].productName = product;
      slots[i].stock = stock;
      slots[i].capacity = capacity;
      loaded++;
      break;
    }
  }
  return loaded == 5;
}

bool loadLocalMachineData() {
  const bool configLoaded = loadMachineConfigCache();
  const bool slotsLoaded = loadSlotsCache();
  const bool ready = configLoaded && slotsLoaded;
  Serial.printf("[LittleFS] Local snapshot config=%s slots=%s\n",
                configLoaded ? "OK" : "MISSING/INVALID",
                slotsLoaded ? "OK" : "MISSING/INVALID");
  return ready;
}

void loadPersistentStocks() {
  totalCoinBoxPulses = prefs.getULong("coinTotal", 0);
  currentCredit = prefs.getFloat("credit", 0.0f);
  if (!isfinite(currentCredit) || currentCredit < 0.0f) {
    currentCredit = 0.0f;
    prefs.putFloat("credit", currentCredit);
  }

  for (int i = 0; i < 5; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "stock%d", i);

    if (prefs.isKey(keyName)) {
      slots[i].stock = prefs.getInt(keyName, slots[i].stock);
    }
  }
}

bool persistCurrentCredit() {
  for (int attempt = 0; attempt < 3; attempt++) {
    if (prefs.putFloat("credit", currentCredit) == sizeof(float)) return true;
    delay(5);
  }
  return false;
}

bool persistStock(int slotIdx) {
  if (slotIdx < 0 || slotIdx >= 5) return false;

  char keyName[8];
  snprintf(keyName, sizeof(keyName), "stock%d", slotIdx);
  bool nvsSaved = false;
  for (int attempt = 0; attempt < 3; attempt++) {
    if (prefs.putInt(keyName, slots[slotIdx].stock) == sizeof(int32_t)) {
      nvsSaved = true;
      break;
    }
    delay(5);
  }
  // A vend is usable offline only after its current stock has reached the
  // LittleFS JSON snapshot. NVS remains a secondary recovery copy.
  const bool cacheSaved = saveSlotsCache();
  if (cacheSaved) localDataReady = true;
  return nvsSaved && cacheSaved;
}

bool pendingQueueHasSpace() {
  bool emptySlotFound = false;

  for (int i = 0; i < PENDING_QUEUE_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "tx%02d", i);

    String json = prefs.getString(keyName, "");
    if (json.length() == 0) {
      emptySlotFound = true;
      continue;
    }

    StaticJsonDocument<384> doc;
    // A corrupt or prepared-but-unresolved sale must lock vending. Continuing
    // could release stock or accept the same GCash payment twice after reset.
    if (deserializeJson(doc, json)) {
      Serial.printf("[QUEUE] Corrupt transaction journal in %s; vending locked.\n",
                    keyName);
      return false;
    }
    if (!(doc["completed"] | true)) {
      Serial.printf("[QUEUE] Unresolved prepared transaction %s in %s; vending locked.\n",
                    doc["tx_id"].as<const char *>(), keyName);
      return false;
    }
  }

  return emptySlotFound;
}

bool hasPendingTransactions() {
  for (int i = 0; i < PENDING_QUEUE_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "tx%02d", i);
    if (prefs.getString(keyName, "").length() > 0) return true;
  }
  return false;
}

bool enqueuePendingTransaction(const PendingTx &tx) {
  for (int i = 0; i < PENDING_QUEUE_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "tx%02d", i);

    if (prefs.getString(keyName, "").length() != 0) {
      continue;
    }

    StaticJsonDocument<384> doc;
    doc["tx_id"] = tx.txId;
    doc["ref_code"] = tx.refCode;
    doc["method"] = tx.method;
    doc["slot_id"] = tx.slotId;
    doc["amount"] = tx.amount;
    doc["completed"] = tx.completed;

    String json;
    serializeJson(doc, json);

    size_t written = prefs.putString(keyName, json);

    if (written > 0) {
      Serial.printf("[QUEUE] Stored %s in %s\n",
                    tx.txId.c_str(), keyName);
      return true;
    }

    return false;
  }

  return false;
}

bool markPendingTransactionCompleted(const String &txId) {
  for (int i = 0; i < PENDING_QUEUE_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "tx%02d", i);

    String json = prefs.getString(keyName, "");
    if (!json.length()) continue;

    StaticJsonDocument<384> doc;
    if (deserializeJson(doc, json)) return false;
    if (doc["tx_id"].as<String>() != txId) continue;

    doc["completed"] = true;
    String updated;
    serializeJson(doc, updated);
    for (int attempt = 0; attempt < 3; attempt++) {
      if (prefs.putString(keyName, updated) > 0) return true;
      delay(5);
    }
    return false;
  }

  return false;
}

bool removePendingTransaction(const String &txId) {
  for (int i = 0; i < PENDING_QUEUE_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "tx%02d", i);

    String json = prefs.getString(keyName, "");
    if (!json.length()) continue;

    StaticJsonDocument<384> doc;
    if (deserializeJson(doc, json)) return false;
    if (doc["tx_id"].as<String>() == txId) {
      // NVS erase includes a commit, but verify by reading the key back. A
      // transient failure must not leave a normal no-drop result looking like
      // an unresolved vend and permanently blocking the next keypad attempt.
      for (int attempt = 1; attempt <= 3; attempt++) {
        if (prefs.getString(keyName, "").length() == 0) return true;

        const bool removed = prefs.remove(keyName);
        if (removed && prefs.getString(keyName, "").length() == 0) {
          Serial.printf("[QUEUE] Cleared failed vend %s from %s.\n",
                        txId.c_str(), keyName);
          return true;
        }

        Serial.printf("[QUEUE] Retry %d clearing failed vend %s from %s.\n",
                      attempt, txId.c_str(), keyName);
        delay(10);
      }

      return prefs.getString(keyName, "").length() == 0;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// SMS outbox
// ---------------------------------------------------------------------------
// SMS alerts use their own durable queue. An entry remains here until the
// Supabase insert is acknowledged; after that, the public.sms row is the
// source of truth for SIM800L delivery/retry state.

bool smsOutboxHasSpace(int requiredSlots) {
  if (requiredSlots <= 0) return true;

  int emptySlots = 0;
  for (int i = 0; i < SMS_OUTBOX_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "sms%02d", i);

    if (prefs.getString(keyName, "").length() == 0) {
      emptySlots++;
      if (emptySlots >= requiredSlots) return true;
    }
  }

  return false;
}

bool queueSmsEvent(const String &eventType, const String &message) {
  if (!smsOutboxHasSpace()) {
    Serial.printf("[SMS] Local outbox full; event %s was not queued.\n",
                  eventType.c_str());
    return false;
  }

  SmsEvent event;
  event.clientEventId = makeSmsEventId();
  event.eventType = eventType;
  event.recipient = adminSmsNumber;
  event.message = message;

  for (int i = 0; i < SMS_OUTBOX_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "sms%02d", i);

    if (prefs.getString(keyName, "").length() != 0) continue;

    StaticJsonDocument<768> doc;
    doc["client_event_id"] = event.clientEventId;
    doc["event_type"] = event.eventType;
    doc["recipient"] = event.recipient;
    doc["message"] = event.message;

    String json;
    serializeJson(doc, json);

    if (prefs.putString(keyName, json) > 0) {
      Serial.printf("[SMS] Queued %s in %s\n",
                    event.clientEventId.c_str(), keyName);

      // Upload happens only in the idle periodic sync. Never let a vend wait
      // for a cloud response after the local event has been made durable.
      return true;
    }

    return false;
  }

  return false;
}

bool isSmsDeliveryAwaitingAck(uint32_t smsId) {
  for (int i = 0; i < SMS_OUTBOX_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "ack%02d", i);
    if (prefs.getULong(keyName, 0) == smsId) return true;
  }
  return false;
}

bool rememberSmsDeliveryAwaitingAck(uint32_t smsId) {
  if (isSmsDeliveryAwaitingAck(smsId)) return true;

  for (int i = 0; i < SMS_OUTBOX_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "ack%02d", i);
    if (prefs.getULong(keyName, 0) == 0) {
      return prefs.putULong(keyName, smsId) == sizeof(uint32_t);
    }
  }
  return false;
}

void forgetSmsDeliveryAwaitingAck(uint32_t smsId) {
  for (int i = 0; i < SMS_OUTBOX_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "ack%02d", i);
    if (prefs.getULong(keyName, 0) == smsId) {
      prefs.remove(keyName);
      return;
    }
  }
}

void syncPendingSmsOutbox() {
  if (WiFi.status() != WL_CONNECTED) return;

  for (int i = 0; i < SMS_OUTBOX_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "sms%02d", i);

    String json = prefs.getString(keyName, "");
    if (json.length() == 0) continue;

    StaticJsonDocument<768> doc;
    if (deserializeJson(doc, json)) {
      Serial.printf("[SMS] Corrupt outbox entry %s; leaving it for inspection.\n",
                    keyName);
      continue;
    }

    SmsEvent event;
    event.clientEventId = doc["client_event_id"] | "";
    event.eventType = doc["event_type"] | "";
    event.recipient = doc["recipient"] | "";
    event.message = doc["message"] | "";

    if (!event.clientEventId.length() || !event.eventType.length() ||
        !event.message.length()) {
      Serial.printf("[SMS] Invalid outbox entry %s; leaving it for inspection.\n",
                    keyName);
      continue;
    }

    if (!httpQueueSmsEvent(event)) {
      Serial.printf("[SMS] Supabase upload failed for %s; will retry later.\n",
                    event.clientEventId.c_str());
      // Preserve event ordering until the connection/service is healthy again.
      return;
    }

    prefs.remove(keyName);
    Serial.printf("[SMS] Saved %s to Supabase sms table.\n",
                  event.clientEventId.c_str());
  }
}

void syncPendingTransactions() {
  if (WiFi.status() != WL_CONNECTED) return;

  for (int i = 0; i < PENDING_QUEUE_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "tx%02d", i);

    String json = prefs.getString(keyName, "");
    if (json.length() == 0) continue;

    StaticJsonDocument<384> doc;
    DeserializationError err = deserializeJson(doc, json);

    if (err) {
      Serial.printf("[QUEUE] Corrupt entry %s; leaving for manual inspection.\n",
                    keyName);
      return;
    }

    PendingTx tx;
    tx.txId = doc["tx_id"] | "";
    tx.refCode = doc["ref_code"] | "";
    tx.method = doc["method"] | "";
    tx.slotId = doc["slot_id"] | 0;
    tx.amount = doc["amount"] | 0.0f;
    tx.completed = doc["completed"] | true; // Legacy entries were completed sales.

    if (!tx.completed) {
      Serial.printf("[QUEUE] Unresolved prepared vend %s; service remains locked.\n",
                    tx.txId.c_str());
      return;
    }

    if (!tx.txId.length() || (tx.method != "coin" && tx.method != "gcash") ||
        tx.slotId <= 0 || tx.amount <= 0.0f) {
      Serial.printf("[QUEUE] Invalid entry %s; service remains locked.\n", keyName);
      return;
    }

    int serverStock = -1;

    if (!httpCompleteVend(tx, serverStock)) {
      Serial.printf("[SYNC] Failed %s; will retry later.\n", tx.txId.c_str());
      return; // preserve ordering
    }

    // Successful/idempotent server ACK: remove local journal entry.
    prefs.remove(keyName);

    // Update matching local slot to authoritative server stock.
    for (int s = 0; s < 5; s++) {
      if (slots[s].id == tx.slotId && serverStock >= 0) {
        // Do not restore inventory represented by other pending physical sales.
        // A full stock refresh may increase it once the entire queue drains.
        slots[s].stock = min(slots[s].stock, serverStock);
        persistStock(s);
        break;
      }
    }

    Serial.printf("[SYNC] Completed %s, server stock=%d\n",
                  tx.txId.c_str(), serverStock);
  }
}

// ============================================================================

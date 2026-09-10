// Arduino IDE tab: 06_persistence.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// Persistence / offline journal
// ============================================================================

void loadPersistentStocks() {
  totalCoinBoxPulses = prefs.getULong("coinTotal", 0);

  for (int i = 0; i < 5; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "stock%d", i);

    if (prefs.isKey(keyName)) {
      slots[i].stock = prefs.getInt(keyName, slots[i].stock);
    }
  }
}

void persistStock(int slotIdx) {
  if (slotIdx < 0 || slotIdx >= 5) return;

  char keyName[8];
  snprintf(keyName, sizeof(keyName), "stock%d", slotIdx);
  prefs.putInt(keyName, slots[slotIdx].stock);
}

bool pendingQueueHasSpace() {
  for (int i = 0; i < PENDING_QUEUE_MAX; i++) {
    char keyName[8];
    snprintf(keyName, sizeof(keyName), "tx%02d", i);

    if (prefs.getString(keyName, "").length() == 0) {
      return true;
    }
  }

  return false;
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
      continue;
    }

    PendingTx tx;
    tx.txId = doc["tx_id"] | "";
    tx.refCode = doc["ref_code"] | "";
    tx.method = doc["method"] | "";
    tx.slotId = doc["slot_id"] | 0;
    tx.amount = doc["amount"] | 0.0f;

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

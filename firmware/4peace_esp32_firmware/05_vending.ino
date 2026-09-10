// Arduino IDE tab: 05_vending.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// Dispensing
// ============================================================================

bool sensorIsTriggeredStable(int pin, unsigned long stableMs) {
  if (digitalRead(pin) != IR_TRIGGERED_LEVEL) return false;

  unsigned long started = millis();
  while (millis() - started < stableMs) {
    if (digitalRead(pin) != IR_TRIGGERED_LEVEL) return false;
    delay(2);
  }
  return true;
}

bool waitForNewIrDrop(int pin, unsigned long timeoutMs) {
  unsigned long started = millis();

  // Because we verify CLEAR before motor ON, the next stable trigger is a NEW drop.
  while (millis() - started < timeoutMs) {
    if (sensorIsTriggeredStable(pin, SENSOR_STABLE_MS)) {
      return true;
    }
    delay(5);
  }

  return false;
}

String makeTransactionId() {
  char buffer[64];
  uint32_t rnd = esp_random();

  snprintf(
    buffer,
    sizeof(buffer),
    "%s-%08lX-%08lX",
    MACHINE_ID,
    (unsigned long)millis(),
    (unsigned long)rnd
  );

  return String(buffer);
}

bool executeDispense(int slotIdx, const String &method, const String &refCode) {
  if (slotIdx < 0 || slotIdx >= 5) return false;

  SlotItem &s = slots[slotIdx];

  if (s.stock <= 0) {
    updateLcd("OUT OF STOCK", s.slotCode);
    currentState = STATE_ERROR;
    delay(1000);
    currentState = STATE_IDLE;
    return false;
  }

  if (!pendingQueueHasSpace()) {
    updateLcd("Sync Queue Full", "Service Locked");
    currentState = STATE_ERROR;
    beepBuzzer(4, 100);
    delay(1200);
    currentState = STATE_IDLE;
    return false;
  }

  // Reject vend if IR is already blocked BEFORE motor activation.
  if (sensorIsTriggeredStable(s.irPin, SENSOR_STABLE_MS)) {
    updateLcd("IR Sensor Blocked", s.slotCode);
    Serial.printf("[IR] Slot %s sensor already blocked before vend.\n",
                  s.slotCode.c_str());

    if (WiFi.status() == WL_CONNECTED) {
      httpLogMachineAlert(
        "critical",
        "IR sensor blocked before vend on " + s.slotCode
      );
    }

    currentState = STATE_ERROR;
    beepBuzzer(4, 100);
    delay(1200);
    currentState = STATE_IDLE;
    return false;
  }

  currentState = STATE_DISPENSING;
  updateLcd("Dispensing " + s.slotCode, s.productName);

  bool dropConfirmed = false;

  for (int attempt = 1; attempt <= DISPENSE_RETRY_COUNT; attempt++) {
    Serial.printf(
      "[DISPENSE] Slot %s attempt %d/%d, relay GPIO %d\n",
      s.slotCode.c_str(),
      attempt,
      DISPENSE_RETRY_COUNT,
      s.relayPin
    );

    // Ignore vibration sensor while motor is physically running.
    motorActive = true;

    digitalWrite(s.relayPin, RELAY_ACTIVE_LEVEL);

    dropConfirmed = waitForNewIrDrop(s.irPin, DISPENSE_TIMEOUT_MS);

    digitalWrite(s.relayPin, RELAY_INACTIVE_LEVEL);

    motorActive = false;

    // Clear motor-generated vibration history.
    portENTER_CRITICAL(&tamperMux);
    tamperEdgeCount = 0;
    portEXIT_CRITICAL(&tamperMux);

    if (dropConfirmed) break;

    if (attempt < DISPENSE_RETRY_COUNT) {
      updateLcd("Retry Dispense", s.slotCode);
      delay(700);

      // If sensor became blocked after timeout, do not blindly run motor again.
      if (sensorIsTriggeredStable(s.irPin, SENSOR_STABLE_MS)) {
        break;
      }
    }
  }

  if (!dropConfirmed) {
    updateLcd("Dispense Failed", "No IR Drop");
    beepBuzzer(4, 120);

    if (WiFi.status() == WL_CONNECTED) {
      httpLogMachineAlert(
        "critical",
        "Dispense failed on " + s.slotCode + ": IR did not confirm product drop"
      );

      httpPostNotification(
        "system",
        "critical",
        "Dispense failure on " + s.slotCode
      );
    }

    // Important: coin credit is NOT deducted on failure.
    // GCash is NOT consumed because complete_vend() is not called.
    selectedSlotIndex = -1;
    currentState = STATE_ERROR;
    delay(1800);
    currentState = STATE_IDLE;
    stateTimer = millis();
    return false;
  }

  // ------------------------------------------------------------------------
  // PHYSICAL DROP CONFIRMED
  // ------------------------------------------------------------------------

  currentState = STATE_SUCCESS;

  // Coin balance is spent only after confirmed physical drop.
  if (method == "coin") {
    currentCredit -= unitPrice;
    if (currentCredit < 0.0f) currentCredit = 0.0f;
  }

  // Decrement persistent local inventory immediately.
  s.stock--;
  if (s.stock < 0) s.stock = 0;
  persistStock(slotIdx);

  PendingTx tx;
  tx.txId = makeTransactionId();
  tx.refCode = refCode;
  tx.method = method;
  tx.slotId = s.id;
  tx.amount = unitPrice;

  // Journal FIRST. This protects the sale across Wi-Fi loss / reboot.
  if (!enqueuePendingTransaction(tx)) {
    Serial.println("[FATAL] Could not journal completed physical vend.");
    updateLcd("Journal Error", "Call Admin");
    beepBuzzer(5, 120);
  }

  // Best-effort immediate cloud sync.
  if (WiFi.status() == WL_CONNECTED) {
    syncPendingTransactions();
  }

  // Low stock alert based on local stock.
  if (s.stock <= lowStockThreshold) {
    String msg =
      "Slot " + s.slotCode + " (" + s.productName + ") low stock: " +
      String(s.stock) + " left";

    if (WiFi.status() == WL_CONNECTED) {
      httpLogMachineAlert(s.stock == 0 ? "critical" : "warning", msg);
      httpPostNotification(
        "stock",
        s.stock == 0 ? "critical" : "warning",
        msg
      );
    }

    if (s.stock <= 2) {
      gsmSendSMS(adminSmsNumber, "4Peace: " + msg);
    }
  }

  updateLcd("Item Dispatched", "Please Take Item");
  beepBuzzer(2, 90);
  delay(1500);

  // Reset only session selection/payment buffer.
  selectedSlotIndex = -1;
  gcashRefBuffer = "";

  // Remaining coin credit is intentionally retained.
  currentState = (currentCredit > 0.0f)
                   ? STATE_COIN_PAYMENT
                   : STATE_IDLE;

  stateTimer = millis();

  return true;
}

// ============================================================================

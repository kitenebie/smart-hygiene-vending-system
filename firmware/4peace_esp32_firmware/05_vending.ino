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

String makeSmsEventId() {
  char buffer[72];
  uint32_t rnd = esp_random();

  snprintf(
    buffer,
    sizeof(buffer),
    "%s-SMS-%08lX-%08lX",
    MACHINE_ID,
    (unsigned long)millis(),
    (unsigned long)rnd
  );

  return String(buffer);
}

int requiredSmsOutboxSlotsForVend(int slotIdx) {
  if (slotIdx < 0 || slotIdx >= 5) return 2;

  // Every completed vend creates payment + dispensed_product. Reserve a third
  // row when that same vend will reach the low-stock threshold.
  return 2 + ((slots[slotIdx].stock - 1 <= lowStockThreshold) ? 1 : 0);
}

bool executeDispense(int slotIdx, const String &method, const String &refCode) {
  if (slotIdx < 0 || slotIdx >= 5) return false;

  SlotItem &s = slots[slotIdx];
  Serial.printf("[VEND] Request: slot=%s method=%s stock=%d credit=P%.2f\n",
                s.slotCode.c_str(), method.c_str(), s.stock, currentCredit);

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

  // A completed vend produces payment + dispensed-product SMS events and can
  // also produce a low-stock SMS.
  // Reserve local durable outbox capacity before running the motor so neither
  // event can be lost when Wi-Fi is unavailable.
  if (!smsOutboxHasSpace(requiredSmsOutboxSlotsForVend(slotIdx))) {
    updateLcd("SMS Queue Full", "Service Locked");
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
    delay(10); // Let the ESP32 output latch before reading it back for diagnostics.
    int relayActiveLevel = digitalRead(s.relayPin);
    Serial.printf("[RELAY] %s GPIO%d command=%s readback=%s (%s)\n",
                  s.slotCode.c_str(), s.relayPin,
                  RELAY_ACTIVE_LEVEL == LOW ? "LOW/ON" : "HIGH/ON",
                  relayActiveLevel == LOW ? "LOW" : "HIGH",
                  relayActiveLevel == RELAY_ACTIVE_LEVEL ? "COMMAND OK" : "COMMAND MISMATCH");
    Serial.printf("[MOTOR] %s ON (GPIO%d)\n", s.slotCode.c_str(), s.relayPin);

    dropConfirmed = waitForNewIrDrop(s.irPin, DISPENSE_TIMEOUT_MS);

    digitalWrite(s.relayPin, RELAY_INACTIVE_LEVEL);
    delay(10);
    int relayInactiveLevel = digitalRead(s.relayPin);
    Serial.printf("[RELAY] %s GPIO%d command=%s readback=%s (%s)\n",
                  s.slotCode.c_str(), s.relayPin,
                  RELAY_INACTIVE_LEVEL == LOW ? "LOW/OFF" : "HIGH/OFF",
                  relayInactiveLevel == LOW ? "LOW" : "HIGH",
                  relayInactiveLevel == RELAY_INACTIVE_LEVEL ? "COMMAND OK" : "COMMAND MISMATCH");
    Serial.printf("[MOTOR] %s OFF | IR drop=%s\n", s.slotCode.c_str(),
                  dropConfirmed ? "CONFIRMED" : "NOT DETECTED");

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
    Serial.printf("[VEND] FAILED: %s had no confirmed product drop; payment retained.\n",
                  s.slotCode.c_str());
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
  Serial.printf("[VEND] SUCCESS: %s dispensed; local stock=%d; credit=P%.2f\n",
                s.slotCode.c_str(), s.stock, currentCredit);

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

  String paymentMessage =
    "4Peace: Payment received P" + String(unitPrice, 2) +
    " via " + method + " for " + s.slotCode;
  String dispenseMessage =
    "4Peace: Dispensed " + s.productName +
    " (" + s.slotCode + "). Stock left: " + String(s.stock);

  queueSmsEvent("payment", paymentMessage);
  queueSmsEvent("dispensed_product", dispenseMessage);

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

    queueSmsEvent("low_stock", "4Peace: " + msg);
  }

  // Keep the completion confirmation visible for five seconds before the
  // keypad can accept the next payment or slot-selection task. The LCD has
  // only 16 columns, so the full success message is presented in two screens.
  Serial.printf("[VEND] Displaying success confirmation for %s (5 seconds).\n",
                s.productName.c_str());
  updateLcd(s.productName, "Dispensed");
  beepBuzzer(2, 90);
  delay(2500);
  updateLcd("Successfully!", "Please Take Item");
  delay(2500);

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

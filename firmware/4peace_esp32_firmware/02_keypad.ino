// Arduino IDE tab: 02_keypad.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// Keypad
// ============================================================================

char scanKeypadRaw() {
  // keyMap[row][col] — rows are the physical horizontal lines (active-low
  // drive) and columns are the physical vertical lines (read back).
  // NOTE: The PCF8574 wiring on this board is COLUMNS on P0-P3 (output)
  // and ROWS on P4-P7 (read back), so we drive columns and read rows.
  // The keyMap is transposed to match: keyMap[row_read][col_driven].
  const char keyMap[4][4] = {
    {'1', '4', '7', '*'},
    {'2', '5', '8', '0'},
    {'3', '6', '9', '#'},
    {'A', 'B', 'C', 'D'}
  };

  for (byte c = 0; c < 4; c++) {
    byte writeByte = 0xFF;
    bitClear(writeByte, c); // selected column LOW, everything else HIGH

    Wire.beginTransmission(PCF8574_I2C_ADDR);
    Wire.write(writeByte);
    if (Wire.endTransmission() != 0) {
      return '\0';
    }

    Wire.requestFrom(PCF8574_I2C_ADDR, 1);
    if (!Wire.available()) continue;

    byte readByte = Wire.read();

    for (byte r = 0; r < 4; r++) {
      if ((readByte & (1 << (r + 4))) == 0) {
        return keyMap[r][c];
      }
    }
  }

  return '\0';
}

char scanKeypadPCF8574() {
  static char lastRaw = '\0';
  static unsigned long changedAt = 0;
  static bool delivered = false;

  char raw = scanKeypadRaw();

  if (raw != lastRaw) {
    lastRaw = raw;
    changedAt = millis();

    if (raw == '\0') {
      delivered = false;
    }
    return '\0';
  }

  if (raw == '\0') {
    delivered = false;
    return '\0';
  }

  if (!delivered && millis() - changedAt >= KEYPAD_DEBOUNCE_MS) {
    delivered = true;
    return raw;
  }

  return '\0';
}

// Keep the real reference for payment verification, but show only a safe
// preview anywhere a user, Serial Monitor, or cloud log can see it.
String maskGcashReference(const String &reference) {
  const size_t length = reference.length();
  size_t hiddenLength = 0;
  if (length <= 2) hiddenLength = length;
  else if (length <= 6) hiddenLength = length - 2;
  else hiddenLength = length - 6;

  String hidden = "";
  for (size_t i = 0; i < hiddenLength; i++) hidden += '*';

  if (length <= 2) return hidden;
  if (length <= 6) {
    return reference.substring(0, 1) + hidden + reference.substring(length - 1);
  }
  return reference.substring(0, 3) + hidden + reference.substring(length - 3);
}

void handleKeypress(char key) {
  const bool hideGcashDigit =
    currentState == STATE_GCASH_INPUT && key >= '0' && key <= '9';

  // Do not print individual GCash-reference digits to keep payment details
  // out of the serial log. The length still confirms keypad input is working.
  if (hideGcashDigit) {
    unsigned int nextLength = (unsigned int)gcashRefBuffer.length();
    if (nextLength < 16) nextLength++;
    Serial.printf("[KEYPAD] GCash reference digit received (length will be %u)\n", nextLength);
  } else {
    Serial.printf("[KEYPAD] Key '%c' in %s\n", key, machineStateName(currentState));
  }

  beepBuzzer(1, 35);
  showKeypressFeedback(key, hideGcashDigit);

  // ----------------------------------------------------------
  // IDLE
  // ----------------------------------------------------------
  if (currentState == STATE_IDLE) {
    if (key >= '1' && key <= '5') {
      selectedSlotIndex = key - '1';
      SlotItem &s = slots[selectedSlotIndex];
      Serial.printf("[SELECT] %s (%s), stock=%d, price=P%.2f\n",
                    s.slotCode.c_str(), s.productName.c_str(), s.stock, unitPrice);
      logEsp32Event("product_selected", s.slotCode + " - " + s.productName +
                    "; stock " + String(s.stock) + "; price P" + String(unitPrice, 2));

      if (s.stock <= 0) {
        updateLcd(s.slotCode + " Out of Stock", "Choose Another");
        beepBuzzer(3, 80);
        delay(1000);
        selectedSlotIndex = -1;
        return;
      }

      if (!pendingQueueHasSpace()) {
        updateLcd("Service Busy", "Sync Required");
        beepBuzzer(3, 100);
        selectedSlotIndex = -1;
        return;
      }

      if (!smsOutboxHasSpace(requiredSmsOutboxSlotsForVend(selectedSlotIndex))) {
        updateLcd("SMS Queue Full", "Sync Required");
        beepBuzzer(3, 100);
        selectedSlotIndex = -1;
        return;
      }

      // Coin-first flow: if enough credit already exists, dispense immediately.
      if (currentCredit >= unitPrice) {
        currentState = STATE_COIN_PAYMENT;
        stateTimer = millis();
        updateLcd("Dispensing...", s.productName);
        Serial.printf("[COIN] Credit P%.2f is enough for %s; starting dispense now.\n",
                      currentCredit, s.slotCode.c_str());
        executeDispense(selectedSlotIndex, "coin", "");
        return;
      }

      currentState = STATE_SLOT_SELECTED;
      stateTimer = millis();

      if (currentCredit > 0.0f) {
        updateLcd("Not Enough", "Need P" + String(unitPrice - currentCredit, 0));
        Serial.printf("[COIN] Not enough credits for %s: credit=P%.2f, need=P%.2f more.\n",
                      s.slotCode.c_str(), currentCredit, unitPrice - currentCredit);
      } else {
        updateLcd(s.slotCode + " P" + String(unitPrice, 0),
                  "B:GCash C:Coin");
      }

      return;
    }

    // B = GCash payment mode (select slot after)
    if (key == 'B') {
      if (currentCredit > 0.0f) {
        updateLcd("Coin Credit Active", "Use Coin Payment");
        return;
      }
      if (WiFi.status() != WL_CONNECTED) {
        updateLcd("GCash Offline", "Use Coins");
        beepBuzzer(2, 120);
        return;
      }
      currentState = STATE_GCASH_INPUT;
      selectedSlotIndex = -1;
      gcashRefBuffer = "";
      stateTimer = millis();
      updateLcd("Select Slot 1-5", "Then Enter Ref");
      Serial.println("[KEYPAD] GCash mode selected from IDLE; awaiting slot.");
      return;
    }

    // C = Coin payment mode (select slot after)
    if (key == 'C') {
      currentState = STATE_COIN_PAYMENT;
      selectedSlotIndex = -1;
      stateTimer = millis();
      updateLcd("Coin Mode", "Select Slot 1-5");
      Serial.println("[KEYPAD] Coin mode selected from IDLE; awaiting slot.");
      return;
    }
  }

  // ----------------------------------------------------------
  // SLOT SELECTED
  // ----------------------------------------------------------
  if (currentState == STATE_SLOT_SELECTED) {
    if (key == 'B') {
      if (currentCredit > 0.0f) {
        updateLcd("Coin Credit Active", "Use Coin Payment");
        return;
      }

      if (WiFi.status() != WL_CONNECTED) {
        updateLcd("GCash Offline", "Use Coins");
        beepBuzzer(2, 120);
        return;
      }

      currentState = STATE_GCASH_INPUT;
      Serial.printf("[GCASH] Reference entry started for %s, amount=P%.2f\n",
                    slots[selectedSlotIndex].slotCode.c_str(), unitPrice);
      gcashRefBuffer = "";
      stateTimer = millis();
      updateLcd("Enter GCash Ref", "#Done *=Delete");
      return;
    }

    if (key == 'C') {
      currentState = STATE_COIN_PAYMENT;
      stateTimer = millis();

      if (currentCredit >= unitPrice) {
        updateLcd("Dispensing...", slots[selectedSlotIndex].productName);
      } else {
        updateLcd("Not Enough", "Need P" + String(unitPrice - currentCredit, 0));
      }
      return;
    }

    if (key == 'A') {
      // Credit is intentionally retained because physical coins cannot be refunded.
      selectedSlotIndex = -1;
      currentState = STATE_IDLE;
      stateTimer = millis();
      updateLcd("Selection Cancel", "Credit Retained");
      delay(700);
      return;
    }
  }

  // ----------------------------------------------------------
  // COIN PAYMENT
  // User may insert coins first, then select slot.
  // ----------------------------------------------------------
  if (currentState == STATE_COIN_PAYMENT) {
    if (selectedSlotIndex < 0 && key >= '1' && key <= '5') {
      selectedSlotIndex = key - '1';
      SlotItem &s = slots[selectedSlotIndex];
      Serial.printf("[COIN] Selected %s (%s): credit=P%.2f, price=P%.2f\n",
                    s.slotCode.c_str(), s.productName.c_str(), currentCredit, unitPrice);
      logEsp32Event("product_selected", s.slotCode + " - " + s.productName +
                    "; coin credit P" + String(currentCredit, 2));

      if (s.stock <= 0) {
        updateLcd(s.slotCode + " Out of Stock", "Choose Another");
        beepBuzzer(3, 80);
        selectedSlotIndex = -1;
      } else if (!pendingQueueHasSpace()) {
        updateLcd("Service Busy", "Sync Required");
        selectedSlotIndex = -1;
      } else if (!smsOutboxHasSpace(requiredSmsOutboxSlotsForVend(selectedSlotIndex))) {
        updateLcd("SMS Queue Full", "Sync Required");
        selectedSlotIndex = -1;
      } else if (currentCredit < unitPrice) {
        updateLcd("Not Enough", "Need P" + String(unitPrice - currentCredit, 0));
        Serial.printf("[COIN] Not enough credits for %s: credit=P%.2f, need=P%.2f more.\n",
                      s.slotCode.c_str(), currentCredit, unitPrice - currentCredit);
        logEsp32Event("coin", "Not enough credit for " + s.slotCode + "; need P" +
                      String(unitPrice - currentCredit, 2), "warning");
      } else {
        // Start immediately after slot selection. This avoids relying on a
        // later loop pass and makes the coin-first flow deterministic.
        updateLcd("Dispensing...", s.productName);
        Serial.printf("[COIN] Credit complete; dispensing %s now.\n", s.slotCode.c_str());
        logEsp32Event("dispense", "Credit complete; starting " + s.slotCode + " - " + s.productName);
        executeDispense(selectedSlotIndex, "coin", "");
      }
      return;
    }

    if (key == 'A') {
      selectedSlotIndex = -1;
      currentState = STATE_IDLE;
      stateTimer = millis();
      updateLcd("Selection Cancel", "Credit Retained");
      delay(700);
      return;
    }
  }

  // ----------------------------------------------------------
  // GCASH REFERENCE INPUT
  // ----------------------------------------------------------
  if (currentState == STATE_GCASH_INPUT) {
    // If slot not yet selected (came from IDLE via 'B'), allow 1-5 to pick slot
    if (selectedSlotIndex < 0 && key >= '1' && key <= '5') {
      selectedSlotIndex = key - '1';
      SlotItem &s = slots[selectedSlotIndex];
      Serial.printf("[GCASH] Selected %s (%s), stock=%d\n",
                    s.slotCode.c_str(), s.productName.c_str(), s.stock);
      logEsp32Event("product_selected", s.slotCode + " - " + s.productName +
                    "; GCash; stock " + String(s.stock));

      if (s.stock <= 0) {
        updateLcd(s.slotCode + " Out of Stock", "Choose Another");
        beepBuzzer(3, 80);
        selectedSlotIndex = -1;
        return;
      }

      if (!pendingQueueHasSpace()) {
        updateLcd("Service Busy", "Sync Required");
        beepBuzzer(3, 100);
        selectedSlotIndex = -1;
        return;
      }

      if (!smsOutboxHasSpace(requiredSmsOutboxSlotsForVend(selectedSlotIndex))) {
        updateLcd("SMS Queue Full", "Sync Required");
        beepBuzzer(3, 100);
        selectedSlotIndex = -1;
        return;
      }

      gcashRefBuffer = "";
      stateTimer = millis();
      updateLcd("Enter GCash Ref", "#Done *=Delete");
      Serial.printf("[GCASH] Reference entry started for %s, amount=P%.2f\n",
                    s.slotCode.c_str(), unitPrice);
      return;
    }

    if (key >= '0' && key <= '9') {
      if (selectedSlotIndex < 0) {
        updateLcd("Select Slot 1-5", "First");
        beepBuzzer(2, 80);
        return;
      }
      if (gcashRefBuffer.length() < 16) {
        gcashRefBuffer += key;
      }
      updateLcd("GCash Reference", maskGcashReference(gcashRefBuffer));
      stateTimer = millis();
      return;
    }

    if (key == '*') {
      if (gcashRefBuffer.length() > 0) {
        gcashRefBuffer.remove(gcashRefBuffer.length() - 1);
      }
      updateLcd("GCash Reference", maskGcashReference(gcashRefBuffer));
      stateTimer = millis();
      return;
    }

    if (key == '#') {
      if (selectedSlotIndex < 0) {
        updateLcd("Select Slot 1-5", "First");
        beepBuzzer(2, 80);
        return;
      }
      if (gcashRefBuffer.length() < 4) {
        updateLcd("Invalid Ref", "Min 4 Digits");
        beepBuzzer(2, 100);
        return;
      }

      if (WiFi.status() != WL_CONNECTED) {
        updateLcd("Network Offline", "GCash Unavail");
        return;
      }

      updateLcd("Submitting Ref", maskGcashReference(gcashRefBuffer));

      int code = httpSubmitGcashPayment(
        gcashRefBuffer,
        slots[selectedSlotIndex].id,
        unitPrice
      );

      if (code == 200 || code == 201) {
        Serial.printf("[GCASH] Reference submitted successfully (HTTP %d); awaiting approval.\n", code);
        currentState = STATE_GCASH_WAITING;
        stateTimer = millis();
        gcashPollTimer = 0;
        return;
      }

      if (code == 409) {
        Serial.println("[GCASH] Duplicate reference received; checking its existing status.");
        // Existing reference. Resume only if still pending/approved.
        String existing = httpCheckGcashStatus(gcashRefBuffer);

        if (existing == "pending" || existing == "approved") {
          currentState = STATE_GCASH_WAITING;
          stateTimer = millis();
          gcashPollTimer = 0;
          return;
        }

        if (existing == "consumed") {
          updateLcd("Ref Already Used", "Enter New Ref");
        } else {
          updateLcd("Duplicate Ref", "Check Payment");
        }

        beepBuzzer(3, 100);
        return;
      }

      updateLcd("Submit Failed", "Check Internet");
      Serial.printf("[GCASH] Reference submission failed (HTTP %d).\n", code);
      beepBuzzer(3, 100);
      return;
    }

    if (key == 'A') {
      gcashRefBuffer = "";
      selectedSlotIndex = -1;
      currentState = STATE_IDLE;
      stateTimer = millis();
      updateLcd("GCash Cancelled", "");
      delay(700);
      return;
    }
  }
}

// ============================================================================

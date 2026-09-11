// Arduino IDE tab: 02_keypad.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// Keypad
// ============================================================================

char scanKeypadRaw() {
  const char keyMap[4][4] = {
    {'1', '2', '3', 'A'},
    {'4', '5', '6', 'B'},
    {'7', '8', '9', 'C'},
    {'*', '0', '#', 'D'}
  };

  for (byte r = 0; r < 4; r++) {
    byte writeByte = 0xFF;
    bitClear(writeByte, r); // selected row LOW, everything else HIGH

    Wire.beginTransmission(PCF8574_I2C_ADDR);
    Wire.write(writeByte);
    if (Wire.endTransmission() != 0) {
      return '\0';
    }

    Wire.requestFrom(PCF8574_I2C_ADDR, 1);
    if (!Wire.available()) continue;

    byte readByte = Wire.read();

    for (byte c = 0; c < 4; c++) {
      if ((readByte & (1 << (c + 4))) == 0) {
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

void handleKeypress(char key) {
  beepBuzzer(1, 35);

  // ----------------------------------------------------------
  // IDLE
  // ----------------------------------------------------------
  if (currentState == STATE_IDLE) {
    if (key >= '1' && key <= '5') {
      selectedSlotIndex = key - '1';
      SlotItem &s = slots[selectedSlotIndex];

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
        return;
      }

      currentState = STATE_SLOT_SELECTED;
      stateTimer = millis();

      if (currentCredit > 0.0f) {
        updateLcd(s.slotCode + " P" + String(unitPrice, 0),
                  "Need P" + String(unitPrice - currentCredit, 0));
      } else {
        updateLcd(s.slotCode + " P" + String(unitPrice, 0),
                  "B:GCash C:Coin");
      }

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
      gcashRefBuffer = "";
      stateTimer = millis();
      updateLcd("Enter GCash Ref", "#Done *=Delete");
      return;
    }

    if (key == 'C') {
      currentState = STATE_COIN_PAYMENT;
      stateTimer = millis();

      if (currentCredit >= unitPrice) {
        updateLcd("Credit Complete", "Dispensing...");
      } else {
        updateLcd("Price P" + String(unitPrice, 0),
                  "Credit P" + String(currentCredit, 0));
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
    if (key >= '0' && key <= '9') {
      if (gcashRefBuffer.length() < 16) {
        gcashRefBuffer += key;
      }
      updateLcd("Ref:" + gcashRefBuffer, "#Done *=Delete");
      stateTimer = millis();
      return;
    }

    if (key == '*') {
      if (gcashRefBuffer.length() > 0) {
        gcashRefBuffer.remove(gcashRefBuffer.length() - 1);
      }
      updateLcd("Ref:" + gcashRefBuffer, "#Done *=Delete");
      stateTimer = millis();
      return;
    }

    if (key == '#') {
      if (gcashRefBuffer.length() < 4) {
        updateLcd("Invalid Ref", "Min 4 Digits");
        beepBuzzer(2, 100);
        return;
      }

      if (WiFi.status() != WL_CONNECTED) {
        updateLcd("Network Offline", "GCash Unavail");
        return;
      }

      updateLcd("Submitting Ref", gcashRefBuffer);

      int code = httpSubmitGcashPayment(
        gcashRefBuffer,
        slots[selectedSlotIndex].id,
        unitPrice
      );

      if (code == 200 || code == 201) {
        currentState = STATE_GCASH_WAITING;
        stateTimer = millis();
        gcashPollTimer = 0;
        return;
      }

      if (code == 409) {
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

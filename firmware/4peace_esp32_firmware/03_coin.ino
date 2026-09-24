// Arduino IDE tab: 03_coin.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// Coin processing
// ============================================================================

float decodeCoinValue(uint32_t pulses) {
  if (pulses == COIN_PULSES_P1)  return 1.00f;
  if (pulses == COIN_PULSES_P5)  return 5.00f;
  if (pulses == COIN_PULSES_P10) return 10.00f;

  // Invalid/noisy pulse train: never convert arbitrary pulses into money.
  return 0.00f;
}

void handleCoinProcessing() {
  uint32_t pulses = 0;
  uint32_t lastMs = 0;

  portENTER_CRITICAL(&coinMux);
  pulses = coinPulseCount;
  lastMs = lastCoinPulseMs;
  portEXIT_CRITICAL(&coinMux);

  if (pulses == 0) return;
  if (millis() - lastMs < COIN_PULSE_TIMEOUT_MS) return;

  portENTER_CRITICAL(&coinMux);
  pulses = coinPulseCount;
  coinPulseCount = 0;
  portEXIT_CRITICAL(&coinMux);

  float coinValue = decodeCoinValue(pulses);

  if (coinValue <= 0.0f) {
    Serial.printf("[COIN] Rejected invalid pulse train: %lu pulses\n",
                  (unsigned long)pulses);
    logEsp32Event("coin", "Rejected invalid pulse train: " + String((unsigned long)pulses) + " pulses", "warning");
    updateLcd("Coin Read Error", "Try Again");
    beepBuzzer(3, 60);
    return;
  }

  currentCredit += coinValue;
  if (!persistCurrentCredit()) {
    Serial.println("[FATAL] Coin credit could not be saved to NVS.");
    logEsp32Event("persistence", "Coin credit could not be saved", "error");
  }
  sessionCoinPulses += pulses;
  totalCoinBoxPulses += pulses;
  prefs.putULong("coinTotal", totalCoinBoxPulses);

  Serial.printf("[COIN] %lu pulses -> P%.2f | Credit P%.2f\n",
                (unsigned long)pulses, coinValue, currentCredit);
  logEsp32Event("coin", String((unsigned long)pulses) + " pulses -> P" +
                String(coinValue, 2) + "; credit P" + String(currentCredit, 2));

  beepBuzzer(1, 60);

  // Coin-first workflow
  if (currentState == STATE_IDLE) {
    currentState = STATE_COIN_PAYMENT;
    selectedSlotIndex = -1;
    stateTimer = millis();
    updateLcd("Credit P" + String(currentCredit, 0), "Select Slot 1-5");
    return;
  }

  if (currentState == STATE_SLOT_SELECTED) {
    currentState = STATE_COIN_PAYMENT;
    stateTimer = millis();
  }

  if (currentState == STATE_COIN_PAYMENT) {
    if (selectedSlotIndex >= 0) {
      float remaining = unitPrice - currentCredit;
      if (remaining <= 0) {
        updateLcd("Credit Complete", "Dispensing...");
      } else {
        updateLcd("Credit P" + String(currentCredit, 0),
                  "Need P" + String(remaining, 0));
      }
    } else {
      updateLcd("Credit P" + String(currentCredit, 0), "Select Slot 1-5");
    }
  }

  // If a user inserts a coin during a GCash flow, the credit is still retained
  // rather than silently lost. It will be available on the next coin purchase.
}

// ============================================================================

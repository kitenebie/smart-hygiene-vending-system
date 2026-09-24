// Arduino IDE tab: 04_tamper.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// Tamper
// ============================================================================

void handleTamperCheck() {
  static unsigned long windowStart = 0;

  uint32_t edges = 0;

  portENTER_CRITICAL(&tamperMux);
  edges = tamperEdgeCount;
  portEXIT_CRITICAL(&tamperMux);

  if (edges == 0) {
    windowStart = 0;
    return;
  }

  if (windowStart == 0) {
    windowStart = millis();
  }

  if (millis() - windowStart > TAMPER_WINDOW_MS) {
    portENTER_CRITICAL(&tamperMux);
    tamperEdgeCount = 0;
    portEXIT_CRITICAL(&tamperMux);

    windowStart = 0;
    return;
  }

  if (edges < TAMPER_REQUIRED_EDGES || !tamperAlarmEnabled) {
    return;
  }

  portENTER_CRITICAL(&tamperMux);
  tamperEdgeCount = 0;
  portEXIT_CRITICAL(&tamperMux);
  windowStart = 0;

  // A zero timestamp means no alert has ever been sent. Without this guard,
  // every real tamper event during the first cooldown period after boot is lost.
  if (lastTamperAlertTime != 0 &&
      millis() - lastTamperAlertTime < TAMPER_ALERT_COOLDOWN_MS) {
    return;
  }

  lastTamperAlertTime = millis();

  Serial.println("[ALERT] Tamper vibration threshold reached.");

  for (int i = 0; i < 4; i++) {
    beepBuzzer(1, 120);
    delay(80);
  }

  if (WiFi.status() == WL_CONNECTED) {
    httpLogMachineAlert(
      "critical",
      String("Tamper vibration detected on ") + MACHINE_ID
    );

    httpPostNotification(
      "tamper",
      "critical",
      String("Tamper alarm activated on ") + MACHINE_ID
    );
  }

  queueSmsEvent(
    "theft_alert",
    String("4Peace ALERT: Tamper/vibration detected on ") + MACHINE_ID
  );
}

// ============================================================================

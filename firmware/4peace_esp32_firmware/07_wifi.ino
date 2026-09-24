// Arduino IDE tab: 07_wifi.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// Wi-Fi
// ============================================================================

void handleWiFiReconnect() {
  static bool initialized = false;
  static bool wasConnected = false;
  static bool recoverySyncPending = false;

  const bool connected = WiFi.status() == WL_CONNECTED;
  if (!initialized) {
    initialized = true;
    wasConnected = connected;
  }

  if (connected) {
    if (!wasConnected) {
      Serial.print("[WiFi] Reconnected: ");
      Serial.println(WiFi.localIP());
      logEsp32Event("wifi", "Reconnected to Wi-Fi; IP " + WiFi.localIP().toString());
      recoverySyncPending = true;
    }
    wasConnected = true;

    // Queue replay can involve many HTTPS calls. Run it only when no customer
    // interaction is active, never inside the reconnect attempt itself.
    if (recoverySyncPending && currentState == STATE_IDLE && !motorActive) {
      syncPendingTransactions();
      syncPendingSmsOutbox();

      if (!hasPendingTransactions()) {
        httpFetchConfig();
        httpFetchSlots();
      }
      recoverySyncPending = false;
    }
    return;
  }

  wasConnected = false;

  if (millis() - lastWiFiRetryTime < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  lastWiFiRetryTime = millis();

  Serial.println("[WiFi] Reconnect attempt...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  // Connection completion is observed on later loop iterations. Do not block
  // keypad scanning or payment state handling while the radio reconnects.
}

// ============================================================================

// Arduino IDE tab: 07_wifi.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// Wi-Fi
// ============================================================================

void handleWiFiReconnect() {
  if (WiFi.status() == WL_CONNECTED) return;

  if (millis() - lastWiFiRetryTime < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  lastWiFiRetryTime = millis();

  Serial.println("[WiFi] Reconnect attempt...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - started < 2500UL) {
    delay(100);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] Reconnected: ");
    Serial.println(WiFi.localIP());

    syncPendingTransactions();

    // Only fetch cloud stock after replaying offline transactions.
    bool anyPending = false;
    for (int i = 0; i < PENDING_QUEUE_MAX; i++) {
      char keyName[8];
      snprintf(keyName, sizeof(keyName), "tx%02d", i);
      if (prefs.getString(keyName, "").length() > 0) {
        anyPending = true;
        break;
      }
    }

    if (!anyPending) {
      httpFetchConfig();
      httpFetchSlots();
    }
  }
}

// ============================================================================

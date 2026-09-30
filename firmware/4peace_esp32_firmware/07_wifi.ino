// Arduino IDE tab: 07_wifi.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// Wi-Fi
// ============================================================================

enum InitialLittleFsSyncStep {
  INITIAL_SYNC_CONFIG,
  INITIAL_SYNC_SLOTS
};

static InitialLittleFsSyncStep initialLittleFsSyncStep = INITIAL_SYNC_CONFIG;

// Startup is deliberately sequential: each required cloud record is fetched,
// validated, written to LittleFS, acknowledged on the LCD for 2.5 seconds,
// then the next record begins. No default/server-dependent vending is enabled
// until both files are present.
void serviceInitialLittleFsSync() {
  if (!filesystemMounted) {
    updateLcd("LittleFS Error", "Service Locked");
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (localDataReady) {
      updateLcd("WiFi Offline", "Cached Local Mode");
      currentState = STATE_IDLE;
      stateTimer = millis();
    } else {
      updateLcd("No Local Data", "Waiting WiFi");
    }
    return;
  }

  if (initialLittleFsSyncStep == INITIAL_SYNC_CONFIG) {
    updateLcd("Config Fetching", "Please Wait");
    if (!httpFetchConfig()) {
      updateLcd("Config Fetch Fail", "Retrying...");
      delay(1000);
      return;
    }

    updateLcd("Config Saved", "Successfully");
    delay(2500);
    initialLittleFsSyncStep = INITIAL_SYNC_SLOTS;
    return;
  }

  // Offline sales are the only locally changed database data. Upload them
  // before accepting a new cloud inventory snapshot, otherwise a server read
  // could overwrite stock that has already physically dispensed.
  if (hasPendingTransactions()) {
    updateLcd("Sales Updating", "Please Wait");
    syncPendingTransactions();
    if (hasPendingTransactions()) {
      delay(1000);
      return;
    }
  }

  updateLcd("Slots Fetching", "Please Wait");
  if (!httpFetchSlots()) {
    updateLcd("Slots Fetch Fail", "Retrying...");
    delay(1000);
    return;
  }

  updateLcd("Slots Saved", "Successfully");
  delay(2500);
  localDataReady = true;
  lastLocalDataSyncTime = millis();
  currentState = STATE_IDLE;
  stateTimer = millis();
  Serial.println("[LittleFS] Initial offline snapshot ready.");
}

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
        const bool configSaved = httpFetchConfig();
        const bool slotsSaved = configSaved && httpFetchSlots();
        if (configSaved && slotsSaved) {
          localDataReady = true;
          lastLocalDataSyncTime = millis();
        }
      }
      recoverySyncPending = hasPendingTransactions();
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

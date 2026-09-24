/**
 * ============================================================================
 * 4Peace — IoT-Based Smart Feminine Hygiene Access System
 * FULL FIXED ESP32 FIRMWARE
 * ============================================================================
 *
 * Fixes included:
 *  - Safer ESP32 GPIO allocation (see config.h)
 *  - No INPUT_PULLUP on GPIO34/35
 *  - Persistent local stock using Preferences/NVS
 *  - Persistent offline transaction journal
 *  - Automatic Wi-Fi reconnect + pending transaction replay
 *  - Server stock refresh from Supabase slots table
 *  - Atomic sale + stock decrement using complete_vend() Supabase RPC
 *  - Idempotent device transaction IDs
 *  - GCash submit result validation and duplicate/resume handling
 *  - GCash "consumed" protection
 *  - Coin credit is never silently erased on timeout/cancel
 *  - Invalid coin pulse trains are rejected
 *  - IR must be clear before motor starts, then a NEW beam break confirms drop
 *  - Bounded dispense retry
 *  - Tamper events must occur inside a real time window
 *  - Tamper ignored while motor is running
 *  - Better keypad key-release debounce
 *  - Better SIM800L command/response handling
 *  - No fake voltage or GSM readings
 *
 * Required libraries:
 *  - LiquidCrystal_I2C
 *  - ArduinoJson 6.x
 *
 * IMPORTANT HARDWARE NOTES:
 *  1) Coin acceptor signal must be 3.3V-safe (use optocoupler/level shifter/divider
 *     if the acceptor outputs a higher voltage).
 *  2) SIM800L needs its own ~4.0-4.2V supply capable of high current bursts.
 *  3) Use a 3.3V-compatible relay input stage / opto-isolated relay board.
 *  4) IR sensor digital outputs must be 3.3V-safe.
 *  5) All low-voltage control modules must share a common ground.
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_system.h>
#include <esp_heap_caps.h>
#include <LittleFS.h>
#include "config.h"
#include "supabase_ca.h"
#include <time.h>

// ============================================================================
// Types
// ============================================================================

enum MachineState {
  STATE_BOOT,
  STATE_SYNC_CONFIG,
  STATE_IDLE,
  STATE_SLOT_SELECTED,
  STATE_COIN_PAYMENT,
  STATE_GCASH_INPUT,
  STATE_GCASH_WAITING,
  STATE_DISPENSING,
  STATE_SUCCESS,
  STATE_ERROR
};

struct SlotItem {
  int id;
  String slotCode;
  String productName;
  int stock;
  int capacity;
  int relayPin;
  int irPin;
};

struct PendingTx {
  String txId;
  String refCode;
  String method;
  int slotId;
  float amount;
  bool completed;
};

struct DeviceResourceSnapshot {
  uint32_t internalSramTotalBytes;
  uint32_t internalSramFreeBytes;
  uint32_t externalPsramTotalBytes;
  uint32_t externalPsramFreeBytes;
  uint32_t externalFlashTotalBytes;
  uint32_t externalFlashUsedBytes;
  uint32_t filesystemTotalBytes;
  uint32_t filesystemUsedBytes;
  uint32_t romTotalBytes;
  float cpuTemperatureC;
};

// A locally-persisted event that must reach the Supabase SMS outbox before
// the SIM800L is ever allowed to send it. clientEventId makes upload retries
// idempotent when the ESP32 loses the HTTP response after a successful POST.
struct SmsEvent {
  String clientEventId;
  String eventType;
  String recipient;
  String message;
};

// ============================================================================
// Hardware instances
// ============================================================================

LiquidCrystal_I2C lcd(LCD_I2C_ADDR, 16, 2);
HardwareSerial SerialGSM(2);
Preferences prefs;

// ============================================================================
// Slot map
// Server data overwrites product/stock/capacity after sync.
// ============================================================================

SlotItem slots[5] = {
  {1, "S1", "Regular Pad", 0, 30, RELAY_S1_PIN, IR_S1_PIN},
  {2, "S2", "Overnight",   0, 30, RELAY_S2_PIN, IR_S2_PIN},
  {3, "S3", "Tampon",      0, 30, RELAY_S3_PIN, IR_S3_PIN},
  {4, "S4", "Panty Liner", 0, 30, RELAY_S4_PIN, IR_S4_PIN},
  {5, "S5", "Wipes Pack",  0, 30, RELAY_S5_PIN, IR_S5_PIN}
};

// ============================================================================
// Runtime state
// ============================================================================

MachineState currentState = STATE_BOOT;
int selectedSlotIndex = -1;

float unitPrice = 10.00f;
int lowStockThreshold = 5;
String adminSmsNumber = DEFAULT_ADMIN_SMS;
bool tamperAlarmEnabled = true;

float currentCredit = 0.00f;
int sessionCoinPulses = 0;
uint32_t totalCoinBoxPulses = 0;

String gcashRefBuffer = "";

unsigned long stateTimer = 0;
unsigned long gcashPollTimer = 0;
unsigned long lastHealthSyncTime = 0;
unsigned long lastDeviceHeartbeatTime = 0;
unsigned long lastConfigSyncTime = 0;
unsigned long lastPinMonitorControlTime = 0;
unsigned long lastPinDiagnosticTime = 0;
unsigned long lastWiFiRetryTime = 0;
unsigned long lastTamperAlertTime = 0;
unsigned long lastSmsProcessTime = 0;
unsigned long paymentRetryPromptUntil = 0;

int gsmSignalPct = -1;
volatile bool motorActive = false;
bool filesystemMounted = false;
bool pinConnectionDetectionEnabled = false;
bool esp32LogUploadInProgress = false;

// ============================================================================
// Interrupt-shared data
// ============================================================================

portMUX_TYPE coinMux = portMUX_INITIALIZER_UNLOCKED;
volatile uint32_t coinPulseCount = 0;
volatile uint32_t lastCoinPulseMs = 0;

portMUX_TYPE tamperMux = portMUX_INITIALIZER_UNLOCKED;
volatile uint32_t tamperEdgeCount = 0;
volatile uint32_t lastTamperEdgeMs = 0;

// ============================================================================
// Forward declarations
// ============================================================================

// UI
void updateLcd(const String &line1, const String &line2);
void showKeypressFeedback(char key, bool hideKey = false);
void serviceLcdFeedback();
void showIdleScreen();
void beepBuzzer(int count, int durationMs = 80);

// Keypad / state
char scanKeypadPCF8574();
char scanKeypadRaw();
void handleKeypress(char key);
String maskGcashReference(const String &reference);

// Coin / tamper
void handleCoinProcessing();
float decodeCoinValue(uint32_t pulses);
void handleTamperCheck();

// Vending
bool executeDispense(int slotIdx, const String &method, const String &refCode);
bool sensorIsTriggeredStable(int pin, unsigned long stableMs);
bool waitForNewIrDrop(int pin, unsigned long timeoutMs);
String makeTransactionId();
String makeSmsEventId();
int requiredSmsOutboxSlotsForVend(int slotIdx);
void processDeferredDispenseFailureAlert();

// Persistence
void loadPersistentStocks();
bool persistStock(int slotIdx);
bool pendingQueueHasSpace();
bool hasPendingTransactions();
bool enqueuePendingTransaction(const PendingTx &tx);
bool markPendingTransactionCompleted(const String &txId);
bool removePendingTransaction(const String &txId);
void syncPendingTransactions();
bool persistCurrentCredit();
bool smsOutboxHasSpace(int requiredSlots = 1);
bool queueSmsEvent(const String &eventType, const String &message);
void syncPendingSmsOutbox();
bool isSmsDeliveryAwaitingAck(uint32_t smsId);
bool rememberSmsDeliveryAwaitingAck(uint32_t smsId);
void forgetSmsDeliveryAwaitingAck(uint32_t smsId);

// Networking
void handleWiFiReconnect();
bool httpFetchConfig();
bool httpFetchPinMonitoringState();
bool httpFetchSlots();
int httpSubmitGcashPayment(const String &refCode, int slotId, float amount);
String httpCheckGcashStatus(const String &refCode);
bool httpCompleteVend(const PendingTx &tx, int &serverStock);
bool httpSyncDeviceHealth();
bool httpHeartbeatDevice();
DeviceResourceSnapshot readDeviceResourceSnapshot();
bool httpLogMachineAlert(const String &level, const String &message);
bool httpPostNotification(const String &type, const String &level, const String &message);
bool httpQueueSmsEvent(const SmsEvent &event);
void httpProcessPendingSms();
bool httpMarkSmsSent(uint32_t smsId);
bool httpRecordSmsFailure(uint32_t smsId, int nextAttemptCount, const String &error);
bool httpInsertEsp32Log(const String &level, const String &category, const String &message);
void addSupabaseHeaders(HTTPClient &http, bool json = false);
void configureSecureClient(WiFiClientSecure &client);

// GSM
bool gsmInit();
bool gsmCommand(const String &command, const String &expected, unsigned long timeoutMs);
String gsmReadUntil(unsigned long timeoutMs, const String &stopToken = "");
bool gsmSendSMS(const String &recipient, const String &message);
int gsmGetSignalStrength();

// Diagnostics
float readRailVoltage(int adcPin, float dividerRatio);
void runPinConnectionDiagnostics();
void restorePinDiagnosticOutputs();

// Serial monitor helpers
const char *machineStateName(MachineState state);
void logMachineState();
void logEsp32Event(const String &category, const String &message, const String &level = "info");
void processEsp32LogQueue();

// ============================================================================
// ISR
// ============================================================================

void IRAM_ATTR onCoinPulse() {
  uint32_t now = millis();
  portENTER_CRITICAL_ISR(&coinMux);
  coinPulseCount++;
  lastCoinPulseMs = now;
  portEXIT_CRITICAL_ISR(&coinMux);
}

void IRAM_ATTR onTamperVibration() {
  if (motorActive) return;

  uint32_t now = millis();

  portENTER_CRITICAL_ISR(&tamperMux);
  if (now - lastTamperEdgeMs >= TAMPER_EDGE_DEBOUNCE_MS) {
    tamperEdgeCount++;
    lastTamperEdgeMs = now;
  }
  portEXIT_CRITICAL_ISR(&tamperMux);
}

// ============================================================================
// setup()
// ============================================================================

void setup() {
  // Active-low relay inputs must never be allowed to float LOW during startup.
  // Preload the inactive output latch before changing each GPIO to OUTPUT.
  // External pull-ups are still required to cover the reset/power-up interval
  // before this first instruction executes.
  for (int i = 0; i < 5; i++) {
    digitalWrite(slots[i].relayPin, RELAY_INACTIVE_LEVEL);
    pinMode(slots[i].relayPin, OUTPUT);
  }

  Serial.begin(115200);
  delay(200);

  Serial.println();
  Serial.println("===============================================");
  Serial.println("4Peace Vending — FIXED Firmware Starting");
  Serial.println("[SERIAL] Open Serial Monitor at 115200 baud");
  Serial.println("===============================================");

  randomSeed(esp_random());

  // NVS / persistent data
  prefs.begin("4peace", false);

  // Read-only telemetry only. Do not format a missing or invalid filesystem.
  filesystemMounted = LittleFS.begin(false);
  Serial.printf("[LittleFS] %s\n", filesystemMounted ? "mounted" : "unavailable");

  // I2C
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);

  lcd.init();
  lcd.backlight();
  updateLcd("4Peace Vending", "Initializing...");

  // Buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // Coin acceptor
  pinMode(COIN_SIGNAL_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(COIN_SIGNAL_PIN), onCoinPulse, FALLING);

  // Tamper sensor
  pinMode(TAMPER_SENSOR_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(TAMPER_SENSOR_PIN), onTamperVibration, FALLING);

  // Relays are already initialized safely at the start of setup(). Configure IR.
  for (int i = 0; i < 5; i++) {
    digitalWrite(slots[i].relayPin, RELAY_INACTIVE_LEVEL);

    // Plain INPUT intentionally. GPIO34/35 do not support internal pull-up.
    pinMode(slots[i].irPin, INPUT);
    Serial.printf("[HW] %s relay=GPIO%d IR=GPIO%d\n",
                  slots[i].slotCode.c_str(), slots[i].relayPin, slots[i].irPin);
  }

#if ENABLE_VOLTAGE_MONITOR
  analogReadResolution(12);
  analogSetPinAttenuation(BUCK1_ADC_PIN, ADC_11db);
  analogSetPinAttenuation(BUCK2_ADC_PIN, ADC_11db);
#endif

  loadPersistentStocks();

  // GSM initialization is allowed to fail without blocking vending.
  if (!gsmInit()) {
    Serial.println("[GSM] SIM800L not ready yet.");
  }

  // Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);

  updateLcd("Connecting WiFi", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 10000UL) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] Connected: ");
    Serial.println(WiFi.localIP());
    logEsp32Event("wifi", "Connected to Wi-Fi; IP " + WiFi.localIP().toString());

    // Replay offline sales FIRST, then fetch server stock.
    syncPendingTransactions();
    syncPendingSmsOutbox();
    httpProcessPendingSms();

    currentState = STATE_SYNC_CONFIG;
  } else {
    Serial.println("[WiFi] Offline. Local vending mode active.");
    updateLcd("WiFi Offline", "Local Mode");
    delay(1000);
    currentState = STATE_IDLE;
  }

  stateTimer = millis();
  beepBuzzer(1, 80);
}

// ============================================================================
// loop()
// ============================================================================

void loop() {
  serviceLcdFeedback();
  logMachineState();
  handleWiFiReconnect();
  handleTamperCheck();
  handleCoinProcessing();

  char key = scanKeypadPCF8574();
  if (key != '\0') {
    handleKeypress(key);
  }

  const bool maintenanceAllowed = currentState == STATE_IDLE && !motorActive;

  // Periodic health sync
  if (maintenanceAllowed && WiFi.status() == WL_CONNECTED &&
      millis() - lastHealthSyncTime >= HEALTH_SYNC_INTERVAL_MS) {
    lastHealthSyncTime = millis();
    gsmSignalPct = gsmGetSignalStrength();
    httpSyncDeviceHealth();
  }

  // This lightweight heartbeat is intentionally separate from health telemetry.
  // It gives the dashboard a prompt online/offline signal without creating a
  // resource-history row every few seconds.
  if (maintenanceAllowed && WiFi.status() == WL_CONNECTED &&
      millis() - lastDeviceHeartbeatTime >= DEVICE_HEARTBEAT_INTERVAL_MS) {
    lastDeviceHeartbeatTime = millis();
    httpHeartbeatDevice();
  }

  // This setting-only read gives the dashboard switch a fast response.
  // PIN values are neither read nor uploaded unless the switch is enabled.
  if (maintenanceAllowed && WiFi.status() == WL_CONNECTED &&
      millis() - lastPinMonitorControlTime >= PIN_MONITOR_CONTROL_INTERVAL_MS) {
    lastPinMonitorControlTime = millis();
    httpFetchPinMonitoringState();
  }

  if (pinConnectionDetectionEnabled && currentState == STATE_IDLE && !motorActive) {
    runPinConnectionDiagnostics();
  }

  // SMS events are first uploaded to public.sms. Only then does the ESP32
  // retrieve pending rows and send them through the SIM800L. A failed SMS is
  // left pending, while the remaining rows in this batch still continue.
  if (WiFi.status() == WL_CONNECTED &&
      currentState == STATE_IDLE &&
      millis() - lastSmsProcessTime >= SMS_PROCESS_INTERVAL_MS) {
    lastSmsProcessTime = millis();
    syncPendingSmsOutbox();
    httpProcessPendingSms();
  }

  // Periodic server config/stock refresh only while safely idle
  if (WiFi.status() == WL_CONNECTED &&
      currentState == STATE_IDLE &&
      millis() - lastConfigSyncTime >= CONFIG_SYNC_INTERVAL_MS) {
    lastConfigSyncTime = millis();

    syncPendingTransactions();

    // Do not overwrite local stock while offline sales are still pending.
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

  switch (currentState) {
    case STATE_SYNC_CONFIG: {
      updateLcd("Syncing Cloud", "Please Wait");

      syncPendingTransactions();
      bool configOk = httpFetchConfig();
      bool stockOk = httpFetchSlots();
      bool healthOk = httpSyncDeviceHealth();
      Serial.printf("[CLOUD] Config=%s Stock=%s Health=%s\n",
        configOk ? "OK" : "FAILED", stockOk ? "OK" : "PENDING/FAILED",
        healthOk ? "OK" : "FAILED");

      currentState = STATE_IDLE;
      stateTimer = millis();
      break;
    }

    case STATE_IDLE:
      showIdleScreen();
      break;

    case STATE_SLOT_SELECTED:
      // No destructive timeout: coins already inserted cannot be refunded.
      if (millis() - stateTimer > 30000UL && currentCredit <= 0.0f) {
        selectedSlotIndex = -1;
        currentState = STATE_IDLE;
        stateTimer = millis();
      }
      break;

    case STATE_COIN_PAYMENT:
      if (selectedSlotIndex >= 0 &&
          selectedSlotIndex < 5 &&
          currentCredit >= unitPrice) {

        SlotItem &s = slots[selectedSlotIndex];

        if (s.stock <= 0) {
          updateLcd("OUT OF STOCK", s.slotCode);
          beepBuzzer(3, 100);
          selectedSlotIndex = -1;
          currentState = STATE_IDLE;
          stateTimer = millis();
          break;
        }

        executeDispense(selectedSlotIndex, "coin", "");
      } else if (selectedSlotIndex < 0 &&
                 (long)(millis() - paymentRetryPromptUntil) >= 0) {
        paymentRetryPromptUntil = 0;
        updateLcd("Credit P" + String(currentCredit, 0), "Select Slot 1-5");
      }
      break;

    case STATE_GCASH_INPUT:
      if (millis() - stateTimer >= 45000UL) {
        updateLcd("GCash Timeout", "Cancelled");
        delay(800);
        gcashRefBuffer = "";
        selectedSlotIndex = -1;
        currentState = STATE_IDLE;
        stateTimer = millis();
      }
      break;

    case STATE_GCASH_WAITING:
      if (millis() - gcashPollTimer >= GCASH_POLL_INTERVAL_MS) {
        gcashPollTimer = millis();

        String status = httpCheckGcashStatus(gcashRefBuffer);

        if (status == "approved") {
          updateLcd("GCash Approved", "Dispensing...");
          beepBuzzer(2, 90);
          executeDispense(selectedSlotIndex, "gcash", gcashRefBuffer);

        } else if (status == "rejected") {
          updateLcd("Payment Reject", "Check Ref");
          beepBuzzer(3, 120);
          delay(1500);
          gcashRefBuffer = "";
          selectedSlotIndex = -1;
          currentState = STATE_IDLE;
          stateTimer = millis();

        } else if (status == "consumed") {
          updateLcd("Ref Already Used", "Enter New Ref");
          beepBuzzer(3, 120);
          delay(1500);
          gcashRefBuffer = "";
          selectedSlotIndex = -1;
          currentState = STATE_IDLE;
          stateTimer = millis();

        } else if (millis() - stateTimer >= GCASH_APPROVAL_TIMEOUT_MS) {
          updateLcd("Approval Timeout", "Try Again Later");
          delay(1500);
          selectedSlotIndex = -1;
          currentState = STATE_IDLE;
          stateTimer = millis();

        } else {
          updateLcd("Verifying GCash", "Awaiting Admin");
        }
      }
      break;

    case STATE_DISPENSING:
    case STATE_SUCCESS:
    case STATE_ERROR:
      // executeDispense() owns these temporary states.
      break;

    default:
      currentState = STATE_IDLE;
      stateTimer = millis();
      break;
  }

  serviceLcdFeedback();
  // Cloud work may wait on HTTP. Keep it out of every customer-facing state
  // so retained credit can be used and the keypad remains responsive.
  if (currentState == STATE_IDLE && !motorActive) {
    processDeferredDispenseFailureAlert();
    processEsp32LogQueue();
  }

  delay(2);
}

const char *machineStateName(MachineState state) {
  switch (state) {
    case STATE_BOOT: return "BOOT";
    case STATE_SYNC_CONFIG: return "SYNC_CONFIG";
    case STATE_IDLE: return "IDLE";
    case STATE_SLOT_SELECTED: return "SLOT_SELECTED";
    case STATE_COIN_PAYMENT: return "COIN_PAYMENT";
    case STATE_GCASH_INPUT: return "GCASH_INPUT";
    case STATE_GCASH_WAITING: return "GCASH_WAITING";
    case STATE_DISPENSING: return "DISPENSING";
    case STATE_SUCCESS: return "SUCCESS";
    case STATE_ERROR: return "ERROR";
    default: return "UNKNOWN";
  }
}

// Prints only when the user-visible machine state changes, so the monitor
// remains readable during normal idle operation.
void logMachineState() {
  static MachineState lastState = STATE_BOOT;
  static bool initialized = false;

  if (initialized && currentState == lastState) return;

  initialized = true;
  lastState = currentState;

  String slot = "none";
  if (selectedSlotIndex >= 0 && selectedSlotIndex < 5) {
    slot = slots[selectedSlotIndex].slotCode;
  }

  Serial.printf("[STATE] %s | slot=%s | credit=P%.2f | wifi=%s\n",
                machineStateName(currentState), slot.c_str(), currentCredit,
                WiFi.status() == WL_CONNECTED ? "connected" : "offline");
  logEsp32Event("machine_state", String(machineStateName(currentState)) +
                "; slot=" + slot + "; credit=P" + String(currentCredit, 2));
}

// ============================================================================

// Function implementations are organized into Arduino IDE tabs:
// 01_display, 02_keypad, 03_coin, 04_tamper, 05_vending,
// 06_persistence, 07_wifi, 08_supabase, 09_gsm, and 10_diagnostics.
// Arduino concatenates these tabs with this main sketch during compilation.

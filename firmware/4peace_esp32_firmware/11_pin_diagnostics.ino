// Arduino IDE tab: all ESP32-WROOM GPIO status monitoring.
// Only relay/buzzer pins are temporarily switched to INPUT_PULLUP; every other
// GPIO is read without changing its configured mode, or marked reserved.

enum PinCheckKind { PIN_READ_ONLY, PIN_OUTPUT_PROBE, PIN_NO_TOUCH };

struct PinProbe {
  int gpio;
  const char *mode;
  PinCheckKind kind;
  int restoreLevel;
};

const PinProbe PIN_PROBES[] = {
  {  0, "INPUT",                   PIN_READ_ONLY,    LOW },
  {  1, "UART0",                   PIN_NO_TOUCH,     LOW },
  {  2, "INPUT",                   PIN_READ_ONLY,    LOW },
  {  3, "UART0",                   PIN_NO_TOUCH,     LOW },
  {  4, "INPUT_PULLUP",            PIN_READ_ONLY,    LOW },
  {  5, "INPUT",                   PIN_READ_ONLY,    LOW },
  {  6, "RESERVED (SPI flash)",    PIN_NO_TOUCH,     LOW },
  {  7, "RESERVED (SPI flash)",    PIN_NO_TOUCH,     LOW },
  {  8, "RESERVED (SPI flash)",    PIN_NO_TOUCH,     LOW },
  {  9, "RESERVED (SPI flash)",    PIN_NO_TOUCH,     LOW },
  { 10, "RESERVED (SPI flash)",    PIN_NO_TOUCH,     LOW },
  { 11, "RESERVED (SPI flash)",    PIN_NO_TOUCH,     LOW },
  { 12, "INPUT",                   PIN_READ_ONLY,    LOW },
  { 13, "OUTPUT / INPUT_PULLUP",   PIN_OUTPUT_PROBE, RELAY_INACTIVE_LEVEL },
  { 14, "OUTPUT / INPUT_PULLUP",   PIN_OUTPUT_PROBE, RELAY_INACTIVE_LEVEL },
  { 15, "INPUT",                   PIN_READ_ONLY,    LOW },
  { 16, "UART2",                   PIN_NO_TOUCH,     LOW },
  { 17, "UART2",                   PIN_NO_TOUCH,     LOW },
  { 18, "OUTPUT / INPUT_PULLUP",   PIN_OUTPUT_PROBE, RELAY_INACTIVE_LEVEL },
  { 19, "OUTPUT / INPUT_PULLUP",   PIN_OUTPUT_PROBE, RELAY_INACTIVE_LEVEL },
  { 21, "I2C",                     PIN_READ_ONLY,    LOW },
  { 22, "I2C",                     PIN_READ_ONLY,    LOW },
  { 23, "OUTPUT / INPUT_PULLUP",   PIN_OUTPUT_PROBE, RELAY_INACTIVE_LEVEL },
  { 25, "OUTPUT / INPUT_PULLUP",   PIN_OUTPUT_PROBE, LOW },
  { 26, "INPUT_PULLUP",            PIN_READ_ONLY,    LOW },
  { 27, "INPUT",                   PIN_READ_ONLY,    LOW },
  { 32, "INPUT",                   PIN_READ_ONLY,    LOW },
  { 33, "INPUT",                   PIN_READ_ONLY,    LOW },
  { 34, "INPUT",                   PIN_READ_ONLY,    LOW },
  { 35, "INPUT",                   PIN_READ_ONLY,    LOW },
  { 36, "INPUT / ADC",             PIN_READ_ONLY,    LOW },
  { 37, "INPUT",                   PIN_READ_ONLY,    LOW },
  { 38, "INPUT",                   PIN_READ_ONLY,    LOW },
  { 39, "INPUT / ADC",             PIN_READ_ONLY,    LOW }
};

const size_t PIN_PROBE_COUNT = sizeof(PIN_PROBES) / sizeof(PIN_PROBES[0]);

void restorePinDiagnosticOutputs() {
  for (size_t i = 0; i < PIN_PROBE_COUNT; i++) {
    if (PIN_PROBES[i].kind != PIN_OUTPUT_PROBE) continue;
    pinMode(PIN_PROBES[i].gpio, OUTPUT);
    digitalWrite(PIN_PROBES[i].gpio, PIN_PROBES[i].restoreLevel);
  }
}

bool httpSyncPinStatus(JsonArray pins) {
  WiFiClientSecure client;
  configureSecureClient(client);
  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/sync_esp32_pin_status";

  if (!http.begin(client, url)) return false;
  addSupabaseHeaders(http, true);

  DynamicJsonDocument request(8192);
  request["p_device_key"] = DEVICE_API_KEY;
  request["p_machine_id"] = MACHINE_ID;
  JsonArray payloadPins = request.createNestedArray("p_pins");
  for (JsonObject pin : pins) payloadPins.add(pin);

  String body;
  serializeJson(request, body);
  int code = http.POST(body);
  String response = http.getString();
  http.end();

  StaticJsonDocument<256> ack;
  bool ok = code == 200 && !deserializeJson(ack, response) && (ack["success"] | false);
  Serial.printf("[PIN CHECK] HTTP %d, authenticated=%s\n", code, ok ? "yes" : "no");
  return ok;
}

void runPinConnectionDiagnostics() {
  if (!pinConnectionDetectionEnabled || motorActive || currentState != STATE_IDLE) return;
  if (millis() - lastPinDiagnosticTime < PIN_DIAGNOSTIC_INTERVAL_MS) return;
  lastPinDiagnosticTime = millis();

  DynamicJsonDocument samples(8192);
  JsonArray pins = samples.to<JsonArray>();

  for (size_t i = 0; i < PIN_PROBE_COUNT; i++) {
    const PinProbe &probe = PIN_PROBES[i];
    int value = HIGH;
    bool measured = false;

    if (probe.kind == PIN_OUTPUT_PROBE) {
      pinMode(probe.gpio, INPUT_PULLUP);
      delay(PIN_DIAGNOSTIC_SETTLE_MS);
      value = digitalRead(probe.gpio);
      pinMode(probe.gpio, OUTPUT);
      digitalWrite(probe.gpio, probe.restoreLevel);
      measured = true;
    } else if (probe.kind == PIN_READ_ONLY) {
      value = digitalRead(probe.gpio);
      measured = true;
    }

    JsonObject pin = pins.createNestedObject();
    pin["gpio"] = probe.gpio;
    pin["pin_label"] = "";
    pin["current_mode"] = probe.mode;
    pin["connection_status"] = measured && value == LOW ? "connected" : "disconnected";
    pin["realtime_value"] = measured
      ? (value == LOW ? "LOW (ground detected)" : "HIGH (open)")
      : "N/A";
  }

  httpSyncPinStatus(pins);
}

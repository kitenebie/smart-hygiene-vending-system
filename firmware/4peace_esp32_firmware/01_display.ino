  // Arduino IDE tab: 01_display.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// UI
// ============================================================================

String fit16(String s) {
  if (s.length() > 16) s = s.substring(0, 16);
  while (s.length() < 16) s += ' ';
  return s;
}

String currentLcdLine1 = "";
String currentLcdLine2 = "";
bool keypadFeedbackActive = false;
unsigned long keypadFeedbackUntil = 0;

void writeLcdLines(const String &line1, const String &line2) {
  lcd.setCursor(0, 0);
  lcd.print(fit16(line1));
  lcd.setCursor(0, 1);
  lcd.print(fit16(line2));
}

void updateLcd(const String &line1, const String &line2) {
  // executeDispense() is intentionally blocking while the motor and IR sensor
  // are active. Expire the keypad overlay here as well as in loop(), so a
  // motor result can replace "You pressed ..." immediately after the timeout.
  if (keypadFeedbackActive &&
      (long)(millis() - keypadFeedbackUntil) >= 0) {
    keypadFeedbackActive = false;
  }

  String a = fit16(line1);
  String b = fit16(line2);

  if (a == currentLcdLine1 && b == currentLcdLine2) return;

  Serial.printf("[LCD] %s | %s\n", a.c_str(), b.c_str());
  // Never save a payment-reference screen in the cloud event log.
  if (line1 == "GCash Reference" || line1 == "Submitting Ref") {
    // line2 is already masked by maskGcashReference().
    logEsp32Event("lcd", line1 + " | " + line2);
  } else {
    logEsp32Event("lcd", line1 + " | " + line2);
  }

  currentLcdLine1 = a;
  currentLcdLine2 = b;

  // Key feedback is an overlay. Keep the requested screen cached and render
  // it as soon as the short feedback window expires.
  if (!keypadFeedbackActive) {
    writeLcdLines(a, b);
  }
}

void showKeypressFeedback(char key, bool hideKey) {
  const char displayedKey = hideKey ? '*' : key;

  writeLcdLines("You pressed " + String(displayedKey), "Keypad detected");
  keypadFeedbackActive = true;
  keypadFeedbackUntil = millis() + KEYPAD_FEEDBACK_MS;
}

void serviceLcdFeedback() {
  if (!keypadFeedbackActive) return;
  if ((long)(millis() - keypadFeedbackUntil) < 0) return;

  keypadFeedbackActive = false;
  writeLcdLines(currentLcdLine1, currentLcdLine2);
}

void showIdleScreen() {
  static unsigned long lastToggle = 0;
  static bool toggle = false;

  if (currentCredit > 0.0f) {
    updateLcd("Credit P" + String(currentCredit, 0), "Select Slot 1-5");
    return;
  }

  if (millis() - lastToggle >= 3000UL) {
    lastToggle = millis();
    toggle = !toggle;

    if (toggle) {
      updateLcd("4Peace Vending", "Select 1-5");
    } else {
      updateLcd("1-5 Select Item", "B=GCash C=Coin");
    }
  }
}

void beepBuzzer(int count, int durationMs) {
  for (int i = 0; i < count; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(durationMs);
    digitalWrite(BUZZER_PIN, LOW);
    if (i + 1 < count) delay(60);
  }
}

// ============================================================================

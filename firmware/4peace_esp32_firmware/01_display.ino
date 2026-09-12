  // Arduino IDE tab: 01_display.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// UI
// ============================================================================

String fit16(String s) {
  if (s.length() > 16) s = s.substring(0, 16);
  while (s.length() < 16) s += ' ';
  return s;
}

void updateLcd(const String &line1, const String &line2) {
  static String last1 = "";
  static String last2 = "";

  String a = fit16(line1);
  String b = fit16(line2);

  if (a == last1 && b == last2) return;

  Serial.printf("[LCD] %s | %s\n", a.c_str(), b.c_str());

  lcd.setCursor(0, 0);
  lcd.print(a);
  lcd.setCursor(0, 1);
  lcd.print(b);

  last1 = a;
  last2 = b;
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
      updateLcd("4Peace Vending", "Insert Coin");
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

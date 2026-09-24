// Arduino IDE tab: 09_gsm.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// SIM800L
// ============================================================================

String gsmReadUntil(unsigned long timeoutMs, const String &stopToken) {
  String response = "";
  unsigned long started = millis();

  while (millis() - started < timeoutMs) {
    while (SerialGSM.available()) {
      response += char(SerialGSM.read());
    }

    if (stopToken.length() && response.indexOf(stopToken) >= 0) {
      return response;
    }

    delay(5);
  }

  return response;
}

bool gsmCommand(
  const String &command,
  const String &expected,
  unsigned long timeoutMs
) {
  while (SerialGSM.available()) {
    SerialGSM.read();
  }

  SerialGSM.println(command);

  String response = gsmReadUntil(timeoutMs, expected);

  Serial.print("[GSM] ");
  Serial.print(command);
  Serial.print(" -> ");
  Serial.println(response);

  return response.indexOf(expected) >= 0;
}

bool gsmInit() {
  SerialGSM.begin(
    GSM_BAUDRATE,
    SERIAL_8N1,
    GSM_RX_PIN,
    GSM_TX_PIN
  );

  delay(800);

  bool atOk = gsmCommand("AT", "OK", 1000);
  if (!atOk) return false;

  gsmCommand("ATE0", "OK", 1000);
  gsmCommand("AT+CMGF=1", "OK", 1000);

  return true;
}

bool gsmSendSMS(
  const String &recipient,
  const String &message
) {
  if (recipient.length() < 7 ||
      recipient.indexOf('X') >= 0) {
    Serial.println("[GSM] Admin number not configured.");
    return false;
  }

  if (!gsmCommand("AT", "OK", 1000)) {
    return false;
  }

  if (!gsmCommand("AT+CMGF=1", "OK", 1000)) {
    return false;
  }

  while (SerialGSM.available()) SerialGSM.read();

  SerialGSM.print("AT+CMGS=\"");
  SerialGSM.print(recipient);
  SerialGSM.println("\"");

  String prompt = gsmReadUntil(1500, ">");

  if (prompt.indexOf('>') < 0) {
    Serial.println("[GSM] No SMS prompt.");
    return false;
  }

  SerialGSM.print(message);
  SerialGSM.write(26);

  String result = gsmReadUntil(7000, "\r\nOK\r\n");

  Serial.print("[GSM] SMS result: ");
  Serial.println(result);

  return result.indexOf("+CMGS:") >= 0 &&
         result.indexOf("OK") >= 0;
}

int gsmGetSignalStrength() {
  while (SerialGSM.available()) SerialGSM.read();

  SerialGSM.println("AT+CSQ");
  String response = gsmReadUntil(1000, "\r\nOK\r\n");

  int idx = response.indexOf("+CSQ:");
  if (idx < 0) return -1;

  int comma = response.indexOf(',', idx);
  if (comma < 0) return -1;

  String csqText = response.substring(idx + 5, comma);
  csqText.trim();

  int csq = csqText.toInt();

  if (csq == 99 || csq < 0 || csq > 31) {
    return -1;
  }

  return (csq * 100) / 31;
}

// ============================================================================

// Arduino IDE tab: 10_diagnostics.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.

// Voltage diagnostics
// ============================================================================

float readRailVoltage(int adcPin, float dividerRatio) {
#if ENABLE_VOLTAGE_MONITOR
  uint32_t millivolts = analogReadMilliVolts(adcPin);
  return (millivolts / 1000.0f) * dividerRatio;
#else
  (void)adcPin;
  (void)dividerRatio;
  return 0.0f;
#endif
}

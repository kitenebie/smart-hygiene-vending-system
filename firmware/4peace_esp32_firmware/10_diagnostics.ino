// Arduino IDE tab: 10_diagnostics.ino
// Shared globals and declarations are in 4peace_esp32_firmware.ino.
// Guide: readRailVoltage() converts ADC millivolts using the board's
// divider ratio, pero only kapag ENABLE_VOLTAGE_MONITOR is on. If disabled,
// it returns zero and does not pretend na may valid voltage measurement.

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

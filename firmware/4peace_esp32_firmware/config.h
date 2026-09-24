#ifndef CONFIG_H
#define CONFIG_H

// ============================================================
// 4Peace Smart Feminine Hygiene Access System — FIXED Firmware Config
// Target: ESP32-WROOM-32 / ESP32 DevKit V1 (38-pin)
// ============================================================

// ------------------------------------------------------------
// ESP32 expansion-board pin aliases
//
// These names match the labels printed on the supplied 38-pin
// expansion board. Pxx means GPIOxx; GPIO36 and GPIO39 are
// printed as SVP and SVN respectively.
// ------------------------------------------------------------
#define P4   4
#define P13  13
#define P14  14
#define P16  16
#define P17  17
#define P18  18
#define P19  19
#define P21  21
#define P22  22
#define P23  23
#define P25  25
#define P26  26
#define P27  27
#define P32  32
#define P33  33
#define P34  34
#define P35  35
#define SVP  36
#define SVN  39

// ------------------------------------------------------------
// 1. Wi-Fi
// ------------------------------------------------------------
#include "config.local.h"

// ------------------------------------------------------------
// 2. Supabase
// ------------------------------------------------------------

// Device-specific token checked by the complete_vend() Supabase RPC.
#define MACHINE_ID            "VM001"
#define DEVICE_HEALTH_ID      1

// ESP32 event logs (Serial [ESP32 LOG] messages and Supabase uploads).
// Change to true to enable them.
#define ESP32_LOG             false

// ------------------------------------------------------------
// 3. I2C
// ------------------------------------------------------------
#define I2C_SCL_PIN           P22  // Board P22 = GPIO22
#define I2C_SDA_PIN           P21  // Board P21 = GPIO21
#define LCD_I2C_ADDR          0x27
#define PCF8574_I2C_ADDR      0x20

// ------------------------------------------------------------
// 4. Relay outputs
// Avoid ESP32 strapping pins 0, 2, 5, 12, 15.
// ------------------------------------------------------------
#define RELAY_S1_PIN          P13  // Board P13 = GPIO13
#define RELAY_S2_PIN          P14  // Board P14 = GPIO14
#define RELAY_S3_PIN          P18  // Board P18 = GPIO18
#define RELAY_S4_PIN          P19  // Board P19 = GPIO19
#define RELAY_S5_PIN          P23  // Board P23 = GPIO23

#define RELAY_ACTIVE_LEVEL    LOW
#define RELAY_INACTIVE_LEVEL  HIGH

// ------------------------------------------------------------
// 5. IR drop sensors
// GPIO34/35 are input-only and have NO internal pull-up.
// This firmware uses plain INPUT for all IR module digital outputs.
// IMPORTANT: IR sensor output must never exceed 3.3V at ESP32 GPIO.
// ------------------------------------------------------------
#define IR_S1_PIN             P34  // Board P34 = GPIO34
#define IR_S2_PIN             P35  // Board P35 = GPIO35
#define IR_S3_PIN             P32  // Board P32 = GPIO32
#define IR_S4_PIN             P33  // Board P33 = GPIO33
#define IR_S5_PIN             P27  // Board P27 = GPIO27

#define IR_TRIGGERED_LEVEL    LOW

// ------------------------------------------------------------
// 6. Coin / Tamper / Buzzer
// ------------------------------------------------------------
#define COIN_SIGNAL_PIN       P26  // Board P26 = GPIO26
#define TAMPER_SENSOR_PIN     P4   // Board P4  = GPIO4
#define BUZZER_PIN            P25  // Board P25 = GPIO25

// Coin acceptor pulse mapping.
// CALIBRATE these values to your actual coin acceptor programming.
#define COIN_PULSES_P1        1
#define COIN_PULSES_P5        5
#define COIN_PULSES_P10       10

// ------------------------------------------------------------
// 7. Optional voltage monitoring (ADC1 only)
// ------------------------------------------------------------
#define ENABLE_VOLTAGE_MONITOR 0
#define BUCK1_ADC_PIN           SVP  // Board SVP = GPIO36
#define BUCK2_ADC_PIN           SVN  // Board SVN = GPIO39

// Example 100k/100k divider = 2.0 ratio.
// Change to match your actual resistor divider.
#define BUCK1_DIVIDER_RATIO     2.0f
#define BUCK2_DIVIDER_RATIO     2.0f

// ------------------------------------------------------------
// 8. SIM800L UART2
// ------------------------------------------------------------
#define GSM_RX_PIN            P16  // Board P16 = GPIO16; ESP32 RX <- SIM800L TX
#define GSM_TX_PIN            P17  // Board P17 = GPIO17; ESP32 TX -> SIM800L RX
#define GSM_BAUDRATE          9600
#define DEFAULT_ADMIN_SMS     "+639XXXXXXXXX"

// ------------------------------------------------------------
// 9. Timing
// ------------------------------------------------------------
#define DISPENSE_TIMEOUT_MS        7000UL
#define DISPENSE_RETRY_COUNT       2

#define GCASH_POLL_INTERVAL_MS     3000UL
#define GCASH_APPROVAL_TIMEOUT_MS  120000UL

#define HEALTH_SYNC_INTERVAL_MS    60000UL
#define DEVICE_HEARTBEAT_INTERVAL_MS 10000UL
#define CONFIG_SYNC_INTERVAL_MS    60000UL
#define PIN_MONITOR_CONTROL_INTERVAL_MS 5000UL
#define PIN_DIAGNOSTIC_INTERVAL_MS       2000UL
#define PIN_DIAGNOSTIC_SETTLE_MS            5UL
#define WIFI_RETRY_INTERVAL_MS     10000UL
#define SMS_PROCESS_INTERVAL_MS     15000UL
#define SMS_PROCESS_BATCH_SIZE      4

#define COIN_PULSE_TIMEOUT_MS      400UL

#define TAMPER_WINDOW_MS           2000UL
#define TAMPER_EDGE_DEBOUNCE_MS    100UL
#define TAMPER_ALERT_COOLDOWN_MS   30000UL
#define TAMPER_REQUIRED_EDGES      3

#define KEYPAD_DEBOUNCE_MS         35UL
#define SENSOR_STABLE_MS           50UL

// ------------------------------------------------------------
// 10. Persistent offline journal
// ------------------------------------------------------------
#define PENDING_QUEUE_MAX          20
#define SMS_OUTBOX_MAX              20

// ------------------------------------------------------------
// 11. TLS
// Verify the server certificate using supabase_ca.h and NTP time.
// ------------------------------------------------------------
#define TLS_ALLOW_INSECURE         0

#endif

#ifndef CONFIG_H
#define CONFIG_H

// ============================================================
// 4Peace Smart Feminine Hygiene Access System — FIXED Firmware Config
// Target: ESP32-WROOM-32 / ESP32 DevKit V1
// ============================================================

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

// ------------------------------------------------------------
// 3. I2C
// ------------------------------------------------------------
#define I2C_SDA_PIN           21
#define I2C_SCL_PIN           22
#define LCD_I2C_ADDR          0x27
#define PCF8574_I2C_ADDR      0x20

// ------------------------------------------------------------
// 4. Relay outputs
// Avoid ESP32 strapping pins 0, 2, 5, 12, 15.
// ------------------------------------------------------------
#define RELAY_S1_PIN          13
#define RELAY_S2_PIN          14
#define RELAY_S3_PIN          18
#define RELAY_S4_PIN          19
#define RELAY_S5_PIN          23

#define RELAY_ACTIVE_LEVEL    LOW
#define RELAY_INACTIVE_LEVEL  HIGH

// ------------------------------------------------------------
// 5. IR drop sensors
// GPIO34/35 are input-only and have NO internal pull-up.
// This firmware uses plain INPUT for all IR module digital outputs.
// IMPORTANT: IR sensor output must never exceed 3.3V at ESP32 GPIO.
// ------------------------------------------------------------
#define IR_S1_PIN             34
#define IR_S2_PIN             35
#define IR_S3_PIN             32
#define IR_S4_PIN             33
#define IR_S5_PIN             27

#define IR_TRIGGERED_LEVEL    LOW

// ------------------------------------------------------------
// 6. Coin / Tamper / Buzzer
// ------------------------------------------------------------
#define COIN_SIGNAL_PIN       26
#define TAMPER_SENSOR_PIN     4
#define BUZZER_PIN            25

// Coin acceptor pulse mapping.
// CALIBRATE these values to your actual coin acceptor programming.
#define COIN_PULSES_P1        1
#define COIN_PULSES_P5        5
#define COIN_PULSES_P10       10

// ------------------------------------------------------------
// 7. Optional voltage monitoring (ADC1 only)
// ------------------------------------------------------------
#define ENABLE_VOLTAGE_MONITOR 0
#define BUCK1_ADC_PIN           36
#define BUCK2_ADC_PIN           39

// Example 100k/100k divider = 2.0 ratio.
// Change to match your actual resistor divider.
#define BUCK1_DIVIDER_RATIO     2.0f
#define BUCK2_DIVIDER_RATIO     2.0f

// ------------------------------------------------------------
// 8. SIM800L UART2
// ------------------------------------------------------------
#define GSM_RX_PIN            16   // ESP32 RX <- SIM800L TX
#define GSM_TX_PIN            17   // ESP32 TX -> SIM800L RX
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
#define CONFIG_SYNC_INTERVAL_MS    60000UL
#define WIFI_RETRY_INTERVAL_MS     10000UL

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

// ------------------------------------------------------------
// 11. TLS
// Verify the server certificate using supabase_ca.h and NTP time.
// ------------------------------------------------------------
#define TLS_ALLOW_INSECURE         0

#endif

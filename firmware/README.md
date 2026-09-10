4Peace Fixed Firmware — Setup Notes
===================================

FILES
-----
1. 4peace_esp32_firmware/config.h
2. 4peace_esp32_firmware/4peace_esp32_firmware.ino
3. 4peace_esp32_firmware/01_display.ino through 10_diagnostics.ino
4. supabase_complete_vend_FIX.sql

FIRMWARE LAYOUT
---------------
The main sketch contains the includes, shared state, interrupt handlers,
setup(), loop(), and function declarations. Arduino IDE loads the numbered
tabs with it during compilation:
- 01_display: LCD rendering and buzzer
- 02_keypad: keypad scan and user payment flow
- 03_coin / 04_tamper: sensor processing
- 05_vending: IR-verified dispensing
- 06_persistence: stock and offline transaction queue
- 07_wifi / 08_supabase: reconnect and cloud requests
- 09_gsm / 10_diagnostics: SIM800L and voltage monitoring

REQUIRED ARDUINO LIBRARIES
--------------------------
- LiquidCrystal_I2C
- ArduinoJson 6.x
- ESP32 Arduino Core libraries (WiFi, HTTPClient, Preferences are included)

BEFORE FLASHING
---------------
1. Run npm run firmware:configure from react-app to synchronize backend credentials.
2. Set WIFI_SSID and WIFI_PASSWORD in config.local.h (2.4 GHz network required).
3. Keep config.local.h private; it is ignored by Git.
4. Re-run firmware:configure after changing the backend device token.
5. Set DEFAULT_ADMIN_SMS.
6. Run supabase_complete_vend_FIX.sql in Supabase SQL Editor.
7. Make sure machine_settings.device_api_key has the SAME DEVICE_API_KEY.
8. Confirm LCD address (0x27) and PCF8574 address (0x20) with an I2C scanner.
9. Calibrate the coin acceptor pulse values.
10. Confirm relay board is active LOW; if not, change RELAY_ACTIVE_LEVEL.

FIXED PIN MAP
-------------
I2C SDA              GPIO21
I2C SCL              GPIO22
SIM800L RX/TX         GPIO16 / GPIO17

Relay S1             GPIO13
Relay S2             GPIO14
Relay S3             GPIO18
Relay S4             GPIO19
Relay S5             GPIO23

IR S1                GPIO34
IR S2                GPIO35
IR S3                GPIO32
IR S4                GPIO33
IR S5                GPIO27

Coin signal          GPIO26
Tamper sensor        GPIO4
Buzzer               GPIO25

Optional Buck ADC1   GPIO36
Optional Buck ADC2   GPIO39

PIN AND VOLTAGE CONNECTION TABLE
--------------------------------
All ESP32 GPIO signals are **3.3 V only**. Connect every low-voltage module
ground to ESP32 GND unless an opto-isolated module explicitly requires a
separate isolated ground. Do not connect a motor, relay coil, SIM800L, or
coin acceptor power input directly to the ESP32 3.3 V pin.

See [connection.md](connection.md) for the cover wiring diagram, corrected GPIO
mapping, voltage rails, and pre-power safety checks.

| Device / module pin | ESP32 connection | Module supply | Signal voltage | Connection notes |
| --- | --- | --- | --- | --- |
| ESP32 VIN / 5V | Regulated 5 V supply or USB 5 V | 5 V input | — | Use a supply with enough current for the ESP32 and low-power sensors. Motors and SIM800L need their own supply. |
| ESP32 3V3 | 3.3 V sensor rail | 3.3 V output | 3.3 V | Use for the keypad expander, compatible LCD backpack, IR, and tamper modules. |
| ESP32 GND | Common low-voltage ground | 0 V | 0 V | Connect to LCD, PCF8574, IR, buzzer driver, tamper module, relay input ground, and SIM800L ground. |
| LCD SDA | GPIO21 | 3.3 V preferred | 3.3 V I2C | LCD address is `0x27`. If the LCD backpack is powered from 5 V, its SDA/SCL pull-ups may output 5 V; use a bidirectional I2C level shifter. |
| LCD SCL | GPIO22 | 3.3 V preferred | 3.3 V I2C | Same I2C bus as the PCF8574 keypad. |
| PCF8574 SDA / SCL | GPIO21 / GPIO22 | 3.3 V | 3.3 V I2C | Address is `0x20`. Power the expander at 3.3 V, or add an I2C level shifter if its board uses 5 V pull-ups. |
| Relay S1 IN | GPIO13 | Relay-board rated supply, commonly 5 V | ESP32 side must accept 3.3 V | Relay is active LOW. Power relay coils from their own supply, not ESP32 3V3. |
| Relay S2 IN | GPIO14 | Same as relay board | 3.3 V input-safe | Active LOW. |
| Relay S3 IN | GPIO18 | Same as relay board | 3.3 V input-safe | Active LOW. |
| Relay S4 IN | GPIO19 | Same as relay board | 3.3 V input-safe | Active LOW. |
| Relay S5 IN | GPIO23 | Same as relay board | 3.3 V input-safe | Active LOW. |
| IR S1 OUT | GPIO34 | 3.3 V | Maximum 3.3 V | GPIO34 is input-only and has no internal pull-up. Use an IR module with a stable external output. |
| IR S2 OUT | GPIO35 | 3.3 V | Maximum 3.3 V | GPIO35 is input-only and has no internal pull-up. |
| IR S3 OUT | GPIO32 | 3.3 V | Maximum 3.3 V | Input reads LOW when a drop is detected. |
| IR S4 OUT | GPIO33 | 3.3 V | Maximum 3.3 V | Input reads LOW when a drop is detected. |
| IR S5 OUT | GPIO27 | 3.3 V | Maximum 3.3 V | Input reads LOW when a drop is detected. |
| Coin acceptor signal | GPIO26 | Use the acceptor’s specified supply, often 12 V | **Level-shifted to 3.3 V** | Use an optocoupler, transistor circuit, or level shifter. Never connect a 5 V/12 V pulse output directly to GPIO26. |
| Tamper sensor OUT | GPIO4 | 3.3 V | Maximum 3.3 V | Firmware uses `INPUT_PULLUP`; wire an active-LOW sensor or switch to GND. |
| Buzzer control | GPIO25 | 3.3 V for a small active buzzer | 3.3 V control | Use a transistor/MOSFET driver for a 5 V buzzer or any buzzer that needs more current than a GPIO can safely supply. |
| SIM800L TX | GPIO16 (ESP32 RX) | Dedicated 4.0–4.2 V supply | SIM800L TX is typically about 2.8 V | SIM800L TX can normally be read by ESP32. Share ground. |
| SIM800L RX | GPIO17 (ESP32 TX) | Dedicated 4.0–4.2 V supply | Limit to SIM800L RX rating | Put a divider or logic-level shifter between ESP32 3.3 V TX and SIM800L RX. |
| SIM800L VCC | Dedicated 4.0–4.2 V, high-current supply | 4.0–4.2 V | — | Supply must handle approximately 2 A transmit bursts. Do not use ESP32 3V3 or a weak USB rail. |
| Buck #1 voltage sense | GPIO36 through resistor divider | Measured rail | Maximum 3.3 V at GPIO36 | Optional. With the documented 100 kΩ/100 kΩ divider, a 5 V rail becomes 2.5 V at the pin. |
| Buck #2 voltage sense | GPIO39 through resistor divider | Measured rail | Maximum 3.3 V at GPIO39 | Optional. With the documented divider, a 4.2 V rail becomes 2.1 V at the pin. |

Avoid GPIO0, GPIO2, GPIO5, GPIO12, and GPIO15 for new peripherals because they
are ESP32 boot-strapping pins. Test relay and sensor wiring one module at a time
before connecting vending motors.

CRITICAL HARDWARE RULES
-----------------------
- Never feed 5V/12V logic directly into an ESP32 GPIO.
- Coin acceptor signal needs 3.3V-safe level conversion if output is above 3.3V.
- IR module output must also be 3.3V-safe.
- SIM800L needs a dedicated ~4.0-4.2V high-current supply.
- Relay/motor power should not be drawn from the ESP32.
- Share common ground where appropriate.
- GPIO34 and GPIO35 have no internal pull-up; this firmware uses INPUT.

FUNCTIONAL TEST ORDER
---------------------
1. LCD + keypad.
2. Coin pulse detection.
3. One relay + one motor.
4. One IR sensor.
5. One complete coin vend.
6. Supabase slot sync.
7. Offline vend + reboot + reconnect sync.
8. GCash submit/approve/consume.
9. Tamper + SMS.
10. All five slots.


CONNECTION UPDATE (2026-09-10)
------------------------------
- React and firmware use the same Supabase project. Credentials are in ignored
  config.local.h; npm run firmware:configure refreshes the Supabase values and
  preserves the Wi-Fi settings. Never share compiled binaries: they contain credentials.
- GCash approval only approves payment. The device complete_vend RPC records the
  transaction after an IR-confirmed drop, and consumed_at marks fulfillment.
- Completion validates the device token and payment amount, serializes replay,
  decrements stock once, and updates the health heartbeat timestamp server-side.
- Dashboard inventory, payments, transactions, health, and notifications poll every
  five seconds. Settings edits reach the idle device within its 60-second refresh.
- HTTPS verifies the server with the roots in supabase_ca.h. NTP access is required;
  look for [TLS] diagnostics if the network blocks time synchronization.
- Startup prints [CLOUD] Config=OK Stock=OK Health=OK on successful synchronization.
  [VEND RPC] HTTP 200 with success=true confirms cloud acknowledgement of a sale.
- No USB serial device was detected during setup. The board still needs flashing
  and a physical test. ESP32-WROOM-32 needs a 2.4 GHz SSID, even if your router also
  broadcasts 5 GHz. Edit config.local.h if the supplied SSID is 5 GHz-only.

REPEATABLE CHECKS
-----------------
From react-app:
  npm run firmware:check
  npm run build
  npm run lint
  supabase db query --linked --file supabase/tests/firmware_integration.sql
The API check uses the actual firmware credentials. Its RPC probe targets an absent
slot and cannot record a sale. SQL integration fixtures run as anon and roll back.

POSTMAN HTTP TESTING
--------------------
Use [postmanTest.md](postmanTest.md) for a request-by-request Supabase test guide.
It includes safe read-only checks, expected statuses, the device-health update,
GCash flow, logs/notifications, and a safe RPC authentication test that cannot
decrement stock.

BUILD / FLASH
-------------
Test target: esp32:esp32:esp32 (ESP32 Dev Module), ESP32 core 2.0.17,
ArduinoJson 6.21.5, LiquidCrystal I2C 1.1.2.
Open 4peace_esp32_firmware/4peace_esp32_firmware.ino in Arduino IDE, select
ESP32 Dev Module and the board's COM port, then Upload. Open Serial Monitor at
115200 baud. Ensure the selected board matches your actual hardware.

BACKEND DEPLOYMENT
------------------
The corrected firmware/supabase_complete_vend_FIX.sql was applied to the existing
4Peace project. A timestamped migration contains the same change for repeatability.
Do not re-run the initial/mock seed migrations against this project's live data.

REMAINING SECURITY WORK
-----------------------
The existing project still uses public table access with RLS disabled and a browser
password check instead of Supabase Auth. Connection tests do not establish secure
admin authorization. A coordinated Auth/RLS migration is needed before public use;
turning RLS on without matching policies would break the current clients.

VERIFIED BUILD
--------------
ESP32 core 2.0.17 compilation passed: 960697 bytes flash (73%), 48248 bytes RAM (14%).
Arduino reported the LiquidCrystal I2C AVR metadata warning; compilation succeeded.
React production build and lint passed with existing warnings. Backend rollback integration tests and firmware API checks passed.


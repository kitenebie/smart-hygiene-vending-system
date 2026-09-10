Based sa `README.md`, ang pinakamagandang integration ay **huwag direktang isipin na ang React website ang kakausapin ng ESP32**. Ang tamang architecture ay: **ESP32 ↔ API/Supabase ↔ React Dashboard**. Ang `vending.machine.com` ang admin interface; ang Supabase/PostgreSQL ang common backend na pinagbabasahan at sinusulatan ng website at ESP32. Ito rin ang architecture na inilalarawan ng README mo. 

## Recommended final architecture

```text
                    INTERNET
                       │
          ┌────────────┴─────────────┐
          │                          │
          ▼                          ▼
 vending.machine.com           DEVICE API
 React 19 Dashboard        Supabase / Edge Function
          │                          ▲
          │                          │ HTTPS REST
          └──────────► SUPABASE ◄────┘
                     PostgreSQL
                         ▲
                         │
                  ESP32 CONTROLLER
                         │
       ┌─────────────────┼─────────────────────┐
       │                 │                     │
       ▼                 ▼                     ▼
   PAYMENT           DISPENSING             SECURITY
 Coin Slot          Gear Motors           Vibration
 Keypad             Relays                Buzzer
 GCash Ref          IR Sensors            SIM800L
       │
       ▼
   LCD 16x2
```

Sa README, supported na ang five-slot vending arrangement, coin pulse counting, IR drop verification, SIM800L, keypad/LCD, stock monitoring, transaction history, GCash approval, notifications, at hardware telemetry. 

---

# 1. Responsibility ng bawat component

Para sa machine mo, ganito ko hahatiin ang trabaho.

| Component               | Responsibility                                         |
| ----------------------- | ------------------------------------------------------ |
| **ESP32**               | Main vending controller                                |
| **Coin Slot**           | Magbibigay ng pulse depende sa coin denomination       |
| **4×4 Keypad**          | Product/slot selection + GCash reference entry         |
| **PCF8574**             | GPIO expansion para sa keypad                          |
| **LCD 16×2 I2C**        | Price, credit, product, payment status, errors         |
| **Relay Module**        | Switch ng bawat gear motor                             |
| **Gear Motor**          | Physical dispensing mechanism                          |
| **IR Sensor**           | Confirm kung totoong nahulog ang product               |
| **Vibration Sensor**    | Anti-tamper detection                                  |
| **3-pin Buzzer**        | Key beep, successful vend, tamper alarm                |
| **SIM800L**             | SMS tamper/low-stock alert; optional cellular fallback |
| **Buck Converter #1**   | 5 V logic supply                                       |
| **Buck Converter #2**   | Dedicated SIM800L supply                               |
| **Supabase**            | Database + API + realtime                              |
| **vending.machine.com** | Admin dashboard                                        |

Ang README mo mismo ay nagse-separate ng `LM2596 5V` para sa ESP32/LCD/relay/sensors at dedicated `4.2V` supply para sa SIM800L. 

---

# 2. PCF8574 usage

Dahil mayroon kang isang PCF8574 lang, irerecommend kong gamitin natin siya para sa **4×4 keypad**.

Ang keypad kasi ay nangangailangan ng:

```text
4 Rows
4 Columns
--------
8 GPIO
```

Eksaktong 8 GPIO ang PCF8574.

```text
PCF8574

P0 -> Keypad Row 1
P1 -> Keypad Row 2
P2 -> Keypad Row 3
P3 -> Keypad Row 4

P4 -> Keypad Column 1
P5 -> Keypad Column 2
P6 -> Keypad Column 3
P7 -> Keypad Column 4

SDA -> ESP32 SDA
SCL -> ESP32 SCL
```

Ang LCD ay puwedeng nasa parehong I2C bus:

```text
ESP32
 GPIO21 SDA ─────┬──── LCD
                 └──── PCF8574

 GPIO22 SCL ─────┬──── LCD
                 └──── PCF8574
```

Basta magkaiba ang I2C addresses.

---

# 3. Product slots

Base sa existing README, **S1–S5** ang magandang first implementation. 

```text
SLOT 1
Gear Motor 1
Relay 1
IR Sensor 1

SLOT 2
Gear Motor 2
Relay 2
IR Sensor 2

SLOT 3
Gear Motor 3
Relay 3
IR Sensor 3

SLOT 4
Gear Motor 4
Relay 4
IR Sensor 4

SLOT 5
Gear Motor 5
Relay 5
IR Sensor 5
```

Conceptually:

```text
ESP32
 │
 ├── Relay 1 ── Gear Motor S1
 ├── Relay 2 ── Gear Motor S2
 ├── Relay 3 ── Gear Motor S3
 ├── Relay 4 ── Gear Motor S4
 └── Relay 5 ── Gear Motor S5

IR1 → confirms Slot 1 drop
IR2 → confirms Slot 2 drop
IR3 → confirms Slot 3 drop
IR4 → confirms Slot 4 drop
IR5 → confirms Slot 5 drop
```

Important: **motor ON does not automatically mean successful sale**.

Successful transaction lang kapag:

```text
Motor activated
      ↓
IR detects product
      ↓
DISPENSE SUCCESS
      ↓
Deduct stock
      ↓
Create transaction
```

Ito rin ang workflow na nasa README: actuation muna, physical drop confirmation via IR, saka stock decrement at transaction logging. 

---

# 4. Startup sequence ng ESP32

Kapag binuksan ang vending machine:

```text
POWER ON
   ↓
Initialize ESP32
   ↓
Initialize LCD
   ↓
Initialize PCF8574 / Keypad
   ↓
Initialize Coin Acceptor
   ↓
Initialize IR Sensors
   ↓
Initialize Relays
   ↓
Initialize Vibration Sensor
   ↓
Initialize SIM800L
   ↓
Connect Wi-Fi
   ↓
Connect Supabase API
   ↓
GET machine settings
   ↓
GET S1-S5 stock/configuration
   ↓
READY
```

LCD:

```text
4Peace Vending
Starting...
```

then:

```text
READY
Select Product
```

---

# 5. ESP32 should download machine configuration

Sa boot, dapat hindi hardcoded sa firmware ang lahat ng product information.

ESP32 gets:

```json
{
  "unit_price": 10,
  "low_stock_threshold": 5,
  "tamper_alarm_enable": true
}
```

Then gets:

```json
[
  {
    "slot": "S1",
    "product": "Regular Pad",
    "price": 10,
    "stock": 25
  },
  {
    "slot": "S2",
    "product": "Overnight Pad",
    "price": 10,
    "stock": 18
  }
]
```

May `machine_settings` at `slots` tables na ang current design para rito. 

ESP32 keeps a local copy:

```cpp
struct Slot {
    int id;
    String code;
    String product;
    int stock;
    float price;
};

Slot slots[5];
```

Para kahit temporarily mawala ang internet, alam pa rin niya ang current machine configuration.

---

# 6. Main customer workflow

Recommended customer workflow:

```text
READY
   ↓
Select Product
   ↓
S1/S2/S3/S4/S5
   ↓
Check local stock
   ↓
Display Product + Price
   ↓
Choose payment
   ├────────────┐
   │            │
 COIN         GCASH
   │            │
   └─────┬──────┘
         ↓
 PAYMENT VERIFIED
         ↓
 MOTOR DISPENSE
         ↓
 IR VERIFICATION
         ↓
 TRANSACTION SUCCESS
         ↓
 STOCK -1
         ↓
 SYNC TO SERVER
```

---

# 7. Coin payment workflow

README already defines pulse-based coin payment. 

Example:

```text
Customer selects S2

LCD:
Overnight Pad
Price: P10

INSERT COIN
```

Coin acceptor sends pulses.

Example configuration:

```text
₱1  = configured pulse
₱5  = configured pulse
₱10 = configured pulse
```

ESP32:

```cpp
credit += detectedCoin;
```

LCD:

```text
PRICE: P10
CREDIT: P5
```

Kapag:

```cpp
credit >= slotPrice
```

then:

```text
Payment accepted
      ↓
Motor S2 ON
      ↓
wait for IR2
```

---

# 8. Dispensing logic

Ito ang isa sa pinakamahalagang firmware sections.

Pseudo-flow:

```cpp
bool dispense(int slot)
{
    activateRelay(slot);

    unsigned long start = millis();

    while (millis() - start < DISPENSE_TIMEOUT) {

        if (productDetected(slot)) {

            deactivateRelay(slot);

            confirmSale(slot);

            return true;
        }
    }

    deactivateRelay(slot);

    reportDispenseFailure(slot);

    return false;
}
```

Success:

```text
Relay ON
↓
Motor rotates
↓
Product falls
↓
IR beam triggered
↓
Relay OFF
↓
SUCCESS
```

Failure:

```text
Relay ON
↓
Motor rotates
↓
No IR event
↓
Timeout
↓
Relay OFF
↓
DISPENSE FAILED
```

**Huwag mag-deduct ng inventory kung walang IR confirmation.**

---

# 9. Successful sale → server synchronization

Pag confirmed na ng IR:

```text
Local Slot Stock
25 → 24
```

then ESP32 sends transaction.

Existing README endpoint concept:

```http
POST /transactions
```

with:

```json
{
  "ref_code": "PLS-0525",
  "method": "coin",
  "slot_id": 2,
  "amount": 10
}
```

At may separate stock update workflow din sa README. 

Pero irerecommend kong i-improve natin ito.

Instead of:

```text
POST transaction
PATCH stock
```

gumawa tayo ng isang device endpoint:

```http
POST https://vending.machine.com/api/device/dispense
```

Example:

```json
{
  "machine_id": "VM001",
  "transaction_id": "VM001-98432",
  "slot": "S2",
  "payment": "coin",
  "amount": 10,
  "dispensed": true
}
```

Server ang gagawa ng:

```text
INSERT transaction
+
stock = stock - 1
+
check low stock
+
create notification if necessary
```

Mas safe ito dahil isang server operation lang.

---

# 10. GCash workflow

Existing system mo already has an interesting flow:

```text
Select Slot
↓
Choose GCash
↓
Scan QR
↓
Customer pays
↓
Enter GCash Reference
↓
ESP32 sends reference
↓
Dashboard shows pending payment
↓
Admin Approve / Reject
↓
ESP32 checks approval
↓
Approved
↓
Dispense
```

Ito mismo ang defined workflow ng README. 

LCD example:

```text
ENTER GCASH REF
__________
```

Keypad:

```text
0-9 = number
*   = backspace
#   = submit
A   = cancel
```

Then:

```http
POST /gcash_payments
```

```json
{
  "ref_code": "992311234",
  "slot_id": 3,
  "amount": 10,
  "status": "pending"
}
```

Admin dashboard:

```text
GCash Payment

Ref: 992311234
Amount: P10
Slot: S3

[ APPROVE ] [ REJECT ]
```

The README already exposes this queue in the Transactions view. 

---

# 11. ESP32 waits for GCash approval

LCD:

```text
VERIFYING GCASH
PLEASE WAIT...
```

ESP32:

```text
GET payment status
every 3–5 seconds
```

Response:

```json
{
  "status": "pending"
}
```

or:

```json
{
  "status": "approved"
}
```

Approved:

```text
GCash Approved
Dispensing...
```

Rejected:

```text
Payment Rejected
Contact Admin
```

The current README already defines GET polling of `gcash_payments` for this purpose. 

---

# 12. Inventory synchronization

I would make the server database the **official inventory record**, while ESP32 maintains a local operational copy.

Example:

```text
Supabase:
S1 stock = 20

ESP32 boots:
downloads stock = 20

Customer buys:
ESP32 local = 19

successful dispense:
API transaction sent

Server:
20 → 19
```

Admin can also restock:

```text
Dashboard:

S1
Regular Pad

Stock: 4

[ + Add Stock ]
```

Admin enters:

```text
20
```

Server:

```text
stock = 24
```

ESP32 periodically refreshes:

```text
GET configuration

every ~30–60 seconds
```

or receives a version-change indication.

---

# 13. Offline mode

Ito ang irerecommend kong idagdag sa current README implementation.

Huwag i-disable ang vending machine dahil lang walang Internet.

ESP32 stores locally:

```text
transaction queue

TX001 pending
TX002 pending
TX003 pending
```

Example:

```json
{
  "transaction_id": "VM001-000123",
  "slot": "S1",
  "payment": "coin",
  "amount": 10,
  "timestamp": 1789004552,
  "synced": false
}
```

When Internet reconnects:

```text
ESP32
↓
find unsynced transactions
↓
POST TX001
↓
server ACK
↓
mark synced
↓
POST TX002
...
```

So:

```text
NO INTERNET

Coin purchases:
YES

GCash manual online verification:
NO / temporarily unavailable

Stock local:
YES

Dashboard synchronization:
Queued
```

---

# 14. SIM800L role

Sa README, ang SIM800L primarily ay ginagamit para sa GSM/SMS side, while HTTPS REST is described over Wi-Fi. 

Recommended roles:

```text
SIM800L
│
├── Tamper alert
├── Low stock SMS
├── Machine fault SMS
├── Internet offline alert
└── optional future cellular API connection
```

Example:

```text
4Peace Alert

VM001
LOW STOCK
Slot: S3
Remaining: 4
```

---

# 15. Vibration / anti-tamper system

README already says vibration can trigger buzzer, SMS, health log, and notification. 

Flow:

```text
SW-420 detects strong vibration
          ↓
ESP32 verifies repeated vibration
          ↓
Buzzer alarm
          ↓
Create tamper event
          ↓
Internet available?
    ┌─────┴──────┐
   YES           NO
    │             │
Supabase       SIM800L SMS
Notification
```

I wouldn't trigger on every single vibration because the vending motor itself can create vibration.

Better:

```cpp
if (vibrationCount >= 3 within 2 seconds)
    triggerTamper();
```

Values must be calibrated sa actual cabinet.

---

# 16. Device health reporting

May `device_health` design na ang README para sa:

* uptime
* coin pulses
* SIM800L signal
* buck voltage
* tamper state
* coin box count
* last sync



ESP32 can send:

```json
{
  "esp32_uptime_seconds": 612800,
  "coin_pulses_session": 50,
  "sim800l_signal_pct": 85,
  "buck1_voltage": 5.03,
  "buck2_voltage": 4.19,
  "tamper_status": "idle",
  "coin_box_pulses_total": 745
}
```

You can send this every:

```text
30–60 seconds
```

for prototype.

---

# 17. Website screens already map nicely to hardware

Ang existing dashboard architecture mo ay halos kumpleto na para dito.

`Overview`

```text
Total Stock
Today's Sales
Coin Sales
GCash Sales
Low Stock
Recent transactions
```

`Slots`

```text
S1  Regular Pad    23/30
S2  Overnight      10/20
S3  Pantyliner      4/20 LOW
```

`Transactions`

```text
Pending GCash
Approved GCash
Coin transactions
Dispense history
```

`Health`

```text
ESP32 Online
SIM800 Signal
5V Supply
4.2V Supply
Coin Counter
Tamper Status
```

`Notifications`

```text
LOW STOCK
TAMPER
MOTOR FAILURE
GCASH REQUEST
```

`Settings`

```text
Product
Price
Capacity
Threshold
Admin GSM #
Tamper ON/OFF
```

Ito mismo ang documented dashboard organization.  

---

# 18. Important change sa current API architecture

Ito ang isang bagay na babaguhin ko bago production.

Currently, README says ESP32 directly calls Supabase REST using:

```http
apikey: SUPABASE_PUBLISHABLE_KEY
Authorization: Bearer SUPABASE_PUBLISHABLE_KEY
```



At may development instruction pa na nagdi-disable ng Row Level Security. 

Okay iyon habang prototype/testing.

Pero **hindi iyon ang gusto kong production architecture**.

Instead:

```text
ESP32
 │
 │ device key
 ▼
vending.machine.com/api/device/*
 │
 ▼
Server / Supabase Edge Function
 │
 ▼
Supabase Database
```

Example:

```http
POST /api/device/VM001/transaction
Authorization: Bearer DEVICE_SPECIFIC_TOKEN
```

ESP32 should **never have admin-level database permissions**.

At ibalik ang RLS sa production.

---

# 19. Recommended API for your final system

Hindi natin kailangang gumawa ng napakaraming endpoint.

For ESP32, sapat initially ang:

```text
GET  /api/device/config

POST /api/device/transaction

POST /api/device/gcash

GET  /api/device/gcash/{reference}

POST /api/device/health

POST /api/device/alert

POST /api/device/sync
```

### Config

```http
GET /api/device/config
```

returns:

```json
{
  "machine_id": "VM001",

  "settings": {
    "low_stock": 5,
    "tamper": true
  },

  "slots": [
    {
      "id": 1,
      "code": "S1",
      "product": "Regular Pad",
      "price": 10,
      "stock": 25
    }
  ]
}
```

### Successful sale

```http
POST /api/device/transaction
```

```json
{
  "transaction_id": "VM001-12345",
  "slot": "S1",
  "method": "coin",
  "amount": 10
}
```

Backend automatically:

```text
create transaction
↓
stock - 1
↓
check threshold
↓
create low-stock notification if needed
```

---

# 20. Firmware architecture

Huwag natin gawing isang malaking `loop()` ang buong code.

Recommended modules:

```text
src/

main.cpp

config/
  pins.h
  device_config.h

hardware/
  lcd.cpp
  keypad.cpp
  coin.cpp
  motor.cpp
  ir_sensor.cpp
  vibration.cpp
  buzzer.cpp
  gsm.cpp

network/
  wifi.cpp
  api.cpp
  sync.cpp

services/
  vending.cpp
  payment.cpp
  inventory.cpp
  transaction.cpp
  alert.cpp

storage/
  local_storage.cpp
```

`main.cpp` should basically coordinate them.

---

# 21. Main vending state machine

Ito ang pinaka-importanteng software design.

```text
BOOT
 ↓
SYNC_CONFIG
 ↓
IDLE
 ↓
PRODUCT_SELECTED
 ↓
PAYMENT
 ├── COIN
 └── GCASH
 ↓
PAYMENT_CONFIRMED
 ↓
DISPENSING
 ↓
VERIFY_IR
 ├── SUCCESS
 │      ↓
 │   RECORD SALE
 │      ↓
 │   STOCK -1
 │      ↓
 │    READY
 │
 └── FAILURE
        ↓
     MOTOR OFF
        ↓
      ERROR
```

With status enum:

```cpp
enum MachineState {
    BOOTING,
    SYNCING,
    IDLE,
    SELECT_PRODUCT,
    ACCEPTING_COIN,
    GCASH_WAITING,
    DISPENSING,
    VERIFYING_DROP,
    SUCCESS,
    ERROR_STATE
};
```

---

# 22. Implementation order

Huwag agad pagsabay-sabayin lahat.

Ang pinakamagandang development sequence ay:

1. **ESP32 + LCD + keypad** — makapili ng S1–S5 at makita sa LCD.
2. **Coin acceptor** — detect ₱1/₱5/₱10 at display running credit.
3. **One relay + one motor + one IR sensor** — gumawa muna ng fully working Slot 1.
4. **Complete one vending transaction** — `select → coin → motor → IR → success`.
5. **Connect ESP32 to Supabase/API** — download slot information and upload transaction.
6. **Add all five slots** — Relay/Motor/IR S1–S5.
7. **Inventory synchronization** — successful IR detection deducts stock and appears instantly sa dashboard.
8. **GCash workflow** — keypad reference → dashboard approval → ESP32 dispense.
9. **SIM800L + vibration sensor** — tamper and low-stock SMS.
10. **Offline queue + retry + production security** — transaction IDs, sync recovery, API proxy/device tokens, RLS.
11. **Final stress tests** — hundreds of coin inputs, repeated vends, motor jams, no Internet, reboot during transaction, IR failure, tamper events.

---

## Target final flow

Ang magiging final architecture natin ay:

```text
CUSTOMER
   │
   ├── COIN
   │
   └── GCASH
         ↓
       ESP32
         │
 ┌───────┼──────────────┐
 │       │              │
LCD    Keypad        Sensors
 │       │         IR / Vibration
 └───────┼──────────────┘
         ↓
    Relay / Motor
         ↓
     PRODUCT DROP
         ↓
      IR CONFIRM
         ↓
   LOCAL TRANSACTION
         ↓
       HTTPS
         ↓
 DEVICE API / SUPABASE
         ↓
 ┌───────┼──────────┐
 │       │          │
Sales Inventory   Health
 │       │          │
 └───────┼──────────┘
         ↓
vending.machine.com
 ADMIN DASHBOARD
```

So ang pinaka-goal natin ay **one verified physical vend = one transaction = one inventory deduction**. Website editing/restocking changes the backend configuration, ESP32 periodically synchronizes it, at lahat ng actual sales ay nanggagaling sa ESP32 pagkatapos lamang ma-confirm ng corresponding IR sensor.

Ang next logical artifact para dito ay gumawa ng **exact ESP32 pin assignment + S1–S5 wiring table + API contract + firmware folder/code plan** based sa actual ESP32 board at relay count mo. Iyon na ang puwede nating sundan step-by-step habang binubuo ang prototype.

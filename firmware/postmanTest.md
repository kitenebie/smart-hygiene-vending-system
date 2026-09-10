# 4Peace firmware — Postman HTTP test guide

This guide tests the same HTTPS requests sent by `08_supabase.ino`. Start with
the read-only requests. The write requests are clearly marked because they alter
dashboard data, inventory, or payment records.

## 1. Create a Postman environment

Create an environment named `4Peace Firmware` and add these variables. Copy the
values from the ignored `firmware/4peace_esp32_firmware/config.local.h` file.
Do not commit, export publicly, or send the device token to anyone.

| Variable | Value source | Example format |
| --- | --- | --- |
| `supabaseUrl` | `SUPABASE_URL` | `https://your-project.supabase.co` |
| `supabaseKey` | `SUPABASE_KEY` | `sb_publishable_...` |
| `deviceApiKey` | `DEVICE_API_KEY` | Your private device token |
| `machineId` | `MACHINE_ID` | `VM001` |
| `healthId` | `DEVICE_HEALTH_ID` | `1` |
| `slotId` | Existing slot ID from Slots test | `1` |
| `amount` | Current `machine_settings.unit_price` | `10` |
| `testRef` | Create once per GCash test | `PM-20260910-001` |
| `deviceTxId` | Create once per vend test, 8+ chars | `PM-COIN-20260910-001` |

Use these common headers in every request:

| Header | Value |
| --- | --- |
| `apikey` | `{{supabaseKey}}` |
| `Content-Type` | `application/json` for POST/PATCH requests |

The current firmware sends only `apikey` when using a modern
`sb_publishable_...` key. If your key is the older JWT-style key beginning with
`eyJ`, add `Authorization: Bearer {{supabaseKey}}` too.

## 2. Safe read-only requests

These requests do not change Supabase data and should return HTTP `200`.

### A. Read slots

```http
GET {{supabaseUrl}}/rest/v1/slots?select=id,slot_code,product_name,stock,capacity&order=id.asc
apikey: {{supabaseKey}}
```

Expected: an array containing S1 through S5. Set `slotId` to the `id` of a slot
with stock above zero if you later do a controlled real-vend test.

### B. Read current firmware settings

```http
GET {{supabaseUrl}}/rest/v1/machine_settings?select=unit_price,low_stock_threshold,admin_sms_number,tamper_alarm_enabled&order=id.desc&limit=1
apikey: {{supabaseKey}}
```

Expected: one settings object. Confirm `unit_price` matches `amount` and the
property name is `tamper_alarm_enabled`.

### C. Read device health

```http
GET {{supabaseUrl}}/rest/v1/device_health?id=eq.{{healthId}}&select=*
apikey: {{supabaseKey}}
```

Expected: one row with `last_sync`, uptime, coin counts, and signal fields.

### D. Read GCash payment status

```http
GET {{supabaseUrl}}/rest/v1/gcash_payments?ref_code=eq.{{testRef}}&select=status,consumed_at,slot_id,amount&limit=1
apikey: {{supabaseKey}}
```

Expected: `[]` before a test reference is submitted, or one matching record
after it is submitted.

### E. Safe `complete_vend` RPC authentication check

This request reaches the device RPC and validates the device token, but it uses
slot `0`, which does not exist. It cannot decrement real stock or create a sale.

```http
POST {{supabaseUrl}}/rest/v1/rpc/complete_vend
apikey: {{supabaseKey}}
Content-Type: application/json

{
  "p_device_key": "{{deviceApiKey}}",
  "p_device_tx_id": "PM-RPC-CHECK-001",
  "p_machine_id": "{{machineId}}",
  "p_ref_code": "",
  "p_method": "coin",
  "p_slot_id": 0,
  "p_amount": {{amount}}
}
```

Expected: HTTP `400` with `"message": "slot not found"`. That response proves
the URL, publishable key, device token, request JSON, and RPC function are all
being reached. If it says `invalid device key`, run `npm run firmware:configure`
and flash the refreshed firmware configuration.

## 3. Firmware-equivalent write requests

Run these only when you intend to create or update the indicated dashboard data.
Use a `PM-...` prefix for test references and messages so they are identifiable
in the Supabase Table Editor.

### A. Send device health heartbeat

This updates the actual `device_health` row used by the dashboard.

```http
PATCH {{supabaseUrl}}/rest/v1/device_health?id=eq.{{healthId}}
apikey: {{supabaseKey}}
Content-Type: application/json
Prefer: return=representation

{
  "esp32_uptime_seconds": 12345,
  "coin_pulses_session": 0,
  "coin_box_pulses_total": 0,
  "tamper_status": "idle",
  "sim800l_signal_pct": 80
}
```

Expected: HTTP `200` and one updated row. `last_sync` should advance
automatically. Do not use fake values while the real ESP32 is running.

### B. Submit a pending GCash reference

This creates a visible pending GCash row; it does not vend an item.

```http
POST {{supabaseUrl}}/rest/v1/gcash_payments
apikey: {{supabaseKey}}
Content-Type: application/json
Prefer: return=representation

{
  "ref_code": "{{testRef}}",
  "slot_id": {{slotId}},
  "amount": {{amount}},
  "status": "pending"
}
```

Expected: HTTP `201`. A repeated `testRef` should return `409` because reference
codes are unique. Approve or reject the new record from the dashboard before
using it for a GCash completion test.

### C. Check approved GCash reference

Repeat the read request from section 2-D after approving the payment in the
dashboard. Expected state before vending:

```json
[
  {
    "status": "approved",
    "consumed_at": null,
    "slot_id": 1,
    "amount": 10
  }
]
```

After a successful firmware vend, `consumed_at` must contain a timestamp. The
project deliberately retains `status: "approved"`; the non-null `consumed_at`
field is the fulfillment marker.

### D. Create a firmware log entry

This adds one dashboard health-log row.

```http
POST {{supabaseUrl}}/rest/v1/machine_health_logs
apikey: {{supabaseKey}}
Content-Type: application/json
Prefer: return=representation

{
  "level": "info",
  "message": "PM-HTTP test: machine log endpoint reached"
}
```

Expected: HTTP `201` and one created row.

### E. Create a firmware notification

This adds one dashboard notification.

```http
POST {{supabaseUrl}}/rest/v1/notifications
apikey: {{supabaseKey}}
Content-Type: application/json
Prefer: return=representation

{
  "type": "system",
  "level": "info",
  "message": "PM-HTTP test: notification endpoint reached",
  "is_read": false
}
```

Expected: HTTP `201` and one created row.

## 4. Real vend RPC — only after a physical confirmed dispense

`complete_vend` deducts cloud stock and inserts a transaction. It does **not**
turn on a motor. Do not use this merely to test a connection; call it only after
the connected ESP32 has physically dispensed and its IR sensor confirmed the
drop, or use the safe slot-0 RPC check above.

### Coin vend payload

```http
POST {{supabaseUrl}}/rest/v1/rpc/complete_vend
apikey: {{supabaseKey}}
Content-Type: application/json

{
  "p_device_key": "{{deviceApiKey}}",
  "p_device_tx_id": "{{deviceTxId}}",
  "p_machine_id": "{{machineId}}",
  "p_ref_code": "",
  "p_method": "coin",
  "p_slot_id": {{slotId}},
  "p_amount": {{amount}}
}
```

Expected successful response:

```json
{
  "success": true,
  "duplicate": false,
  "stock": 19
}
```

Send the exact same payload one more time only to verify replay protection. The
expected response has `"duplicate": true` and the same stock value; stock must
not decrement twice.

### GCash vend changes

For GCash, use the approved `{{testRef}}` in `p_ref_code` and set
`p_method` to `"gcash"`. The payload amount and slot must exactly match the
approved payment. A successful response sets that payment's `consumed_at`.

## 5. Postman test snippets

Add one of these in the **Tests** tab when useful.

```javascript
pm.test('Response is successful', () => {
  pm.expect(pm.response.code).to.be.oneOf([200, 201]);
});
```

For the safe RPC check:

```javascript
pm.test('RPC rejects the nonexistent slot after authenticating', () => {
  pm.response.to.have.status(400);
  pm.expect(pm.response.json().message).to.eql('slot not found');
});
```

For a real successful vend:

```javascript
pm.test('Vend completed once', () => {
  pm.response.to.have.status(200);
  const body = pm.response.json();
  pm.expect(body.success).to.eql(true);
  pm.expect(body.stock).to.be.a('number');
});
```

## 6. Troubleshooting

| Response | Meaning | Next check |
| --- | --- | --- |
| `200` / `201` | Request reached Supabase successfully | Inspect the returned row or dashboard. |
| `401` / `403` | Key is missing, invalid, or not allowed | Re-copy `SUPABASE_KEY`; never use a service-role/secret key in firmware. |
| `409` on GCash POST | `ref_code` already exists | Change `testRef`; do not reuse an already consumed payment. |
| `400 invalid device key` | RPC was reached but token does not match `machine_settings` | Run `npm run firmware:configure`, then rebuild and flash. |
| `400 gcash payment is not approved` | Payment is still pending/rejected | Approve it in the dashboard, then re-check its status. |
| `400 slot is out of stock` | Slot stock is zero | Refill/update the correct slot before a real vend. |
| SSL or timeout | Device cannot complete HTTPS | Check 2.4 GHz Wi-Fi, DNS/internet, and NTP access for TLS time validation. |

The guide follows Supabase's Data API and RPC conventions. See the official
[API key guide](https://supabase.com/docs/guides/getting-started/api-keys) and
[RPC reference](https://supabase.com/docs/reference/javascript/rpc) for the
platform behavior behind these requests.

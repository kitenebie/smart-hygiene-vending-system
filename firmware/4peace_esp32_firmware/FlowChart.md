# 4Peace ESP32 Offline-First Workflow

```mermaid
flowchart TD
    power([Power on]) --> mount[Mount LittleFS]
    mount --> online{WiFi connected?}

    online -->|No| cached{Valid local JSON cache?}
    cached -->|Yes| ready([Offline ready])
    cached -->|No| wait[Wait for WiFi]
    wait -.-> online

    online -->|Yes| initial[Initial data sync]
    initial --> configFetch[Fetch machine settings]
    configFetch --> configSave[Save machine_config JSON]
    configSave --> salesPending{Pending sales?}
    salesPending -->|Yes| startupUpload[Upload queued sales]
    startupUpload --> salesPending
    salesPending -->|No| slotsFetch[Fetch slots]
    slotsFetch --> slotsSave[Save slots JSON]
    slotsSave --> ready

    ready --> select[/Customer selects item/]
    select --> payment{GCash payment?}
    payment -->|No| coin[Accept coin payment]
    coin --> dispense[Dispense item]
    payment -->|Yes| gcash[Submit and verify GCash online]
    gcash --> approved{Payment approved?}
    approved -->|No| select
    approved -->|Yes| dispense

    dispense --> localSave[Update slots JSON]
    localSave --> journal[Save transaction journal]
    journal --> complete([Vend complete])

    complete -.->|Every 30 seconds while idle| poll[Idle sync poll]
    poll --> cloudUpload[Upload completed sales]
    cloudUpload --> supabase[(Supabase database)]
    supabase --> uploadOk{Upload successful?}
    uploadOk -->|No| poll
    uploadOk -->|Yes| refresh[Refresh config and slots]
    refresh --> configFetch
```

## Rules represented by the flow

- A first boot cannot vend until `machine_config.json` and `slots.json` have
  both been downloaded and saved to LittleFS.
- A later reboot may operate without WiFi when both JSON cache files are valid.
- GCash reference submission and payment approval require an internet connection.
- After payment approval, physical dispensing and stock reduction use local
  LittleFS data first.
- Each completed sale is placed in the durable transaction journal. The ESP32
  uploads it to Supabase only during the idle 30-second sync cycle.

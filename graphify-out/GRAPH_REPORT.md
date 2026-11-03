# Graph Report - react-app  (2026-11-03)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 310 nodes · 631 edges · 20 communities (12 shown, 8 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `04e0082f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- DashboardPage.tsx
- app.js
- package.json
- SettingsView.tsx
- export-legacy-mysql-to-supabase.mjs
- App.tsx
- compilerOptions
- compilerOptions
- HealthView.tsx
- supabase_sync.php
- .oxlintrc.json
- Sidebar.tsx
- Topbar.tsx
- tsconfig.json

## God Nodes (most connected - your core abstractions)
1. `api()` - 23 edges
2. `toast()` - 22 edges
3. `react` - 19 edges
4. `usePolling()` - 18 edges
5. `timeAgo()` - 18 edges
6. `compilerOptions` - 18 edges
7. `useToast()` - 17 edges
8. `useRealtimeRefresh()` - 17 edges
9. `DashboardPage()` - 17 edges
10. `SettingsView()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `HealthView()` --calls--> `useToast()`  [EXTRACTED]
  src/views/HealthView.tsx → src/components/Toast.tsx
- `SettingsView()` --calls--> `useToast()`  [EXTRACTED]
  src/views/SettingsView.tsx → src/components/Toast.tsx
- `HealthView()` --calls--> `usePolling()`  [EXTRACTED]
  src/views/HealthView.tsx → src/hooks/usePolling.ts
- `HealthView()` --calls--> `useRealtimeRefresh()`  [EXTRACTED]
  src/views/HealthView.tsx → src/hooks/useRealtimeRefresh.ts
- `App()` --calls--> `DashboardPage()`  [EXTRACTED]
  src/App.tsx → src/pages/DashboardPage.tsx

## Import Cycles
- None detected.

## Communities (20 total, 8 thin omitted)

### Community 0 - "DashboardPage.tsx"
Cohesion: 0.09
Nodes (50): react, Sidebar(), extraMeta, SlotTag(), SlotTagProps, Status, StatCard(), StatCardProps (+42 more)

### Community 1 - "app.js"
Cohesion: 0.11
Nodes (49): activateView(), api(), closeMobileMenu(), closePinModal(), closeRestockModal(), currentSlots, escapeHTML(), esp32Pins (+41 more)

### Community 2 - "package.json"
Cohesion: 0.05
Nodes (36): dependencies, apexcharts, react, react-apexcharts, react-dom, react-router-dom, @supabase/supabase-js, devDependencies (+28 more)

### Community 3 - "SettingsView.tsx"
Cohesion: 0.12
Nodes (21): allEsp32Pins, Esp32PinStatusModal(), Esp32PinStatusModalProps, PinDevice, PinDeviceAssignment, PinStatus, priorityPinLabels, Switch() (+13 more)

### Community 4 - "export-legacy-mysql-to-supabase.mjs"
Cohesion: 0.10
Nodes (11): files, migrations, output, sql, output, tables, values, env (+3 more)

### Community 5 - "App.tsx"
Cohesion: 0.19
Nodes (12): react-dom, react-router-dom, App(), AuthGuard(), NotificationSound(), ToastProvider(), AdminUser, AuthContext (+4 more)

### Community 6 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+11 more)

### Community 7 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 8 - "HealthView.tsx"
Cohesion: 0.24
Nodes (12): formatUptime(), buildTemperatureTimeline(), formatBytes(), HealthView(), load(), LogEntry, Metric, minuteStart() (+4 more)

### Community 10 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 11 - "Sidebar.tsx"
Cohesion: 0.50
Nodes (3): navItems, SidebarProps, View

### Community 12 - "Topbar.tsx"
Cohesion: 0.67
Nodes (3): syncText(), Topbar(), TopbarProps

## Knowledge Gaps
- **5 isolated node(s):** `oxlint`, `@types/node`, `@types/react`, `@types/react-dom`, `typescript`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 157 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `DashboardPage.tsx` to `package.json`, `SettingsView.tsx`, `App.tsx`, `HealthView.tsx`, `Sidebar.tsx`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **What connects `oxlint`, `@types/node`, `@types/react` to the rest of the system?**
  _5 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `DashboardPage.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08819875776397515 - nodes in this community are weakly interconnected._
- **Why does `SettingsView()` connect `SettingsView.tsx` to `DashboardPage.tsx`, `App.tsx`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10938775510204081 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._
- **Should `SettingsView.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
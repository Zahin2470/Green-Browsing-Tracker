# Green Browsing Tracker — Extension + Dashboard

**Purpose:** A Chrome browser extension (Manifest V3) that monitors browsing sessions, collects page-level telemetry (transfer size, resource count, load times), estimates energy/carbon per visit with configurable factors, and stores aggregated data locally. Includes a built-in Dashboard page (extension page) that visualizes historical usage, top sites, and provides optimization suggestions.

---

## What’s included in this project

```
green-browsing-tracker/
├── server
│   ├── package.json
│   ├── server.js
├── manifest.json
├── service_worker.js
├── content_script.js
├── popup.html
├── popup.js
├── dashboard.html
├── dashboard.js
├── options.html
├── options.js
├── styles.css
├── visits.csv
└── README.md
```

- All UI pages use Chart.js via CDN; no build step required — run directly in Chrome as an unpacked extension.
- Data is stored in `chrome.storage.local` as an array of visit records and aggregated metrics.
- You can export data as CSV from the dashboard.

---

## Design & Data Model

**Visit record (example):**
```json
{
  "id": "uuid-v4",
  "ts": "2025-10-31T15:02:25.123Z",
  "url": "https://example.com/article",
  "origin": "example.com",
  "title": "Example — Article",
  "transferBytes": 1245678,
  "resourceCount": 42,
  "domSize": 52345,
  "loadTimeMs": 3210,
  "firstContentPaintMs": 900,
  "longTasks": 2,
  "estimatedEnergy_mJ": 0.0, // computed locally using factor
  "estimatedCO2_g": 0.0,    // computed locally using factor
  "notes": {}
}
```

**Estimation formula (configurable):**
- `energy_mJ = transferBytes * energyFactor_mJ_per_byte`
- `co2_g = transferBytes * co2Factor_g_per_byte`

Defaults (conservative, configurable in Options):
- `energyFactor_mJ_per_byte = 1e-6` (0.001 mJ per KB) — *You can change this to match literature or calibration.*
- `co2Factor_g_per_byte = 1e-6` (0.001 g per KB)

> _Note:_ Exact conversion factors vary widely in literature. The extension provides a transparent configurable factor so you can cite sources or calibrate with more accurate numbers. If you want, I can look up current recommended factors and integrate them.

---

## How it works (high level)

1. `content_script.js` runs on page load and collects performance entries (`performance.getEntriesByType('resource')`) and other metrics (loadEventEnd, DOM size). It computes `transferBytes` by summing `transferSize` fields (browser may zero some due to cross-origin or caching; the best-effort approach is used).
2. It sends a message to the `service_worker.js` with the visit record.
3. `service_worker.js` stores visit records in `chrome.storage.local` and updates lightweight aggregates (per-origin totals, daily totals).
4. `dashboard.html` reads stored records and renders visualizations (time-series, top sites, per-visit detail) using Chart.js and provides CSV export and optimization tips.
5. `options.html` lets you set estimation factors and sampling options.

---

## Security & privacy
- All data is stored locally (chrome.storage.local). Nothing is uploaded by default.
- You can export data to CSV manually. If you need remote sync, additional consent and a server should be implemented.
- The extension only collects page telemetry (transfer sizes, timings) and not user keystrokes or form data.

---

## Installation & Running (on macOS, VS Code)
1. Open VS Code and clone/copy this extension folder into a working directory.
2. Optionally open the folder in VS Code for editing.
3. Open Chrome/Brave on your Mac (M1) and go to `chrome://extensions/`.
4. Toggle **Developer mode** on (top-right).
5. Click **Load unpacked** and select the `green-browsing-tracker` folder.
6. The extension will appear; open the popup or open the dashboard via `chrome-extension://<ext-id>/dashboard.html` (click "service worker" details to find extension id) or use the Extensions page "Inspect views" for quick links.


### README.md (Quick start)

```markdown
# Green Browsing Tracker

## Quick start (Chrome)
1. Copy the folder into your machine.
2. Open `chrome://extensions/` in Chrome.
3. Enable Developer Mode.
4. Click `Load unpacked` and select this folder.
5. Browse normally; open the extension popup and the Dashboard to view data.

## Notes
- All data is stored locally via `chrome.storage.local`.
- Estimation factors are configurable in Options.
- The extension purposefully does not send data anywhere by default.
```

// server/server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.warn('better-sqlite3 not available or failed to build — falling back to in-memory DB. For persistent storage install better-sqlite3 and a C++ toolchain (or use Node versions with prebuilt binaries).', e && e.message);
  // Minimal in-memory DB fallback implementing the small subset used by server.js
  Database = class InMemoryDB {
    constructor() {
      this.visits = new Map();
    }
    exec() { /* no-op for schema creation */ }
    prepare(sql) {
      const s = (sql || '').toLowerCase();
      if (s.startsWith('insert') || s.includes('insert or replace')) {
        return {
          run: (id, ts, url, origin, transferBytes = 0, resourceCount = 0, loadTimeMs = 0, estimatedCO2_g = 0, raw) => {
            try {
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
              this.visits.set(id, { id, ts, url, origin, transferBytes, resourceCount, loadTimeMs, estimatedCO2_g, raw: parsed });
            } catch (err) {
              this.visits.set(id, { id, ts, url, origin, transferBytes, resourceCount, loadTimeMs, estimatedCO2_g, raw });
            }
            return { changes: 1 };
          }
        };
      }
      if (s.startsWith('select') && s.includes('substr(ts,1,10) as day')) {
        return {
          all: () => {
            // aggregate by day
            const map = {};
            for (const v of this.visits.values()) {
              const day = (v.ts || '').slice(0, 10);
              if (!map[day]) map[day] = { day, visits: 0, bytes: 0, co2: 0 };
              map[day].visits += 1;
              map[day].bytes += Number(v.transferBytes || 0);
              map[day].co2 += Number(v.estimatedCO2_g || 0);
            }
            return Object.values(map).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 365);
          }
        };
      }
      if (s.startsWith('select')) {
        return {
          all: () => {
            // simple visits list (limit handled by caller)
            return Array.from(this.visits.values())
              .map(r => ({ id: r.id, ts: r.ts, origin: r.origin, url: r.url, transferBytes: r.transferBytes, estimatedCO2_g: r.estimatedCO2_g }))
              .sort((a, b) => (b.ts || '').localeCompare(a.ts))
              .slice(0, 1000);
          }
        };
      }
      return {
        run: () => ({}),
        all: () => []
      };
    }
  };
}
const fetch = require('node-fetch'); // npm i node-fetch@2

const DB = new Database('visits.db');
DB.exec(`CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  ts TEXT,
  url TEXT,
  origin TEXT,
  transferBytes INTEGER,
  resourceCount INTEGER,
  loadTimeMs INTEGER,
  estimatedCO2_g REAL,
  raw JSON
)`);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Simple API-key middleware (optional)
const API_KEY = process.env.API_KEY || null;
function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (key === API_KEY) return next();
  return res.status(401).json({error: 'invalid api key'});
}

// POST ingest
app.post('/ingest', requireApiKey, (req, res) => {
  try {
    const rec = req.body;
    const stmt = DB.prepare(`INSERT OR REPLACE INTO visits (id, ts, url, origin, transferBytes, resourceCount, loadTimeMs, estimatedCO2_g, raw) VALUES (?,?,?,?,?,?,?,?,?)`);
    stmt.run(rec.id, rec.ts, rec.url, rec.origin, rec.transferBytes || 0, rec.resourceCount || 0, rec.loadTimeMs || 0, rec.estimatedCO2_g || 0, JSON.stringify(rec));
    res.json({status:'ok'});
  } catch (e) {
    console.error(e);
    res.status(500).json({error: e.message});
  }
});

// GET visits (basic)
app.get('/visits', (req, res) => {
  const rows = DB.prepare('SELECT id, ts, origin, url, transferBytes, estimatedCO2_g FROM visits ORDER BY ts DESC LIMIT 1000').all();
  res.json(rows);
});

// GET aggregates (by day)
app.get('/aggregates', (req, res) => {
  const rows = DB.prepare(`
    SELECT substr(ts,1,10) as day, COUNT(*) as visits, SUM(transferBytes) as bytes, SUM(estimatedCO2_g) as co2
    FROM visits GROUP BY day ORDER BY day DESC LIMIT 365
  `).all();
  res.json(rows);
});

// Simple in-memory country->gCO2 map for a few examples; expand as needed
const countryMap = {
  'BD': 700, // Bangladesh example (replace with real values)
  'US': 357,
  'GB': 200,
  'DE': 300,
  'GLOBAL': 445
};

// GET carbon intensity (fallback map). You can expand this or fetch external dataset
app.get('/carbon-intensity', (req, res) => {
  const country = (req.query.country || 'GLOBAL').toUpperCase();
  const g = countryMap[country] || countryMap['GLOBAL'];
  res.json({country, gCO2_per_kWh: g});
});

// (Optional) periodically fetch authoritative dataset and update in-memory map (not implemented here)
app.listen(4000, () => console.log('Server listening on :4000'));
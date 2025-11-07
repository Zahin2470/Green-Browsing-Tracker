// api/carbon-intensity.js
// Vercel serverless function (Node 18+, ESM-style default export)
// Returns { country, gCO2_per_kWh, source, lastUpdated } for a requested country code.
//
// Query:
//   GET /api/carbon-intensity?country=BD
//
// Env (optional):
//   CARBON_SOURCE_URL  - URL to a JSON/CSV dataset (if you want automatic live updates)
//   CACHE_TTL_SECONDS  - seconds to keep fetched dataset in memory (default: 24h)
//   DEFAULT_INTENSITY  - fallback global intensity in gCO2/kWh (default 445)

const DEFAULTS = {
  FALLBACK_G_CO2: Number(process.env.DEFAULT_INTENSITY || 445),
  CACHE_TTL_SECONDS: Number(process.env.CACHE_TTL_SECONDS || 24 * 3600),
  // Example static map (good to cover common cases)
  STATIC_MAP: {
    'GLOBAL': Number(process.env.DEFAULT_INTENSITY || 445),
    'US': 357,
    'GB': 200,
    'DE': 300,
    'BD': 700,
    'IN': 700,
    'CN': 681,
    'FR': 57
  }
};

// In-memory cache for remote dataset (per lambda instance)
let cachedDataset = null;
let cachedAt = 0;

async function fetchRemoteDataset(url) {
  if (!url) return null;
  const now = Date.now();
  const ttl = (Number(process.env.CACHE_TTL_SECONDS) || DEFAULTS.CACHE_TTL_SECONDS) * 1000;
  if (cachedDataset && (now - cachedAt) < ttl) {
    return cachedDataset;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('carbon-intensity: remote fetch failed', res.status);
      return null;
    }
    const contentType = res.headers.get('content-type') || '';
    let data = null;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      // try CSV => parse simple CSV with header (country, gCO2_per_kWh)
      const txt = await res.text();
      const lines = txt.split('\n').map(l => l.trim()).filter(Boolean);
      const rows = lines.slice(1).map(l => l.split(',').map(s => s.trim()));
      // form mapping { countryCode: value }
      const map = {};
      for (const r of rows) {
        if (r.length < 2) continue;
        const key = r[0].replace(/["']/g, '').toUpperCase();
        const v = parseFloat(r[1]);
        if (!Number.isNaN(v)) map[key] = v;
      }
      data = map;
    }
    cachedDataset = data;
    cachedAt = now;
    return data;
  } catch (e) {
    console.warn('carbon-intensity: fetch error', e);
    return null;
  }
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const countryQ = (url.searchParams.get('country') || 'GLOBAL').toUpperCase();
    // normalize to 2-letter where possible (if given longer codes like US-CA)
    const country = countryQ.split(/[^A-Z]/)[0] || 'GLOBAL';

    // 1) First check static map
    if (DEFAULTS.STATIC_MAP[country]) {
      return res.json({
        country,
        gCO2_per_kWh: DEFAULTS.STATIC_MAP[country],
        source: 'static_map',
        lastUpdated: null
      });
    }

    // 2) Try a remote dataset (if configured)
    const sourceUrl = process.env.CARBON_SOURCE_URL || null;
    if (sourceUrl) {
      const dataset = await fetchRemoteDataset(sourceUrl);
      if (dataset) {
        // dataset might be { 'US': 357, 'GB': 200 } or an array/object with nested values
        // Try common keys
        let found = null;
        if (Array.isArray(dataset)) {
          // array of objects: try to find matching country property
          for (const item of dataset) {
            const keys = Object.keys(item || {});
            // find probable country code field and intensity field
            const code = (item.country || item.code || item.COUNTRY || item.iso || item.ISO || item.Country)?.toString().toUpperCase();
            const val = item.gCO2_per_kWh || item.gCO2 || item.intensity || item.value || item['gCO2_per_kWh'];
            if (code === country && val !== undefined) { found = Number(val); break; }
          }
        } else if (typeof dataset === 'object') {
          // object map
          const direct = dataset[country] || dataset[countryQ];
          if (direct !== undefined) found = Number(direct);
          // sometimes dataset keyed by full country name -> try fallback by searching values
          if (!found) {
            const k = Object.keys(dataset).find(k => k.toUpperCase().startsWith(country));
            if (k) found = Number(dataset[k]);
          }
        }
        if (found !== null && !Number.isNaN(found)) {
          return res.json({
            country,
            gCO2_per_kWh: found,
            source: sourceUrl,
            lastUpdated: new Date(cachedAt).toISOString()
          });
        }
      }
    }

    // 3) fallback: return DEFAULT / global
    return res.json({
      country,
      gCO2_per_kWh: DEFAULTS.FALLBACK_G_CO2,
      source: 'fallback_default',
      lastUpdated: null
    });

  } catch (err) {
    console.error('carbon-intensity handler error', err);
    res.status(500).json({ error: 'internal_error' });
  }
}
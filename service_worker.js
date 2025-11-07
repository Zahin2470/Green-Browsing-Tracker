// service_worker.js
// Runs in background as service worker (MV3). Responsible for storing visit records and aggregates.

const DEFAULTS = {
  energyFactor_mJ_per_byte: 1e-6,
  co2Factor_g_per_byte: 1e-6
};

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', s => {
      const current = s.settings || {};
      const st = Object.assign({}, DEFAULTS, current, {
        syncEnabled: true,
        serverUrl: current.serverUrl || 'http://localhost:4000',
        apiKey: current.apiKey || ''
      });
      chrome.storage.local.set({ settings: st }, () => {
        console.log('settings saved', st);
        resolve(st); // ✅ return the settings object
      });
    });
  });
}

async function saveVisit(record) {
  const {ts, origin, transferBytes} = record;
  const settings = await getSettings();
  record.estimatedEnergy_mJ = (transferBytes || 0) * settings.energyFactor_mJ_per_byte;
  record.estimatedCO2_g = (transferBytes || 0) * settings.co2Factor_g_per_byte;

  chrome.storage.local.get(['settings'], (items) => {
    const s = Object.assign({}, DEFAULTS, items.settings || {});
    if (s.syncEnabled && s.serverUrl) {
      fetch(s.serverUrl.replace(/\/$/, '') + '/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(s.apiKey ? {'x-api-key': s.apiKey} : {})
        },
        body: JSON.stringify(record),
      }).catch(e => console.warn('sync failed', e));
    }
  });
  chrome.storage.local.get(['visits','aggregates'], (items) => {
    try {
      const visits = Array.isArray(items.visits) ? items.visits.slice() : [];

      // avoid inserting the same visit twice (same id)
      if (!visits.some(v => v && v.id === record.id)) {
        visits.push(record);
      } else {
        console.debug('saveVisit: duplicate record skipped', record.id);
      }

      // keep last 10k visits max
      while (visits.length > 10000) visits.shift();

      // update aggregates together
      const ag = items.aggregates || {byOrigin: {}, byDay: {}};
      const day = new Date(ts).toISOString().slice(0,10);
      ag.byOrigin[origin] = ag.byOrigin[origin] || {visits:0, bytes:0, co2:0};
      ag.byOrigin[origin].visits += 1;
      ag.byOrigin[origin].bytes += Number(transferBytes || 0);
      ag.byOrigin[origin].co2 = (Number(ag.byOrigin[origin].co2) || 0) + Number(record.estimatedCO2_g || 0);

      ag.byDay[day] = ag.byDay[day] || {visits:0, bytes:0, co2:0};
      ag.byDay[day].visits += 1;
      ag.byDay[day].bytes += Number(transferBytes || 0);
      ag.byDay[day].co2 = (Number(ag.byDay[day].co2) || 0) + Number(record.estimatedCO2_g || 0);

      // write both keys in a single set call to reduce race windows
      chrome.storage.local.set({visits, aggregates: ag}, () => {
        console.debug('saveVisit: stored', {id: record.id, ts: record.ts, origin});
      });
    } catch (err) {
      console.error('saveVisit: storage update failed', err);
    }
  });
}

// Listen to messages from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'visit-record') {
    saveVisit(msg.record).then(() => sendResponse({status: 'ok'}));
    // return true to indicate async response
    return true;
  }
});

// Optional: provide an API to export data to CSV via chrome.runtime
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'visit-record') {
    saveVisit(msg.record).then(() => sendResponse({ status: 'ok' }));
    return true; // async
  }
  if (msg.type === 'export-csv') {
    chrome.storage.local.get(['visits'], (items) => {
      const visits = items.visits || [];
      const header = ['ts','origin','url','title','transferBytes','resourceCount','loadTimeMs','estimatedCO2_g'];
      const rows = visits.map(v => header.map(h => JSON.stringify(v[h]||'')).join(',')).join('\n');
      const csv = header.join(',') + '\n' + rows;
      sendResponse({ csv });
    });
    return true; // async
  }
});

// When installed, initialize storage
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['settings'], (items) => {
    const st = Object.assign({}, DEFAULTS, items.settings || {});
    chrome.storage.local.set({ settings: st });
  });
});
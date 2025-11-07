// content_script.js
// Injected into every page (all URLs) to collect performance and resource timing.
// includes SPA detection, periodic sampling, robust parsing, and CO2 alerting.

(() => {
  // ---------- Helpers ----------
  function guid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0,
        v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function safeNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  // ---------- Settings (read from chrome.storage.local) ----------
  const DEFAULT_SETTINGS = {
    energyFactor_mJ_per_byte: 1e-6,
    co2Factor_g_per_byte: 1e-6,
    // alert defaults
    alert_enabled: true,
    alert_co2_threshold_g: 10,
    alert_time_threshold_s: 30,
    alert_window_minutes: 10,
    alert_check_interval_s: 10,
    alert_cooldown_min: 5,
    samplingInterval_s: 30
  };

  let SETTINGS = Object.assign({}, DEFAULT_SETTINGS);

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['settings'], (items) => {
          const s = items.settings || {};
          SETTINGS = Object.assign({}, DEFAULT_SETTINGS, s);
          resolve(SETTINGS);
        });
      } catch (e) {
        // If chrome.storage isn't available (very rare in content script), continue with defaults
        console.warn('loadSettings failed, using defaults', e);
        SETTINGS = Object.assign({}, DEFAULT_SETTINGS);
        resolve(SETTINGS);
      }
    });
  }

  // ---------- Issue detection ----------
  function detectIssues(record) {
    const issues = [];
    try {
      const vids = Array.from(document.querySelectorAll('video'));
      const anyAutoplayPlaying = vids.some(v => v.autoplay || (!v.paused && !v.ended));
      if (anyAutoplayPlaying) {
        issues.push({
          code: 'autoplay_video',
          severity: 0.9,
          message: 'Autoplaying video detected — consider disabling autoplay or pausing when not watched.'
        });
      }
    } catch (e) {}

    if ((record.transferBytes || 0) > 5_000_000) {
      issues.push({
        code: 'page_weight',
        severity: 0.8,
        message: 'This page is heavy (>5MB). Optimize large images and assets.'
      });
    }

    if ((record.resourceCount || 0) > 150) {
      issues.push({
        code: 'too_many_resources',
        severity: 0.6,
        message: 'Many resources loaded — consider reducing third-party scripts or bundling.'
      });
    }

    if ((record.longTasks || 0) > 3) {
      issues.push({
        code: 'long_tasks',
        severity: 0.7,
        message: 'Long JavaScript tasks detected — reduce heavy synchronous work.'
      });
    }

    return issues;
  }

  // ---------- Overlay UI ----------
  function createOverlay() {
    if (document.getElementById('green-co2-overlay')) return;
    try {
      const div = document.createElement('div');
      div.id = 'green-co2-overlay';
      div.style.position = 'fixed';
      div.style.top = '10px';
      div.style.right = '10px';
      div.style.zIndex = 2147483647;
      div.style.background = 'rgba(0,0,0,0.65)';
      div.style.color = 'white';
      div.style.padding = '6px 10px';
      div.style.borderRadius = '8px';
      div.style.fontSize = '13px';
      div.style.fontFamily = 'Arial, sans-serif';
      div.style.maxWidth = '220px';
      div.style.boxShadow = '0 3px 10px rgba(0,0,0,0.2)';
      div.innerHTML = `<div id="gco2-val">Estimating...</div>
                       <div style="font-size:10px;margin-top:6px;display:flex;gap:8px;align-items:center;justify-content:space-between">
                         <a id="gco2-open" href="#" style="color:#8fe;text-decoration:none">Open dashboard</a>
                         <span id="gco2-icon" title="CO₂ alert status">🔔</span>
                       </div>`;
      document.documentElement.appendChild(div);
      const openLink = document.getElementById('gco2-open');
      if (openLink) {
        openLink.addEventListener('click', (e) => {
          e.preventDefault();
          try {
            chrome.runtime.sendMessage({ type: 'open-dashboard' }, () => {});
          } catch (err) {
            // fallback: open extension page by URL not available in content script reliably
            console.warn('open-dashboard message failed', err);
          }
        });
      }
    } catch (e) {
      // if DOM not available or blocked, ignore overlay creation
      console.warn('createOverlay failed', e);
    }
  }

  function updateOverlay(text, alertState = null) {
    const el = document.getElementById('gco2-val');
    if (el) el.textContent = text;
    if (typeof alertState === 'boolean') {
      const icon = document.getElementById('gco2-icon');
      if (icon) icon.textContent = alertState ? '🔊' : '🔔';
    }
  }

  // ---------- Metrics Gathering ----------
  function gatherMetricsOnce() {
    try {
      const perf = window.performance || {};
      const entries = (perf.getEntriesByType && perf.getEntriesByType('resource')) || [];
      let transferBytes = 0;
      const resourceCount = entries.length || 0;
      try {
        entries.forEach(e => {
          if (typeof e.transferSize === 'number' && e.transferSize > 0) transferBytes += e.transferSize;
          // fallback: if transferSize missing, try encodedBodySize if present
          else if (typeof e.encodedBodySize === 'number') transferBytes += e.encodedBodySize;
        });
      } catch (e) {}

      const domSize = document.documentElement?.outerHTML?.length || document.body?.innerText?.length || 0;
      const nav = (perf.getEntriesByType && perf.getEntriesByType('navigation') && perf.getEntriesByType('navigation')[0]) || {};
      const loadTimeMs = (nav && nav.loadEventEnd && nav.loadEventStart) ? (nav.loadEventEnd - nav.loadEventStart) : Math.round(performance.now() || 0);
      const fcpEntry = (perf.getEntriesByType && perf.getEntriesByType('paint')) ? (perf.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint')) : null;
      const fcp = fcpEntry ? Math.round(fcpEntry.startTime) : null;

      const record = {
        id: guid(),
        ts: new Date().toISOString(),
        url: location.href,
        origin: location.hostname,
        title: document.title || '',
        transferBytes: transferBytes,
        resourceCount: resourceCount,
        domSize: domSize,
        loadTimeMs: Math.round(loadTimeMs),
        firstContentPaintMs: fcp,
        longTasks: 0
      };

      // Long Tasks API
      try {
        const observer = new PerformanceObserver(list => {
          const ents = list.getEntries();
          record.longTasks += ents.length;
        });
        // Observe buffered long tasks as well if supported
        observer.observe({ type: 'longtask', buffered: true });
        // Note: we don't disconnect here; it's fine — browser buffers are small
      } catch (e) {}

      // Compute estimated CO2: if user settings define co2Factor_g_per_byte, use it; otherwise fallback
      const co2Factor = SETTINGS.co2Factor_g_per_byte || DEFAULT_SETTINGS.co2Factor_g_per_byte;
      // transferBytes might be zero for cached-only pages — that's OK
      record.estimatedCO2_g = safeNum((record.transferBytes * co2Factor), 0);

      // Detect potential issues
      record.issues = detectIssues(record);

      // Update overlay
      updateOverlay(`${(record.estimatedCO2_g || 0).toFixed(4)} g CO₂`);

      // Send to background/service worker
      try {
        chrome.runtime.sendMessage({ type: 'visit-record', record }, (resp) => {
          // optional callback
        });
      } catch (e) {
        console.warn('sendMessage visit-record failed', e);
      }

      // Keep last record locally for alert logic convenience
      lastRecord = record;
      return record;
    } catch (e) {
      console.error('gatherMetricsOnce error', e);
      return null;
    }
  }

  // ---------- SPA navigation detection ----------
  let lastUrl = location.href;
  function detectNavigationChanges() {
    // Observe mutations that often indicate SPA route changes
    const obs = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // re-create overlay for new page/title etc.
        createOverlay();
        // gather metrics for new page
        setTimeout(gatherMetricsOnce, 300);
      }
    });
    try {
      obs.observe(document, { subtree: true, childList: true });
    } catch (e) {
      // fallback: poll URL every second
      setInterval(() => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          createOverlay();
          setTimeout(gatherMetricsOnce, 300);
        }
      }, 1000);
    }
  }

  // ---------- CO2 Alert System ----------
  // Shares logic similar to earlier design: checks cumulative CO2 for origin, ensures activeSeconds threshold, enforces cooldown, then plays beep and shows banner
  let lastRecord = null; // most recent record for page
  const origin = location.hostname;
  let activeSeconds = 0;
  let activeTimer = null;
  let checkTimer = null;

  function playAlertSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.01);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
      o.stop(ctx.currentTime + 0.85);
      setTimeout(() => { try { ctx.close(); } catch (e) {} }, 1200);
    } catch (e) {
      console.warn('Audio alert failed', e);
    }
  }

  function showAlertBanner(message) {
    try {
      const id = 'green-co2-alert-banner';
      if (document.getElementById(id)) return; // already showing
      const b = document.createElement('div');
      b.id = id;
      b.style.position = 'fixed';
      b.style.bottom = '12px';
      b.style.right = '12px';
      b.style.zIndex = 2147483647;
      b.style.background = 'rgba(200,50,50,0.92)';
      b.style.color = 'white';
      b.style.padding = '10px 14px';
      b.style.borderRadius = '8px';
      b.style.fontFamily = 'Arial, sans-serif';
      b.style.fontSize = '13px';
      b.textContent = message || `High CO₂ detected on ${origin}`;
      document.documentElement.appendChild(b);
      setTimeout(() => { try { b.remove(); } catch (e) {} }, 8000);
    } catch (e) {}
  }

  function getCumulativeCO2ForOrigin() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['visits', 'lastAlertTimes'], items => {
        const visitsRaw = items.visits || [];
        const visits = Array.isArray(visitsRaw) ? visitsRaw : (typeof visitsRaw === 'string' ? JSON.parse(visitsRaw) : [visitsRaw]);
        const windowMs = (SETTINGS.alert_window_minutes || DEFAULT_SETTINGS.alert_window_minutes) * 10 * 1000;
        const now = Date.now();
        let sum = 0;
        for (let v of visits) {
          try {
            const ts = v.ts ? new Date(v.ts).getTime() : (v.date ? new Date(v.date).getTime() : null);
            if (!ts) continue;
            if ((now - ts) > windowMs) continue;
            const vOrigin = v.origin || v.host || (v.url ? (new URL(v.url, location.href)).hostname : null);
            if (vOrigin === origin) sum += Number(v.estimatedCO2_g || v.co2 || 0);
          } catch (e) { /* ignore */ }
        }
        const lastAlertTimes = items.lastAlertTimes || {};
        resolve({ sum, lastAlertTimes });
      });
    });
  }

  function setLastAlertTimeForOrigin(ts) {
    chrome.storage.local.get(['lastAlertTimes'], items => {
      const map = items.lastAlertTimes || {};
      map[origin] = ts;
      chrome.storage.local.set({ lastAlertTimes: map });
    });
  }

  async function evaluateAlert() {
    try {
      if (!SETTINGS.alert_enabled) return;
      if (activeSeconds < (SETTINGS.alert_time_threshold_s || DEFAULT_SETTINGS.alert_time_threshold_s)) return;
      const { sum, lastAlertTimes } = await getCumulativeCO2ForOrigin();
      if (sum < (SETTINGS.alert_co2_threshold_g || DEFAULT_SETTINGS.alert_co2_threshold_g)) return;
      const lastTs = lastAlertTimes && lastAlertTimes[origin] ? Number(lastAlertTimes[origin]) : 0;
      const now = Date.now();
      const cooldownMs = (SETTINGS.alert_cooldown_min || DEFAULT_SETTINGS.alert_cooldown_min) * 10 * 1000;
      if (lastTs && (now - lastTs) < cooldownMs) return;
      // Trigger alert
      playAlertSound();
      showAlertBanner(`High CO₂ on ${origin}: ${sum.toFixed(2)} g in last ${SETTINGS.alert_window_minutes} min`);
      setLastAlertTimeForOrigin(now);
      // indicate alert state on overlay briefly
      updateOverlay(`${(lastRecord?.estimatedCO2_g || 0).toFixed(4)} g CO₂`, true);
      setTimeout(() => updateOverlay(`${(lastRecord?.estimatedCO2_g || 0).toFixed(4)} g CO₂`, false), 6000);
    } catch (e) {
      console.error('evaluateAlert error', e);
    }
  }

  function startActiveTimer() {
    if (activeTimer) return;
    activeTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) activeSeconds += 1;
    }, 1000);
  }
  function stopActiveTimer() {
    if (activeTimer) { clearInterval(activeTimer); activeTimer = null; }
  }

  function startCheckTimer() {
    if (checkTimer) return;
    checkTimer = setInterval(() => {
      evaluateAlert();
    }, (SETTINGS.alert_check_interval_s || DEFAULT_SETTINGS.alert_check_interval_s) * 1000);
  }
  function stopCheckTimer() {
    if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
  }

  // ---------- Initialization & periodic sampling ----------
  async function init() {
    await loadSettings();
    createOverlay();
    // initial metrics
    lastRecord = gatherMetricsOnce();

    // SPA detection
    detectNavigationChanges();

    // Active timers for alerting
    if (document.visibilityState === 'visible' && document.hasFocus()) startActiveTimer();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') startActiveTimer();
      else stopActiveTimer();
    });
    window.addEventListener('focus', () => startActiveTimer());
    window.addEventListener('blur', () => {/* don't stop here, rely on visibility */});

    // periodic alert check (start)
    startCheckTimer();

    // expose small debug API
    try {
      window.__greenCo2 = window.__greenCo2 || {};
      window.__greenCo2.getState = () => ({ SETTINGS, activeSeconds, lastRecord });
      window.__greenCo2.resetActive = () => { activeSeconds = 0; };
      window.__greenCo2.forceAlertEval = evaluateAlert;
    } catch (e) {}
  }

  // run init when page loaded
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('load', () => init());
  }

  // cleanup on unload
  window.addEventListener('unload', () => {
    stopActiveTimer();
    stopCheckTimer();
  });

})();
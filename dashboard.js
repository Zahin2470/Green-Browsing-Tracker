// dashboard.js

// --- Utilities ---
function safeParseVisits(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { return []; }
  }
  if (typeof raw === 'object') return [raw];
  return [];
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatKB(bytes) {
  return ((bytes || 0) / 1024).toFixed(1);
}

function ensureEl(selector) {
  const el = document.querySelector(selector);
  if (!el) console.warn(`Missing element: ${selector}`);
  return el;
}

// --- Main refresh (robust) ---
function refresh() {
  chrome.storage.local.get(['visits', 'aggregates', 'settings'], (items) => {
    console.log('Chart loaded?', typeof Chart !== 'undefined');
    try {
      const visits = safeParseVisits(items.visits);
      const ag = items.aggregates || { byDay: {}, byOrigin: {} };
      const settings = items.settings || {};

      // 1) Totals
      let totalBytes = 0, totalCO2 = 0;
      visits.forEach(v => {
        totalBytes += num(v.transferBytes || v.bytes || 0);
        totalCO2 += num(v.estimatedCO2_g || v.co2 || 0);
      });

      const co2El = document.querySelector('.total-item.co2-saved .value');
      if (co2El) co2El.textContent = `${totalCO2.toFixed(3)} g`;
      const visitsEl = document.querySelector('.total-item.visits-count .value');
      if (visitsEl) visitsEl.textContent = `${visits.length}`;
      const dataEl = document.querySelector('.total-item.data-transferred .value');
      if (dataEl) dataEl.textContent = `${formatKB(totalBytes)} KB`;

      // 2) Build aggregates.byDay if missing
      if (!ag.byDay || Object.keys(ag.byDay).length === 0) {
        ag.byDay = {};
        visits.forEach(v => {
          const day = (v.ts || '').slice(0,10) || new Date().toISOString().slice(0,10);
          ag.byDay[day] = ag.byDay[day] || { co2: 0, bytes: 0, visits: 0 };
          ag.byDay[day].co2 += num(v.estimatedCO2_g || v.co2 || 0);
          ag.byDay[day].bytes += num(v.transferBytes || v.bytes || 0);
          ag.byDay[day].visits += 1;
        });
      }

      // --- 3) Chart: Robust 7-day Footprint Trend ---
      try {
        const N = 7;
        const daysArr = [];
        const today = new Date();
        for (let i = N - 1; i >= 0; --i) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          const iso = d.toISOString().slice(0, 10);
          daysArr.push(iso);
        }

        const canvas = document.getElementById('visitsChart');
        if (!canvas) {
          console.warn('visitsChart canvas not found — skipping chart render');
        } else {
          // ensure visible area
          const parent = canvas.parentElement;
          if (parent) {
            parent.style.minHeight = parent.style.minHeight || '180px';
          }
          canvas.style.height = canvas.style.height || '180px';

          if (typeof Chart === 'undefined') {
            console.warn('Chart.js is not loaded. Chart will not render.');
            if (parent) {
              parent.querySelector('.chart-placeholder')?.remove();
              const ph = document.createElement('div');
              ph.className = 'chart-placeholder';
              ph.style.padding = '20px';
              ph.style.color = '#777';
              ph.textContent = 'Chart.js not loaded — check network or include CDN.';
              parent.appendChild(ph);
            }
          } else {
            // build co2 array for the last N days (zeros if missing)
            const co2PerDay = daysArr.map(day => {
              return Number((ag.byDay && ag.byDay[day] && Number(ag.byDay[day].co2)) || 0);
            });

            // remove any placeholder
            const parentEl = canvas.parentElement;
            parentEl && parentEl.querySelector('.chart-placeholder')?.remove();

            // destroy old chart safely
            if (window._visChart) {
              try { window._visChart.destroy(); } catch (e) { /* ignore */ }
            }

            window._visChart = new Chart(canvas.getContext('2d'), {
              type: 'bar',
              data: {
                labels: daysArr,
                datasets: [{
                  label: 'CO₂ (g) per day',
                  data: co2PerDay,
                  backgroundColor: '#2ecc71',
                  borderColor: '#27ae60',
                  borderWidth: 1,
                  borderRadius: 4,
                  datalabels: {
                    color: '#27ae60',
                    font: { weight: 'bold', size: 14 }
                  }
                }]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: {
                      color: '#27ae60',
                      font: { weight: 'bold', size: 14 }
                    }
                  },
                  x: {
                    display: true,
                    ticks: {
                      color: '#27ae60',
                      font: { weight: 'bold', size: 14 }
                    }
                  }
                },
                plugins: {
                  legend: { display: false },
                  title: { display: false }
                }
              }
            });
          }
        }
      } catch (chartErr) {
        console.error('Chart rendering error:', chartErr);
      }

      // 4) Top Sites (build byOrigin if missing)
      if (!ag.byOrigin || Object.keys(ag.byOrigin).length === 0) {
        ag.byOrigin = {};
        visits.forEach(v => {
          const origin = v.origin || v.host || 'unknown';
          ag.byOrigin[origin] = ag.byOrigin[origin] || { visits: 0, bytes: 0, co2: 0 };
          ag.byOrigin[origin].visits += 1;
          ag.byOrigin[origin].bytes += num(v.transferBytes || v.bytes || 0);
          ag.byOrigin[origin].co2 += num(v.estimatedCO2_g || v.co2 || 0);
        });
      }

      const byOrigin = Object.entries(ag.byOrigin).sort((a,b) => (b[1].bytes||0) - (a[1].bytes||0));
      const top = byOrigin.slice(0, 10);
      const ul = document.getElementById('topSites');
      if (ul) {
        ul.innerHTML = '';
        if (top.length === 0) {
          ul.innerHTML = '<li class="placeholder">Browse to see data here.</li>';
        } else {
          const maxCO2 = num(top[0][1].co2, 1);
          top.forEach(([origin, val]) => {
            const co2Value = num(val.co2, 0);
            const barWidth = (maxCO2 > 0) ? (co2Value / maxCO2) * 100 : 0;
            const li = document.createElement('li');
            li.className = 'top-site-item';
            li.innerHTML = `
              <div class="site-row">
                <div class="site-name">${origin}</div>
                <div class="co2-value">${co2Value.toFixed(4)} g</div>
              </div>
              <div class="data-bar-wrapper"><div class="data-bar" style="width:${barWidth.toFixed(1)}%"></div></div>
            `;
            ul.appendChild(li);
          });
        }
      } else {
        console.warn('#topSites element not found');
      }

      // 5) Recent Visits table
      const tbody = document.querySelector('#visitsTable tbody');
      if (tbody) {
        tbody.innerHTML = '';
        const recentVisits = visits.slice().reverse().slice(0, 50);
        if (recentVisits.length === 0) {
          tbody.innerHTML = `<tr><td colspan="4" class="no-data">No recent visits recorded.</td></tr>`;
        } else {
          recentVisits.forEach(v => {
            const rowTs = new Date(v.ts || v.date || Date.now()).toLocaleString();
            const origin = v.origin || v.host || 'unknown';
            const bytesKB = formatKB(num(v.transferBytes || v.bytes || 0));
            const co2 = num(v.estimatedCO2_g || v.co2 || 0).toFixed(4);
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td>${rowTs}</td>
              <td>${origin}</td>
              <td>${bytesKB} KB</td>
              <td>${co2}</td>
            `;
            tbody.appendChild(tr);
          });
        }
      } else {
        console.warn('#visitsTable tbody not found');
      }

    } catch (err) {
      console.error('refresh() internal error:', err);
    }
  });
}

// --- Export CSV handler ---
function exportCSV() {
  chrome.runtime.sendMessage({ type: 'export-csv' }, (resp) => {
    if (resp && resp.csv) {
      const blob = new Blob([resp.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'visits.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } else {
      alert('No data available to export.');
    }
  });
}

// --- Clear data handler ---
function clearData() {
  if (!confirm('Clear stored data? This cannot be undone.')) return;
  chrome.storage.local.set({ visits: [], aggregates: { byOrigin: {}, byDay: {} } }, () => {
    refresh();
  });
}

// --- Open options page ---
function openOptions() {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
}

// --- Init wiring ---
document.addEventListener('DOMContentLoaded', () => {
  const exportBtn = document.getElementById('exportCsv');
  if (exportBtn) exportBtn.addEventListener('click', exportCSV);

  const clearBtn = document.getElementById('clearData');
  if (clearBtn) clearBtn.addEventListener('click', clearData);

  const optionsBtn = document.getElementById('openOptions');
  if (optionsBtn) optionsBtn.addEventListener('click', openOptions);

  try { refresh(); } catch (e) { console.error(e); }
});

// periodic refresh (keeps UI in sync)
setInterval(() => {
  try { refresh(); } catch (e) { /* noop */ }
}, 5000);

// live update when storage changes (more responsive than polling alone)
if (chrome && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.visits || changes.aggregates || changes.settings)) {
      try { refresh(); } catch (e) { console.error(e); }
    }
  });
}
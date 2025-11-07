document.getElementById('open-dashboard').addEventListener('click', () => {
  chrome.tabs.create({url: chrome.runtime.getURL('dashboard.html')});
});

document.getElementById('options').addEventListener('click', () => {
  chrome.tabs.create({url: chrome.runtime.getURL('options.html')});
});

// display small summary
chrome.storage.local.get(['aggregates'], (items) => {
  const a = items.aggregates || {};
  const today = new Date().toISOString().slice(0,10);
  const day = a.byDay?.[today] || {visits:0, bytes:0, co2:0};
  document.getElementById('summary').innerHTML = `Today: ${day.visits} visits, ${(day.bytes/1024).toFixed(1)} KB, ${day.co2.toFixed(3)} g CO2`;
});
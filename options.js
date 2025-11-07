const eInput = document.getElementById('energyFactor');
const cInput = document.getElementById('co2Factor');
const status = document.getElementById('status');

function load() {
  chrome.storage.local.get(['settings'], (items) => {
    const s = items.settings || {};
    eInput.value = s.energyFactor_mJ_per_byte || 1e-6;
    cInput.value = s.co2Factor_g_per_byte || 1e-6;
  });
}

function save() {
  const s = {
    energyFactor_mJ_per_byte: parseFloat(eInput.value),
    co2Factor_g_per_byte: parseFloat(cInput.value)
  };
  chrome.storage.local.set({settings: s}, () => {
    status.innerText = 'Saved';
    setTimeout(() => status.innerText = '', 2000);
  });
}

document.getElementById('save').addEventListener('click', save);
load();
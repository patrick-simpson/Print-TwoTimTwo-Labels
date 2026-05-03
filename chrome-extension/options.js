const SERVER = 'http://localhost:3456';

function setStatus(msg, type) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = 'status ' + (type || '');
}

function showOfflineBanner(visible) {
  document.getElementById('offline-banner').classList.toggle('visible', visible);
}

async function loadConfig() {
  try {
    const res = await fetch(SERVER + '/config');
    if (!res.ok) throw new Error('bad response');
    const cfg = await res.json();
    document.getElementById('pusher-app-id').value = cfg.pusherAppId || '';
    document.getElementById('pusher-key').value    = cfg.pusherKey    || '';
    document.getElementById('pusher-secret').value = cfg.pusherSecret || '';
    document.getElementById('pusher-cluster').value = cfg.pusherCluster || '';
    showOfflineBanner(false);
  } catch {
    showOfflineBanner(true);
  }
}

function loadStepUpMode() {
  const sel = document.getElementById('stepup-mode');
  if (!sel) return;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['awana_stepUpMode'], function(result) {
      sel.value = result.awana_stepUpMode || 'auto';
    });
  }
  sel.addEventListener('change', function() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ awana_stepUpMode: sel.value });
    }
  });
}

async function saveConfig() {
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  setStatus('Saving…', '');

  const body = {
    pusherAppId:  document.getElementById('pusher-app-id').value.trim(),
    pusherKey:    document.getElementById('pusher-key').value.trim(),
    pusherSecret: document.getElementById('pusher-secret').value.trim(),
    pusherCluster: document.getElementById('pusher-cluster').value.trim() || 'us2',
  };

  try {
    const res = await fetch(SERVER + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('server error');
    setStatus('Saved!', 'success');
    showOfflineBanner(false);
  } catch {
    setStatus('Could not save — server offline.', 'error');
    showOfflineBanner(true);
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('save-btn').addEventListener('click', saveConfig);
loadConfig();
loadStepUpMode();

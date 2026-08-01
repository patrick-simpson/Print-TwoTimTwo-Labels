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

// Bind a <select> to a chrome.storage.local key so the widget on the
// TwoTimTwo page and this Options page stay in sync.
function bindModeSelect(elementId, storageKey) {
  const sel = document.getElementById(elementId);
  if (!sel) return;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([storageKey], function(result) {
      sel.value = result[storageKey] || 'auto';
    });
  }
  sel.addEventListener('change', function() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [storageKey]: sel.value });
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

// ── Display key status ───────────────────────────────────────────────────────
// STATUS ONLY, with a link to the dashboard — deliberately not a second place to
// generate or edit the key.
//
// This page could show it: it runs at a chrome-extension:// origin, which the
// server trusts on loopback (that is why the Pusher secret above loads here at
// all). The reason not to is operational, not cryptographic. Rotating the key
// blanks the names on EVERY screen at once until the new value is pasted into
// each one, and the safe ordering — generate, copy into the screens, only then
// save — is a sequence, not a button. Two surfaces implementing that sequence
// is two chances to get it subtly different, on the one control that can take
// every welcome screen down mid-club. One place to copy from, one place to
// change it.
async function loadDisplayKeyStatus() {
  const el = document.getElementById('display-key-state');
  if (!el) return;
  let health;
  try {
    const res = await fetch(SERVER + '/health');
    if (!res.ok) throw new Error('bad response');
    health = await res.json();
  } catch {
    el.style.background = '#f1f5f9';
    el.style.borderColor = '#e2e8f0';
    el.style.color = '#64748b';
    el.textContent = 'Print server offline — cannot tell whether names are encrypted.';
    return;
  }

  // No welcome screen means no names on the wire and nothing to warn about.
  if (!health.pusher || !health.pusher.configured) {
    el.style.background = '#f1f5f9';
    el.style.borderColor = '#e2e8f0';
    el.style.color = '#64748b';
    el.textContent = 'No welcome screen connected yet — nothing is being broadcast, '
      + 'so there are no names to protect.';
    return;
  }

  if (health.displayKeyConfigured) {
    el.style.background = '#f0fdf4';
    el.style.borderColor = '#bbf7d0';
    el.style.color = '#166534';
    el.textContent = '🔒 Names are encrypted'
      + (health.displayKeyId ? ' (key ' + health.displayKeyId + ')' : '')
      + '. Each screen needs this same key pasted into its own settings.';
  } else {
    el.style.background = '#fef2f2';
    el.style.borderColor = '#fecaca';
    el.style.color = '#991b1b';
    el.textContent = "⚠ Names are NOT encrypted. Children's first names are published in the clear "
      + 'on a channel anyone can subscribe to. Open the dashboard below and press '
      + '“Generate display key”.';
  }
}

document.getElementById('save-btn').addEventListener('click', saveConfig);
loadConfig();
loadDisplayKeyStatus();
bindModeSelect('stepup-mode', 'awana_stepUpMode');
bindModeSelect('store-mode',  'awana_storeMode');

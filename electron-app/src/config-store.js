// Read/merge/write of config.json, split out of main.js so it can be tested
// without booting Electron.
//
// WHY THIS IS ITS OWN MODULE
//
// config.json has several writers with very different views of it. The print
// server owns the security and realtime keys (phonePin, lanAccess,
// allowedOrigins, pusherAppId/Key/Secret/Cluster), the operator schedule, and
// assorted preferences (historyRetentionDays, connectCard,
// connectCardAutoFirstTimer, connectCardGreeting, worksheetPrinter,
// firstTimerInverted, labelFooter, labelTemplates). The Electron setup wizard
// owns exactly three:
// printerName, checkinUrl, launchOnBoot.
//
// The Electron writer used to do a bare whole-file `writeFileSync(path,
// JSON.stringify(config))` with the renderer's three-key object. So a single
// click on Save in the settings window deleted every server-owned key, and
// because the caller restarts the server immediately afterwards, the loss went
// live at once: the LAN auth gate fails closed with no PIN, so phone check-in
// refused every request; the lobby display lost its Pusher credentials; and
// late arrivals stopped being routed because the schedule was gone. The
// realistic trigger is the worst possible moment — the printer jams mid-event,
// a volunteer opens Settings to pick the backup printer, and clicks Save.
//
// So: writes are always a MERGE of a patch over what is on disk, and always
// tmp+rename, so a crash mid-write cannot truncate the file either.
const fs = require('fs');
const path = require('path');

function loadConfig(configPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // A JSON scalar or array is not a config. Treat it like a missing file
    // rather than merging a patch into it and writing something nonsensical.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Merge `patch` over the on-disk config and persist the result. Returns the
// merged object — callers must act on THIS, not on the patch, because the patch
// on its own is missing everything the server needs to start.
function saveConfig(configPath, patch) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const merged = Object.assign({}, loadConfig(configPath) || {}, patch || {});
  const tmp = `${configPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
  fs.renameSync(tmp, configPath);
  return merged;
}

module.exports = { loadConfig, saveConfig };

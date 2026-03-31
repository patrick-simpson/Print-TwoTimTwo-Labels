const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('awana', {
  getPrinters:     ()       => ipcRenderer.invoke('get-printers'),
  getConfig:       ()       => ipcRenderer.invoke('get-config'),
  saveConfig:      (config) => ipcRenderer.invoke('save-config', config),
  openCheckinPage: (url)    => ipcRenderer.invoke('open-checkin-page', url)
});

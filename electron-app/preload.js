const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('awana', {
  getPrinters:        ()       => ipcRenderer.invoke('get-printers'),
  getConfig:          ()       => ipcRenderer.invoke('get-config'),
  saveConfig:         (config) => ipcRenderer.invoke('save-config', config),
  openCheckinPage:    (url)    => ipcRenderer.invoke('open-checkin-page', url),
  getServerState:     ()       => ipcRenderer.invoke('get-server-state'),
  getLanAddress:      ()       => ipcRenderer.invoke('get-lan-address'),
  enablePhoneCheckin: ()       => ipcRenderer.invoke('enable-phone-checkin'),
  installUpdate:      ()       => ipcRenderer.invoke('install-update')
});

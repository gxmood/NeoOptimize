const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neo', {
  engineScan: () => ipcRenderer.invoke('engine/scan'),
  engineCleanup: (opts) => ipcRenderer.invoke('engine/cleanup', opts),
  engineScanVirus: () => ipcRenderer.invoke('engine/scan-virus'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  applyUpdate: () => ipcRenderer.invoke('app:apply-update'),
  on: (channel, cb) => {
    ipcRenderer.on(channel, (ev, ...args) => cb(...args));
  }
});

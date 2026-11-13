'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ar', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  decide: (p) => ipcRenderer.invoke('decide', p),
  type: (id, text) => ipcRenderer.invoke('type', { id, text }),
  click: (id, x, y) => ipcRenderer.invoke('click', { id, x, y }),
  aiTest: (cfg, q) => ipcRenderer.invoke('ai:test', cfg, q),
  updateState: () => ipcRenderer.invoke('update:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => {
    ipcRenderer.on('update:state', (_e, v) => cb('state', v));
    ipcRenderer.on('update:progress', (_e, v) => cb('progress', v));
    ipcRenderer.on('update:fail', (_e, v) => cb('fail', v));
  }
});

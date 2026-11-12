'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ar', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  decide: (p) => ipcRenderer.invoke('decide', p),
  type: (id, text) => ipcRenderer.invoke('type', { id, text }),
  aiTest: (cfg) => ipcRenderer.invoke('ai:test', cfg)
});

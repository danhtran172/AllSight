const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vision', {
  readStore: () => ipcRenderer.invoke('store:read'),
  writeStore: value => ipcRenderer.invoke('store:write', value),
  pickFolder: () => ipcRenderer.invoke('folders:pick'),
  scanFolder: folder => ipcRenderer.invoke('folder:scan', folder),
  copyImage: filePath => ipcRenderer.invoke('image:copy', filePath),
  showInFolder: filePath => ipcRenderer.invoke('image:show-in-folder', filePath),
  lock: () => ipcRenderer.invoke('app:lock')
});

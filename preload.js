const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vision', {
  readStore: () => ipcRenderer.invoke('store:read'),
  writeStore: value => ipcRenderer.invoke('store:write', value),
  pickFolder: () => ipcRenderer.invoke('folders:pick'),
  scanFolder: folder => ipcRenderer.invoke('folder:scan', folder),
  watchSources: folders => ipcRenderer.invoke('sources:watch', folders),
  onFolderChanged: callback => {
    const listener = (_, folder) => callback(folder);
    ipcRenderer.on('folder:changed', listener);
    return () => ipcRenderer.removeListener('folder:changed', listener);
  },
  onMediaImported: callback => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('media:imported', listener);
    return () => ipcRenderer.removeListener('media:imported', listener);
  },
  copyImage: filePath => ipcRenderer.invoke('image:copy', filePath),
  showInFolder: filePath => ipcRenderer.invoke('image:show-in-folder', filePath),
  lock: () => ipcRenderer.invoke('app:lock')
});

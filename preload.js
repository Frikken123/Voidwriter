const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  updateMemory: (payload) => ipcRenderer.send('update-memory', payload),
  forceSaveToDisk: (payload) => ipcRenderer.send('force-save-to-disk', payload),
  sendDroppedFilePath: (filePath) => ipcRenderer.send('dropped-file-path', filePath),
  minimizeApp: () => ipcRenderer.send('request-app-minimize'),
  quitApp: () => ipcRenderer.send('request-app-quit'),
  onRequestProjectState: (callback) => ipcRenderer.on('request-project-state', callback),
  replyProjectState: (state) => ipcRenderer.send('reply-project-state', state),
  onProjectLoaded: (callback) => ipcRenderer.on('load-project-data', (event, data) => callback(data)),
  
  // High-res print quality bridge
  saveHighResSnapshot: (payload) => ipcRenderer.send('save-high-res-snapshot', payload)
});
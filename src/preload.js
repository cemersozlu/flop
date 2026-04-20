const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder: (collection) => ipcRenderer.invoke('open-folder', collection),
  changeFolder: (collection) => ipcRenderer.invoke('change-folder', collection),
  setRating: (filePath, ratingValue) => ipcRenderer.invoke('set-rating', filePath, ratingValue),
  loadLibraryCache: (folderPath, collection) => ipcRenderer.invoke('load-library-cache', folderPath, collection),
  saveLibraryCache: (folderPath, tracks, collection) => ipcRenderer.invoke('save-library-cache', folderPath, tracks, collection),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),
  parseMetadata: (filePaths, options) => ipcRenderer.invoke('parse-metadata', filePaths, options),
  getAudioUrl: (filePath) => ipcRenderer.invoke('get-audio-url', filePath),
  updateTitleBarOverlay: (options) => ipcRenderer.invoke('update-title-bar-overlay', options),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
});

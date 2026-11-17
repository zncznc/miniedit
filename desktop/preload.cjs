const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('miniedit', {
  isDesktop: true,
  platform: process.platform,
  // 拖进来的文件只有 File 对象，真实路径要这样拿
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  boot: () => ipcRenderer.invoke('app:boot'),
  close: () => ipcRenderer.invoke('app:close'),
  setDirty: (d) => ipcRenderer.invoke('app:set-dirty', d),
  setTitle: (name, dirty) => ipcRenderer.invoke('app:set-title', { name, dirty }),
  setTheme: (name) => ipcRenderer.invoke('app:set-theme', name),
  setZoom: (zoom) => ipcRenderer.invoke('app:set-zoom', zoom),
  openDialog: () => ipcRenderer.invoke('file:open-dialog'),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  writeFile: (payload) => ipcRenderer.invoke('file:write', payload),
  saveDialog: (payload) => ipcRenderer.invoke('file:save-dialog', payload),
  confirmClose: (name) => ipcRenderer.invoke('dialog:confirm-close', name),
  showError: (message, detail) => ipcRenderer.invoke('dialog:error', { message, detail }),
  recent: () => ipcRenderer.invoke('recent:list'),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  sample: (name) => ipcRenderer.invoke('sample:read', name),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action, arg) => cb(action, arg)),
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (_e, paths) => cb(paths)),
});

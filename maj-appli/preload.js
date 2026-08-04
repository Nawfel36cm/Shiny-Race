const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickRom:    ()            => ipcRenderer.invoke('pick-rom'),
  readRom:    p             => ipcRenderer.invoke('read-rom', p),
  pickFile:   opts          => ipcRenderer.invoke('pick-file', opts),
  saveBytes:  opts          => ipcRenderer.invoke('save-bytes', opts),
  reveal:     p             => ipcRenderer.invoke('reveal', p),
  setupState: ()            => ipcRenderer.invoke('setup-state'),
  setPath:    opts          => ipcRenderer.invoke('set-path', opts),
  runUpr:     opts          => ipcRenderer.invoke('run-upr', opts),
  onUprLog:   cb            => ipcRenderer.on('upr-log', (_e, line) => cb(line)),
  update: {
    check:   ()  => ipcRenderer.invoke('update-check'),
    install: ()  => ipcRenderer.invoke('update-install'),
    on:      cb  => ipcRenderer.on('update', cb)
  }
});

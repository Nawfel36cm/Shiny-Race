const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickRom:    ()            => ipcRenderer.invoke('pick-rom'),
  readRom:    p             => ipcRenderer.invoke('read-rom', p),
  pickFile:   opts          => ipcRenderer.invoke('pick-file', opts),
  saveBytes:  opts          => ipcRenderer.invoke('save-bytes', opts),
  reveal:     p             => ipcRenderer.invoke('reveal', p),
  setPath:    opts          => ipcRenderer.invoke('set-path', opts),
  upr: {
    state:      ()   => ipcRenderer.invoke('upr-state'),
    install:    ()   => ipcRenderer.invoke('upr-install'),
    remove:     ()   => ipcRenderer.invoke('upr-remove'),
    run:        o    => ipcRenderer.invoke('upr-run', o),
    onLog:      cb   => ipcRenderer.on('upr-log', (_e, l) => cb(l)),
    onProgress: cb   => ipcRenderer.on('upr-progress', (_e, m) => cb(m))
  },
  appVersion: ()  => ipcRenderer.invoke('app-version'),
  update: {
    check:   ()  => ipcRenderer.invoke('update-check'),
    install: ()  => ipcRenderer.invoke('update-install'),
    on:      cb  => ipcRenderer.on('update', cb)
  }
});

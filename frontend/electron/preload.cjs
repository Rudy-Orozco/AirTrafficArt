/**
 * Runs in the page before it loads (desktop app only). Gives the page a small,
 * safe bridge for page zoom, which a web page can't otherwise control:
 * window.desktop.zoom(step), .zoomFactor() and .onZoom(callback).
 * (CommonJS: Electron's sandboxed preload scripts can't be ES modules.)
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  /** +1 zooms in a step, -1 out, 0 back to 100%. Resolves to the new zoom factor. */
  zoom: (direction) => ipcRenderer.invoke('zoom', direction),
  zoomFactor: () => ipcRenderer.invoke('zoom', null),
  /** Called with the zoom factor whenever it changes (buttons, keys or Ctrl+scroll). */
  onZoom: (callback) => {
    const listener = (_event, factor) => callback(factor)
    ipcRenderer.on('zoom', listener)
    return () => ipcRenderer.removeListener('zoom', listener)
  },
})

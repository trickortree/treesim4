// Safe bridge between the game page and the updater in main.js (the page itself has no Node access).
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel, cb) => ipcRenderer.on(channel, (_event, data) => cb(data));

contextBridge.exposeInMainWorld("ts4Updater", {
    onAvailable: cb => on("update-available", cb),
    onProgress: cb => on("update-progress", cb),
    onDownloaded: cb => on("update-downloaded", cb),
    onError: cb => on("update-error", cb),
    onPostUpdate: cb => on("post-update", cb),
    download: () => ipcRenderer.send("download-update"),
    retry: () => ipcRenderer.send("retry-update")
});

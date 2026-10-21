// Tree Sim 4 Studio's bridge between the editor page and studio/main-studio.js (the page itself has no Node access).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ts4Studio", {
    info: () => ipcRenderer.invoke("studio:info"),
    save: (name, data) => ipcRenderer.invoke("studio:save", name, data),
    askClaude: req => ipcRenderer.invoke("studio:askClaude", req),
    themes: t => ipcRenderer.invoke("studio:themes", t), // no argument: load them
    // the Release panel
    relStatus: () => ipcRenderer.invoke("studio:relStatus"),
    relChecks: (version, notes) => ipcRenderer.invoke("studio:relChecks", version, notes),
    release: req => ipcRenderer.invoke("studio:release", req),
    onReleaseStep: cb => ipcRenderer.on("studio:relStep", (_e, s) => cb(s)),
    ciStatus: version => ipcRenderer.invoke("studio:ciStatus", version),
    openUrl: url => ipcRenderer.invoke("studio:openUrl", url)
});

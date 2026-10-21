// Tree Sim 4 Studio's bridge between the editor page and studio/main-studio.js (the page itself has no Node access).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ts4Studio", {
    info: () => ipcRenderer.invoke("studio:info"),
    save: (name, data) => ipcRenderer.invoke("studio:save", name, data),
    askClaude: req => ipcRenderer.invoke("studio:askClaude", req)
});

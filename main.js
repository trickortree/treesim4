const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");

app.setAppUserModelId("com.trickortree.treesim4");

let mainWindow = null;
let rendererReady = false;
let queuedUpdate = null;
let pendingUpdateInfo = null;

const updateInfoFile = () => path.join(app.getPath("userData"), "pending-update.json");

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 600,
        backgroundColor: "#120a1e",
        title: "Hypergamous Tree Chopping Simulator 4",
        icon: path.join(__dirname, "build", "icon.ico"),
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            backgroundThrottling: false,
            autoplayPolicy: "no-user-gesture-required"
        }
    });
    Menu.setApplicationMenu(null);
    rendererReady = false;

    // the version is shown on the title screen; the debug hooks only exist when running from source
    const query = { v: app.getVersion() };
    if (!app.isPackaged) query.debug = "1";
    mainWindow.loadFile(path.join(__dirname, "index.html"), { query });

    mainWindow.webContents.on("before-input-event", (e, input) => {
        if (input.type === "keyDown" && input.key === "F11") mainWindow.setFullScreen(!mainWindow.isFullScreen());
    });
    mainWindow.webContents.on("did-finish-load", () => {
        rendererReady = true;
        if (queuedUpdate) { sendToGame("update-available", queuedUpdate); queuedUpdate = null; }
    });
    mainWindow.once("ready-to-show", () => mainWindow.show());
    mainWindow.on("closed", () => { mainWindow = null; rendererReady = false; });
}

function sendToGame(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
        mainWindow.webContents.send(channel, data);
        return true;
    }
    return false;
}

function cleanReleaseNotes(notes) {
    let text = "";
    if (Array.isArray(notes)) text = notes.map(n => (typeof n === "string" ? n : (n && n.note) || "")).filter(Boolean).join("\n\n");
    else if (notes) text = String(notes);
    return text
        .replace(/\r/g, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/li>\s*/gi, "\n")
        .replace(/<li[^>]*>/gi, "• ")
        .replace(/<\/(?:p|div|h[1-6]|ul|ol)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

async function savePendingUpdate() {
    if (!pendingUpdateInfo) return;
    try { await fs.promises.writeFile(updateInfoFile(), JSON.stringify(pendingUpdateInfo, null, 2), "utf8"); }
    catch (e) { console.error("Failed to save post-update info:", e); }
}
async function loadPendingUpdate() {
    try {
        if (!fs.existsSync(updateInfoFile())) return null;
        return JSON.parse(await fs.promises.readFile(updateInfoFile(), "utf8"));
    } catch (e) { return null; }
}
async function clearPendingUpdate() {
    try { if (fs.existsSync(updateInfoFile())) await fs.promises.unlink(updateInfoFile()); } catch (e) { /* ignore */ }
}

function setupAutoUpdater() {
    if (!app.isPackaged) { console.log("Auto-updater disabled in development."); return; }
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.fullChangelog = true;

    autoUpdater.on("update-available", info => {
        const releaseNotes = cleanReleaseNotes(info.releaseNotes) || "No release notes provided.";
        const data = { currentVersion: app.getVersion(), newVersion: info.version, releaseNotes };
        pendingUpdateInfo = { version: info.version, releaseNotes };
        if (!sendToGame("update-available", data)) queuedUpdate = data;
    });
    autoUpdater.on("download-progress", p => sendToGame("update-progress", { percent: Math.round(p.percent), transferred: p.transferred, total: p.total }));
    autoUpdater.on("update-downloaded", async () => {
        await savePendingUpdate();
        sendToGame("update-downloaded");
        setTimeout(() => autoUpdater.quitAndInstall(), 1200);
    });
    autoUpdater.on("error", error => sendToGame("update-error", { message: String(error) }));

    ipcMain.on("download-update", async () => {
        try { await autoUpdater.downloadUpdate(); }
        catch (e) { sendToGame("update-error", { message: String(e) }); }
    });
    ipcMain.on("retry-update", async () => {
        try { await autoUpdater.checkForUpdates(); }
        catch (e) { sendToGame("update-error", { message: String(e) }); }
    });

    setTimeout(() => { autoUpdater.checkForUpdates().catch(e => console.error("Update check failed:", e)); }, 5000);
}

app.whenReady().then(async () => {
    const previous = await loadPendingUpdate();
    createWindow();
    // after the game restarted into the new version, show What's New once
    if (previous && previous.version === app.getVersion()) {
        mainWindow.webContents.once("did-finish-load", async () => {
            sendToGame("post-update", { version: previous.version, releaseNotes: previous.releaseNotes });
            await clearPendingUpdate();
        });
    } else if (previous) {
        await clearPendingUpdate();
    }
    setupAutoUpdater();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

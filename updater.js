// In-game update popup + "What's New" screen. Only does anything inside the packaged app (preload.js provides ts4Updater).
const U = window.ts4Updater;
if (U) {
    const $ = id => document.getElementById(id);
    const modal = $("updateModal");
    let mode = "update";

    function open(title, ver, notes, opts = {}) {
        try { document.exitPointerLock(); } catch (e) { /* not locked */ }
        $("uTitle").textContent = title;
        $("uVer").textContent = ver;
        $("uNotes").textContent = notes;
        $("uBar").style.display = "none";
        $("uFill").style.width = "0%";
        $("uStatus").textContent = opts.status || "";
        $("uGo").style.display = opts.go ? "" : "none";
        $("uGo").textContent = opts.go || "";
        $("uLater").textContent = opts.later || "CLOSE";
        $("uLater").style.display = "";
        modal.classList.add("show");
    }
    const close = () => modal.classList.remove("show");

    U.onAvailable(info => {
        mode = "update";
        open("UPDATE AVAILABLE", "v" + info.currentVersion + "  →  v" + info.newVersion, info.releaseNotes, { go: "UPDATE NOW", later: "LATER" });
    });
    U.onPostUpdate(info => {
        mode = "whatsnew";
        open("WHAT'S NEW", "now on v" + info.version, info.releaseNotes, { later: "LET'S GO" });
    });
    U.onProgress(p => {
        $("uBar").style.display = "block";
        $("uFill").style.width = p.percent + "%";
        $("uStatus").textContent = "Downloading... " + p.percent + "%";
    });
    U.onDownloaded(() => {
        $("uStatus").textContent = "Done! Restarting into the new version...";
        $("uGo").style.display = "none";
        $("uLater").style.display = "none";
    });
    U.onError(e => {
        $("uBar").style.display = "none";
        $("uStatus").textContent = "Update problem: " + e.message;
        $("uGo").style.display = "";
        $("uGo").textContent = "RETRY";
        $("uLater").style.display = "";
        $("uLater").textContent = "CLOSE";
        mode = "retry";
    });

    $("uGo").addEventListener("click", () => {
        if (mode === "retry") { $("uStatus").textContent = "Checking again..."; U.retry(); mode = "update"; return; }
        $("uGo").style.display = "none";
        $("uLater").style.display = "none";
        $("uStatus").textContent = "Starting download...";
        U.download();
    });
    $("uLater").addEventListener("click", close);
}

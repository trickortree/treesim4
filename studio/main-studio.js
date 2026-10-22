// Tree Sim 4 Studio, main-process side: saves the content files and runs Claude for the tree designer.
// main.js loads this only for `npm run studio` from source. The installer never includes the studio folder.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const CONTENT = { trees: "trees.js", world: "world.js", islands: "islands.js", props: "props.js", animals: "animals.js" };
const HEADERS = {
    animals: "// Animals made in Tree Sim 4 Studio's Animal Maker (npm run studio). The Studio writes this file: make animals there.\n// Each animal: { key (starts with a_), name, way, size, speed, run, flee, herd, alt, night, pitch, parts: [{ shape, role, x, y, z, rx, ry, rz, sx, sy, sz, color, glow, opacity }] }\n",
    props: "// Props made in Tree Sim 4 Studio's Prop Maker (npm run studio). The Studio writes this file: make props there.\n// Each prop: { key (starts with u_), name, r, light, parts: [{ shape, x, y, z, rx, ry, rz, sx, sy, sz, color, glow, tint, opacity }] }\n",
    trees: "// Custom trees made in Tree Sim 4 Studio (npm run studio). The Studio writes this file: edit trees there.\n// Each tree's key starts with c_. Colours are \"#rrggbb\". See the vault's \"Tree Designer\" note for every field.\n",
    islands: "// Islands made in Tree Sim 4 Studio (npm run studio). The Studio writes this file: make islands there.\n// They come after the Iceberg in order: the first is island 7 (Rebirth 6), the next island 8 (Rebirth 7), and so on.\n",
    world: "// Signs, props, people and things to do placed in Tree Sim 4 Studio (npm run studio). The Studio writes this file: move things there.\n// Each object: { id, isle, kind: \"sign\" | \"prop\" | \"npc\" | \"treespot\", x, y, z, rx, ry, rz, s, sx, sy, sz, solid, act, ... }\n"
};
const MODELS = ["haiku", "sonnet", "opus"];

// the Claude Code CLI: on PATH, or the copy that comes with the Claude desktop app
function findClaude() {
    const isFile = p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
    try {
        const hits = execFileSync("where", ["claude"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const exe = hits.find(p => /\.exe$/i.test(p)) || hits.find(p => /\.cmd$/i.test(p));
        if (exe) return exe;
    } catch (e) { /* not on PATH */ }
    const base = path.join(process.env.APPDATA || "", "Claude", "claude-code");
    const ver = v => v.split(".").map(n => parseInt(n, 10) || 0);
    const newer = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };
    try {
        for (const v of fs.readdirSync(base).filter(d => /^\d+\.\d+\.\d+$/.test(d)).sort(newer))
            for (const h of fs.readdirSync(path.join(base, v))) { const p = path.join(base, v, h, "claude.exe"); if (isFile(p)) return p; }
    } catch (e) { /* no desktop app copy */ }
    const local = path.join(os.homedir(), ".local", "bin", "claude.exe");
    return isFile(local) ? local : null;
}

let busy = false;
function askClaude({ prompt, system, model }) {
    return new Promise(resolve => {
        const exe = findClaude();
        if (!exe) { resolve({ ok: false, error: "Couldn't find Claude Code. Install it, or open the Claude desktop app once so its copy is downloaded." }); return; }
        if (busy) { resolve({ ok: false, error: "Claude is still working on the last request." }); return; }
        busy = true;
        const m = MODELS.includes(model) ? model : "sonnet";
        // no tools, no MCP servers, no settings or hooks: just one short answer, so it costs as little as possible
        const args = ["-p", "--output-format", "json", "--model", m, "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--system-prompt", String(system || "")];
        const env = { ...process.env };
        delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT; // started from a Claude Code terminal: still run as its own session
        const cmd = /\.cmd$/i.test(exe);
        const child = spawn(cmd ? `"${exe}"` : exe, cmd ? args.map(a => `"${a.replace(/"/g, '\\"')}"`) : args, { cwd: os.tmpdir(), env, windowsHide: true, shell: cmd });
        const t0 = Date.now();
        let out = "", err = "";
        const done = r => { if (!busy) return; busy = false; clearTimeout(timer); resolve(r); };
        const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* gone */ } done({ ok: false, error: "Claude took too long (over 2.5 minutes)." }); }, 150000);
        child.stdout.on("data", d => (out += d));
        child.stderr.on("data", d => (err += d));
        child.on("error", e => done({ ok: false, error: "Couldn't start Claude: " + e.message }));
        child.on("close", code => {
            let j = null;
            try { j = JSON.parse(out); } catch (e) { /* not JSON */ }
            if (!j) { done({ ok: false, error: (err || out || "Claude exited with code " + code).trim().slice(0, 600) }); return; }
            if (j.is_error) { done({ ok: false, error: String(j.result || j.subtype || "Claude reported an error").slice(0, 600) }); return; }
            done({ ok: true, text: String(j.result || ""), cost: j.total_cost_usd || 0, ms: Date.now() - t0, model: m, tokens: j.usage ? (j.usage.input_tokens || 0) + (j.usage.cache_creation_input_tokens || 0) + (j.usage.cache_read_input_tokens || 0) + (j.usage.output_tokens || 0) : 0 });
        });
        child.stdin.end(String(prompt || ""));
    });
}

// ---- your work, kept safe outside the Studio's folder: Documents\Tree Sim 4 Studio (OneDrive syncs it if your Documents are synced).
// Every save goes there too, so downloading or updating the Studio never loses it, and on start the Studio offers to bring it back ----
function workspace(root) {
    const crypto = require("crypto"), WS = path.join(require("electron").app.getPath("documents"), "Tree Sim 4 Studio"), wsContent = path.join(WS, "content"), manifestF = path.join(WS, "manifest.json");
    const hash = t => crypto.createHash("sha1").update(t).digest("hex");
    const readT = f => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return null; } };
    const readManifest = () => { try { return JSON.parse(fs.readFileSync(manifestF, "utf8")); } catch (e) { return { files: {} }; } };
    function mirror(name, text) { // a save: the same file goes to Documents
        fs.mkdirSync(wsContent, { recursive: true });
        fs.writeFileSync(path.join(wsContent, CONTENT[name]), text, "utf8");
        const m = readManifest(); m.files = m.files || {}; m.files[name] = { hash: hash(text), savedAt: new Date().toISOString() }; m.studio = root;
        fs.writeFileSync(manifestF, JSON.stringify(m, null, 2) + "\n", "utf8");
    }
    function backup() { // once each time the Studio starts, a dated copy of everything in Documents (the last 15 are kept)
        if (!fs.existsSync(wsContent)) return;
        const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16), dest = path.join(WS, "backups", stamp);
        fs.mkdirSync(dest, { recursive: true });
        for (const f of fs.readdirSync(wsContent)) fs.copyFileSync(path.join(wsContent, f), path.join(dest, f));
        if (fs.existsSync(path.join(WS, "my-themes.json"))) fs.copyFileSync(path.join(WS, "my-themes.json"), path.join(dest, "my-themes.json"));
        const all = fs.readdirSync(path.join(WS, "backups")).sort();
        for (const old of all.slice(0, Math.max(0, all.length - 15))) fs.rmSync(path.join(WS, "backups", old), { recursive: true, force: true });
    }
    function summary(name, text) { // "2: Midwest Island, Mycelium Mire", for the "bring my work back?" question
        if (text === null) return "nothing";
        let v = null; try { const m = text.match(/export default\s*([\s\S]*?);?\s*$/); v = m ? JSON.parse(m[1].replace(/;\s*$/, "")) : null; } catch (e) { return "can't read it"; }
        if (name === "world") return `${((v && v.objects) || []).length} placed, ${((v && v.moves) || []).length} built-ins moved`;
        if (!Array.isArray(v)) return "?";
        const names = v.map(x => x && x.name).filter(Boolean);
        return v.length + (names.length ? ": " + names.slice(0, 4).join(", ") + (names.length > 4 ? "…" : "") : "");
    }
    function status() {
        const out = { ok: true, folder: WS, fresh: false, diff: [] }, m = readManifest();
        if (!fs.existsSync(wsContent)) { // the first time: what's here now is saved to Documents
            out.fresh = true;
            for (const name of Object.keys(CONTENT)) { const t = readT(path.join(root, "content", CONTENT[name])); if (t !== null) mirror(name, t); }
            return out;
        }
        for (const name of Object.keys(CONTENT)) {
            const here = readT(path.join(root, "content", CONTENT[name])), mine = readT(path.join(wsContent, CONTENT[name]));
            if (mine === null) { if (here !== null) mirror(name, here); continue; }
            if (here === mine) continue;
            out.diff.push({ name, file: CONTENT[name], mine: summary(name, mine), here: summary(name, here), savedAt: (m.files && m.files[name] && m.files[name].savedAt) || "" });
        }
        return out;
    }
    const restore = names => { for (const n of names) if (CONTENT[n]) { const t = readT(path.join(wsContent, CONTENT[n])); if (t !== null) fs.writeFileSync(path.join(root, "content", CONTENT[n]), t, "utf8"); } };
    const keepHere = names => { for (const n of names) if (CONTENT[n]) { const t = readT(path.join(root, "content", CONTENT[n])); if (t !== null) mirror(n, t); } };
    return { WS, mirror, backup, status, restore, keepHere };
}

function setup(ipcMain, root) {
    const dir = path.join(root, "content");
    const rel = require("./release.js");
    let releasing = false;
    const studioVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "studio.json"), "utf8")).version || ""; } catch (e) { return ""; } };
    const ws = workspace(root);
    try { ws.backup(); } catch (e) { /* no backup this time */ }
    ipcMain.handle("studio:info", () => ({ claude: findClaude(), content: dir, version: studioVersion(), ws: ws.WS }));
    ipcMain.handle("studio:wsStatus", () => { try { return ws.status(); } catch (err) { return { ok: false, error: String(err && err.message || err) }; } });
    ipcMain.handle("studio:wsRestore", (e, names) => { try { ws.restore(Array.isArray(names) ? names : []); return { ok: true }; } catch (err) { return { ok: false, error: String(err && err.message || err) }; } });
    ipcMain.handle("studio:wsKeep", (e, names) => { try { ws.keepHere(Array.isArray(names) ? names : []); return { ok: true }; } catch (err) { return { ok: false, error: String(err && err.message || err) }; } });
    ipcMain.handle("studio:wsOpen", () => { fs.mkdirSync(ws.WS, { recursive: true }); require("electron").shell.openPath(ws.WS); });
    // your own island themes: kept next to the Studio, never shipped
    const themesFile = path.join(__dirname, "my-themes.json"), wsThemes = path.join(ws.WS, "my-themes.json");
    ipcMain.handle("studio:themes", async (e, themes) => {
        try {
            if (themes && typeof themes === "object") { const t = JSON.stringify(themes, null, 2) + "\n"; await fs.promises.writeFile(themesFile, t, "utf8"); try { await fs.promises.mkdir(ws.WS, { recursive: true }); await fs.promises.writeFile(wsThemes, t, "utf8"); } catch (err) { /* Documents unavailable */ } }
            let saved = {};
            try { saved = JSON.parse(await fs.promises.readFile(themesFile, "utf8")); } catch (err) { try { saved = JSON.parse(await fs.promises.readFile(wsThemes, "utf8")); } catch (err2) { /* none yet */ } } // a fresh copy of the Studio still has your themes
            return { ok: true, themes: saved };
        } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
    });
    // the Release panel
    ipcMain.handle("studio:relStatus", () => rel.status(root));
    ipcMain.handle("studio:relChecks", (e, version, notes) => rel.checks(root, String(version || ""), String(notes || "")));
    ipcMain.handle("studio:release", async (e, req) => {
        if (releasing) return { ok: false, error: "A release is already running." };
        releasing = true;
        try { return await rel.release(root, req || {}, s => { if (!e.sender.isDestroyed()) e.sender.send("studio:relStep", s); }); }
        catch (err) { return { ok: false, error: String(err && err.message || err) }; }
        finally { releasing = false; }
    });
    ipcMain.handle("studio:ciStatus", (e, version) => rel.ciStatus(root, String(version || "")));
    ipcMain.handle("studio:openUrl", (e, url) => { if (/^https:\/\/github\.com\//.test(String(url))) require("electron").shell.openExternal(String(url)); });
    ipcMain.handle("studio:save", async (e, name, data) => {
        if (!CONTENT[name]) return { ok: false, error: "unknown content file: " + name };
        try {
            await fs.promises.mkdir(dir, { recursive: true });
            const file = path.join(dir, CONTENT[name]), tmp = file + ".tmp", text = HEADERS[name] + "export default " + JSON.stringify(data, null, 2) + ";\n";
            await fs.promises.writeFile(tmp, text, "utf8");
            await fs.promises.rename(tmp, file);
            let kept = true; try { ws.mirror(name, text); } catch (err) { kept = false; } // and a copy in Documents, safe from updates
            return { ok: true, file, kept };
        } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
    });
    ipcMain.handle("studio:askClaude", (e, req) => askClaude(req || {}));
}

module.exports = { setup, findClaude };

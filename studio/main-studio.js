// Tree Sim 4 Studio, main-process side: saves the content files and runs Claude for the tree designer.
// main.js loads this only for `npm run studio` from source. The installer never includes the studio folder.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const CONTENT = { trees: "trees.js", world: "world.js", islands: "islands.js", props: "props.js" };
const HEADERS = {
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

function setup(ipcMain, root) {
    const dir = path.join(root, "content");
    const rel = require("./release.js");
    let releasing = false;
    const studioVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "studio.json"), "utf8")).version || ""; } catch (e) { return ""; } };
    ipcMain.handle("studio:info", () => ({ claude: findClaude(), content: dir, version: studioVersion() }));
    // your own island themes: kept next to the Studio, never shipped
    const themesFile = path.join(__dirname, "my-themes.json");
    ipcMain.handle("studio:themes", async (e, themes) => {
        try {
            if (themes && typeof themes === "object") await fs.promises.writeFile(themesFile, JSON.stringify(themes, null, 2) + "\n", "utf8");
            let saved = {};
            try { saved = JSON.parse(await fs.promises.readFile(themesFile, "utf8")); } catch (err) { /* none yet */ }
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
            const file = path.join(dir, CONTENT[name]), tmp = file + ".tmp";
            await fs.promises.writeFile(tmp, HEADERS[name] + "export default " + JSON.stringify(data, null, 2) + ";\n", "utf8");
            await fs.promises.rename(tmp, file);
            return { ok: true, file };
        } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
    });
    ipcMain.handle("studio:askClaude", (e, req) => askClaude(req || {}));
}

module.exports = { setup, findClaude };

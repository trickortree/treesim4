// Tree Sim 4 Studio, Release panel backend (main process): looks at git, runs the checks, ships a version, and watches GitHub build it.
// Shipping = the same steps as the README: bump package.json, commit, push main, tag vX.Y.Z, push the tag. GitHub Actions does the rest.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" }; // never hang waiting for a typed password
delete ENV.CLAUDECODE;

function run(cmd, args, cwd, timeout = 60000, env = ENV) {
    return new Promise(resolve => {
        execFile(cmd, args, { cwd, env, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({ ok: !err, code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: String(stdout || "").replace(/\s+$/, ""), err: String(stderr || (err && err.message) || "").trim() }); // keep leading spaces: git status uses them
        });
    });
}
const git = (root, args, timeout) => run("git", args, root, timeout);
const vnum = v => String(v).replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
const newer = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
const isVersion = v => /^\d+\.\d+\.\d+$/.test(String(v));
const readPkg = root => JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
function repoSlug(root) {
    try { const p = readPkg(root).build.publish; if (p && p.owner && p.repo) return `${p.owner}/${p.repo}`; } catch (e) { /* no publish block */ }
    return null;
}
let ghOk = null;
async function hasGh() { if (ghOk === null) ghOk = (await run("gh", ["auth", "status"], process.cwd(), 15000)).ok; return ghOk; }

// what a content file held at a given commit ("" = the working copy). Missing files read as empty.
async function contentAt(root, rev, name) {
    let text = "";
    if (!rev) { try { text = fs.readFileSync(path.join(root, "content", name), "utf8"); } catch (e) { return null; } }
    else { const r = await git(root, ["show", `${rev}:content/${name}`]); if (!r.ok) return null; text = r.out; }
    const m = text.match(/export default\s*([\s\S]*?);?\s*$/);
    try { return m ? JSON.parse(m[1].replace(/;\s*$/, "")) : null; } catch (e) { return null; }
}
const BASE_ISLE = { 1: "Pine Island", 2: "the Highland Isle", 3: "Mooncap Isle", 4: "Ashfall Isle", 5: "the Archipelago", 6: "the Iceberg" };
async function contentChanges(root, since) {
    const out = { placed: [], trees: [] };
    const names = ((await contentAt(root, "", "islands.js")) || []).map(d => d && d.name);
    const ISLE = n => BASE_ISLE[n] || names[n - 7] || "island " + n; // islands made in the Studio go by their own names
    const w0 = (await contentAt(root, since, "world.js")) || { objects: [] }, w1 = (await contentAt(root, "", "world.js")) || { objects: [] };
    const before = new Map((w0.objects || []).map(o => [o.id, o])), after = new Map((w1.objects || []).map(o => [o.id, o]));
    const per = {};
    const bump = (isle, k) => { per[isle] = per[isle] || { added: 0, removed: 0, moved: 0, signs: [] }; per[isle][k]++; };
    for (const [id, o] of after) { if (!before.has(id)) { bump(o.isle, "added"); if (o.kind === "sign" && o.text) per[o.isle].signs.push(String(o.text).split("\n")[0]); } else if (JSON.stringify(before.get(id)) !== JSON.stringify(o)) bump(o.isle, "moved"); }
    for (const [id, o] of before) if (!after.has(id)) bump(o.isle, "removed");
    for (const [isle, c] of Object.entries(per)) out.placed.push({ isle: +isle, where: ISLE(+isle), ...c });
    const t0 = new Map(((await contentAt(root, since, "trees.js")) || []).map(t => [t.key, t])), t1 = new Map(((await contentAt(root, "", "trees.js")) || []).map(t => [t.key, t]));
    for (const [k, t] of t1) if (!t0.has(k)) out.trees.push({ change: "new", name: t.name, isl: (t.isl || []).map(i => ISLE(i)), night: !!t.night, rare: !!t.rare }); else if (JSON.stringify(t0.get(k)) !== JSON.stringify(t)) out.trees.push({ change: "changed", name: t.name, isl: (t.isl || []).map(i => ISLE(i)) });
    for (const [k, t] of t0) if (!t1.has(k)) out.trees.push({ change: "removed", name: t.name, isl: [] });
    out.islands = [];
    const i0 = (await contentAt(root, since, "islands.js")) || [], i1 = (await contentAt(root, "", "islands.js")) || [];
    i1.forEach((d, i) => { const was = i0[i]; if (!was) out.islands.push({ change: "new", name: d.name, rebirth: 6 + i, sub: d.sub || "" }); else if (JSON.stringify(was) !== JSON.stringify(d)) out.islands.push({ change: "changed", name: d.name, rebirth: 6 + i }); });
    for (let i = i1.length; i < i0.length; i++) out.islands.push({ change: "removed", name: i0[i].name, rebirth: 6 + i });
    // props from the Prop Maker: only the new ones are news (they show up wherever you placed them)
    const p0 = new Set(((await contentAt(root, since, "props.js")) || []).map(p => p.key)), used = new Set([...after.values()].map(o => o.prop));
    out.props = ((await contentAt(root, "", "props.js")) || []).filter(p => !p0.has(p.key)).map(p => ({ change: "new", name: p.name, placed: used.has(p.key) }));
    // animals from the Animal Maker: news once an island has them
    const a0 = new Set(((await contentAt(root, since, "animals.js")) || []).map(a => a.key)), onIsle = new Set(i1.flatMap(d => (d.animals || []).map(a => a.kind)));
    out.animals = ((await contentAt(root, "", "animals.js")) || []).filter(a => !a0.has(a.key)).map(a => ({ change: "new", name: a.name, used: onIsle.has(a.key) }));
    return out;
}

// everything the panel shows before you release
async function status(root) {
    const fetched = await git(root, ["fetch", "origin", "--tags", "--quiet"], 45000);
    const pkg = readPkg(root);
    const branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).out;
    const dirty = (await git(root, ["status", "--porcelain"])).out.split(/\r?\n/).filter(Boolean).map(l => ({ state: l.slice(0, 2).trim(), file: l.slice(3) }));
    const tags = (await git(root, ["tag", "-l", "v*"])).out.split(/\r?\n/).filter(t => isVersion(t.slice(1)));
    const lastTag = tags.reduce((a, t) => (!a || newer(t, a) ? t : a), "");
    const hasOrigin = (await git(root, ["rev-parse", "--verify", "--quiet", "origin/main"])).ok;
    let behind = 0, ahead = 0;
    if (hasOrigin) { const c = (await git(root, ["rev-list", "--left-right", "--count", "origin/main...HEAD"])).out.split(/\s+/); behind = +c[0] || 0; ahead = +c[1] || 0; }
    const mainIsAncestor = (await git(root, ["merge-base", "--is-ancestor", "main", "HEAD"])).ok;
    const commits = lastTag ? (await git(root, ["log", `${lastTag}..HEAD`, "--no-merges", "--format=%h%x1f%s%x1f%b%x1e"])).out.split("\x1e").map(s => s.trim()).filter(Boolean)
        .map(l => { const [hash, subject, body] = l.split("\x1f"); return { hash, subject, body: String(body || "").replace(/\n?Co-Authored-By:.*$/gim, "").trim().slice(0, 700) }; }) : [];
    return {
        version: pkg.version, notes: (pkg.build && pkg.build.releaseInfo && pkg.build.releaseInfo.releaseNotes) || "", branch, dirty, lastTag, behind, ahead, mainIsAncestor,
        online: fetched.ok, fetchError: fetched.ok ? "" : fetched.err, commits, content: await contentChanges(root, lastTag), repo: repoSlug(root), gh: await hasGh()
    };
}

// node --check every file the installer ships, using Electron's own Node so nothing else needs installing
async function syntaxCheck(root) {
    const files = ["game.js", "admin.js", "main.js", "preload.js", "updater.js", "intro.js", "content/trees.js", "content/world.js", "content/islands.js", "content/props.js", "content/animals.js", "content/people.js"].filter(f => fs.existsSync(path.join(root, f)));
    const bad = [];
    for (const f of files) {
        const r = await run(process.execPath, ["--check", f], root, 60000, { ...ENV, ELECTRON_RUN_AS_NODE: "1" });
        if (!r.ok) bad.push(f + ": " + (r.err.split(/\r?\n/).find(l => /Error/.test(l)) || r.err.slice(0, 200)));
    }
    return { files: files.length, bad };
}

// the go / no-go list. blocking = the Release button stays off
async function checks(root, version, notes) {
    const S = await status(root), out = [];
    const add = (name, ok, detail, blocking = true, fix = "") => out.push({ name, ok, detail, blocking: !ok && blocking, fix });
    add("Version", isVersion(version) && newer(version, S.lastTag || "0.0.0"), isVersion(version) ? (newer(version, S.lastTag || "0.0.0") ? `v${version} comes after ${S.lastTag || "nothing"}` : `v${version} isn't newer than ${S.lastTag}`) : "Use three numbers, like 1.8.1");
    const tagLocal = (await git(root, ["rev-parse", "--verify", "--quiet", `refs/tags/v${version}`])).ok;
    const tagRemote = S.online ? (await git(root, ["ls-remote", "--tags", "origin", `refs/tags/v${version}`], 30000)).out.length > 0 : false;
    add("Tag is free", !tagRemote, tagRemote ? `v${version} is already on GitHub` : tagLocal ? `v${version} exists only on this computer: it will be moved to the release commit` : `v${version} hasn't been used`);
    add("Release notes", String(notes || "").trim().length > 10, String(notes || "").trim().length > 10 ? "These show in the game's update popup" : "Write what's new: players see it in the update popup");
    const who = (await git(root, ["config", "user.name"])).out, mail = (await git(root, ["config", "user.email"])).out;
    add("Git knows who you are", !!(who && mail), who && mail ? `Commits as ${who}` : "Set your name and email: git config user.name \"...\" and git config user.email \"...\" in the game folder");
    add("Online", S.online, S.online ? "Connected to GitHub" : "Couldn't reach GitHub: " + S.fetchError.slice(0, 160));
    add("Has everything from GitHub", S.behind === 0, S.behind === 0 ? "Nothing on GitHub is missing here" : `GitHub has ${S.behind} commit(s) this copy doesn't (another release went out from somewhere else). Bring them in first: ask Claude to merge origin/main.`);
    add("Branch", S.branch === "main" || S.mainIsAncestor, S.branch === "main" ? "Shipping from main" : S.mainIsAncestor ? `On "${S.branch}": main will be moved up to it, then shipped` : `"${S.branch}" doesn't contain main's latest work: ask Claude to merge it first`);
    const syn = await syntaxCheck(root);
    add("Code loads", !syn.bad.length, syn.bad.length ? syn.bad.join(" · ") : `${syn.files} shipped files have no syntax errors`);
    add("Watching the build", S.gh || !!S.repo, S.gh ? "GitHub CLI is signed in" : "Will check GitHub's public API", false);
    return { status: S, checks: out, ok: !out.some(c => c.blocking) };
}

// the release itself, one step at a time. Each step is safe to run again, so a failed push can just be retried
async function release(root, { version, notes, title }, step) {
    const log = (id, state, detail = "") => step && step({ id, state, detail });
    const fail = (id, r) => { log(id, "fail", (r.err || r.out || "failed").slice(0, 600)); return { ok: false, step: id, error: r.err || r.out }; };
    if (!isVersion(version)) return { ok: false, step: "version", error: "bad version" };
    const tag = "v" + version, first = `Hypergamous Tree Chopping Simulator 4 - ${version}${title ? ` (${title.toUpperCase()})` : ""}`;
    const fullNotes = first + "\n\n" + String(notes).trim();

    log("package", "run");
    const file = path.join(root, "package.json"), raw = fs.readFileSync(file, "utf8"), pkg = JSON.parse(raw);
    pkg.version = version; pkg.build = pkg.build || {}; pkg.build.releaseInfo = { ...(pkg.build.releaseInfo || {}), releaseNotes: fullNotes };
    let text = JSON.stringify(pkg, null, 2) + "\n";
    if (raw.includes("\r\n")) text = text.replace(/\n/g, "\r\n");
    if (text !== raw) fs.writeFileSync(file, text, "utf8");
    log("package", "done", `version ${version}, notes saved`);

    log("commit", "run");
    const branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).out;
    const head = (await git(root, ["log", "-1", "--format=%s"])).out;
    const pending = (await git(root, ["status", "--porcelain"])).out;
    if (pending) {
        let r = await git(root, ["add", "-A"]); if (!r.ok) return fail("commit", r);
        let summary = (title || String(notes).split(/\r?\n/).map(l => l.replace(/^[-•*]\s*/, "").trim()).find(Boolean) || "update").replace(/\s+/g, " ").slice(0, 90);
        summary = summary === summary.toUpperCase() ? summary.toLowerCase() : /^[A-Z][a-z]/.test(summary) ? summary[0].toLowerCase() + summary.slice(1) : summary; // like "1.7.0: the Archipelago rebuilt"
        r = await git(root, ["commit", "-m", `${version}: ${summary}`]); if (!r.ok) return fail("commit", r);
        log("commit", "done", "committed " + pending.split(/\r?\n/).length + " changed file(s)");
    } else log("commit", "done", head.startsWith(version + ":") ? "already committed" : "nothing new to commit");

    log("main", "run");
    if (branch !== "main") {
        if (!(await git(root, ["merge-base", "--is-ancestor", "main", "HEAD"])).ok) return fail("main", { err: `main has work that "${branch}" doesn't. Merge first.` });
        let r = await git(root, ["branch", "-f", "main", "HEAD"]); if (!r.ok) return fail("main", r);
        r = await git(root, ["switch", "main"]); if (!r.ok) return fail("main", r);
        log("main", "done", `main moved up to "${branch}" (you're on main now)`);
    } else log("main", "done", "on main");

    log("push", "run");
    let r = await git(root, ["push", "origin", "main"], 180000); if (!r.ok) return fail("push", r);
    log("push", "done", "main is on GitHub");

    log("tag", "run");
    r = await git(root, ["tag", "-f", tag, "HEAD"]); if (!r.ok) return fail("tag", r);
    r = await git(root, ["push", "origin", tag], 120000); if (!r.ok) return fail("tag", r);
    log("tag", "done", `${tag} pushed: GitHub is building the installer`);
    return { ok: true, tag, commit: (await git(root, ["rev-parse", "--short", "HEAD"])).out };
}

// how GitHub's build of a tag is going, and whether the release (with latest.yml, which the game's updater reads) is out
async function ciStatus(root, version) {
    const repo = repoSlug(root), tag = "v" + version;
    if (!repo) return { ok: false, error: "no GitHub repo in package.json" };
    let run0 = null, rel = null;
    if (await hasGh()) {
        const r = await run("gh", ["run", "list", "--repo", repo, "--limit", "15", "--json", "headBranch,status,conclusion,url,createdAt"], root, 30000);
        if (r.ok) { try { run0 = JSON.parse(r.out).find(x => x.headBranch === tag) || null; } catch (e) { /* not JSON */ } }
        const v = await run("gh", ["release", "view", tag, "--repo", repo, "--json", "isDraft,url,assets,publishedAt"], root, 30000);
        if (v.ok) { try { const j = JSON.parse(v.out); rel = { draft: j.isDraft, url: j.url, assets: j.assets.map(a => a.name), at: j.publishedAt }; } catch (e) { /* not JSON */ } }
    } else {
        try {
            const runs = await (await fetch(`https://api.github.com/repos/${repo}/actions/runs?branch=${tag}&per_page=5`, { headers: { "User-Agent": "TreeSim4Studio" } })).json();
            const x = (runs.workflow_runs || [])[0]; if (x) run0 = { status: x.status, conclusion: x.conclusion, url: x.html_url, createdAt: x.created_at };
            const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers: { "User-Agent": "TreeSim4Studio" } });
            if (res.ok) { const j = await res.json(); rel = { draft: j.draft, url: j.html_url, assets: (j.assets || []).map(a => a.name), at: j.published_at }; }
        } catch (e) { return { ok: false, error: String(e.message || e) }; }
    }
    const live = !!rel && !rel.draft && rel.assets.includes("latest.yml") && rel.assets.some(a => /\.exe$/i.test(a));
    return { ok: true, tag, run: run0, release: rel, live };
}

module.exports = { status, checks, release, ciStatus, newer, isVersion };

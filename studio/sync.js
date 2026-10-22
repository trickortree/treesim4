// Tree Sim 4 Studio, Sync: brings in what's on GitHub without losing your own work. Releases are on origin/main, Studio updates on private/studio.
// Git merges the code. Content is merged here by key (trees, props, animals, people), name (islands) or id (placed things), so both sides are kept.
// Islands GitHub already has keep their rebirths; yours that it doesn't have come after them, and their trees and placed things move with them.
// The Studio's ⟳ Sync button runs this, and so do `npm run sync` and `npm run update` (sync, install, start the Studio).
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFile, execFileSync } = require("child_process");
const { CONTENT, HEADERS, workspace } = require("./main-studio.js");

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" }; // never hang waiting for a typed password
delete ENV.CLAUDECODE;
function run(cmd, args, cwd, timeout = 60000) {
    return new Promise(resolve => {
        execFile(cmd, args, { cwd, env: ENV, timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({ ok: !err, out: String(stdout || "").replace(/\s+$/, ""), err: String(stderr || (err && err.message) || "").trim() });
        });
    });
}
const git = (root, args, timeout) => run("git", args, root, timeout);

const FIRST = 7; // the first Studio island is island 7 (Rebirth 6)
const NAMES = Object.keys(CONTENT);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const EMPTY = name => (name === "world" ? { version: 1, objects: [] } : []);
const arr = v => (Array.isArray(v) ? v : []);
// a content file's value: null when there's no file, undefined when it can't be read
function parse(text) {
    if (text === null || text === undefined) return null;
    const m = String(text).match(/export default\s*([\s\S]*?);?\s*$/);
    if (!m) return undefined;
    try { return JSON.parse(m[1]); } catch (e) { /* the empty files' header default isn't strict JSON */ }
    try { return JSON.parse(JSON.stringify(vm.runInNewContext("(" + m[1] + ")", {}, { timeout: 1000 }))); } catch (e) { return undefined; }
}
const fileText = (name, data) => HEADERS[name] + "export default " + JSON.stringify(data, null, 2) + ";\n";
const readWork = (root, name) => { try { return fs.readFileSync(path.join(root, "content", CONTENT[name]), "utf8"); } catch (e) { return null; } };
async function readAt(root, rev, name) { const r = await git(root, ["show", `${rev}:content/${CONTENT[name]}`]); return r.ok ? r.out : null; }
async function contentAt(root, rev) { const X = {}; for (const n of NAMES) { const v = parse(await readAt(root, rev, n)); X[n] = v === null || v === undefined ? EMPTY(n) : v; } return X; }

// ---- merging content: B is what this copy had committed, O what it has now (yours), T what came in (GitHub's) ----
// a list's items with their ids; the same id twice gets #2, #3… so nothing is lost
function keyed(list, id) {
    const seen = Object.create(null);
    return arr(list).filter(v => v && typeof v === "object").map(v => { const b = String(id(v) ?? ""), c = (seen[b] = (seen[b] || 0) + 1); return { k: c > 1 ? `${b}#${c}` : b, v }; });
}
// GitHub's come first in their order, then yours it doesn't have. Changed on one side: that side's. Changed on both: yours.
// Each kept item remembers where it came from (from) and its id on each side (ok, tk), so island numbers and keys can follow it.
function merge3(B, O, T) {
    const bm = new Map(B.map(e => [e.k, e.v])), om = new Map(O.map(e => [e.k, e.v])), tm = new Map(T.map(e => [e.k, e.v]));
    const out = [], clash = [], both = [];
    for (const { k, v: t } of T) {
        const b = bm.get(k), o = om.get(k);
        if (o === undefined) { if (b === undefined || !same(b, t)) out.push({ v: t, from: "T", tk: k, ok: null }); continue; } // gone here: you removed it, unless GitHub changed it since
        if (b === undefined && !same(o, t)) { out.push({ v: t, from: "T", tk: k, ok: null }); clash.push({ k, v: o }); continue; } // both made a different one with this id
        if (b === undefined || same(o, b) || same(o, t)) out.push({ v: t, from: "T", tk: k, ok: k });
        else if (same(t, b)) out.push({ v: o, from: "O", tk: k, ok: k });
        else { out.push({ v: o, from: "O", tk: k, ok: k }); both.push(o); }
    }
    for (const { k, v: o } of O) {
        const b = bm.get(k);
        if (tm.has(k) || (b !== undefined && same(o, b))) continue; // already in, or GitHub removed it and you hadn't changed it
        out.push({ v: o, from: "O", tk: null, ok: k });
    }
    return { out, clash, both };
}
const KIND = { trees: ["tree", "trees"], props: ["prop", "props"], animals: ["animal", "animals"], people: ["person", "people"] };
function mergeContent(B, O, T) {
    const notes = [], ren = Object.create(null), lists = {}, came = [];
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    // trees, props, animals and people, by key. Two different ones with the same key: yours gets a new key
    for (const n of Object.keys(KIND)) {
        const kB = keyed(B[n], x => x.key), kO = keyed(O[n], x => x.key), kT = keyed(T[n], x => x.key), r = merge3(kB, kO, kT);
        const used = new Set([...kB, ...kO, ...kT].map(e => e.v.key));
        for (const c of r.clash) {
            let nk, i = 2; const base = String(c.v.key).replace(/_\d+$/, "");
            do nk = `${base}_${i++}`; while (used.has(nk));
            used.add(nk); ren[c.v.key] = nk;
            r.out.push({ v: { ...c.v, key: nk }, from: "O", tk: null, ok: c.k });
            notes.push(`Your ${KIND[n][0]} "${c.v.name || c.v.key}" had the same key as a different one from GitHub, so yours is ${nk} now.`);
        }
        for (const o of r.both) notes.push(`The ${KIND[n][0]} "${o.name || o.key}" was changed on both sides: kept yours.`);
        const inB = new Set(kB.map(e => e.k)), got = r.out.filter(e => e.ok === null && !inB.has(e.tk)).length;
        if (got) came.push(plural(got, ...KIND[n]));
        lists[n] = r.out;
    }
    // islands, by name. Their place in the list is their rebirth, so work out where each side's islands ended up
    const iB = keyed(B.islands, d => d.name), iO = keyed(O.islands, d => d.name), iT = keyed(T.islands, d => d.name), I = merge3(iB, iO, iT);
    for (const c of I.clash) {
        let nm, i = 2; do nm = `${c.v.name} (${i++})`; while (I.out.some(e => e.v.name === nm));
        I.out.push({ v: { ...c.v, name: nm }, from: "O", tk: null, ok: c.k });
        notes.push(`You and GitHub each have a different island called "${c.v.name}": yours is "${nm}" now.`);
    }
    const idxO = new Map(iO.map((e, i) => [e.k, i])), idxT = new Map(iT.map((e, i) => [e.k, i])), inB = new Set(iB.map(e => e.k)), mapO = {}, mapT = {};
    I.out.forEach((e, j) => {
        if (e.ok !== null) mapO[FIRST + idxO.get(e.ok)] = FIRST + j;
        if (e.tk !== null) mapT[FIRST + idxT.get(e.tk)] = FIRST + j;
        const name = e.v.name || "An island";
        if (e.ok === null && !inB.has(e.tk)) notes.push(`${name} came in from GitHub as Rebirth ${FIRST + j - 1}.`);
        else if (e.ok !== null && idxO.get(e.ok) !== j) notes.push(`${name} is Rebirth ${FIRST + j - 1} now (it was Rebirth ${FIRST + idxO.get(e.ok) - 1}), and its trees and placed things moved with it.`);
    });
    for (const e of iO) if (!I.out.some(x => x.ok === e.k)) notes.push(`${e.v.name || "An island"} was removed on GitHub, so it's gone here too.`);
    lists.islands = I.out;
    // built-in islands never move; a Studio island that's gone takes what was on it along
    const isle = (e, n) => (+n < FIRST ? +n : (e.from === "O" ? mapO : mapT)[+n]);
    lists.trees = lists.trees.map(e => (Array.isArray(e.v.isl) ? { ...e, v: { ...e.v, isl: e.v.isl.map(n => isle(e, n)).filter(n => n !== undefined) } } : e));
    // placed things by id, built-ins moved by island and number
    const wB = B.world || {}, wO = O.world || {}, wT = T.world || {};
    const objs = merge3(keyed(wB.objects, o => o.id), keyed(wO.objects, o => o.id), keyed(wT.objects, o => o.id));
    for (const c of objs.clash) objs.out.push({ v: { ...c.v, id: c.v.id + "s" }, from: "O", tk: null, ok: c.k });
    const mid = m => `${m.isle}:${m.i}`, moves = merge3(keyed(wB.moves, mid), keyed(wO.moves, mid), keyed(wT.moves, mid));
    for (const c of moves.clash) { const e = moves.out.find(x => x.tk === c.k); if (e) Object.assign(e, { v: c.v, from: "O", ok: c.k }); } // the same built-in moved on both: yours
    let lost = 0;
    const place = list => list.map(e => { const n = isle(e, e.v.isle); if (n === undefined) { lost++; return null; } return n === +e.v.isle ? e : { ...e, v: { ...e.v, isle: n } }; }).filter(Boolean);
    lists.objects = place(objs.out); lists.moves = place(moves.out);
    if (lost) notes.push(`${plural(lost, "placed thing", "placed things")} on removed islands went with them.`);
    const wIn = new Set(keyed(wB.objects, o => o.id).map(e => e.k)), gotObj = lists.objects.filter(e => e.ok === null && !wIn.has(e.tk)).length;
    if (gotObj) came.push(plural(gotObj, "placed thing", "placed things"));
    if (came.length) notes.push("Also from GitHub: " + came.join(", ") + ".");
    // yours that were given new keys: everything of yours that used the old key uses the new one
    const rn = v => (Array.isArray(v) ? v.map(rn) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [ren[k] || k, rn(x)])) : typeof v === "string" && ren[v] ? ren[v] : v);
    const vals = list => list.map(e => (e.from === "O" ? rn(e.v) : e.v));
    const data = {};
    for (const n of [...Object.keys(KIND), "islands"]) data[n] = vals(lists[n]);
    const { objects: _o, moves: _m, ...rest } = { ...wO, ...wT };
    data.world = { ...rest, objects: vals(lists.objects) };
    if (lists.moves.length || wT.moves || wO.moves) data.world.moves = vals(lists.moves);
    return { data, notes };
}
const norm = X => { const Y = {}; for (const n of NAMES) Y[n] = X[n] === null || X[n] === undefined ? EMPTY(n) : X[n]; return Y; };

// ---- the sync itself ----
async function sync(root, { log = () => {}, docs } = {}) {
    const fail = error => ({ ok: false, error, notes: [] });
    if (!(await git(root, ["rev-parse", "--is-inside-work-tree"])).ok) return fail("This copy of the game isn't a git copy (downloaded as a zip?), so it can't sync. Set it up with git first: see the Sync note in the vault.");
    if (fs.existsSync(path.join(root, ".git", "MERGE_HEAD"))) return fail("A git merge is half done in this folder. Ask Claude to finish or undo it, then sync.");
    const branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).out;
    if (!branch || branch === "HEAD") return fail("Git isn't on a branch here, so there's nothing to sync into. Ask Claude.");
    let dirty = (await git(root, ["status", "--porcelain"])).out.split(/\r?\n/).filter(l => l && !l.startsWith("??")).map(l => l.slice(3).replace(/^"|"$/g, "")).filter(f => !f.startsWith("content/"));
    if (dirty.includes("package-lock.json")) { await git(root, ["checkout", "HEAD", "--", "package-lock.json"]); dirty = dirty.filter(f => f !== "package-lock.json"); } // npm install rewrites it; it's made again after
    if (dirty.length) return fail(`These files have changes that aren't committed, and a sync could clash with them: ${dirty.slice(0, 6).join(", ")}${dirty.length > 6 ? "…" : ""}. Commit them first (ask Claude).`);

    log("Checking GitHub…");
    const remotes = (await git(root, ["remote"])).out.split(/\s+/).filter(Boolean);
    for (const r of ["origin", "private"].filter(r => remotes.includes(r))) {
        const f = await git(root, ["fetch", r, "--quiet"], 120000);
        if (!f.ok) return fail(`Couldn't reach GitHub (${r}): ${f.err.split(/\r?\n/)[0].slice(0, 200)}`);
    }
    let refs = [];
    for (const r of [...new Set(["origin/main", `origin/${branch}`, `private/${branch}`, "private/studio"])]) {
        if (!(await git(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${r}`])).ok) continue;
        if ((await git(root, ["merge-base", "--is-ancestor", r, "HEAD"])).ok) continue; // nothing new there
        refs.push(r);
    }
    const inside = [];
    for (const a of refs) for (const b of refs) if (a !== b && !inside.includes(b) && (await git(root, ["merge-base", "--is-ancestor", a, b])).ok) { inside.push(a); break; }
    refs = refs.filter(r => !inside.includes(r)); // one that's inside another comes in with it
    if (!refs.length) return { ok: true, nothing: true, notes: ["Already up to date: GitHub has nothing this copy doesn't."] };

    // your work: read before git touches anything, with a copy put aside in Documents\Tree Sim 4 Studio\backups
    const ws = workspace(root, docs), oldHead = (await git(root, ["rev-parse", "HEAD"])).out, oursText = {}, O = {};
    for (const n of NAMES) {
        oursText[n] = readWork(root, n); O[n] = parse(oursText[n]);
        if (O[n] === undefined) return fail(`content/${CONTENT[n]} can't be read, so it can't be merged safely. Ask Claude to look at it.`);
    }
    const B = await contentAt(root, "HEAD");
    const aside = path.join(ws.WS, "backups", new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19) + "-before-sync");
    try { fs.mkdirSync(aside, { recursive: true }); for (const n of NAMES) if (oursText[n] !== null) fs.writeFileSync(path.join(aside, CONTENT[n]), oursText[n], "utf8"); }
    catch (e) { return fail("Couldn't put a copy of your work aside first, so nothing was changed: " + e.message); }

    // git can only merge into a clean folder, so the content files go back to what's committed while it does (yours are safe in memory and in the copy)
    const tracked = new Set((await git(root, ["ls-files", "content"])).out.split(/\r?\n/).filter(Boolean));
    for (const n of NAMES) {
        const rel = "content/" + CONTENT[n];
        if (tracked.has(rel)) await git(root, ["checkout", "HEAD", "--", rel]);
        else if (oursText[n] !== null) fs.rmSync(path.join(root, rel), { force: true });
    }
    let error = "";
    const abort = async () => { if (fs.existsSync(path.join(root, ".git", "MERGE_HEAD"))) await git(root, ["merge", "--abort"]); };
    try {
        const who = (await git(root, ["config", "user.name"])).out && (await git(root, ["config", "user.email"])).out;
        for (const ref of refs) {
            if ((await git(root, ["merge-base", "--is-ancestor", ref, "HEAD"])).ok) continue;
            log(`Bringing in ${ref}…`);
            if ((await git(root, ["merge-base", "--is-ancestor", "HEAD", ref])).ok) { const r = await git(root, ["merge", "--ff-only", "--quiet", ref], 120000); if (!r.ok) throw new Error(r.err); continue; }
            // both sides have new commits: git merges the code, and the content files get the same merge as your work
            if (!who) throw new Error('Git needs your name and email to merge. Run: git config --global user.name "..." and git config --global user.email "..."');
            const base = (await git(root, ["merge-base", "HEAD", ref])).out;
            const m = await git(root, ["merge", "--no-commit", "--no-ff", "-X", "theirs", ref], 120000);
            if (!fs.existsSync(path.join(root, ".git", "MERGE_HEAD"))) throw new Error(m.err || m.out || "git merge failed");
            const stuck = (await git(root, ["diff", "--name-only", "--diff-filter=U"])).out.split(/\r?\n/).filter(f => f && !f.startsWith("content/"));
            if (stuck.length) { await abort(); throw new Error(`Git couldn't merge ${stuck.join(", ")} by itself. Ask Claude to sync.`); }
            const mc = mergeContent(await contentAt(root, base), await contentAt(root, "HEAD"), await contentAt(root, ref));
            for (const n of NAMES) {
                const now = parse(readWork(root, n));
                if (now !== undefined && same(norm({ [n]: now })[n], mc.data[n])) continue;
                fs.writeFileSync(path.join(root, "content", CONTENT[n]), fileText(n, mc.data[n]), "utf8");
                await git(root, ["add", "content/" + CONTENT[n]]);
            }
            const c = await git(root, ["commit", "--no-edit", "--quiet"]);
            if (!c.ok) { await abort(); throw new Error(c.err || "git commit failed"); }
        }
    } catch (err) { error = String(err && err.message || err); await abort(); }

    // your work back, merged with whatever came in
    const newHead = (await git(root, ["rev-parse", "HEAD"])).out;
    const mc = mergeContent(B, norm(O), await contentAt(root, "HEAD"));
    for (const n of NAMES) {
        const now = parse(readWork(root, n));
        if (!(now !== undefined && same(norm({ [n]: now })[n], mc.data[n])) && !(now === null && same(mc.data[n], EMPTY(n))))
            fs.writeFileSync(path.join(root, "content", CONTENT[n]), fileText(n, mc.data[n]), "utf8");
        const text = readWork(root, n);
        try { if (text !== null) ws.mirror(n, text); } catch (e) { /* Documents unavailable */ } // so the Studio doesn't offer to "bring back" the pre-sync copy
    }
    const notes = newHead === oldHead ? [] : [...mc.notes];
    const files = newHead === oldHead ? [] : (await git(root, ["diff", "--name-only", oldHead, newHead])).out.split(/\r?\n/).filter(Boolean);
    const commits = newHead === oldHead ? [] : (await git(root, ["log", "--no-merges", "--format=%s", `${oldHead}..${newHead}`])).out.split(/\r?\n/).filter(Boolean);
    const pkgDeps = async rev => { try { const p = JSON.parse((await git(root, ["show", `${rev}:package.json`])).out); return JSON.stringify([p.dependencies, p.devDependencies]); } catch (e) { return ""; } };
    const deps = files.includes("package-lock.json") || (files.includes("package.json") && (await pkgDeps(oldHead)) !== (await pkgDeps(newHead)));
    if (commits.length) notes.unshift(`${commits.length} new change${commits.length === 1 ? "" : "s"} from GitHub, like "${commits[0]}".`);
    return { ok: !error, error, notes, commits, code: files.some(f => !f.startsWith("content/")), deps, backup: aside };
}

module.exports = { sync, mergeContent, parse };

// npm run sync: the same, from a terminal
if (require.main === module) {
    (async () => {
        let docs = "";
        try { docs = execFileSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('MyDocuments')"], { encoding: "utf8", windowsHide: true }).trim(); } catch (e) { /* not Windows */ }
        const r = await sync(path.join(__dirname, ".."), { log: s => console.log(s), docs: docs || path.join(os.homedir(), "Documents") });
        for (const n of r.notes) console.log("  " + n);
        if (!r.ok) { console.error("Sync failed: " + r.error); process.exit(1); }
        console.log(r.nothing ? "Nothing to bring in." : "Synced." + (r.deps ? " New packages: npm install will fetch them." : ""));
    })();
}

// Tree Sim 4 Studio: an editor that runs inside the real game.
// game.js loads this only for `npm run studio` (?studio=1). It flies a free camera, places and moves signs and props,
// designs custom trees (with Claude if you like), saves everything to content/*.js, and play-tests with F5.
import * as THREE from "three";
import { TransformControls } from "../node_modules/three/examples/jsm/controls/TransformControls.js";

const T = window.__ts4, S = window.ts4Studio;
if (!T || !S) throw new Error("Tree Sim 4 Studio needs the game's studio handle (run it with npm run studio)");
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const r3 = v => Math.round(v * 1000) / 1000;
const DEG = Math.PI / 180;
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem("ts4studio_" + k); localStorage.setItem("ts4studio_" + k, v); } catch (e) { return null; } };

// ---------- the places you can edit ----------
const ISLES = [
    { id: "1", isle: 1, name: "Pine Island" }, { id: "2", isle: 2, name: "Highland Isle" }, { id: "3", isle: 3, name: "Mooncap Isle" }, { id: "4", isle: 4, name: "Ashfall Isle" },
    { id: "5:haven", isle: 5, arch: "haven", name: "Archipelago · Port Haven" }, { id: "5:coral", isle: 5, arch: "coral", name: "Archipelago · Coral Key" },
    { id: "5:skull", isle: 5, arch: "skull", name: "Archipelago · Skull Rock" }, { id: "5:frost", isle: 5, arch: "frost", name: "Archipelago · Frostcap" },
    { id: "5:storm", isle: 5, arch: "storm", name: "Archipelago · Storm Isle" }
];
const ISLE_NAME = { 1: "Pine Island", 2: "Highland Isle", 3: "Mooncap Isle", 4: "Ashfall Isle", 5: "the Archipelago" };
const curIsle = () => T.getIsle();
const curEntry = () => ISLES.find(e => e.isle === curIsle() && (e.isle !== 5 || e.arch === T.getArch())) || ISLES[0];

// ---------- data: what's in content/world.js and content/trees.js ----------
const world = { version: 1, objects: Array.isArray(T.CONTENT_WORLD.objects) ? T.CONTENT_WORLD.objects : [] }; // the very objects the game built from
let trees = (Array.isArray(T.CONTENT_TREES) ? T.CONTENT_TREES : []).filter(c => c && T.isCustomKey(c.key)).map(c => ({ ...c }));
let worldDirty = false, treesDirty = false, saveT = 0;
const newId = () => "o" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);

// ---------- styles ----------
const css = `
body.studio-edit #hud, body.studio-edit #floaters, body.studio-edit #dmgdir, body.studio-edit #bossBar, body.studio-edit #titleCard, body.studio-edit #hurt, body.studio-edit #death, body.studio-edit #menu { display: none !important; }
body:not(.studio-edit) .st { display: none !important; }
.st { position: fixed; z-index: 300; color: #e8dcff; font: 13px "Segoe UI", system-ui, sans-serif; user-select: none; box-sizing: border-box; }
.st * { box-sizing: border-box; }
#stBar { top: 0; left: 0; right: 0; height: 46px; display: flex; align-items: center; gap: 10px; padding: 0 12px; background: #130b20f2; border-bottom: 1px solid #ffd04044; box-shadow: 0 6px 30px rgba(0,0,0,.45); }
#stBar .logo { font: 900 15px "Segoe UI Black", sans-serif; letter-spacing: 3px; color: #ffd040; text-shadow: 0 2px 0 #5a2a8a; white-space: nowrap; margin-right: 6px; }
#stBar .sep { width: 1px; height: 24px; background: #3a2c55; }
#stBar .grow { flex: 1; }
.stB { cursor: pointer; background: #2a2040; color: #e8dcff; border: 1px solid #44365f; border-radius: 8px; padding: 6px 10px; font: 700 12px "Segoe UI"; white-space: nowrap; }
.stB:hover { border-color: #ffd040; color: #ffd040; } .stB.on { background: #ffd040; color: #1a0e00; border-color: #ffd040; }
.stB.go { background: #2a6a3a; border-color: #4aaa6a; color: #eaffef; } .stB.go:hover { color: #fff; border-color: #8affb0; }
.stB.warn:hover { border-color: #ff6a6a; color: #ff8a7a; } .stB:disabled { opacity: .45; cursor: default; }
.stSel, .stIn, .stTa { background: #0e0818; color: #fff; border: 1px solid #3a2c55; border-radius: 7px; padding: 5px 7px; font: 600 12px "Segoe UI"; outline: none; }
.stIn:focus, .stTa:focus, .stSel:focus { border-color: #ffd040; }
.stIn[type=number] { width: 74px; } .stIn[type=color] { width: 38px; height: 28px; padding: 1px 2px; }
.stTa { width: 100%; resize: vertical; min-height: 54px; font: 600 13px "Segoe UI"; }
#stSave.dirty::after { content: " ●"; color: #ffd040; }
#stLeft, #stRight { top: 54px; bottom: 44px; width: 330px; background: #150d24ee; border: 1px solid #3a2c55; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
#stLeft { left: 8px; } #stRight { right: 8px; width: 300px; }
#stRight.empty { display: none !important; }
.stTabs { display: flex; gap: 6px; padding: 10px 10px 0; }
.stTabs .stB { flex: 1; }
.stBody { flex: 1; overflow-y: auto; padding: 10px; }
.stBody::-webkit-scrollbar { width: 8px; } .stBody::-webkit-scrollbar-thumb { background: #4a3a6a; border-radius: 4px; }
.stH { font: 800 11px "Segoe UI"; letter-spacing: 2.5px; color: #8a7aa8; margin: 12px 0 7px; display: flex; justify-content: space-between; align-items: center; }
.stH:first-child { margin-top: 2px; } .stH small { letter-spacing: 0; font-weight: 600; opacity: .8; }
.stGrid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.stGrid .stB { padding: 8px 4px; font-size: 11px; white-space: normal; line-height: 1.15; }
.stRow { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.stRow label { font-weight: 700; white-space: nowrap; }
.stRow .stIn[type=text] { flex: 1; min-width: 0; }
.stChecks { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 6px; }
.stChecks label { display: flex; align-items: center; gap: 5px; font-weight: 600; cursor: pointer; }
.stList { display: flex; flex-direction: column; gap: 4px; }
.stItem { cursor: pointer; display: flex; justify-content: space-between; gap: 8px; padding: 6px 9px; background: #221838; border: 1px solid #33264d; border-radius: 8px; font-weight: 600; }
.stItem:hover { border-color: #ffd04088; } .stItem.on { border-color: #ffd040; background: #2e2246; } .stItem small { opacity: .6; }
.stHint { font: 11px "Segoe UI"; opacity: .6; margin: 4px 0 8px; line-height: 1.4; }
.stClaude { background: #1e1530; border: 1px solid #5a3a9a; border-radius: 10px; padding: 10px; margin-bottom: 4px; }
.stClaude .stH { margin-top: 0; color: #c8a0ff; }
.stMsg { font: 600 11px "Segoe UI"; margin-top: 6px; min-height: 14px; } .stMsg.bad { color: #ff8a7a; } .stMsg.good { color: #8affb0; }
.stBtns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
#stHelp { left: 346px; bottom: 8px; right: 316px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 14px; background: #130b20d8; border: 1px solid #3a2c55; border-radius: 9px; font: 600 11px "Segoe UI"; color: #b8a8d8; overflow: hidden; white-space: nowrap; }
#stHelp b { color: #ffd040; font-weight: 800; }
#stStatus { top: 56px; left: 50%; transform: translateX(-50%); padding: 6px 14px; background: #130b20e8; border: 1px solid #ffd04066; border-radius: 9px; font: 700 12px "Segoe UI"; opacity: 0; transition: opacity .25s; pointer-events: none; }
#stStatus.show { opacity: 1; }
#stPlayTag { position: fixed; z-index: 300; top: 10px; left: 50%; transform: translateX(-50%); padding: 5px 12px; background: #2a6a3acc; border: 1px solid #8affb0; border-radius: 8px; color: #eaffef; font: 800 12px "Segoe UI"; letter-spacing: 1px; pointer-events: none; display: none; }
body.studio-play #stPlayTag { display: block; }
`;
const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

// ---------- the editor's screen ----------
const bar = document.createElement("div"); bar.id = "stBar"; bar.className = "st";
bar.innerHTML = `<div class="logo">TREE SIM 4 STUDIO</div>
  <select class="stSel" id="stIsle" title="Island">${ISLES.map(e => `<option value="${e.id}">${e.name}</option>`).join("")}</select>
  <div class="sep"></div>
  <button class="stB on" data-gz="translate" title="Move (W)">Move <small>W</small></button>
  <button class="stB" data-gz="rotate" title="Rotate (E)">Rotate <small>E</small></button>
  <button class="stB" data-gz="scale" title="Size (R)">Size <small>R</small></button>
  <button class="stB" id="stSnap" title="Snap moves to 0.5 m, turns to 15°">Snap</button>
  <div class="sep"></div>
  <label title="Time of day">🕑 <input class="stIn" id="stClock" type="range" min="0" max="24" step="0.25" style="width:110px;vertical-align:middle"></label>
  <select class="stSel" id="stWx" title="Weather"><option value="clear">Clear</option><option value="cloudy">Cloudy</option><option value="rain">Rain</option><option value="storm">Storm</option><option value="fog">Fog</option></select>
  <select class="stSel" id="stFog" title="How much of the game's fog the editor shows (play-testing always uses the real fog)"><option value="light">Editor fog: light</option><option value="off">Editor fog: off</option><option value="game">Editor fog: as in game</option></select>
  <div class="grow"></div>
  <button class="stB" id="stUndo" title="Undo (Ctrl+Z)">↶</button><button class="stB" id="stRedo" title="Redo (Ctrl+Y)">↷</button>
  <label class="stHint" style="margin:0;opacity:.8"><input type="checkbox" id="stAuto"> autosave</label>
  <button class="stB" id="stSave" title="Save to content/ (Ctrl+S)">Save</button>
  <button class="stB go" id="stPlay" title="Play-test from the camera (F5)">▶ Play <small>F5</small></button>`;
const left = document.createElement("div"); left.id = "stLeft"; left.className = "st";
left.innerHTML = `<div class="stTabs"><button class="stB on" data-tab="place">Place</button><button class="stB" data-tab="trees">Trees</button></div><div class="stBody" id="stLeftBody"></div>`;
const right = document.createElement("div"); right.id = "stRight"; right.className = "st empty";
right.innerHTML = `<div class="stBody" id="stInsp"></div>`;
const help = document.createElement("div"); help.id = "stHelp"; help.className = "st";
help.innerHTML = `<span><b>Right-drag</b> look</span><span><b>WASD</b> fly (hold right mouse) · <b>Q/E</b> down/up · <b>Shift</b> fast</span><span><b>Wheel</b> zoom</span><span><b>Click</b> select</span><span><b>F</b> focus</span><span><b>Del</b> delete</span><span><b>Ctrl+D</b> duplicate</span><span><b>Ctrl+Z</b> undo</span><span><b>F12</b> console</span>`;
const status = document.createElement("div"); status.id = "stStatus"; status.className = "st";
const playTag = document.createElement("div"); playTag.id = "stPlayTag"; playTag.textContent = "PLAY-TESTING · F5 BACK TO THE STUDIO";
document.body.append(bar, left, right, help, status, playTag);
let statusT = 0;
function say(msg, ms = 2200) { status.textContent = msg; status.classList.add("show"); clearTimeout(statusT); statusT = setTimeout(() => status.classList.remove("show"), ms); }

// ---------- the free camera ----------
const camera = T.camera, canvas = T.canvas;
const cam = { pos: new THREE.Vector3(), yaw: 0, pitch: -0.25, speed: +pref("speed") || 16 };
const held = {}; // keys held down while flying
let looking = false, panning = false, mode = "edit";
const fwd = () => new THREE.Vector3(-Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch));
const rightV = () => new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
function lookAtPoint(p) { const d = new THREE.Vector3().subVectors(p, cam.pos); cam.yaw = Math.atan2(-d.x, -d.z); cam.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); }
function overview(e) {
    const I = e.arch ? T.ARCH_BY[e.arch] : null, cx = I ? I.x : 0, cz = I ? I.z : 0, r = I ? I.r : 100;
    cam.pos.set(cx, T.groundY(cx, cz) + r * 0.22 + 10, cz + r * 0.42);
    lookAtPoint(new THREE.Vector3(cx, T.groundY(cx, cz), cz - r * 0.1));
}
function fly(dt) {
    if (looking) {
        const f = fwd(), r = rightV(), up = new THREE.Vector3(0, 1, 0), mv = new THREE.Vector3();
        if (held.KeyW) mv.add(f); if (held.KeyS) mv.sub(f); if (held.KeyD) mv.add(r); if (held.KeyA) mv.sub(r);
        if (held.KeyE || held.Space) mv.add(up); if (held.KeyQ || held.ControlLeft) mv.sub(up);
        if (mv.lengthSq()) cam.pos.addScaledVector(mv.normalize(), cam.speed * (held.ShiftLeft || held.ShiftRight ? 3.5 : 1) * dt);
    }
    const g = T.groundY(cam.pos.x, cam.pos.z);
    if (cam.pos.y < g + 0.6) cam.pos.y = g + 0.6; // never under the ground
    camera.position.copy(cam.pos);
    camera.rotation.set(cam.pitch, cam.yaw, 0);
    if (camera.fov !== 70) { camera.fov = 70; camera.updateProjectionMatrix(); }
    // shadows, grass and the nearest lights follow the player, so the player follows the camera while you edit
    T.player.pos.set(cam.pos.x, g + 1.7, cam.pos.z); T.player.vel.set(0, 0, 0);
}
// the game's fog is made for walking about: the editor thins it out so you can see a whole island
let fogMode = pref("fog") || "light";
function afterSky() {
    const f = T.scene.fog; if (!f) return;
    if (fogMode === "off") { f.near = 4000; f.far = 9000; }
    else if (fogMode === "light") { f.near *= 4; f.far *= 6; }
}
T.setStudioHook({ frame: dt => { if (mode === "edit") fly(dt); }, afterSky });

// ---------- picking things under the mouse ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let mouse = { x: innerWidth / 2, y: innerHeight / 2 };
function setRay(mx, my) { const b = canvas.getBoundingClientRect(); ndc.set(((mx - b.left) / b.width) * 2 - 1, -((my - b.top) / b.height) * 2 + 1); camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera); }
// where the mouse ray meets the ground: march along it, then narrow it down
function groundHit(mx, my) {
    setRay(mx, my);
    const o = ray.ray.origin, d = ray.ray.direction, at = t => new THREE.Vector3().copy(o).addScaledVector(d, t);
    let t0 = 0, t = 0.3;
    if (at(0).y < T.groundY(o.x, o.z)) return null;
    while (t < 900) {
        const p = at(t);
        if (p.y <= T.groundY(p.x, p.z)) {
            for (let i = 0; i < 14; i++) { const m = (t0 + t) / 2, q = at(m); if (q.y <= T.groundY(q.x, q.z)) t = m; else t0 = m; }
            const h = at(t); h.y = T.groundY(h.x, h.z); return h;
        }
        t0 = t; t += Math.max(0.3, t * 0.02);
    }
    return null;
}
const islandRecs = () => T.placed.filter(p => +p.o.isle === curIsle());
function pickPlaced(mx, my) {
    setRay(mx, my);
    const recs = islandRecs(), hits = ray.intersectObjects(recs.map(p => p.g), true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.placed) o = o.parent; if (o) return o.userData.placed; }
    return null;
}

// ---------- the gizmo ----------
const tc = new TransformControls(camera, canvas);
tc.setSize(0.95);
T.scene.add(tc.getHelper());
let snap = pref("snap") === "1", gzMode = "translate";
function applySnap() { tc.setTranslationSnap(snap ? 0.5 : null); tc.setRotationSnap(snap ? 15 * DEG : null); tc.setScaleSnap(snap ? 0.1 : null); $("stSnap").classList.toggle("on", snap); }
function setGizmo(m) { gzMode = m; tc.setMode(m); bar.querySelectorAll("[data-gz]").forEach(b => b.classList.toggle("on", b.dataset.gz === m)); }
let sel = null; // the selected object's data
const selRec = () => (sel ? T.placedFind(sel) : null);
let lastS = 1;
tc.addEventListener("dragging-changed", e => {
    if (e.value) { pushUndo("drag"); lastS = selRec() ? selRec().g.scale.x : 1; }
    else { fromGizmo(); changed(); renderInspector(); }
});
tc.addEventListener("objectChange", fromGizmo);
function fromGizmo() {
    const rec = selRec(); if (!rec) return;
    const g = rec.g;
    if (gzMode === "scale") { // one size for all three axes: take whichever axis you dragged
        const c = [g.scale.x, g.scale.y, g.scale.z], s = c.reduce((a, v) => (Math.abs(v - lastS) > Math.abs(a - lastS) ? v : a), lastS);
        g.scale.setScalar(Math.min(20, Math.max(0.1, s)));
    }
    sel.x = r3(g.position.x); sel.y = r3(g.position.y); sel.z = r3(g.position.z);
    sel.rx = r3(g.rotation.x); sel.ry = r3(g.rotation.y); sel.rz = r3(g.rotation.z); sel.s = r3(g.scale.x);
    T.placedPose(rec);
}
function select(o) {
    sel = o;
    const rec = selRec();
    if (rec) tc.attach(rec.g); else tc.detach();
    renderInspector(); renderObjects();
}
function deselect() { sel = null; tc.detach(); renderInspector(); renderObjects(); }

// ---------- undo ----------
const undo = [], redo = [];
let lastUndo = { tag: "", t: 0 };
const snapshot = () => JSON.stringify(world.objects);
function pushUndo(tag) {
    const now = performance.now();
    if (tag && tag === lastUndo.tag && now - lastUndo.t < 1200) { lastUndo.t = now; return; } // typing into one field is one step
    lastUndo = { tag, t: now };
    undo.push(snapshot()); if (undo.length > 80) undo.shift();
    redo.length = 0;
}
function restore(snap) {
    const keepId = sel && sel.id;
    deselect(); cancelPlacing();
    for (const o of world.objects) T.placedRemove(o);
    world.objects.length = 0;
    for (const o of JSON.parse(snap)) { world.objects.push(o); T.placedBuild(o); }
    const back = world.objects.find(o => o.id === keepId); if (back) select(back);
    changed(); renderObjects();
}
function doUndo() { if (!undo.length) { say("Nothing to undo"); return; } redo.push(snapshot()); restore(undo.pop()); lastUndo = { tag: "", t: 0 }; say("Undone"); }
function doRedo() { if (!redo.length) { say("Nothing to redo"); return; } undo.push(snapshot()); restore(redo.pop()); say("Redone"); }

// ---------- saving ----------
function changed(what = "world") {
    if (what === "world") worldDirty = true; else treesDirty = true;
    $("stSave").classList.toggle("dirty", worldDirty || treesDirty);
    clearTimeout(saveT);
    if ($("stAuto").checked) saveT = setTimeout(() => saveAll(true), 1500);
}
async function saveAll(quiet) {
    clearTimeout(saveT);
    const jobs = [];
    if (worldDirty) jobs.push(S.save("world", { version: 1, objects: world.objects }).then(r => { if (r.ok) worldDirty = false; return r; }));
    if (treesDirty) jobs.push(S.save("trees", trees).then(r => { if (r.ok) treesDirty = false; return r; }));
    if (!jobs.length) { if (!quiet) say("Everything is saved"); return; }
    const res = await Promise.all(jobs), bad = res.find(r => !r.ok);
    $("stSave").classList.toggle("dirty", worldDirty || treesDirty);
    if (bad) say("Couldn't save: " + bad.error, 5000); else say(quiet ? "Autosaved" : "Saved to content/", quiet ? 900 : 2200);
}

// ---------- placing ----------
const SIGN_TEMPLATE = { kind: "sign", text: "WELCOME", style: "wood", color: "", post: true, solid: true };
let placing = null; // { o, rec, again }
function startPlacing(tpl) {
    cancelPlacing(); deselect();
    const o = { id: newId(), isle: curIsle(), ...JSON.parse(JSON.stringify(tpl)), x: 0, y: -9999, z: 0, rx: 0, ry: r3(cam.yaw), rz: 0, s: 1 };
    if (o.kind === "prop" && o.solid === undefined) o.solid = (T.PROPS[o.prop] || {}).r > 0;
    placing = { o, rec: T.placedBuild(o), tpl };
    movePlacing(mouse.x, mouse.y);
    say("Click the ground to place it · Esc to cancel · hold Shift to place more");
}
function movePlacing(mx, my) {
    if (!placing || !placing.rec) return;
    const h = groundHit(mx, my);
    placing.rec.g.visible = !!h;
    if (h) { placing.o.x = r3(h.x); placing.o.y = r3(h.y); placing.o.z = r3(h.z); T.placedPose(placing.rec); }
}
function commitPlacing(again) {
    if (!placing || !placing.rec.g.visible) return;
    pushUndo("");
    const { o, tpl } = placing;
    world.objects.push(o);
    placing = null;
    changed();
    if (again) startPlacing(tpl); else select(o);
    renderObjects();
}
function cancelPlacing() { if (placing) { T.placedRemove(placing.o); placing = null; } }

// ---------- editing the selected thing ----------
function removeSel() {
    if (!sel) return;
    pushUndo("");
    const o = sel; deselect();
    T.placedRemove(o); world.objects.splice(world.objects.indexOf(o), 1);
    changed(); renderObjects(); say("Deleted");
}
function duplicateSel() {
    if (!sel) return;
    pushUndo("");
    const o = { ...JSON.parse(JSON.stringify(sel)), id: newId() };
    const r = rightV(); o.x = r3(o.x + r.x * 2); o.z = r3(o.z + r.z * 2); o.y = r3(T.groundY(o.x, o.z));
    world.objects.push(o); T.placedBuild(o); select(o); changed(); say("Duplicated");
}
function focusSel() {
    const rec = selRec(); if (!rec) return;
    const p = rec.g.position.clone().add(new THREE.Vector3(0, 1.2 * (+sel.s || 1), 0));
    const back = fwd().setY(0).normalize();
    cam.pos.copy(p).addScaledVector(back, -7 * Math.max(1, +sel.s || 1)).add(new THREE.Vector3(0, 2.5, 0));
    lookAtPoint(p);
}
function edit(fn, tag, rebuild) {
    if (!sel) return;
    pushUndo(tag);
    fn(sel);
    const rec = rebuild ? T.placedRebuild(sel) : selRec();
    if (rec) { T.placedPose(rec); tc.attach(rec.g); }
    changed();
    if (rebuild) renderObjects(); // the list shows a sign's first line
}

// ---------- the inspector (right) ----------
function num(id, label, v, step = 0.1) { return `<div class="stRow"><label>${label}</label><input class="stIn" type="number" id="${id}" value="${v}" step="${step}"></div>`; }
function renderInspector() {
    const box = $("stInsp");
    if (!sel) { right.classList.add("empty"); box.innerHTML = ""; return; }
    right.classList.remove("empty");
    const o = sel, P = o.kind === "prop" ? T.PROPS[o.prop] || T.PROPS.rock : null;
    let h = `<div class="stH">${o.kind === "sign" ? "SIGN" : esc(P.name).toUpperCase()} <small>${esc(ISLE_NAME[o.isle] || "")}</small></div>`;
    if (o.kind === "sign") {
        h += `<textarea class="stTa" id="iText" rows="3" placeholder="Up to 4 lines">${esc(o.text || "")}</textarea>
          <div class="stRow" style="margin-top:6px"><label>Style</label><select class="stSel" id="iStyle"><option value="wood"${o.style !== "glow" ? " selected" : ""}>Wooden board</option><option value="glow"${o.style === "glow" ? " selected" : ""}>Glowing (game style)</option></select></div>
          <div class="stRow"><label>Text colour</label><span><input class="stIn" type="color" id="iColor" value="${o.color || (o.style === "glow" ? "#ffd040" : "#ffe8c0")}"> <button class="stB" id="iColorReset">reset</button></span></div>
          <div class="stChecks"><label><input type="checkbox" id="iPost"${o.post !== false ? " checked" : ""}> On a post</label></div>`;
    } else {
        h += `<div class="stRow"><label>Prop</label><select class="stSel" id="iProp">${Object.entries(T.PROPS).map(([k, p]) => `<option value="${k}"${k === o.prop ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>`;
        if (P.tint !== undefined) h += `<div class="stRow"><label>Colour</label><span><input class="stIn" type="color" id="iTint" value="${o.col || "#" + P.tint.toString(16).padStart(6, "0")}"> <button class="stB" id="iTintReset">reset</button></span></div>`;
    }
    const solidOk = o.kind === "sign" || (P && P.r > 0);
    h += `<div class="stH">PLACE</div>${num("iX", "X", o.x)}${num("iY", "Height", o.y)}${num("iZ", "Z", o.z)}
      ${num("iRy", "Turn °", Math.round((o.ry || 0) / DEG), 5)}${num("iRx", "Tilt fwd °", Math.round((o.rx || 0) / DEG), 5)}${num("iRz", "Tilt side °", Math.round((o.rz || 0) / DEG), 5)}${num("iS", "Size", o.s || 1, 0.05)}
      <div class="stChecks"><label title="${solidOk ? "You bump into it instead of walking through" : "This prop is too thin to bump into"}"><input type="checkbox" id="iSolid"${o.solid && solidOk ? " checked" : ""}${solidOk ? "" : " disabled"}> Solid</label></div>
      <div class="stBtns"><button class="stB" id="iGround">Snap to ground</button><button class="stB" id="iFace">Face camera</button><button class="stB" id="iFocus">Focus (F)</button><button class="stB" id="iDup">Duplicate</button><button class="stB warn" id="iDel">Delete</button></div>
      <div class="stHint">Drag the arrows to move it, or type exact numbers. Height is where its base sits.</div>`;
    box.innerHTML = h;
    const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
    let textT = 0;
    on("iText", "input", e => { const v = e.target.value.split("\n").slice(0, 4).join("\n"); clearTimeout(textT); textT = setTimeout(() => edit(o => (o.text = v), "text", true), 180); });
    on("iStyle", "change", e => edit(o => (o.style = e.target.value), "", true));
    on("iColor", "input", e => edit(o => (o.color = e.target.value), "color", true));
    on("iColorReset", "click", () => { edit(o => (o.color = ""), "", true); renderInspector(); });
    on("iPost", "change", e => edit(o => (o.post = e.target.checked), "", true));
    on("iProp", "change", e => { edit(o => { o.prop = e.target.value; delete o.col; if (!(T.PROPS[o.prop].r > 0)) o.solid = false; }, "", true); renderInspector(); renderObjects(); });
    on("iTint", "input", e => edit(o => (o.col = e.target.value), "tint", true));
    on("iTintReset", "click", () => { edit(o => delete o.col, "", true); renderInspector(); });
    const numEdit = (id, fn) => on(id, "input", e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) edit(o => fn(o, v), id); });
    numEdit("iX", (o, v) => (o.x = r3(v))); numEdit("iY", (o, v) => (o.y = r3(v))); numEdit("iZ", (o, v) => (o.z = r3(v)));
    numEdit("iRy", (o, v) => (o.ry = r3(v * DEG))); numEdit("iRx", (o, v) => (o.rx = r3(v * DEG))); numEdit("iRz", (o, v) => (o.rz = r3(v * DEG)));
    numEdit("iS", (o, v) => (o.s = r3(Math.min(20, Math.max(0.1, v)))));
    on("iSolid", "change", e => edit(o => (o.solid = e.target.checked), ""));
    on("iGround", "click", () => { edit(o => (o.y = r3(T.groundY(o.x, o.z))), ""); renderInspector(); });
    on("iFace", "click", () => { edit(o => (o.ry = r3(Math.atan2(cam.pos.x - o.x, cam.pos.z - o.z))), ""); renderInspector(); });
    on("iFocus", "click", focusSel); on("iDup", "click", duplicateSel); on("iDel", "click", removeSel);
}

// ---------- the left panel: Place and Trees ----------
let tab = pref("tab") === "trees" ? "trees" : "place";
function renderLeft() {
    left.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
    if (tab === "trees") renderTrees(); else renderPlace();
}
function renderPlace() {
    $("stLeftBody").innerHTML = `<div class="stH">SIGNS</div>
      <div class="stBtns" style="margin-top:0"><button class="stB" data-place="sign" style="flex:1">🪧 Wooden sign</button><button class="stB" data-place="glowsign" style="flex:1">✦ Glowing sign</button></div>
      <div class="stH">PROPS <small>click, then click the ground</small></div>
      <div class="stGrid">${Object.entries(T.PROPS).map(([k, p]) => `<button class="stB" data-place="p:${k}">${esc(p.name)}</button>`).join("")}</div>
      <div class="stH">ON THIS ISLAND <small id="stCount"></small></div><div class="stList" id="stObjects"></div>
      <div class="stHint">Everything you place is saved to <b>content/world.js</b> and ships with the game on your next release.</div>`;
    renderObjects();
}
function renderObjects() {
    const box = $("stObjects"); if (!box) return;
    const list = world.objects.filter(o => +o.isle === curIsle());
    $("stCount").textContent = list.length ? list.length + " placed" : "";
    box.innerHTML = list.length ? list.map(o => `<div class="stItem${o === sel ? " on" : ""}" data-oid="${esc(o.id)}"><span>${o.kind === "sign" ? "🪧 " + esc((o.text || "").split("\n")[0].slice(0, 22) || "Sign") : esc((T.PROPS[o.prop] || T.PROPS.rock).name)}</span><small>${Math.round(o.x)}, ${Math.round(o.z)}</small></div>`).join("") : `<div class="stHint">Nothing placed here yet.</div>`;
}
left.addEventListener("click", e => {
    const t = e.target.closest("[data-tab]");
    if (t) { tab = t.dataset.tab; pref("tab", tab); renderLeft(); return; }
    const p = e.target.closest("[data-place]");
    if (p) {
        const k = p.dataset.place;
        if (k === "sign") startPlacing(SIGN_TEMPLATE);
        else if (k === "glowsign") startPlacing({ ...SIGN_TEMPLATE, style: "glow", text: "THIS WAY" });
        else startPlacing({ kind: "prop", prop: k.slice(2) });
        return;
    }
    const it = e.target.closest("[data-oid]");
    if (it) { const o = world.objects.find(q => q.id === it.dataset.oid); if (o) { select(o); focusSel(); } }
});

// =====================================================================
//  the tree designer
// =====================================================================
const toHex = n => "#" + ((n >>> 0) & 0xffffff).toString(16).padStart(6, "0");
const isHex = s => typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s);
const clampN = (v, a, b, d) => { v = +v; return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
let treeSel = trees[0] ? trees[0].key : null, preview = null, previewH = 7;
const curTree = () => trees.find(t => t.key === treeSel) || null;
function uniqueKey(name) {
    const base = "c_" + (String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "tree");
    let k = base, n = 2;
    while (T.TYPES[k] || trees.some(t => t.key === k)) k = base + "_" + n++;
    return k;
}
function blankTree(name = "New Tree") {
    const i = curIsle();
    return { key: uniqueKey(name), name, shape: "round", leaf: ["#3a7a3a", "#2f6a3a"], trunk: "#4a3024", glow: "", dots: "", snow: false, rocks: false, col: "#a0d060",
        hp: 1.6, logs: 1.4, dmg: 1.1, speed: 1, bonus: 6, wd: 0.3, wn: 0.25, isl: [i], arch: i === 5 ? T.getArch() : "", minTier: 0, mat: "", rare: false, night: false, flee: false, titan: false, tall: false };
}
function fromBuiltin(k) {
    const B = T.TYPES[k], St = T.TREE_STYLE[k] || { s: "conifer" };
    return { ...blankTree(B.name + " Copy"), name: B.name + " Copy", shape: St.s, leaf: B.leaf.map(toHex), trunk: toHex(B.trunk), glow: B.glow !== undefined ? toHex(B.glow) : "", dots: St.dots !== undefined ? toHex(St.dots) : "",
        snow: !!St.snow, rocks: !!St.rocks, col: B.col, hp: B.hp, logs: B.logs, dmg: B.dmg, speed: B.speed, bonus: B.bonus, wd: B.wd, wn: B.wn, isl: [...(B.isl || [1])], arch: B.arch || "",
        minTier: B.minTier || 0, mat: B.mat || "", rare: !!B.rare, night: !!B.night, flee: !!B.flee, titan: !!B.titan, tall: !!B.tall };
}
const builtins = () => Object.entries(T.TYPES).filter(([k, B]) => !B.custom && !B.rush && (B.isl || [1]).length).map(([k, B]) => [k, B.name]);
const matsFor = tr => [...new Set(tr.isl.flatMap(i => T.MATS_BY_ISLE[i] || []))];
// a tree Claude (or a copy) gives us is checked field by field, so nothing broken reaches the game
function cleanTree(src, into) {
    const t = { ...into };
    if (typeof src.name === "string" && src.name.trim()) t.name = src.name.trim().slice(0, 32);
    if (T.TREE_SHAPES.includes(src.shape)) t.shape = src.shape;
    if (Array.isArray(src.leaf)) { const l = src.leaf.filter(isHex).slice(0, 3); if (l.length) t.leaf = l; }
    for (const k of ["trunk", "col"]) if (isHex(src[k])) t[k] = src[k];
    for (const k of ["glow", "dots"]) if (src[k] === "" || src[k] === null || src[k] === false) t[k] = ""; else if (isHex(src[k])) t[k] = src[k];
    for (const k of ["snow", "rocks", "rare", "night", "flee", "titan", "tall"]) if (typeof src[k] === "boolean") t[k] = src[k];
    const R = { hp: [0.3, 12, 1.5], logs: [0.1, 10, 1.4], dmg: [0, 3, 1], speed: [0.3, 3, 1], bonus: [0, 150, 6], wd: [0, 1.5, 0.3], wn: [0, 1.5, 0.3] };
    for (const [k, [a, b, d]] of Object.entries(R)) if (src[k] !== undefined) t[k] = r3(clampN(src[k], a, b, d));
    if (src.minTier !== undefined) t.minTier = Math.round(clampN(src.minTier, 0, T.AXES.length - 1, 0));
    if (src.mat !== undefined) t.mat = matsFor(t).includes(src.mat) ? src.mat : "";
    if (t.flee) t.dmg = 0;
    return t;
}
function applyTree(tr, quiet) { T.defineCustomTree(tr); if (!quiet) changed("trees"); showPreview(); }
function clearPreview() { if (preview) { T.scene.remove(preview.g); const i = T.trees.indexOf(preview); if (i >= 0) T.trees.splice(i, 1); preview = null; } }
function previewSpot() { // where the middle of the view meets the ground (or 12 m ahead if that's the sky)
    const l = left.getBoundingClientRect().right, r = right.classList.contains("empty") ? innerWidth : right.getBoundingClientRect().left;
    const h = groundHit((l + r) / 2, innerHeight * 0.55);
    if (h && h.distanceTo(cam.pos) < 60) return { x: h.x, z: h.z };
    const f = fwd().setY(0).normalize();
    return { x: cam.pos.x + f.x * 12, z: cam.pos.z + f.z * 12 };
}
let previewAt = null;
function showPreview(move) {
    const tr = curTree(); if (!tr || tab !== "trees" || mode !== "edit") { clearPreview(); return; }
    if (!previewAt || move) previewAt = previewSpot();
    clearPreview();
    const h = tr.titan ? Math.max(previewH, 10) : previewH;
    preview = T.makeTree(previewAt.x, previewAt.z, h, tr.key);
    const i = T.trees.indexOf(preview); if (i >= 0) T.trees.splice(i, 1); // a preview: it doesn't fight, creep or count
}
function spawnTest(n) {
    const tr = curTree(); if (!tr) return;
    const c = previewAt || previewSpot();
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, d = 5 + Math.random() * 10; T.makeTree(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, tr.titan ? 10 : 3 + Math.random() * 6, tr.key); }
    say(`${n} ${tr.name}s planted. Press F5 to go and chop them`);
}
function newTree(tr) { trees.push(tr); treeSel = tr.key; applyTree(tr); previewAt = null; renderTrees(); showPreview(true); }
function renderTrees() {
    const tr = curTree(), opt = (v, cur, label) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(label)}</option>`;
    let h = `<div class="stH">YOUR TREES <small>${trees.length ? trees.length + " made" : ""}</small></div>
      <div class="stList">${trees.map(t => `<div class="stItem${t.key === treeSel ? " on" : ""}" data-tree="${esc(t.key)}"><span><span style="color:${esc(t.col)}">●</span> ${esc(t.name)}</span><small>${t.isl.map(i => ISLE_NAME[i]).join(", ")}</small></div>`).join("") || `<div class="stHint">No custom trees yet. Make one below, copy a tree from the game, or ask Claude.</div>`}</div>
      <div class="stBtns"><button class="stB" id="tNew">+ New tree</button><select class="stSel" id="tCopy" style="flex:1"><option value="">Copy a game tree…</option>${builtins().map(([k, n]) => opt(k, "", n)).join("")}</select></div>`;
    if (!tr) { $("stLeftBody").innerHTML = h; bindTrees(); clearPreview(); return; }
    const mats = matsFor(tr), axes = T.AXES.map((a, i) => [i, `${i} · ${a.name}`]), c3 = (id, v, on) => `<input class="stIn" type="color" id="${id}" value="${isHex(v) ? v : "#808080"}"${on === false ? " disabled" : ""}>`;
    h += `<div class="stClaude" style="margin-top:12px"><div class="stH">✦ ASK CLAUDE <select class="stSel" id="tModel" title="Haiku is the cheapest">${opt("haiku", pref("model") || "haiku", "Haiku (cheapest)")}${opt("sonnet", pref("model") || "haiku", "Sonnet")}${opt("opus", pref("model") || "haiku", "Opus")}</select></div>
        <textarea class="stTa" id="tAsk" placeholder="Describe a tree, e.g. a ghostly willow that only grows at night on Mooncap and drops Voidglass"></textarea>
        <div class="stBtns"><button class="stB" id="tAskGo" style="flex:1">Design it with Claude</button></div><div class="stMsg" id="tAskMsg"></div></div>
      <div class="stH">NAME</div><div class="stRow"><input class="stIn" type="text" id="tName" value="${esc(tr.name)}"><small style="opacity:.5">${esc(tr.key)}</small></div>
      <div class="stH">LOOK</div>
      <div class="stRow"><label>Shape</label><select class="stSel" id="tShape">${T.TREE_SHAPES.map(s => opt(s, tr.shape, s)).join("")}</select></div>
      <div class="stRow"><label>Leaves</label><span>${c3("tLeaf0", tr.leaf[0])} ${c3("tLeaf1", tr.leaf[1] || tr.leaf[0])} ${c3("tLeaf2", tr.leaf[2] || tr.leaf[0])}</span></div>
      <div class="stChecks"><label><input type="checkbox" id="tLeafN1"${tr.leaf.length > 1 ? " checked" : ""}> 2nd leaf colour</label><label><input type="checkbox" id="tLeafN2"${tr.leaf.length > 2 ? " checked" : ""}> 3rd</label></div>
      <div class="stRow"><label>Trunk</label>${c3("tTrunk", tr.trunk)}</div>
      <div class="stRow"><label><input type="checkbox" id="tGlowOn"${tr.glow ? " checked" : ""}> Glow</label>${c3("tGlow", tr.glow || "#1a0a30", !!tr.glow)}</div>
      <div class="stRow"><label><input type="checkbox" id="tDotsOn"${tr.dots ? " checked" : ""}> Glowing dots</label>${c3("tDots", tr.dots || "#ffd040", !!tr.dots)}</div>
      <div class="stChecks"><label><input type="checkbox" id="tSnow"${tr.snow ? " checked" : ""}> Snow</label><label><input type="checkbox" id="tRocks"${tr.rocks ? " checked" : ""}> Rocks</label></div>
      <div class="stRow"><label>Nameplate</label>${c3("tCol", tr.col)}</div>
      <div class="stH">STATS <small>multipliers, like the game's trees</small></div>
      ${num("tHp", "Toughness (HP)", tr.hp)}${num("tLogs", "Drops (logs)", tr.logs)}${num("tDmg", "Hits you", tr.dmg)}${num("tSpeed", "Creep speed", tr.speed)}${num("tBonus", "Bonus", tr.bonus, 1)}
      <div class="stH">WHERE AND WHEN</div>
      <div class="stChecks">${[1, 2, 3, 4, 5].map(i => `<label><input type="checkbox" data-isl="${i}"${tr.isl.includes(i) ? " checked" : ""}> ${ISLE_NAME[i].replace("the ", "")}</label>`).join("")}</div>
      ${tr.isl.includes(5) ? `<div class="stRow"><label>Archipelago island</label><select class="stSel" id="tArch">${opt("", tr.arch, "any")}${["haven", "coral", "skull", "frost", "storm"].map(k => opt(k, tr.arch, T.ARCH_BY[k].name)).join("")}</select></div>` : ""}
      ${num("tWd", "Day weight", tr.wd, 0.01)}${num("tWn", "Night weight", tr.wn, 0.01)}
      <div class="stHint">Weights are chances next to the island's other trees: common ones are 0.5–0.9, rare ones 0.02–0.15.</div>
      <div class="stRow"><label>Appears from</label><select class="stSel" id="tTier" style="max-width:170px">${axes.map(([i, n]) => opt(i, tr.minTier, n)).join("")}</select></div>
      <div class="stRow"><label>Drops</label><select class="stSel" id="tMat">${opt("", tr.mat, tr.isl.some(i => i >= 2) ? "island default" : "logs (Pine Island)")}${mats.map(k => opt(k, tr.mat, T.MATS[k].name)).join("")}</select></div>
      <div class="stChecks">${[["rare", "Rare"], ["night", "Night only"], ["flee", "Runs away"], ["titan", "Titan (huge)"], ["tall", "Tall"]].map(([k, n]) => `<label><input type="checkbox" data-flag="${k}"${tr[k] ? " checked" : ""}> ${n}</label>`).join("")}</div>
      <div class="stH">PREVIEW</div>
      <div class="stRow"><label>Height</label><input class="stIn" id="tH" type="range" min="3" max="14" step="0.5" value="${previewH}" style="flex:1"></div>
      <div class="stBtns"><button class="stB" id="tHere">Move preview here</button><button class="stB" id="tSpawn">Plant 5 to chop</button><button class="stB warn" id="tDel">Delete tree</button></div>
      <div class="stHint">Changes show at once. Saved trees spawn in the real game the next time it starts.</div>`;
    $("stLeftBody").innerHTML = h;
    bindTrees();
}
function bindTrees() {
    const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
    on("tNew", "click", () => newTree(blankTree()));
    on("tCopy", "change", e => { if (e.target.value) newTree(fromBuiltin(e.target.value)); });
    const tr = curTree(); if (!tr) return;
    const set = (fn, rerender) => { fn(tr); applyTree(tr); if (rerender) renderTrees(); };
    on("tName", "input", e => set(t => (t.name = e.target.value.slice(0, 32) || "Tree")));
    on("tName", "change", () => renderTrees());
    on("tShape", "change", e => set(t => (t.shape = e.target.value)));
    const leaves = () => { const l = [$("tLeaf0").value]; if ($("tLeafN1").checked) l.push($("tLeaf1").value); if ($("tLeafN2").checked) l.push($("tLeaf2").value); return l; };
    for (const id of ["tLeaf0", "tLeaf1", "tLeaf2"]) on(id, "input", () => set(t => (t.leaf = leaves())));
    for (const id of ["tLeafN1", "tLeafN2"]) on(id, "change", () => set(t => (t.leaf = leaves())));
    on("tTrunk", "input", e => set(t => (t.trunk = e.target.value)));
    on("tGlowOn", "change", e => set(t => (t.glow = e.target.checked ? $("tGlow").value : ""), true));
    on("tGlow", "input", e => set(t => (t.glow = e.target.value)));
    on("tDotsOn", "change", e => set(t => (t.dots = e.target.checked ? $("tDots").value : ""), true));
    on("tDots", "input", e => set(t => (t.dots = e.target.value)));
    on("tSnow", "change", e => set(t => (t.snow = e.target.checked)));
    on("tRocks", "change", e => set(t => (t.rocks = e.target.checked)));
    on("tCol", "input", e => set(t => (t.col = e.target.value)));
    const numT = (id, k, a, b) => on(id, "input", e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) set(t => (t[k] = r3(Math.min(b, Math.max(a, v))))); });
    numT("tHp", "hp", 0.3, 12); numT("tLogs", "logs", 0.1, 10); numT("tDmg", "dmg", 0, 3); numT("tSpeed", "speed", 0.3, 3); numT("tBonus", "bonus", 0, 150); numT("tWd", "wd", 0, 1.5); numT("tWn", "wn", 0, 1.5);
    $("stLeftBody").querySelectorAll("[data-isl]").forEach(cb => cb.addEventListener("change", () => {
        const isl = [...$("stLeftBody").querySelectorAll("[data-isl]")].filter(c => c.checked).map(c => +c.dataset.isl);
        if (!isl.length) { cb.checked = true; say("A tree needs at least one island"); return; }
        set(t => { t.isl = isl; if (!isl.includes(5)) t.arch = ""; if (t.mat && !matsFor(t).includes(t.mat)) t.mat = ""; }, true);
    }));
    on("tArch", "change", e => set(t => (t.arch = e.target.value)));
    on("tTier", "change", e => set(t => (t.minTier = +e.target.value)));
    on("tMat", "change", e => set(t => (t.mat = e.target.value)));
    $("stLeftBody").querySelectorAll("[data-flag]").forEach(cb => cb.addEventListener("change", () => set(t => { t[cb.dataset.flag] = cb.checked; if (t.flee) t.dmg = 0; }, cb.dataset.flag === "flee")));
    on("tH", "input", e => { previewH = +e.target.value; showPreview(); });
    on("tHere", "click", () => showPreview(true));
    on("tSpawn", "click", () => spawnTest(5));
    on("tDel", "click", () => {
        if (!confirm(`Delete ${tr.name}? It stops spawning in the game once you save.`)) return;
        clearPreview(); T.dropCustomTree(tr.key); trees = trees.filter(t => t !== tr); treeSel = trees[0] ? trees[0].key : null; changed("trees"); renderTrees(); showPreview(true);
    });
    on("tModel", "change", e => pref("model", e.target.value));
    on("tAskGo", "click", () => askClaude(tr));
    $("stLeftBody").querySelectorAll("[data-tree]").forEach(it => it.addEventListener("click", () => { treeSel = it.dataset.tree; renderTrees(); showPreview(true); }));
}

// ---------- Ask Claude: one short request, a JSON tree back ----------
const CLAUDE_SYSTEM = "You design trees for Hypergamous Tree Chopping Simulator 4, a spooky, cheerful first-person tree-chopping game where the trees are alive, watch you, and creep closer when you look away. Reply with ONLY one JSON object: no prose, no code fences.";
function claudePrompt(desc, tr) {
    const isl = tr.isl, here = Object.entries(T.TYPES).filter(([k, B]) => !B.rush && (B.isl || [1]).some(i => isl.includes(i))).slice(0, 14)
        .map(([k, B]) => ({ name: B.name, shape: (T.TREE_STYLE[k] || {}).s, hp: B.hp, logs: B.logs, dmg: B.dmg, wd: B.wd, wn: B.wn, minTier: B.minTier || 0, mat: B.mat || "", rare: !!B.rare, night: !!B.night, flee: !!B.flee, titan: !!B.titan }));
    const mats = matsFor(tr).map(k => `${k} (${T.MATS[k].name}, $${T.MATS[k].price})`).join(", ");
    return `Design one tree from this description: "${desc}"

It grows on: ${isl.map(i => ISLE_NAME[i]).join(", ")}. Trees already there, for balance: ${JSON.stringify(here)}
${mats ? "Material keys it can drop: " + mats + "." : "On Pine Island trees drop plain logs, so leave mat empty."}
Axes go from index 0 (Rusty Axe) to ${T.AXES.length - 1} (${T.AXES[T.AXES.length - 1].name}); minTier is the best axe needed before the tree appears.

Return JSON with exactly these fields:
{"name": "1-3 words, Title Case", "shape": "conifer|round|tall|birch|spiky|dead|crystal|shroom|xmas", "leaf": ["#rrggbb", up to 3 canopy colours], "trunk": "#rrggbb",
 "glow": "#rrggbb dark emissive tint for magical trees, like #1a0a30, or empty string", "dots": "#rrggbb glowing fruit or sparkle dots, or empty string", "snow": false, "rocks": false,
 "col": "#rrggbb bright nameplate colour", "hp": 0.6-9, "logs": 0.3-8, "dmg": 0-2.5 (0 if it runs away), "speed": 0.6-2, "bonus": 0-100,
 "wd": 0-1 day spawn weight, "wn": 0-1 night spawn weight, "minTier": 0-${T.AXES.length - 1}, "mat": "a material key above or empty",
 "rare": bool, "night": bool (only at night), "flee": bool (runs away, never attacks), "titan": bool (huge), "tall": bool}
Make it fit the description and the island's mood, and keep the numbers balanced against the trees already there.`;
}
async function askClaude(tr) {
    const desc = $("tAsk").value.trim(), msg = $("tAskMsg"), btn = $("tAskGo");
    if (!desc) { msg.className = "stMsg bad"; msg.textContent = "Describe the tree first."; return; }
    const model = $("tModel").value;
    btn.disabled = true; btn.textContent = "Claude is designing it…"; msg.className = "stMsg"; msg.textContent = `Asking ${model}…`;
    const r = await S.askClaude({ prompt: claudePrompt(desc, tr), system: CLAUDE_SYSTEM, model });
    btn.disabled = false; btn.textContent = "Design it with Claude";
    if (!r.ok) { msg.className = "stMsg bad"; msg.textContent = r.error; return; }
    let j = null;
    try { j = JSON.parse((r.text.match(/\{[\s\S]*\}/) || [""])[0]); } catch (e) { /* not JSON */ }
    if (!j) { msg.className = "stMsg bad"; msg.textContent = "Claude's answer wasn't a tree. Try again or reword it."; return; }
    const cur = curTree(); if (!cur) return;
    Object.assign(cur, cleanTree(j, cur));
    applyTree(cur); renderTrees();
    const m2 = $("tAskMsg"); if (m2) { m2.className = "stMsg good"; m2.textContent = `${cur.name}, designed by ${r.model} in ${(r.ms / 1000).toFixed(1)}s · ~${(r.tokens / 1000).toFixed(1)}k tokens`; }
    $("tAsk") && ($("tAsk").value = desc);
}

// ---------- play-testing ----------
let camSaved = null;
function play() {
    if (mode !== "edit") return;
    cancelPlacing(); tc.detach(); clearPreview();
    camSaved = { pos: cam.pos.clone(), yaw: cam.yaw, pitch: cam.pitch };
    mode = "play";
    document.body.classList.remove("studio-edit"); document.body.classList.add("studio-play");
    const g = T.groundY(cam.pos.x, cam.pos.z);
    T.setPos(cam.pos.x, cam.pos.z, cam.yaw, 0);
    T.player.pos.y = g + 1.7; T.player.vel.set(0, 0, 0); T.player.hp = T.player.maxHp;
    for (const k in T.keys) T.keys[k] = false;
    T.startPlaying();
}
function stop() {
    if (mode !== "play") return;
    mode = "edit";
    T.setState("studio");
    try { document.exitPointerLock(); } catch (e) { /* not locked */ }
    for (const k in T.keys) T.keys[k] = false;
    document.body.classList.add("studio-edit"); document.body.classList.remove("studio-play");
    if (camSaved) { cam.pos.copy(camSaved.pos); cam.yaw = camSaved.yaw; cam.pitch = camSaved.pitch; }
    if (sel) select(sel);
    if (tab === "trees") showPreview();
    syncBar();
}

// ---------- islands, time, weather ----------
function goIsle(id) {
    const e = ISLES.find(q => q.id === id); if (!e) return;
    deselect(); cancelPlacing(); clearPreview(); previewAt = null;
    const enter = [null, T.enterIsle1, T.enterIsle2, T.enterIsle3, T.enterIsle4, T.enterIsle5][e.isle];
    if (curIsle() !== e.isle) enter();
    if (e.arch && T.getArch() !== e.arch) T.setArch5(e.arch, true);
    T.setState("studio");
    overview(e);
    renderLeft(); syncBar();
    say("Now editing " + e.name);
}
function syncBar() {
    $("stIsle").value = curEntry().id;
    if (document.activeElement !== $("stClock")) $("stClock").value = Math.round(T.getClock() * 4) / 4;
    try { if (document.activeElement !== $("stWx")) $("stWx").value = T.wx.type || "clear"; } catch (e) { /* weather not ready */ }
}
setInterval(() => { if (mode === "edit") syncBar(); }, 1000); // the weather still changes by itself while you edit

// ---------- wiring up the bar ----------
bar.addEventListener("click", e => {
    const g = e.target.closest("[data-gz]"); if (g) { setGizmo(g.dataset.gz); return; }
});
$("stIsle").addEventListener("change", e => { goIsle(e.target.value); e.target.blur(); });
$("stSnap").addEventListener("click", () => { snap = !snap; pref("snap", snap ? "1" : "0"); applySnap(); });
$("stClock").addEventListener("input", e => T.setClock(+e.target.value));
$("stWx").addEventListener("change", e => { T.setWeather(e.target.value, false); e.target.blur(); });
$("stFog").value = fogMode;
$("stFog").addEventListener("change", e => { fogMode = e.target.value; pref("fog", fogMode); e.target.blur(); });
$("stUndo").addEventListener("click", doUndo); $("stRedo").addEventListener("click", doRedo);
$("stAuto").checked = pref("auto") !== "0";
$("stAuto").addEventListener("change", e => { pref("auto", e.target.checked ? "1" : "0"); if (e.target.checked && (worldDirty || treesDirty)) saveAll(true); });
$("stSave").addEventListener("click", () => saveAll(false));
$("stPlay").addEventListener("click", play);

// ---------- mouse on the 3D view ----------
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("pointerdown", e => {
    if (mode !== "edit") return;
    mouse = { x: e.clientX, y: e.clientY };
    if (e.button === 2) { looking = true; tc.enabled = false; try { canvas.requestPointerLock(); } catch (er) { /* fine without */ } return; }
    if (e.button === 1) { panning = true; tc.enabled = false; e.preventDefault(); return; }
    if (e.button !== 0) return;
    if (placing) { commitPlacing(e.shiftKey); return; }
    if (tc.axis || tc.dragging) return; // the gizmo has it
    const o = pickPlaced(e.clientX, e.clientY);
    if (o) select(o); else deselect();
});
addEventListener("pointerup", e => {
    if (e.button === 2 && looking) { looking = false; tc.enabled = true; try { if (document.pointerLockElement === canvas && mode === "edit") document.exitPointerLock(); } catch (er) { /* not locked */ } for (const k in held) held[k] = false; }
    if (e.button === 1 && panning) { panning = false; tc.enabled = true; }
});
addEventListener("pointermove", e => {
    if (mode !== "edit") return;
    if (looking) {
        const mx = e.movementX, my = e.movementY;
        if (Math.abs(mx) > 300 || Math.abs(my) > 200) return; // a glitch spike, not a real flick
        cam.yaw -= mx * 0.0025; cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - my * 0.0025));
        return;
    }
    if (panning) { const k = cam.speed * 0.012; cam.pos.addScaledVector(rightV(), -e.movementX * k); cam.pos.y += e.movementY * k; return; }
    mouse = { x: e.clientX, y: e.clientY };
    if (placing) movePlacing(e.clientX, e.clientY);
});
canvas.addEventListener("wheel", e => {
    if (mode !== "edit") return;
    e.preventDefault();
    if (looking) { cam.speed = Math.min(160, Math.max(2, cam.speed * (e.deltaY > 0 ? 0.85 : 1.18))); pref("speed", cam.speed.toFixed(1)); say(`Fly speed ${cam.speed.toFixed(0)}`, 900); return; }
    cam.pos.addScaledVector(fwd(), (e.deltaY > 0 ? -1 : 1) * Math.max(1.5, cam.speed * 0.25));
}, { passive: false });

// ---------- keys ----------
const typing = e => e.target && e.target.closest && e.target.closest("input, textarea, select");
addEventListener("keydown", e => {
    if (e.code === "F5") { e.preventDefault(); e.stopImmediatePropagation(); if (mode === "edit") play(); else stop(); return; }
    if (mode !== "edit") return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === "KeyS") { e.preventDefault(); saveAll(false); return; }
    if (typing(e)) return;
    if (looking) { held[e.code] = true; e.preventDefault(); return; } // flying: WASD, Q/E, Shift
    if (ctrl && e.code === "KeyZ") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (ctrl && e.code === "KeyY") { e.preventDefault(); doRedo(); return; }
    if (ctrl && e.code === "KeyD") { e.preventDefault(); duplicateSel(); return; }
    if (e.code === "Delete" || e.code === "Backspace") { removeSel(); return; }
    if (e.code === "Escape") { if (placing) { cancelPlacing(); say("Cancelled"); } else deselect(); return; }
    if (e.code === "KeyF") { focusSel(); return; }
    if (e.code === "KeyW") setGizmo("translate");
    else if (e.code === "KeyE") setGizmo("rotate");
    else if (e.code === "KeyR") setGizmo("scale");
}, true);
addEventListener("keyup", e => { held[e.code] = false; });
addEventListener("blur", () => { for (const k in held) held[k] = false; looking = false; panning = false; tc.enabled = true; });

// ---------- start ----------
document.title = "Tree Sim 4 Studio";
T.setState("studio");
document.body.classList.add("studio-edit");
cam.pos.copy(T.player.pos).add(new THREE.Vector3(0, 3, 0)); cam.yaw = T.player.yaw || 0; cam.pitch = -0.2;
if (curIsle() === 1 && Math.hypot(cam.pos.x, cam.pos.z) < 2) overview(ISLES[0]);
applySnap(); setGizmo("translate"); renderLeft(); renderInspector(); syncBar();
for (const tr of trees) T.defineCustomTree(tr);
if (tab === "trees") showPreview(true);
S.info().then(i => { if (!i.claude) say("Claude Code wasn't found, so Ask Claude is off. Everything else works.", 6000); });
say("Tree Sim 4 Studio · right-drag to look around, F5 to play", 3500);
window.__ts4studio = { world, get trees() { return trees; }, cam, select, goIsle, play, stop, saveAll, startPlacing, commitPlacing, groundHit };

// Tree Sim 4 Studio: an editor that runs inside the real game.
// game.js loads this only for `npm run studio` (?studio=1). It flies a free camera, places and moves signs and props,
// designs custom trees (with Claude if you like), saves everything to content/*.js, and play-tests with F5.
import * as THREE from "three";
import { TransformControls } from "../node_modules/three/examples/jsm/controls/TransformControls.js";

const T = window.__ts4, S = window.ts4Studio;
// Claude runs three requests at once at most (the main process allows three); the rest wait their turn
let askOn = 0; const askWait = [];
function askQ(req) {
    return new Promise(res => {
        const go = () => { askOn++; S.askClaude(req).catch(e => ({ ok: false, error: String(e) })).then(r => { askOn--; res(r); const nx = askWait.shift(); if (nx) nx(); }); };
        if (askOn < 3) go(); else askWait.push(go);
    });
}
if (!T || !S) throw new Error("Tree Sim 4 Studio needs the game's studio handle (run it with npm run studio)");
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const r3 = v => Math.round(v * 1000) / 1000;
const DEG = Math.PI / 180;
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem("ts4studio_" + k); localStorage.setItem("ts4studio_" + k, v); } catch (e) { return null; } };

// ---------- the places you can edit ----------
const BASE_ISLES = [
    { id: "1", isle: 1, name: "Pine Island" }, { id: "2", isle: 2, name: "Highland Isle" }, { id: "3", isle: 3, name: "Mooncap Isle" }, { id: "4", isle: 4, name: "Ashfall Isle" },
    { id: "5:haven", isle: 5, arch: "haven", name: "Archipelago · Port Haven" }, { id: "5:coral", isle: 5, arch: "coral", name: "Archipelago · Coral Key" },
    { id: "5:skull", isle: 5, arch: "skull", name: "Archipelago · Skull Rock" }, { id: "5:frost", isle: 5, arch: "frost", name: "Archipelago · Frostcap" },
    { id: "5:storm", isle: 5, arch: "storm", name: "Archipelago · Storm Isle" }, { id: "6", isle: 6, name: "The Iceberg", r: 150 }
];
// the game's islands, then the ones you made (they come after the Iceberg, one rebirth each)
const ISLES = () => BASE_ISLES.concat(T.ciList.map(C => ({ id: String(C.n), isle: C.n, name: `${C.name} · Rebirth ${C.n - 1}`, r: C.R })));
const BASE_NAME = { 1: "Pine Island", 2: "Highland Isle", 3: "Mooncap Isle", 4: "Ashfall Isle", 5: "the Archipelago", 6: "the Iceberg" };
const isleName = i => BASE_NAME[i] || (T.customIsle(i) ? T.customIsle(i).name : "island " + i);
const ISLE_NUMS = () => [1, 2, 3, 4, 5, 6, ...T.ciList.map(C => C.n)];
const curIsle = () => T.getIsle();
const curEntry = () => ISLES().find(e => e.isle === curIsle() && (e.isle !== 5 || e.arch === T.getArch())) || ISLES()[0];

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
#stBar { top: 0; left: 0; right: 0; min-height: 46px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 6px 12px; background: #130b20f2; border-bottom: 1px solid #ffd04044; box-shadow: 0 6px 30px rgba(0,0,0,.45); }
#stBar .logo { font: 900 15px "Segoe UI Black", sans-serif; letter-spacing: 3px; color: #ffd040; text-shadow: 0 2px 0 #5a2a8a; white-space: nowrap; margin-right: 6px; }
#stBar .sep { width: 1px; height: 24px; background: #3a2c55; }
#stBar .right { margin-left: auto; display: flex; align-items: center; gap: 8px; } /* Save, Release and Play stay together, on the next line if the window is narrow */
@media (max-width: 1500px) { #stBar { gap: 6px 7px; } #stBar .stB small { display: none; } #stBar .logo { letter-spacing: 1.5px; font-size: 13px; } #stIsle { max-width: 190px; } #stFog { max-width: 130px; } #stWx { max-width: 90px; } }
@media (max-width: 1100px) { #stClock { width: 70px !important; } #stBar .logo { font-size: 12px; } }
.stB { cursor: pointer; background: #2a2040; color: #e8dcff; border: 1px solid #44365f; border-radius: 8px; padding: 6px 10px; font: 700 12px "Segoe UI"; white-space: nowrap; }
.stB:hover { border-color: #ffd040; color: #ffd040; } .stB.on { background: #ffd040; color: #1a0e00; border-color: #ffd040; }
.stB.go { background: #2a6a3a; border-color: #4aaa6a; color: #eaffef; } .stB.go:hover { color: #fff; border-color: #8affb0; }
.stB.warn:hover { border-color: #ff6a6a; color: #ff8a7a; } .stB:disabled { opacity: .45; cursor: default; }
.stSel, .stIn, .stTa { background: #0e0818; color: #fff; border: 1px solid #3a2c55; border-radius: 7px; padding: 5px 7px; font: 600 12px "Segoe UI"; outline: none; }
.stIn:focus, .stTa:focus, .stSel:focus { border-color: #ffd040; }
.stIn[type=number] { width: 74px; } .stIn[type=color] { width: 38px; height: 28px; padding: 1px 2px; }
.stTa { width: 100%; resize: vertical; min-height: 54px; font: 600 13px "Segoe UI"; }
#stSave.dirty::after { content: " ●"; color: #ffd040; }
#stLeft, #stRight { top: calc(var(--barH, 46px) + 8px); bottom: 44px; width: 330px; background: #150d24ee; border: 1px solid #3a2c55; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
#stLeft { left: 8px; } #stRight { right: 8px; width: 300px; }
#stRight.empty { display: none !important; }
.stTabs { display: flex; gap: 4px; padding: 10px 10px 0; }
.stTabs .stB { flex: 1; padding: 6px 2px; font-size: 11px; }
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
#stHelp { left: 346px; bottom: 8px; right: 316px; min-height: 30px; display: flex; flex-wrap: wrap; row-gap: 2px; padding: 3px 8px; align-items: center; justify-content: center; gap: 14px; background: #130b20d8; border: 1px solid #3a2c55; border-radius: 9px; font: 600 11px "Segoe UI"; color: #b8a8d8; overflow: hidden; white-space: nowrap; }
#stHelp b { color: #ffd040; font-weight: 800; }
#stStatus { top: 56px; left: 50%; transform: translateX(-50%); padding: 6px 14px; background: #130b20e8; border: 1px solid #ffd04066; border-radius: 9px; font: 700 12px "Segoe UI"; opacity: 0; transition: opacity .25s; pointer-events: none; }
#stStatus.show { opacity: 1; }
#stRel { top: calc(var(--barH, 46px) + 8px); bottom: 44px; left: 50%; transform: translateX(-50%); width: min(880px, 94vw); background: #150d24f6; border: 1px solid #ffd04066; border-radius: 14px; display: none; flex-direction: column; box-shadow: 0 20px 80px rgba(0,0,0,.7); z-index: 320; }
#stRel.show { display: flex; }
#stRel .stBody { padding: 16px 20px; }
.relHead { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px 0; }
.relHead h2 { margin: 0; font: 900 18px "Segoe UI Black", sans-serif; letter-spacing: 3px; color: #ffd040; }
.relCols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.relBox { background: #1e1530; border: 1px solid #3a2c55; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
.relBox .stH:first-child { margin-top: 0; }
.relPrev { background: #0e0818; border: 1px solid #ffd04055; border-radius: 10px; padding: 12px 14px; white-space: pre-wrap; font: 12px "Segoe UI"; line-height: 1.45; max-height: 230px; overflow-y: auto; }
.relPrev b { display: block; font: 900 14px "Segoe UI Black"; color: #ffd040; letter-spacing: 2px; margin-bottom: 2px; }
.relPrev i { display: block; font-style: normal; opacity: .7; margin-bottom: 8px; }
.relChk { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; font: 600 12px "Segoe UI"; }
.relChk .ic { width: 16px; flex: none; text-align: center; font-weight: 900; } .relChk .ok { color: #8affb0; } .relChk .no { color: #ff8a7a; } .relChk .warn { color: #ffd040; }
.relChk small { display: block; opacity: .65; font-weight: 500; }
.relGo { width: 100%; padding: 12px; font-size: 15px; letter-spacing: 1px; }
.relStep { display: flex; gap: 8px; padding: 3px 0; font: 600 12px "Segoe UI"; } .relStep .ic { width: 16px; text-align: center; }
.relList { font: 12px "Segoe UI"; line-height: 1.5; max-height: 120px; overflow-y: auto; opacity: .9; }
.relConfirm { position: absolute; inset: 0; background: #0a0612d8; display: none; align-items: center; justify-content: center; border-radius: 14px; }
.relConfirm.show { display: flex; }
.relConfirm > div { width: min(520px, 90%); background: #1e1530; border: 1px solid #ffd040; border-radius: 12px; padding: 18px 20px; }
.relConfirm ol { margin: 8px 0 14px 18px; padding: 0; line-height: 1.6; font: 13px "Segoe UI"; }
#stPlayTag { position: fixed; z-index: 300; top: 10px; left: 50%; transform: translateX(-50%); padding: 5px 12px; background: #2a6a3acc; border: 1px solid #8affb0; border-radius: 8px; color: #eaffef; font: 800 12px "Segoe UI"; letter-spacing: 1px; pointer-events: none; display: none; }
body.studio-play #stPlayTag { display: block; }
`;
const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

// ---------- the editor's screen ----------
const bar = document.createElement("div"); bar.id = "stBar"; bar.className = "st";
bar.innerHTML = `<div class="logo">TREE SIM 4 STUDIO <span id="stVer" style="font-size:11px;letter-spacing:1px;color:#ffe8a0"></span></div>
  <select class="stSel" id="stIsle" title="Island">${ISLES().map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select>
  <div class="sep"></div>
  <button class="stB on" data-gz="translate" title="Move (W)">Move <small>W</small></button>
  <button class="stB" data-gz="rotate" title="Rotate (E)">Rotate <small>E</small></button>
  <button class="stB" data-gz="scale" title="Size (R)">Size <small>R</small></button>
  <button class="stB" id="stSnap" title="Snap moves to 0.5 m, turns to 15°">Snap</button>
  <button class="stB" id="stBuilt" title="Move, turn, resize or hide anything the game built: beds, stalls, signs, rocks…">✥ Built-ins</button>
  <div class="sep"></div>
  <label title="Time of day">🕑 <input class="stIn" id="stClock" type="range" min="0" max="24" step="0.25" style="width:110px;vertical-align:middle"></label>
  <select class="stSel" id="stWx" title="Weather"><option value="clear">Clear</option><option value="cloudy">Cloudy</option><option value="rain">Rain</option><option value="storm">Storm</option><option value="fog">Fog</option></select>
  <select class="stSel" id="stFog" title="How much of the game's fog the editor shows (play-testing always uses the real fog)"><option value="light">Editor fog: light</option><option value="off">Editor fog: off</option><option value="game">Editor fog: as in game</option></select>
  <div class="right">
  <button class="stB" id="stUndo" title="Undo (Ctrl+Z)">↶</button><button class="stB" id="stRedo" title="Redo (Ctrl+Y)">↷</button>
  <label class="stHint" style="margin:0;opacity:.8"><input type="checkbox" id="stAuto"> autosave</label>
  <button class="stB" id="stSave" title="Save to content/, with a copy in Documents\Tree Sim 4 Studio that updates never touch (Ctrl+S)">Save</button>
  <button class="stB" id="stSyncBtn" title="Bring in what's on GitHub (releases and Studio updates) and keep your own work: islands, trees, props, animals, people and placed things from both sides are kept">⟳ Sync</button>
  <button class="stB" id="stRelBtn" title="Ship an update to players">🚀 Release</button>
  <button class="stB go" id="stPlay" title="Play-test from the camera (F5)">▶ Play <small>F5</small></button></div>`;
const left = document.createElement("div"); left.id = "stLeft"; left.className = "st";
left.innerHTML = `<div class="stTabs"><button class="stB on" data-tab="place">Place</button><button class="stB" data-tab="props">Props</button><button class="stB" data-tab="animals">Animals</button><button class="stB" data-tab="people">People</button><button class="stB" data-tab="trees">Trees</button><button class="stB" data-tab="islands">Islands</button></div><div class="stBody" id="stLeftBody"></div>`;
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
    const I = e.arch ? T.ARCH_BY[e.arch] : null, cx = I ? I.x : 0, cz = I ? I.z : 0, r = I ? I.r : e.r || 100;
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
T.setStudioHook({ frame: dt => { if (mode === "edit") fly(dt); if (!sculptOn()) brushRing.visible = false; }, afterSky });

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
const islandRecs = () => T.placed.filter(p => +p.o.isle === curIsle() && !String(p.o.id).startsWith("__")); // not the Makers' previews
function pickPlaced(mx, my) {
    setRay(mx, my);
    const recs = islandRecs(), hits = ray.intersectObjects(recs.map(p => p.g), true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.placed) o = o.parent; if (o) { pickPlaced.dist = h.distance; return o.userData.placed; } }
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
    if (pmGizmo) { if (!e.value) { pmFromGizmo(); pmApply(true, true); } return; } // a part of the prop you're making
    if (bsel) { if (!e.value) bFromGizmo(true); return; } // something the game built
    if (e.value) { pushUndo("drag"); lastS = +sel.s || 1; }
    else { fromGizmo(); changed(); renderInspector(); }
});
tc.addEventListener("objectChange", () => (pmGizmo ? pmFromGizmo() : bsel ? bFromGizmo(false) : fromGizmo()));
function fromGizmo() {
    const rec = selRec(); if (!rec) return;
    const g = rec.g, sx = +sel.sx || 1, sy = +sel.sy || 1, sz = +sel.sz || 1;
    if (gzMode === "scale") { // one size for everything (the stretch stays): take whichever axis you dragged
        const c = [g.scale.x / sx, g.scale.y / sy, g.scale.z / sz], k = c.reduce((a, v) => (Math.abs(v - lastS) > Math.abs(a - lastS) ? v : a), lastS);
        sel.s = r3(Math.min(20, Math.max(0.1, k)));
    }
    sel.x = r3(g.position.x); sel.y = r3(g.position.y); sel.z = r3(g.position.z);
    sel.rx = r3(g.rotation.x); sel.ry = r3(g.rotation.y); sel.rz = r3(g.rotation.z);
    T.placedPose(rec);
}
function select(o) {
    if (pmGizmo) { pmGizmo = false; partSel = -1; if (makerTab()) renderMaker(); }
    bsel = null;
    const prev = selRec(); if (prev) prev.paused = false;
    sel = o;
    const rec = selRec();
    if (rec) { rec.paused = true; T.placedPose(rec); tc.attach(rec.g); } else tc.detach(); // it holds still while you edit it
    renderInspector(); renderObjects();
}
function deselect() { if (pmGizmo) { pmGizmo = false; partSel = -1; if (makerTab()) renderMaker(); } bsel = null; const prev = selRec(); if (prev) prev.paused = false; sel = null; tc.detach(); renderInspector(); renderObjects(); }

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
let islands = (Array.isArray(T.CONTENT_ISLANDS) ? T.CONTENT_ISLANDS : []).map(d => JSON.parse(JSON.stringify(d)));
let islandsDirty = false, propsDirty = false, animalsDirty = false, peopleDirty = false;
function changed(what = "world") {
    if (what === "world") worldDirty = true; else if (what === "trees") treesDirty = true; else if (what === "props") propsDirty = true; else if (what === "animals") animalsDirty = true; else if (what === "people") peopleDirty = true; else islandsDirty = true;
    $("stSave").classList.toggle("dirty", worldDirty || treesDirty || islandsDirty || propsDirty || animalsDirty || peopleDirty);
    clearTimeout(saveT);
    if ($("stAuto").checked) saveT = setTimeout(() => saveAll(true), 1500);
}
let synced = false; // after a sync brought things in, what's in memory is from before it: never save that over the merged files
async function saveAll(quiet) {
    clearTimeout(saveT);
    if (synced) { say("Restart the Studio first: a sync just brought in new work", 4000); return; }
    const jobs = [];
    if (worldDirty) jobs.push(S.save("world", { version: 1, objects: world.objects, moves: T.MOVES }).then(r => { if (r.ok) worldDirty = false; return r; }));
    if (treesDirty) jobs.push(S.save("trees", trees).then(r => { if (r.ok) treesDirty = false; return r; }));
    if (islandsDirty) jobs.push(S.save("islands", islands).then(r => { if (r.ok) islandsDirty = false; return r; }));
    if (propsDirty) jobs.push(S.save("props", myProps).then(r => { if (r.ok) propsDirty = false; return r; }));
    if (animalsDirty) jobs.push(S.save("animals", myAnimals).then(r => { if (r.ok) animalsDirty = false; return r; }));
    if (peopleDirty) jobs.push(S.save("people", myPeople).then(r => { if (r.ok) peopleDirty = false; return r; }));
    if (!jobs.length) { if (!quiet) say("Everything is saved"); return; }
    const res = await Promise.all(jobs), bad = res.find(r => !r.ok);
    $("stSave").classList.toggle("dirty", worldDirty || treesDirty || islandsDirty || propsDirty || animalsDirty || peopleDirty);
    if (bad) say("Couldn't save: " + bad.error, 5000); else say(quiet ? "Autosaved" : res.every(r => r.kept !== false) ? "Saved to content/ and your Documents" : "Saved to content/ (couldn't copy it to Documents)", quiet ? 900 : 2600);
}

// ---------- placing ----------
const SIGN_TEMPLATE = { kind: "sign", text: "WELCOME", style: "wood", color: "", post: true, solid: true };
// the interactive things: people, notes, chests, shrines, portals, and spots where a tree always grows
const TEMPLATES = {
    sign: SIGN_TEMPLATE,
    glowsign: { ...SIGN_TEMPLATE, style: "glow", text: "THIS WAY" },
    note: { kind: "sign", text: "READ ME", style: "wood", post: true, solid: true, act: { type: "read", title: "A note", text: "Write what it says here.\n\nA blank line starts a new page." } },
    npc: { kind: "npc", look: "villager", solid: true, label: "VILLAGER", labelCol: "#ffd890", act: { type: "talk", who: "Villager", lines: ["Hello there, woodcutter!", "The trees have been restless lately. Watch your back."] } },
    loot: { kind: "prop", prop: "chest", solid: true, act: { type: "loot", cash: 5000, mat: "", amount: 0, every: "day", message: "You found treasure!" } },
    shrine: { kind: "prop", prop: "shrine", solid: true, act: { type: "shrine", buff: "fury", secs: 180, heal: true, message: "The shrine hums with power." } },
    portal: { kind: "prop", prop: "portal", solid: false, act: { type: "portal", to: "" } },
    treespot: { kind: "treespot", tree: "pine", height: 7, regrow: 3, solid: false },
    shop: { kind: "npc", look: "villager", solid: true, label: "THE SHOP", labelCol: "#ffd890", act: { type: "shop", title: "The Shop", who: "Shopkeeper", greeting: "Have a look. Everything's fairly priced. Mostly.", color: "", items: [
        { name: "Fury tonic", desc: "Hit harder for a while.", icon: "⚔️", cash: 50000, mats: {}, give: { buff: "fury", secs: 300 } },
        { name: "Hot stew", desc: "Back to full health.", icon: "🍲", cash: 10000, mats: {}, give: { heal: true } }] } }
};
const THINGS = [["npc", "🧍 Person"], ["shop", "🛒 Shop"], ["note", "📜 Note"], ["loot", "💰 Treasure chest"], ["shrine", "✨ Shrine"], ["portal", "🌀 Portal"], ["treespot", "🌲 Tree spot"], ["sign", "🪧 Wooden sign"], ["glowsign", "✦ Glowing sign"]];
const scatter = { on: pref("scatter") === "1", n: +pref("scN") || 8, r: +pref("scR") || 8, min: +pref("scMin") || 0.7, max: +pref("scMax") || 1.3 };
let placing = null; // { o, rec, tpl }
function startPlacing(tpl) {
    cancelPlacing(); deselect();
    const o = { id: newId(), isle: curIsle(), ...JSON.parse(JSON.stringify(tpl)), x: 0, y: -9999, z: 0, rx: 0, ry: r3(cam.yaw), rz: 0, s: 1 };
    if (o.kind === "prop" && o.solid === undefined) { const P = T.PROPS[o.prop] || {}; o.solid = P.r > 0 || !!P.box; }
    if (o.kind === "treespot" && !T.TYPES[o.tree]) o.tree = "pine";
    placing = { o, rec: T.placedBuild(o), tpl };
    movePlacing(mouse.x, mouse.y);
    say(scatter.on && o.kind === "prop" ? `Click to scatter ${scatter.n} of them · Esc to cancel` : "Click the ground to place it · Esc to cancel · hold Shift to place more");
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
    if (scatter.on && o.kind === "prop") { // a handful at once, spread round where you clicked, each turned and sized a little differently
        T.placedRemove(o); placing = null;
        for (let i = 0; i < scatter.n; i++) {
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * scatter.r, x = o.x + Math.cos(a) * d, z = o.z + Math.sin(a) * d;
            const c = { ...JSON.parse(JSON.stringify(o)), id: newId(), x: r3(x), z: r3(z), y: r3(T.groundY(x, z)), ry: r3(Math.random() * Math.PI * 2), s: r3(scatter.min + Math.random() * Math.max(0, scatter.max - scatter.min)) };
            world.objects.push(c); T.placedBuild(c);
        }
        changed(); renderObjects(); say(`Scattered ${scatter.n}`);
        if (again) startPlacing(tpl);
        return;
    }
    world.objects.push(o);
    placing = null;
    changed();
    if (again) startPlacing(tpl); else select(o);
    renderObjects();
}
function cancelPlacing() { if (placing) { T.placedRemove(placing.o); placing = null; } }
let clip = null; // Ctrl+C / Ctrl+V
function pasteClip() {
    if (!clip) { say("Nothing copied yet"); return; }
    const h = groundHit(mouse.x, mouse.y) || (() => { const f = fwd().setY(0).normalize(), x = cam.pos.x + f.x * 8, z = cam.pos.z + f.z * 8; return { x, z, y: T.groundY(x, z) }; })();
    pushUndo("");
    const o = { ...JSON.parse(clip), id: newId(), isle: curIsle(), x: r3(h.x), y: r3(h.y), z: r3(h.z) };
    if (o.act && o.act.type === "portal") o.act.to = "";
    world.objects.push(o); T.placedBuild(o); select(o); changed(); say("Pasted");
}

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
    if (rec) { rec.paused = true; T.placedPose(rec); tc.attach(rec.g); }
    changed();
    if (rebuild) renderObjects(); // the list shows a sign's first line
}

// ---------- the inspector (right) ----------
function num(id, label, v, step = 0.1) { return `<div class="stRow"><label>${label}</label><input class="stIn" type="number" id="${id}" value="${v}" step="${step}"></div>`; }
const opt = (v, cur, label) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(label)}</option>`;
const hexOf = n => "#" + ((n >>> 0) & 0xffffff).toString(16).padStart(6, "0");
const objName = o => (o.kind === "sign" ? (o.act && o.act.type === "read" ? "📜 " : "🪧 ") + ((o.text || "").split("\n")[0].slice(0, 22) || "Sign") : o.kind === "npc" ? "🧍 " + ((o.act && o.act.who) || o.label || "Person") : o.kind === "treespot" ? "🌲 " + ((T.TYPES[o.tree] || {}).name || "Tree spot") : (T.PROPS[o.prop] || T.PROPS.rock).name);
function renderInspector() {
    const box = $("stInsp");
    if (bsel) { renderBuiltinInspector(); return; }
    if (!sel) { right.classList.add("empty"); box.innerHTML = ""; return; }
    right.classList.remove("empty");
    const o = sel, P = o.kind === "prop" ? T.PROPS[o.prop] || T.PROPS.rock : null, a = o.act || {};
    const title = o.kind === "sign" ? "SIGN" : o.kind === "npc" ? "PERSON" : o.kind === "treespot" ? "TREE SPOT" : esc(P.name).toUpperCase();
    let h = `<div class="stH">${title} <small>${esc(isleName(+o.isle))}</small></div>`;
    if (o.kind === "sign") {
        h += `<textarea class="stTa" id="iText" rows="3" placeholder="Up to 4 lines">${esc(o.text || "")}</textarea>
          <div class="stRow" style="margin-top:6px"><label>Style</label><select class="stSel" id="iStyle">${opt("wood", o.style !== "glow" ? "wood" : "", "Wooden board")}${opt("glow", o.style, "Glowing (game style)")}</select></div>
          <div class="stRow"><label>Text colour</label><span><input class="stIn" type="color" id="iColor" value="${o.color || (o.style === "glow" ? "#ffd040" : "#ffe8c0")}"> <button class="stB" id="iColorReset">reset</button></span></div>
          <div class="stChecks"><label><input type="checkbox" id="iPost"${o.post !== false ? " checked" : ""}> On a post</label></div>`;
    } else if (o.kind === "npc") {
        h += `<div class="stRow"><label>Look</label><select class="stSel" id="iLook">${Object.entries(T.NPC_LOOKS).map(([k, L]) => opt(k, o.look || "villager", L.name || k[0].toUpperCase() + k.slice(1))).join("")}</select></div>
          <div class="stRow"><label>Shirt colour</label><span><input class="stIn" type="color" id="iTint" value="${o.col || hexOf((T.NPC_LOOKS[o.look] || T.NPC_LOOKS.villager).shirt)}"> <button class="stB" id="iTintReset">reset</button></span></div>`;
    } else if (o.kind === "treespot") {
        h += `<div class="stRow"><label>Tree</label><select class="stSel" id="iTree" style="max-width:170px">${Object.entries(T.TYPES).filter(([k, t]) => !t.rush).map(([k, t]) => opt(k, o.tree, t.name)).join("")}</select></div>
          ${num("iTreeH", "Height", o.height || 7, 0.5)}${num("iRegrow", "Grows back (min)", o.regrow || 3, 0.5)}
          <div class="stHint">This tree is always here. Chop it and it grows back after that many minutes.</div>`;
    } else {
        h += `<div class="stRow"><label>Prop</label><select class="stSel" id="iProp" style="max-width:170px">${T.PROP_CATS.map(([c, cn]) => `<optgroup label="${esc(cn)}">${Object.entries(T.PROPS).filter(([k, p]) => p.cat === c).map(([k, p]) => opt(k, o.prop, p.name)).join("")}</optgroup>`).join("")}</select></div>`;
        if (P.tint !== undefined) h += `<div class="stRow"><label>Colour</label><span><input class="stIn" type="color" id="iTint" value="${o.col || hexOf(P.tint)}"> <button class="stB" id="iTintReset">reset</button></span></div>`;
    }
    if (o.kind !== "treespot") {
        const dl = P && P.light, L = o.light || {}, lit = o.light ? o.light.on !== false : !!dl;
        h += `<div class="stH">LOOK</div>
          <div class="stRow"><label>Effect</label><select class="stSel" id="iFx">${opt("", o.fx || "", "Normal")}${opt("glow", o.fx, "Glowing")}${opt("ghost", o.fx, "Ghostly (see-through)")}${opt("dark", o.fx, "Shadow (dark)")}</select></div>
          <div class="stRow"><label>Animation</label><select class="stSel" id="iAnim">${opt("", o.anim || "", "None")}${opt("spin", o.anim, "Spin")}${opt("bob", o.anim, "Bob")}${opt("float", o.anim, "Float")}${opt("sway", o.anim, "Sway")}${opt("pulse", o.anim, "Pulse")}${lit ? opt("flicker", o.anim, "Flicker the light") : ""}</select></div>
          ${o.anim ? num("iAnimSp", "Speed", o.animSpeed || 1, 0.1) : ""}
          <div class="stRow"><label>Shows</label><select class="stSel" id="iShow">${opt("", o.show || "", "Always")}${opt("night", o.show, "Only at night")}${opt("day", o.show, "Only by day")}</select></div>
          <div class="stRow"><label>Floating name</label><input class="stIn" type="text" id="iLabel" value="${esc(o.label || "")}" placeholder="none"></div>
          ${o.label ? `<div class="stRow"><label>Name colour</label><input class="stIn" type="color" id="iLabelCol" value="${o.labelCol || "#ffd040"}"></div>
          <div class="stRow"><label>Name size</label><span style="display:flex;align-items:center;gap:6px"><input type="range" id="iLabelSize" min="0.4" max="3" step="0.1" value="${o.labelSize || 1}" style="width:110px"><small>${o.labelSize || 1}×</small></span></div>
          <div class="stRow"><label>Name height</label><input class="stIn" type="number" id="iLabelY" step="0.1" value="${o.labelY ?? ""}" placeholder="auto" style="width:70px"></div>` : ""}
          <div class="stH">LIGHT</div>
          <div class="stChecks"><label><input type="checkbox" id="iLight"${lit ? " checked" : ""}> Gives off real light</label></div>
          ${lit ? `<div class="stRow"><label>Light colour</label><input class="stIn" type="color" id="iLightCol" value="${L.color || (dl ? hexOf(dl[0]) : "#ffc070")}"></div>${num("iLightP", "Brightness", L.power || (dl ? dl[1] : 10), 1)}${num("iLightR", "Reach (m)", L.range || (dl ? dl[2] : 14), 1)}${num("iLightY", "Height", L.y || (dl ? dl[3] : 1.5), 0.1)}` : ""}`;
    }
    const solidOk = o.kind === "sign" || o.kind === "npc" || (P && (P.r > 0 || P.box));
    h += `<div class="stH">PLACE</div>${num("iX", "X", o.x)}${num("iY", "Height", o.y)}${num("iZ", "Z", o.z)}
      ${num("iRy", "Turn °", Math.round((o.ry || 0) / DEG), 5)}${num("iRx", "Tilt fwd °", Math.round((o.rx || 0) / DEG), 5)}${num("iRz", "Tilt side °", Math.round((o.rz || 0) / DEG), 5)}${num("iS", "Size", o.s || 1, 0.05)}
      ${o.kind !== "treespot" ? `${num("iSx", "Stretch wide", o.sx || 1, 0.05)}${num("iSy", "Stretch tall", o.sy || 1, 0.05)}${num("iSz", "Stretch deep", o.sz || 1, 0.05)}` : ""}
      <div class="stChecks"><label title="${solidOk ? "You bump into it instead of walking through" : "This one is too thin to bump into"}"><input type="checkbox" id="iSolid"${o.solid && solidOk ? " checked" : ""}${solidOk ? "" : " disabled"}> Solid</label></div>
      <div class="stBtns"><button class="stB" id="iGround">Snap to ground</button><button class="stB" id="iFace">Face camera</button><button class="stB" id="iSpin">Random turn</button><button class="stB" id="iFocus">Focus (F)</button><button class="stB" id="iDup">Duplicate</button><button class="stB warn" id="iDel">Delete</button></div>`;
    if (o.kind !== "treespot") {
        h += `<div class="stH">WHEN YOU PRESS F</div><div class="stRow"><label>Does</label><select class="stSel" id="iAct">${opt("", a.type || "", "Nothing")}${opt("talk", a.type, "Talks")}${opt("read", a.type, "Can be read")}${opt("loot", a.type, "Gives loot")}${opt("shrine", a.type, "Blesses you (shrine)")}${opt("portal", a.type, "Teleports you (portal)")}${opt("shop", a.type, "Runs a shop")}</select></div>`;
        if (a.type === "talk") h += `<div class="stRow"><label>Name</label><input class="stIn" type="text" id="aWho" value="${esc(a.who || "")}"></div><div class="stHint">What they say, one line each:</div><textarea class="stTa" id="aLines" rows="4">${esc((a.lines || []).join("\n"))}</textarea>`;
        if (a.type === "read") h += `<div class="stRow"><label>Title</label><input class="stIn" type="text" id="aTitle" value="${esc(a.title || "")}"></div><div class="stHint">The text (a blank line starts a new page):</div><textarea class="stTa" id="aText" rows="5">${esc(a.text || "")}</textarea>`;
        if (a.type === "loot") h += `${num("aCash", "Cash", a.cash || 0, 100)}<div class="stRow"><label>Material</label><select class="stSel" id="aMat" style="max-width:150px">${opt("", a.mat || "", "none")}${Object.entries(T.MATS).map(([k, m]) => opt(k, a.mat, m.name)).join("")}</select></div>${a.mat ? num("aAmt", "Amount", a.amount || 1, 1) : ""}
            <div class="stRow"><label>Refills</label><select class="stSel" id="aEvery">${opt("day", a.every || "day", "Every day")}${opt("once", a.every, "Never (once only)")}</select></div><div class="stRow"><label>Message</label><input class="stIn" type="text" id="aMsg" value="${esc(a.message || "")}"></div><div class="stHint">Cash grows with the player's rebirths.</div>`;
        if (a.type === "shrine") h += `<div class="stRow"><label>Buff</label><select class="stSel" id="aBuff">${opt("", a.buff || "", "none")}${Object.entries(T.BUFFS).map(([k, b]) => opt(k, a.buff, b.name)).join("")}</select></div>${num("aSecs", "Seconds", a.secs || 120, 10)}<div class="stChecks"><label><input type="checkbox" id="aHeal"${a.heal !== false ? " checked" : ""}> Heals to full</label></div><div class="stRow"><label>Message</label><input class="stIn" type="text" id="aMsg" value="${esc(a.message || "")}"></div><div class="stHint">Once a day.</div>`;
        if (a.type === "portal") { const others = world.objects.filter(q => q !== o && +q.isle === +o.isle); h += `<div class="stRow"><label>Leads to</label><select class="stSel" id="aTo" style="max-width:170px">${opt("", a.to || "", "choose…")}${others.map(q => opt(q.id, a.to, `${objName(q)} (${Math.round(q.x)}, ${Math.round(q.z)})`)).join("")}</select></div><div class="stHint">Place two portals and point each at the other for a two-way trip.</div>`; }
        if (a.type === "shop") h += shopEditor(a);
    }
    box.innerHTML = h;
    bindInspector(o);
}
function bindInspector(o) {
    const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
    const re = () => renderInspector();
    let textT = 0;
    on("iText", "input", e => { const v = e.target.value.split("\n").slice(0, 4).join("\n"); clearTimeout(textT); textT = setTimeout(() => edit(q => (q.text = v), "text", true), 180); });
    on("iStyle", "change", e => edit(q => (q.style = e.target.value), "", true));
    on("iColor", "input", e => edit(q => (q.color = e.target.value), "color", true));
    on("iColorReset", "click", () => { edit(q => (q.color = ""), "", true); re(); });
    on("iPost", "change", e => edit(q => (q.post = e.target.checked), "", true));
    on("iLook", "change", e => { edit(q => { q.look = e.target.value; delete q.col; }, "", true); re(); });
    on("iTree", "change", e => edit(q => (q.tree = e.target.value), "", true));
    on("iProp", "change", e => { edit(q => { q.prop = e.target.value; delete q.col; const P = T.PROPS[q.prop]; if (!(P.r > 0 || P.box)) q.solid = false; }, "", true); re(); renderObjects(); });
    on("iTint", "input", e => edit(q => (q.col = e.target.value), "tint", true));
    on("iTintReset", "click", () => { edit(q => delete q.col, "", true); re(); });
    on("iFx", "change", e => edit(q => (e.target.value ? (q.fx = e.target.value) : delete q.fx), "", true));
    on("iAnim", "change", e => { edit(q => (e.target.value ? (q.anim = e.target.value) : delete q.anim), ""); re(); say(e.target.value ? "It animates when it isn't selected" : ""); });
    on("iShow", "change", e => edit(q => (e.target.value ? (q.show = e.target.value) : delete q.show), ""));
    on("iLabel", "change", e => { edit(q => (e.target.value.trim() ? (q.label = e.target.value.trim().slice(0, 40)) : delete q.label), "", true); re(); });
    on("iLabelCol", "input", e => edit(q => (q.labelCol = e.target.value), "labelcol", true));
    on("iLabelSize", "input", e => { e.target.nextElementSibling.textContent = e.target.value + "×"; edit(q => { const v = Math.min(3, Math.max(0.4, +e.target.value || 1)); if (v === 1) delete q.labelSize; else q.labelSize = v; }, "labelsize", true); });
    on("iLabelY", "input", e => edit(q => { const v = e.target.value.trim(); if (v === "" || !Number.isFinite(+v)) delete q.labelY; else q.labelY = r3(Math.min(60, Math.max(-5, +v))); }, "labely"));
    const P = o.kind === "prop" ? T.PROPS[o.prop] : null, dl = P && P.light;
    const lightOf = q => q.light && q.light.on !== false ? q.light : (q.light = { on: true, color: dl ? hexOf(dl[0]) : "#ffc070", power: dl ? dl[1] : 10, range: dl ? dl[2] : 14, y: dl ? dl[3] : 1.5 });
    on("iLight", "change", e => { edit(q => { if (e.target.checked) lightOf(q); else q.light = { on: false }; }, "", true); re(); });
    on("iLightCol", "input", e => edit(q => (lightOf(q).color = e.target.value), "lightcol", true));
    const lnum = (id, k, a, b) => on(id, "input", e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) edit(q => (lightOf(q)[k] = Math.min(b, Math.max(a, v))), id, true); });
    lnum("iLightP", "power", 0, 60); lnum("iLightR", "range", 2, 60); lnum("iLightY", "y", -2, 20);
    const numEdit = (id, fn, rebuild) => on(id, "input", e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) edit(q => fn(q, v), id, rebuild); });
    numEdit("iX", (q, v) => (q.x = r3(v))); numEdit("iY", (q, v) => (q.y = r3(v))); numEdit("iZ", (q, v) => (q.z = r3(v)));
    numEdit("iRy", (q, v) => (q.ry = r3(v * DEG))); numEdit("iRx", (q, v) => (q.rx = r3(v * DEG))); numEdit("iRz", (q, v) => (q.rz = r3(v * DEG)));
    numEdit("iS", (q, v) => (q.s = r3(Math.min(20, Math.max(0.1, v)))));
    for (const k of ["sx", "sy", "sz"]) numEdit("iS" + k[1], (q, v) => (q[k] = r3(Math.min(20, Math.max(0.05, v)))));
    numEdit("iAnimSp", (q, v) => (q.animSpeed = r3(Math.min(10, Math.max(0.05, v)))));
    numEdit("iTreeH", (q, v) => (q.height = Math.min(14, Math.max(3, v))), true); numEdit("iRegrow", (q, v) => (q.regrow = Math.min(120, Math.max(0.1, v))));
    on("iSolid", "change", e => edit(q => (q.solid = e.target.checked), ""));
    on("iGround", "click", () => { edit(q => (q.y = r3(T.groundY(q.x, q.z))), ""); re(); });
    on("iFace", "click", () => { edit(q => (q.ry = r3(Math.atan2(cam.pos.x - q.x, cam.pos.z - q.z))), ""); re(); });
    on("iSpin", "click", () => { edit(q => (q.ry = r3(Math.random() * Math.PI * 2)), ""); re(); });
    on("iFocus", "click", focusSel); on("iDup", "click", duplicateSel); on("iDel", "click", removeSel);
    // what F does
    const DEF = { talk: { who: "Stranger", lines: ["..."] }, read: { title: "A note", text: "" }, loot: { cash: 5000, mat: "", amount: 0, every: "day", message: "You found treasure!" }, shrine: { buff: "fury", secs: 180, heal: true, message: "The shrine hums with power." }, portal: { to: "" }, shop: JSON.parse(JSON.stringify(TEMPLATES.shop.act)) };
    on("iAct", "change", e => { edit(q => { const t = e.target.value; if (!t) delete q.act; else q.act = { type: t, ...JSON.parse(JSON.stringify(DEF[t])) }; }, ""); re(); });
    const act = (id, ev, fn, tag) => on(id, ev, e => edit(q => { q.act = q.act || {}; fn(q.act, e.target); }, tag || id));
    act("aWho", "input", (a, t) => (a.who = t.value.slice(0, 30)));
    act("aLines", "input", (a, t) => (a.lines = t.value.split("\n").map(s => s.slice(0, 200)).slice(0, 20)));
    act("aTitle", "input", (a, t) => (a.title = t.value.slice(0, 40)));
    act("aText", "input", (a, t) => (a.text = t.value.slice(0, 2000)));
    act("aCash", "input", (a, t) => (a.cash = Math.max(0, +t.value || 0)));
    on("aMat", "change", e => { edit(q => { q.act.mat = e.target.value; if (!q.act.amount) q.act.amount = 5; }, ""); re(); });
    act("aAmt", "input", (a, t) => (a.amount = Math.max(0, Math.round(+t.value || 0))));
    act("aEvery", "change", (a, t) => (a.every = t.value));
    act("aMsg", "input", (a, t) => (a.message = t.value.slice(0, 120)));
    act("aBuff", "change", (a, t) => (a.buff = t.value));
    act("aSecs", "input", (a, t) => (a.secs = Math.min(900, Math.max(10, +t.value || 120))));
    act("aHeal", "change", (a, t) => (a.heal = t.checked));
    act("aTo", "change", (a, t) => (a.to = t.value));
    act("aGreet", "input", (a, t) => (a.greeting = t.value.slice(0, 160)));
    act("aCol", "input", (a, t) => (a.color = t.value));
    // a shop's items: each row edits its own item
    right.querySelectorAll("[data-si]").forEach(row => {
        const i = +row.dataset.si, val = k => { const f = row.querySelector(`[data-sf="${k}"]`); return f ? f.value : ""; };
        row.querySelectorAll("[data-sf]").forEach(f => f.addEventListener(f.tagName === "SELECT" ? "change" : "input", () => {
            edit(q => { const it = q.act.items[i]; if (it) shopField(it, f.dataset.sf, f.value, val); }, "shop" + i + f.dataset.sf);
            if (f.dataset.sf === "gk") re();
        }));
    });
    right.querySelectorAll("[data-sdel]").forEach(b => b.addEventListener("click", () => { edit(q => q.act.items.splice(+b.dataset.sdel, 1), ""); re(); }));
    on("aItemAdd", "click", () => { edit(q => { q.act.items = q.act.items || []; if (q.act.items.length < 12) q.act.items.push({ name: "Something new", desc: "", icon: "✦", cash: 10000, mats: {}, give: { heal: true } }); }, ""); re(); });
}
// ---- the shop editor (Place inspector, "Runs a shop") ----
function shopEditor(a) {
    const its = Array.isArray(a.items) ? a.items : [], mats = sel => Object.entries(T.MATS).map(([k, m]) => opt(k, sel, m.name)).join("");
    let h = `<div class="stRow"><label>Shop name</label><input class="stIn" type="text" id="aTitle" value="${esc(a.title || "")}"></div>
      <div class="stRow"><label>Keeper</label><input class="stIn" type="text" id="aWho" value="${esc(a.who || "")}"></div>
      <div class="stRow"><label>Greeting</label><input class="stIn" type="text" id="aGreet" value="${esc(a.greeting || "")}"></div>
      <div class="stRow"><label>Colour</label><input class="stIn" type="color" id="aCol" value="${a.color || "#ffd040"}"></div>
      <div class="stH">FOR SALE <small>${its.length} of 12</small></div>`;
    its.forEach((it, i) => {
        const g = it.give || {}, gk = g.buff ? "buff" : g.mat ? "mat" : g.cash ? "cash" : "heal", mk = Object.keys(it.mats || {})[0] || "";
        h += `<div class="stItem" style="display:block" data-si="${i}">
          <div class="stRow"><label>Name</label><span style="display:flex;gap:4px"><input class="stIn" type="text" data-sf="icon" value="${esc(it.icon || "")}" style="width:42px" title="an emoji"><input class="stIn" type="text" data-sf="name" value="${esc(it.name || "")}" style="width:118px"></span></div>
          <div class="stRow"><label>Says</label><input class="stIn" type="text" data-sf="desc" value="${esc(it.desc || "")}"></div>
          <div class="stRow"><label>Costs $</label><input class="stIn" type="number" data-sf="cash" value="${+it.cash || 0}" min="0" step="1000"></div>
          <div class="stRow"><label>and</label><span style="display:flex;gap:4px"><input class="stIn" type="number" data-sf="matN" value="${mk ? it.mats[mk] : 0}" min="0" style="width:56px"><select class="stSel" data-sf="matK" style="max-width:118px">${opt("", mk, "no material")}${mats(mk)}</select></span></div>
          <div class="stRow"><label>Gives</label><select class="stSel" data-sf="gk">${opt("buff", gk, "a buff")}${opt("mat", gk, "materials")}${opt("cash", gk, "cash")}${opt("heal", gk, "a full heal")}</select></div>
          ${gk === "buff" ? `<div class="stRow"><label>Buff</label><span style="display:flex;gap:4px"><select class="stSel" data-sf="buff" style="max-width:118px">${Object.entries(T.BUFFS).map(([k, b]) => opt(k, g.buff, b.name)).join("")}</select><input class="stIn" type="number" data-sf="secs" value="${g.secs || 180}" min="10" max="900" style="width:56px" title="seconds"></span></div>`
            : gk === "mat" ? `<div class="stRow"><label>How many</label><span style="display:flex;gap:4px"><input class="stIn" type="number" data-sf="gn" value="${g.n || 5}" min="1" style="width:56px"><select class="stSel" data-sf="gmat" style="max-width:118px">${mats(g.mat)}</select></span></div>`
            : gk === "cash" ? `<div class="stRow"><label>Pays $</label><input class="stIn" type="number" data-sf="gcash" value="${g.cash || 0}" min="0" step="1000"></div>` : ""}
          <div class="stBtns"><button class="stB warn" data-sdel="${i}">Remove</button></div></div>`;
    });
    return h + `<div class="stBtns">${its.length < 12 ? `<button class="stB go" id="aItemAdd">+ Something to sell</button>` : ""}</div><div class="stHint">Press F next to them in the game to shop. The shop uses the island's own menu look.</div>`;
}
function shopField(it, k, v, val) {
    const n = (x, a, b) => Math.min(b, Math.max(a, Math.round(+x || 0)));
    if (k === "name") it.name = v.slice(0, 40); else if (k === "icon") it.icon = Array.from(v).slice(0, 2).join(""); else if (k === "desc") it.desc = v.slice(0, 140);
    else if (k === "cash") it.cash = n(v, 0, 1e10);
    else if (k === "matN" || k === "matK") { const mk = val("matK"), mn = n(val("matN"), 0, 999); it.mats = mk && mn > 0 ? { [mk]: mn } : {}; }
    else if (k === "gk") it.give = v === "buff" ? { buff: "fury", secs: 180 } : v === "mat" ? { mat: Object.keys(T.MATS)[0], n: 5 } : v === "cash" ? { cash: 10000 } : { heal: true };
    else if (k === "buff" || k === "secs") it.give = { buff: val("buff"), secs: n(val("secs"), 10, 900) };
    else if (k === "gn" || k === "gmat") it.give = { mat: val("gmat"), n: n(val("gn"), 1, 999) };
    else if (k === "gcash") it.give = { cash: n(v, 0, 1e10) };
}

// ---------- the left panel: Place, Trees, Islands ----------
let tab = ["trees", "islands", "props", "animals", "people"].includes(pref("tab")) ? pref("tab") : "place";
let propCat = pref("propCat") || "all", propFind = "";
function renderLeft() {
    left.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
    if (tab === "trees") renderTrees(); else if (tab === "islands") renderIslands(); else if (tab === "props" || tab === "animals") renderMaker(); else if (tab === "people") renderPeople(); else renderPlace();
}
function propGrid() {
    const q = propFind.trim().toLowerCase(), list = Object.entries(T.PROPS).filter(([k, p]) => (propCat === "all" || p.cat === propCat) && (!q || p.name.toLowerCase().includes(q) || k.includes(q)));
    return list.length ? list.map(([k, p]) => `<button class="stB" data-place="p:${k}" title="${esc(p.name)}">${esc(p.name)}${p.light ? " 💡" : ""}</button>`).join("") : `<div class="stHint" style="grid-column:1/-1">No props match.</div>`;
}
function renderPlace() {
    $("stLeftBody").innerHTML = `<div class="stH">PEOPLE &amp; THINGS TO DO</div>
      <div class="stGrid" style="grid-template-columns:1fr 1fr">${THINGS.map(([k, n]) => `<button class="stB" data-place="t:${k}">${n}</button>`).join("")}</div>
      <div class="stH">PROPS <small>${Object.keys(T.PROPS).length} · click, then click the ground</small></div>
      <input class="stIn" type="text" id="pFind" placeholder="Search props…" value="${esc(propFind)}" style="width:100%;margin-bottom:6px">
      <div class="stBtns" style="margin:0 0 8px">${[["all", "All"], ...T.PROP_CATS].map(([c, n]) => `<button class="stB${propCat === c ? " on" : ""}" data-cat="${c}" style="padding:4px 8px;font-size:11px">${esc(n)}</button>`).join("")}</div>
      <div class="stGrid" id="pGrid">${propGrid()}</div>
      <div class="stH">SCATTER <small>place lots at once</small></div>
      <div class="stChecks"><label><input type="checkbox" id="scOn"${scatter.on ? " checked" : ""}> Scatter props when I click</label></div>
      ${scatter.on ? `${num("scN", "How many", scatter.n, 1)}${num("scR", "Spread (m)", scatter.r, 1)}${num("scMin", "Smallest size", scatter.min, 0.05)}${num("scMax", "Biggest size", scatter.max, 0.05)}` : ""}
      <div class="stH">ON THIS ISLAND <small id="stCount"></small></div><div class="stList" id="stObjects"></div>
      <div class="stHint">Everything you place is saved to <b>content/world.js</b> and ships with the game on your next release. Ctrl+C / Ctrl+V copies things, even to another island.</div>`;
    const f = $("pFind"); f.addEventListener("input", () => { propFind = f.value; $("pGrid").innerHTML = propGrid(); });
    const sc = (id, k) => { const e = $(id); if (e) e.addEventListener("input", () => { const v = parseFloat(e.value); if (Number.isFinite(v)) { scatter[k] = k === "n" ? Math.min(60, Math.max(1, Math.round(v))) : Math.min(60, Math.max(0.05, v)); pref(id, scatter[k]); } }); };
    $("scOn").addEventListener("change", e => { scatter.on = e.target.checked; pref("scatter", scatter.on ? "1" : "0"); renderPlace(); });
    sc("scN", "n"); sc("scR", "r"); sc("scMin", "min"); sc("scMax", "max");
    renderObjects();
}
function renderObjects() {
    const box = $("stObjects"); if (!box) return;
    const list = world.objects.filter(o => +o.isle === curIsle());
    $("stCount").textContent = list.length ? list.length + " placed" : "";
    box.innerHTML = list.length ? list.map(o => `<div class="stItem${o === sel ? " on" : ""}" data-oid="${esc(o.id)}"><span>${esc(objName(o))}${o.act && o.act.type ? " <small>★</small>" : ""}</span><small>${Math.round(o.x)}, ${Math.round(o.z)}</small></div>`).join("") : `<div class="stHint">Nothing placed here yet.</div>`;
}
left.addEventListener("click", e => {
    const t = e.target.closest("[data-tab]");
    if (t) { tab = t.dataset.tab; pref("tab", tab); clearPreview(); pmClearPreview(); ppClear(); partSel = -1; pmAt = null; renderLeft(); if (tab === "trees") showPreview(true); if (makerTab()) pmShowPreview(true); if (tab === "people") ppShow(true); return; }
    const c = e.target.closest("[data-cat]");
    if (c) { propCat = c.dataset.cat; pref("propCat", propCat); renderPlace(); return; }
    const p = e.target.closest("[data-place]");
    if (p) {
        const k = p.dataset.place;
        if (k.startsWith("t:")) startPlacing(TEMPLATES[k.slice(2)]);
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
let treeGroup = pref("treeGroup") === "used" ? "used" : "unused"; // the Trees tab lists the Unused ones or the ones On islands
const curTree = () => trees.find(t => t.key === treeSel) || null;
function uniqueKey(name) {
    const base = "c_" + (String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "tree");
    let k = base, n = 2;
    while (T.TYPES[k] || trees.some(t => t.key === k)) k = base + "_" + n++;
    return k;
}
function blankTree(name = "New Tree") { // new trees wait in Unused until you put them on an island
    return { key: uniqueKey(name), name, shape: "round", leaf: ["#3a7a3a", "#2f6a3a"], trunk: "#4a3024", glow: "", dots: "", snow: false, rocks: false, col: "#a0d060",
        hp: 1.6, logs: 1.4, dmg: 1.1, speed: 1, bonus: 6, wd: 0.3, wn: 0.25, isl: [], arch: "", minTier: 0, mat: "", rare: false, night: false, flee: false, titan: false, tall: false };
}
function fromBuiltin(k) {
    const B = T.TYPES[k], St = T.TREE_STYLE[k] || { s: "conifer" };
    return { ...blankTree(B.name + " Copy"), name: B.name + " Copy", shape: St.s, leaf: B.leaf.map(toHex), trunk: toHex(B.trunk), glow: B.glow !== undefined ? toHex(B.glow) : "", dots: St.dots !== undefined ? toHex(St.dots) : "",
        snow: !!St.snow, rocks: !!St.rocks, col: B.col, hp: B.hp, logs: B.logs, dmg: B.dmg, speed: B.speed, bonus: B.bonus, wd: B.wd, wn: B.wn, isl: [], arch: "",
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
function newTree(tr) { trees.push(tr); treeSel = tr.key; treeGroup = (tr.isl || []).length ? "used" : "unused"; applyTree(tr); previewAt = null; renderTrees(); showPreview(true); }
function renderTrees() {
    const tr = curTree(), opt = (v, cur, label) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(label)}</option>`;
    const unused = trees.filter(t => !(t.isl || []).length), used = trees.filter(t => (t.isl || []).length), shown = treeGroup === "unused" ? unused : used;
    let h = `<div class="stH">YOUR TREES <small>${trees.length ? trees.length + " made" : ""}</small></div>
      <div class="stBtns" style="margin:0 0 6px"><button class="stB${treeGroup === "unused" ? " on" : ""}" data-tgroup="unused" style="flex:1">Unused (${unused.length})</button><button class="stB${treeGroup === "used" ? " on" : ""}" data-tgroup="used" style="flex:1">On islands (${used.length})</button></div>
      <div class="stList">${shown.map(t => `<div class="stItem${t.key === treeSel ? " on" : ""}" data-tree="${esc(t.key)}"><span><span style="color:${esc(t.col)}">●</span> ${esc(t.name)}</span><small>${(t.isl || []).length ? t.isl.map(i => esc(isleName(i))).join(", ") : "not on an island yet"}</small></div>`).join("") || `<div class="stHint">${treeGroup === "unused" ? "Nothing waiting here. New trees start in Unused: make one below, copy a game tree, or ask Claude. Then put it on an island: tick one under WHERE AND WHEN, or add it in the Islands tab." : "None of your trees are on an island yet. Tick an island under a tree's WHERE AND WHEN, or add it in the Islands tab."}</div>`}</div>
      <div class="stBtns"><button class="stB" id="tNew">+ New tree</button><select class="stSel" id="tCopy" style="flex:1"><option value="">Copy a game tree…</option>${builtins().map(([k, n]) => opt(k, "", n)).join("")}</select></div>`;
    if (!tr) { $("stLeftBody").innerHTML = h; bindTrees(); clearPreview(); return; }
    const mats = matsFor(tr), axes = T.AXES.slice(0, T.BASE_AXES).map((a, i) => [i, i ? a.name + " or better" : "Rusty Axe: from the start"]), c3 = (id, v, on) => `<input class="stIn" type="color" id="${id}" value="${isHex(v) ? v : "#808080"}"${on === false ? " disabled" : ""}>`;
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
      <div class="stChecks">${ISLE_NUMS().map(i => `<label><input type="checkbox" data-isl="${i}"${tr.isl.includes(i) ? " checked" : ""}> ${esc(isleName(i).replace("the ", ""))}</label>`).join("")}</div>
      ${tr.isl.includes(5) ? `<div class="stRow"><label>Archipelago island</label><select class="stSel" id="tArch">${opt("", tr.arch, "any")}${["haven", "coral", "skull", "frost", "storm"].map(k => opt(k, tr.arch, T.ARCH_BY[k].name)).join("")}</select></div>` : ""}
      ${num("tWd", "Day weight", tr.wd, 0.01)}${num("tWn", "Night weight", tr.wn, 0.01)}
      <div class="stHint">Weights are chances next to the island's other trees: common ones are 0.5–0.9, rare ones 0.02–0.15.</div>
      <div class="stRow"><label>Grows once players own</label><select class="stSel" id="tTier" style="max-width:170px">${axes.map(([i, n]) => opt(i, tr.minTier, n)).join("")}</select></div>
      ${tr.minTier ? `<div class="stHint">After every rebirth players start again with the Rusty Axe, so this tree stays away until they've made the ${esc(axeName(tr.minTier))}. The Studio shows it anyway. An island can also let every tree grow from the start (Islands tab).</div>` : ""}
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
    $("stLeftBody").querySelectorAll("[data-tgroup]").forEach(b => b.addEventListener("click", () => { treeGroup = b.dataset.tgroup; pref("treeGroup", treeGroup); renderTrees(); }));
    $("stLeftBody").querySelectorAll("[data-tree]").forEach(it => it.addEventListener("click", () => { treeSel = it.dataset.tree; renderTrees(); showPreview(true); }));
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
        const isl = [...$("stLeftBody").querySelectorAll("[data-isl]")].filter(c => c.checked).map(c => +c.dataset.isl), here = curIsle(), was = tr.isl.includes(here);
        treeGroup = isl.length ? "used" : "unused"; pref("treeGroup", treeGroup); // with no islands it waits in Unused
        set(t => { t.isl = isl; if (!isl.includes(5)) t.arch = ""; if (t.mat && !matsFor(t).includes(t.mat)) t.mat = ""; }, true);
        if (was !== isl.includes(here)) regrowSoon(); // the forest here grows again, with or without it
        say(isl.length ? `${tr.name} grows on ${isl.map(i => isleName(i)).join(", ")}` : `${tr.name} is waiting in Unused`);
    }));
    on("tArch", "change", e => set(t => (t.arch = e.target.value)));
    on("tTier", "change", e => set(t => (t.minTier = +e.target.value), true));
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
}

// ---------- Ask Claude: one short request, a JSON tree back ----------
const CLAUDE_SYSTEM = "You design trees for Hypergamous Tree Chopping Simulator 4, a spooky, cheerful first-person tree-chopping game where the trees are alive, watch you, and creep closer when you look away. Reply with ONLY one JSON object: no prose, no code fences.";
function claudePrompt(desc, tr) {
    const isl = tr.isl, here = Object.entries(T.TYPES).filter(([k, B]) => !B.rush && (B.isl || [1]).some(i => isl.includes(i))).slice(0, 14)
        .map(([k, B]) => ({ name: B.name, shape: (T.TREE_STYLE[k] || {}).s, hp: B.hp, logs: B.logs, dmg: B.dmg, wd: B.wd, wn: B.wn, minTier: B.minTier || 0, mat: B.mat || "", rare: !!B.rare, night: !!B.night, flee: !!B.flee, titan: !!B.titan }));
    const mats = matsFor(tr).map(k => `${k} (${T.MATS[k].name}, $${T.MATS[k].price})`).join(", ");
    return `Design one tree from this description: "${desc}"

${isl.length ? `It grows on: ${isl.map(i => isleName(i)).join(", ")}. Trees already there, for balance: ${JSON.stringify(here)}` : "It isn't on an island yet: balance it like a mid-game tree."}
${mats ? "Material keys it can drop: " + mats + "." : "On Pine Island trees drop plain logs, so leave mat empty."}
minTier is the axe players need before the tree appears, from 0 (Rusty Axe) to ${T.BASE_AXES - 1}. After every rebirth players start again with the Rusty Axe, so most trees should be 0: use 1-4 only for a rarer, tougher tree, and more only for a titan.

Return JSON with exactly these fields:
{"name": "1-3 words, Title Case", "shape": "conifer|round|tall|birch|spiky|dead|crystal|shroom|xmas", "leaf": ["#rrggbb", up to 3 canopy colours], "trunk": "#rrggbb",
 "glow": "#rrggbb dark emissive tint for magical trees, like #1a0a30, or empty string", "dots": "#rrggbb glowing fruit or sparkle dots, or empty string", "snow": false, "rocks": false,
 "col": "#rrggbb bright nameplate colour", "hp": 0.6-9, "logs": 0.3-8, "dmg": 0-2.5 (0 if it runs away), "speed": 0.6-2, "bonus": 0-100,
 "wd": 0-1 day spawn weight, "wn": 0-1 night spawn weight, "minTier": 0-${T.BASE_AXES - 1} (usually 0), "mat": "a material key above or empty",
 "rare": bool, "night": bool (only at night), "flee": bool (runs away, never attacks), "titan": bool (huge), "tall": bool}
Make it fit the description and the island's mood, and keep the numbers balanced against the trees already there.`;
}
async function askClaude(tr) {
    const desc = $("tAsk").value.trim(), msg = $("tAskMsg"), btn = $("tAskGo");
    if (!desc) { msg.className = "stMsg bad"; msg.textContent = "Describe the tree first."; return; }
    const model = $("tModel").value;
    btn.disabled = true; btn.textContent = "Claude is designing it…"; msg.className = "stMsg"; msg.textContent = `Asking ${model}…`;
    const r = await askQ({ prompt: claudePrompt(desc, tr), system: CLAUDE_SYSTEM, model });
    btn.disabled = false; btn.textContent = "Design it with Claude";
    if (!r.ok) { msg.className = "stMsg bad"; msg.textContent = r.error; return; }
    let j = null;
    try { j = JSON.parse((r.text.match(/\{[\s\S]*\}/) || [""])[0]); } catch (e) { /* not JSON */ }
    if (!j) { msg.className = "stMsg bad"; msg.textContent = "Claude's answer wasn't a tree. Try again or reword it."; return; }
    if (!trees.includes(tr)) return; // the tree it was asked about, even if you've clicked another one since
    const cur = tr;
    Object.assign(cur, cleanTree(j, cur));
    applyTree(cur); if (tab === "trees") renderTrees();
    const m2 = $("tAskMsg"); if (m2 && treeSel === cur.key) { m2.className = "stMsg good"; m2.textContent = `${cur.name}, designed by ${r.model} in ${(r.ms / 1000).toFixed(1)}s · ~${(r.tokens / 1000).toFixed(1)}k tokens`; }
    $("tAsk") && ($("tAsk").value = desc);
}

// =====================================================================
//  the island maker: islands that come after the Iceberg, one rebirth each (content/islands.js)
// =====================================================================
const BUILTIN_THEMES = {
    meadow: { label: "Green meadow", colors: { grass: "#4a8a3a", grass2: "#3a7a30", sand: "#e0d0a0", rock: "#7a7a84", snow: "#f4f8ff", camp: "#8a7458", shallow: "#5ac8d8", deep: "#0e2a4a", bush: "#2f6a3a" }, trees: ["pine", "larch", "redwood", "goldleaf", "elder", "gold"], hills: 8, economy: 6 },
    tropical: { label: "Tropical", colors: { grass: "#5aa83a", grass2: "#3a9a4a", sand: "#f4e4a8", rock: "#8a7a6a", snow: "#ffffff", camp: "#c8a878", shallow: "#4ae0d0", deep: "#0a3a5a", bush: "#2a8a3a" }, trees: ["palm", "mangrove", "coralwood", "pearlbloom"], hills: 6, beach: 12, economy: 5 },
    snow: { label: "Snow and ice", colors: { grass: "#e8f0f8", grass2: "#d0e0ee", sand: "#c8d8e8", rock: "#6a7a8a", snow: "#ffffff", camp: "#a8b8c8", shallow: "#6ac8e0", deep: "#0e2a4a", bush: "#cfe4f0" }, trees: ["icepine", "frostbirch", "glacieroak", "snowpine", "frostpine"], snowline: 10, hills: 10, economy: 6 },
    volcanic: { label: "Volcanic", colors: { grass: "#4a3a34", grass2: "#3a2c28", sand: "#2a2224", rock: "#5a3a2a", snow: "#ff6a2a", camp: "#5a4a40", shallow: "#3a6a7a", deep: "#0a1a2a", bush: "#6a2a1a" }, trees: ["ashwood", "cinderpine", "sulfurspire", "obsidianoak", "emberwillow"], snowline: 30, hills: 12, economy: 4 },
    spooky: { label: "Spooky", colors: { grass: "#2a3a3a", grass2: "#1e2a30", sand: "#5a5a60", rock: "#4a4a58", snow: "#b07aff", camp: "#3a3438", shallow: "#3a5a6a", deep: "#08101a", bush: "#2a2a3a" }, trees: ["elder", "ghost", "blood", "gloomwood", "voidspire"], hills: 7, economy: 6 },
    desert: { label: "Desert", colors: { grass: "#d8b878", grass2: "#c8a868", sand: "#ecd8a0", rock: "#a8784a", snow: "#ffffff", camp: "#c8a070", shallow: "#5ad0d0", deep: "#0e3a5a", bush: "#8a9a4a" }, trees: ["ashwood", "palm", "goldleaf"], hills: 9, economy: 4 },
    mushroom: { label: "Mushroom forest", colors: { grass: "#3a6a6a", grass2: "#4a3a7a", sand: "#c8c0d8", rock: "#5a5a7a", snow: "#f4e8ff", camp: "#5a4a6a", shallow: "#6ac8e0", deep: "#100a2a", bush: "#6a3a8a" }, trees: ["glowcap", "silverbirch", "amberpine", "moonbloom", "mooncap"], hills: 8, economy: 3 }
};
let myThemes = {}; // your own themes, saved next to the Studio (studio/my-themes.json), not shipped with the game
const THEMES = () => ({ ...BUILTIN_THEMES, ...Object.fromEntries(Object.entries(myThemes).map(([k, t]) => ["my:" + k, t])) });
const THEME_KEYS = ["shape", "colors", "trees", "snowline", "economy", "hills", "hillSize", "beach", "cliffs", "decor", "plateau", "wobble", "radius", "features", "treeCount", "treeW", "allTiers", "animals", "cover", "coverCol", "flies", "fliesCol"];
const ECON = { 2: "the Highland Isle", 3: "Mooncap Isle", 4: "Ashfall Isle", 5: "the Archipelago", 6: "the Iceberg" };
const FTYPES = { mountain: "⛰ Mountain", hill: "Hill", spire: "Spire", crater: "Crater", plateau: "Plateau (mesa)", ridge: "Ridge", valley: "Valley", lake: "Lake", islet: "Islet (scenery)", isle: "🏝 Walkable island + bridge", bay: "Bay" };
const FDEF = { mountain: { r: 40, h: 35, dist: 0.55 }, hill: { r: 30, h: 10, dist: 0.5 }, spire: { r: 12, h: 45, dist: 0.6 }, crater: { r: 26, h: 16, dist: 0.55 }, plateau: { r: 28, h: 12, dist: 0.55 }, ridge: { r: 14, h: 22, len: 80, dist: 0.55 }, valley: { r: 10, len: 70, dist: 0.45 }, lake: { r: 14, dist: 0.5 }, islet: { r: 16, h: 6, dist: 1.4 }, isle: { r: 28, h: 4, dist: 1.7 }, bay: { width: 0.35, depth: 0.25 } };
// ground cover: [key, label, most, colour key]
const COVER = [["grass", "Grass tufts", 300], ["flowers", "Flowers", 80, "flowers"], ["berries", "Berry bushes", 80, "berries"], ["mush", "Mushrooms", 80, "mush"], ["glowshroom", "Glowing mushrooms", 80, "glowshroom"], ["rings", "Fairy rings", 30, "glowshroom"],
    ["logs", "Fallen logs", 60], ["stumps", "Stumps", 60], ["crystals", "Crystals", 80, "crystals"], ["cracks", "Glowing cracks", 80, "cracks"], ["bones", "Bones", 40], ["cairns", "Stone piles", 40]];
const COVER_COL = { mush: "#9a1a12", glowshroom: "#7affef", berries: "#d02a4a", flowers: "#b07aff", crystals: "#9a7aff", cracks: "#ff6a1a" };
const FLIES = { fireflies: "Fireflies at night", spores: "Glowing spores, day and night", embers: "Rising embers", none: "Nothing" };
const FOREST = { 1: 60, 2: 90, 3: 95, 4: 100, 6: 95 }; // how many trees the game's own islands grow
let islandSel = Math.max(0, islands.length - 1), featOpen = -1;
const prevMats = n => (n - 1 === 6 ? T.MATS_BY_ISLE[6] : T.MATS_BY_ISLE[n - 1]) || T.MATS_BY_ISLE[6] || [];
const axeName = i => (T.AXES[i] ? T.AXES[i].name : "axe " + i);
const slug = (s, fb) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 22) || fb;
function migrateIsland(d) { // older islands had one mountain and one lake: they become features
    if (!d) return;
    d.features = Array.isArray(d.features) ? d.features : [];
    if (d.mountain) { if (d.mountain.on) d.features.push({ ...d.mountain, type: "mountain" }); delete d.mountain; }
    if (d.lake) { if (d.lake.on) d.features.push({ ...d.lake, type: "lake" }); delete d.lake; }
    for (const f of d.features) delete f.on;
}
// the whole forest of the island you're on grows again (after you change which trees live there)
function regrowHere() { const n = curIsle(), C = T.customIsle(n); if (C) T.resetIsleTrees(Math.min(220, Math.max(10, +C.d.treeCount || 90))); else if (FOREST[n]) T.resetIsleTrees(FOREST[n]); }
let regrowT = 0;
const regrowSoon = () => { clearTimeout(regrowT); regrowT = setTimeout(regrowHere, 350); };
// what a new island starts with, by theme (your own themes bring their own)
const START = {
    meadow: [["mountain", "THE PEAK"], ["lake", "THE LAKE"], ["hill", ""]],
    tropical: [["mountain", "THE PEAK"], ["bay", ""], ["islet", "THE ISLET"], ["lake", "THE LAGOON"]],
    snow: [["spire", "THE NEEDLE"], ["mountain", "THE PEAK"], ["ridge", "THE SPINE"]],
    volcanic: [["crater", "THE FURNACE", true], ["spire", "THE CHIMNEY"], ["ridge", ""]],
    spooky: [["spire", "THE BLACK SPIRE"], ["valley", ""], ["lake", "THE MIRE"]],
    desert: [["plateau", "THE MESA"], ["plateau", ""], ["valley", "THE DRY CANYON"]],
    mushroom: [["hill", ""], ["lake", "THE GLOW POOL"], ["crater", "THE HOLLOW"]]
};
const START_ECO = {
    meadow: { animals: [["deer", 6], ["rabbit", 9], ["squirrel", 6], ["butterfly", 10], ["eagle", 3]], cover: { grass: 110, flowers: 24, berries: 16, mush: 14, logs: 12, stumps: 10 }, flies: "fireflies" },
    tropical: { animals: [["monkey", 7], ["parrot", 6], ["skyparrot", 5], ["crab5", 8], ["pig", 5], ["gull5", 4], ["butterfly", 8]], cover: { grass: 70, flowers: 26, berries: 10, logs: 6 }, coverCol: { flowers: "#ff5a8a", berries: "#ffb040" }, flies: "fireflies" },
    snow: { animals: [["penguin", 12], ["pbear", 3], ["afox", 5], ["hare", 7], ["seal", 4]], cover: { cairns: 10, crystals: 10, stumps: 6, logs: 4 }, coverCol: { crystals: "#bff4ff" }, flies: "none" },
    volcanic: { animals: [["salamander", 12], ["beetle", 14], ["crow", 8], ["bat", 6], ["skycrow", 4]], cover: { cracks: 44, crystals: 18, bones: 8, stumps: 14, grass: 70 }, coverCol: { crystals: "#3a2a4a", cracks: "#ff6a1a" }, flies: "embers" },
    spooky: { animals: [["crow", 10], ["bat", 8], ["fox", 4], ["moth", 18], ["snail", 8]], cover: { glowshroom: 18, rings: 6, bones: 10, logs: 12, stumps: 10, grass: 80 }, coverCol: { glowshroom: "#b07aff" }, flies: "spores", fliesCol: "#c8a0ff" },
    desert: { animals: [["lizard", 12], ["beetle", 8], ["crow", 5], ["eagle", 3], ["goat", 4]], cover: { bones: 10, cairns: 10, stumps: 6, grass: 30 }, flies: "none" },
    mushroom: { animals: [["shroom", 14], ["snail", 14], ["moth", 20], ["fox", 6]], cover: { glowshroom: 30, rings: 8, crystals: 12, mush: 16, grass: 100 }, coverCol: { glowshroom: "#7affef", crystals: "#d07aff" }, flies: "spores", fliesCol: "#9ffff0" }
};
function ecoPreset(theme) {
    const E = START_ECO[theme] || START_ECO.meadow;
    return { animals: E.animals.filter(([k]) => T.WILD_KINDS[k]).map(([kind, n]) => ({ kind, n })), cover: { ...E.cover }, coverCol: { ...(E.coverCol || {}) }, flies: E.flies || "fireflies", fliesCol: E.fliesCol || "" };
}
function startFeatures(theme) {
    const Th = THEMES()[theme] || {}; if (Array.isArray(Th.features)) return JSON.parse(JSON.stringify(Th.features));
    const list = START[theme] || START.meadow, base = Math.random() * 360;
    return list.map(([type, name, lava], i) => { const f = { type, dir: Math.round(base + (i * 360) / list.length + Math.random() * 40) % 360 }; for (const k of ["dist", "r", "h", "len", "width", "depth"]) if (FDEF[type][k] !== undefined) f[k] = FDEF[type][k]; if (name) f.name = name; if (lava) f.lava = true; return f; });
}
function applyTheme(d, Th) { for (const k of THEME_KEYS) if (Th[k] !== undefined) d[k] = JSON.parse(JSON.stringify(Th[k])); if (Th.snowline === undefined) d.snowline = ""; d.trees = (d.trees || []).filter(k => T.TYPES[k]); if (!d.trees.length) d.trees = ["pine"]; }
function newIsland(theme = "meadow") {
    const Th = THEMES()[theme] || BUILTIN_THEMES.meadow, n = T.CI_BASE + islands.length, pm = prevMats(n), item = pm[Math.min(5, pm.length - 1)];
    const d = { name: "New Island", sub: "", theme, seed: r3(1 + Math.random() * 8), radius: 130, wobble: 0.12, plateau: 2.5, hills: 8, hillSize: 1, beach: 6, cliffs: 0, decor: 1,
        features: startFeatures(theme), colors: {}, snowline: "", trees: [], treeCount: 90, treeW: {}, allTiers: false, economy: 6, mats: [], axes: [], ...ecoPreset(theme),
        rebirth: { cost: Math.round(25000000 * Math.pow(2, n - T.CI_BASE)), items: item ? { [item]: 5 } : {} },
        rideLine1: "The sea goes quiet. Something new waits ahead...", rideLine2: "", ferryLine: "", arrive: "", campName: "CAMP", arrDir: 125, nextDir: -35 };
    applyTheme(d, Th);
    islands.push(d); islandSel = islands.length - 1;
    T.ciSet(islandSel, d);
    if (islandSel > 0) T.ciSet(islandSel - 1, islands[islandSel - 1]); // the island before shows this one on its ferry sign now
    renderIsleSelect(); changed("islands"); renderIslands();
    say(`Island ${n} made: Rebirth ${n - 1}. Press "Go there" to see it`, 3500);
}
let rebuildRender = false;
const isleTs = {}; // one rebuild timer per island, so rebuilding one never cancels another's
function rebuildNow(i) { // rebuild island i, and carry its materials over to the next island's ticket
    clearTimeout(isleTs[i]); if (!islands[i]) return;
    T.ciSet(i, islands[i]);
    const nx = islands[i + 1], C = T.customIsle(T.CI_BASE + i);
    if (nx && nx.rebirth && nx.rebirth.items && C && C.subMats) { const it = C.subMats(nx.rebirth.items); if (JSON.stringify(it) !== JSON.stringify(nx.rebirth.items)) { nx.rebirth.items = it; changed("islands"); T.ciSet(i + 1, nx); } }
}
function rebuildIsle(i, wait = 450, rerender) { // rebuilding is heavy, so not on every keypress
    if (rerender) rebuildRender = true;
    clearTimeout(isleTs[i]);
    isleTs[i] = setTimeout(() => { rebuildNow(i); renderIsleSelect(); if (rebuildRender && tab === "islands" && i === islandSel) { rebuildRender = false; renderIslands(); } }, wait); // then prices and recipes show
}
function islandChanged(rerender, i = islandSel) {
    const d = islands[i]; if (!d) return;
    changed("islands"); rebuildIsle(i, 450, rerender);
    if (rerender && tab === "islands" && i === islandSel) renderIslands();
}
function renderIsleSelect() { const s = $("stIsle"), v = s.value; s.innerHTML = ISLES().map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join(""); s.value = curEntry().id || v; }
function testRebirth(i) { // ride the real ferry from the island before, with the ticket paid for you (your save is never touched)
    const n = T.CI_BASE + i, from = n - 1, C = T.customIsle(n); if (!C) return;
    if (from === 6) { if (curIsle() !== 6) T.enterIsle6(); } else { const Pv = T.customIsle(from); if (!Pv) return; T.enterCI(Pv); }
    T.save.money = Math.max(T.save.money, C.cost); for (const [k, v] of Object.entries(C.items)) T.save.mats[k] = Math.max(T.save.mats[k] || 0, v);
    T.setState("studio"); play();
    setTimeout(() => { T.startRebirthRide(from); say(`Riding the Rebirth ${from} ferry to ${C.name}… (F5 to stop)`, 5000); }, 350);
}
// the trees an island grows: game trees it borrows (d.trees), plus your own trees that have it ticked
const isleTreeList = (d, n) => [...(d.trees || []).filter(k => T.TYPES[k]).map(k => ({ k, own: null })), ...trees.filter(t => (t.isl || []).includes(n)).map(t => ({ k: t.key, own: t }))];
function setTreeOnIsle(t, n, on) {
    t.isl = (t.isl || []).filter(i => i !== n); if (on) t.isl.push(n);
    if (t.mat && !matsFor(t).includes(t.mat)) t.mat = ""; // it can only drop what its islands drop
    if (t.isl.length && treeGroup === "unused") treeGroup = "used";
    T.defineCustomTree(t); changed("trees");
}
// the island's own materials and axes
function uniqueKey2(prefix, name, taken) { const base = prefix + slug(name, prefix === "m_" ? "material" : "axe"); let k = base, n = 2; while (taken(k)) k = base + "_" + n++; return k; }
const matTaken = (k, d) => (T.MATS[k] && !(d.mats || []).some(m => m.key === k)) || islands.some(o => o !== d && (o.mats || []).some(m => m.key === k));
const axeTaken = (k, d) => T.AXES.some(a => a.key === k && !(d.axes || []).some(x => x.key === k)) || islands.some(o => o !== d && (o.axes || []).some(x => x.key === k));
function dropMatEverywhere(key) { // a material is gone: trees that dropped it drop the island's default, and tickets and recipes forget it
    for (const t of trees) if (t.mat === key) { t.mat = ""; T.defineCustomTree(t); changed("trees"); }
    islands.forEach((o, i) => {
        let hit = false;
        if (o.rebirth && o.rebirth.items && o.rebirth.items[key]) { delete o.rebirth.items[key]; hit = true; }
        for (const a of o.axes || []) if (a.recipe && a.recipe[key]) { delete a.recipe[key]; hit = true; }
        if (hit && i !== islandSel) { changed("islands"); T.ciSet(i, o); }
    });
}
// ---- Ask Claude for a whole island ----
function treeChoices() { const out = []; for (const [k, t] of Object.entries(T.TYPES)) { if (t.rush || t.custom) continue; out.push(`${k} (${t.name}, ${isleName((t.isl || [1]).filter(i => i <= 6)[0] || 1)}${t.rare ? ", rare" : ""}${t.night ? ", night" : ""})`); } return out.join("; "); }
const animalChoices = () => Object.entries(T.WILD_KINDS).map(([k, W]) => `${k} (${W.name}${W.fly ? ", flies" : ""}${W.custom ? ", made in the Studio" : ""})`).join("; ");
const abilChoices = () => T.ABIL.slice(0, T.BASE_AXES).map((a, i) => `${i} ${a.name}`).join(", ");
// what Ask Claude last said about an island, and which island it's busy on: kept here so the tab can redraw while it works
let askNote = null, askBusy = null;
function setAskMsg(d, cls, text) {
    askNote = { d, cls, text };
    const m = $("iAskMsg"); if (m && islands[islandSel] === d) { m.className = "stMsg" + (cls ? " " + cls : ""); m.textContent = text; }
    const b = $("iAskGo"); if (b) { b.disabled = askBusy === islands[islandSel]; b.textContent = b.disabled ? "Claude is shaping it…" : "Design it with Claude"; }
}
async function askClaudeIsland(d) {
    const desc = ($("iAsk").value || "").trim(), invent = $("iInvent").checked, i0 = islandSel, n = T.CI_BASE + i0;
    if (askBusy) { setAskMsg(d, "bad", "Claude is still working on an island."); return; }
    if (!desc) { setAskMsg(d, "bad", "Describe the island first."); return; }
    const model = $("iModel").value; pref("model", model); pref("invent", invent ? "1" : "0");
    askBusy = d; setAskMsg(d, "", `Asking ${model}…`);
    try { await askIsland(d, desc, invent, i0, n, model); }
    finally { askBusy = null; if (askNote && askNote.d === d && !askNote.cls) askNote.cls = "bad"; setAskMsg(d, askNote ? askNote.cls : "", askNote ? askNote.text : ""); $("iAsk") && ($("iAsk").value = desc); }
}
async function askIsland(d, desc, invent, i0, n, model) {
    const prompt = `Design an island from this description: "${desc}"

It's island ${n} in a chain of rebirth islands for a spooky low-poly tree-chopping game. The camp sits flat in the middle (radius ~30 m): keep features away from the centre.
Return JSON with exactly these fields:
{"name": "2-4 words", "sub": "a short line for the ferry ticket", "radius": 90-200, "wobble": 0-0.3 (how ragged the coast is), "plateau": 1-8 (land height at camp), "hills": 0-30, "hillSize": 0.5-2.5, "beach": 3-20, "cliffs": 0-1 (sea cliffs), "decor": 0-2 (rocks and bushes),
 "colors": {"grass": "#rrggbb", "grass2": "#rrggbb", "sand": "#rrggbb", "rock": "#rrggbb (cliffs)", "snow": "#rrggbb (high peaks)", "camp": "#rrggbb", "bush": "#rrggbb", "shallow": "#rrggbb (shallow sea)", "deep": "#rrggbb (deep sea)"},
 "snowline": a height in metres above which the peaks colour is used, or "" for never,
 "trees": 2-6 keys from this list: ${treeChoices()},
 "treeW": {"tree key": 0.2-3, how common each tree is next to the others (1 = normal)},
 "treeCount": 40-160, "economy": 2-6 (whose recipes and prices it copies: 2 Highland, 3 Mooncap, 4 Ashfall, 5 Archipelago, 6 Iceberg),
 "mats": 4-7 new materials its trees drop, cheapest first: [{"name": "1-2 words", "color": "#rrggbb", "glow": true for magical ones}],
 "axes": 1-3 new axes forged from those materials, weakest first: [{"name": "2-3 words", "steel": "#rrggbb head colour", "edge": "#rrggbb bright edge colour", "glow": "#rrggbb dark glow", "ability": the number of the special move it borrows, one of: ${abilChoices()}}],
 "animals": 3-7 of [{"kind": "a key from this list", "n": 3-14}]: ${animalChoices()},
 "cover": {ground cover counts: "grass": 0-200, "flowers": 0-50, "berries": 0-40, "mush": 0-40, "glowshroom": 0-40, "rings": 0-12, "logs": 0-30, "stumps": 0-30, "crystals": 0-40, "cracks": 0-60, "bones": 0-20, "cairns": 0-20},
 "coverCol": {"flowers": "#rrggbb", "berries": "#rrggbb", "mush": "#rrggbb", "glowshroom": "#rrggbb", "crystals": "#rrggbb", "cracks": "#rrggbb"},
 "flies": "fireflies|spores|embers|none", "fliesCol": "#rrggbb or empty",
 "shape": {"kind": "round|long|lobed", "stretch": 1-2.4 (long only), "lobes": 2-7 and "amount": 0.1-0.45 (lobed only), "angle": 0-359} (pick what suits it: long for a ridge or a spit of land, lobed for a clover of bays),
 "features": up to 12 of {"type": "mountain|hill|spire|crater|plateau|ridge|valley|lake|islet|isle|bay" (islet = a rock in the sea you can't reach; isle = a real walkable island out at sea, joined to the main one by a bridge), "dir": 0-359 (direction from the centre), "dist": 0.35-0.9 (fraction of the radius; islets 1.2-2; isles 1.4-2.6), "bridge": true or false (isles only), "r": size in metres (5-60), "h": height in metres (spires up to 70, hills 5-20), "len": length for ridges and valleys (30-150), "rot": angle of a ridge or valley in degrees, "width": bay width 0.1-1, "depth": bay depth 0.1-0.5, "lava": true for a lava crater, "name": "THE SOMETHING" or ""},
 "props": up to 14 groups of the game's own props to put around the island: [{"prop": a key from this list, "dir": 0-359, "dist": 0.3-0.85, "isle": -1 for the main island, or which "isle" feature (0 for the first isle, 1 for the second...), "count": 1-8}]: ${propChoices()},
 "campName": "1-2 words", "rideLine1": "what you see on the ferry ride", "rideLine2": "the island coming into view", "ferryLine": "what the Ferryman says before you sail", "arrive": "a welcome message",
 "casino": the casino tower moves to the newest island and is re-skinned for it, outside and in: ${CASINO_SPEC} (make it belong to this island),
 "ui": the game's menus while you're on this island: {"accent": "#rrggbb (titles and highlights)", "panel": "#rrggbb (a dark menu background)", "ink": "#rrggbb (light, readable text)", "font": one of ${T.ISLE_FONTS.map(f => `"${f}"`).join(", ")} (for headings), "corner": 0-24 (how round the menus are)}${invent ? `,
 "architecture": "one or two sentences: how everything here is built (what from, shapes, roofs, colours, details), so every building matches",
 "camp": {"bed": "one sentence: the hut the player sleeps in", "forge": "one sentence: the forge where axes are made", "post": "one sentence: the trading post where materials are sold", "witch": "one sentence: the hut where potions are brewed"} (all in that architecture),
 "shops": 1-2 shops run by locals: [{"title": "the shop's name", "keeper": "one sentence: who runs it and how they look", "building": "one sentence: the shop building, in the architecture", "greeting": "what the keeper says when you walk in", "color": "#rrggbb", "dir": 0-359, "dist": 0.25-0.6,
   "items": 3-6 things for sale: [{"name": "1-3 words", "desc": "a short funny line", "icon": "one emoji", "cash": 10000-3000000, "mats": {"the name of one of this island's mats": 1-40} or {} (some things cost the island's materials as well as, or instead of, cash), "give": {"buff": one of ${Object.entries(T.BUFFS).map(([k, b]) => `"${k}" (${b.name})`).join(", ")}, "secs": 60-900} or {"mat": "a material name", "n": 1-40} or {"heal": true}}]}],
 "newProps": 2-4 small models only found here (lanterns, totems, statues, carts, signposts...): [{"description": "one sentence: what it is and what it looks like", "dir": 0-359, "dist": 0.3-0.85, "count": 1-6}],
 "landmarks": 1-3 new buildings or big structures that make this place special (a lighthouse, a ruined watchtower, a stilt house, a giant mushroom hut...), in the architecture: [{"description": "one sentence: what it is and what it looks like", "dir": 0-359, "dist": 0.3-0.8, "isle": -1 or which isle}],
 "newTrees": 2-3 short descriptions of new trees that only grow here (one sentence each, with their look and mood),
 "newAnimals": 1-2 short descriptions of new animals that only live here (one sentence each),
 "residents": 1-2 short descriptions of people who live here (one sentence each: who they are and how they look)` : ""}}
Make it match the description and feel distinct.`;
    const r = await askQ({ prompt, system: "You design islands for Hypergamous Tree Chopping Simulator 4, a spooky, cheerful first-person tree-chopping game. Reply with ONLY one JSON object: no prose, no code fences.", model });
    if (!r.ok) { setAskMsg(d, "bad", r.error); return; }
    let j = null; try { j = JSON.parse((r.text.match(/\{[\s\S]*\}/) || [""])[0]); } catch (e) { /* not JSON */ }
    if (!j) { setAskMsg(d, "bad", "Claude's answer wasn't an island. Try again or reword it."); return; }
    cleanIsland(j, d); d.theme = ""; // Claude's own look, not one of the themes
    changed("islands"); rebuildNow(i0); if (tab === "islands" && islandSel === i0) renderIslands(); // built straight away, so the trees it invents can pick its new materials
    clearGenerated(n); // what Claude put here last time makes way
    let placedN = 0;
    for (const g of (Array.isArray(j.props) ? j.props : []).slice(0, 14)) if (g && T.PROPS[g.prop] && !T.PROPS[g.prop].custom) placedN += placeOnIsland(n, g.prop, g, Math.round(Math.min(8, Math.max(1, +g.count || 1))));
    let note = `${d.name}, shaped by ${r.model} in ${(r.ms / 1000).toFixed(1)}s · ~${(r.tokens / 1000).toFixed(1)}k tokens. ${placedN} props put around it.`, tok = r.tokens;
    const say2 = t => setAskMsg(d, "", t);
    if (invent) { // then everything it invents gets its own short request, three at a time: trees, animals, the camp's buildings, shops and their keepers, models, landmarks and people
        const strs = (v, k) => (Array.isArray(v) ? v : []).filter(s => typeof s === "string" && s.trim()).slice(0, k).map(s => s.trim().slice(0, 300));
        const objs = (v, k) => (Array.isArray(v) ? v : []).filter(s => s && typeof s === "object").slice(0, k);
        const arch = typeof j.architecture === "string" ? j.architecture.trim().slice(0, 300) : "", styled = s => (arch ? `${s} Built in this island's style: ${arch}` : s);
        const isl = islands[i0], jobs = [], got = { tree: 0, animal: 0, camp: 0, shop: 0, model: 0, landmark: 0, person: 0 };
        let done = 0;
        const tick = () => say2(`${note} Inventing: ${++done} of ${jobs.length} done…`);
        const build = async (kind, desc, starter) => { // a building or model from parts, kept in My props
            const res = await claudeBuild(kind, desc, model, starter); if (!res.ok || !res.data.parts.length) return null;
            const p = res.data; p.key = pmKeyFor(MK.props, p.name); myProps.push(p); T.defineCustomProp(p); changed("props"); tok += res.tokens; return p;
        };
        const person = async desc => {
            const res = await claudePerson(desc, model); if (!res.ok) return null;
            const pp = cleanPerson(res.data, starterPerson()); pp.key = ppKey(pp.name); myPeople.push(pp); T.defineCustomPerson(pp); changed("people"); tok += res.tokens; return pp;
        };
        strs(j.newTrees, 3).forEach((tdesc, k) => jobs.push(async () => {
            const tr = blankTree("New Tree"); tr.isl = [n];
            const rt = await askQ({ prompt: claudePrompt(tdesc, tr), system: CLAUDE_SYSTEM, model });
            let jt = null; if (rt.ok) try { jt = JSON.parse((rt.text.match(/\{[\s\S]*\}/) || [""])[0]); } catch (e) { /* not JSON */ }
            if (!jt) return;
            const t2 = cleanTree(jt, tr); t2.key = uniqueKey(t2.name); t2.isl = [n]; t2.minTier = Math.min(t2.minTier, k); // the first one grows from the start
            trees.push(t2); T.defineCustomTree(t2); changed("trees"); tok += rt.tokens; got.tree++;
            if (!curTree()) treeSel = t2.key;
        }));
        strs(j.newAnimals, 2).forEach(adesc => jobs.push(async () => {
            const res = await claudeBuild("animals", adesc, model, starterAnimal()); if (!res.ok) return;
            const a = res.data; a.key = pmKeyFor(MK.animals, a.name); myAnimals.push(a); T.defineCustomAnimal(a); changed("animals"); tok += res.tokens; got.animal++;
            if (!MK.animals.sel) MK.animals.sel = a.key;
            isl.animals = isl.animals || []; isl.animals.push({ kind: a.key, n: 6 });
        }));
        const camp0 = j.camp && typeof j.camp === "object" ? j.camp : {};
        if (arch || Object.keys(camp0).length) { // the camp in the island's own architecture
            isl.camp = {};
            for (const [k, [label, what]] of Object.entries(CAMP)) jobs.push(async () => {
                const desc = typeof camp0[k] === "string" && camp0[k].trim() ? camp0[k].trim().slice(0, 240) : what;
                const p = await build("buildings", styled(`${desc} It's ${what}: 5-9 m across, its open front facing +z.`), { name: label, r: 3, light: null, parts: [] });
                if (p) { isl.camp[k] = p.key; got.camp++; }
            });
        }
        objs(j.shops, 2).forEach(s => jobs.push(async () => { // a shop: its building and its keeper made side by side, then put together
            const [bld, keeper] = await Promise.all([typeof s.building === "string" && s.building.trim() ? build("buildings", styled(`${s.building.trim().slice(0, 240)} It's a shop with a counter at the front.`), { name: "Shop", r: 3, light: null, parts: [] }) : null, typeof s.keeper === "string" && s.keeper.trim() ? person(s.keeper.trim().slice(0, 300)) : null]);
            if (placeShop(n, s, bld, keeper, cleanShop(s, isl, keeper))) got.shop++;
        }));
        objs(j.newProps, 4).filter(s => typeof s.description === "string" && s.description.trim()).forEach(s => jobs.push(async () => {
            const p = await build("props", styled(s.description.trim().slice(0, 300)), { name: "Model", r: 0.5, light: null, parts: [] });
            if (p && placeOnIsland(n, p.key, s, Math.round(Math.min(6, Math.max(1, +s.count || 2))))) got.model++;
        }));
        objs(j.landmarks, 3).filter(L => typeof L.description === "string" && L.description.trim()).forEach(L => jobs.push(async () => { // new buildings, put on the island facing the camp
            const p = await build("buildings", styled(L.description.trim().slice(0, 300)), { name: "Landmark", r: 2, light: null, parts: [] });
            if (p && placeOnIsland(n, p.key, L, 1, true)) got.landmark++;
        }));
        strs(j.residents, 2).forEach(rd => jobs.push(async () => { const pp = await person(rd); if (pp && placePerson(n, pp)) got.person++; })); // people who live there, about the camp ready to talk
        say2(`${note} Inventing ${jobs.length} things, three at a time…`);
        await Promise.all(jobs.map(f => f().catch(e => console.error(e)).then(tick)));
        const parts = [["tree", "trees"], ["animal", "animals"], ["camp", "camp buildings"], ["shop", "shops"], ["model", "models"], ["landmark", "landmarks"], ["person", "residents"]].filter(([k]) => got[k]).map(([k, w]) => `${got[k]} ${w}`);
        note += ` Invented ${parts.join(", ") || "nothing new"} (~${(tok / 1000).toFixed(1)}k tokens in all).`;
        islandChanged(true, i0);
    }
    setAskMsg(d, "good", note + " The ticket stays as you set it.");
}
// what Claude puts on an island: the game's props and the buildings it invents. Each is a real placed object, marked gen, so asking again clears them
const propChoices = () => Object.entries(T.PROPS).filter(([k, p]) => !p.custom).map(([k, p]) => `${k} (${p.name})`).join(", ");
function islandSpot(n, s) { // { dir, dist, isle } → somewhere to stand on that island, clear of the camp, docks and bridges
    const C = T.customIsle(n); if (!C) return null;
    const q = Number.isInteger(+s.isle) && +s.isle >= 0 ? C.isles[+s.isle] : null;
    for (let k = 0; k < 14; k++) {
        let x, z;
        if (q) { const a = Math.random() * 6.283, rr = Math.random() * (q.r - 7); x = q.x + Math.cos(a) * rr; z = q.z + Math.sin(a) * rr; }
        else { const th = ((+s.dir || 0) + (k ? (Math.random() - 0.5) * 50 : 0)) * DEG, f = Math.min(0.85, Math.max(0.25, +s.dist || 0.6)) * (k ? 0.8 + Math.random() * 0.35 : 1), rr = C.shoreR(th) * f; x = Math.cos(th) * rr; z = Math.sin(th) * rr; if (Math.hypot(x, z) < 36) continue; }
        if (C.treeOk(x, z) && C.groundY(x, z) > 0.3) return { x, z };
    }
    return null;
}
function placeOnIsland(n, key, s, count = 1, face) {
    const C = T.customIsle(n), c0 = islandSpot(n, s); if (!C || !c0) return 0;
    let made = 0;
    for (let k = 0; k < count; k++) {
        const x = r3(c0.x + (k ? (Math.random() - 0.5) * 12 : 0)), z = r3(c0.z + (k ? (Math.random() - 0.5) * 12 : 0));
        const o = { id: newId(), isle: n, kind: "prop", prop: key, x, y: r3(C.groundY(x, z)), z, rx: 0, ry: r3(face ? Math.atan2(-x, -z) : Math.random() * 6.283), rz: 0, s: 1, solid: true, gen: true }; // buildings face the camp
        world.objects.push(o); T.placedBuild(o); made++;
    }
    if (made) changed("world");
    return made;
}
function clearGenerated(n) { const old = world.objects.filter(q => q.gen && +q.isle === n); for (const o of old) { T.placedRemove(o); world.objects.splice(world.objects.indexOf(o), 1); } if (old.length) changed("world"); }
function cleanIsland(src, d) { // every field checked before it reaches the game
    if (src.shape && typeof src.shape === "object") { const s = src.shape, nm = (v, a, b, dflt) => { v = +v; return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : dflt; }; d.shape = { kind: ["round", "long", "lobed"].includes(s.kind) ? s.kind : "round", stretch: r3(nm(s.stretch, 1, 2.4, 1.6)), lobes: Math.round(nm(s.lobes, 2, 7, 3)), amount: r3(nm(s.amount, 0, 0.45, 0.3)), angle: Math.round(nm(s.angle, 0, 359, 0)) }; }
    const num = (v, a, b, dflt) => { v = +v; return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : dflt; }, hex = v => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : null), str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
    if (str(src.name, 40).trim()) d.name = str(src.name, 40).trim();
    d.sub = str(src.sub, 80);
    for (const [k, a, b] of [["radius", 90, 200], ["wobble", 0, 0.3], ["plateau", 0.6, 10], ["hills", 0, 30], ["hillSize", 0.3, 3], ["beach", 2, 24], ["cliffs", 0, 1], ["decor", 0, 3], ["treeCount", 20, 200]]) if (src[k] !== undefined) d[k] = r3(num(src[k], a, b, d[k]));
    if (src.colors && typeof src.colors === "object") { d.colors = { ...(d.colors || {}) }; for (const k of ["grass", "grass2", "sand", "rock", "snow", "camp", "bush", "shallow", "deep"]) if (hex(src.colors[k])) d.colors[k] = hex(src.colors[k]); }
    d.snowline = src.snowline === "" || src.snowline === null || src.snowline === undefined ? "" : num(src.snowline, 0, 200, "");
    if (Array.isArray(src.trees)) { const t = src.trees.filter(k => T.TYPES[k] && !T.TYPES[k].rush && !T.TYPES[k].custom).slice(0, 8); if (t.length) d.trees = t; }
    if (src.treeW && typeof src.treeW === "object") { d.treeW = {}; for (const [k, v] of Object.entries(src.treeW)) if ((d.trees || []).includes(k) && Number.isFinite(+v)) d.treeW[k] = r3(num(v, 0, 3, 1)); }
    if ([2, 3, 4, 5, 6].includes(+src.economy)) d.economy = +src.economy;
    // a material or axe that keeps its name keeps its key, so trees, tickets and what players already own stay with it
    if (Array.isArray(src.mats) && src.mats.length) {
        const old = (d.mats || []).map(m => m.key), nm = [];
        for (const m of src.mats.slice(0, 7)) { if (!m || !str(m.name, 24).trim()) continue; const name = str(m.name, 24).trim(); nm.push({ key: uniqueKey2("m_", name, k => matTaken(k, d) || nm.some(q => q.key === k)), name, color: hex(m.color) || "#9a9aa4", glow: !!m.glow }); }
        if (nm.length) { d.mats = nm; for (const k of old) if (!nm.some(m => m.key === k)) dropMatEverywhere(k); }
    }
    if (Array.isArray(src.axes) && src.axes.length) {
        const nx = [];
        for (const a of src.axes.slice(0, 3)) { if (!a || !str(a.name, 28).trim()) continue; const name = str(a.name, 28).trim(); nx.push({ key: uniqueKey2("x_", name, k => axeTaken(k, d) || nx.some(q => q.key === k)), name, steel: hex(a.steel) || "#4a4a5a", edge: hex(a.edge) || "#e8f0ff", glow: hex(a.glow) || "#2a2a4a", ability: Math.round(num(a.ability, 0, T.BASE_AXES - 1, 14)) }); }
        if (nx.length) d.axes = nx;
    }
    if (Array.isArray(src.animals)) { const a = src.animals.filter(q => q && T.WILD_KINDS[q.kind]).slice(0, 10).map(q => ({ kind: q.kind, n: Math.round(num(q.n, 1, 30, 6)) })); if (a.length) d.animals = a; }
    if (src.cover && typeof src.cover === "object") { d.cover = {}; for (const [k, , most] of COVER) d.cover[k] = Math.round(num(src.cover[k], 0, most, 0)); }
    if (src.coverCol && typeof src.coverCol === "object") { d.coverCol = {}; for (const k of Object.keys(COVER_COL)) if (hex(src.coverCol[k])) d.coverCol[k] = hex(src.coverCol[k]); }
    if (FLIES[src.flies]) d.flies = src.flies;
    if (src.fliesCol !== undefined) d.fliesCol = hex(src.fliesCol) || "";
    if (Array.isArray(src.features)) d.features = src.features.filter(f => f && FTYPES[f.type]).slice(0, 12).map(f => {
        const o = { type: f.type, dir: Math.round(num(f.dir, 0, 359, 0)), dist: r3(num(f.dist, 0, f.type === "islet" ? 2.2 : f.type === "isle" ? 2.8 : 0.95, FDEF[f.type].dist || 0.5)) };
        if (f.r !== undefined) o.r = Math.round(num(f.r, 4, 90, FDEF[f.type].r || 20)); if (f.h !== undefined) o.h = Math.round(num(f.h, 0, 90, FDEF[f.type].h || 10));
        if (f.len !== undefined) o.len = Math.round(num(f.len, 10, 300, 60)); if (f.rot !== undefined) o.rot = Math.round(num(f.rot, -360, 360, 0));
        if (f.type === "bay") { o.width = r3(num(f.width, 0.08, 1.2, 0.35)); o.depth = r3(num(f.depth, 0.05, 0.6, 0.25)); }
        if (f.type === "crater" && f.lava) o.lava = true;
        if (f.type === "isle") o.bridge = f.bridge !== false;
        if (str(f.name, 30).trim()) o.name = str(f.name, 30).trim().toUpperCase();
        return o;
    });
    for (const k of ["campName", "rideLine1", "rideLine2", "ferryLine", "arrive"]) if (typeof src[k] === "string") d[k] = str(src[k], k === "campName" ? 24 : 200);
    if (src.ui && typeof src.ui === "object") { // the island's menu look: text always readable on its background
        const u = src.ui, ui = {};
        for (const k of ["accent", "panel", "ink"]) if (hex(u[k])) ui[k] = hex(u[k]);
        if (ui.panel && lum(ui.panel) > 0.06) ui.panel = shade(ui.panel, 0.05); // menus sit over the game: keep them dark
        if (ui.panel && ui.ink && contrast(ui.ink, ui.panel) < 7) ui.ink = "#f2ecff";
        if (ui.panel && ui.accent && contrast(ui.accent, ui.panel) < 4.5) ui.accent = shade(ui.accent, 0.62, true);
        if (T.ISLE_FONTS.includes(u.font)) ui.font = u.font;
        if (Number.isFinite(+u.corner)) ui.corner = Math.round(num(u.corner, 0, 28, 14));
        d.ui = ui;
    }
    if (src.casino && typeof src.casino === "object") d.casino = cleanCasino(src.casino);
}
const CASINO_SPEC = `{"name": "THE SOMETHING (2-4 words, its name)", "tagline": "a short sign line, like OPEN 24/7", "dir": 0-359 (which side of the island it stands on), "roofKind": "spire|dome|crown|flat", "wall": "#rrggbb", "base": "#rrggbb (the plinth)", "trim": "#rrggbb (bands round each tier)", "roof": "#rrggbb", "glow": "#rrggbb (lit windows)", "dim": "#rrggbb (dark windows)", "rock": "#rrggbb (the giant dice and stones round it)", "sign": "#rrggbb (bright neon)", "hall": {"walls": "#rrggbb (the wallpaper's colour inside)", "carpet": "#rrggbb (the carpet's colour)", "trim": "#rrggbb (the trim, usually a metal)", "light": "#rrggbb (the chandeliers' light)"}}`;
// ✦ Restyle with Claude (the Islands tab's casino section): a new look for the casino, from the island and anything you ask for. It stays where it stands
let casNote = null;
async function restyleCasino(d) {
    if (casNote && casNote.busy) return;
    const ask = ($("iCasAsk").value || "").trim().slice(0, 300), model = ($("iModel") && $("iModel").value) || pref("model") || "haiku";
    const show = (cls, text, busy) => { casNote = { d, cls, text, busy, ask }; const m = $("iCasMsg"), b = $("iCasClaude"); if (m && islands[islandSel] === d) { m.className = "stMsg" + (cls ? " " + cls : ""); m.textContent = text; } if (b) { b.disabled = !!busy; b.textContent = busy ? "Claude is restyling it…" : "✦ Restyle with Claude"; } };
    show("", `Asking ${model}…`, true);
    const prompt = `Re-skin the casino for an island in a spooky, cheerful low-poly tree-chopping game.
The island: "${d.name}"${d.sub ? `, "${d.sub}"` : ""}. Its colours: ${JSON.stringify(d.colors || {})}. Its menus: ${JSON.stringify(d.ui || {})}.${d.casino && d.casino.name ? ` The casino is called ${d.casino.name} now.` : ""}
${ask ? `What's wanted: "${ask}"` : "Make it belong to this island, and feel new."}
The casino is a stepped hexagonal tower: tiers with bands, lit and dark windows, a big neon CASINO sign, a banner over the door, giant dice and stones round it, and a roof. Inside is a hall with wallpaper, carpet, trim and chandeliers.
Return JSON: ${CASINO_SPEC}`;
    const r = await askQ({ prompt, system: "You design casinos for Hypergamous Tree Chopping Simulator 4, a spooky, cheerful first-person tree-chopping game. Reply with ONLY one JSON object: no prose, no code fences.", model });
    let j = null; if (r.ok) try { j = JSON.parse((r.text.match(/\{[\s\S]*\}/) || [""])[0]); } catch (e) { /* not JSON */ }
    if (!j) { show("bad", r.ok ? "Claude's answer wasn't a casino. Try again." : r.error, false); return; }
    const c = cleanCasino(j); delete c.dir; if (d.casino && d.casino.dir !== undefined) c.dir = d.casino.dir; // a new look, same place
    d.casino = c;
    show("good", `${c.name || "The casino"}: restyled by ${r.model} in ${(r.ms / 1000).toFixed(1)}s · ~${(r.tokens / 1000).toFixed(1)}k tokens.${T.casinoHome() === T.CI_BASE + islands.indexOf(d) ? " Press Go to it to see it." : ""}`, false);
    islandChanged(true, islands.indexOf(d));
}
// a casino look: colours, its name and sign line, the roof, which side it stands on, and tints for the hall inside (kept light, so the hall never goes dark)
function cleanCasino(c) {
    const hex = v => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : null), str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : ""), cs = {};
    for (const k of ["wall", "base", "trim", "roof", "glow", "dim", "rock", "sign"]) if (hex(c[k])) cs[k] = hex(c[k]);
    if (cs.sign && lum(cs.sign) < 0.3) cs.sign = shade(cs.sign, 0.35, true); // neon has to glow
    if (str(c.name, 26)) cs.name = str(c.name, 26).toUpperCase();
    const tl = str(c.tagline, 80); if (tl) cs.tagline = (tl.length <= 28 ? tl : tl.slice(0, 29).replace(/[\s,;:.!-]+\S*$/, "")).toUpperCase(); // cut at a word
    if (T.ROOF_KINDS.includes(c.roofKind)) cs.roofKind = c.roofKind;
    if (c.dir !== undefined && c.dir !== "" && Number.isFinite(+c.dir)) cs.dir = Math.round(((+c.dir % 360) + 360) % 360);
    if (c.hall && typeof c.hall === "object") {
        const h = {};
        for (const [k, low] of [["walls", 0], ["carpet", 0], ["trim", 0.2], ["light", 0.45]]) { const v = hex(c.hall[k]); if (v) h[k] = lum(v) < low ? shade(v, low, true) : v; } // wallpaper and carpet are made rich and dark in the game
        if (Object.keys(h).length) cs.hall = h;
    }
    return cs;
}
// colour helpers for the menu look: relative luminance, contrast ratio, and a colour pushed darker (or lighter) to a luminance
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function shade(h, target, up) { // mix toward black (or white) until the luminance reaches the target
    const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    for (let t = 0; t <= 1; t += 0.05) { const m = c.map(v => Math.round(up ? v + (255 - v) * t : v * (1 - t))), hx = "#" + m.map(v => v.toString(16).padStart(2, "0")).join(""); if (up ? lum(hx) >= target : lum(hx) <= target) return hx; }
    return up ? "#ffffff" : "#000000";
}
// ---- an island's architecture (its camp buildings), its menu look and its shops ----
const CAMP = { bed: ["Bed hut", "the hut where the player sleeps"], forge: ["The forge", "the forge where axes are made"], post: ["Trading post", "the trading post where materials are sold"], witch: ["Witch's hut", "the hut where potions are brewed"] };
const CAMP_SLOTS = { bedModel: "Bed", forge: "The forge", post: "Trading post", witch: "Witch's hut" }; // what the Islands tab lets you swap (a bed hut Claude built shows too, so it can be taken away)
const shopsOn = n => world.objects.filter(o => +o.isle === n && o.act && o.act.type === "shop");
function archRows(d, n) {
    const camp = d.camp || {}, ui = d.ui || {}, sh = shopsOn(n);
    const sel = (k, label) => `<div class="stRow"><label>${label}</label><select class="stSel" data-camp="${k}" style="max-width:170px">${opt("", camp[k] || "", "The usual")}${myProps.map(p => opt(p.key, camp[k], p.name)).join("")}</select></div>`;
    const col = (k, label, dflt) => `<label style="display:flex;align-items:center;gap:5px"><input class="stIn" type="color" data-ui="${k}" value="${ui[k] || dflt}"> ${label}</label>`;
    return `<div class="stH" id="iSecArch">ARCHITECTURE <small>the camp's own buildings</small></div>
      ${Object.entries(CAMP_SLOTS).map(([k, label]) => sel(k, label)).join("")}${camp.bed && !camp.bedModel ? sel("bed", "Bed hut") : ""}
      <div class="stHint">Any of your props can be one: build them in the Props tab, or let Ask Claude (with invent on) build them all in one style. Your bed takes the old bed's place, with no tent round it; the buildings stand just behind their spots, facing the fire.</div>
      <div class="stH">MENU LOOK <small>the game's menus while you're here</small></div>
      <div class="stChecks">${col("accent", "Titles", "#ffd040")}${col("panel", "Background", "#0e081c")}${col("ink", "Text", "#e8dcff")}</div>
      <div class="stRow"><label>Heading font</label><select class="stSel" id="iUiFont">${opt("", ui.font || "", "The usual")}${T.ISLE_FONTS.map(f => opt(f, ui.font, f)).join("")}</select></div>
      <div class="stRow"><label>Corners</label><span style="display:flex;align-items:center;gap:6px"><input type="range" id="iUiCorner" min="0" max="28" step="1" value="${ui.corner ?? 14}" style="width:120px"><small>${ui.corner ?? 14}px</small></span></div>
      <div class="stBtns"><button class="stB" id="iUiReset">The game's usual look</button></div>
      <div class="stHint">Play-test (F5) and open a menu or a shop to see it.${ui.accent || ui.panel || ui.ink ? "" : " Ask Claude picks one for each island it designs."}</div>
      ${casinoRows(d, n)}
      <div class="stH">SHOPS <small>${sh.length} on this island</small></div>
      <div class="stList">${sh.map(o => `<div class="stItem" data-shopgo="${o.id}"><span>🛒 ${esc(o.act.title || "A shop")}</span><small>${(o.act.items || []).length} things</small></div>`).join("") || `<div class="stHint">No shops yet.</div>`}</div>
      <div class="stBtns"><button class="stB go" id="iShopAdd">+ A shop by the camp</button></div>
      <div class="stHint">Click a shop to go to it and change what it sells. Ask Claude (with invent on) opens 1-2 shops with their own keepers and buildings.</div>`;
}
// the casino's look for this island: it stands on the newest island, so this look shows whenever this one is the newest
function casinoRows(d, n) {
    const c = d.casino || {}, h = c.hall || {}, home = T.casinoHome() === n, live = T.customIsle(n), C0 = live && live.built ? live : null;
    const col = (k, label, v, dflt, hall) => `<label style="display:flex;align-items:center;gap:5px"><input class="stIn" type="color" ${hall ? "data-chall" : "data-cas"}="${k}" value="${v || dflt}"> ${label}</label>`;
    const dir = c.dir ?? 215;
    return `<div class="stH" id="iSecCasino">THE CASINO <small>${home ? "stands here: this is your newest island" : `stands on your newest island (Rebirth ${T.casinoHome() - 1})`}</small></div>
      <div class="stRow"><label>Name</label><input class="stIn" type="text" id="iCasName" value="${esc(c.name || "")}" placeholder="THE CASINO"></div>
      <div class="stRow"><label>Sign line</label><input class="stIn" type="text" id="iCasTag" value="${esc(c.tagline || "")}" placeholder="OPEN 24/7"></div>
      <div class="stRow"><label>Roof</label><select class="stSel" id="iCasRoof">${T.ROOF_KINDS.map(k => opt(k, c.roofKind || "spire", { spire: "A spire", dome: "A dome", crown: "A crown of points", flat: "Flat, with battlements" }[k])).join("")}</select></div>
      <div class="stRow"><label>Stands</label><span style="display:flex;align-items:center;gap:6px"><input type="range" id="iCasDir" min="0" max="359" step="1" value="${dir}" style="width:120px"><small>${dir}°</small></span></div>
      <div class="stHint" style="margin-top:0">Outside${c.wall || c.trim || c.sign ? "" : " (until you pick, it takes the island's own colours)"}:</div>
      <div class="stChecks">${col("wall", "Walls", c.wall, "#c8b898")}${col("base", "Base", c.base, "#4a4038")}${col("trim", "Bands", c.trim, "#d8a840")}${col("roof", "Roof", c.roof, "#3a3028")}${col("glow", "Lit windows", c.glow, "#ffd060")}${col("dim", "Dark windows", c.dim, "#3a2a10")}${col("rock", "Dice & stones", c.rock, "#6a6a74")}${col("sign", "Neon", c.sign, "#ffd060")}</div>
      <div class="stHint">The hall inside:</div>
      <div class="stChecks">${col("walls", "Wallpaper", h.walls, "#c42f4a", 1)}${col("carpet", "Carpet", h.carpet, "#d71d39", 1)}${col("trim", "Gold trim", h.trim, "#d8a840", 1)}${col("light", "Chandeliers", h.light, "#ffd8a0", 1)}</div>
      <div class="stBtns"><button class="stB" id="iCasGo"${home ? "" : " disabled"}>Go to it</button><button class="stB" id="iCasIn"${home ? "" : " disabled"}>Walk inside</button><button class="stB" id="iCasReset">The island's colours</button></div>
      <div class="stClaude" style="margin-top:8px"><textarea class="stTa" id="iCasAsk" rows="2" placeholder="Describe it, e.g. a haunted ship's-wheel casino with rotting gold, or leave this empty to match the island">${esc(casNote && casNote.d === d ? casNote.ask || "" : "")}</textarea>
        <div class="stBtns"><button class="stB" id="iCasClaude" style="flex:1"${casNote && casNote.busy ? " disabled" : ""}>${casNote && casNote.busy ? "Claude is restyling it…" : "✦ Restyle with Claude"}</button></div><div class="stMsg${casNote && casNote.d === d && casNote.cls ? " " + casNote.cls : ""}" id="iCasMsg">${casNote && casNote.d === d ? esc(casNote.text) : ""}</div></div>
      <div class="stHint">Ask Claude designs a casino for every island it makes, and Restyle gives it a new look any time (it uses the model picked in Ask Claude above). ${C0 && home && !C0.CAS ? "There's no flat spot for it on this side: try another direction." : ""}</div>`;
}
// somewhere near the camp to stand: clear of the camp's buildings, facing the fire
function campSpot(n) {
    const C = T.customIsle(n); if (!C) return null;
    const spots = [C.SMITH, C.DEPOT, C.WITCH, C.BED, { x: 0, z: -3 }];
    for (let k = 0; k < 30; k++) {
        const a = Math.random() * 6.283, d = 13 + Math.random() * 9, x = r3(Math.cos(a) * d), z = r3(Math.sin(a) * d);
        if (spots.some(s => s && Math.hypot(x - s.x, z - s.z) < 5) || world.objects.some(o => +o.isle === n && Math.hypot(x - o.x, z - o.z) < 2.5) || !C.treeOk(x, z)) continue;
        return { x, z, y: r3(C.groundY(x, z)), ry: r3(Math.atan2(-x, -z)) };
    }
    return null;
}
function featRows(d) {
    const rng = (fi, k, label, v, min, max, step, unit = "") => `<div class="stRow"><label>${label}</label><span style="display:flex;align-items:center;gap:6px"><input type="range" data-fi="${fi}" data-fk="${k}" min="${min}" max="${max}" step="${step}" value="${v}" style="width:110px"><small style="width:38px;text-align:right">${v}${unit}</small></span></div>`;
    return (d.features || []).map((f, i) => {
        const D = FDEF[f.type] || {}, open = i === featOpen;
        let h = `<div class="stItem${open ? " on" : ""}" data-fopen="${i}"><span>${esc(FTYPES[f.type] || f.type)}${f.name ? " · " + esc(f.name) : ""}</span><span><small>${Math.round(f.dir || 0)}°</small> <button class="stB" data-fdel="${i}" style="padding:1px 6px">✕</button></span></div>`;
        if (!open) return h;
        h += `<div style="padding:6px 4px 10px 8px;border-left:2px solid #ffd04055;margin:2px 0 6px">`;
        if (f.type !== "bay") h += rng(i, "dir", "Direction", Math.round(f.dir || 0), 0, 359, 1, "°") + rng(i, "dist", f.type === "islet" || f.type === "isle" ? "Out at sea" : "Distance out", f.dist ?? D.dist ?? 0.5, f.type === "islet" ? 1.05 : f.type === "isle" ? 1.2 : 0, f.type === "islet" ? 2.2 : f.type === "isle" ? 2.8 : 0.95, 0.01);
        else h += rng(i, "dir", "Direction", Math.round(f.dir || 0), 0, 359, 1, "°") + rng(i, "width", "Width", f.width ?? D.width, 0.08, 1.2, 0.01) + rng(i, "depth", "Depth", f.depth ?? D.depth, 0.05, 0.6, 0.01);
        if (["mountain", "hill", "spire", "crater", "plateau", "lake", "islet", "isle"].includes(f.type)) h += rng(i, "r", "Size", f.r ?? D.r, 4, 90, 1, "m");
        if (["mountain", "hill", "spire", "crater", "plateau", "ridge", "islet", "isle"].includes(f.type)) h += rng(i, "h", "Height", f.h ?? D.h, 0, 90, 1, "m");
        if (f.type === "ridge" || f.type === "valley") h += rng(i, "r", "Width", f.r ?? D.r, 4, 40, 1, "m") + rng(i, "len", "Length", f.len ?? D.len, 10, 300, 5, "m") + rng(i, "rot", "Angle", Math.round(f.rot ?? ((f.dir || 0) + 90)), -180, 180, 1, "°");
        if (f.type === "isle") h += `<div class="stChecks"><label><input type="checkbox" data-fi="${i}" data-fk="bridge"${f.bridge !== false ? " checked" : ""}> A bridge to it from the main island</label></div>`;
        if (f.type === "crater") h += `<div class="stChecks"><label><input type="checkbox" data-fi="${i}" data-fk="lava"${f.lava ? " checked" : ""}> Full of lava</label></div>`;
        if (!["hill", "valley", "bay"].includes(f.type)) h += `<div class="stRow"><label>Name</label><input class="stIn" type="text" data-fi="${i}" data-fk="name" value="${esc(f.name || "")}" placeholder="none"></div>`;
        return h + `</div>`;
    }).join("");
}
const ISLE_JUMPS = [["iSecLand", "Shape"], ["iSecSculpt", "Sculpt"], ["iSecFeat", "Features"], ["iSecEco", "Ecosystem"], ["iSecEcon", "Materials & axes"], ["iSecStory", "Story"]];
function renderIslands() {
    const rng = (id, label, v, min, max, step, unit = "") => `<div class="stRow"><label>${label}</label><span style="display:flex;align-items:center;gap:6px"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}" style="width:120px"><small id="${id}V" style="width:38px;text-align:right">${v}${unit}</small></span></div>`;
    const live = T.customIsle(T.CI_BASE + islandSel); // colours you haven't picked show the ones the game is using
    const colr = (k, label) => `<label style="display:flex;align-items:center;gap:5px"><input class="stIn" type="color" data-colr="${k}" value="${(islands[islandSel] && islands[islandSel].colors && islands[islandSel].colors[k]) || (live ? hexOf(live.cols[k]) : "#808080")}"> ${label}</label>`;
    const Th = THEMES(), scroll = $("stLeftBody").scrollTop;
    let h = `<div class="stH">THE REBIRTH CHAIN</div><div class="stHint" style="margin-top:0">Pine Island → Highland → Mooncap → Ashfall → Archipelago → <b>the Iceberg</b> → your islands:</div>
      <div class="stList">${islands.map((d, i) => `<div class="stItem${i === islandSel ? " on" : ""}" data-isl="${i}"><span>Rebirth ${T.CI_BASE + i - 1} · ${esc(d.name)}</span><small>${(d.rebirth && d.rebirth.cost ? "$" + Math.round(d.rebirth.cost / 1e6) + "M" : "")}</small></div>`).join("") || `<div class="stHint">No islands yet. Make one: it becomes Rebirth 6, sailing from the Iceberg.</div>`}</div>
      <div class="stBtns"><select class="stSel" id="iNewTheme" style="flex:1">${Object.entries(Th).map(([k, t]) => `<option value="${esc(k)}">${esc(t.label)}</option>`).join("")}</select><button class="stB go" id="iNew">+ New island</button></div>`;
    const d = islands[islandSel];
    if (!d) { $("stLeftBody").innerHTML = h; bindIslands(); return; }
    migrateIsland(d);
    const n = T.CI_BASE + islandSel, pm = prevMats(n), item = Object.entries(d.rebirth && d.rebirth.items || {})[0] || ["", 0], model = pref("model") || "haiku", C = T.customIsle(n);
    // ----- trees -----
    const tl = isleTreeList(d, n), w = d.treeW || {}, nowOk = tl.filter(x => (T.TYPES[x.k].minTier || 0) === 0);
    const treeRow = x => { const B = T.TYPES[x.k], tier = d.allTiers ? 0 : B.minTier || 0, wv = w[x.k] ?? 1; return `<div class="stItem"><span style="min-width:0;line-height:1.25"><span style="color:${esc(B.col)}">●</span> ${esc(B.name)}${x.own || tier ? `<br><small>${x.own ? `<span style="color:#9fe8ff">yours</span>` : ""}${x.own && tier ? " · " : ""}${tier ? `<span style="color:#ffb060" title="Players see it once they own this axe">needs the ${esc(axeName(tier))}</span>` : ""}</small>` : ""}</span><span style="display:flex;align-items:center;gap:4px;flex:none"><input type="range" data-tw="${esc(x.k)}" min="0" max="3" step="0.1" value="${wv}" style="width:62px" title="How common"><small style="width:28px">${wv}×</small><button class="stB" data-trm="${esc(x.k)}" style="padding:1px 6px">✕</button></span></div>`; };
    const onIsle = new Set(tl.map(x => x.k)), byHome = {};
    for (const [k, t] of Object.entries(T.TYPES)) { if (t.rush || t.custom || onIsle.has(k)) continue; const home = (t.isl || [1]).filter(i => i <= 6)[0] || 1; (byHome[home] = byHome[home] || []).push([k, t.name]); }
    const mine = trees.filter(t => !onIsle.has(t.key));
    const treeAdd = `<select class="stSel" id="iTreeAdd" style="flex:1"><option value="">+ Add a tree…</option>${mine.length ? `<optgroup label="Your trees">${mine.map(t => `<option value="${esc(t.key)}">${esc(t.name)}${(t.isl || []).length ? "" : " (unused)"}</option>`).join("")}</optgroup>` : ""}${Object.entries(byHome).map(([home, list]) => `<optgroup label="From ${esc(isleName(+home))}">${list.map(([k, nm]) => `<option value="${k}">${esc(nm)}</option>`).join("")}</optgroup>`).join("")}</select>`;
    // ----- animals -----
    const an = (d.animals || []).filter(a => T.WILD_KINDS[a.kind]), anSet = new Set(an.map(a => a.kind)), anHome = {};
    for (const [k, W] of Object.entries(T.WILD_KINDS)) if (!anSet.has(k)) (anHome[W.custom ? 0 : W.home] = anHome[W.custom ? 0 : W.home] || []).push([k, W.name]);
    const animalAdd = `<select class="stSel" id="iAnAdd" style="flex:1"><option value="">+ Add animals…</option>${Object.entries(anHome).sort((a, b) => a[0] - b[0]).map(([home, list]) => `<optgroup label="${+home ? "From " + esc(isleName(+home)) : "Your animals"}">${list.map(([k, nm]) => `<option value="${esc(k)}">${esc(nm)}</option>`).join("")}</optgroup>`).join("")}</select>`;
    const cover = d.cover || {}, ccol = d.coverCol || {};
    // ----- materials and axes -----
    const mats = d.mats || [], axes = d.axes || [], econMats = T.MATS_BY_ISLE[d.economy || 6] || [];
    const recipeTxt = i => { const rc = T.RECIPES[n] && T.RECIPES[n][0][i]; return rc ? Object.entries(rc).map(([k, v]) => `${v} ${esc(T.MATS[k] ? T.MATS[k].name : k)}`).join(" + ") : ""; };
    h += `<div class="stBtns" style="margin-top:10px"><button class="stB" id="iGo">Go there</button><button class="stB go" id="iTest">▶ Test the rebirth</button>${islandSel === islands.length - 1 ? `<button class="stB warn" id="iDelIsl">Delete</button>` : ""}</div>
      <div class="stClaude" style="margin-top:10px"><div class="stH">✦ ASK CLAUDE <select class="stSel" id="iModel">${opt("haiku", model, "Haiku (cheapest)")}${opt("sonnet", model, "Sonnet")}${opt("opus", model, "Opus")}</select></div>
        <textarea class="stTa" id="iAsk" placeholder="Describe an island, e.g. a cursed swamp with three sunken towers, a lava crater and fog"></textarea>
        <div class="stChecks"><label title="About 15-25 more short requests, three at a time: roughly 2-4k tokens each on Haiku"><input type="checkbox" id="iInvent"${pref("invent") !== "0" ? " checked" : ""}> Invent everything: its architecture, shops and keepers, models, trees, animals and people</label></div>
        <div class="stBtns"><button class="stB" id="iAskGo" style="flex:1"${askBusy === d ? " disabled" : ""}>${askBusy === d ? "Claude is shaping it…" : "Design it with Claude"}</button></div><div class="stMsg${askNote && askNote.d === d && askNote.cls ? " " + askNote.cls : ""}" id="iAskMsg">${askNote && askNote.d === d ? esc(askNote.text) : ""}</div>
        <div class="stHint" style="margin:4px 0 0">Claude picks the land, colours, trees, animals, ground cover, the island's own materials and axes, its menu look and the story. With invent on it also builds the camp in the island's own architecture, opens shops with their own keepers, and makes models, landmarks and people. The ticket stays yours.</div></div>
      <div class="stBtns" style="margin:8px 0 0">${ISLE_JUMPS.map(([id, l]) => `<button class="stB" data-jump="${id}" style="padding:3px 7px;font-size:11px">${l}</button>`).join("")}</div>
      <div class="stH">NAME <small>island ${n} · Rebirth ${n - 1}</small></div>
      <div class="stRow"><input class="stIn" type="text" id="iName" value="${esc(d.name)}" style="flex:1"></div>
      <div class="stRow"><input class="stIn" type="text" id="iSub" value="${esc(d.sub || "")}" placeholder="a short line for the ferry ticket" style="flex:1"></div>
      <div class="stH">THEME <small>colours, trees, land and wildlife in one click</small></div>
      <div class="stBtns" style="margin:0">${Object.entries(Th).map(([k, t]) => `<button class="stB${d.theme === k ? " on" : ""}" data-theme="${esc(k)}" style="padding:4px 8px;font-size:11px">${esc(t.label)}${k.startsWith("my:") ? ` <span data-deltheme="${esc(k.slice(3))}" title="Delete this theme">✕</span>` : ""}</button>`).join("")}</div>
      <div class="stRow" style="margin-top:6px"><input class="stIn" type="text" id="iThemeName" placeholder="name this look as a theme…" style="flex:1"><button class="stB" id="iThemeSave">Save as theme</button></div>
      <div class="stH" id="iSecLand">SHAPE</div>${rng("iRad", "Size", d.radius || 130, 70, 220, 5, "m")}${rng("iWob", "Wobbly coast", d.wobble ?? 0.12, 0, 0.35, 0.01)}
      <div class="stRow"><label>Seed</label><span><input class="stIn" type="number" id="iSeed" value="${d.seed}" step="0.1"> <button class="stB" id="iDice">🎲</button></span></div>
      <div class="stRow"><label>Outline</label><select class="stSel" id="iShapeK">${[["round", "Round"], ["long", "Long"], ["lobed", "Lobed (clover)"]].map(([k, l]) => opt(k, (d.shape || {}).kind || "round", l)).join("")}</select></div>
      ${(d.shape || {}).kind === "long" ? rng("iShapeS", "Stretch", d.shape.stretch ?? 1.6, 1, 2.4, 0.05) : ""}${(d.shape || {}).kind === "lobed" ? rng("iShapeL", "Lobes", d.shape.lobes ?? 3, 2, 7, 1) + rng("iShapeA", "How deep", d.shape.amount ?? 0.3, 0, 0.45, 0.01) : ""}${(d.shape || {}).kind && d.shape.kind !== "round" ? rng("iShapeAng", "Turned", d.shape.angle ?? 0, 0, 359, 1, "°") : ""}
      <div class="stHint">Add walkable islands joined by bridges under <b>Features</b> (🏝 Walkable island + bridge).</div>
      <div class="stH">LAND</div>${rng("iPlat", "Camp height", d.plateau ?? 2.5, 0.6, 14, 0.1, "m")}${rng("iHills", "Hills", d.hills ?? 8, 0, 40, 1)}${rng("iHillS", "Hill size", d.hillSize || 1, 0.3, 3, 0.1)}${rng("iBeach", "Beach width", d.beach ?? 6, 2, 24, 1, "m")}${rng("iCliff", "Sea cliffs", d.cliffs || 0, 0, 1, 0.05)}${rng("iDecor", "Rocks and bushes", d.decor ?? 1, 0, 3, 0.1)}
      <div class="stH" id="iSecSculpt">SCULPT THE GROUND <small>${(d.sculpt || []).length} brush dabs</small></div>
      ${curIsle() === n ? `<div class="stBtns" style="margin:0">${[["", "Off"], ["raise", "⬆ Raise"], ["lower", "⬇ Lower"], ["flat", "▬ Flatten"], ["erase", "⌫ Erase"]].map(([k, l]) => `<button class="stB${sculpt.mode === k ? " on" : ""}" data-sculpt="${k}" style="padding:4px 7px;font-size:11px">${l}</button>`).join("")}</div>
        <div class="stRow"><label>Brush size</label><span style="display:flex;align-items:center;gap:6px"><input type="range" id="iBrushR" min="2" max="30" step="1" value="${sculpt.r}" style="width:120px"><small style="width:38px;text-align:right">${sculpt.r}m</small></span></div>
        <div class="stRow"><label>Strength</label><span style="display:flex;align-items:center;gap:6px"><input type="range" id="iBrushK" min="0.1" max="3" step="0.1" value="${sculpt.k}" style="width:120px"><small style="width:38px;text-align:right">${sculpt.k}</small></span></div>
        <div class="stBtns"><button class="stB" id="iSculptUndo">↶ Undo last stroke</button><button class="stB warn" id="iSculptClear">Clear all</button></div>
        <div class="stHint">Pick a brush, then hold the left mouse button on the ground and paint. Flatten levels everything to the height where you start. Right-drag still looks around.</div>`
        : `<div class="stHint" style="margin-top:0">Press <b>Go there</b>, then paint the ground with a brush.</div>`}
      <div class="stH" id="iSecFeat">FEATURES <small>${(d.features || []).length} · click one to edit</small></div>
      <div class="stList" id="iFeats">${featRows(d) || `<div class="stHint">No features: a plain island.</div>`}</div>
      <div class="stBtns"><select class="stSel" id="iFeatType" style="flex:1">${Object.entries(FTYPES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select><button class="stB" id="iFeatAdd">+ Add</button></div>
      <div class="stH">COLOURS</div><div class="stChecks">${colr("grass", "Grass")}${colr("grass2", "Grass 2")}${colr("sand", "Sand")}${colr("rock", "Cliffs")}${colr("snow", "Peaks")}${colr("camp", "Camp")}${colr("bush", "Bushes")}${colr("shallow", "Shallows")}${colr("deep", "Deep sea")}</div>
      <div class="stRow"><label>Peaks colour above</label><input class="stIn" type="number" id="iSnowline" value="${d.snowline === "" || d.snowline === undefined ? "" : d.snowline}" placeholder="never" step="1"></div>
      <div class="stH" id="iSecEco">ECOSYSTEM: TREES <small>${tl.length} kinds · slider = how common</small></div>
      <div class="stList">${tl.map(treeRow).join("") || `<div class="stHint">No trees yet: add some below.</div>`}</div>
      <div class="stBtns">${treeAdd}</div>
      <div class="stChecks"><label title="Normally a tree marked with an axe only grows once players own that axe. After a rebirth they start with the Rusty Axe."><input type="checkbox" id="iAllTiers"${d.allTiers ? " checked" : ""}> Every tree grows from the start (ignore the axe each one needs)</label></div>
      ${tl.length && !nowOk.length && !d.allTiers ? `<div class="stMsg bad" style="margin:4px 0">Nothing here grows until players upgrade their axe: every tree needs a better axe than the Rusty Axe they arrive with. Tick the box above, or set a tree to "Rusty Axe" in the Trees tab.</div>` : ""}
      ${rng("iTreeN", "How many", d.treeCount || 90, 10, 220, 5)}
      <div class="stBtns"><button class="stB" id="iRegrow">🌲 Regrow the forest now</button></div>
      <div class="stHint">Make your own trees in the Trees tab, then add them here. The Studio shows every tree an island can grow; players see the ones marked with an axe once they own it.</div>
      <div class="stH">ECOSYSTEM: ANIMALS <small>${an.reduce((s, a) => s + a.n, 0)} in all · they never attack</small></div>
      <div class="stList">${an.map(a => `<div class="stItem"><span>${esc(T.WILD_KINDS[a.kind].name)}${T.WILD_KINDS[a.kind].custom ? ` <small style="color:#9fe8ff">yours</small>` : ""}</span><span style="display:flex;align-items:center;gap:4px"><input type="range" data-an="${esc(a.kind)}" min="1" max="30" step="1" value="${a.n}" style="width:80px"><small style="width:20px">${a.n}</small><button class="stB" data-anrm="${esc(a.kind)}" style="padding:1px 6px">✕</button></span></div>`).join("") || `<div class="stHint">No animals yet.</div>`}</div>
      <div class="stBtns">${animalAdd}</div>
      ${BUILTIN_THEMES[d.theme] ? `<div class="stBtns"><button class="stB" id="iEcoFill">Use the ${esc(BUILTIN_THEMES[d.theme].label.toLowerCase())} wildlife and ground cover</button></div>` : ""}
      <div class="stHint">Make new animals in the Animals tab.</div>
      <div class="stH">ECOSYSTEM: GROUND COVER</div>
      ${COVER.map(([k, label, most, ck]) => `<div class="stRow"><label>${label}</label><span style="display:flex;align-items:center;gap:6px">${ck ? `<input class="stIn" type="color" data-ccol="${ck}" value="${ccol[ck] || COVER_COL[ck]}" style="width:26px;height:22px">` : ""}<input type="range" data-cov="${k}" min="0" max="${most}" step="1" value="${cover[k] || 0}" style="width:96px"><small style="width:26px;text-align:right">${cover[k] || 0}</small></span></div>`).join("")}
      <div class="stRow"><label>In the air</label><span style="display:flex;gap:6px"><select class="stSel" id="iFlies">${Object.entries(FLIES).map(([k, l]) => opt(k, d.flies || "fireflies", l)).join("")}</select><input class="stIn" type="color" id="iFliesCol" value="${d.fliesCol || "#d8ff6a"}" title="Their colour"></span></div>
      <div class="stH" id="iSecEcon">MATERIALS <small>${mats.length ? "this island's own · cheapest first" : "borrowed"}</small></div>
      ${mats.length ? `<div class="stList">${mats.map((m, i) => `<div class="stItem"><span style="display:flex;align-items:center;gap:5px;min-width:0"><input class="stIn" type="color" data-mcol="${i}" value="${m.color || "#9a9aa4"}" style="width:26px;height:22px"><input class="stIn" type="text" data-mname="${i}" value="${esc(m.name)}" style="width:116px"><label title="Glows"><input type="checkbox" data-mglow="${i}"${m.glow ? " checked" : ""}>✦</label></span><span style="display:flex;align-items:center;gap:3px"><small>$${T.MATS[m.key] ? T.MATS[m.key].price : "?"}</small><button class="stB" data-mup="${i}" style="padding:1px 5px" title="Make it commoner">↑</button><button class="stB" data-mdel="${i}" style="padding:1px 6px">✕</button></span></div>`).join("")}</div>
        <div class="stBtns"><button class="stB" id="iMatAdd">+ Material</button><button class="stB warn" id="iMatOff">Borrow instead</button></div>
        <div class="stHint">Every tree here drops these (common trees the first ones, rare trees the last). The forge, the witch and the trading post use them too. Prices follow ${esc(ECON[d.economy || 6])}.</div>`
        : `<div class="stHint" style="margin-top:0">Trees here drop ${esc(ECON[d.economy || 6])}'s materials: ${econMats.map(k => esc(T.MATS[k].name)).join(", ")}.</div><div class="stBtns"><button class="stB go" id="iMatOwn">+ Give it its own materials</button></div>`}
      <div class="stRow"><label>Recipes and prices like</label><select class="stSel" id="iEcon" style="max-width:150px">${Object.entries(ECON).map(([k, l]) => opt(k, d.economy || 6, l)).join("")}</select></div>
      <div class="stHint">Trees here are ${Math.round(Math.pow(1.3, n - 6) * 45) / 10}× as tough as on Pine Island, and pay as much more.</div>
      <div class="stH">AXES <small>forged at this island's forge · strongest last</small></div>
      <div class="stList">${axes.map((a, j) => { const idx = C && C.axeIdx ? C.axeIdx[j] : -1, A = T.AXES[idx]; return `<div style="border:1px solid #3a2c55;border-radius:8px;padding:6px;margin-bottom:6px">
        <div class="stRow" style="margin:0 0 4px"><input class="stIn" type="text" data-xname="${j}" value="${esc(a.name)}" style="flex:1"><button class="stB" data-xdel="${j}" style="padding:1px 6px;margin-left:4px">✕</button></div>
        <div class="stRow" style="margin:0 0 4px"><label>Head · edge · glow</label><span><input class="stIn" type="color" data-xcol="${j}:steel" value="${a.steel || "#4a4a5a"}" style="width:26px;height:22px"><input class="stIn" type="color" data-xcol="${j}:edge" value="${a.edge || "#e8f0ff"}" style="width:26px;height:22px"><input class="stIn" type="color" data-xcol="${j}:glow" value="${a.glow || "#2a2a4a"}" style="width:26px;height:22px"></span></div>
        <div class="stRow" style="margin:0 0 4px"><label>Special move [Z]</label><select class="stSel" data-xab="${j}" style="max-width:150px">${T.ABIL.slice(0, T.BASE_AXES).map((b, i) => opt(i, a.ability ?? 14 + (j % 4), b.name)).join("")}</select></div>
        <div class="stRow" style="margin:0 0 4px"><label>Damage</label><input class="stIn" type="number" data-xdmg="${j}" value="${a.dmg || ""}" placeholder="${A ? A.dmg : "auto"}" step="100"></div>
        <div class="stHint" style="margin:0">${A ? `Costs ${recipeTxt(idx)}` : "Working out its recipe…"}</div></div>`; }).join("") || `<div class="stHint">No axes of its own: the forge sells ${esc(ECON[d.economy || 6])}'s.</div>`}</div>
      <div class="stBtns">${axes.length < 4 ? `<button class="stB" id="iAxeAdd">+ Axe</button>` : ""}</div>
      <div class="stHint">The island's own axes come after the forge's usual ones and cost its rarest materials. Leave damage empty to have it worked out.</div>
      ${archRows(d, n)}
      <div class="stH">THE TICKET <small>from ${esc(isleName(n - 1))}</small></div>
      <div class="stRow"><label>Cash</label><input class="stIn" type="number" id="iCost" value="${d.rebirth && d.rebirth.cost !== undefined ? d.rebirth.cost : 25000000}" step="1000000" style="width:120px"></div>
      <div class="stRow"><label>Bring</label><span><input class="stIn" type="number" id="iItemN" value="${item[1] || 0}" min="0" step="1" style="width:56px"> <select class="stSel" id="iItem" style="max-width:120px">${opt("", item[0], "nothing")}${pm.map(k => opt(k, item[0], T.MATS[k] ? T.MATS[k].name : k)).join("")}</select></span></div>
      <div class="stH" id="iSecStory">STORY</div>
      <div class="stRow"><label>Camp name</label><input class="stIn" type="text" id="iCamp" value="${esc(d.campName || "CAMP")}"></div>
      <div class="stHint">The ferry ride (two lines):</div><input class="stIn" type="text" id="iRide1" value="${esc(d.rideLine1 || "")}" style="width:100%;margin-bottom:4px"><input class="stIn" type="text" id="iRide2" value="${esc(d.rideLine2 || "")}" placeholder="${esc(d.name)} rises out of the sea." style="width:100%">
      <div class="stHint">The Ferryman, before you sail:</div><input class="stIn" type="text" id="iFerryLine" value="${esc(d.ferryLine || "")}" placeholder="Next stop: ${esc(d.name)}. Hold on tight." style="width:100%">
      <div class="stHint">When you arrive:</div><input class="stIn" type="text" id="iArrive" value="${esc(d.arrive || "")}" placeholder="Welcome to ${esc(d.name)}…" style="width:100%">
      <div class="stH">DOCKS</div>${rng("iArrDir", "Arrivals face", d.arrDir ?? 125, -180, 180, 1, "°")}${rng("iNextDir", "Ferry onwards faces", d.nextDir ?? -35, -180, 180, 1, "°")}
      <div class="stHint">Changes rebuild the island live. Go there to watch. Saved islands are in <b>content/islands.js</b> and ship on your next release.</div>`;
    $("stLeftBody").innerHTML = h;
    $("stLeftBody").scrollTop = scroll;
    bindIslands();
}
function bindIslands() {
    const body = $("stLeftBody"), on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); }, all = (q, ev, fn) => body.querySelectorAll(q).forEach(e => e.addEventListener(ev, () => fn(e)));
    all("[data-isl]", "click", it => { islandSel = +it.dataset.isl; featOpen = -1; body.scrollTop = 0; renderIslands(); });
    on("iNew", "click", () => newIsland($("iNewTheme").value));
    const d = islands[islandSel]; if (!d) return;
    const n = T.CI_BASE + islandSel;
    all("[data-jump]", "click", b => { const t = $(b.dataset.jump); if (t) body.scrollTop = t.offsetTop - 8; });
    on("iGo", "click", () => goIsle(String(n)));
    on("iTest", "click", () => { rebuildNow(islandSel); testRebirth(islandSel); });
    on("iAskGo", "click", () => askClaudeIsland(d));
    // architecture, menu look and shops
    all("[data-camp]", "change", s => { d.camp = { ...(d.camp || {}) }; if (s.value) d.camp[s.dataset.camp] = s.value; else delete d.camp[s.dataset.camp]; islandChanged(false); });
    const setUi = (k, v) => { d.ui = { ...(d.ui || {}) }; if (v === "" || v === undefined) delete d.ui[k]; else d.ui[k] = v; islandChanged(false); };
    all("[data-ui]", "input", c => setUi(c.dataset.ui, c.value));
    on("iUiFont", "change", e => setUi("font", e.target.value));
    on("iUiCorner", "input", e => { e.target.nextElementSibling.textContent = e.target.value + "px"; setUi("corner", +e.target.value); });
    on("iUiReset", "click", () => { delete d.ui; islandChanged(true); });
    // the casino's look
    const setCas = (fn, rerender) => { d.casino = JSON.parse(JSON.stringify(d.casino || {})); fn(d.casino); islandChanged(rerender); };
    on("iCasName", "change", e => setCas(c => { const v = e.target.value.trim().slice(0, 26).toUpperCase(); if (v) c.name = v; else delete c.name; }));
    on("iCasTag", "change", e => setCas(c => { const v = e.target.value.trim().slice(0, 28).toUpperCase(); if (v) c.tagline = v; else delete c.tagline; }));
    on("iCasRoof", "change", e => setCas(c => (c.roofKind = e.target.value)));
    on("iCasDir", "input", e => { e.target.nextElementSibling.textContent = e.target.value + "°"; setCas(c => (c.dir = +e.target.value)); });
    all("[data-cas]", "input", el => setCas(c => (c[el.dataset.cas] = el.value)));
    all("[data-chall]", "input", el => setCas(c => { c.hall = c.hall || {}; c.hall[el.dataset.chall] = el.value; }));
    on("iCasClaude", "click", () => restyleCasino(d));
    on("iCasReset", "click", () => setCas(c => { for (const k of ["wall", "base", "trim", "roof", "glow", "dim", "rock", "sign", "hall"]) delete c[k]; }, true));
    const toCasino = () => { const C = T.customIsle(n); if (!C || !C.CAS) { say("It's still being built: try again in a moment"); return null; } return C.CAS; };
    on("iCasGo", "click", () => {
        if (curIsle() !== n) goIsle(String(n));
        setTimeout(() => { const p = toCasino(); if (!p) return; const len = Math.hypot(p.x, p.z) || 1, gy = T.groundY(p.x, p.z); cam.pos.set(p.x - (p.x / len) * 42, gy + 16, p.z - (p.z / len) * 42); lookAtPoint(new THREE.Vector3(p.x, gy + 12, p.z)); }, 600);
    });
    on("iCasIn", "click", () => {
        if (curIsle() !== n) goIsle(String(n));
        setTimeout(() => { if (!toCasino() || !T.getCasino()) return; play(); setTimeout(() => T.enterCasino(), 300); say("Inside the casino (F5 to stop)", 3500); }, 600);
    });
    all("[data-shopgo]", "click", it => { const o = world.objects.find(q => q.id === it.dataset.shopgo); if (!o) return; if (curIsle() !== n) goIsle(String(n)); select(o); focusSel(); });
    on("iShopAdd", "click", () => {
        if (curIsle() !== n) goIsle(String(n));
        const s = campSpot(n); if (!s) { say("No room by the camp: place one from the Place tab instead"); return; }
        const o = { id: newId(), isle: n, ...JSON.parse(JSON.stringify(TEMPLATES.shop)), x: s.x, y: s.y, z: s.z, rx: 0, ry: s.ry, rz: 0, s: 1 };
        world.objects.push(o); T.placedBuild(o); changed("world"); select(o); focusSel(); renderIslands();
    });
    on("iDelIsl", "click", () => {
        if (curIsle() === n) { say("Go to another island first"); return; }
        if (!confirm(`Delete ${d.name}? It stops being Rebirth ${n - 1}, and everything you placed on it goes too.`)) return;
        if (!T.ciDropLast()) { say("Couldn't delete it"); return; }
        for (const m of d.mats || []) dropMatEverywhere(m.key); // nothing may drop its materials any more
        islands.pop();
        for (const o of world.objects.filter(q => +q.isle === n)) { T.placedRemove(o); world.objects.splice(world.objects.indexOf(o), 1); }
        for (const t of trees) if ((t.isl || []).includes(n)) setTreeOnIsle(t, n, false);
        islandSel = Math.max(0, islands.length - 1);
        if (islands.length) T.ciSet(islands.length - 1, islands[islands.length - 1]);
        changed("islands"); changed("world"); renderIsleSelect(); renderIslands();
    });
    const txt = (id, fn) => on(id, "input", e => { fn(e.target.value); islandChanged(); });
    txt("iName", v => (d.name = v.slice(0, 40) || "Island")); on("iName", "change", () => renderIslands());
    txt("iSub", v => (d.sub = v.slice(0, 80)));
    body.querySelectorAll("[data-theme]").forEach(b => b.addEventListener("click", e => {
        const del = e.target.closest("[data-deltheme]");
        if (del) { e.stopPropagation(); if (!confirm(`Delete the theme "${del.dataset.deltheme}"?`)) return; delete myThemes[del.dataset.deltheme]; S.themes(myThemes); renderIslands(); return; }
        const Th = THEMES()[b.dataset.theme]; if (!Th) return; d.theme = b.dataset.theme; applyTheme(d, Th); islandChanged(true);
    }));
    on("iThemeSave", "click", () => {
        const nm = ($("iThemeName").value || "").trim().slice(0, 24); if (!nm) { say("Give the theme a name first"); return; }
        const t = { label: nm }; for (const k of THEME_KEYS) if (d[k] !== undefined) t[k] = JSON.parse(JSON.stringify(d[k]));
        myThemes[nm] = t; S.themes(myThemes).then(r => say(r && r.ok ? `Theme "${nm}" saved: it's in the theme list now` : "Couldn't save the theme", 3000)); d.theme = "my:" + nm; renderIslands();
    });
    const range = (id, fn) => { const e = $(id); if (!e) return; e.addEventListener("input", () => { const v = +e.value; $(id + "V").textContent = v + ($(id + "V").textContent.replace(/^[-\d.]+/, "")); fn(v); islandChanged(); }); };
    range("iRad", v => (d.radius = v)); range("iWob", v => (d.wobble = v)); range("iPlat", v => (d.plateau = v)); range("iHills", v => (d.hills = v)); range("iHillS", v => (d.hillSize = v));
    range("iBeach", v => (d.beach = v)); range("iCliff", v => (d.cliffs = v)); range("iDecor", v => (d.decor = v)); range("iTreeN", v => (d.treeCount = v));
    range("iArrDir", v => (d.arrDir = v)); range("iNextDir", v => (d.nextDir = v));
    on("iSeed", "input", e => { d.seed = +e.target.value || 1; islandChanged(); });
    on("iDice", "click", () => { d.seed = r3(1 + Math.random() * 8); islandChanged(true); });
    on("iShapeK", "change", e => { d.shape = { ...(d.shape || {}), kind: e.target.value }; islandChanged(true); });
    range("iShapeS", v => (d.shape.stretch = v)); range("iShapeL", v => (d.shape.lobes = v)); range("iShapeA", v => (d.shape.amount = v)); range("iShapeAng", v => (d.shape.angle = v));
    // the terrain tool
    all("[data-sculpt]", "click", b => { sculpt.mode = b.dataset.sculpt; if (sculpt.mode) { deselect(); if (builtMode) setBuiltMode(false); } brushRing.visible = false; renderIslands(); say(sculpt.mode ? "Hold the left mouse button on the ground to paint" : "Sculpting off"); });
    on("iBrushR", "input", e => { sculpt.r = +e.target.value; pref("brushR", sculpt.r); e.target.nextElementSibling.textContent = sculpt.r + "m"; brushRing.scale.setScalar(sculpt.r); });
    on("iBrushK", "input", e => { sculpt.k = +e.target.value; pref("brushK", sculpt.k); e.target.nextElementSibling.textContent = sculpt.k; });
    on("iSculptUndo", "click", undoStroke);
    on("iSculptClear", "click", () => { if (!confirm(`Clear all the sculpting on ${d.name}?`)) return; d.sculpt = []; strokes = []; const C = T.customIsle(n); if (C) { C.setSculpt([]); T.ciReshape(C); T.ciSettle(C); } changed("islands"); renderIslands(); });
    // features
    body.querySelectorAll("[data-fopen]").forEach(it => it.addEventListener("click", e => { if (e.target.closest("[data-fdel]")) return; const i = +it.dataset.fopen; featOpen = featOpen === i ? -1 : i; renderIslands(); }));
    all("[data-fdel]", "click", b => { d.features.splice(+b.dataset.fdel, 1); featOpen = -1; islandChanged(true); });
    on("iFeatAdd", "click", () => { const t = $("iFeatType").value, D = FDEF[t]; const f = { type: t, dir: Math.round(Math.random() * 360) }; for (const k of ["dist", "r", "h", "len", "width", "depth"]) if (D[k] !== undefined) f[k] = D[k]; d.features = d.features || []; d.features.push(f); featOpen = d.features.length - 1; islandChanged(true); });
    body.querySelectorAll("#iFeats [data-fk]").forEach(c => c.addEventListener(c.type === "checkbox" ? "change" : "input", () => {
        const f = d.features[+c.dataset.fi], k = c.dataset.fk; if (!f) return;
        if (c.type === "checkbox") f[k] = c.checked; else if (c.type === "text") f[k] = c.value.slice(0, 30).toUpperCase(); else { f[k] = +c.value; const sm = c.parentElement.querySelector("small"); if (sm) sm.textContent = c.value + sm.textContent.replace(/^[-\d.]+/, ""); }
        islandChanged();
    }));
    body.querySelectorAll("[data-colr]").forEach(c => c.addEventListener("input", () => { d.colors = { ...(d.colors || {}), [c.dataset.colr]: c.value }; islandChanged(); }));
    on("iSnowline", "input", e => { d.snowline = e.target.value === "" ? "" : +e.target.value; islandChanged(); });
    // the ecosystem: trees
    body.querySelectorAll("[data-tw]").forEach(c => c.addEventListener("input", () => { d.treeW = { ...(d.treeW || {}), [c.dataset.tw]: +c.value }; c.nextElementSibling.textContent = c.value + "×"; islandChanged(); }));
    all("[data-trm]", "click", b => {
        const k = b.dataset.trm, own = trees.find(t => t.key === k);
        if (own) setTreeOnIsle(own, n, false); else d.trees = (d.trees || []).filter(q => q !== k);
        if (d.treeW) delete d.treeW[k];
        islandChanged(true);
    });
    on("iTreeAdd", "change", e => {
        const k = e.target.value; if (!k) return;
        const own = trees.find(t => t.key === k);
        if (own) setTreeOnIsle(own, n, true); else d.trees = [...(d.trees || []), k];
        islandChanged(true);
    });
    on("iAllTiers", "change", e => { d.allTiers = e.target.checked; islandChanged(true); });
    on("iRegrow", "click", () => { rebuildNow(islandSel); say(curIsle() === n ? "The forest grew back" : `Rebuilt. Go to ${d.name} to see it`); });
    // animals, ground cover, the air
    body.querySelectorAll("[data-an]").forEach(c => c.addEventListener("input", () => { const a = (d.animals || []).find(q => q.kind === c.dataset.an); if (a) a.n = +c.value; c.nextElementSibling.textContent = c.value; islandChanged(); }));
    all("[data-anrm]", "click", b => { d.animals = (d.animals || []).filter(q => q.kind !== b.dataset.anrm); islandChanged(true); });
    on("iAnAdd", "change", e => { const k = e.target.value; if (!k) return; d.animals = [...(d.animals || []), { kind: k, n: T.WILD_KINDS[k].fly ? 4 : 6 }]; islandChanged(true); });
    on("iEcoFill", "click", () => { Object.assign(d, ecoPreset(d.theme)); islandChanged(true); say("Wildlife and ground cover from the theme"); });
    body.querySelectorAll("[data-cov]").forEach(c => c.addEventListener("input", () => { d.cover = { ...(d.cover || {}), [c.dataset.cov]: +c.value }; c.nextElementSibling.textContent = c.value; islandChanged(); }));
    body.querySelectorAll("[data-ccol]").forEach(c => c.addEventListener("input", () => { d.coverCol = { ...(d.coverCol || {}), [c.dataset.ccol]: c.value }; islandChanged(); }));
    on("iFlies", "change", e => { d.flies = e.target.value; islandChanged(); });
    on("iFliesCol", "input", e => { d.fliesCol = e.target.value; islandChanged(); });
    // materials
    const matsChanged = () => islandChanged();
    on("iMatOwn", "click", () => {
        const base = [["Timber", "#b08a5a"], ["Pebble", "#a8a8b4"], ["Resin", "#e0a040"], ["Glimmer", "#9fe0ff", true], ["Heartstone", "#ff5a8a", true]];
        d.mats = []; for (const [name, color, glow] of base) d.mats.push({ key: uniqueKey2("m_", slug(d.name, "isle") + "_" + name, k => matTaken(k, d) || d.mats.some(q => q.key === k)), name, color, glow: !!glow });
        islandChanged(true); say("Rename them and pick colours: or ask Claude to invent them with the island");
    });
    on("iMatOff", "click", () => { if (!confirm("Stop using this island's own materials? Trees here go back to dropping borrowed ones.")) return; for (const m of d.mats || []) dropMatEverywhere(m.key); d.mats = []; d.axes = []; islandChanged(true); });
    on("iMatAdd", "click", () => { if ((d.mats || []).length >= 8) { say("8 materials is the most"); return; } d.mats.push({ key: uniqueKey2("m_", slug(d.name, "isle") + "_material", k => matTaken(k, d) || d.mats.some(q => q.key === k)), name: "Material", color: "#c8c8d0", glow: false }); islandChanged(true); });
    body.querySelectorAll("[data-mname]").forEach(c => c.addEventListener("input", () => { d.mats[+c.dataset.mname].name = c.value.slice(0, 24) || "Material"; matsChanged(); }));
    body.querySelectorAll("[data-mcol]").forEach(c => c.addEventListener("input", () => { d.mats[+c.dataset.mcol].color = c.value; matsChanged(); }));
    all("[data-mglow]", "change", c => { d.mats[+c.dataset.mglow].glow = c.checked; matsChanged(); });
    all("[data-mup]", "click", b => { const i = +b.dataset.mup; if (i > 0) { const m = d.mats.splice(i, 1)[0]; d.mats.splice(i - 1, 0, m); islandChanged(true); } });
    all("[data-mdel]", "click", b => { const i = +b.dataset.mdel; if (d.mats.length <= 1) { say("Keep at least one, or press Borrow instead"); return; } dropMatEverywhere(d.mats[i].key); d.mats.splice(i, 1); islandChanged(true); });
    on("iEcon", "change", e => { d.economy = +e.target.value; islandChanged(true); });
    // axes
    on("iAxeAdd", "click", () => { d.axes = d.axes || []; const name = d.name.split(" ")[0] + " Axe"; d.axes.push({ key: uniqueKey2("x_", name, k => axeTaken(k, d) || d.axes.some(q => q.key === k)), name, steel: "#4a4a5a", edge: "#9fe8ff", glow: "#1a3a5a", ability: 14 + (d.axes.length % 4) }); islandChanged(true); });
    all("[data-xdel]", "click", b => { d.axes.splice(+b.dataset.xdel, 1); islandChanged(true); });
    body.querySelectorAll("[data-xname]").forEach(c => c.addEventListener("input", () => { d.axes[+c.dataset.xname].name = c.value.slice(0, 28) || "Axe"; islandChanged(); }));
    body.querySelectorAll("[data-xcol]").forEach(c => c.addEventListener("input", () => { const [j, k] = c.dataset.xcol.split(":"); d.axes[+j][k] = c.value; islandChanged(); }));
    all("[data-xab]", "change", c => { d.axes[+c.dataset.xab].ability = +c.value; islandChanged(); });
    body.querySelectorAll("[data-xdmg]").forEach(c => c.addEventListener("input", () => { const v = Math.round(+c.value); if (v > 0) d.axes[+c.dataset.xdmg].dmg = v; else delete d.axes[+c.dataset.xdmg].dmg; islandChanged(); }));
    // the ticket and the story
    on("iCost", "input", e => { d.rebirth = { ...(d.rebirth || {}), cost: Math.max(0, Math.round(+e.target.value || 0)) }; islandChanged(); });
    const setItem = () => { const k = $("iItem").value, v = Math.max(0, Math.round(+$("iItemN").value || 0)); d.rebirth = { ...(d.rebirth || {}), items: k && v ? { [k]: v } : {} }; islandChanged(); };
    on("iItem", "change", setItem); on("iItemN", "input", setItem);
    txt("iCamp", v => (d.campName = v.slice(0, 24))); txt("iRide1", v => (d.rideLine1 = v.slice(0, 120))); txt("iRide2", v => (d.rideLine2 = v.slice(0, 120)));
    txt("iFerryLine", v => (d.ferryLine = v.slice(0, 160))); txt("iArrive", v => (d.arrive = v.slice(0, 200)));
}

// =====================================================================
//  the Prop Maker and the Animal Maker: things built from simple parts (content/props.js, content/animals.js). By hand, or ask Claude
// =====================================================================
let myProps = (Array.isArray(T.CONTENT_PROPS) ? T.CONTENT_PROPS : []).filter(p => p && /^u_/.test(p.key)).map(p => JSON.parse(JSON.stringify(p)));
let myAnimals = (Array.isArray(T.CONTENT_ANIMALS) ? T.CONTENT_ANIMALS : []).filter(a => a && /^a_/.test(a.key)).map(a => JSON.parse(JSON.stringify(a)));
const MK = {
    props: { kind: "props", noun: "prop", Noun: "Prop", prefix: "u_", list: () => myProps, set: v => (myProps = v), define: d => T.defineCustomProp(d), drop: k => T.dropCustomProp(k), sel: myProps[0] ? myProps[0].key : null },
    animals: { kind: "animals", noun: "animal", Noun: "Animal", prefix: "a_", list: () => myAnimals, set: v => (myAnimals = v), define: d => T.defineCustomAnimal(d), drop: k => T.dropCustomAnimal(k), sel: myAnimals[0] ? myAnimals[0].key : null }
};
const mk = () => (tab === "animals" ? MK.animals : MK.props);
const makerTab = () => tab === "props" || tab === "animals";
let partSel = -1, pmPreview = null, pmAt = null, pmGizmo = false, pmT = 0;
const PART_LABEL = { box: "Box", sphere: "Ball", cyl: "Cylinder", cone: "Cone", pyramid: "Pyramid", torus: "Ring", dome: "Dome", wedge: "Wedge", rock: "Rock", gem: "Gem", hex: "Hex prism", tube: "Pipe", panel: "Flat panel" };
const ROLE_LABEL = { body: "Body", head: "Head", leg: "Leg", tail: "Tail", wing: "Wing", ear: "Ear", eye: "Eye" };
const pmCur = () => mk().list().find(p => p.key === mk().sel) || null;
function pmKeyFor(M, name) { const base = M.prefix + slug(name, M.noun); let k = base, n = 2; while (T.PROPS[k] || T.WILD_KINDS[k] || M.list().some(p => p.key === k)) k = base + "_" + n++; return k; }
function pmRemovePreview() { if (!pmPreview) return; if (pmPreview.flat) T.scene.remove(pmPreview.g); else T.placedRemove(pmPreview.o); pmPreview = null; }
function pmClearPreview() { pmRemovePreview(); if (pmGizmo) { tc.detach(); pmGizmo = false; } }
function pmShowPreview(move) {
    const p = pmCur(); if (!p || !makerTab() || mode !== "edit") { pmClearPreview(); return; }
    if (!pmAt || move) { // in view, and not in your face
        let s = previewSpot(); const f = fwd().setY(0).normalize();
        if (Math.hypot(s.x - cam.pos.x, s.z - cam.pos.z) < 4) s = { x: cam.pos.x + f.x * 5, z: cam.pos.z + f.z * 5 };
        pmAt = { x: s.x, z: s.z };
    }
    pmRemovePreview();
    if (tab === "animals") { // a flat copy of the parts (no pivots), so the gizmo can move each one
        const g = new THREE.Group(), body = T.makePartsGroup(p.parts); g.add(body);
        g.scale.setScalar(Math.min(6, Math.max(0.1, +p.size || 1))); g.position.set(pmAt.x, T.groundY(pmAt.x, pmAt.z), pmAt.z);
        T.scene.add(g); pmPreview = { g, body, flat: true };
    } else pmPreview = T.placedBuild({ id: "__pm", isle: curIsle(), kind: "prop", prop: p.key, x: pmAt.x, y: T.groundY(pmAt.x, pmAt.z), z: pmAt.z, rx: 0, ry: 0, rz: 0, s: 1, solid: false });
    if (partSel >= 0 && pmPreview && pmPreview.body.children[partSel]) { if (sel) deselect(); tc.attach(pmPreview.body.children[partSel]); pmGizmo = true; } else if (pmGizmo) { tc.detach(); pmGizmo = false; }
}
function pmApply(rerender, now) { // the new look goes into the game: the preview, and every copy of a prop you've placed
    const p = pmCur(), M = mk(); if (!p) return;
    changed(M.kind);
    clearTimeout(pmT);
    const go = () => { M.define(p); pmShowPreview(); if (M === MK.props) for (const rec of T.placed.slice()) if (rec.o.prop === p.key && rec.o.id !== "__pm") T.placedRebuild(rec.o); };
    if (now) go(); else pmT = setTimeout(go, 160);
    if (rerender) renderMaker();
}
function pmFromGizmo() { // you dragged a part: its numbers follow
    const p = pmCur(); if (!p || partSel < 0 || !pmPreview) return;
    const m = pmPreview.body.children[partSel], q = p.parts[partSel]; if (!m || !q) return;
    q.x = r3(m.position.x); q.y = r3(m.position.y); q.z = r3(m.position.z);
    q.rx = Math.round(m.rotation.x / DEG); q.ry = Math.round(m.rotation.y / DEG); q.rz = Math.round(m.rotation.z / DEG);
    q.sx = r3(Math.max(0.02, m.scale.x)); q.sy = r3(Math.max(0.02, m.scale.y)); q.sz = r3(Math.max(0.02, m.scale.z));
}
function pmPickPart(mx, my) { if (!pmPreview) return -1; setRay(mx, my); const hits = ray.intersectObjects(pmPreview.body.children, false); return hits.length ? pmPreview.body.children.indexOf(hits[0].object) : -1; }
function pmSelectPart(i) { partSel = i; renderMaker(); pmShowPreview(); }
// a little four-legged starter: every animal begins as this, then you (or Claude) change it
function starterAnimal() {
    const P = (shape, role, x, y, z, sx, sy, sz, color, more = {}) => ({ shape, role, x, y, z, sx, sy, sz, color, ...more });
    return { name: "New Animal", way: "wander", size: 1, speed: 1.2, run: 6, flee: 9, herd: 1, pitch: 500, parts: [
        P("box", "body", 0, 0.55, 0, 0.5, 0.4, 0.9, "#b08a5a"), P("box", "head", 0, 0.82, 0.56, 0.38, 0.34, 0.38, "#b08a5a"), P("box", "head", 0, 0.74, 0.8, 0.2, 0.16, 0.16, "#e8d8b8"),
        P("sphere", "eye", -0.1, 0.88, 0.75, 0.07, 0.07, 0.05, "#120c08"), P("sphere", "eye", 0.1, 0.88, 0.75, 0.07, 0.07, 0.05, "#120c08"),
        P("cone", "ear", -0.12, 1.04, 0.5, 0.1, 0.18, 0.08, "#8a6a40"), P("cone", "ear", 0.12, 1.04, 0.5, 0.1, 0.18, 0.08, "#8a6a40"),
        P("box", "leg", -0.17, 0.2, 0.3, 0.12, 0.4, 0.12, "#8a6a40"), P("box", "leg", 0.17, 0.2, 0.3, 0.12, 0.4, 0.12, "#8a6a40"), P("box", "leg", -0.17, 0.2, -0.3, 0.12, 0.4, 0.12, "#8a6a40"), P("box", "leg", 0.17, 0.2, -0.3, 0.12, 0.4, 0.12, "#8a6a40"),
        P("cyl", "tail", 0, 0.66, -0.52, 0.08, 0.3, 0.08, "#8a6a40", { rx: -50 })] };
}
function pmNew(base) {
    const M = mk(), p = base || (M === MK.animals ? starterAnimal() : { name: "New prop", r: 0.5, light: null, parts: [{ shape: "box", x: 0, y: 0.5, z: 0, sx: 1, sy: 1, sz: 1, color: "#9a7a5a", tint: true }] });
    p.key = pmKeyFor(M, p.name); M.list().push(p); M.sel = p.key; partSel = -1; pmAt = null; M.define(p); changed(M.kind); renderMaker(); pmShowPreview(true); pmFrame(); renderPlaceIfOpen();
}
function pmFrame() { // the camera steps back to see the whole preview (F)
    if (!pmPreview) return;
    const box = new THREE.Box3().setFromObject(pmPreview.g), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const d = Math.max(3.5, Math.max(sz.x, sz.y, sz.z) * 2.2), f = fwd().setY(0).normalize();
    cam.pos.copy(c).addScaledVector(f, -d).add(new THREE.Vector3(0, d * 0.35, 0));
    lookAtPoint(c);
}
function renderPlaceIfOpen() { if (tab === "place") renderPlace(); }
function addAnimalToIsland(i, key) { const d = islands[i]; if (!d) return; d.animals = d.animals || []; const a = d.animals.find(q => q.kind === key); if (a) a.n = Math.min(30, a.n + 4); else d.animals.push({ kind: key, n: 6 }); changed("islands"); rebuildIsle(i); }
// ---- Ask Claude: one short request, a JSON prop or animal back, every field checked ----
const SHAPES_TXT = "box (a 1 m cube), sphere (1 m across), cyl (cylinder 1 m across, 1 m tall), cone (point up), pyramid (square base), torus (a ring 1 m across standing upright in the x-y plane: rx 90 lays it flat), dome (half a ball, flat side down, its base at the part's y), wedge (a ramp, high at the back), rock (a chunky lump), gem (a diamond), hex (a hexagonal prism), tube (an open pipe), panel (a flat square facing +z)";
function cleanParts(list, roles) {
    const num = (v, a, b, dflt) => { v = +v; return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : dflt; }, hex = v => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : "#9a9aa4");
    return list.filter(q => q && PART_LABEL[q.shape]).slice(0, 60).map(q => {
        const o = { shape: q.shape, x: r3(num(q.x, -20, 20, 0)), y: r3(num(q.y, -5, 30, 0.5)), z: r3(num(q.z, -20, 20, 0)), sx: r3(num(q.sx, 0.02, 20, 1)), sy: r3(num(q.sy, 0.02, 20, 1)), sz: r3(num(q.sz, 0.02, 20, 1)), color: hex(q.color) };
        if (roles) o.role = ROLE_LABEL[q.role] ? q.role : "body";
        for (const k of ["rx", "ry", "rz"]) if (q[k]) o[k] = Math.round(num(q[k], -720, 720, 0));
        if (q.glow) o.glow = true; if (!roles && q.tint) o.tint = true; if (q.opacity !== undefined && +q.opacity < 1) o.opacity = r3(num(q.opacity, 0.1, 1, 1));
        return o;
    });
}
function cleanProp(src, into) {
    const num = (v, a, b, dflt) => { v = +v; return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : dflt; }, hex = v => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : "#9a9aa4");
    const p = { ...into };
    if (typeof src.name === "string" && src.name.trim()) p.name = src.name.trim().slice(0, 32);
    if (src.r !== undefined) p.r = r3(num(src.r, 0, 6, 0.5));
    p.light = src.light && src.light.on ? { on: true, color: hex(src.light.color), power: r3(num(src.light.power, 1, 40, 8)), range: r3(num(src.light.range, 3, 40, 12)), y: r3(num(src.light.y, -1, 15, 1.5)) } : null;
    if (Array.isArray(src.parts)) { const parts = cleanParts(src.parts, false); if (parts.length) p.parts = parts; }
    return p;
}
function cleanAnimal(src, into) {
    const num = (v, a, b, dflt) => { v = +v; return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : dflt; };
    const a = { ...into };
    if (typeof src.name === "string" && src.name.trim()) a.name = src.name.trim().slice(0, 32);
    if (T.ANIMAL_WAYS[src.way]) a.way = src.way;
    for (const [k, lo, hi] of [["speed", 0.1, 4], ["run", 0.5, 12], ["flee", 0, 25], ["herd", 1, 8], ["alt", 4, 50], ["pitch", 60, 2000]]) if (src[k] !== undefined) a[k] = r3(num(src[k], lo, hi, a[k]));
    if (src.size !== undefined) a.size = r3(num(src.size, 0.2, 4, 1));
    a.herd = Math.round(a.herd || 1); a.night = !!src.night;
    if (Array.isArray(src.parts)) { const parts = cleanParts(src.parts, true); if (parts.length) a.parts = parts; }
    return a;
}
function makerPrompt(kind, desc) {
    if (kind === "buildings") return `Build a building or big structure for a low-poly island from this description: "${desc}"

Build it out of simple parts, like a model kit. Units are metres, y is up, the ground is y = 0, and its front (the door) faces +z. Each part is centred on its x, y, z, turned by rx, ry, rz in degrees, and sized by sx (width), sy (height), sz (depth).
Shapes at size 1: ${SHAPES_TXT}.
Style: chunky, spooky-cheerful low-poly, like a tree-chopping game where the trees are alive. Make it 4 to 14 m tall and up to 12 m across, with real detail: walls, a roof, a door, windows (glow: true for lit windows), chimneys, beams, steps, flags, lanterns. Use 15 to 50 parts. Put tint: true on the main walls so players can recolour it.
Return JSON: {"name": "1-3 words", "r": how wide it is to bump into in metres (about half its width, 1.5-6), "light": {"on": true, "color": "#rrggbb", "power": 6-20, "range": 8-20, "y": height} or null,
 "parts": [{"shape": "...", "x": 0, "y": 0.5, "z": 0, "rx": 0, "ry": 0, "rz": 0, "sx": 1, "sy": 1, "sz": 1, "color": "#rrggbb", "glow": false, "tint": false, "opacity": 1}]}`;
    if (kind === "animals") return `Build a low-poly animal from this description: "${desc}"

Build it out of simple parts. Each part has a role that says how it moves: body (stays still), head (looks around: put the snout, mouth, beak and horns on it too), eye (blinks), ear (twitches), leg (swings from its top when it walks: one tall part per leg, reaching the ground), tail (wags), wing (flaps from the end nearest the body).
Units are metres, y is up, the ground is y = 0 (the feet touch it), and the animal faces +z. Each part is centred on its x, y, z, turned by rx, ry, rz in degrees, and sized by sx (width), sy (height), sz (depth).
Shapes at size 1: ${SHAPES_TXT}.
Style: chunky, cute-spooky low-poly, like a cheerful tree-chopping game where the trees are alive. Build it at its natural size (a rabbit about 0.4 m tall, a deer about 1.5 m) and leave size at 1. Use 8 to 40 parts. Most animals have a head with 2 eyes, and legs. Put glow: true on glowing eyes, spots or flames, and opacity 0.3 to 0.8 on ghostly bits.
Behaviour ("way"): wander (a shy grazer that runs off), bold (never runs off), hop (hops about), slow (creeps along), fly (circles high in the sky: give it wings).
Return JSON: {"name": "1-3 words", "way": "...", "speed": walking speed in m/s (0.3-2), "run": running speed (2-9), "flee": how close you can get before it runs, in metres (3-14), "herd": how many come together (1-6), "alt": flying height in metres (8-40, flyers only), "night": true if a flyer only comes out at night, "pitch": its voice, 80 (deep) to 1600 (squeaky),
 "parts": [{"shape": "...", "role": "body|head|eye|ear|leg|tail|wing", "x": 0, "y": 0.5, "z": 0, "rx": 0, "ry": 0, "rz": 0, "sx": 1, "sy": 1, "sz": 1, "color": "#rrggbb", "glow": false, "opacity": 1}]}
Example, a little pig: {"name":"Piglet","way":"wander","speed":0.9,"run":5,"flee":7,"herd":3,"pitch":700,"parts":[{"shape":"sphere","role":"body","x":0,"y":0.4,"z":0,"sx":0.5,"sy":0.42,"sz":0.7,"color":"#f0a0a8"},{"shape":"sphere","role":"head","x":0,"y":0.5,"z":0.38,"sx":0.34,"sy":0.32,"sz":0.3,"color":"#f0a0a8"},{"shape":"cyl","role":"head","x":0,"y":0.46,"z":0.55,"sx":0.14,"sy":0.08,"sz":0.14,"rx":90,"color":"#e07a88"},{"shape":"sphere","role":"eye","x":-0.08,"y":0.56,"z":0.5,"sx":0.05,"sy":0.05,"sz":0.04,"color":"#120c08"},{"shape":"sphere","role":"eye","x":0.08,"y":0.56,"z":0.5,"sx":0.05,"sy":0.05,"sz":0.04,"color":"#120c08"},{"shape":"cone","role":"ear","x":-0.1,"y":0.68,"z":0.36,"sx":0.08,"sy":0.12,"sz":0.05,"color":"#e07a88"},{"shape":"cone","role":"ear","x":0.1,"y":0.68,"z":0.36,"sx":0.08,"sy":0.12,"sz":0.05,"color":"#e07a88"},{"shape":"cyl","role":"leg","x":-0.14,"y":0.11,"z":0.18,"sx":0.1,"sy":0.22,"sz":0.1,"color":"#e07a88"},{"shape":"cyl","role":"leg","x":0.14,"y":0.11,"z":0.18,"sx":0.1,"sy":0.22,"sz":0.1,"color":"#e07a88"},{"shape":"cyl","role":"leg","x":-0.14,"y":0.11,"z":-0.2,"sx":0.1,"sy":0.22,"sz":0.1,"color":"#e07a88"},{"shape":"cyl","role":"leg","x":0.14,"y":0.11,"z":-0.2,"sx":0.1,"sy":0.22,"sz":0.1,"color":"#e07a88"},{"shape":"torus","role":"tail","x":0,"y":0.45,"z":-0.36,"sx":0.12,"sy":0.12,"sz":0.12,"ry":90,"color":"#e07a88"}]}`;
    return `Build a 3D prop from this description: "${desc}"

Build it out of simple parts. Units are metres, y is up, the ground is y = 0 and the prop's front faces +z. Each part is centred on its x, y, z, turned by rx, ry, rz in degrees, and sized by sx (width), sy (height), sz (depth).
Shapes at size 1: ${SHAPES_TXT}.
Style: chunky low-poly, like a spooky but cheerful tree-chopping game. Most props are 0.5 to 4 m tall. Use 3 to 40 parts. Put glow: true on parts that give off light (flames, windows, crystals, eyes), tint: true on the main-colour parts so players can recolour them, and opacity 0.2 to 0.9 for glass, water or ghostly bits.
Return JSON: {"name": "1-3 words", "r": how wide it is to bump into in metres (0 for flat or thin things, up to 3), "light": {"on": true, "color": "#rrggbb", "power": 4-20, "range": 6-20, "y": height} or null,
 "parts": [{"shape": "...", "x": 0, "y": 0.5, "z": 0, "rx": 0, "ry": 0, "rz": 0, "sx": 1, "sy": 1, "sz": 1, "color": "#rrggbb", "glow": false, "tint": false, "opacity": 1}]}
Example, a barrel: {"name":"Barrel","r":0.5,"light":null,"parts":[{"shape":"cyl","x":0,"y":0.55,"z":0,"sx":0.9,"sy":1.1,"sz":0.9,"color":"#8a5a30","tint":true},{"shape":"cyl","x":0,"y":0.2,"z":0,"sx":0.94,"sy":0.08,"sz":0.94,"color":"#3a3a40"},{"shape":"cyl","x":0,"y":0.9,"z":0,"sx":0.94,"sy":0.08,"sz":0.94,"color":"#3a3a40"}]}`;
}
async function claudeBuild(kind, desc, model, into) { // → { ok, data, tokens, ms, model } or { ok: false, error }
    const r = await askQ({ prompt: makerPrompt(kind, desc), system: `You build low-poly 3D ${kind === "animals" ? "animals" : kind === "buildings" ? "buildings" : "props"} out of simple shapes for Hypergamous Tree Chopping Simulator 4. Reply with ONLY one JSON object: no prose, no code fences.`, model });
    if (!r.ok) return { ok: false, error: r.error };
    let j = null; try { j = JSON.parse((r.text.match(/\{[\s\S]*\}/) || [""])[0]); } catch (e) { /* not JSON */ }
    if (!j || !Array.isArray(j.parts) || !j.parts.length) return { ok: false, error: `Claude's answer wasn't ${kind === "animals" ? "an animal" : "a prop"}. Try again or reword it.` };
    return { ok: true, data: kind === "animals" ? cleanAnimal(j, into) : cleanProp(j, into), tokens: r.tokens, ms: r.ms, model: r.model };
}
async function askClaudeMaker(p) {
    const M = mk(), desc = ($("pmAsk").value || "").trim(), msg = $("pmAskMsg"), btn = $("pmAskGo");
    if (!desc) { msg.className = "stMsg bad"; msg.textContent = `Describe the ${M.noun} first.`; return; }
    const model = $("pmModel").value; pref("model", model);
    btn.disabled = true; btn.textContent = "Claude is building it…"; msg.className = "stMsg"; msg.textContent = `Asking ${model}…`;
    const res = await claudeBuild(M.kind, desc, model, p);
    btn.disabled = false; btn.textContent = "Build it with Claude";
    if (!res.ok) { const m = $("pmAskMsg"); if (m) { m.className = "stMsg bad"; m.textContent = res.error; } return; }
    if (!M.list().includes(p)) return;
    Object.assign(p, res.data);
    M.define(p); changed(M.kind); // saved as the kind it is, whichever tab you're on now
    if (M === MK.props) for (const rec of T.placed.slice()) if (rec.o.prop === p.key && rec.o.id !== "__pm") T.placedRebuild(rec.o);
    if (mk() === M && makerTab() && M.sel === p.key) { partSel = -1; pmApply(true, true); } // and redrawn only if you're still looking at it
    const m2 = $("pmAskMsg"); if (m2) { m2.className = "stMsg good"; m2.textContent = `${p.name}: ${p.parts.length} parts, built by ${res.model} in ${(res.ms / 1000).toFixed(1)}s · ~${(res.tokens / 1000).toFixed(1)}k tokens`; }
    $("pmAsk") && ($("pmAsk").value = desc);
}
function renderMaker() {
    const M = mk(), A = M === MK.animals, p = pmCur(), model = pref("model") || "haiku", list = M.list();
    let h = `<div class="stH">MY ${M.Noun.toUpperCase()}S <small>${list.length ? list.length + " made" : ""}</small></div>
      <div class="stList">${list.map(q => `<div class="stItem${q.key === M.sel ? " on" : ""}" data-pm="${esc(q.key)}"><span>${esc(q.name)}</span><small>${A ? esc((T.ANIMAL_WAYS[q.way] || "").split(",")[0]) + " · " : ""}${(q.parts || []).length} parts</small></div>`).join("") || `<div class="stHint">No ${M.noun}s yet. Make one, or describe it and let Claude build it.</div>`}</div>
      <div class="stBtns"><button class="stB go" id="pmNew">+ New ${M.noun}</button>${p ? `<button class="stB" id="pmDup">Duplicate</button><button class="stB warn" id="pmDel">Delete</button>` : ""}</div>`;
    if (!p) { $("stLeftBody").innerHTML = h; bindMaker(); return; }
    const L = p.light || {}, q = p.parts[partSel], fly = p.way === "fly";
    h += `<div class="stClaude" style="margin-top:12px"><div class="stH">✦ ASK CLAUDE <select class="stSel" id="pmModel">${opt("haiku", model, "Haiku (cheapest)")}${opt("sonnet", model, "Sonnet (better shapes)")}${opt("opus", model, "Opus")}</select></div>
        <textarea class="stTa" id="pmAsk" placeholder="${A ? "Describe an animal, e.g. a little lantern-eyed owl that only flies at night" : "Describe a prop, e.g. a haunted wishing well with green glowing water"}"></textarea>
        <div class="stBtns"><button class="stB" id="pmAskGo" style="flex:1">Build it with Claude</button></div><div class="stMsg" id="pmAskMsg"></div></div>
      <div class="stH">NAME</div><div class="stRow"><input class="stIn" type="text" id="pmName" value="${esc(p.name)}" style="flex:1"><small style="opacity:.5">${esc(p.key)}</small></div>`;
    if (A) h += `<div class="stH">HOW IT ACTS</div>
      <div class="stRow"><label>Behaviour</label><select class="stSel" id="anWay" style="max-width:190px">${Object.entries(T.ANIMAL_WAYS).map(([k, l]) => opt(k, p.way || "wander", l)).join("")}</select></div>
      ${num("anSize", "Size (×)", p.size || 1, 0.1)}${num("anSpeed", fly ? "Flying speed" : "Walking speed (m/s)", p.speed || 1.2, 0.1)}
      ${!fly && p.way !== "bold" && p.way !== "slow" ? num("anRun", "Running speed", p.run || 6, 0.5) + num("anFlee", "Runs off within (m)", p.flee ?? 9, 1) : ""}
      ${fly ? num("anAlt", "Flies at (m)", p.alt || 18, 1) + `<div class="stChecks"><label><input type="checkbox" id="anNight"${p.night ? " checked" : ""}> Only at night (otherwise only by day)</label></div>` : num("anHerd", "Comes in groups of", p.herd || 1, 1)}
      ${num("anPitch", "Voice (80 deep – 1600 squeaky)", p.pitch || 500, 20)}`;
    else h += `${num("pmR", "Bump size (0 = walk through)", p.r || 0, 0.1)}
      <div class="stChecks"><label><input type="checkbox" id="pmLight"${L.on ? " checked" : ""}> Gives off real light</label></div>
      ${L.on ? `<div class="stRow"><label>Light colour</label><input class="stIn" type="color" id="pmLightCol" value="${L.color || "#ffc070"}"></div>${num("pmLightP", "Brightness", L.power || 8, 1)}${num("pmLightR", "Reach (m)", L.range || 12, 1)}${num("pmLightY", "Height", L.y || 1.5, 0.1)}` : ""}`;
    h += `<div class="stH">PARTS <small>${p.parts.length} · click one, or click it on the preview</small></div>
      <div class="stList">${p.parts.map((pt, i) => `<div class="stItem${i === partSel ? " on" : ""}" data-part="${i}"><span><span style="color:${esc(pt.color || "#9a9aa4")}">■</span> ${A ? `<small style="color:#9fe8ff">${esc(ROLE_LABEL[pt.role] || "Body")}</small> ` : ""}${esc(PART_LABEL[pt.shape] || pt.shape)}${pt.glow ? " ✦" : ""}${pt.tint ? " 🎨" : ""}</span><span><button class="stB" data-pdup="${i}" style="padding:1px 6px" title="Copy">⧉</button> <button class="stB" data-pdel="${i}" style="padding:1px 6px" title="Delete">✕</button></span></div>`).join("")}</div>
      <div class="stH">ADD A PART</div><div class="stGrid">${T.PART_SHAPES.map(s => `<button class="stB" data-padd="${s}">${esc(PART_LABEL[s] || s)}</button>`).join("")}</div>`;
    if (q) h += `<div class="stH">PART ${partSel + 1}: ${esc((PART_LABEL[q.shape] || q.shape).toUpperCase())}</div>
      ${A ? `<div class="stRow"><label>Moves as</label><select class="stSel" id="ptRole">${T.ANIMAL_ROLES.map(r => opt(r, q.role || "body", ROLE_LABEL[r])).join("")}</select></div>` : ""}
      <div class="stRow"><label>Shape</label><select class="stSel" id="ptShape">${T.PART_SHAPES.map(s => opt(s, q.shape, PART_LABEL[s] || s)).join("")}</select></div>
      <div class="stRow"><label>Colour</label><input class="stIn" type="color" id="ptCol" value="${q.color || "#9a9aa4"}"></div>
      <div class="stChecks"><label><input type="checkbox" id="ptGlow"${q.glow ? " checked" : ""}> Glows</label>${A ? "" : `<label title="Players can recolour these parts"><input type="checkbox" id="ptTint"${q.tint ? " checked" : ""}> Main colour</label>`}</div>
      ${num("ptX", "X", q.x || 0)}${num("ptY", "Height", q.y || 0)}${num("ptZ", "Z", q.z || 0)}${num("ptRx", "Turn X °", q.rx || 0, 5)}${num("ptRy", "Turn Y °", q.ry || 0, 5)}${num("ptRz", "Turn Z °", q.rz || 0, 5)}
      ${num("ptSx", "Width", q.sx || 1, 0.05)}${num("ptSy", "Height (size)", q.sy || 1, 0.05)}${num("ptSz", "Depth", q.sz || 1, 0.05)}${num("ptOp", "See-through (0.1-1)", q.opacity ?? 1, 0.05)}
      <div class="stHint">Or drag the arrows on the preview: W move, E turn, R size.${A ? " Legs swing from their top, so make each leg reach the ground (y = 0)." : ""}</div>`;
    if (A) h += `<div class="stH">PREVIEW</div><div class="stBtns"><button class="stB" id="pmHere">Move preview here</button><button class="stB go" id="anLoose">Let 3 loose here</button></div>
      <div class="stBtns"><select class="stSel" id="anIsle" style="flex:1"><option value="">Add to an island…</option>${islands.map((d, i) => `<option value="${i}">${esc(d.name)}${(d.animals || []).some(a => a.kind === p.key) ? " ✔" : ""}</option>`).join("")}</select></div>
      <div class="stHint">The preview stands still so you can edit it; let some loose to watch them move. Islands get animals in the Islands tab too. Saved in <b>content/animals.js</b>.</div>`;
    else h += `<div class="stH">PREVIEW</div><div class="stBtns"><button class="stB" id="pmHere">Move preview here</button><button class="stB go" id="pmPlace">Place one in the world</button></div>
      <div class="stHint">Your props are in the Place tab under <b>My props</b>, with every option (colour, glow, light, animation, what F does). Saved in <b>content/props.js</b>.</div>`;
    $("stLeftBody").innerHTML = h;
    bindMaker();
}
function bindMaker() {
    const M = mk(), A = M === MK.animals, body = $("stLeftBody"), on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
    body.querySelectorAll("[data-pm]").forEach(it => it.addEventListener("click", () => { M.sel = it.dataset.pm; partSel = -1; pmAt = null; renderMaker(); pmShowPreview(true); pmFrame(); }));
    on("pmNew", "click", () => pmNew());
    const p = pmCur(); if (!p) return;
    on("pmDup", "click", () => pmNew({ ...JSON.parse(JSON.stringify(p)), name: p.name + " 2" }));
    on("pmDel", "click", () => {
        if (A) {
            const used = islands.filter(d => (d.animals || []).some(a => a.kind === p.key));
            if (!confirm(`Delete ${p.name}?${used.length ? ` It leaves ${used.map(d => d.name).join(", ")} too.` : ""}`)) return;
            for (const d of used) { d.animals = d.animals.filter(a => a.kind !== p.key); rebuildIsle(islands.indexOf(d)); changed("islands"); }
        } else {
            const uses = world.objects.filter(o => o.prop === p.key);
            if (!confirm(`Delete ${p.name}?${uses.length ? ` The ${uses.length} you placed in the world go too.` : ""}`)) return;
            if (uses.length) { pushUndo(""); for (const o of uses) { T.placedRemove(o); world.objects.splice(world.objects.indexOf(o), 1); } changed("world"); }
        }
        pmClearPreview();
        M.drop(p.key); M.set(M.list().filter(q => q !== p)); M.sel = M.list()[0] ? M.list()[0].key : null; partSel = -1; changed(M.kind); renderMaker(); pmShowPreview(true);
    });
    on("pmAskGo", "click", () => askClaudeMaker(p));
    on("pmName", "input", e => { p.name = e.target.value.slice(0, 32) || M.Noun; pmApply(); }); on("pmName", "change", () => renderMaker());
    // a prop's bump size and light
    on("pmR", "input", e => { p.r = Math.min(6, Math.max(0, +e.target.value || 0)); pmApply(); });
    on("pmLight", "change", e => { p.light = e.target.checked ? { on: true, color: "#ffc070", power: 8, range: 12, y: 1.5 } : null; pmApply(true); });
    on("pmLightCol", "input", e => { p.light.color = e.target.value; pmApply(); });
    const lnum = (id, k, a, b) => on(id, "input", e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { p.light[k] = Math.min(b, Math.max(a, v)); pmApply(); } });
    lnum("pmLightP", "power", 0, 60); lnum("pmLightR", "range", 2, 60); lnum("pmLightY", "y", -2, 20);
    // how an animal acts
    on("anWay", "change", e => { p.way = e.target.value; pmApply(true); });
    const anum = (id, k, a, b, round) => on(id, "input", e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { p[k] = round ? Math.round(Math.min(b, Math.max(a, v))) : r3(Math.min(b, Math.max(a, v))); pmApply(); } });
    anum("anSize", "size", 0.1, 6); anum("anSpeed", "speed", 0.1, 6); anum("anRun", "run", 0.5, 14); anum("anFlee", "flee", 0, 30); anum("anAlt", "alt", 4, 60); anum("anHerd", "herd", 1, 8, true); anum("anPitch", "pitch", 60, 2000, true);
    on("anNight", "change", e => { p.night = e.target.checked; pmApply(); });
    on("anLoose", "click", () => { M.define(p); const at = pmAt || previewSpot(); const k = T.releaseAnimals(p.key, 3, at.x, at.z), night = T.getClock() < 6 || T.getClock() > 19.5; say(!k ? "Couldn't let them loose here" : p.way === "fly" ? (!!p.night !== night ? `${k} ${p.name}s let loose: they only fly ${p.night ? "at night" : "by day"}, so drag the clock to see them` : `${k} ${p.name}s let loose: look up!`) : `${k} ${p.name}s let loose. Watch them, or press F5 to walk up to them`, 4000); });
    on("anIsle", "change", e => { if (e.target.value === "") return; const i = +e.target.value; addAnimalToIsland(i, p.key); say(`${p.name} lives on ${islands[i].name} now`); renderMaker(); });
    // parts
    body.querySelectorAll("[data-part]").forEach(it => it.addEventListener("click", e => { if (e.target.closest("[data-pdup], [data-pdel]")) return; pmSelectPart(+it.dataset.part); }));
    body.querySelectorAll("[data-pdup]").forEach(b => b.addEventListener("click", () => { const i = +b.dataset.pdup, o = p.parts[i], c = { ...o, x: r3(A && o.x ? -o.x : (o.x || 0) + 0.3) }; p.parts.splice(i + 1, 0, c); partSel = i + 1; pmApply(true, true); })); // an animal's copy goes on the other side: a second leg, eye or ear
    body.querySelectorAll("[data-pdel]").forEach(b => b.addEventListener("click", () => { if (p.parts.length <= 1) { say(`A ${M.noun} needs at least one part`); return; } p.parts.splice(+b.dataset.pdel, 1); partSel = -1; pmApply(true, true); }));
    on("pmHere", "click", () => { pmShowPreview(true); pmFrame(); });
    on("pmPlace", "click", () => { pmClearPreview(); tab = "place"; pref("tab", tab); propCat = "mine"; pref("propCat", propCat); renderLeft(); startPlacing({ kind: "prop", prop: p.key }); say(`Click the ground to place ${p.name}`); });
    body.querySelectorAll("[data-padd]").forEach(b => b.addEventListener("click", () => { if (p.parts.length >= 60) { say("60 parts is the most"); return; } p.parts.push({ shape: b.dataset.padd, ...(A ? { role: "body" } : {}), x: 0, y: 0.5 + p.parts.length * 0.05, z: 0, sx: A ? 0.3 : 0.6, sy: A ? 0.3 : 0.6, sz: A ? 0.3 : 0.6, color: "#c8c8d0" }); partSel = p.parts.length - 1; pmApply(true, true); }));
    const q = p.parts[partSel]; if (!q) return;
    on("ptRole", "change", e => { q.role = e.target.value; pmApply(true); });
    on("ptShape", "change", e => { q.shape = e.target.value; pmApply(true, true); });
    on("ptCol", "input", e => { q.color = e.target.value; pmApply(); });
    on("ptGlow", "change", e => { q.glow = e.target.checked; pmApply(true); });
    on("ptTint", "change", e => { q.tint = e.target.checked; pmApply(true); });
    const pn = (id, k, a, b, deg) => on(id, "input", e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { q[k] = deg ? Math.round(v) : r3(Math.min(b, Math.max(a, v))); pmApply(); } });
    pn("ptX", "x", -20, 20); pn("ptY", "y", -5, 30); pn("ptZ", "z", -20, 20); pn("ptRx", "rx", -720, 720, 1); pn("ptRy", "ry", -720, 720, 1); pn("ptRz", "rz", -720, 720, 1);
    pn("ptSx", "sx", 0.02, 20); pn("ptSy", "sy", 0.02, 20); pn("ptSz", "sz", 0.02, 20); pn("ptOp", "opacity", 0.1, 1);
}

// =====================================================================
//  the People Maker: new kinds of people (content/people.js): how they look and what they say. By hand, or ask Claude
// =====================================================================
let myPeople = (Array.isArray(T.CONTENT_PEOPLE) ? T.CONTENT_PEOPLE : []).filter(p => p && /^p_/.test(p.key)).map(p => JSON.parse(JSON.stringify(p)));
let ppSel = myPeople[0] ? myPeople[0].key : null, ppPreview = null, ppAt = null, ppT = 0;
const PO = T.PERSON_OPTS;
const PLABEL = { hat: { none: "No hat", cap: "Cap", top: "Top hat", crown: "Crown", hood: "Hood", helmet: "Helmet", bandana: "Bandana", beanie: "Beanie", straw: "Straw hat", horns: "Horns", witch: "Witch hat", mask: "Miner's mask" },
    beardStyle: { none: "No beard", short: "Stubble", full: "Full", goatee: "Goatee", long: "Long" }, held: { none: "Nothing", lantern: "Lantern", staff: "Magic staff", sword: "Sword", book: "Book", torch: "Torch", rod: "Fishing rod", hammer: "Hammer" },
    anim: { wave: "Waves at you", smith: "Hammers away", witch: "Stirs a cauldron" } };
const ppCur = () => myPeople.find(p => p.key === ppSel) || null;
const ppKey = name => { const base = "p_" + slug(name, "person"); let k = base, n = 2; while (T.NPC_LOOKS[k] || myPeople.some(p => p.key === k)) k = base + "_" + n++; return k; };
function starterPerson() {
    return { name: "New Person", lines: ["Hello there!", "Lovely day for chopping, isn't it?"], look: { skin: "#f0c8a0", shirt: "#3a6a9a", pants: "#2a2a3a", boots: "#2a1a12", belt: "#2a1a12", wide: 1, size: 1, hairStyle: "short", hair: "#6a4a2a", hat: "none", hatCol: "#2a2a30",
        beardStyle: "none", beard: "#6a4a2a", held: "none", heldCol: "#8a8a96", anim: "wave", face: { eyes: "round", eyeCol: "#2a5a8a", brows: "normal", mouth: "smile", nose: "small", moustache: "none" } } };
}
function ppClear() { if (ppPreview) { T.placedRemove(ppPreview.o); ppPreview = null; } }
function ppShow(move) {
    const p = ppCur(); if (!p || tab !== "people" || mode !== "edit") { ppClear(); return; }
    if (!ppAt || move) { let s = previewSpot(); const f = fwd().setY(0).normalize(); if (Math.hypot(s.x - cam.pos.x, s.z - cam.pos.z) < 3.5) s = { x: cam.pos.x + f.x * 4.5, z: cam.pos.z + f.z * 4.5 }; ppAt = { x: s.x, z: s.z }; }
    ppClear();
    ppPreview = T.placedBuild({ id: "__pp", isle: curIsle(), kind: "npc", look: p.key, x: ppAt.x, y: T.groundY(ppAt.x, ppAt.z), z: ppAt.z, rx: 0, ry: Math.atan2(cam.pos.x - ppAt.x, cam.pos.z - ppAt.z), rz: 0, s: 1, solid: false, label: p.name.toUpperCase(), labelCol: "#ffd890" });
}
function ppApply(rerender) { // the new look goes into the game: the preview, and everyone of this kind you've placed
    const p = ppCur(); if (!p) return;
    changed("people"); clearTimeout(ppT);
    ppT = setTimeout(() => { T.defineCustomPerson(p); ppShow(); for (const rec of T.placed.slice()) if (rec.o.look === p.key && rec.o.id !== "__pp") T.placedRebuild(rec.o); }, 150);
    if (rerender) renderPeople();
}
function ppFrame() { if (!ppPreview) return; const c = ppPreview.g.position.clone().add(new THREE.Vector3(0, 1.1, 0)), f = fwd().setY(0).normalize(); cam.pos.copy(c).addScaledVector(f, -3.6).add(new THREE.Vector3(0, 0.4, 0)); lookAtPoint(c); }
function ppNew(base) { const p = base || starterPerson(); p.key = ppKey(p.name); myPeople.push(p); ppSel = p.key; ppAt = null; T.defineCustomPerson(p); changed("people"); renderPeople(); ppShow(true); ppFrame(); }
function placePerson(n, p) { // a resident: near the camp, facing it, ready to talk
    const s = campSpot(n); if (!s) return false;
    const o = { id: newId(), isle: n, kind: "npc", look: p.key, x: s.x, y: s.y, z: s.z, rx: 0, ry: s.ry, rz: 0, s: 1, solid: true, label: p.name.toUpperCase(), labelCol: "#ffd890", act: { type: "talk", who: p.name, lines: (p.lines || []).length ? p.lines.slice() : ["Hello!"] }, gen: true };
    world.objects.push(o); T.placedBuild(o); changed("world"); return true;
}
// a shop Claude invented: its building facing the camp, and its keeper standing out front
function placeShop(n, s, bld, keeper, act) {
    const C = T.customIsle(n), c0 = C && islandSpot(n, { dir: s.dir, dist: Math.min(0.6, Math.max(0.25, +s.dist || 0.4)) }); if (!c0) return false;
    const len = Math.hypot(c0.x, c0.z) || 1, ry = r3(Math.atan2(-c0.x, -c0.z));
    if (bld) { const o = { id: newId(), isle: n, kind: "prop", prop: bld.key, x: r3(c0.x), y: r3(C.groundY(c0.x, c0.z)), z: r3(c0.z), rx: 0, ry, rz: 0, s: 1, solid: true, gen: true }; world.objects.push(o); T.placedBuild(o); }
    const off = bld ? Math.min(6, Math.max(1, +bld.r || 2.5)) + 1.4 : 0, x = r3(c0.x - (c0.x / len) * off), z = r3(c0.z - (c0.z / len) * off);
    const o = { id: newId(), isle: n, kind: "npc", look: keeper ? keeper.key : "villager", x, y: r3(C.groundY(x, z)), z, rx: 0, ry, rz: 0, s: 1, solid: true, label: act.title.toUpperCase(), labelCol: act.color || "#ffd890", act, gen: true };
    world.objects.push(o); T.placedBuild(o); changed("world"); return true;
}
// a shop from Claude's answer, every field checked. Materials are named, so they're matched to this island's (or the game's) by name;
// materials for sale cost more than the trading post pays for them (with the rebirth bonus a player there has), so nothing is bought to sell back
function cleanShop(s, d, keeper) {
    const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : ""), hex = v => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : "");
    const matKey = v => { const nm = str(v, 40).toLowerCase(); if (!nm) return null; const m = (d.mats || []).find(q => q.name.toLowerCase() === nm || q.key === nm); if (m) return m.key; const e = Object.entries(T.MATS).find(([k, q]) => k === nm || q.name.toLowerCase() === nm); return e ? e[0] : null; };
    const bonus = 1 + 0.5 * (T.CI_BASE + Math.max(0, islands.indexOf(d)) + 2), worth = k => ((T.MATS[k] && +T.MATS[k].price) || 0) * bonus; // a few rebirths past this island, to be safe
    const items = (Array.isArray(s.items) ? s.items : []).filter(it => it && typeof it === "object" && str(it.name, 40)).slice(0, 8).map(it => {
        const mats = {}; if (it.mats && typeof it.mats === "object") for (const [k, v] of Object.entries(it.mats)) { const mk = matKey(k); if (mk && +v > 0) mats[mk] = Math.min(999, Math.round(+v)); }
        let cash = Math.round(Math.min(1e10, Math.max(0, +it.cash || 0)));
        const g = it.give && typeof it.give === "object" ? it.give : {}, gm = matKey(g.mat);
        const give = T.BUFFS[g.buff] ? { buff: g.buff, secs: Math.round(Math.min(900, Math.max(30, +g.secs || 180))) } : gm && +g.n > 0 ? { mat: gm, n: Math.min(999, Math.round(+g.n)) } : { heal: true };
        const matsWorth = Object.entries(mats).reduce((t, [k, v]) => t + worth(k) * v, 0);
        if (give.mat) cash = Math.max(cash, Math.ceil(worth(give.mat) * give.n * 1.5 - matsWorth)); // dearer than selling them back
        return { name: str(it.name, 40), desc: str(it.desc, 140), icon: Array.from(str(it.icon, 8)).slice(0, 2).join("") || "✦", cash, mats, give };
    });
    return { type: "shop", title: str(s.title, 40) || "The Shop", who: keeper ? keeper.name : str(s.who, 30), greeting: str(s.greeting, 160), color: hex(s.color), items };
}
// ---- Ask Claude for a person: one short request, every field checked ----
function cleanPerson(src, into) {
    const hex = v => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : null), pick = (k, v, d) => (PO[k].includes(v) ? v : d), numv = (v, a, b, d) => { v = +v; return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
    const p = JSON.parse(JSON.stringify(into)), L = (src && src.look) || {}, F = L.face || {};
    if (typeof src.name === "string" && src.name.trim()) p.name = src.name.trim().slice(0, 32);
    if (Array.isArray(src.lines)) { const ln = src.lines.filter(s => typeof s === "string" && s.trim()).map(s => s.trim().slice(0, 160)).slice(0, 6); if (ln.length) p.lines = ln; }
    for (const k of ["skin", "shirt", "pants", "boots", "belt", "hair", "hatCol", "beard", "heldCol"]) if (hex(L[k])) p.look[k] = hex(L[k]);
    for (const k of ["apron", "vest", "cape", "scarf"]) { if (hex(L[k])) p.look[k] = hex(L[k]); else delete p.look[k]; }
    p.look.wide = r3(numv(L.wide, 0.7, 1.6, p.look.wide || 1)); p.look.size = r3(numv(L.size, 0.6, 1.5, p.look.size || 1)); p.look.belly = !!L.belly; p.look.ghost = !!L.ghost;
    for (const k of ["hairStyle", "hat", "beardStyle", "held", "anim"]) p.look[k] = pick(k, L[k], p.look[k] || PO[k][0]);
    const f = (p.look.face = p.look.face || {});
    for (const k of ["eyes", "brows", "mouth", "nose", "moustache"]) f[k] = pick(k, F[k], f[k] || PO[k][0]);
    for (const k of ["eyeCol", "moustacheCol", "paintCol"]) if (hex(F[k])) f[k] = hex(F[k]);
    for (const k of T.FACE_EXTRAS) f[k] = !!F[k];
    return p;
}
const personPrompt = desc => `Design a person for a spooky, cheerful low-poly tree-chopping game from this description: "${desc}"
They're chunky little villagers made of boxes. You choose their colours, clothes, hair, hat, beard, what they hold, how they move, their face, and what they say when the player talks to them.
Return JSON: {"name": "their name, 1-3 words", "lines": 3-5 things they say, in character, short and funny (under 120 characters each),
 "look": {"skin": "#rrggbb", "shirt": "#rrggbb", "pants": "#rrggbb", "boots": "#rrggbb", "belt": "#rrggbb", "wide": 0.8-1.5 (how broad), "size": 0.7-1.3 (how tall), "belly": bool, "ghost": bool (see-through and glowing),
  "hairStyle": "${PO.hairStyle.join("|")}", "hair": "#rrggbb", "hat": "${PO.hat.join("|")}", "hatCol": "#rrggbb", "beardStyle": "${PO.beardStyle.join("|")}", "beard": "#rrggbb",
  "apron": "#rrggbb" or leave it out, "vest": "#rrggbb" or leave it out, "cape": "#rrggbb" or leave it out, "scarf": "#rrggbb" or leave it out,
  "held": "${PO.held.join("|")}", "heldCol": "#rrggbb", "anim": "wave|smith|witch" (wave = waves at the player, smith = hammers away, witch = stirs a cauldron),
  "face": {"eyes": "${PO.eyes.join("|")}", "eyeCol": "#rrggbb", "brows": "${PO.brows.join("|")}", "mouth": "${PO.mouth.join("|")}", "nose": "${PO.nose.join("|")}", "moustache": "${PO.moustache.join("|")}", "moustacheCol": "#rrggbb",
   "glasses": bool, "monocle": bool, "eyepatch": bool, "scar": bool, "freckles": bool, "blush": bool, "stitches": bool, "paint": bool (war paint), "paintCol": "#rrggbb"}}}
Make them match the description and look distinct.`;
async function claudePerson(desc, model) {
    const r = await askQ({ prompt: personPrompt(desc), system: "You design characters for Hypergamous Tree Chopping Simulator 4, a spooky, cheerful first-person tree-chopping game. Reply with ONLY one JSON object: no prose, no code fences.", model });
    if (!r.ok) return { ok: false, error: r.error };
    let j = null; try { j = JSON.parse((r.text.match(/\{[\s\S]*\}/) || [""])[0]); } catch (e) { /* not JSON */ }
    if (!j || !j.look) return { ok: false, error: "Claude's answer wasn't a person. Try again or reword it." };
    return { ok: true, data: j, tokens: r.tokens, ms: r.ms, model: r.model };
}
async function askClaudePeople(p) {
    const desc = ($("ppAsk").value || "").trim(), msg = $("ppAskMsg"), btn = $("ppAskGo");
    if (!desc) { msg.className = "stMsg bad"; msg.textContent = "Describe the person first."; return; }
    const model = $("ppModel").value; pref("model", model);
    btn.disabled = true; btn.textContent = "Claude is dressing them…"; msg.className = "stMsg"; msg.textContent = `Asking ${model}…`;
    const res = await claudePerson(desc, model);
    const b2 = $("ppAskGo"); if (b2) { b2.disabled = false; b2.textContent = "Design them with Claude"; }
    if (!res.ok) { const m = $("ppAskMsg"); if (m) { m.className = "stMsg bad"; m.textContent = res.error; } return; }
    if (!myPeople.includes(p)) return;
    Object.assign(p, cleanPerson(res.data, p)); T.defineCustomPerson(p); changed("people");
    for (const rec of T.placed.slice()) if (rec.o.look === p.key && rec.o.id !== "__pp") T.placedRebuild(rec.o);
    if (tab === "people" && ppSel === p.key) { renderPeople(); ppShow(); const m2 = $("ppAskMsg"); if (m2) { m2.className = "stMsg good"; m2.textContent = `${p.name}, designed by ${res.model} in ${(res.ms / 1000).toFixed(1)}s · ~${(res.tokens / 1000).toFixed(1)}k tokens`; } $("ppAsk") && ($("ppAsk").value = desc); }
}
function renderPeople() {
    const p = ppCur(), model = pref("model") || "haiku";
    const sel = (id, k, v, labels) => `<select class="stSel" id="${id}">${PO[k].map(x => opt(x, v, (labels && labels[x]) || x[0].toUpperCase() + x.slice(1))).join("")}</select>`, col = (id, v) => `<input class="stIn" type="color" id="${id}" value="${v || "#808080"}">`;
    let h = `<div class="stH">MY PEOPLE <small>${myPeople.length ? myPeople.length + " made" : ""}</small></div>
      <div class="stList">${myPeople.map(q => `<div class="stItem${q.key === ppSel ? " on" : ""}" data-pp="${esc(q.key)}"><span>🧍 ${esc(q.name)}</span><small>${esc(((q.lines || [])[0] || "").slice(0, 26))}</small></div>`).join("") || `<div class="stHint">No people yet. Make one, or describe them and let Claude design them.</div>`}</div>
      <div class="stBtns"><button class="stB go" id="ppNew">+ New person</button>${p ? `<button class="stB" id="ppDup">Duplicate</button><button class="stB warn" id="ppDel">Delete</button>` : ""}</div>`;
    if (!p) { $("stLeftBody").innerHTML = h; bindPeople(); return; }
    const L = p.look, F = L.face || (L.face = {}), swatch = (id, v, label) => `<label style="display:flex;gap:5px;align-items:center">${col(id, v)} ${label}</label>`;
    h += `<div class="stClaude" style="margin-top:12px"><div class="stH">✦ ASK CLAUDE <select class="stSel" id="ppModel">${opt("haiku", model, "Haiku (cheapest)")}${opt("sonnet", model, "Sonnet")}${opt("opus", model, "Opus")}</select></div>
        <textarea class="stTa" id="ppAsk" placeholder="Describe a person, e.g. a nervous lighthouse keeper with a huge grey beard and a yellow raincoat"></textarea>
        <div class="stBtns"><button class="stB" id="ppAskGo" style="flex:1">Design them with Claude</button></div><div class="stMsg" id="ppAskMsg"></div></div>
      <div class="stH">NAME</div><div class="stRow"><input class="stIn" type="text" id="ppName" value="${esc(p.name)}" style="flex:1"><small style="opacity:.5">${esc(p.key)}</small></div>
      <div class="stH">WHAT THEY SAY <small>one line per F press</small></div><textarea class="stTa" id="ppLines">${esc((p.lines || []).join("\n"))}</textarea>
      <div class="stH">BODY</div>
      <div class="stChecks">${swatch("ppSkin", L.skin, "Skin")}${swatch("ppShirt", L.shirt, "Shirt")}${swatch("ppPants", L.pants, "Trousers")}${swatch("ppBoots", L.boots, "Boots")}${swatch("ppBelt", L.belt, "Belt")}</div>
      ${num("ppWide", "Build (0.7 thin – 1.6 broad)", L.wide || 1, 0.05)}${num("ppSize", "Height (0.6 – 1.5)", L.size || 1, 0.05)}
      <div class="stChecks"><label><input type="checkbox" id="ppBelly"${L.belly ? " checked" : ""}> Belly</label><label><input type="checkbox" id="ppGhost"${L.ghost ? " checked" : ""}> Ghost</label></div>
      <div class="stChecks">${["apron", "vest", "cape", "scarf"].map(k => `<label style="display:flex;gap:5px;align-items:center"><input type="checkbox" data-wear="${k}"${L[k] ? " checked" : ""}> ${k[0].toUpperCase() + k.slice(1)} ${col("ppW_" + k, L[k] || "#7a3a2a")}</label>`).join("")}</div>
      <div class="stH">HAIR, HAT AND BEARD</div>
      <div class="stRow"><label>Hair</label><span>${sel("ppHairS", "hairStyle", L.hairStyle || "short")} ${col("ppHair", L.hair)}</span></div>
      <div class="stRow"><label>Hat</label><span>${sel("ppHat", "hat", L.hat || "none", PLABEL.hat)} ${col("ppHatCol", L.hatCol)}</span></div>
      <div class="stRow"><label>Beard</label><span>${sel("ppBeardS", "beardStyle", L.beardStyle || "none", PLABEL.beardStyle)} ${col("ppBeard", L.beard)}</span></div>
      <div class="stH">FACE</div>
      <div class="stRow"><label>Eyes</label><span>${sel("ppEyes", "eyes", F.eyes || "round")} ${col("ppEyeCol", F.eyeCol || "#2a5a8a")}</span></div>
      <div class="stRow"><label>Eyebrows</label>${sel("ppBrows", "brows", F.brows || "normal")}</div>
      <div class="stRow"><label>Mouth</label>${sel("ppMouth", "mouth", F.mouth || "smile")}</div>
      <div class="stRow"><label>Nose</label>${sel("ppNose", "nose", F.nose || "small")}</div>
      <div class="stRow"><label>Moustache</label><span>${sel("ppMous", "moustache", F.moustache || "none")} ${col("ppMousCol", F.moustacheCol || L.hair || "#4a2a1a")}</span></div>
      <div class="stChecks">${T.FACE_EXTRAS.map(k => `<label><input type="checkbox" data-fx="${k}"${F[k] ? " checked" : ""}> ${({ paint: "War paint" })[k] || k[0].toUpperCase() + k.slice(1)}</label>`).join("")}</div>
      ${F.paint ? `<div class="stRow"><label>War paint colour</label>${col("ppPaint", F.paintCol || "#c03030")}</div>` : ""}
      <div class="stH">HOLDS AND DOES</div>
      <div class="stRow"><label>Holds</label><span>${sel("ppHeld", "held", L.held || "none", PLABEL.held)} ${col("ppHeldCol", L.heldCol || "#8a8a96")}</span></div>
      <div class="stRow"><label>Moves</label>${sel("ppAnim", "anim", L.anim || "wave", PLABEL.anim)}</div>
      <div class="stH">PREVIEW</div><div class="stBtns"><button class="stB" id="ppHere">Move preview here</button><button class="stB go" id="ppPlace">Place one in the world</button></div>
      <div class="stHint">Your people are also in the Place tab's Person look list, and Ask Claude can invent residents for an island. Saved in <b>content/people.js</b>.</div>`;
    $("stLeftBody").innerHTML = h;
    bindPeople();
}
function bindPeople() {
    const body = $("stLeftBody"), on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
    body.querySelectorAll("[data-pp]").forEach(it => it.addEventListener("click", () => { ppSel = it.dataset.pp; ppAt = null; renderPeople(); ppShow(true); ppFrame(); }));
    on("ppNew", "click", () => ppNew());
    const p = ppCur(); if (!p) return;
    const L = p.look, F = L.face || (L.face = {});
    on("ppDup", "click", () => ppNew({ ...JSON.parse(JSON.stringify(p)), name: p.name + " 2" }));
    on("ppDel", "click", () => {
        const uses = world.objects.filter(o => o.look === p.key);
        if (!confirm(`Delete ${p.name}?${uses.length ? ` The ${uses.length} placed in the world become plain villagers.` : ""}`)) return;
        ppClear(); T.dropCustomPerson(p.key); myPeople = myPeople.filter(q => q !== p);
        for (const o of uses) { o.look = "villager"; T.placedRebuild(o); }
        if (uses.length) changed("world");
        ppSel = myPeople[0] ? myPeople[0].key : null; changed("people"); renderPeople(); ppShow(true);
    });
    on("ppAskGo", "click", () => askClaudePeople(p));
    on("ppName", "input", e => { p.name = e.target.value.slice(0, 32) || "Person"; ppApply(); }); on("ppName", "change", () => renderPeople());
    on("ppLines", "input", e => { p.lines = e.target.value.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 8); changed("people"); });
    const c = (id, set) => on(id, "input", e => { set(e.target.value); ppApply(); });
    c("ppSkin", v => (L.skin = v)); c("ppShirt", v => (L.shirt = v)); c("ppPants", v => (L.pants = v)); c("ppBoots", v => (L.boots = v)); c("ppBelt", v => (L.belt = v));
    c("ppHair", v => (L.hair = v)); c("ppHatCol", v => (L.hatCol = v)); c("ppBeard", v => (L.beard = v)); c("ppEyeCol", v => (F.eyeCol = v)); c("ppMousCol", v => (F.moustacheCol = v)); c("ppPaint", v => (F.paintCol = v)); c("ppHeldCol", v => (L.heldCol = v));
    const n2 = (id, k, a, b) => on(id, "input", e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { L[k] = r3(Math.min(b, Math.max(a, v))); ppApply(); } });
    n2("ppWide", "wide", 0.7, 1.6); n2("ppSize", "size", 0.6, 1.5);
    on("ppBelly", "change", e => { L.belly = e.target.checked; ppApply(); }); on("ppGhost", "change", e => { L.ghost = e.target.checked; ppApply(); });
    body.querySelectorAll("[data-wear]").forEach(b => b.addEventListener("change", () => { const k = b.dataset.wear; if (b.checked) L[k] = $("ppW_" + k).value; else delete L[k]; ppApply(); }));
    for (const k of ["apron", "vest", "cape", "scarf"]) on("ppW_" + k, "input", e => { if (L[k]) { L[k] = e.target.value; ppApply(); } });
    const s = (id, set) => on(id, "change", e => { set(e.target.value); ppApply(); });
    s("ppHairS", v => (L.hairStyle = v)); s("ppHat", v => (L.hat = v)); s("ppBeardS", v => (L.beardStyle = v)); s("ppEyes", v => (F.eyes = v)); s("ppBrows", v => (F.brows = v)); s("ppMouth", v => (F.mouth = v)); s("ppNose", v => (F.nose = v)); s("ppMous", v => (F.moustache = v)); s("ppHeld", v => (L.held = v)); s("ppAnim", v => (L.anim = v));
    body.querySelectorAll("[data-fx]").forEach(b => b.addEventListener("change", () => { F[b.dataset.fx] = b.checked; ppApply(b.dataset.fx === "paint"); }));
    on("ppHere", "click", () => { ppShow(true); ppFrame(); });
    on("ppPlace", "click", () => { ppClear(); tab = "place"; pref("tab", tab); renderLeft(); startPlacing({ kind: "npc", look: p.key, solid: true, label: p.name.toUpperCase(), labelCol: "#ffd890", act: { type: "talk", who: p.name, lines: (p.lines || []).length ? p.lines.slice() : ["Hello!"] } }); say(`Click the ground to place ${p.name}`); });
}

// ---------- moving what the game built (a bed, a stall, a rock...): saved as "moves" in content/world.js ----------
let builtMode = false, bsel = null; // bsel: { n, i, o }
const moveOf = (n, i) => T.MOVES.find(m => +m.isle === n && m.i === i);
function setBuiltMode(on) { builtMode = on; $("stBuilt").classList.toggle("on", on); if (!on && bsel) deselect(); if (on) sculpt.mode = ""; say(on ? "Click anything the game built to move it (W move, E turn, R size)" : "Built-ins: off", 3000); }
function pickBuiltin(mx, my) {
    const n = curIsle(), G = T.isleGroup(n); if (!G) return null;
    setRay(mx, my);
    const E = T.enchTable, eh = E && E.g.visible ? ray.intersectObject(E.g, true)[0] : null; // the enchanting table isn't part of the island, but moves like it
    for (const h of ray.intersectObjects(G.children, true)) { if (!h.object.visible) continue; if (eh && eh.distance < h.distance) break; const i = T.builtinIndexOf(n, h.object); if (i >= 0) return { n, i, dist: h.distance }; }
    return eh ? { n, i: "ench", dist: eh.distance } : null;
}
function selectBuiltin(b) {
    if (sel || pmGizmo) deselect();
    const o = T.builtinAt(b.n, b.i); if (!o) return;
    T.moveHome(o, b.n); bsel = { n: b.n, i: b.i, o };
    tc.attach(o); renderInspector();
}
function bFromGizmo(final) { // you dragged it: its move follows (it turns round, but never tips over)
    if (!bsel) return;
    const { n, i, o } = bsel, H = T.moveHome(o, n);
    o.rotation.x = H.rot.x; o.rotation.z = H.rot.z;
    let m = moveOf(n, i); if (!m) { m = { isle: n, i }; T.MOVES.push(m); }
    const k0 = m.s || 1, ks = [o.scale.x / H.scale.x, o.scale.y / H.scale.y, o.scale.z / H.scale.z], k = ks.reduce((a, v) => (Math.abs(v - k0) > Math.abs(a - k0) ? v : a), k0);
    m.x = r3(o.position.x); m.y = r3(o.position.y); m.z = r3(o.position.z); m.ry = r3(o.rotation.y); m.s = r3(Math.min(10, Math.max(0.1, k)));
    if (gzMode === "scale") o.scale.copy(H.scale).multiplyScalar(m.s);
    if (final) { T.placeBuiltin(n, m); changed("world"); renderInspector(); }
}
function renderBuiltinInspector() {
    const box = $("stInsp"), m = moveOf(bsel.n, bsel.i) || {};
    right.classList.remove("empty");
    const ench = bsel.i === "ench";
    box.innerHTML = `<div class="stH">${ench ? "THE ENCHANTING TABLE" : "BUILT-IN THING"} <small>${ench ? "" : "#" + bsel.i + " · "}${esc(isleName(bsel.n))}</small></div>
      <div class="stHint" style="margin-top:0">${ench ? "Every island has one. Drag the arrows: <b>W</b> move, <b>E</b> turn, <b>R</b> size. It always stands on the ground, and its label and \"press F\" spot go with it." : "Part of the island the game builds. Drag the arrows: <b>W</b> move, <b>E</b> turn, <b>R</b> size. Its collisions, its floating label and its \"press F\" spot (a bed, a stall, the Ferryman) go with it."}</div>
      <div class="stBtns"><button class="stB" id="bHide">${m.hide ? "Show it again" : "Hide it"}</button><button class="stB warn" id="bReset">Put it back</button><button class="stB" id="bDone">Done</button></div>
      ${builtinLabelRows(m)}
      <div class="stHint">Saved in <b>content/world.js</b> and ships on your next release. Put it back undoes its names too.</div>`;
    bindBuiltinLabels();
    $("bHide").addEventListener("click", () => { let mm = moveOf(bsel.n, bsel.i); if (!mm) { mm = { isle: bsel.n, i: bsel.i }; T.MOVES.push(mm); } if (mm.hide) delete mm.hide; else mm.hide = true; T.placeBuiltin(bsel.n, mm); changed("world"); renderInspector(); });
    $("bReset").addEventListener("click", () => { const { n, i } = bsel, at = T.MOVES.findIndex(q => +q.isle === n && q.i === i); if (at >= 0) T.MOVES.splice(at, 1); T.placeBuiltin(n, { isle: n, i }); changed("world"); renderInspector(); say("Back where the game put it"); });
    $("bDone").addEventListener("click", () => deselect());
}
// its floating names (the forge's sign name, the Ferryman, BED, the casino...): text, colour, size, height, or hidden. Something with none can be given one
const rgbHex = s => { const m = String(s || "").match(/\d+/g); return m && m.length >= 3 ? "#" + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, "0")).join("") : /^#[0-9a-f]{6}$/i.test(s) ? s : "#ffd040"; };
function builtinLabelRows(m) {
    const labs = T.builtinLabels(bsel.n, bsel.i), Ls = m.labels || [], rows = labs.length ? labs : [null];
    let h = `<div class="stH">FLOATING NAME${labs.length > 1 ? "S" : ""} <small>${labs.length ? "change or hide" : "it has none: type one to give it one"}</small></div>`;
    rows.forEach((l, k) => {
        const L = Ls[k] || {}, orig = l ? (l.orig ? l.orig.text : l.el.textContent) : "", col = L.col || (l ? rgbHex(l.orig ? l.orig.col : l.el.style.color) : "#ffd040");
        h += `<div class="stItem" style="display:block" data-bl="${k}">
          <div class="stRow"><label>Text</label><input class="stIn" type="text" data-blf="text" value="${esc(L.text || "")}" placeholder="${esc(orig || "a name…")}"></div>
          <div class="stRow"><label>Colour</label><input class="stIn" type="color" data-blf="col" value="${col}"></div>
          <div class="stRow"><label>Size</label><span style="display:flex;align-items:center;gap:6px"><input type="range" data-blf="size" min="0.4" max="3" step="0.1" value="${L.size || 1}" style="width:110px"><small>${L.size || 1}×</small></span></div>
          <div class="stRow"><label>Higher by</label><input class="stIn" type="number" data-blf="dy" step="0.2" value="${L.dy || 0}" style="width:70px"></div>
          <div class="stChecks"><label><input type="checkbox" data-blf="hide"${L.hide ? " checked" : ""}> Hide it</label></div></div>`;
    });
    return h;
}
function bindBuiltinLabels() {
    right.querySelectorAll("[data-bl]").forEach(row => {
        const k = +row.dataset.bl;
        row.querySelectorAll("[data-blf]").forEach(f => f.addEventListener(f.type === "checkbox" ? "change" : "input", () => {
            if (!bsel) return;
            let mm = moveOf(bsel.n, bsel.i); if (!mm) { mm = { isle: bsel.n, i: bsel.i }; T.MOVES.push(mm); }
            const ls = (mm.labels = mm.labels || []), L = (ls[k] = ls[k] || {}), key = f.dataset.blf;
            if (key === "text") { const v = f.value.trim().slice(0, 40); if (v) L.text = v; else delete L.text; }
            else if (key === "col") L.col = f.value;
            else if (key === "size") { f.nextElementSibling.textContent = f.value + "×"; if (+f.value === 1) delete L.size; else L.size = +f.value; }
            else if (key === "dy") { const v = parseFloat(f.value); if (!v) delete L.dy; else L.dy = r3(Math.min(40, Math.max(-20, v))); }
            else if (key === "hide") { if (f.checked) L.hide = true; else delete L.hide; }
            for (let j = 0; j < ls.length; j++) if (!ls[j]) ls[j] = {}; // no holes
            if (ls.every(q => !Object.keys(q).length)) delete mm.labels;
            T.placeBuiltin(bsel.n, mm); changed("world");
        }));
    });
}
// ---------- the terrain tool: paint a Studio island's ground higher, lower or flat (saved with the island as brush dabs) ----------
const sculpt = { mode: "", r: +pref("brushR") || 8, k: +pref("brushK") || 0.6 };
let stroke = null, strokes = [], eraseT = 0;
const brushRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
brushRing.rotation.x = -Math.PI / 2; brushRing.renderOrder = 999; brushRing.visible = false; T.scene.add(brushRing);
const sculptIsle = () => { const d = islands[islandSel]; return d && curIsle() === T.CI_BASE + islandSel ? d : null; };
const sculptOn = () => mode === "edit" && tab === "islands" && !!sculpt.mode && !!sculptIsle();
function moveBrush(mx, my) {
    const h = groundHit(mx, my);
    brushRing.visible = !!h;
    if (h) { brushRing.position.set(h.x, h.y + 0.15, h.z); brushRing.scale.setScalar(sculpt.r); if (stroke) dab(h); }
}
function dab(h, first) {
    const d = sculptIsle(), C = T.customIsle(curIsle()); if (!d || !C || !stroke) return;
    d.sculpt = Array.isArray(d.sculpt) ? d.sculpt : [];
    if (sculpt.mode === "erase") { // takes away the dabs under the brush
        if (!first && performance.now() - eraseT < 120) return; eraseT = performance.now();
        const n0 = d.sculpt.length; d.sculpt = d.sculpt.filter(op => Math.hypot(op[0] - h.x, op[1] - h.z) > sculpt.r); if (d.sculpt.length === n0) return;
        C.setSculpt(d.sculpt); T.ciReshape(C); strokes = []; stroke.dirty = true; return;
    }
    if (!first && Math.hypot(h.x - stroke.x, h.z - stroke.z) < sculpt.r * 0.3) return;
    if (d.sculpt.length >= 4000) { say("That's as much sculpting as an island can hold: erase some first"); return; }
    stroke.x = h.x; stroke.z = h.z;
    const op = [r3(h.x), r3(h.z), sculpt.r, sculpt.mode === "flat" ? r3(stroke.t) : r3((sculpt.mode === "lower" ? -1 : 1) * sculpt.k * 0.3), sculpt.mode === "flat" ? 1 : 0];
    d.sculpt.push(op); C.addSculpt(op); T.ciReshape(C, op[0], op[1], op[2]); stroke.dirty = true;
}
function startStroke(mx, my) { const h = groundHit(mx, my), d = sculptIsle(); if (!h || !d) return; stroke = { x: h.x, z: h.z, t: h.y, start: (d.sculpt || []).length, dirty: false }; dab(h, true); }
function endStroke() {
    const d = sculptIsle(), C = T.customIsle(curIsle()), s = stroke; stroke = null; if (!s || !d || !C || !s.dirty) return;
    if (sculpt.mode !== "erase") strokes.push(s.start);
    T.ciSettle(C); changed("islands"); renderIslands();
}
function undoStroke() {
    const d = sculptIsle(), C = T.customIsle(curIsle()); if (!d || !C || !strokes.length) { say("Nothing to undo"); return; }
    d.sculpt.length = Math.min(d.sculpt.length, strokes.pop()); C.setSculpt(d.sculpt); T.ciReshape(C); T.ciSettle(C); changed("islands"); renderIslands();
}

// ---------- play-testing ----------
let camSaved = null;
function play() {
    if (mode !== "edit") return;
    cancelPlacing(); tc.detach(); clearPreview(); pmClearPreview(); ppClear();
    T.setSeeAll(false); // new trees grow the way players see them
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
    T.setState("studio"); T.setSeeAll(true);
    try { document.exitPointerLock(); } catch (e) { /* not locked */ }
    for (const k in T.keys) T.keys[k] = false;
    document.body.classList.add("studio-edit"); document.body.classList.remove("studio-play");
    if (camSaved) { cam.pos.copy(camSaved.pos); cam.yaw = camSaved.yaw; cam.pitch = camSaved.pitch; }
    if (sel) select(sel);
    if (tab === "trees") showPreview();
    if (makerTab()) pmShowPreview();
    if (tab === "people") ppShow();
    syncBar();
}

// =====================================================================
//  the Release panel: version, notes, checks, one confirmed click, then watch GitHub build it
// =====================================================================
const relEl = document.createElement("div"); relEl.id = "stRel"; relEl.className = "st";
document.body.append(relEl);
const R = { status: null, checks: null, version: "", title: "", notes: "", checking: false, busy: false, steps: {}, error: "", done: null, ci: null, ciTimer: 0, ciStart: 0, drafting: false };
const STEPS = [["package", "Set the version and notes in package.json"], ["commit", "Commit everything"], ["main", "Ship from main"], ["push", "Push main to GitHub"], ["tag", "Tag the version and push the tag"]];
const vparts = v => String(v).replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
const vNewer = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
const vBump = (v, k) => { const [a, b, c] = vparts(v); return k === "major" ? `${a + 1}.0.0` : k === "minor" ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`; };
const released = () => { const S = R.status; if (!S) return "0.0.0"; const t = (S.lastTag || "v0.0.0").slice(1); return vNewer(S.version, t) ? S.version : t; };
const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
// a first draft from what changed: new trees, things placed on each island, and the commits (minus the editor's own)
function draftNotes() {
    const S = R.status, L = [];
    if (!S) return "";
    for (const t of S.content.trees) {
        if (t.change === "new") L.push(`- NEW TREE: the ${t.name}${t.isl.length ? ", growing on " + t.isl.join(" and ") : ""}.${t.night ? " It only comes out at night." : ""}${t.rare ? " It's rare." : ""}`);
        else if (t.change === "changed") L.push(`- The ${t.name} has been retuned.`);
        else L.push(`- The ${t.name} is gone.`);
    }
    for (const d of S.content.islands || []) {
        if (d.change === "new") L.push(`- REBIRTH ${d.rebirth}: ${d.name.toUpperCase()}${d.sub ? `, ${d.sub}` : ""}. Talk to the Ferryman on ${d.rebirth === 6 ? "the Iceberg" : "the island before"} to sail there.`);
        else if (d.change === "changed") L.push(`- ${d.name} has been reshaped.`);
    }
    const newProps = (S.content.props || []).filter(p => p.placed).map(p => p.name);
    if (newProps.length) L.push(`- NEW PROP${newProps.length === 1 ? "" : "S"}: ${newProps.slice(0, 4).join(", ")}${newProps.length > 4 ? " and more" : ""}. Look around!`);
    const newAnimals = (S.content.animals || []).filter(a => a.used).map(a => a.name);
    if (newAnimals.length) L.push(`- NEW ANIMAL${newAnimals.length === 1 ? "" : "S"}: ${newAnimals.slice(0, 4).join(", ")}${newAnimals.length > 4 ? " and more" : ""}. Keep an eye out!`);
    for (const p of S.content.placed) {
        if (p.added) L.push(`- ${capFirst(p.where)}: ${p.added} new sign${p.added === 1 ? "" : "s"} and props${p.signs.length ? ` (look for "${p.signs.slice(0, 2).join("\", \"")}")` : ""}.`);
        if (p.moved || p.removed) L.push(`- ${capFirst(p.where)}: some signs and props have moved.`);
    }
    for (const c of S.commits) {
        if (/^tree sim 4 studio/i.test(c.subject) || /^\d+\.\d+\.\d+:/.test(c.subject)) continue; // the editor isn't in the game, and old release commits are old news
        L.push("- " + c.subject.replace(/\s*\((unreleased|wip)\)/i, ""));
    }
    return L.join("\n") || "- Fixes and improvements.";
}
function relPreview() {
    const first = `Hypergamous Tree Chopping Simulator 4 - ${R.version}${R.title ? ` (${R.title.toUpperCase()})` : ""}`;
    return `<b>UPDATE AVAILABLE</b><i>v${esc(released())}  →  v${esc(R.version)}</i>${esc(first + "\n\n" + R.notes.trim())}`;
}
function renderRelease(partial) { // partial: only the checks and the Release button, so typing in a field isn't interrupted
    if (!relEl.classList.contains("show")) return;
    const S = R.status;
    if (!S) { relEl.innerHTML = `<div class="relHead"><h2>RELEASE AN UPDATE</h2><button class="stB" id="relClose">✕</button></div><div class="stBody"><div class="stHint">Looking at your project and GitHub…</div></div>`; bindRelease(); return; }
    const ck = R.checks, ok = ck && ck.ok && !R.checking && !R.busy && !R.done;
    const icon = c => (c.ok ? `<span class="ic ok">✓</span>` : c.blocking ? `<span class="ic no">✗</span>` : `<span class="ic warn">!</span>`);
    const files = S.dirty.length, sinceTag = S.commits.length;
    const steps = Object.keys(R.steps).length || R.done || R.error ? `<div class="relBox"><div class="stH">SHIPPING</div>${STEPS.map(([id, label]) => { const s = R.steps[id]; const ic = !s ? "·" : s.state === "done" ? `<span class="ok">✓</span>` : s.state === "fail" ? `<span class="no">✗</span>` : "…"; return `<div class="relStep"><span class="ic">${ic}</span><span>${label}${s && s.detail ? `<small style="display:block;opacity:.65">${esc(s.detail)}</small>` : ""}</span></div>`; }).join("")}
        ${R.error ? `<div class="stMsg bad">${esc(R.error)}</div><div class="stBtns"><button class="stB" id="relRetry">Try again</button></div><div class="stHint">Every step is safe to run again: anything already done is skipped.</div>` : ""}
        ${R.done ? ciHtml() : ""}</div>` : "";
    const html = `<div class="relHead"><h2>RELEASE AN UPDATE</h2><span><button class="stB" id="relRefresh" title="Look again">↻</button> <button class="stB" id="relClose">✕</button></span></div>
      <div class="stBody"><div class="relCols"><div>
        <div class="relBox"><div class="stH">NOW <small>${esc(S.repo || "")}</small></div>
          <div class="stHint" style="margin:0">Players have <b>v${esc(released())}</b>. You're on <b>${esc(S.branch)}</b>${S.ahead ? `, ${S.ahead} commit${S.ahead === 1 ? "" : "s"} ahead of GitHub` : ""}${files ? `, with ${files} changed file${files === 1 ? "" : "s"} not committed yet` : ""}.</div>
          ${sinceTag ? `<div class="relList" style="margin-top:6px">${S.commits.map(c => `• ${esc(c.subject)}`).join("<br>")}</div>` : ""}</div>
        <div class="relBox"><div class="stH">VERSION</div>
          <div class="stRow"><input class="stIn" type="text" id="relVer" value="${esc(R.version)}" style="width:110px;flex:none"><span class="stBtns" style="margin:0"><button class="stB" data-bump="patch" title="Fixes and small things">+ patch</button><button class="stB" data-bump="minor" title="New features">+ minor</button><button class="stB" data-bump="major" title="Something huge">+ major</button></span></div>
          <div class="stRow"><label>Title</label><input class="stIn" type="text" id="relTitle" value="${esc(R.title)}" placeholder="optional, like THE STUDIO UPDATE"></div></div>
        <div class="relBox"><div class="stH">WHAT'S NEW <small>one line each, starting with "- "</small></div>
          <textarea class="stTa" id="relNotes" rows="8" placeholder="- NEW TREE: ...&#10;- FIXED: ...">${esc(R.notes)}</textarea>
          <div class="stBtns"><button class="stB" id="relDraft">Draft from my changes</button><button class="stB" id="relClaude"${R.drafting ? " disabled" : ""}>${R.drafting ? "Claude is writing…" : "✦ Draft with Claude"}</button></div><div class="stMsg" id="relMsg"></div></div>
      </div><div>
        <div class="relBox"><div class="stH">WHAT PLAYERS WILL SEE</div><div class="relPrev">${relPreview()}</div></div>
        <div class="relBox" id="relChecksBox"><div class="stH">CHECKS ${R.checking ? "<small>checking…</small>" : `<button class="stB" id="relCheck" style="padding:3px 8px">run again</button>`}</div>
          ${ck ? ck.checks.map(c => `<div class="relChk">${icon(c)}<span>${esc(c.name)}<small>${esc(c.detail)}</small></span></div>`).join("") : `<div class="stHint">Checking…</div>`}</div>
        ${steps}
        <div id="relGoWrap">${R.done ? "" : `<button class="stB go relGo" id="relGo"${ok ? "" : " disabled"}>🚀 Release v${esc(R.version)}</button><div class="stHint" style="text-align:center;margin-top:6px">${ok ? "You'll be asked to confirm first." : R.busy ? "Shipping…" : "Fix the ✗ checks to release."}</div>`}</div>
      </div></div></div>
      <div class="relConfirm" id="relConfirm"><div><div class="stH" style="margin-top:0">RELEASE v${esc(R.version)}?</div>
        <ol>${worldDirty || treesDirty ? "<li>Save your unsaved Studio changes</li>" : ""}<li>Set the version to <b>${esc(R.version)}</b> and the notes in package.json</li><li>Commit ${files ? `the ${files} changed file${files === 1 ? "" : "s"}` : "the version bump"}${S.branch !== "main" ? `, then move <b>main</b> up to <b>${esc(S.branch)}</b>` : ""}</li><li>Push <b>main</b> and the tag <b>v${esc(R.version)}</b> to GitHub</li></ol>
        <div class="stHint">GitHub then builds the installer (about 2–5 minutes). Players get the update popup the next time they open the game. You can't take a release back, only ship a newer one.</div>
        <div class="stBtns" style="justify-content:flex-end"><button class="stB" id="relNo">Cancel</button><button class="stB go" id="relYes">Release v${esc(R.version)}</button></div></div></div>`;
    if (partial && $("relChecksBox")) {
        const tmp = document.createElement("div"); tmp.innerHTML = html;
        for (const id of ["relChecksBox", "relGoWrap", "relConfirm"]) { const a = $(id), b = tmp.querySelector("#" + id); if (a && b) a.innerHTML = b.innerHTML; }
        const on = (id, fn) => { const e = $(id); if (e) e.addEventListener("click", fn); };
        on("relCheck", runChecks); on("relGo", () => $("relConfirm").classList.add("show")); on("relNo", () => $("relConfirm").classList.remove("show")); on("relYes", shipIt);
        return;
    }
    relEl.innerHTML = html;
    bindRelease();
}
function ciHtml() {
    const c = R.ci, mins = Math.floor((Date.now() - R.ciStart) / 60000);
    let line = `<div class="stMsg">Waiting for GitHub to start building…</div>`;
    if (c && c.live) line = `<div class="stMsg good">LIVE ✓ v${esc(R.version)} is out. Players get the update popup the next time they open the game.</div>`;
    else if (c && c.run && c.run.conclusion && c.run.conclusion !== "success") line = `<div class="stMsg bad">The build failed on GitHub (${esc(c.run.conclusion)}). Open it to see why, fix it, then ship a new version.</div>`;
    else if (c && c.run) line = `<div class="stMsg">GitHub is ${c.run.status === "completed" ? "publishing the release" : "building the installer"}… ${mins ? mins + " min" : ""}</div>`;
    const url = (c && c.release && c.release.url) || (c && c.run && c.run.url);
    return line + (url ? `<div class="stBtns"><button class="stB" id="relOpen" data-url="${esc(url)}">Open on GitHub</button></div>` : "");
}
function bindRelease() {
    const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
    on("relClose", "click", closeRelease);
    on("relRefresh", "click", () => loadRelease(true));
    on("relCheck", "click", runChecks);
    let ckT = 0;
    const recheck = () => { clearTimeout(ckT); ckT = setTimeout(runChecks, 700); };
    on("relVer", "input", e => { R.version = e.target.value.trim(); updatePreview(); recheck(); });
    on("relTitle", "input", e => { R.title = e.target.value.trim(); updatePreview(); });
    on("relNotes", "input", e => { R.notes = e.target.value; updatePreview(); recheck(); });
    relEl.querySelectorAll("[data-bump]").forEach(b => b.addEventListener("click", () => { R.version = vBump(released(), b.dataset.bump); renderRelease(); runChecks(); }));
    on("relDraft", "click", () => { R.notes = draftNotes(); renderRelease(); runChecks(); });
    on("relClaude", "click", claudeNotes);
    on("relGo", "click", () => $("relConfirm").classList.add("show"));
    on("relNo", "click", () => $("relConfirm").classList.remove("show"));
    on("relYes", "click", shipIt);
    on("relRetry", "click", shipIt);
    on("relOpen", "click", e => S.openUrl(e.target.dataset.url));
}
function updatePreview() { const p = relEl.querySelector(".relPrev"); if (p) p.innerHTML = relPreview(); const g = $("relGo"); if (g) g.textContent = `🚀 Release v${R.version}`; }
async function loadRelease(force) {
    if (R.busy) return;
    if (force || !R.status) { R.status = null; R.checks = null; renderRelease(); }
    R.status = await S.relStatus();
    if (!R.version || !vNewer(R.version, released())) R.version = vBump(released(), "patch");
    if (!R.notes.trim()) R.notes = draftNotes();
    renderRelease(); runChecks();
}
async function runChecks() {
    if (R.busy || R.done) return;
    R.checking = true; renderCheckBox();
    const c = await S.relChecks(R.version, R.notes);
    R.checking = false; R.checks = c; R.status = c.status;
    renderRelease(true);
}
function renderCheckBox() { const b = $("relCheck"); if (b) b.outerHTML = "<small>checking…</small>"; const g = $("relGo"); if (g) g.disabled = true; }
async function claudeNotes() {
    const St = R.status; if (!St) return;
    R.drafting = true; renderRelease();
    const prev = (St.notes || "").split("\n").slice(0, 12).join("\n");
    const prompt = `Write the in-game update notes for Hypergamous Tree Chopping Simulator 4, version ${R.version}.
Match the style of the last release's notes exactly (plain, excited, second person, big features in CAPS at the start of a line, fixes start with "FIXED:"):
${prev}

What changed since v${released()}:
Commits:
${St.commits.map(c => `* ${c.subject}${c.body ? "\n  " + c.body.replace(/\n/g, "\n  ") : ""}`).join("\n") || "(none)"}
Studio content: ${JSON.stringify(St.content)}

Only include things players will notice in the game. Leave out "Tree Sim 4 Studio" (the developer's editor, which doesn't ship) and anything about tooling.
Describe ONLY the changes listed above. Never invent features, fixes or numbers that aren't in that list; fewer lines is better than a made-up one.
Reply with ONLY the bullet lines, each starting with "- ". No title line, no intro, no code fences.`;
    const r = await askQ({ prompt, system: "You write short, cheerful release notes for a spooky indie tree-chopping game. Reply with only the bullet lines.", model: pref("model") || "haiku" });
    R.drafting = false;
    if (r.ok) { const lines = r.text.split(/\r?\n/).map(l => l.trim()).filter(l => /^[-•*]\s/.test(l)).map(l => "- " + l.replace(/^[-•*]\s*/, "")); if (lines.length) R.notes = lines.join("\n"); }
    renderRelease();
    const m = $("relMsg"); if (m) { m.className = "stMsg " + (r.ok ? "good" : "bad"); m.textContent = r.ok ? `Drafted by ${r.model} in ${(r.ms / 1000).toFixed(1)}s · ~${(r.tokens / 1000).toFixed(1)}k tokens. Read it over before you ship.` : r.error; }
    runChecks();
}
async function shipIt() {
    $("relConfirm") && $("relConfirm").classList.remove("show");
    if (R.busy) return;
    R.busy = true; R.error = ""; R.steps = {}; renderRelease();
    if (worldDirty || treesDirty || islandsDirty || propsDirty || animalsDirty || peopleDirty) await saveAll(true);
    const res = await S.release({ version: R.version, notes: R.notes, title: R.title });
    R.busy = false;
    if (!res.ok) { R.error = `Stopped at "${(STEPS.find(s => s[0] === res.step) || [0, res.step])[1]}": ${res.error || "unknown error"}`; renderRelease(); return; }
    R.done = res; R.ciStart = Date.now(); R.ci = null;
    say(`v${R.version} is pushed: GitHub is building it`, 4000);
    renderRelease(); watchCi();
}
async function watchCi() {
    clearTimeout(R.ciTimer);
    R.ci = await S.ciStatus(R.version);
    renderRelease();
    const failed = R.ci && R.ci.run && R.ci.run.conclusion && R.ci.run.conclusion !== "success";
    if (R.ci && R.ci.live) { say(`v${R.version} is LIVE: players get it next launch`, 6000); return; }
    if (failed) { say(`The build of v${R.version} failed on GitHub`, 6000); return; }
    if (Date.now() - R.ciStart < 40 * 60000) R.ciTimer = setTimeout(watchCi, 15000);
}
S.onReleaseStep(s => { R.steps[s.id] = s; renderRelease(); });
function openRelease() { if (mode !== "edit") return; cancelPlacing(); relEl.classList.add("show"); if (R.done && R.ci && (R.ci.live || (R.ci.run && R.ci.run.conclusion && R.ci.run.conclusion !== "success"))) { R.done = null; R.steps = {}; R.status = null; R.notes = ""; R.title = ""; R.version = ""; } if (!R.done) loadRelease(true); else renderRelease(); }
function closeRelease() { if (R.busy) { say("Hang on: the release is still going"); return; } relEl.classList.remove("show"); }

// ---------- islands, time, weather ----------
function goIsle(id) {
    const e = ISLES().find(q => q.id === id); if (!e) return;
    deselect(); cancelPlacing(); clearPreview(); previewAt = null; pmClearPreview(); pmAt = null; ppClear(); ppAt = null;
    const enter = e.isle >= T.CI_BASE ? () => T.enterCI(T.customIsle(e.isle)) : [null, T.enterIsle1, T.enterIsle2, T.enterIsle3, T.enterIsle4, T.enterIsle5, T.enterIsle6][e.isle];
    if (curIsle() !== e.isle) enter();
    if (e.arch && T.getArch() !== e.arch) T.setArch5(e.arch, true);
    T.setState("studio");
    overview(e);
    renderLeft(); syncBar();
    if (makerTab()) pmShowPreview(true);
    if (tab === "people") ppShow(true);
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
$("stBuilt").addEventListener("click", () => setBuiltMode(!builtMode));
$("stClock").addEventListener("input", e => T.setClock(+e.target.value));
$("stWx").addEventListener("change", e => { T.setWeather(e.target.value, false); e.target.blur(); });
$("stFog").value = fogMode;
$("stFog").addEventListener("change", e => { fogMode = e.target.value; pref("fog", fogMode); e.target.blur(); });
$("stUndo").addEventListener("click", doUndo); $("stRedo").addEventListener("click", doRedo);
$("stAuto").checked = pref("auto") !== "0";
$("stAuto").addEventListener("change", e => { pref("auto", e.target.checked ? "1" : "0"); if (e.target.checked && (worldDirty || treesDirty || islandsDirty || propsDirty || animalsDirty || peopleDirty)) saveAll(true); });
$("stSave").addEventListener("click", () => saveAll(false));
$("stPlay").addEventListener("click", play);
$("stRelBtn").addEventListener("click", openRelease);
// ⟳ Sync: bring in what's on GitHub and keep your own work (studio/sync.js merges it). Afterwards the Studio restarts,
// because what it has in memory is from before: saving that would undo the merge
async function openSync() {
    if ($("stSync")) return;
    if (worldDirty || treesDirty || islandsDirty || propsDirty || animalsDirty || peopleDirty) await saveAll(true);
    const box = document.createElement("div"); box.className = "st"; box.id = "stSync";
    box.style.cssText = "position:fixed;inset:0;z-index:400;display:flex;align-items:center;justify-content:center;background:#0a0612cc";
    box.innerHTML = `<div style="width:min(600px,92%);max-height:86vh;overflow:auto;background:#1e1530;border:1px solid #ffd040;border-radius:12px;padding:18px 20px">
      <div class="stH" style="margin-top:0">SYNC WITH GITHUB</div>
      <div id="syncLog" style="font:600 13px 'Segoe UI';line-height:1.5">Saving and checking GitHub…</div><div class="stBtns" id="syncBtns" style="margin-top:12px"></div></div>`;
    document.body.appendChild(box);
    const r = await S.sync().catch(err => ({ ok: false, error: String(err), notes: [] }));
    const moved = !r.nothing && (r.ok || (r.commits || []).length > 0), notes = (r.notes || []).map(n => `<div class="stItem" style="display:block">${esc(n)}</div>`).join("");
    $("syncLog").innerHTML = (r.ok ? (r.nothing ? "" : "<b>Done.</b> Your work is kept and merged with what came in. A copy from just before is in your Documents backups folder.") : `<b style="color:#ff8a80">The sync stopped:</b> ${esc(r.error)}${moved ? "<br>Some of it came in first, and your work is merged with that." : "<br>Nothing was changed."}`)
        + (notes ? `<div class="stList" style="margin-top:8px">${notes}</div>` : "");
    if (moved) synced = true;
    $("syncBtns").innerHTML = moved ? `<button class="stB go" id="syncGo" style="flex:1">Restart the Studio to load it</button>` : `<button class="stB" id="syncGo" style="flex:1">Close</button>`;
    $("syncGo").addEventListener("click", () => { if (moved) { $("syncGo").textContent = "Restarting…"; S.restart(); } else box.remove(); });
}
S.onSyncStep(s => { const l = $("syncLog"); if (l) l.textContent = s; });
$("stSyncBtn").addEventListener("click", openSync);

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
    if (sculptOn()) { startStroke(e.clientX, e.clientY); return; } // painting the ground
    if (makerTab() && pmPreview) { const i = pmPickPart(e.clientX, e.clientY); if (i >= 0) { pmSelectPart(i); return; } }
    if (builtMode) { // what the game built, or what you placed: whichever is nearer
        const b = pickBuiltin(e.clientX, e.clientY), p = pickPlaced(e.clientX, e.clientY);
        if (p && (!b || pickPlaced.dist <= b.dist)) { if (bsel) deselect(); select(p); } else if (b) selectBuiltin(b); else deselect();
        return;
    }
    const o = pickPlaced(e.clientX, e.clientY);
    if (o) select(o); else deselect();
});
addEventListener("pointerup", e => {
    if (e.button === 2 && looking) { looking = false; tc.enabled = true; try { if (document.pointerLockElement === canvas && mode === "edit") document.exitPointerLock(); } catch (er) { /* not locked */ } for (const k in held) held[k] = false; }
    if (e.button === 1 && panning) { panning = false; tc.enabled = true; }
    if (e.button === 0 && stroke) endStroke();
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
    if (sculptOn()) moveBrush(e.clientX, e.clientY);
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
    if (relEl.classList.contains("show")) { if (e.code === "Escape" && !typing(e)) closeRelease(); return; } // the Release panel has the keyboard
    if (typing(e)) return;
    if (looking) { held[e.code] = true; e.preventDefault(); return; } // flying: WASD, Q/E, Shift
    if (ctrl && e.code === "KeyZ") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (ctrl && e.code === "KeyY") { e.preventDefault(); doRedo(); return; }
    if (ctrl && e.code === "KeyD") { e.preventDefault(); duplicateSel(); return; }
    if (ctrl && e.code === "KeyC") { if (sel) { clip = JSON.stringify(sel); say("Copied"); } return; }
    if (ctrl && e.code === "KeyV") { e.preventDefault(); pasteClip(); return; }
    if (e.code === "Delete" || e.code === "Backspace") { removeSel(); return; }
    if (e.code === "Escape") { if (placing) { cancelPlacing(); say("Cancelled"); } else deselect(); return; }
    if (e.code === "KeyF") { if (!sel && makerTab() && pmPreview) pmFrame(); else focusSel(); return; }
    if (e.code === "KeyW") setGizmo("translate");
    else if (e.code === "KeyE") setGizmo("rotate");
    else if (e.code === "KeyR") setGizmo("scale");
}, true);
addEventListener("keyup", e => { held[e.code] = false; });
addEventListener("blur", () => { for (const k in held) held[k] = false; looking = false; panning = false; tc.enabled = true; });

// ---------- start ----------
document.title = "Tree Sim 4 Studio";
T.setState("studio");
T.setSeeAll(true); // the editor shows every tree an island can grow; play-testing (F5) shows what players see
document.body.classList.add("studio-edit");
cam.pos.copy(T.player.pos).add(new THREE.Vector3(0, 3, 0)); cam.yaw = T.player.yaw || 0; cam.pitch = -0.2;
if (curIsle() === 1 && Math.hypot(cam.pos.x, cam.pos.z) < 2) overview(ISLES()[0]);
applySnap(); setGizmo("translate"); renderLeft(); renderInspector(); syncBar();
for (const tr of trees) T.defineCustomTree(tr);
regrowHere(); // the game grew this forest before the Studio started, with only the trees your axe allows
if (tab === "trees") showPreview(true);
if (makerTab()) pmShowPreview(true);
if (tab === "people") ppShow(true);
{ const syncBarH = () => document.documentElement.style.setProperty("--barH", bar.offsetHeight + "px"); new ResizeObserver(syncBarH).observe(bar); syncBarH(); } // the panels start below the bar, however many rows it wraps onto
S.info().then(i => {
    if (i.version) { $("stVer").textContent = i.version; document.title = "Tree Sim 4 Studio " + i.version; }
    if (!i.claude) say("Claude Code wasn't found, so Ask Claude is off. Everything else works.", 6000);
});
S.themes().then(r => { if (r && r.ok && r.themes) { myThemes = r.themes; if (tab === "islands") renderIslands(); } });
// your work's copy in Documents\Tree Sim 4 Studio: after an update or a fresh download, offer to bring it back
S.wsStatus().then(st => {
    if (!st || !st.ok) return;
    if (st.fresh) { say(`Your work is now also kept in ${st.folder}, so updating the Studio never loses it`, 7000); return; }
    if (!st.diff.length) return;
    const LABEL = { islands: "Islands", trees: "Trees", props: "Props", animals: "Animals", people: "People", world: "Placed and moved things" };
    const box = document.createElement("div"); box.className = "st"; box.id = "stWs";
    box.style.cssText = "position:fixed;inset:0;z-index:400;display:flex;align-items:center;justify-content:center;background:#0a0612cc";
    box.innerHTML = `<div style="width:min(560px,92%);background:#1e1530;border:1px solid #ffd040;border-radius:12px;padding:18px 20px">
      <div class="stH" style="margin-top:0">YOUR WORK IS SAFE</div>
      <div style="font:600 13px 'Segoe UI';line-height:1.5;margin-bottom:10px">Your copy in <b>${esc(st.folder)}</b> isn't the same as what this Studio has. That happens after you update the Studio, or download it again.</div>
      <div class="stList">${st.diff.map(f => `<div class="stItem" style="display:block"><b>${esc(LABEL[f.name] || f.name)}</b><br><small>Yours: ${esc(f.mine)}${f.savedAt ? " (saved " + esc(new Date(f.savedAt).toLocaleString()) + ")" : ""}</small><br><small>This copy: ${esc(f.here)}</small></div>`).join("")}</div>
      <div class="stBtns" style="margin-top:12px"><button class="stB go" id="wsBack" style="flex:1">Bring my work back</button><button class="stB" id="wsHere">Use this copy's</button><button class="stB" id="wsLater">Later</button></div>
      <div class="stHint">Either way nothing is lost: that folder also keeps dated backups (the last 15 times the Studio started). <a href="#" id="wsOpen" style="color:#ffd040">Open the folder</a></div></div>`;
    document.body.appendChild(box);
    const names = st.diff.map(f => f.name);
    $("wsBack").addEventListener("click", async () => { const r = await S.wsRestore(names); if (r && r.ok) { box.remove(); say("Bringing your work back…"); setTimeout(() => location.reload(), 400); } else say("Couldn't bring it back: " + (r && r.error), 5000); });
    $("wsHere").addEventListener("click", async () => { if (!confirm("Use this copy's files? Your copy in Documents is replaced (the old one stays in the backups folder).")) return; await S.wsKeep(names); box.remove(); say("Using this copy's files"); });
    $("wsLater").addEventListener("click", () => box.remove());
    $("wsOpen").addEventListener("click", e => { e.preventDefault(); S.wsOpen(); });
});
say("Tree Sim 4 Studio · right-drag to look around, F5 to play", 3500);
window.__ts4studio = { world, get trees() { return trees; }, get islands() { return islands; }, get props() { return myProps; }, get animals() { return myAnimals; }, get people() { return myPeople; }, cleanPerson, ppNew, placePerson, cleanShop, renderInspector, get partSel() { return partSel; }, get treeGroup() { return treeGroup; }, pmNew, pmSelectPart, cleanProp, cleanAnimal, cleanIsland, migrateIsland, newIsland, islandChanged, claudeBuild, regrowHere, addAnimalToIsland, renderIslands, cam, select, goIsle, play, stop, saveAll, startPlacing, commitPlacing, groundHit };

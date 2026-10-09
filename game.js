import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// =====================================================================
//  TS4 test 3: day/night, rare trees, shop, landmarks, chests, contracts
// =====================================================================

const $ = id => document.getElementById(id);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const rand = (a, b) => a + Math.random() * (b - a);
let seed = 20241009;
const srand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const srange = (a, b) => a + srand() * (b - a);

// ---------- renderer / scenes ----------
const canvas = $("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.autoClear = false;
const SCALE = 3; // render at 1/3 res, CSS upscales with pixelated sampling

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x21143a);
scene.fog = new THREE.Fog(0x21143a, 6, 56);
const camera = new THREE.PerspectiveCamera(75, 16 / 10, 0.2, 420);
camera.rotation.order = "YXZ";
scene.add(camera);

// viewmodel (axe) gets its own scene + depth pass so it never clips into trees
const viewScene = new THREE.Scene();
const viewCam = new THREE.PerspectiveCamera(60, 16 / 10, 0.05, 10);
viewScene.add(viewCam);
const viewAmb = new THREE.AmbientLight(0xb8aadd, 1.1);
viewScene.add(viewAmb);
const viewSun = new THREE.DirectionalLight(0xffffff, 1.5);
viewSun.position.set(0.4, 1, 0.8);
viewScene.add(viewSun);
const viewLamp = new THREE.PointLight(0xffa050, 5, 6, 1.5);
viewLamp.position.set(0.5, 0.1, 0.1);
viewScene.add(viewLamp);

function resize() {
    const w = Math.max(160, Math.floor(innerWidth / SCALE));
    const h = Math.max(100, Math.floor(innerHeight / SCALE));
    renderer.setSize(w, h, false);
    camera.aspect = viewCam.aspect = w / h;
    camera.updateProjectionMatrix();
    viewCam.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

const ambL = new THREE.AmbientLight(0x6a5fa0, 1.5);
scene.add(ambL);
const sunL = new THREE.DirectionalLight(0x9fb0ff, 1.1);
sunL.position.set(-40, 60, -60);
scene.add(sunL);
const lantern = new THREE.PointLight(0xffa850, 30, 24, 1.8);
camera.add(lantern);
lantern.position.set(0.3, -0.2, 0.2);

// ---------- constants ----------
const SAFE_R = 24, WORLD_R = 78, DAY_LEN = 420; // DAY_LEN = real seconds per in-game 24h
// the island is a lumpy blob, not a circle: this is its shoreline radius at any angle
const shoreR = th => 94 + 8 * Math.sin(2 * th + 0.5) + 5 * Math.sin(3 * th + 2) + 3 * Math.sin(5 * th);
const shoreAt = (x, z) => shoreR(Math.atan2(z, x));
const BED = { x: 2.75, z: 1.7 }, HOPPER = { x: 5, z: -7 };
const MILL = { x: 17.5, z: -12.5 };
const RESPAWN = { x: 1.0, z: 0.0 };
const N_AXES = 8;

// ---------- save ----------
const SAVE_KEY = "ts4_save_v1";
const QS = new URLSearchParams(location.search), VERSION = QS.get("v") || "dev", DEBUG = QS.has("debug");
const save = {
    logs: 0, logBonus: 0, money: 0, owned: [1, 0, 0, 0, 0, 0, 0, 0], equipped: 0, ghosts: 0, bandages: 1, priceLvl: 0,
    hpLvl: 0, bootLvl: 0, oilLvl: 0, felled: 0, rareFelled: 0, deaths: 0, sold: 0, seconds: 0, day: 1, clock: 8,
    contract: null, chestsDay: 0, altarDay: 0, chestsOpened: 0
};
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || localStorage.getItem("ts4_test3_save") || "{}")); } catch (e) { /* fresh save */ }
if (!Array.isArray(save.owned)) save.owned = [1, 0, 0, 0, 0, 0, 0, 0];
while (save.owned.length < N_AXES) save.owned.push(0);
if (!save.owned[save.equipped]) save.equipped = 0;
function writeSave() { save.clock = hourNow(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
// difficulty follows your best axe, so a strong axe never one-shots everything
const bestIdx = () => { let b = 0; save.owned.forEach((o, i) => { if (o) b = i; }); return b; };
const bestDmg = () => AXES[bestIdx()].dmg;
const hpScale = () => 1 + (bestDmg() - 1) * 0.7;
const rewardScale = () => 1 + (bestDmg() - 1) * 0.14;
const dmgScale = () => 1 + bestIdx() * 0.1;
const ghostCost = () => Math.floor(80 * Math.pow(1.65, save.ghosts));
const priceCost = () => Math.floor(120 * Math.pow(1.8, save.priceLvl));
const hpCost = () => Math.floor(120 * Math.pow(1.7, save.hpLvl));
const bootCost = () => Math.floor(150 * Math.pow(1.9, save.bootLvl));
const oilCost = () => Math.floor(90 * Math.pow(2, save.oilLvl));
const BANDAGE_COST = 25;
const logValue = () => 4 + save.priceLvl * 2;
const ghostIncome = () => save.ghosts * 0.8;
const maxHpNow = () => 100 + save.hpLvl * 20;

// ---------- time of day ----------
let clockT = (clamp(save.clock, 0, 24) / 24) * DAY_LEN;
const hourNow = () => (clockT / DAY_LEN) * 24;
const sunElev = () => Math.sin(((hourNow() - 6) / 24) * Math.PI * 2); // +1 noon, -1 midnight
const dayAmt = () => clamp(sunElev() * 2.2 + 0.35, 0, 1);
const isNight = () => dayAmt() < 0.2;
const fmtClock = () => { const h = hourNow(); const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0"); };

// ---------- audio ----------
let actx = null, windGain = null;
function sfx(freq, dur, type = "square", vol = 0.12, slide = 0.5) {
    if (!actx) return;
    const o = actx.createOscillator(), gn = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, actx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), actx.currentTime + dur);
    gn.gain.setValueAtTime(vol, actx.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(gn).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + dur);
}
function startAmbience() {
    if (!actx || windGain) return;
    const len = actx.sampleRate * 2, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = actx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 360;
    windGain = actx.createGain();
    windGain.gain.value = 0.02;
    src.connect(f).connect(windGain).connect(actx.destination);
    src.start();
}
const owl = () => { sfx(430, 0.28, "sine", 0.05, 0.85); setTimeout(() => sfx(380, 0.4, "sine", 0.05, 0.8), 380); };

// ---------- ground, sky ----------
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff0b0, fog: false }));
const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xe8e4ff, fog: false }));
scene.add(sunMesh, moonMesh);
let starMat = null, waterMesh = null;
{
    const g = new THREE.PlaneGeometry(380, 380, 150, 150);
    g.rotateX(-Math.PI / 2);
    const col = [], c = new THREE.Color(), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i), d = Math.hypot(x, z), inside = shoreAt(x, z) - d;
        const y = inside < 5 ? Math.max(-3.4, -(5 - inside) * 0.2) : 0;
        pos.setY(i, y);
        if (y < -0.5) c.setHSL(0.1, 0.35, 0.15 + Math.random() * 0.04);               // wet seabed
        else if (inside < 12) c.setHSL(0.12, 0.5, 0.4 + Math.random() * 0.06);       // beach sand
        else if (d < SAFE_R) c.setHSL(0.09, 0.28, 0.14 + Math.random() * 0.05);     // warm dirt in the safe zone
        else c.setHSL(0.34 + Math.random() * 0.1, 0.3, 0.12 + Math.random() * 0.06);
        col.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    const wg = new THREE.PlaneGeometry(1600, 1600);
    wg.rotateX(-Math.PI / 2);
    waterMesh = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: 0x2f78a8, emissive: 0x0a2a40, transparent: true, opacity: 0.9, flatShading: true }));
    waterMesh.position.y = -0.45;
    scene.add(waterMesh);

    const sp = [];
    for (let i = 0; i < 350; i++) {
        const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3 + 0.1, r = 380;
        sp.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true });
    scene.add(new THREE.Points(sg, starMat));
}
const wisps = (() => {
    const p = [];
    for (let i = 0; i < 140; i++) p.push((Math.random() - 0.5) * 150, 0.5 + Math.random() * 6, (Math.random() - 0.5) * 150);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9dffd0, size: 0.18, transparent: true }));
    scene.add(pts);
    return pts;
})();

const cNightFog = new THREE.Color(0x21143a), cDayFog = new THREE.Color(0x8ecae6), cDusk = new THREE.Color(0xff8f5a);
const cNightAmb = new THREE.Color(0x6a5fa0), cDayAmb = new THREE.Color(0xdde6ff);
const cNightSun = new THREE.Color(0x9fb0ff), cDaySun = new THREE.Color(0xfff2d8);
const tmpC = new THREE.Color();
function applySky() {
    const d = dayAmt(), el = sunElev();
    const dusk = clamp(1 - Math.abs(el) * 4.5, 0, 1) * 0.65;
    tmpC.copy(cNightFog).lerp(cDayFog, d).lerp(cDusk, dusk * 0.7);
    scene.background.copy(tmpC);
    scene.fog.color.copy(tmpC);
    scene.fog.near = lerp(6, 16, d);
    scene.fog.far = lerp(56, 120, d);
    ambL.color.copy(cNightAmb).lerp(cDayAmb, d);
    ambL.intensity = lerp(1.5, 2.0, d);
    sunL.color.copy(cNightSun).lerp(cDaySun, d).lerp(cDusk, dusk * 0.5);
    sunL.intensity = lerp(1.1, 2.6, d);
    const a = ((hourNow() - 6) / 24) * Math.PI * 2;
    const dir = V3(Math.cos(a), Math.sin(a), -0.35).normalize();
    const lightDir = el >= 0 ? dir : dir.clone().negate();
    sunL.position.copy(lightDir).multiplyScalar(100);
    sunMesh.position.copy(camera.position).addScaledVector(dir, 330);
    moonMesh.position.copy(camera.position).addScaledVector(dir, -330);
    sunMesh.visible = el > -0.12;
    moonMesh.visible = el < 0.12;
    starMat.opacity = clamp(1 - d * 1.6, 0, 1);
    wisps.material.opacity = (1 - d) * 0.9;
    wisps.visible = d < 0.9;
    viewAmb.intensity = lerp(1.1, 1.6, d);
    lantern.intensity = (lerp(26, 8, d) + save.oilLvl * 6) * (player && player.lantern ? 1 : 0);
    lantern.distance = 24 + save.oilLvl * 6;
}

// ---------- helpers for building ----------
const occluders = []; // solid meshes that hide labels and nameplates behind them
const colliders = []; // axis-aligned boxes [minx, maxx, minz, maxz]
const circles = [];   // {x, z, r}
function addBox(minx, maxx, minz, maxz, y0, y1, mat, collide = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(maxx - minx, y1 - y0, maxz - minz), mat);
    m.position.set((minx + maxx) / 2, (y0 + y1) / 2, (minz + maxz) / 2);
    scene.add(m);
    if (collide) { colliders.push([minx, maxx, minz, maxz]); occluders.push(m); }
    return m;
}
const labelList = [];
function label(text, color = "#ffd040", w = 3, h = 0.75) {
    const el = document.createElement("div");
    el.className = "wl";
    el.textContent = text;
    el.style.color = color; el.style.borderColor = color;
    el.style.fontSize = clamp(w * 5.2, 12, 26) + "px";
    $("labels").appendChild(el);
    const l = { el, position: new THREE.Vector3(), visible: true, material: { opacity: 1 }, maxD: 95, blurK: 1 };
    labelList.push(l);
    return l;
}
const lblV = new THREE.Vector3(), occRay = new THREE.Raycaster(), occDir = new THREE.Vector3();
let occAll = occluders, occAllT = 0;
function refreshOccluders() {
    const nowMs = performance.now();
    if (nowMs - occAllT < 100) return;
    occAllT = nowMs;
    occAll = occluders.slice();
    for (const t of trees) if (!t.gone && !t.burn && Math.hypot(t.x - camera.position.x, t.z - camera.position.z) < 70) occAll.push(t.solid[0], t.solid[1]);
}
function isOccluded(pos, own) {
    occDir.copy(pos).sub(camera.position);
    const dist = occDir.length();
    if (dist < 1) return false;
    occDir.divideScalar(dist);
    occRay.set(camera.position, occDir);
    occRay.far = dist - 0.5;
    const hits = occRay.intersectObjects(occAll, false);
    return own ? hits.some(h => h.object !== own[0] && h.object !== own[1]) : hits.length > 0;
}
const behindAxe = (sx, sy) => sx > innerWidth * 0.58 && sy > innerHeight * 0.48; // where the held axe is drawn
function updateLabels() {
    refreshOccluders();
    for (const l of labelList) {
        if (!l.visible) { l.el.style.display = "none"; continue; }
        const d = camera.position.distanceTo(l.position);
        lblV.copy(l.position).project(camera);
        if (d > l.maxD || lblV.z > 1 || Math.abs(lblV.x) > 1.15 || Math.abs(lblV.y) > 1.15) { l.el.style.display = "none"; continue; }
        const sx = (lblV.x * 0.5 + 0.5) * innerWidth, sy = (-lblV.y * 0.5 + 0.5) * innerHeight, nowMs = performance.now();
        if (!(nowMs - (l._occT || 0) < 120)) { l._occT = nowMs; l._occ = isOccluded(l.position); }
        if (l._occ || (state === "playing" && behindAxe(sx, sy))) { l.el.style.display = "none"; continue; }
        if (state === "title") { l.el.style.display = "none"; continue; }
        l.el.style.display = "";
        l.el.style.left = sx + "px";
        l.el.style.top = sy + "px";
        const blur = clamp((d - 28) / 45, 0, 1) * 3.2 * l.blurK;
        l.el.style.filter = blur > 0.15 ? "blur(" + blur.toFixed(1) + "px)" : "";
        l.el.style.opacity = l.material.opacity * (1 - clamp((d - (l.maxD - 25)) / 25, 0, 1));
    }
}
// merge many small transformed shapes into a single mesh (one draw call)
function batch(mat) {
    const parts = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    return {
        add(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
            const g = geo.clone();
            e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); s.set(sx, sy, sz);
            m4.compose(p, q, s); g.applyMatrix4(m4);
            parts.push(g.index ? g.toNonIndexed() : g);
        },
        build() { if (!parts.length) return null; const m = new THREE.Mesh(mergeGeometries(parts), mat); scene.add(m); return m; }
    };
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const CONE6 = new THREE.ConeGeometry(1, 1, 6);
const ICO = new THREE.IcosahedronGeometry(1, 0);
const decalMat = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

// ---------- safehouse ----------
const wood = new THREE.MeshLambertMaterial({ color: 0x6b5444, flatShading: true });
const woodDark = new THREE.MeshLambertMaterial({ color: 0x3b271b, flatShading: true });
const floorMat = new THREE.MeshLambertMaterial({ color: 0x6e5a48, flatShading: true });
const glowMat = new THREE.MeshBasicMaterial({ color: 0xffc060 });
const stoneMat = decalMat(0x6a655e);
{
    addBox(-4, 4, -3, 3, 0, 0.06, floorMat, false);
    addBox(-4.15, 4.15, 2.85, 3.15, 0, 3, wood);
    addBox(-4.15, -3.85, -3.15, 3.15, 0, 3, wood);
    addBox(3.85, 4.15, -3.15, 3.15, 0, 3, wood);
    addBox(-4.15, -1.2, -3.15, -2.85, 0, 3, wood);
    addBox(1.2, 4.15, -3.15, -2.85, 0, 3, wood);
    addBox(-1.2, 1.2, -3.15, -2.85, 2.3, 3, wood, false); // lintel over the door
    const roofGeo = new THREE.ConeGeometry(6.4, 2.4, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0x4a2a3c, flatShading: true, side: THREE.DoubleSide }));
    roof.position.set(0, 4.2, 0);
    scene.add(roof);
    occluders.push(roof);
    for (const x of [-2, 2]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.06), glowMat);
        w.position.set(x, 1.7, 3.17);
        scene.add(w);
    }
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 1.4), glowMat);
    sw.position.set(4.17, 1.7, 0);
    scene.add(sw);
    addBox(-1.3, -1.15, -3.2, -2.8, 0, 2.4, woodDark, false);
    addBox(1.15, 1.3, -3.2, -2.8, 0, 2.4, woodDark, false);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), glowMat);
    lamp.position.set(1.7, 2.3, -3.4);
    scene.add(lamp);
    const inside = new THREE.PointLight(0xffc890, 14, 16, 1.8);
    inside.position.set(0, 2.4, 0);
    scene.add(inside);
    const porch = new THREE.PointLight(0xffa850, 25, 16, 1.8);
    porch.position.set(1.7, 2.3, -4);
    scene.add(porch);
    // doorstep slab
    addBox(-1.5, 1.5, -4.5, -3.15, 0, 0.1, stoneMat, false);

    // furniture: a proper bed (head against the back wall), rug, stove, crate
    const crate = addBox(-3.6, -2.9, -1.6, -0.9, 0, 0.8, wood);
    crate.rotation.y = 0.2;
    const bedW = new THREE.MeshLambertMaterial({ color: 0x4a3426, flatShading: true });
    for (const [lx, lz] of [[2.05, 0.55], [3.45, 0.55], [2.05, 2.75], [3.45, 2.75]]) addBox(lx - 0.07, lx + 0.07, lz - 0.07, lz + 0.07, 0, 0.3, bedW, false);
    addBox(2.0, 3.5, 0.5, 2.8, 0.3, 0.55, bedW, false);                                              // frame
    addBox(2.08, 3.42, 0.6, 2.72, 0.55, 0.78, new THREE.MeshLambertMaterial({ color: 0xd9d2c0, flatShading: true }), false); // mattress
    addBox(2.04, 3.46, 0.58, 1.95, 0.78, 0.84, new THREE.MeshLambertMaterial({ color: 0x7a2a3a, flatShading: true }), false); // blanket
    addBox(2.04, 3.46, 1.88, 2.0, 0.84, 0.87, new THREE.MeshLambertMaterial({ color: 0x5a1a2a, flatShading: true }), false);   // folded edge
    addBox(2.25, 3.25, 2.18, 2.68, 0.78, 0.95, new THREE.MeshLambertMaterial({ color: 0xf0ece0, flatShading: true }), false); // pillow
    addBox(2.0, 3.5, 2.7, 2.84, 0.3, 1.5, bedW, false);                                              // headboard
    addBox(2.0, 3.5, 0.5, 0.62, 0.3, 0.85, bedW, false);                                             // footboard
    colliders.push([2.0, 3.5, 0.5, 2.85]);
    addBox(-2.6, 0.2, 0.6, 2.4, 0.06, 0.1, new THREE.MeshLambertMaterial({ color: 0x6a2030, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), false);
    addBox(-3.8, -2.9, 1.9, 2.8, 0, 1.3, new THREE.MeshLambertMaterial({ color: 0x2a2a30, flatShading: true }));
    addBox(-2.92, -2.88, 2.1, 2.6, 0.3, 0.7, new THREE.MeshBasicMaterial({ color: 0xff7a2a }), false);
    label("BED", "#ff9ab8", 1.4, 0.5).position.set(BED.x, 2.0, BED.z);
    label("SAFEHOUSE", "#ffd040", 4, 1).position.set(0, 5.3, -2.5);
}

// ---------- the Reaper's shop (a walk down the path from the safehouse) ----------
const SHOP = { x: -11, z: -13 }, KEEPER = { x: -11, z: -15.6 };
const pathCurve = new THREE.CatmullRomCurve3([V3(0, 0, -5.0), V3(0, 0, -6.0), V3(-2.4, 0, -6.8), V3(-6, 0, -7.1), V3(-9.2, 0, -6.9), V3(-11, 0, -7.7), V3(-11, 0, -8.6)]);
let reaper = null, reaperHead = null;
const reaperOrbs = [], shopAnim = { flames: [], bubbles: [], runes: null, orb: null, neon: null, chimes: [] };

function smileyTex() {
    const S = 128, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    g.fillStyle = "#000";
    g.beginPath(); g.ellipse(64, 64, 58, 63, 0, 0, 7); g.fill();
    const glow = "#d4ffe0";
    g.shadowColor = "#6dffa0"; g.shadowBlur = 12;
    g.fillStyle = glow; g.strokeStyle = glow; g.lineCap = "round";
    g.beginPath(); g.ellipse(42, 46, 7, 14, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(86, 46, 7, 14, 0, 0, 7); g.fill();
    g.lineWidth = 7;
    g.beginPath(); g.arc(64, 58, 38, 0.17 * Math.PI, 0.83 * Math.PI); g.stroke();
    g.lineWidth = 4; g.beginPath();
    for (let i = -4; i <= 4; i++) {
        const a = Math.PI / 2 + i * 0.17;
        g.moveTo(64 + Math.cos(a) * 38, 58 + Math.sin(a) * 38);
        g.lineTo(64 + Math.cos(a) * 29, 58 + Math.sin(a) * 29);
    }
    g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(22, 96); g.lineTo(28, 103); g.moveTo(106, 96); g.lineTo(100, 103); g.stroke();
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

{
    const wallShop = new THREE.MeshLambertMaterial({ color: 0x4a3f60, flatShading: true });
    const floorShop = new THREE.MeshLambertMaterial({ color: 0x2e2840, flatShading: true });
    const greenMat = new THREE.MeshBasicMaterial({ color: 0x7dffb0 });
    const purpleMat = new THREE.MeshBasicMaterial({ color: 0xb48aff });
    const boneMat = new THREE.MeshLambertMaterial({ color: 0xe8e4d0, flatShading: true });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x18121f, flatShading: true });

    // building (door on the +z side, facing the safehouse)
    addBox(-16, -6, -17, -9, 0, 0.06, floorShop, false);
    addBox(-16.15, -5.85, -17.15, -16.85, 0, 3.2, wallShop);
    addBox(-16.15, -15.85, -17.15, -8.85, 0, 3.2, wallShop);
    addBox(-6.15, -5.85, -17.15, -8.85, 0, 3.2, wallShop);
    addBox(-16.15, -12.2, -9.15, -8.85, 0, 3.2, wallShop);
    addBox(-9.8, -5.85, -9.15, -8.85, 0, 3.2, wallShop);
    addBox(-12.2, -9.8, -9.15, -8.85, 2.5, 3.2, wallShop, false);
    const rg = new THREE.ConeGeometry(7.8, 2.8, 4);
    rg.rotateY(Math.PI / 4);
    const sroof = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: 0x2a1f3a, flatShading: true, side: THREE.DoubleSide }));
    sroof.position.set(SHOP.x, 4.6, SHOP.z);
    sroof.scale.z = 0.85;
    scene.add(sroof);
    occluders.push(sroof);
    // gothic spires on the corners + a big skull-moon over the door
    const spires = batch(darkMat);
    for (const [sx, sz] of [[-16, -17], [-6, -17], [-16, -9], [-6, -9]]) spires.add(CONE6, sx, 4.2, sz, 0, 0, 0, 0.4, 2.2, 0.4);
    spires.build();
    const crescent = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.12, 5, 14, Math.PI * 1.4), purpleMat);
    crescent.position.set(SHOP.x, 3.7, -8.7);
    crescent.rotation.z = 0.9;
    scene.add(crescent);
    // door frame: bone-white pillars with green flames
    for (const dx of [-12.55, -9.45]) {
        addBox(dx - 0.18, dx + 0.18, -9.3, -8.7, 0, 2.7, boneMat, false);
        const fl = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 5), greenMat);
        fl.position.set(dx, 3.0, -9);
        scene.add(fl);
        shopAnim.flames.push(fl);
    }
    for (const [x, z, sx, sz] of [[-6.1, -13, 0.06, 1.6], [-15.9, -13, 0.06, 1.6]]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.9, sz), purpleMat);
        w.position.set(x, 1.8, z);
        scene.add(w);
    }
    // doorstep slab
    addBox(-12.4, -9.6, -8.85, -7.9, 0, 0.1, stoneMat, false);
    const lampLight = new THREE.PointLight(0x7dffb0, 26, 16, 1.8);
    lampLight.position.set(-11, 2.6, -7.8);
    scene.add(lampLight);
    const inner = new THREE.PointLight(0xc8a0ff, 24, 18, 1.8);
    inner.position.set(SHOP.x, 2.7, SHOP.z);
    scene.add(inner);
    shopAnim.neon = label("REAPER'S SHOP", "#c9a0ff", 4.6, 1.0);
    shopAnim.neon.position.set(SHOP.x, 4.6, -8.2);

    // shelves of glowing potions on the back wall, with skulls on top
    const cols = [0xff5a6a, 0x7dffb0, 0xb48aff, 0xffd040, 0x7fd8ff];
    for (let row = 0; row < 3; row++) {
        const y = 0.9 + row * 0.75;
        addBox(-15.7, -6.3, -17.0, -16.45, y, y + 0.07, woodDark, false);
        for (let i = 0; i < 9; i++) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.4, 0.28), new THREE.MeshBasicMaterial({ color: cols[(i + row) % 5] }));
            m.position.set(-15.2 + i * 1.0, y + 0.27, -16.7);
            scene.add(m);
        }
    }
    const skulls = batch(boneMat);
    for (let i = 0; i < 4; i++) skulls.add(ICO, -15 + i * 2.7, 3.1, -16.6, 0, 0, 0, 0.22, 0.26, 0.24);
    skulls.build();
    // counter, candles, crystal ball
    addBox(-13.8, -8.2, -14.5, -13.5, 0, 1.1, woodDark);
    addBox(-13.9, -8.1, -14.6, -13.4, 1.1, 1.18, floorMat, false);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb040 });
    for (const cx of [-13.4, -8.6]) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 6), boneMat);
        c.position.set(cx, 1.38, -14.05);
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), flameMat);
        f.position.set(cx, 1.67, -14.05);
        scene.add(c, f);
        shopAnim.flames.push(f);
    }
    shopAnim.orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xc8a0ff }));
    shopAnim.orb.position.set(-11, 1.58, -13.95);
    scene.add(shopAnim.orb);
    addBox(-11.2, -10.8, -14.25, -13.75, 1.18, 1.3, woodDark, false);

    // bubbling cauldron in the corner
    const cauld = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.6, 0.85, 9, 1, true), darkMat);
    cauld.position.set(-7.4, 0.6, -11.8);
    const goo = new THREE.Mesh(new THREE.CircleGeometry(0.82, 9), greenMat);
    goo.rotation.x = -Math.PI / 2;
    goo.position.set(-7.4, 1.0, -11.8);
    const cRing = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 4, 10), darkMat);
    cRing.rotation.x = Math.PI / 2;
    cRing.position.set(-7.4, 1.03, -11.8);
    scene.add(cauld, goo, cRing);
    circles.push({ x: -7.4, z: -11.8, r: 1.0 });
    const cg = new THREE.PointLight(0x7dffb0, 10, 7, 1.8);
    cg.position.set(-7.4, 1.5, -11.8);
    scene.add(cg);
    for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 4), greenMat);
        scene.add(b);
        shopAnim.bubbles.push({ m: b, ph: i / 5, ox: (Math.random() - 0.5) * 0.9, oz: (Math.random() - 0.5) * 0.9 });
    }
    // standing coffin + hanging skull lanterns + a rune circle on the floor
    const coffin = addBox(-15.6, -14.7, -12.4, -11.6, 0, 2.2, darkMat);
    coffin.rotation.y = 0.1;
    addBox(-15.5, -14.8, -11.62, -11.58, 0.4, 1.9, purpleMat, false);
    const lanterns = batch(boneMat);
    for (const lx of [-13.5, -8.5]) { lanterns.add(ICO, lx, 2.6, -11, 0, 0, 0, 0.2, 0.24, 0.22); }
    lanterns.build();
    for (const lx of [-13.5, -8.5]) {
        const g = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 4), greenMat);
        g.position.set(lx, 2.6, -10.8);
        scene.add(g);
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 4), darkMat);
        chain.position.set(lx, 3.0, -11);
        scene.add(chain);
        shopAnim.chimes.push(g);
    }
    const runes = new THREE.Group();
    runes.position.set(SHOP.x, 0.1, -11.4);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.1, 24), new THREE.MeshBasicMaterial({ color: 0xa070ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    ring.rotation.x = -Math.PI / 2;
    runes.add(ring);
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.4), new THREE.MeshBasicMaterial({ color: 0xd0b0ff }));
        r.position.set(Math.cos(a) * 1.5, 0.02, Math.sin(a) * 1.5);
        r.rotation.y = -a;
        runes.add(r);
    }
    scene.add(runes);
    shopAnim.runes = runes;

    // the shopkeeper: a tall black coat, a black hood, and only a glowing smile
    reaper = new THREE.Group();
    reaper.position.set(KEEPER.x, 0, KEEPER.z);
    scene.add(reaper);
    const cloakM = new THREE.MeshLambertMaterial({ color: 0x0b0912, flatShading: true });
    const cloak = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.0, 2.3, 8), cloakM);
    cloak.position.y = 1.15;
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.65, 8, 5), cloakM);
    shoulders.scale.set(1.15, 0.55, 0.85);
    shoulders.position.y = 2.2;
    reaperHead = new THREE.Group();
    reaperHead.position.y = 2.55;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), cloakM);
    hood.scale.set(1, 1.2, 1.1);
    const peak = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 7), cloakM);
    peak.position.set(0, 0.5, -0.25);
    peak.rotation.x = -0.7;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), new THREE.MeshBasicMaterial({ map: smileyTex(), transparent: true }));
    face.position.set(0, -0.02, 0.56);
    reaperHead.add(hood, peak, face);
    reaper.add(cloak, shoulders, reaperHead);
    for (const s of [-1, 1]) {
        const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.15), cloakM);
        sleeve.position.set(s * 0.6, 1.62, 0.65);
        sleeve.rotation.x = 0.55;
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.3), new THREE.MeshLambertMaterial({ color: 0xe8e4d0 }));
        hand.position.set(s * 0.6, 1.22, 1.2);
        reaper.add(sleeve, hand);
    }
    const scythe = new THREE.Group();
    scythe.position.set(2.0, 0, -0.4);
    scythe.rotation.z = -0.08;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.4, 5), woodDark);
    shaft.position.y = 1.7;
    const blade = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.06, 4, 14, Math.PI * 0.55), new THREE.MeshLambertMaterial({ color: 0xaab0c4, flatShading: true, emissive: 0x202838 }));
    blade.rotation.z = Math.PI / 2;
    blade.position.set(0, 3.4 - 0.85, 0);
    scythe.add(shaft, blade);
    reaper.add(scythe);
    for (let i = 0; i < 3; i++) {
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), greenMat);
        reaper.add(orb);
        reaperOrbs.push(orb);
    }

    // the stone path (decal-style slabs, polygon offset so they never z-fight with the ground)
    const L = pathCurve.getLength(), n = Math.ceil(L / 1.5);
    for (let i = 0; i <= n; i++) {
        const u = i / n, p = pathCurve.getPointAt(u), tan = pathCurve.getTangentAt(u);
        const shade = 0.27 + Math.random() * 0.08;
        const tile = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.07, 1.15), new THREE.MeshLambertMaterial({
            color: new THREE.Color(shade, shade * 0.96, shade * 0.9), flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
        }));
        tile.position.set(p.x + (Math.random() - 0.5) * 0.1, 0.05, p.z + (Math.random() - 0.5) * 0.1);
        tile.rotation.y = Math.atan2(tan.x, tan.z) + (Math.random() - 0.5) * 0.12;
        scene.add(tile);
        if (i % 4 === 2) {
            const side = (i % 8 === 2 ? 1 : -1) * 1.7;
            const px = p.x - tan.z * side, pz = p.z + tan.x * side;
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.2, 5), woodDark);
            post.position.set(px, 0.6, pz);
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), greenMat);
            bulb.position.set(px, 1.3, pz);
            scene.add(post, bulb);
        }
    }
}
// signpost where the path leaves the safehouse
{
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 5), woodDark);
    post.position.set(2.4, 1.3, -5.2);
    scene.add(post);
    for (const [txt, col, y, rot, tx] of [["< SHOP", "#c9a0ff", 2.3, 0.05, -0.2], ["CHUTE >", "#7fd8ff", 1.8, -0.04, 0.2], ["MILL >", "#8dff9a", 1.3, 0.03, 0.2]]) {
        const b = addBox(2.4 + tx - 0.55, 2.4 + tx + 0.55, -5.25, -5.15, y - 0.17, y + 0.17, wood, false);
        b.rotation.z = rot;
        const l = label(txt, col, 1.2, 0.36);
        l.position.set(2.4 + tx, y, -5.0);
    }
}

// safe-zone boundary: ring of glowing lamp posts
{
    const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.8, 5);
    const bulbGeo = new THREE.SphereGeometry(0.22, 6, 5);
    for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const x = Math.cos(a) * SAFE_R, z = Math.sin(a) * SAFE_R;
        const p = new THREE.Mesh(postGeo, woodDark);
        p.position.set(x, 0.9, z);
        const b = new THREE.Mesh(bulbGeo, glowMat);
        b.position.set(x, 1.95, z);
        scene.add(p, b);
    }
}

// ---------- log chute (hopper -> tube -> mill) ----------
const tubeCurve = new THREE.CatmullRomCurve3([
    V3(HOPPER.x, 2.5, HOPPER.z), V3(HOPPER.x, 2.1, HOPPER.z - 0.7), V3(7, 1.8, -8.4),
    V3(10, 1.55, -9.8), V3(13, 1.35, -11), V3(15.1, 1.25, -11.6)
]);
{
    for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
        addBox(HOPPER.x + dx - 0.08, HOPPER.x + dx + 0.08, HOPPER.z + dz - 0.08, HOPPER.z + dz + 0.08, 0, 2.6, woodDark, false);
    }
    circles.push({ x: HOPPER.x, z: HOPPER.z, r: 1.2 });
    const fGeo = new THREE.ConeGeometry(1.3, 1.3, 10, 1, true);
    fGeo.rotateX(Math.PI);
    const funnel = new THREE.Mesh(fGeo, new THREE.MeshLambertMaterial({ color: 0x7c8394, flatShading: true, side: THREE.DoubleSide }));
    funnel.position.set(HOPPER.x, 3.15, HOPPER.z);
    scene.add(funnel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.07, 4, 12), new THREE.MeshBasicMaterial({ color: 0xffd040 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(HOPPER.x, 3.8, HOPPER.z);
    scene.add(rim);
    label("LOG CHUTE", "#7fd8ff", 2.6, 0.6).position.set(HOPPER.x, 4.8, HOPPER.z);
    scene.add(new THREE.Mesh(
        new THREE.TubeGeometry(tubeCurve, 40, 0.3, 7, false),
        new THREE.MeshLambertMaterial({ color: 0x9ab4c8, transparent: true, opacity: 0.55, side: THREE.DoubleSide, flatShading: true })
    ));
    for (const u of [0.3, 0.62]) {
        const p = tubeCurve.getPointAt(u);
        addBox(p.x - 0.1, p.x + 0.1, p.z - 0.1, p.z + 0.1, 0, p.y - 0.3, woodDark, false);
    }
    addBox(MILL.x - 2.2, MILL.x + 2.2, MILL.z - 2.5, MILL.z + 2.5, 0, 3, new THREE.MeshLambertMaterial({ color: 0x6a2a2a, flatShading: true }));
    const mr = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 6), woodDark);
    mr.position.set(MILL.x, 3.3, MILL.z);
    mr.rotation.z = 0.12;
    scene.add(mr);
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.8), woodDark);
    chim.position.set(MILL.x + 1, 4.3, MILL.z + 1);
    scene.add(chim);
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 1.1), new THREE.MeshBasicMaterial({ color: 0x0a0210 }));
    intake.position.set(MILL.x - 2.25, 1.25, -11.6);
    scene.add(intake);
    label("LOG MILL  $", "#8dff9a", 3, 0.7).position.set(MILL.x, 5.4, MILL.z);
    const millLight = new THREE.PointLight(0x8dff9a, 18, 14, 1.8);
    millLight.position.set(MILL.x - 3, 2.6, MILL.z);
    scene.add(millLight);
    // crates and barrels around the mill, firewood by the safehouse
    const cr = batch(wood);
    for (const [x, z, s] of [[MILL.x - 3, MILL.z + 3.4, 0.9], [MILL.x - 2.1, MILL.z + 3.6, 0.7], [MILL.x + 3.2, MILL.z - 1, 1.0]]) cr.add(BOX, x, s / 2, z, 0, srand() * 2, 0, s, s, s);
    cr.build();
    const bar = batch(woodDark);
    for (const [x, z] of [[MILL.x + 3.1, MILL.z + 1.8], [MILL.x + 3.1, MILL.z + 3.0]]) bar.add(CYL8, x, 0.5, z, 0, 0, 0, 0.45, 1.0, 0.45);
    bar.build();
    const fw = batch(new THREE.MeshLambertMaterial({ color: 0x8a5a34, flatShading: true }));
    for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) fw.add(CYL6, -4.9 + (r * 0.17), 0.18 + r * 0.3, -2.0 + i * 0.36 + r * 0.17, Math.PI / 2, 0, 0, 0.16, 0.9, 0.16);
    fw.build();
}

// logs sliding down the tube
const logGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.7, 6);
logGeo.rotateZ(Math.PI / 2);
const logMat = new THREE.MeshLambertMaterial({ color: 0x9a6a3c, flatShading: true });
const logMats = {
    normal: logMat,
    ghost: new THREE.MeshBasicMaterial({ color: 0x9fe8ff }),
    blood: new THREE.MeshLambertMaterial({ color: 0xaa1818, emissive: 0x440000, flatShading: true }),
    gold: new THREE.MeshBasicMaterial({ color: 0xffd040 }),
    elder: new THREE.MeshLambertMaterial({ color: 0x7a4aa0, emissive: 0x221040, flatShading: true }),
    ironwood: new THREE.MeshLambertMaterial({ color: 0x8a98a8, flatShading: true }),
    frostbark: new THREE.MeshBasicMaterial({ color: 0xa8e4ff }),
    emberwood: new THREE.MeshBasicMaterial({ color: 0xff7a2a }),
    titan: new THREE.MeshLambertMaterial({ color: 0xd8a860, emissive: 0x3a2808, flatShading: true })
};
const sending = []; // {m, t, val}
const sendVals = [];
let sendTimer = 0;
function sendLogs() {
    if (save.logs <= 0) return false;
    const per = save.logBonus / save.logs;
    const unit = Math.ceil(save.logs / 40); // huge hauls go down the tube in stacks
    for (let left = save.logs; left > 0; left -= unit) sendVals.push((logValue() + per) * Math.min(unit, left));
    toast(`Sending ${save.logs} logs down the chute...`);
    save.logs = 0; save.logBonus = 0;
    return true;
}

// ---------- the ferry to Rebirth Island (coming soon) ----------
const FERRY_TH = -0.22, FDIR = V3(Math.cos(FERRY_TH), 0, Math.sin(FERRY_TH)), FPERP = V3(-FDIR.z, 0, FDIR.x);
const FSHORE = shoreR(FERRY_TH), DOCK_LEN = 26;
const FB = V3(FDIR.x * (FSHORE - 8), 0, FDIR.z * (FSHORE - 8)); // where the dock leaves the land
const dockPt = (a, s = 0, y = 0) => V3(FB.x + FDIR.x * a + FPERP.x * s, y, FB.z + FDIR.z * a + FPERP.z * s);
const FERRYMAN = { x: dockPt(DOCK_LEN - 3.5, -0.9).x, z: dockPt(DOCK_LEN - 3.5, -0.9).z };
let ferryman = null, ferryBoat = null, ferryLantern = null, farBeam = null, farGlow = null, waterMesh2 = null;

function signTex(l1, l2, col) {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 192;
    const g = cv.getContext("2d");
    g.fillStyle = "#120a1e"; g.fillRect(0, 0, 512, 192);
    g.strokeStyle = col; g.lineWidth = 8; g.strokeRect(6, 6, 500, 180);
    g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 14; g.textAlign = "center";
    g.font = "bold 64px Consolas, monospace"; g.fillText(l1, 256, 84);
    g.font = "bold 52px Consolas, monospace"; g.fillText(l2, 256, 148);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}
function ferrymanTex() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = "#03060c"; g.beginPath(); g.ellipse(64, 64, 58, 63, 0, 0, 7); g.fill();
    g.shadowColor = "#9fe8ff"; g.shadowBlur = 12; g.fillStyle = "#c8f4ff"; g.strokeStyle = "#c8f4ff"; g.lineCap = "round";
    g.beginPath(); g.ellipse(42, 54, 8, 11, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(86, 54, 8, 11, 0, 0, 7); g.fill();
    g.lineWidth = 5; g.beginPath(); g.arc(64, 76, 22, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

{
    const yaw = Math.atan2(FDIR.x, FDIR.z);
    const planks = batch(new THREE.MeshLambertMaterial({ color: 0x6a5240, flatShading: true }));
    for (let i = 0; i < DOCK_LEN; i++) { const p = dockPt(i + 0.5); planks.add(BOX, p.x, 0.22, p.z, 0, yaw, 0, 3.6, 0.14, 0.92); }
    planks.build();
    const posts = batch(woodDark), rails = batch(woodDark), bulbs = batch(new THREE.MeshBasicMaterial({ color: 0x9fe8ff }));
    for (let i = 0; i <= DOCK_LEN; i += 3) for (const s of [-1.9, 1.9]) {
        const p = dockPt(i, s);
        posts.add(CYL6, p.x, -0.9, p.z, 0, 0, 0, 0.12, 4.2, 0.12);
        if (i % 6 === 0) bulbs.add(ICO, p.x, 1.45, p.z, 0, 0, 0, 0.16);
    }
    for (let i = 0; i < DOCK_LEN; i++) for (const s of [-1.9, 1.9]) { const p = dockPt(i + 0.5, s, 0.95); rails.add(BOX, p.x, 0.95, p.z, 0, yaw, 0, 0.08, 0.1, 1.02); }
    posts.build(); rails.build(); bulbs.build();

    // the arch sign over the start of the dock
    for (const s of [-2.0, 2.0]) { const p = dockPt(3.5, s); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.6, 6), woodDark); m.position.set(p.x, 1.8, p.z); scene.add(m); }
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex("REBIRTH'S", "COMING SOON", "#ffe080"), side: THREE.DoubleSide }));
    const bp = dockPt(3.5, 0, 3.3);
    board.position.copy(bp); board.rotation.y = yaw + Math.PI;
    scene.add(board);
    const fl = label("THE FERRY", "#9fe8ff", 3.2, 0.7);
    fl.position.copy(dockPt(3.5, 0, 4.6)); fl.maxD = 70;

    // the ferry itself, moored beside the end of the dock
    ferryBoat = new THREE.Group();
    ferryBoat.position.copy(dockPt(DOCK_LEN - 7, 4.4, -0.15));
    ferryBoat.rotation.y = yaw;
    scene.add(ferryBoat);
    const hullM = new THREE.MeshLambertMaterial({ color: 0x4a2a1a, flatShading: true }), trimM = new THREE.MeshLambertMaterial({ color: 0x8a5a34, flatShading: true });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.0, 7.6), hullM); hull.position.y = 0.2;
    const bowG = new THREE.ConeGeometry(1.35, 2.4, 4); bowG.rotateX(Math.PI / 2); bowG.rotateZ(Math.PI / 4);
    const bow = new THREE.Mesh(bowG, hullM); bow.position.set(0, 0.2, 5.0); bow.scale.y = 0.75;
    const sternTrim = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.18, 7.8), trimM); sternTrim.position.y = 0.72;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 2.6), trimM); cabin.position.set(0, 1.5, -1.3);
    const croof = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.2, 3.0), woodDark); croof.position.set(0, 2.25, -1.3);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5, 6), woodDark); mast.position.set(0, 3.0, 1.6);
    const glowB = new THREE.MeshBasicMaterial({ color: 0x9fe8ff });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), glowB); lamp.position.set(0, 5.6, 1.6);
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.06), new THREE.MeshBasicMaterial({ color: 0xffc060 })); win.position.set(0, 1.6, 0.02);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 0.04), new THREE.MeshBasicMaterial({ color: 0xffe080 })); flag.position.set(0.75, 5.0, 1.6);
    ferryBoat.add(hull, bow, sternTrim, cabin, croof, mast, lamp, win, flag);
    ferryLantern = lamp;

    // the ferryman: long dark coat, deep hood, two pale eyes, a lantern on a pole
    ferryman = new THREE.Group();
    const fp = dockPt(DOCK_LEN - 3.5, -0.9, 0.3);
    ferryman.position.copy(fp); ferryman.rotation.y = yaw + Math.PI;
    scene.add(ferryman);
    const coatM = new THREE.MeshLambertMaterial({ color: 0x14202e, flatShading: true });
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.95, 2.3, 8), coatM); coat.position.y = 1.15;
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.62, 8, 5), coatM); sh.scale.set(1.15, 0.55, 0.85); sh.position.y = 2.2;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), coatM); hood.scale.set(1, 1.15, 1.1); hood.position.y = 2.6;
    const peak = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 7), coatM); peak.position.set(0, 3.15, -0.2); peak.rotation.x = -0.55;
    const ff = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: ferrymanTex(), transparent: true })); ff.position.set(0, 2.58, 0.56);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.2, 5), woodDark); pole.position.set(0.95, 1.6, 0.55);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 6), new THREE.MeshBasicMaterial({ color: 0xcffaff })); orb.position.set(0.95, 3.25, 0.55);
    ferryman.add(coat, sh, hood, peak, ff, pole, orb);
    const fm = label("FERRYMAN", "#9fe8ff", 2.6, 0.6);
    fm.position.set(fp.x, 4.7, fp.z); fm.maxD = 60;

    // far shore: the Rebirth Island, a golden tree and a beacon you can see from anywhere
    const FI = dockPt(DOCK_LEN + 74, 0, 0);
    const sand = new THREE.Mesh(new THREE.SphereGeometry(24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xc8b078, flatShading: true }));
    sand.scale.y = 0.22; sand.position.set(FI.x, -0.5, FI.z);
    const grassCap = new THREE.Mesh(new THREE.CircleGeometry(15, 16), new THREE.MeshLambertMaterial({ color: 0x4a8a4a, flatShading: true }));
    grassCap.rotation.x = -Math.PI / 2; grassCap.position.set(FI.x, 2.35, FI.z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.9, 13, 8), new THREE.MeshLambertMaterial({ color: 0x8a6a2a, flatShading: true, emissive: 0x3a2a08 }));
    trunk.position.set(FI.x, 8.5, FI.z);
    scene.add(sand, grassCap, trunk);
    const canopyM = new THREE.MeshBasicMaterial({ color: 0xffd860, fog: false });
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(9 - i * 2.2, 7, 8), canopyM); c.position.set(FI.x, 16 + i * 3.6, FI.z); scene.add(c); }
    farBeam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 220, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.2, fog: false, depthWrite: false, side: THREE.DoubleSide }));
    farBeam.position.set(FI.x, 110, FI.z);
    scene.add(farBeam);
    const runeB = batch(new THREE.MeshBasicMaterial({ color: 0xffe080, fog: false })), stonesB = batch(new THREE.MeshLambertMaterial({ color: 0x8a8a98, flatShading: true }));
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; stonesB.add(BOX, FI.x + Math.cos(a) * 11, 3.6, FI.z + Math.sin(a) * 11, 0, -a, 0, 1.0, 2.8, 0.7); runeB.add(BOX, FI.x + Math.cos(a) * 10.55, 4.2, FI.z + Math.sin(a) * 10.55, 0, -a, 0, 0.5, 0.1, 0.04); }
    stonesB.build(); runeB.build();
    const bl = label("REBIRTH ISLAND", "#ffe080", 5.6, 1.3); bl.position.set(FI.x, 30, FI.z); bl.maxD = 420; bl.blurK = 0.25;
    const bl2 = label("COMING SOON", "#ffffff", 4.2, 1.0); bl2.position.set(FI.x, 26, FI.z); bl2.maxD = 420; bl2.blurK = 0.25;
    farGlow = canopyM;
}
function clampToIsland(p) {
    const dx = p.x - FB.x, dz = p.z - FB.z;
    const along = dx * FDIR.x + dz * FDIR.z, side = dx * FPERP.x + dz * FPERP.z;
    if (along > 4.5 && along < DOCK_LEN + 3 && Math.abs(side) < 6) { // out on the dock: stay on the planks
        const a = Math.min(along, DOCK_LEN - 0.7), s = clamp(side, -1.65, 1.65);
        p.x = FB.x + FDIR.x * a + FPERP.x * s; p.z = FB.z + FDIR.z * a + FPERP.z * s;
        return;
    }
    const lim = shoreAt(p.x, p.z) - 3, d = Math.hypot(p.x, p.z);
    if (d > lim) { p.x *= lim / d; p.z *= lim / d; }
}
const FERRY_FIRST = [
    "Ahh... a woodcutter, out on my dock at this hour.",
    "See that golden glow, far across the water? That is Rebirth Island.",
    "One day soon, this ferry will carry you there. To a whole new life. A fresh start, with everything you have earned still waiting on this shore.",
    "But passage isn't cheap, friend. The ticket will be... expensive. Very. Expensive.",
    "Rebirths are coming soon. Keep chopping. Keep saving. I'll be right here."
];
const FERRY_AGAIN = [
    ["Back again? The water is patient, and so am I.", "Rebirths are still coming soon. Hold on to your coin."],
    ["Not yet, woodcutter. The boat isn't ready to sail.", "When it is, it won't come cheap. I wouldn't lie to you."],
    ["Every night that glow gets a little brighter, don't you think?", "Soon. Very soon."],
    ["The ticket price? Ahh... you don't want to know. Not yet."],
    ["I've ferried kings, and thieves, and one very rude goat.", "None of them paid as much as you will."]
];

// ---------- the wider map: landmarks, chests, scenery ----------
const LANDMARKS = [
    { name: "GRAVEYARD", x: -48, z: 26, r: 14, col: "#b090ff" },
    { name: "POND", x: 40, z: -34, r: 11, col: "#7fb8ff" },
    { name: "STONE CIRCLE", x: 32, z: 46, r: 10, col: "#7fd8ff" },
    { name: "WATCHTOWER", x: -50, z: -42, r: 9, col: "#c0c0d0" },
    { name: "CAMP", x: 50, z: 12, r: 7, col: "#ffb060" },
    { name: "OLD CAMP", x: -28, z: -62, r: 7, col: "#ffb060" },
    { name: "WELL", x: -20, z: 52, r: 5, col: "#9fb0c0" },
    { name: "ANCIENT STUMP", x: 10, z: 66, r: 8, col: "#c08a50" }
];
const chests = [], fires = [];
let altar = null;
const chestGold = new THREE.MeshBasicMaterial({ color: 0xffd040 }), chestPurple = new THREE.MeshBasicMaterial({ color: 0xc8a0ff });

function makeChest(x, z, rot = 0, special = false) {
    const g = new THREE.Group();
    g.position.set(x, 0, z); g.rotation.y = rot;
    scene.add(g);
    const mat = new THREE.MeshLambertMaterial({ color: special ? 0x4a2a5a : 0x7a4a22, flatShading: true });
    const gold = special ? chestPurple : chestGold;
    const base = new THREE.Mesh(BOX, mat); base.scale.set(1.1, 0.55, 0.75); base.position.y = 0.275;
    const pivot = new THREE.Group(); pivot.position.set(0, 0.55, -0.375);
    const lid = new THREE.Mesh(BOX, mat); lid.scale.set(1.1, 0.25, 0.75); lid.position.set(0, 0.125, 0.375);
    pivot.add(lid);
    for (const bx of [-0.32, 0.32]) {
        const b1 = new THREE.Mesh(BOX, gold); b1.scale.set(0.1, 0.57, 0.78); b1.position.set(bx, 0.28, 0);
        const b2 = new THREE.Mesh(BOX, gold); b2.scale.set(0.1, 0.27, 0.78); b2.position.set(bx, 0.125, 0.375);
        g.add(b1); pivot.add(b2);
    }
    const lock = new THREE.Mesh(BOX, gold); lock.scale.set(0.16, 0.2, 0.06); lock.position.set(0, 0.5, 0.39);
    g.add(base, pivot, lock);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5, 6, 1, true), new THREE.MeshBasicMaterial({ color: special ? 0xc8a0ff : 0xffd040, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    beacon.position.set(x, 2.7, z);
    scene.add(beacon);
    const c = { g, pivot, beacon, x, z, special, opened: false, openT: 0 };
    chests.push(c);
    return c;
}

function buildGraveyard(lm) {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(lm.r, 20), decalMat(0x1c1630));
    ground.rotation.x = -Math.PI / 2; ground.position.set(lm.x, 0.03, lm.z);
    scene.add(ground);
    const tomb = batch(new THREE.MeshLambertMaterial({ color: 0x6a6878, flatShading: true }));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
        const x = lm.x - 6 + c * 3 + srange(-0.5, 0.5), z = lm.z - 5 + r * 3.2 + srange(-0.5, 0.5), yaw = srange(-0.2, 0.2), tilt = srange(-0.08, 0.08);
        if (Math.hypot(x - (lm.x + 6.5), z - (lm.z + 0.5)) < 2) continue;
        tomb.add(BOX, x, 0.5, z, tilt, yaw, 0, 0.85, 1.0, 0.22);
        tomb.add(CYL8, x, 1.0, z, Math.PI / 2 + tilt, yaw, 0, 0.425, 0.22, 0.425);
        circles.push({ x, z, r: 0.55 });
    }
    tomb.build();
    const dead = batch(new THREE.MeshLambertMaterial({ color: 0x2a2230, flatShading: true }));
    for (const [dx, dz] of [[-9, -7], [8.5, -6], [-8, 8]]) {
        dead.add(CYL6, lm.x + dx, 2.0, lm.z + dz, 0, 0, 0, 0.28, 4.0, 0.28);
        for (let b = 0; b < 4; b++) dead.add(CYL6, lm.x + dx + Math.cos(b * 1.6) * 0.5, 3.0 + b * 0.4, lm.z + dz + Math.sin(b * 1.6) * 0.5, srange(-0.8, 0.8), 0, (b % 2 ? 1 : -1) * 0.9, 0.08, 1.8, 0.08);
        circles.push({ x: lm.x + dx, z: lm.z + dz, r: 0.5 });
    }
    dead.build();
    const fence = batch(new THREE.MeshLambertMaterial({ color: 0x1a1420, flatShading: true }));
    for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        if (Math.sin(a) > 0.75 && Math.abs(Math.cos(a)) < 0.35) continue; // gap on the south side
        fence.add(CYL6, lm.x + Math.cos(a) * 11.5, 0.7, lm.z + Math.sin(a) * 11.5, 0, 0, 0, 0.07, 1.4, 0.07);
        fence.add(CONE6, lm.x + Math.cos(a) * 11.5, 1.5, lm.z + Math.sin(a) * 11.5, 0, 0, 0, 0.1, 0.3, 0.1);
    }
    fence.build();
    const eerie = new THREE.MeshBasicMaterial({ color: 0x9dffd0 });
    const wb = batch(eerie);
    for (let i = 0; i < 10; i++) wb.add(ICO, lm.x + srange(-9, 9), srange(0.8, 2.6), lm.z + srange(-8, 8), 0, 0, 0, 0.12);
    wb.build();
    makeChest(lm.x + 6.5, lm.z + 0.5, -0.6, true);
}

function buildPond(lm) {
    const shore = new THREE.Mesh(new THREE.CircleGeometry(lm.r - 1.2, 20), decalMat(0x3a2e22));
    shore.rotation.x = -Math.PI / 2; shore.position.set(lm.x, 0.025, lm.z);
    const water = new THREE.Mesh(new THREE.CircleGeometry(7, 20), new THREE.MeshLambertMaterial({
        color: 0x2a5a8a, emissive: 0x0a2a4a, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
    }));
    water.rotation.x = -Math.PI / 2; water.position.set(lm.x, 0.05, lm.z);
    scene.add(shore, water);
    circles.push({ x: lm.x, z: lm.z, r: 6.4 });
    const reeds = batch(new THREE.MeshLambertMaterial({ color: 0x4a6a3a, flatShading: true }));
    for (let i = 0; i < 40; i++) {
        const a = srand() * Math.PI * 2, d = srange(6.6, 8);
        reeds.add(CONE6, lm.x + Math.cos(a) * d, 0.7, lm.z + Math.sin(a) * d, srange(-0.15, 0.15), 0, srange(-0.15, 0.15), 0.07, srange(1.1, 1.8), 0.07);
    }
    reeds.build();
    const pads = batch(new THREE.MeshLambertMaterial({ color: 0x3a8a4a, flatShading: true }));
    for (let i = 0; i < 9; i++) {
        const a = srand() * Math.PI * 2, d = srange(1, 5.5);
        pads.add(CYL8, lm.x + Math.cos(a) * d, 0.09, lm.z + Math.sin(a) * d, 0, 0, 0, 0.45, 0.02, 0.45);
    }
    pads.build();
    const dock = batch(woodDark);
    for (let i = 0; i < 7; i++) dock.add(BOX, lm.x - 8 + i * 1.05, 0.35, lm.z + 3.5, 0, 0, 0, 0.95, 0.12, 1.5);
    for (const dz of [-0.6, 0.6]) for (const dx of [-8, -5, -2]) dock.add(CYL6, lm.x + dx, 0.15, lm.z + 3.5 + dz * 1.3, 0, 0, 0, 0.07, 0.6, 0.07);
    dock.build();
    const boat = new THREE.Mesh(BOX, wood);
    boat.scale.set(1.0, 0.35, 2.4); boat.position.set(lm.x - 3, 0.18, lm.z + 5.5); boat.rotation.y = 0.3;
    scene.add(boat);
    makeChest(lm.x - 9.2, lm.z + 4.2, 1.2, false);
}

function buildStones(lm) {
    const st = batch(new THREE.MeshLambertMaterial({ color: 0x5a5a68, flatShading: true }));
    const rn = batch(new THREE.MeshBasicMaterial({ color: 0x7fd8ff }));
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, x = lm.x + Math.cos(a) * 6.2, z = lm.z + Math.sin(a) * 6.2, h = srange(2.8, 3.8);
        st.add(BOX, x, h / 2, z, srange(-0.05, 0.05), -a, srange(-0.05, 0.05), 1.0, h, 0.7);
        rn.add(BOX, x - Math.cos(a) * 0.38, h * 0.62, z - Math.sin(a) * 0.38, 0, -a, 0, 0.5, 0.08, 0.04);
        rn.add(BOX, x - Math.cos(a) * 0.38, h * 0.5, z - Math.sin(a) * 0.38, 0, -a, 0, 0.1, 0.3, 0.04);
        circles.push({ x, z, r: 0.75 });
    }
    st.add(BOX, lm.x, 0.55, lm.z, 0, 0.3, 0, 1.8, 1.1, 1.1);
    st.build(); rn.build();
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.3, 14), new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    glow.rotation.x = -Math.PI / 2; glow.position.set(lm.x, 1.14, lm.z);
    scene.add(glow);
    circles.push({ x: lm.x, z: lm.z, r: 1.4 });
    altar = { x: lm.x, z: lm.z, glow };
    label("ALTAR", "#7fd8ff", 1.6, 0.5).position.set(lm.x, 2.4, lm.z);
    makeChest(lm.x + 8.6, lm.z - 3, 2.2, false);
}

function buildTower(lm) {
    const stone = new THREE.MeshLambertMaterial({ color: 0x5a5e6e, flatShading: true });
    addBox(lm.x - 2.5, lm.x + 2.5, lm.z - 2.5, lm.z + 2.5, 0, 9, stone);
    const top = batch(stone);
    for (const [dx, dz] of [[-2.2, -2.2], [0, -2.4], [2.2, -2.2], [-2.4, 0], [2.4, 0.6], [-2.2, 2.2], [1, 2.4]]) top.add(BOX, lm.x + dx, 9.5, lm.z + dz, 0, 0, 0, 0.9, srange(0.5, 1.4), 0.7);
    top.build();
    const slits = batch(new THREE.MeshBasicMaterial({ color: 0xffb060 }));
    for (const y of [3, 5.5, 8]) { slits.add(BOX, lm.x, y, lm.z + 2.52, 0, 0, 0, 0.22, 0.8, 0.04); slits.add(BOX, lm.x + 2.52, y, lm.z, 0, 0, 0, 0.04, 0.8, 0.22); }
    slits.build();
    const rub = batch(stone);
    for (let i = 0; i < 12; i++) { const a = srand() * 6.28, d = srange(3.2, 6); rub.add(ICO, lm.x + Math.cos(a) * d, 0.25, lm.z + Math.sin(a) * d, srand(), srand(), 0, srange(0.25, 0.7), srange(0.2, 0.5), srange(0.25, 0.7)); }
    rub.build();
    makeChest(lm.x + 3.6, lm.z + 3.8, 0.5, false);
}

function buildCamp(lm, withChest) {
    const stones = batch(new THREE.MeshLambertMaterial({ color: 0x6a6660, flatShading: true }));
    for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.28; stones.add(ICO, lm.x + Math.cos(a) * 1.1, 0.18, lm.z + Math.sin(a) * 1.1, 0, 0, 0, 0.26, 0.2, 0.26); }
    stones.build();
    const logs = batch(woodDark);
    for (let i = 0; i < 4; i++) logs.add(CYL6, lm.x, 0.25, lm.z, Math.PI / 2, i * 0.8, 0, 0.12, 1.2, 0.12);
    logs.build();
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 6), new THREE.MeshBasicMaterial({ color: 0xff9a2a }));
    flame.position.set(lm.x, 0.9, lm.z);
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 5), new THREE.MeshBasicMaterial({ color: 0xffe070 }));
    core.position.set(lm.x, 0.65, lm.z);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(3.2, 14), new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.18, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(lm.x, 0.04, lm.z);
    scene.add(flame, core, pool);
    fires.push({ flame, core, ph: srand() * 6 });
    circles.push({ x: lm.x, z: lm.z, r: 1.0 });
    const tg = new THREE.ConeGeometry(2.1, 2.2, 4);
    tg.rotateY(Math.PI / 4);
    const tent = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ color: 0x6a5a40, flatShading: true, side: THREE.DoubleSide }));
    tent.position.set(lm.x + 4, 1.1, lm.z + 1.5); tent.scale.z = 1.3; tent.rotation.y = srand();
    scene.add(tent);
    circles.push({ x: lm.x + 4, z: lm.z + 1.5, r: 1.8 });
    const bench = batch(wood);
    for (const [dx, dz, r] of [[-2.2, 0.4, 0], [0.5, -2.3, Math.PI / 2], [2, -0.9, 0.4]]) bench.add(CYL6, lm.x + dx, 0.28, lm.z + dz, 0, r, Math.PI / 2, 0.22, 1.6, 0.22);
    bench.build();
    if (withChest) makeChest(lm.x - 3.5, lm.z + 3.2, 0.9, false);
}

function buildWell(lm) {
    const stone = new THREE.MeshLambertMaterial({ color: 0x6a6a74, flatShading: true });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 1.0, 10, 1, true), new THREE.MeshLambertMaterial({ color: 0x6a6a74, flatShading: true, side: THREE.DoubleSide }));
    ring.position.set(lm.x, 0.5, lm.z);
    const dark = new THREE.Mesh(new THREE.CircleGeometry(1.15, 10), new THREE.MeshBasicMaterial({ color: 0x02040a }));
    dark.rotation.x = -Math.PI / 2; dark.position.set(lm.x, 0.7, lm.z);
    scene.add(ring, dark);
    const w = batch(woodDark);
    w.add(CYL6, lm.x - 1.2, 1.4, lm.z, 0, 0, 0, 0.09, 2.8, 0.09);
    w.add(CYL6, lm.x + 1.2, 1.4, lm.z, 0, 0, 0, 0.09, 2.8, 0.09);
    w.add(CYL6, lm.x, 2.8, lm.z, 0, 0, Math.PI / 2, 0.09, 2.6, 0.09);
    w.build();
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.0, 4), new THREE.MeshLambertMaterial({ color: 0x4a2a3c, flatShading: true }));
    roof.rotation.y = Math.PI / 4; roof.position.set(lm.x, 3.3, lm.z); roof.scale.z = 0.7;
    scene.add(roof);
    circles.push({ x: lm.x, z: lm.z, r: 1.6 });
    void stone;
}

function buildStump(lm) {
    const bark = new THREE.MeshLambertMaterial({ color: 0x5a3a24, flatShading: true });
    const big = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.3, 2.6, 14), bark);
    big.position.set(lm.x, 1.3, lm.z);
    const rings = new THREE.Mesh(new THREE.CircleGeometry(3.6, 14), new THREE.MeshLambertMaterial({ color: 0x9a7040, flatShading: true }));
    rings.rotation.x = -Math.PI / 2; rings.position.set(lm.x, 2.62, lm.z);
    scene.add(big, rings);
    occluders.push(big);
    for (const rr of [1.2, 2.2, 3.0]) {
        const r = new THREE.Mesh(new THREE.RingGeometry(rr, rr + 0.12, 16), new THREE.MeshBasicMaterial({ color: 0x5a3a20, side: THREE.DoubleSide }));
        r.rotation.x = -Math.PI / 2; r.position.set(lm.x, 2.64, lm.z);
        scene.add(r);
    }
    circles.push({ x: lm.x, z: lm.z, r: 4.2 });
    const m = batch(new THREE.MeshBasicMaterial({ color: 0x7fffd8 }));
    for (let i = 0; i < 14; i++) { const a = srand() * 6.28, d = srange(4.6, 7); m.add(ICO, lm.x + Math.cos(a) * d, 0.22, lm.z + Math.sin(a) * d, 0, 0, 0, 0.25, 0.16, 0.25); }
    m.build();
    makeChest(lm.x - 6, lm.z - 2, 0.3, false);
}

const decorSpots = [];
function okSpot(x, z, margin = 1.5, inside = false) {
    const d = Math.hypot(x, z);
    if (!inside && (d < SAFE_R + 3 || d > shoreAt(x, z) - 9)) return false;
    if (inside) {
        for (const [px, pz, pr] of [[0, 0, 7.5], [SHOP.x, SHOP.z - 1, 8], [MILL.x, MILL.z, 6.5], [HOPPER.x, HOPPER.z, 4], [-5.5, -7, 7], [1, -6, 5.5]]) if (Math.hypot(x - px, z - pz) < pr) return false;
    }
    for (const lm of LANDMARKS) if (Math.hypot(x - lm.x, z - lm.z) < lm.r + margin) return false;
    return true;
}
function scatter(count, fn, inside = false, margin = 1.5) {
    let made = 0, guard = 0;
    while (made < count && guard++ < count * 30) {
        const a = srand() * Math.PI * 2, d = inside ? srange(6, SAFE_R - 1.5) : srange(SAFE_R + 3, shoreR(a) - 9);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (!okSpot(x, z, margin, inside)) continue;
        fn(x, z); made++;
    }
}

{
    buildGraveyard(LANDMARKS[0]); buildPond(LANDMARKS[1]); buildStones(LANDMARKS[2]); buildTower(LANDMARKS[3]);
    buildCamp(LANDMARKS[4], true); buildCamp(LANDMARKS[5], false); buildWell(LANDMARKS[6]); buildStump(LANDMARKS[7]);
    for (const lm of LANDMARKS) label(lm.name, lm.col, 3.2, 0.8).position.set(lm.x, lm.name === "WATCHTOWER" ? 12.5 : 5.2, lm.z);

    // wild scenery (merged: a handful of draw calls for hundreds of props)
    const rocks = batch(new THREE.MeshLambertMaterial({ color: 0x5e5a64, flatShading: true }));
    scatter(80, (x, z) => { const s = srange(0.35, 1.3); rocks.add(ICO, x, s * 0.5, z, srand() * 3, srand() * 3, 0, s, s * srange(0.6, 1), s); if (s > 0.95) circles.push({ x, z, r: s * 0.9 }); });
    rocks.build();
    const bushes = batch(new THREE.MeshLambertMaterial({ color: 0x2e5a3a, flatShading: true }));
    scatter(70, (x, z) => { const s = srange(0.6, 1.3); bushes.add(ICO, x, s * 0.5, z, 0, srand() * 3, 0, s, s * 0.8, s); });
    bushes.build();
    const stumps = batch(new THREE.MeshLambertMaterial({ color: 0x4a3322, flatShading: true }));
    scatter(26, (x, z) => { const s = srange(0.35, 0.7); stumps.add(CYL8, x, s * 0.5, z, 0, 0, 0, s, srange(0.5, 1.1), s); });
    scatter(18, (x, z) => { stumps.add(CYL6, x, 0.3, z, Math.PI / 2, srand() * 3, 0, 0.3, srange(2, 3.4), 0.3); });
    stumps.build();
    const stems = batch(new THREE.MeshLambertMaterial({ color: 0xe0d8c0, flatShading: true }));
    const capsA = batch(new THREE.MeshBasicMaterial({ color: 0x6dffe0 })), capsB = batch(new THREE.MeshBasicMaterial({ color: 0xff7ad8 }));
    scatter(60, (x, z) => {
        const s = srange(0.25, 0.6), caps = srand() < 0.5 ? capsA : capsB;
        for (let i = 0; i < 3; i++) { const dx = srange(-0.4, 0.4), dz = srange(-0.4, 0.4), ss = s * srange(0.6, 1.1); stems.add(CYL6, x + dx, ss * 0.5, z + dz, 0, 0, 0, ss * 0.18, ss, ss * 0.18); caps.add(ICO, x + dx, ss * 1.0, z + dz, 0, 0, 0, ss * 0.45, ss * 0.28, ss * 0.45); }
    });
    stems.build(); capsA.build(); capsB.build();
    // little things inside the safe zone: pebbles and grass tufts
    const peb = batch(new THREE.MeshLambertMaterial({ color: 0x7a746a, flatShading: true })), grass = batch(new THREE.MeshLambertMaterial({ color: 0x5a7a3a, flatShading: true }));
    scatter(60, (x, z) => { const s = srange(0.1, 0.3); peb.add(ICO, x, s * 0.4, z, 0, srand() * 3, 0, s, s * 0.6, s); }, true, 0);
    scatter(80, (x, z) => { for (let i = 0; i < 3; i++) grass.add(CONE6, x + srange(-0.2, 0.2), 0.22, z + srange(-0.2, 0.2), srange(-0.3, 0.3), 0, srange(-0.3, 0.3), 0.04, srange(0.3, 0.55), 0.04); }, true, 0);
    peb.build(); grass.build();
    // the beach: palms, driftwood, shells and starfish along the whole shore
    const okBeach = (x, z) => {
        const dx = x - FB.x, dz = z - FB.z, along = dx * FDIR.x + dz * FDIR.z, side = dx * FPERP.x + dz * FPERP.z;
        if (along > -8 && along < 12 && Math.abs(side) < 9) return false;
        for (const lm of LANDMARKS) if (Math.hypot(x - lm.x, z - lm.z) < lm.r + 1) return false;
        return true;
    };
    const beachSpot = (n, min, max, fn) => { for (let i = 0; i < n; i++) { const a = srand() * Math.PI * 2, d = shoreR(a) - srange(min, max), x = Math.cos(a) * d, z = Math.sin(a) * d; if (okBeach(x, z)) fn(x, z); } };
    const palmT = batch(new THREE.MeshLambertMaterial({ color: 0x7a5a3a, flatShading: true })), palmL = batch(new THREE.MeshLambertMaterial({ color: 0x3a8a4a, flatShading: true }));
    beachSpot(34, 5, 12, (x, z) => {
        const lean = srange(-0.25, 0.25), tx = x - lean * 2.2, tz = z;
        palmT.add(CYL6, x - lean * 1.1, 2.2, z, 0, 0, lean, 0.16, 4.4, 0.16);
        for (let k = 0; k < 6; k++) { const a2 = k * 1.047 + srand() * 0.3; palmL.add(BOX, tx + Math.cos(a2) * 0.95, 4.25, tz + Math.sin(a2) * 0.95, 0, -a2, -0.4, 2.0, 0.07, 0.5); }
        circles.push({ x, z, r: 0.35 });
    });
    palmT.build(); palmL.build();
    const driftB = batch(new THREE.MeshLambertMaterial({ color: 0x9a8a78, flatShading: true })), shellB = batch(new THREE.MeshBasicMaterial({ color: 0xf2e8d8 })), starB = batch(new THREE.MeshBasicMaterial({ color: 0xff8a5a })), rockB = batch(new THREE.MeshLambertMaterial({ color: 0x6a6a72, flatShading: true }));
    beachSpot(26, 3, 11, (x, z) => driftB.add(CYL6, x, 0.14, z, Math.PI / 2, 0, srand() * 3, 0.12, srange(1.5, 3.2), 0.12));
    beachSpot(70, 2, 12, (x, z) => shellB.add(ICO, x, 0.06, z, 0, srand() * 3, 0, 0.13, 0.08, 0.13));
    beachSpot(22, 2, 10, (x, z) => { starB.add(BOX, x, 0.04, z, 0, srand() * 3, 0, 0.5, 0.05, 0.12); starB.add(BOX, x, 0.04, z, 0, srand() * 3 + 1, 0, 0.5, 0.05, 0.12); });
    beachSpot(26, 1, 9, (x, z) => { const sc2 = srange(0.5, 1.6); rockB.add(ICO, x, sc2 * 0.4, z, srand(), srand() * 3, 0, sc2, sc2 * 0.7, sc2); });
    driftB.build(); shellB.build(); starB.build(); rockB.build();
    // scarecrow near the safehouse
    const sc = batch(woodDark);
    sc.add(CYL6, 9, 1.0, 8, 0, 0, 0, 0.06, 2.0, 0.06); sc.add(CYL6, 9, 1.6, 8, 0, 0, Math.PI / 2, 0.05, 1.5, 0.05);
    sc.build();
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), new THREE.MeshLambertMaterial({ color: 0xc8a060 }));
    sh.position.set(9, 2.15, 8);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.45, 6), woodDark);
    hat.position.set(9, 2.55, 8);
    scene.add(sh, hat);
}

// ---------- the living trees (rarer ones come out at night) ----------
const TYPES = {
    pine:  { name: "Pine Tree",   leaf: [0x264a3a, 0x2f2c52, 0x3d2650], trunk: 0x4a3024, hp: 1,   logs: 1,   dmg: 1,    speed: 1,    bonus: 0,  wd: 1,    wn: 0.55, col: "#3f8a62" },
    elder: { name: "Elder Tree",  leaf: [0x4a2a6a],                     trunk: 0x33233a, hp: 1.7, logs: 1.6, dmg: 1.25, speed: 1,    bonus: 2,  wd: 0.1,  wn: 0.32, col: "#a070ff", glow: 0x1a0a30, rare: true },
    ghost: { name: "Ghost Tree",  leaf: [0x9fe8ff],                     trunk: 0x7aa0b0, hp: 2.3, logs: 2,   dmg: 1.1,  speed: 1.35, bonus: 6,  wd: 0,    wn: 0.2,  col: "#8ff0ff", glow: 0x2a5a6a, rare: true, night: true, ghost: true },
    blood: { name: "Blood Tree",  leaf: [0x8a1010],                     trunk: 0x3a0a0a, hp: 3,   logs: 2.5, dmg: 1.7,  speed: 1.15, bonus: 10, wd: 0,    wn: 0.12, col: "#ff3a3a", glow: 0x3a0000, rare: true, night: true },
    ironwood: { name: "Ironwood",     leaf: [0x56687a],           trunk: 0x34343e, hp: 2.0, logs: 1.5, dmg: 1.2, speed: 1,    bonus: 3,  wd: 0.3,  wn: 0.22, col: "#a9bcd4", glow: 0x10161c, minTier: 2 },
    frostbark: { name: "Frostbark",    leaf: [0x9fe0ff],           trunk: 0x5a7a9a, hp: 2.6, logs: 2,   dmg: 1.3, speed: 1,    bonus: 8,  wd: 0.22, wn: 0.16, col: "#8fe0ff", glow: 0x0a3a5a, minTier: 3 },
    emberwood: { name: "Emberwood",    leaf: [0xff6a1a],           trunk: 0x3a1a0a, hp: 3.4, logs: 2.5, dmg: 1.6, speed: 1.1,  bonus: 14, wd: 0.2,  wn: 0.22, col: "#ff9a3a", glow: 0x6a2000, minTier: 5 },
    titan: { name: "Titan Tree",       leaf: [0x1f4a34, 0x2a3a5a], trunk: 0x4a3a2a, hp: 6,   logs: 5,   dmg: 2,   speed: 0.7,  bonus: 25, wd: 0.07, wn: 0.1,  col: "#ffd8a0", minTier: 6, titan: true },
    gold:  { name: "Golden Tree", leaf: [0xffd040],                     trunk: 0x9a7a20, hp: 2,   logs: 3,   dmg: 0,    speed: 1,    bonus: 25, wd: 0.03, wn: 0.03, col: "#ffd040", glow: 0x6a4a00, rare: true, flee: true }
};
const typeMats = {};
for (const [k, T] of Object.entries(TYPES)) {
    const base = { flatShading: true };
    if (T.glow !== undefined) base.emissive = T.glow;
    if (T.ghost) { base.transparent = true; base.opacity = 0.72; base.depthWrite = false; }
    typeMats[k] = { trunk: new THREE.MeshLambertMaterial({ color: T.trunk, ...base }), leaves: T.leaf.map(c => new THREE.MeshLambertMaterial({ color: c, ...base })) };
}
const armMat = new THREE.MeshLambertMaterial({ color: 0x2c1c16, flatShading: true });

function makeFace(mode) {
    const S = 128, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    const grd = g.createRadialGradient(64, 62, 8, 64, 62, 64);
    grd.addColorStop(0, "rgba(0,0,0,.92)");
    grd.addColorStop(0.7, "rgba(0,0,0,.6)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    const o = mode === "calm" ? 0.55 : mode === "angry" ? 0.95 : 1.3;
    const glow = mode === "calm" ? "#ff8a2a" : mode === "angry" ? "#ff2a1a" : "#ffffff";
    g.strokeStyle = "#000"; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) { g.beginPath(); const x = 20 + Math.random() * 88; g.moveTo(x, 10 + Math.random() * 20); g.lineTo(x + (Math.random() - 0.5) * 18, 40 + Math.random() * 30); g.stroke(); }
    for (const s of [-1, 1]) {
        const cx = 64 + s * 23, cy = 50;
        g.fillStyle = "#000";
        g.beginPath();
        g.moveTo(cx + s * 20, cy - 12 * o - 4); g.lineTo(cx - s * 14, cy + 2);
        g.lineTo(cx - s * 10, cy + 14 * o + 4); g.lineTo(cx + s * 18, cy + 8 * o);
        g.closePath(); g.fill();
        g.fillStyle = glow;
        g.beginPath();
        g.moveTo(cx + s * 15, cy - 7 * o - 2); g.lineTo(cx - s * 9, cy + 3);
        g.lineTo(cx - s * 6, cy + 9 * o + 2); g.lineTo(cx + s * 13, cy + 5 * o);
        g.closePath(); g.fill();
        g.fillStyle = mode === "scream" ? "#300" : "#ffe9a0";
        g.fillRect(cx - s * 3 - 2, cy + 1, 4, 6 * o + 2);
        g.strokeStyle = "#000"; g.lineWidth = 4;
        g.beginPath(); g.moveTo(cx + s * 27, cy - 18 * o - 6); g.lineTo(cx - s * 14, cy - 4); g.stroke();
    }
    const my = 88, mw = 36, open = mode === "calm" ? 6 : mode === "angry" ? 16 : 36, n = 8;
    const xAt = i => 64 - mw + (2 * mw * i) / n;
    g.fillStyle = mode === "scream" ? "#3a0000" : "#000";
    g.beginPath();
    g.moveTo(xAt(0), my);
    for (let i = 0; i <= n; i++) g.lineTo(xAt(i), my + (i % 2 ? 4 : -3));
    for (let i = n; i >= 0; i--) g.lineTo(xAt(i), my + open + (i % 2 ? -4 : 3));
    g.closePath(); g.fill();
    if (mode !== "calm") { g.fillStyle = "rgba(255,50,20,.5)"; g.fillRect(64 - mw + 6, my + 4, mw * 2 - 12, Math.max(2, open - 8)); }
    g.fillStyle = "#e9e2c6";
    for (let i = 1; i < n; i += 2) {
        const x = xAt(i), tl = 5 + open * 0.28;
        g.beginPath(); g.moveTo(x - 4, my - 1); g.lineTo(x + 4, my - 1); g.lineTo(x, my + tl); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(xAt(i + 1) - 4, my + open + 1); g.lineTo(xAt(i + 1) + 4, my + open + 1); g.lineTo(xAt(i + 1), my + open - tl + 2); g.closePath(); g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
}
const faceMats = { calm: makeFace("calm"), angry: makeFace("angry"), scream: makeFace("scream") };

function armGeometry(len) {
    const a = new THREE.CylinderGeometry(0.04, 0.17, len, 5);
    a.translate(0, len / 2, 0);
    const parts = [a];
    for (let i = -1; i <= 1; i++) {
        const c = new THREE.ConeGeometry(0.035, 0.34, 4);
        c.rotateZ(i * 0.45);
        c.translate(i * 0.07, len + 0.12, 0);
        parts.push(c);
    }
    return mergeGeometries(parts.map(p => p.toNonIndexed()));
}

const trees = [];
let time = 0;

function makeTree(x, z, h, key = "pine") {
    const T = TYPES[key], M = typeMats[key];
    const r = 0.42 + h * 0.075;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const body = new THREE.Group();
    g.add(body);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, h * 1.05, 8), M.trunk);
    trunk.position.y = h * 0.525;
    body.add(trunk);
    const cones = [];
    for (let i = 0; i < 3; i++) {
        const c = new THREE.ConeGeometry(r * 3.6 * (1 - i * 0.22), h * 0.45, 7);
        c.rotateY(Math.random() * 3);
        c.translate(0, h * 0.72 + i * h * 0.17, 0);
        cones.push(c.toNonIndexed());
    }
    const foliage = new THREE.Mesh(mergeGeometries(cones), M.leaves[Math.floor(Math.random() * M.leaves.length)]);
    body.add(foliage);
    const faceY = Math.min(h * 0.3, 2.0);
    const rAt = r * (1 - 0.3 * (faceY / h));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), faceMats.calm);
    face.scale.setScalar(r * 2.3);
    face.position.set(0, faceY, rAt * 0.92 + 0.04);
    body.add(face);
    const armLen = 1.2 + h * 0.22, aGeo = armGeometry(armLen), arms = [];
    for (const s of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(s * rAt * 0.85, faceY + 0.4, 0);
        const arm = new THREE.Mesh(aGeo, armMat);
        arm.rotation.z = -s * 2.4;
        pivot.add(arm);
        body.add(pivot);
        arms.push({ pivot, arm, s });
    }
    scene.add(g);
    const hp = Math.ceil(h * 0.7 * T.hp * (1 + 0.12 * (save.day - 1)) * hpScale());
    const t = {
        g, body, face, arms, h, r, x, z, key, type: T, hp, maxHp: hp, solid: [trunk, foliage],
        dying: false, burn: false, t: 0, hurt: 0, phase: Math.random() * 6, gone: false,
        mode: "calm", atk: "idle", atkT: 0, cool: 1 + Math.random() * 3, armUp: 0, swing: 0, bar: null, barT: 0, _d: 99, _seen: false
    };
    trees.push(t);
    return t;
}

function pickType() {
    const night = isNight();
    let total = 0;
    const tier = bestIdx();
    for (const T of Object.values(TYPES)) if ((T.minTier || 0) <= tier) total += night ? T.wn : T.wd;
    let r = Math.random() * total;
    for (const [k, T] of Object.entries(TYPES)) { if ((T.minTier || 0) > tier) continue; r -= night ? T.wn : T.wd; if (r <= 0) return k; }
    return "pine";
}
let lastRareToast = -99;
function spawnTree(announce = true) {
    for (let tries = 0; tries < 40; tries++) {
        const a = Math.random() * Math.PI * 2, d = SAFE_R + 4 + Math.random() * (shoreR(a) - 10 - SAFE_R - 4);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (Math.hypot(x - player.pos.x, z - player.pos.z) < 18) continue;
        let bad = false;
        for (const lm of LANDMARKS) if (Math.hypot(x - lm.x, z - lm.z) < lm.r + 2) { bad = true; break; }
        if (bad) continue;
        for (const o of trees) if (!o.gone && Math.hypot(x - o.x, z - o.z) < 6) { bad = true; break; }
        if (bad) continue;
        const key = pickType();
        const t = makeTree(x, z, TYPES[key].titan ? 10 + Math.random() * 2 : 3 + Math.random() * 7, key);
        if (announce && (TYPES[key].night || TYPES[key].titan) && time - lastRareToast > 25) { lastRareToast = time; toast(TYPES[key].titan ? `A ${TYPES[key].name} towers somewhere in the woods...` : `A ${TYPES[key].name} stirs somewhere in the woods...`, "rare"); }
        return t;
    }
}

// ---------- player ----------
const player = {
    pos: new THREE.Vector3(0, 1.7, -0.5), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
    onGround: true, dashCd: 0, bob: 0, hp: maxHpNow(), maxHp: maxHpNow(), invuln: 0, lantern: true
};
const keys = {};
let mouseDown = false;
const inSafe = () => Math.hypot(player.pos.x, player.pos.z) < SAFE_R;


// ---------- axe viewmodel ----------
const axe = new THREE.Group();
let steelM, edgeM, headMesh;
{
    const woodM = new THREE.MeshLambertMaterial({ color: 0x8a5a34, flatShading: true });
    steelM = new THREE.MeshLambertMaterial({ color: 0x6a7388, flatShading: true, emissive: 0x0a0e18 });
    edgeM = new THREE.MeshLambertMaterial({ color: 0xc4ccdc, flatShading: true, emissive: 0x141a24 });
    const glove = new THREE.MeshLambertMaterial({ color: 0x2a2230, flatShading: true });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 1.15, 6), woodM);
    handle.position.y = 0.36;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), woodM);
    knob.position.y = -0.22;
    // bearded axe head: poll at the back, cutting edge curving out front (-z)
    const sh = new THREE.Shape();
    sh.moveTo(-0.08, 0.0);
    sh.lineTo(-0.08, 0.27);
    sh.lineTo(0.03, 0.29);
    sh.lineTo(0.2, 0.38);
    sh.quadraticCurveTo(0.31, 0.16, 0.19, -0.1);
    sh.lineTo(0.04, 0.02);
    sh.closePath();
    const hg = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 });
    hg.translate(0, 0, -0.0175);
    hg.rotateY(Math.PI / 2);
    headMesh = new THREE.Mesh(hg, [steelM, edgeM]);
    headMesh.position.y = 0.6;
    const fist1 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.11), glove);
    fist1.position.y = 0.0;
    const fist2 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.11), glove);
    fist2.position.y = 0.26;
    axe.add(handle, knob, headMesh, fist1, fist2);
    axe.scale.setScalar(0.62);
    viewScene.add(axe);
}
const AXES = [
    { name: "Rusty Axe",    dmg: 1,  cost: 0,    steel: 0x5c4a3e, edge: 0x9a8a78, glow: 0x000000, scale: 1.0,  rarity: "#c0a98a" },
    { name: "Iron Axe",     dmg: 2,  cost: 50,   steel: 0x6a7388, edge: 0xc4ccdc, glow: 0x0a0e18, scale: 1.05, rarity: "#9fb4d8" },
    { name: "Steel Axe",    dmg: 4,  cost: 200,  steel: 0x9aa6c0, edge: 0xf2f6ff, glow: 0x1a2236, scale: 1.1,  rarity: "#7fd8ff" },
    { name: "Frost Axe",    dmg: 6,  cost: 450,  steel: 0x3a6a9a, edge: 0xbff0ff, glow: 0x0a3a6a, scale: 1.14, rarity: "#8fe0ff" },
    { name: "Obsidian Axe", dmg: 9,  cost: 900,  steel: 0x1d1230, edge: 0xb04aff, glow: 0x2a0a50, scale: 1.2,  rarity: "#c07aff" },
    { name: "Inferno Axe",  dmg: 14, cost: 2000, steel: 0x5a1a0a, edge: 0xff8a2a, glow: 0x8a2a00, scale: 1.28, rarity: "#ff9a3a" },
    { name: "Moonblade",    dmg: 20, cost: 4500, steel: 0x5a6a9a, edge: 0xe8f0ff, glow: 0x3a4a8a, scale: 1.34, rarity: "#b8c8ff", night: 1.5 },
    { name: "Reaper's Axe", dmg: 30, cost: 9000, steel: 0x10261a, edge: 0x6dffa0, glow: 0x0a6a30, scale: 1.42, rarity: "#6dffa0" }
];
const axeDmg = () => { const a = AXES[save.equipped]; return Math.round(a.dmg * (a.night && isNight() ? a.night : 1)); };
const ownedList = () => AXES.map((a, i) => i).filter(i => save.owned[i]);
function applyAxeLook() {
    const a = AXES[save.equipped];
    steelM.color.setHex(a.steel); steelM.emissive.setHex(a.glow);
    edgeM.color.setHex(a.edge); edgeM.emissive.setHex(a.glow);
    headMesh.scale.setScalar(a.scale);
}
applyAxeLook();
for (let i = 0; i < 60; i++) spawnTree(false); // (needs AXES for the difficulty scale)
const KF = {
    rest: [-0.2, 1.1, 0.08, 0.56, -0.78, -1.0],
    wind: [0.35, 0.95, 0.45, 0.46, -0.55, -1.1],
    hit: [-1.35, 0.25, -0.1, 0.3, -0.9, -1.15]
};
function mixKF(a, b, k) { return a.map((v, i) => lerp(v, b[i], k)); }
const swing = { t: 1, hit: false };
function animateAxe() {
    const sp = Math.hypot(player.vel.x, player.vel.z);
    let p = KF.rest;
    if (swing.t < 1) {
        const t = swing.t;
        if (t < 0.32) p = mixKF(KF.rest, KF.wind, 1 - Math.pow(1 - t / 0.32, 2));
        else if (t < 0.5) p = mixKF(KF.wind, KF.hit, Math.pow((t - 0.32) / 0.18, 2));
        else p = mixKF(KF.hit, KF.rest, 1 - Math.pow(1 - (t - 0.5) / 0.5, 2));
    }
    if (window.__axeOv) p = window.__axeOv; // test hook
    const bob = Math.sin(player.bob) * 0.015 * Math.min(1, sp / 5);
    axe.rotation.set(p[0], p[1], p[2]);
    axe.position.set(p[3], p[4] + bob, p[5]);
}

// ---------- particles / pickups ----------
const chipGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const chipMats = [0xb07a45, 0xffd040, 0x6a4028].map(c => new THREE.MeshBasicMaterial({ color: c }));
const chips = [];
function burst(pos, n, speed = 4, mats = chipMats) {
    for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(chipGeo, mats[i % mats.length]);
        m.position.copy(pos);
        scene.add(m);
        chips.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed), life: 0.5 + Math.random() * 0.4 });
    }
}
const logs = [];
function dropLogs(x, z, n, back, key = "pine") {
    const T = TYPES[key];
    const meshes = Math.min(n, 14), base = Math.floor(n / meshes), extra = n % meshes; // big drops are stacks of logs, not hundreds of meshes
    for (let i = 0; i < meshes; i++) {
        const m = new THREE.Mesh(logGeo, logMats[key] || logMat);
        const d = Math.random() * 2.5;
        m.position.set(x + back.x * d, 0.4, z + back.z * d);
        m.rotation.y = Math.random() * 3;
        scene.add(m);
        logs.push({ m, vy: 3 + Math.random() * 3, bonus: T.bonus, w: base + (i < extra ? 1 : 0) });
        if (base > 1) m.scale.setScalar(Math.min(1.8, 1 + base * 0.08));
    }
}

// ---------- game state ----------
let state = "title"; // title | playing | paused | dead
let panel = null;    // null | inv | map | shop
let shopTab = "axes";
let shake = 0, hitstop = 0, fovKick = 0, flash = 0, hurtFlash = 0, deadT = 0, orbit = 0;
let pickupAcc = 0, pickupT = 0, soldAcc = 0, soldT = 0;
let locked = false, saveT = 0, ghostAcc = 0, owlT = 18, wasNight = isNight(), dirT = 0;
const flashEl = $("flash"), hurtEl = $("hurt");
const ACTIVATE = 16; // trees ignore you until you get this close

// ---------- toasts ----------
function toast(msg, kind = "") {
    const d = document.createElement("div");
    d.className = "toast " + kind;
    d.textContent = msg;
    $("toasts").appendChild(d);
    while ($("toasts").children.length > 5) $("toasts").firstChild.remove();
    setTimeout(() => d.classList.add("gone"), 2800);
    setTimeout(() => d.remove(), 3400);
}
const money = n => "$" + Math.floor(n).toLocaleString();
const fmtTime = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + "h " : "") + m + "m " + (s % 60) + "s"; };

// ---------- contracts, day events ----------
function newContract() {
    const roll = Math.random(), m = 1 + 0.12 * (save.day - 1);
    if (isNight() && roll < 0.5) save.contract = { type: "rare", goal: 1, prog: 0, reward: Math.round(170 * m), text: "Fell a rare tree" };
    else if (roll < 0.6) { const g = 4 + Math.floor(Math.random() * 5); save.contract = { type: "fell", goal: g, prog: 0, reward: Math.round(g * 14 * m), text: `Fell ${g} trees` }; }
    else { const g = 12 + Math.floor(Math.random() * 14); save.contract = { type: "sell", goal: g, prog: 0, reward: Math.round(g * 6 * m), text: `Sell ${g} logs at the mill` }; }
}
function contractProgress(kind, n = 1) {
    const c = save.contract;
    if (!c || c.type !== kind) return;
    c.prog += n;
    if (c.prog >= c.goal) {
        save.money += c.reward;
        toast(`Contract complete: ${c.text} (+${money(c.reward)})`, "cash");
        sfx(660, 0.3, "triangle", 0.14, 2);
        save.contract = null;
        setTimeout(() => { if (!save.contract) newContract(); }, 3000);
    }
}
function resetChests() { for (const c of chests) { c.opened = false; c.beacon.visible = true; } }
function onDusk() { toast("Night falls. Rare trees are stirring in the woods...", "rare"); sfx(190, 0.7, "sine", 0.07, 0.5); owl(); }
function onDawn() {
    save.day++;
    toast(`Dawn of day ${save.day}. The night trees burn away.`, "good");
    for (const t of trees) if (t.type.night && !t.gone && !t.dying) t.burn = true;
    resetChests();
    if (!save.contract) newContract();
    writeSave();
}
if (!save.contract) newContract();

// ---------- combat ----------
const fwd = new THREE.Vector3();
function tryHit() {
    camera.getWorldDirection(fwd);
    const fl = Math.hypot(fwd.x, fwd.z) || 1, dx0 = fwd.x / fl, dz0 = fwd.z / fl;
    let best = null, bestD = 1e9;
    for (const t of trees) {
        if (t.dying || t.gone || t.burn) continue;
        const dx = t.x - player.pos.x, dz = t.z - player.pos.z;
        const d = Math.hypot(dx, dz) - t.r;
        if (d > 3.5) continue;
        if ((dx * dx0 + dz * dz0) / (Math.hypot(dx, dz) || 1) < 0.72) continue;
        if (d < bestD) { bestD = d; best = t; }
    }
    if (!best) { sfx(160, 0.12, "sawtooth", 0.05, 0.6); return; }
    const dmg = axeDmg();
    best.hp -= dmg;
    best.hurt = 1;
    floatWorld(V3(best.x, Math.min(best.h * 0.55, 3.2), best.z), "-" + dmg, "dmg");
    showBar(best);
    shake = Math.min(0.5, shake + 0.25);
    hitstop = 0.07; fovKick = 1; flash = 0.2;
    const col = { ghost: [0x9fe8ff, 0xffffff], blood: [0xaa1818, 0xff5a5a], gold: [0xffd040, 0xfff0a0], elder: [0x7a4aa0, 0xc8a0ff], ironwood: [0xa9bcd4, 0x6a7a8a], frostbark: [0x8fe0ff, 0xffffff], emberwood: [0xff9a3a, 0xffe070], titan: [0xd8a860, 0xfff0c0] }[best.key];
    burst(V3(best.x + (player.pos.x - best.x) * 0.1, Math.min(best.h * 0.35, 2.2), best.z + (player.pos.z - best.z) * 0.1), 10, 4, col ? col.map(c => new THREE.MeshBasicMaterial({ color: c })) : chipMats);
    sfx(140, 0.14, "square", 0.18, 0.4);
    sfx(520 + Math.random() * 200, 0.2, "sawtooth", 0.07, 0.35);
    if (best.hp <= 0) fellTree(best);
}
function fellTree(t) {
    t.dying = true; t.t = 0;
    save.felled++;
    contractProgress("fell");
    if (t.type.rare) { save.rareFelled++; contractProgress("rare"); toast(`You felled a ${t.type.name}!`, "rare"); }
    sfx(90, 0.4, "sawtooth", 0.15, 0.4);
}

function hurtPlayer(dmg, sx, sz) {
    if (player.invuln > 0 || state !== "playing") return;
    player.hp -= dmg;
    player.invuln = 0.5;
    hurtFlash = 1; shake = Math.min(0.8, shake + 0.5);
    sfx(80, 0.3, "sawtooth", 0.25, 0.4);
    sfx(300, 0.15, "square", 0.1, 0.3);
    floatScreen("-" + dmg, "hurt");
    if (sx !== undefined) {
        const dx = sx - player.pos.x, dz = sz - player.pos.z;
        const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
        $("dmgdir").style.transform = "rotate(" + Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) + "rad)";
        dirT = 0.9;
    }
    if (player.hp <= 0) die();
}
function die() {
    player.hp = 0;
    state = "dead";
    deadT = 0;
    const lost = save.logs;
    save.logs = 0; save.logBonus = 0;
    save.deaths++;
    mouseDown = false;
    panel = null;
    $("deathLost").textContent = lost > 0 ? `The forest keeps your ${lost} log${lost === 1 ? "" : "s"}.` : "You had no logs. Lucky you.";
    $("death").classList.add("show");
    sfx(60, 1.0, "sawtooth", 0.3, 0.2);
    writeSave();
    showPanels();
}
function respawn() {
    if (state !== "dead" || deadT < 1.2) return;
    player.maxHp = maxHpNow();
    player.hp = player.maxHp;
    player.pos.set(RESPAWN.x, 1.7, RESPAWN.z);
    player.vel.set(0, 0, 0);
    player.yaw = 0; player.pitch = 0;
    player.invuln = 3;
    state = "playing";
    $("death").classList.remove("show");
    toast("You wake up in the safehouse. The logs are gone.", "bad");
    if (document.pointerLockElement !== canvas) { try { canvas.requestPointerLock(); } catch (e) { /* needs a gesture */ } }
}

function useBandage() {
    if (save.bandages <= 0) { toast("No bandages. Buy more from the Reaper.", "bad"); return; }
    if (player.hp >= player.maxHp) { toast("You're already at full health."); return; }
    save.bandages--;
    player.hp = Math.min(player.maxHp, player.hp + 40);
    sfx(500, 0.25, "triangle", 0.12, 1.8);
    toast("+40 HP", "good");
}
let talk = { who: "", lines: [], i: 0, shown: 0 };
function startTalk(who, lines) {
    talk = { who, lines, i: 0, shown: 0 };
    $("talkWho").textContent = who;
    openPanel("talk");
}
function advanceTalk() {
    const line = talk.lines[talk.i];
    if (!line) { closePanel(); return; }
    if (talk.shown < line.length) { talk.shown = line.length; return; }
    if (talk.i < talk.lines.length - 1) { talk.i++; talk.shown = 0; sfx(260, 0.08, "triangle", 0.05, 1.2); }
    else closePanel();
}
function updateTalk(dt) {
    const line = talk.lines[talk.i];
    if (!line) return;
    const before = Math.floor(talk.shown);
    talk.shown = Math.min(line.length, talk.shown + dt * 48);
    const n = Math.floor(talk.shown);
    if (n !== before && line[n - 1] !== " " && n % 2 === 0) sfx(190 + Math.random() * 40, 0.04, "square", 0.025, 0.9);
    $("talkText").textContent = line.slice(0, n);
    $("talkHint").textContent = n >= line.length ? (talk.i < talk.lines.length - 1 ? "click or press F to continue  ▶" : "click or press F to end") : "";
    $("talkStep").textContent = (talk.i + 1) + " / " + talk.lines.length;
}
function toggleLantern() { player.lantern = !player.lantern; viewLamp.visible = player.lantern; }
function equipAxe(i) {
    if (!save.owned[i]) { toast(`${AXES[i].name} is locked. The Reaper sells it.`, "bad"); return; }
    if (save.equipped === i) return;
    save.equipped = i;
    applyAxeLook();
    swing.t = 1;
    sfx(420, 0.12, "triangle", 0.1, 1.4);
    toast(`Equipped ${AXES[i].name}`);
}
function openChest(c) {
    if (c.opened) return;
    c.opened = true; c.beacon.visible = false; save.chestsOpened++;
    const m = 1 + 0.15 * (save.day - 1), r = Math.random();
    let msg;
    if (c.special) { const cash = Math.round(rand(120, 260) * m); save.money += cash; save.bandages++; msg = `Cursed chest: +${money(cash)} and a bandage`; }
    else if (r < 0.6) { const cash = Math.round(rand(25, 85) * m); save.money += cash; msg = `Chest: +${money(cash)}`; }
    else if (r < 0.85) { const cash = Math.round(rand(10, 30) * m); save.money += cash; save.bandages++; msg = `Chest: a bandage and ${money(cash)}`; }
    else { save.logs += 8; save.logBonus += 16; msg = "Chest: a bundle of 8 fine logs"; }
    toast(msg, "cash");
    sfx(520, 0.15, "triangle", 0.1, 1.8); setTimeout(() => sfx(780, 0.25, "triangle", 0.1, 1.4), 120);
    burst(V3(c.x, 0.8, c.z), 14, 5, [chestGold, chestGold, chipMats[1]]);
    writeSave();
}

// ---------- shop / inventory ----------
function shopItems() {
    const out = [];
    if (shopTab === "axes") {
        AXES.forEach((a, i) => {
            if (i === 0) return;
            out.push({ name: a.name, desc: `${a.dmg} damage per swing${a.night ? " (x1.5 at night)" : ""}`, cost: a.cost, owned: !!save.owned[i], axe: i, col: a.rarity, buy() {
                const old = hpScale();
                save.owned[i] = 1;
                const f = hpScale() / old;
                for (const t of trees) if (!t.gone && !t.dying && !t.burn && f > 1) { t.hp = Math.ceil(t.hp * f); t.maxHp = Math.ceil(t.maxHp * f); }
                equipAxe(i);
            } });
        });
    } else {
        out.push(
            { name: "Ghost Lumberjack", desc: `Chops while you're away. Owned: ${save.ghosts} (+$0.8/s each)`, cost: ghostCost(), buy() { save.ghosts++; } },
            { name: "Bandage", desc: `Heals 40 HP (H). Owned: ${save.bandages}`, cost: BANDAGE_COST, buy() { save.bandages++; } },
            { name: "Better Log Price", desc: `Each log sells for $${logValue()} → $${logValue() + 2}`, cost: priceCost(), buy() { save.priceLvl++; } },
            { name: "Vitality", desc: `+20 max health (${save.hpLvl}/5)`, cost: hpCost(), maxed: save.hpLvl >= 5, buy() { save.hpLvl++; player.maxHp = maxHpNow(); player.hp = player.maxHp; } },
            { name: "Swift Boots", desc: `+7% move speed (${save.bootLvl}/4)`, cost: bootCost(), maxed: save.bootLvl >= 4, buy() { save.bootLvl++; } },
            { name: "Lantern Oil", desc: `A brighter, longer-reaching lantern (${save.oilLvl}/3)`, cost: oilCost(), maxed: save.oilLvl >= 3, buy() { save.oilLvl++; } }
        );
    }
    return out;
}
function buy(i) {
    const it = shopItems()[i];
    if (!it) return;
    if (it.owned) { if (it.axe !== undefined) equipAxe(it.axe); return; }
    if (it.maxed) { toast("Already maxed out.", "bad"); return; }
    if (save.money < it.cost) { toast("Not enough cash.", "bad"); sfx(120, 0.15, "square", 0.08, 0.6); return; }
    save.money -= it.cost;
    it.buy();
    sfx(520, 0.2, "triangle", 0.14, 2);
    toast(`Bought ${it.name}`, "good");
    renderShop();
    writeSave();
}
function renderShop() {
    $("shopCash").textContent = money(save.money);
    document.querySelectorAll("#panelShop .tab").forEach(b => b.classList.toggle("on", b.dataset.tab === shopTab));
    const shopHtml = shopItems().map((it, i) => {
        const cls = it.owned ? "owned" : it.maxed ? "owned" : save.money >= it.cost ? "ok" : "no";
        const costTxt = it.owned ? (save.equipped === it.axe ? "EQUIPPED" : "OWNED · click to equip") : it.maxed ? "MAX" : money(it.cost);
        return `<div class="row ${cls}" data-i="${i}"><span class="key">${i + 1}</span><div class="info"><b${it.col ? ` style="color:${it.col}"` : ""}>${it.name}</b><small>${it.desc}</small></div><span class="cost">${costTxt}</span></div>`;
    }).join("");
    if ($("shopList").dataset.h !== shopHtml) { $("shopList").innerHTML = shopHtml; $("shopList").dataset.h = shopHtml; }
}
function renderInv() {
    const cards = ownedList().map(i => {
        const a = AXES[i], eq = save.equipped === i;
        return `<div class="card ${eq ? "eq" : ""}" data-act="axe" data-i="${i}" style="border-color:${a.rarity}"><div class="big">🪓</div><b style="color:${a.rarity}">${a.name}</b><small>${a.dmg} dmg${eq ? " · EQUIPPED" : ""}</small></div>`;
    });
    cards.push(
        `<div class="card"><div class="big">🪵</div><b>Logs</b><small>${save.logs} carried · $${logValue()} each${save.logBonus ? " + $" + Math.floor(save.logBonus) + " bonus" : ""}</small></div>`,
        `<div class="card" data-act="bandage"><div class="big">🩹</div><b>Bandages</b><small>${save.bandages} · click to heal 40</small></div>`,
        `<div class="card" data-act="lantern"><div class="big">🔦</div><b>Lantern</b><small>${player.lantern ? "On" : "Off"} · click to toggle</small></div>`,
        `<div class="card"><div class="big">💰</div><b>Cash</b><small>${money(save.money)}</small></div>`
    );
    while (cards.length < 12) cards.push(`<div class="card empty"></div>`);
    const invHtml = cards.join("");
    if ($("invSlots").dataset.h !== invHtml) { $("invSlots").innerHTML = invHtml; $("invSlots").dataset.h = invHtml; }
    const c = save.contract;
    const statsHtml = [
        ["Day", `${save.day} · ${fmtClock()}`],
        ["Health", `${Math.ceil(player.hp)} / ${player.maxHp}`],
        ["Equipped", AXES[save.equipped].name],
        ["Contract", c ? `${c.prog}/${c.goal}` : "none"],
        ["Trees felled", save.felled],
        ["Rare trees", save.rareFelled],
        ["Chests opened", save.chestsOpened],
        ["Logs sold", save.sold],
        ["Deaths", save.deaths],
        ["Ghost income", `$${ghostIncome().toFixed(1)}/s`],
        ["Time played", fmtTime(save.seconds)]
    ].map(r => `<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join("");
    if ($("invStats").dataset.h !== statsHtml) { $("invStats").innerHTML = statsHtml; $("invStats").dataset.h = statsHtml; }
}
function showPanels() {
    $("panelInv").classList.toggle("show", panel === "inv");
    $("panelMap").classList.toggle("show", panel === "map");
    $("panelShop").classList.toggle("show", panel === "shop");
    $("panelTalk").classList.toggle("show", panel === "talk");
    $("panelBack").classList.toggle("show", panel !== null && panel !== "talk");
    if (panel === "inv") renderInv();
    if (panel === "map") drawMap();
    if (panel === "shop") renderShop();
}
function openPanel(p) {
    if (state !== "playing") return;
    panel = p; mouseDown = false;
    showPanels();
    if (document.pointerLockElement) document.exitPointerLock(); // free the mouse for the menu
}
function closePanel() {
    if (!panel) return;
    panel = null;
    showPanels();
    if (state === "playing" && document.pointerLockElement !== canvas) { try { canvas.requestPointerLock(); } catch (e) { /* click the game to re-lock */ } }
}
const togglePanel = p => (panel === p ? closePanel() : openPanel(p));
document.addEventListener("click", e => {
    if (e.target.closest("[data-close]") || e.target.id === "panelBack") closePanel();
    const tab = e.target.closest(".tab");
    if (e.target.closest("#panelTalk") && !e.target.closest("[data-close]")) advanceTalk();
    if (tab) { shopTab = tab.dataset.tab; renderShop(); }
    const row = e.target.closest("#shopList .row");
    if (row) buy(+row.dataset.i);
    const card = e.target.closest("#invSlots [data-act]");
    if (card) {
        if (card.dataset.act === "axe") equipAxe(+card.dataset.i);
        else if (card.dataset.act === "bandage") useBandage();
        else if (card.dataset.act === "lantern") toggleLantern();
        renderInv();
    }
});

// ---------- damage feedback: floating numbers, tree health bars, hit direction ----------
function floatWorld(pos, text, cls = "dmg") {
    const v = pos.clone().project(camera);
    if (v.z > 1) return;
    const d = document.createElement("div");
    d.className = "float " + cls;
    d.textContent = text;
    d.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + "px";
    d.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + "px";
    $("floaters").appendChild(d);
    setTimeout(() => d.remove(), 1000);
}
function floatScreen(text, cls) {
    const d = document.createElement("div");
    d.className = "float " + cls;
    d.textContent = text;
    d.style.left = "50%"; d.style.top = "44%";
    $("floaters").appendChild(d);
    setTimeout(() => d.remove(), 1000);
}
function showBar(t) {
    if (!t.bar) {
        t.bar = document.createElement("div");
        t.bar.className = "tbar";
        t.bar.innerHTML = "<i></i><b></b><u></u>";
        t.bar.querySelector("u").textContent = t.type.name;
        t.bar.querySelector("u").style.color = t.type.col;
        $("floaters").appendChild(t.bar);
    }
    t.barT = 2.4;
}
const barV = new THREE.Vector3();
function updateBars(dt) {
    for (const t of trees) {
        if (!t.bar) continue;
        t.barT -= dt;
        if (t.barT <= 0 || t.gone || t.dying) { t.bar.remove(); t.bar = null; continue; }
        barV.set(t.x, Math.min(t.h * 1.3, 9.5) + 0.7, t.z).project(camera);
        if (barV.z > 1) { t.bar.style.display = "none"; continue; }
        t.bar.style.display = "";
        t.bar.style.left = ((barV.x * 0.5 + 0.5) * innerWidth) + "px";
        t.bar.style.top = ((-barV.y * 0.5 + 0.5) * innerHeight) + "px";
        t.bar.firstChild.style.width = Math.max(0, t.hp / t.maxHp * 100) + "%";
        t.bar.children[1].textContent = Math.max(0, t.hp) + " / " + t.maxHp;
    }
    dirT = Math.max(0, dirT - dt);
    $("dmgdir").style.opacity = Math.min(1, dirT / 0.9);
}

// ---------- tree nameplates (name, damage, logs) ----------
const plates = [];
const plateV = new THREE.Vector3();
const treeDmg = t => (t.type.flee ? 0 : Math.round((8 + t.h) * t.type.dmg * (1 + 0.05 * (save.day - 1)) * dmgScale()));
const treeLogs = t => Math.max(1, Math.round(Math.ceil(t.h / 2) * t.type.logs * rewardScale()));
function hidePlates() { for (const p of plates) p.style.display = "none"; }
function updateNameplates() {
    const cands = [];
    for (const t of trees) {
        if (t.gone || t.dying || t.burn) continue;
        const d = Math.hypot(t.x - camera.position.x, t.z - camera.position.z);
        if (d < 36) { t._pd = d; cands.push(t); }
    }
    cands.sort((a, b) => a._pd - b._pd);
    const n = Math.min(cands.length, 14);
    while (plates.length < 14) { const e = document.createElement("div"); e.className = "np"; $("labels").appendChild(e); plates.push(e); }
    for (let i = 0; i < plates.length; i++) {
        const e = plates[i];
        if (i >= n) { e.style.display = "none"; continue; }
        const t = cands[i];
        plateV.set(t.x, Math.min(t.h * 1.3, 9.5) + 1.5, t.z).project(camera);
        if (plateV.z > 1 || Math.abs(plateV.x) > 1.1 || plateV.y < -1.1) { e.style.display = "none"; continue; }
        const px = (plateV.x * 0.5 + 0.5) * innerWidth, py = Math.max((-plateV.y * 0.5 + 0.5) * innerHeight, 30), nowMs = performance.now();
        if (!(nowMs - (t._occT || 0) < 120)) { t._occT = nowMs; t._occ = isOccluded(V3(t.x, Math.min(t.h * 1.3, 9.5) + 1.5, t.z), t.solid); }
        if (t._occ || behindAxe(px, py)) { e.style.display = "none"; continue; }
        const T = t.type, dmg = treeDmg(t);
        const html = '<b style="color:' + T.col + '">' + T.name + '</b><span>' + (dmg ? '⚔ ' + dmg + ' dmg' : '⚔ harmless') + ' · 🪵 ' + treeLogs(t) + (T.bonus ? ' <em>+$' + T.bonus + '/log</em>' : '') + '</span>';
        if (e.dataset.h !== html) { e.innerHTML = html; e.dataset.h = html; e.style.borderColor = T.col; }
        e.style.display = "";
        e.style.left = px + "px";
        e.style.top = py + "px";
        const blur = clamp((t._pd - 16) / 16, 0, 1) * 2.8;
        e.style.filter = blur > 0.15 ? "blur(" + blur.toFixed(1) + "px)" : "";
        e.style.opacity = 1 - clamp((t._pd - 28) / 8, 0, 1);
        e.style.transform = "translate(-50%, -100%) scale(" + (T.rare ? 1.12 : 1) + ")";
    }
}

// ---------- map ----------
function drawMap() {
    const cv = $("mapc"), g = cv.getContext("2d"), S = cv.width, c = S / 2, sc = (S / 2 - 14) / 112;
    g.clearRect(0, 0, S, S);
    g.fillStyle = "#0b2236";
    g.beginPath(); g.arc(c, c, c - 6, 0, 7); g.fill();
    g.strokeStyle = "rgba(255,208,64,.4)"; g.lineWidth = 3; g.stroke();
    g.beginPath();
    for (let i = 0; i <= 120; i++) { const th = (i / 120) * Math.PI * 2, r = shoreR(th) * sc; const px = c + Math.cos(th) * r, py = c + Math.sin(th) * r; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.closePath(); g.fillStyle = "#17261b"; g.fill(); g.strokeStyle = "#d8c078"; g.lineWidth = 4; g.stroke();
    g.fillStyle = "rgba(255,170,60,.1)";
    g.beginPath(); g.arc(c, c, SAFE_R * sc, 0, 7); g.fill();
    g.setLineDash([6, 6]); g.strokeStyle = "rgba(255,200,90,.7)"; g.lineWidth = 2;
    g.beginPath(); g.arc(c, c, SAFE_R * sc, 0, 7); g.stroke(); g.setLineDash([]);
    const X = x => c + x * sc, Z = z => c + z * sc;
    for (const lm of LANDMARKS) {
        g.fillStyle = lm.col + "33"; g.strokeStyle = lm.col; g.lineWidth = 1.5;
        g.beginPath(); g.arc(X(lm.x), Z(lm.z), lm.r * sc * 0.7, 0, 7); g.fill(); g.stroke();
        g.font = "bold 11px Consolas"; g.fillStyle = lm.col; g.textAlign = "center";
        g.fillText(lm.name, X(lm.x), Z(lm.z) - lm.r * sc * 0.7 - 4);
    }
    g.fillStyle = "#c58a4e"; g.fillRect(X(-4), Z(-3), 8 * sc, 6 * sc);
    g.fillStyle = "#6a50a0"; g.fillRect(X(-16), Z(-17), 10 * sc, 8 * sc);
    g.strokeStyle = "rgba(220,200,160,.7)"; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i <= 12; i++) { const p = pathCurve.getPointAt(i / 12); i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z)); }
    g.stroke();
    g.fillStyle = "#6a2a2a"; g.fillRect(X(MILL.x - 2.2), Z(MILL.z - 2.5), 4.4 * sc, 5 * sc);
    g.strokeStyle = "#7fd8ff"; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i <= 12; i++) { const p = tubeCurve.getPointAt(i / 12); i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z)); }
    g.stroke();
    g.fillStyle = "#7fd8ff"; g.beginPath(); g.arc(X(HOPPER.x), Z(HOPPER.z), 5, 0, 7); g.fill();
    { const de = dockPt(DOCK_LEN); g.strokeStyle = "#9fe8ff"; g.lineWidth = 4; g.beginPath(); g.moveTo(X(FB.x), Z(FB.z)); g.lineTo(X(de.x), Z(de.z)); g.stroke(); g.fillStyle = "#9fe8ff"; g.font = "bold 12px Consolas"; g.textAlign = "center"; g.fillText("FERRY", X(de.x), Z(de.z) + 16); }
    for (const ch of chests) if (!ch.opened) { g.fillStyle = ch.special ? "#c8a0ff" : "#ffd040"; g.fillRect(X(ch.x) - 4, Z(ch.z) - 4, 8, 8); g.strokeStyle = "#000"; g.lineWidth = 1; g.strokeRect(X(ch.x) - 4, Z(ch.z) - 4, 8, 8); }
    for (const t of trees) {
        if (t.gone || t.dying) continue;
        const near = Math.hypot(t.x - player.pos.x, t.z - player.pos.z) < 14;
        g.fillStyle = near ? "#ff4a3a" : t.type.rare ? t.type.col : "#3f8a62";
        g.beginPath(); g.arc(X(t.x), Z(t.z), (t.type.rare ? 2.5 : 1.5) + t.h * 0.3, 0, 7); g.fill();
    }
    g.font = "bold 12px Consolas"; g.fillStyle = "#ffd040"; g.textAlign = "center";
    g.fillText("SAFEHOUSE", X(0), Z(6.2)); g.fillText("SHOP", X(-11), Z(-18.4)); g.fillText("MILL", X(MILL.x), Z(MILL.z - 3.5)); g.fillText("CHUTE", X(HOPPER.x - 1), Z(HOPPER.z - 1.4));
    g.fillText("N", c, 22);
    g.save();
    g.translate(X(player.pos.x), Z(player.pos.z));
    g.rotate(-player.yaw);
    g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
}

// ---------- menus (title / pause) ----------
const CONTROLS = [["WASD", "Move"], ["Mouse", "Look"], ["Click", "Swing axe"], ["Shift", "Sprint"], ["Space", "Jump"], ["Q", "Dash"],
    ["E", "Inventory"], ["M", "Map"], ["F", "Interact"], ["1-9", "Equip axe"], ["H", "Bandage"], ["L", "Lantern"]];
function renderMenu() {
    if ($("ver")) $("ver").textContent = "TREE CHOP STUDIOS · v" + VERSION;
    const menu = $("menu");
    menu.classList.toggle("show", state === "title" || state === "paused");
    menu.dataset.mode = state;
    if (state === "title") {
        $("menuHead").innerHTML = `<div class="logo"><span>HYPERGAMOUS</span>TREE CHOPPING<br>SIMULATOR <em>4</em></div><div class="tag">the trees are alive. don't look away.</div>`;
        $("menuStats").innerHTML = save.seconds > 5
            ? `<div><span>Day</span><b>${save.day}</b></div><div><span>Cash</span><b>${money(save.money)}</b></div><div><span>Felled</span><b>${save.felled}</b></div><div><span>Deaths</span><b>${save.deaths}</b></div>`
            : `<div class="hint">Chop trees, carry logs home, send them down the chute. At night, rarer trees come out.</div>`;
        $("menuBtn").textContent = save.seconds > 5 ? "CONTINUE" : "PLAY";
        $("menuQuit").style.display = "none";
    } else if (state === "paused") {
        $("menuHead").innerHTML = `<div class="logo small">PAUSED</div><div class="tag">the trees are waiting.</div>`;
        $("menuStats").innerHTML = `<div><span>Day</span><b>${save.day}</b></div><div><span>Logs</span><b>${save.logs}</b></div><div><span>Cash</span><b>${money(save.money)}</b></div><div><span>Felled</span><b>${save.felled}</b></div><div><span>Deaths</span><b>${save.deaths}</b></div><div><span>Time</span><b>${fmtTime(save.seconds)}</b></div>`;
        $("menuBtn").textContent = "RESUME";
        $("menuQuit").style.display = "";
    }
    $("menuControls").innerHTML = CONTROLS.map(c => `<div><kbd>${c[0]}</kbd><span>${c[1]}</span></div>`).join("");
}
function startPlaying() {
    if (!actx) { try { actx = new AudioContext(); } catch (e) { /* no audio */ } }
    if (actx && actx.state === "suspended") actx.resume();
    startAmbience();
    if (state === "title") player.pos.set(0, 1.7, -0.5);
    state = "playing";
    renderMenu();
    if (document.pointerLockElement !== canvas) { try { canvas.requestPointerLock(); } catch (e) { /* needs gesture */ } }
}
$("menuBtn").addEventListener("click", startPlaying);
$("menuQuit").addEventListener("click", () => { writeSave(); window.close(); });
$("death").addEventListener("mousedown", respawn);
document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === canvas;
    if (!locked && state === "playing" && !panel) { showPanels(); state = "paused"; mouseDown = false; renderMenu(); }
});

// ---------- input ----------
addEventListener("keydown", e => {
    if ($("intro")) return; // studio intro is playing
    keys[e.code] = true;
    if (state === "dead" && (e.code === "Space" || e.code === "KeyR" || e.code === "Enter")) { respawn(); return; }
    if ((state === "title" || state === "paused") && (e.code === "Enter" || e.code === "Space")) { startPlaying(); return; }
    if (state !== "playing") return;
    if (panel === "talk") { if (e.code === "KeyF" || e.code === "Space" || e.code === "Enter") advanceTalk(); else if (e.code === "Escape") closePanel(); return; }
    if (e.code === "Escape") { if (panel) closePanel(); return; }
    if (e.code === "Tab") { e.preventDefault(); if (panel === "shop") { shopTab = shopTab === "axes" ? "gear" : "axes"; renderShop(); } return; }
    if (e.code === "KeyE") { togglePanel("inv"); return; }
    if (e.code === "KeyM") { togglePanel("map"); return; }
    if (e.code === "KeyF") { interact(); return; }
    if (panel === "shop" && /^Digit[1-9]$/.test(e.code)) { buy(+e.code.slice(5) - 1); return; }
    if (/^Digit[1-9]$/.test(e.code)) { const l = ownedList(), i = l[+e.code.slice(5) - 1]; if (i !== undefined) equipAxe(i); return; }
    if (e.code === "KeyH") useBandage();
    if (e.code === "KeyL") toggleLantern();
    if (e.code === "KeyQ" && player.dashCd <= 0 && !panel) {
        const d = new THREE.Vector3((keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), 0, (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0));
        if (d.lengthSq() === 0) d.set(0, 0, -1);
        d.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
        player.vel.x += d.x * 20; player.vel.z += d.z * 20;
        player.dashCd = 1; fovKick = 1.5;
        sfx(200, 0.2, "sawtooth", 0.06, 3);
    }
});
addEventListener("keyup", e => (keys[e.code] = false));
addEventListener("mousedown", e => {
    if ($("intro")) return;
    if (e.button !== 0 || state !== "playing") return;
    if (!locked && !panel) { try { canvas.requestPointerLock(); } catch (er) { /* ignore */ } return; }
    if (locked) mouseDown = true;
});
addEventListener("mouseup", e => { if (e.button === 0) mouseDown = false; });
addEventListener("mousemove", e => {
    if (state !== "playing" || !locked || panel === "inv" || panel === "map") return;
    player.yaw -= e.movementX * 0.0022;
    player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.45, 1.45);
});

function nearest() {
    const px = player.pos.x, pz = player.pos.z;
    if (Math.hypot(px - SHOP.x, pz - (KEEPER.z + 1.6)) < 3.6) return { k: "shop" };
    if (Math.hypot(px - BED.x, pz - BED.z) < 2.8) return { k: "bed" };
    if (Math.hypot(px - HOPPER.x, pz - HOPPER.z) < 3.6) return { k: "chute" };
    if (Math.hypot(px - FERRYMAN.x, pz - FERRYMAN.z) < 3.4) return { k: "ferry" };
    for (const c of chests) if (!c.opened && Math.hypot(px - c.x, pz - c.z) < 2.6) return { k: "chest", c };
    if (altar && Math.hypot(px - altar.x, pz - altar.z) < 3.2) return { k: "altar" };
    return null;
}
function interact() {
    if (panel === "talk") { advanceTalk(); return; }
    if (panel === "shop") { closePanel(); return; }
    if (panel) return;
    const n = nearest();
    if (!n) return;
    if (n.k === "shop") {
        const lines = ["Hehehe... welcome, woodcutter.", "Everything has a price. Even your axe.", "The trees talk about you, you know.", "Spend it. You cannot take it with you.", "Smile! It suits you.", "Night is when the good ones grow."];
        $("shopSay").textContent = "“" + lines[Math.floor(Math.random() * lines.length)] + "”";
        openPanel("shop");
    } else if (n.k === "bed") {
        if (!isNight()) { toast("You can't sleep in the daylight. Come back at night.", "bad"); return; }
        player.hp = player.maxHp;
        flash = 0.8;
        sfx(300, 0.6, "triangle", 0.1, 0.5);
        clockT = (6 / 24) * DAY_LEN;
        toast("You sleep until dawn. Health restored.", "good");
        writeSave();
    } else if (n.k === "chute") {
        if (!sendLogs()) toast("You're not carrying any logs.", "bad");
    } else if (n.k === "ferry") {
        const first = !save.ferryTalks;
        save.ferryTalks = (save.ferryTalks || 0) + 1;
        startTalk("THE FERRYMAN", first ? FERRY_FIRST : FERRY_AGAIN[Math.floor(Math.random() * FERRY_AGAIN.length)]);
    } else if (n.k === "chest") openChest(n.c);
    else if (n.k === "altar") {
        if (save.altarDay === save.day) toast("The altar is quiet. Come back tomorrow.");
        else { save.altarDay = save.day; player.hp = player.maxHp; save.bandages++; flash = 0.6; sfx(600, 0.5, "sine", 0.1, 1.6); toast("The altar blesses you: full health and a bandage.", "good"); }
    }
}

// ---------- update ----------
const UP = new THREE.Vector3(0, 1, 0);
function pushOutBoxes(p, rad) {
    for (const [x0, x1, z0, z1] of colliders) {
        const cx = clamp(p.x, x0, x1), cz = clamp(p.z, z0, z1);
        const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
        if (d < rad) {
            if (d > 0.0001) { p.x = cx + dx / d * rad; p.z = cz + dz / d * rad; }
            else {
                const l = p.x - x0, r = x1 - p.x, u = p.z - z0, dn = z1 - p.z, m = Math.min(l, r, u, dn);
                if (m === l) p.x = x0 - rad; else if (m === r) p.x = x1 + rad; else if (m === u) p.z = z0 - rad; else p.z = z1 + rad;
            }
        }
    }
    for (const c of circles) {
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + rad;
        if (d < min && d > 0.0001) { p.x = c.x + dx / d * min; p.z = c.z + dz / d * min; }
    }
}
function faceMode(t, dist) {
    if (t.hurt > 0.25 || t.atk === "strike") return "scream";
    if (t.atk === "wind" || (dist < 15 && !t.type.flee)) return "angry";
    return "calm";
}
const treeV = new THREE.Vector3();
function updateTrees(dt, safe, lookX, lookZ) {
    const cands = [];
    for (const t of trees) {
        if (t.gone || t.dying || t.burn) continue;
        const dx = player.pos.x - t.x, dz = player.pos.z - t.z, dist = Math.hypot(dx, dz) || 1;
        t._d = dist; t._nx = dx / dist; t._nz = dz / dist;
        t._seen = dist < 50 && (-t._nx * lookX - t._nz * lookZ) > 0.55;
        if (!t.type.flee && !safe && !t._seen && dist < ACTIVATE && dist > t.r + 2.1 && t.atk === "idle") cands.push(t);
    }
    cands.sort((a, b) => a._d - b._d);
    const movers = new Set(cands.slice(0, 3)); // at most three trees stalk you at once, so they never swarm

    for (const t of trees) {
        if (t.gone) continue;
        if (t.burn) {
            t.t += dt / 1.4;
            t.g.scale.setScalar(Math.max(0.01, 1 - t.t));
            if (Math.random() < dt * 14) burst(V3(t.x, 0.5 + Math.random() * t.h, t.z), 1, 2, [chipMats[1], new THREE.MeshBasicMaterial({ color: 0xff7a2a })]);
            if (t.t >= 1) { scene.remove(t.g); t.gone = true; }
            continue;
        }
        if (t.dying) {
            t.t += dt / 0.9;
            t.body.rotation.x = -Math.min(1, t.t * t.t) * Math.PI / 2;
            if (t.t >= 1) {
                const bx = -Math.sin(t.g.rotation.y), bz = -Math.cos(t.g.rotation.y);
                dropLogs(t.x, t.z, treeLogs(t), { x: bx, z: bz }, t.key);
                burst(V3(t.x + bx * t.h * 0.5, 0.3, t.z + bz * t.h * 0.5), 18, 5);
                sfx(70, 0.35, "square", 0.2, 0.3);
                shake = Math.min(0.6, shake + 0.2);
                scene.remove(t.g);
                t.gone = true;
            }
            continue;
        }
        const dist = t._d, seen = t._seen;
        if (dist < ACTIVATE * 1.6) t.g.rotation.y += angDiff(Math.atan2(player.pos.x - t.x, player.pos.z - t.z), t.g.rotation.y) * Math.min(1, 4 * dt);

        let mx = 0, mz = 0, sp = 0;
        if (t.type.flee) {
            if (dist < 14) { mx = -t._nx; mz = -t._nz; sp = 3.6; }
        } else if (movers.has(t)) { mx = t._nx; mz = t._nz; sp = 1.9 * t.type.speed; }
        if (sp > 0) {
            t.x += mx * sp * dt; t.z += mz * sp * dt;
            const od = Math.hypot(t.x, t.z);
            if (od < SAFE_R + t.r + 0.5) { t.x = t.x / od * (SAFE_R + t.r + 0.5); t.z = t.z / od * (SAFE_R + t.r + 0.5); }
            const tl = shoreAt(t.x, t.z) - 8; if (od > tl) { t.x *= tl / od; t.z *= tl / od; }
            for (const c of circles) { const cx = t.x - c.x, cz = t.z - c.z, cd = Math.hypot(cx, cz), min = c.r + t.r; if (cd < min && cd > 0.001) { t.x = c.x + cx / cd * min; t.z = c.z + cz / cd * min; } }
        } else {
            const od = Math.hypot(t.x, t.z);
            if (od < SAFE_R + t.r) { t.x += t.x / (od || 1) * 6 * dt; t.z += t.z / (od || 1) * 6 * dt; }
        }
        const pd = Math.hypot(player.pos.x - t.x, player.pos.z - t.z), pmin = t.r + 0.45;
        if (pd < pmin) { const ux = (player.pos.x - t.x) / (pd || 1), uz = (player.pos.z - t.z) / (pd || 1); player.pos.x = t.x + ux * pmin; player.pos.z = t.z + uz * pmin; }

        // attacks: only sometimes, with a warning wind-up
        t.cool -= dt;
        const reach = t.r + 2.7;
        if (!t.type.flee) {
            if (t.atk === "idle" && !safe && dist < reach && t.cool <= 0) {
                if (Math.random() < 0.4) { t.atk = "wind"; t.atkT = 0; sfx(180, 0.3, "sawtooth", 0.05, 0.5); floatWorld(V3(t.x, Math.min(t.h * 0.7, 3.4), t.z), "!", "warn"); }
                else t.cool = 1 + Math.random() * 2.5; // it hesitates
            } else if (t.atk === "wind") {
                t.atkT += dt;
                if (t.atkT >= 0.7) {
                    t.atk = "strike"; t.atkT = 0;
                    if (dist < reach + 0.6 && !safe) hurtPlayer(treeDmg(t), t.x, t.z);
                }
            } else if (t.atk === "strike") {
                t.atkT += dt;
                if (t.atkT >= 0.2) { t.atk = "idle"; t.cool = 3 + Math.random() * 3.5; }
            }
        }

        // visuals
        t.hurt = Math.max(0, t.hurt - dt * 4);
        const mode = faceMode(t, dist);
        if (mode !== t.mode) { t.mode = mode; t.face.material = faceMats[mode]; }
        t.g.position.set(t.x + (Math.random() - 0.5) * t.hurt * 0.15, 0, t.z + (Math.random() - 0.5) * t.hurt * 0.15);
        t.body.rotation.z = Math.sin(time * 0.9 + t.phase) * 0.025 + (sp > 0 ? Math.sin(time * 9 + t.phase) * 0.04 : 0);
        t.body.rotation.x = t.hurt * 0.1;
        const raise = t.atk === "wind" ? 1 : (!seen && dist < 18 ? 0.55 : 0);
        t.armUp = lerp(t.armUp, raise, Math.min(1, 8 * dt));
        const swingTarget = t.atk === "strike" ? -1.5 : t.atk === "wind" ? 0.5 : 0;
        t.swing = lerp(t.swing, swingTarget, Math.min(1, (t.atk === "strike" ? 40 : 10) * dt));
        for (const a of t.arms) {
            a.arm.rotation.z = -a.s * (2.4 - t.armUp * 1.15) + Math.sin(time * 1.3 + t.phase + a.s) * 0.06;
            a.pivot.rotation.x = t.swing;
        }
    }
    // keep trees apart: no clumping, ever
    for (let i = 0; i < trees.length; i++) {
        const a = trees[i];
        if (a.gone || a.dying || a.burn) continue;
        for (let j = i + 1; j < trees.length; j++) {
            const b = trees[j];
            if (b.gone || b.dying || b.burn) continue;
            const ox = a.x - b.x, oz = a.z - b.z, d = Math.hypot(ox, oz), min = a.r + b.r + 2.2;
            if (d < min && d > 0.001) { const push = (min - d) * 0.5; a.x += ox / d * push; a.z += oz / d * push; b.x -= ox / d * push; b.z -= oz / d * push; }
        }
    }
    for (let i = trees.length - 1; i >= 0; i--) if (trees[i].gone) trees.splice(i, 1);
    let alive = 0;
    for (const t of trees) if (!t.dying && !t.burn) alive++;
    if (alive < 60 && Math.random() < dt * 0.7) spawnTree();
}

function updateWorldAnim(dt) {
    // shop
    if (shopAnim.runes) shopAnim.runes.rotation.y += dt * 0.4;
    if (shopAnim.orb) { shopAnim.orb.position.y = 1.58 + Math.sin(time * 1.6) * 0.06; shopAnim.orb.scale.setScalar(1 + Math.sin(time * 3) * 0.05); }
    if (shopAnim.neon) shopAnim.neon.material.opacity = 0.82 + Math.sin(time * 9) * 0.1 * (Math.sin(time * 1.3) > 0.7 ? 1 : 0.2);
    shopAnim.flames.forEach((f, i) => { f.scale.y = 0.85 + Math.sin(time * 11 + i * 2) * 0.25; });
    shopAnim.chimes.forEach((c, i) => { c.position.y = 2.6 + Math.sin(time * 1.3 + i) * 0.05; });
    for (const b of shopAnim.bubbles) {
        const k = (time * 0.5 + b.ph) % 1;
        b.m.position.set(-7.4 + b.ox * 0.7, 1.05 + k * 0.7, -11.8 + b.oz * 0.7);
        b.m.scale.setScalar(Math.sin(k * Math.PI) + 0.1);
    }
    updateReaper(dt);
    for (const f of fires) { f.flame.scale.set(1, 0.85 + Math.sin(time * 12 + f.ph) * 0.2, 1); f.core.scale.y = 0.85 + Math.sin(time * 15 + f.ph) * 0.25; }
    for (const c of chests) {
        c.openT = clamp(c.openT + (c.opened ? dt * 3 : -dt * 3), 0, 1);
        c.pivot.rotation.x = -1.3 * (1 - Math.pow(1 - c.openT, 2));
        if (c.beacon.visible) c.beacon.material.opacity = 0.16 + Math.sin(time * 3 + c.x) * 0.06;
    }
    if (altar) altar.glow.material.opacity = 0.35 + Math.sin(time * 2) * 0.15 + (save.altarDay === save.day ? -0.25 : 0);
    wisps.rotation.y += dt * 0.02;
    wisps.position.y = Math.sin(time * 0.5) * 0.4;
    if (waterMesh) waterMesh.position.y = -0.45 + Math.sin(time * 0.7) * 0.05;
    if (ferryBoat) { ferryBoat.position.y = -0.15 + Math.sin(time * 1.1) * 0.07; ferryBoat.rotation.z = Math.sin(time * 0.9) * 0.03; ferryBoat.rotation.x = Math.sin(time * 0.7) * 0.015; }
    if (farBeam) farBeam.material.opacity = 0.16 + Math.sin(time * 1.7) * 0.05;
    if (ferryman) {
        ferryman.position.y = 0.3 + Math.sin(time * 1.2) * 0.02;
        const base = Math.atan2(FDIR.x, FDIR.z) + Math.PI, near = Math.hypot(player.pos.x - FERRYMAN.x, player.pos.z - FERRYMAN.z) < 14;
        const tgt = near ? base + clamp(angDiff(Math.atan2(player.pos.x - FERRYMAN.x, player.pos.z - FERRYMAN.z), base), -0.9, 0.9) : base;
        ferryman.rotation.y += angDiff(tgt, ferryman.rotation.y) * Math.min(1, 3 * dt);
    }
}
function updateReaper(dt) {
    if (!reaper) return;
    const dx = player.pos.x - KEEPER.x, dz = player.pos.z - KEEPER.z;
    const target = Math.hypot(dx, dz) < 14 ? clamp(angDiff(Math.atan2(dx, dz), 0), -1.0, 1.0) : 0;
    reaperHead.rotation.y += (target - reaperHead.rotation.y) * Math.min(1, 3 * dt);
    reaper.position.y = Math.sin(time * 1.2) * 0.05;
    reaperOrbs.forEach((o, i) => {
        const a = time * 0.9 + i * 2.1;
        o.position.set(Math.cos(a) * 1.3, 1.9 + Math.sin(a * 1.7) * 0.35, Math.sin(a) * 1.3);
    });
}

function update(dt) {
    time += dt;
    save.seconds += dt;
    clockT += dt; if (clockT >= DAY_LEN) clockT -= DAY_LEN;
    const night = isNight();
    if (night !== wasNight) { wasNight = night; night ? onDusk() : onDawn(); }
    player.invuln -= dt;
    hurtFlash = Math.max(0, hurtFlash - dt * 1.6);

    // movement
    const dir = new THREE.Vector3((keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), 0, (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0));
    if (dir.lengthSq() > 0) dir.normalize().applyAxisAngle(UP, player.yaw);
    const maxSp = (keys.ShiftLeft ? 8.5 : 5.5) * (1 + 0.07 * save.bootLvl), accel = player.onGround ? 14 : 4;
    player.vel.x += (dir.x * maxSp - player.vel.x) * Math.min(1, accel * dt);
    player.vel.z += (dir.z * maxSp - player.vel.z) * Math.min(1, accel * dt);
    if (keys.Space && player.onGround && !panel) { player.vel.y = 7; player.onGround = false; }
    player.vel.y -= 22 * dt;
    player.pos.addScaledVector(player.vel, dt);
    if (player.pos.y <= 1.7) { player.pos.y = 1.7; player.vel.y = 0; player.onGround = true; }
    clampToIsland(player.pos);
    pushOutBoxes(player.pos, 0.45);
    player.dashCd -= dt;
    if (player.onGround) player.bob += dt * Math.hypot(player.vel.x, player.vel.z) * 1.6;
    const safe = inSafe();
    if (safe && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 2 * dt);

    // swing
    if (swing.t < 1) {
        swing.t = Math.min(1, swing.t + dt / 0.36);
        if (!swing.hit && swing.t >= 0.46) { swing.hit = true; tryHit(); }
    } else if (mouseDown && !panel) {
        swing.t = 0; swing.hit = false;
        sfx(260, 0.15, "sawtooth", 0.04, 0.5);
    }

    camera.getWorldDirection(fwd);
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    updateTrees(dt, safe, fwd.x / fl, fwd.z / fl);
    updateWorldAnim(dt);

    // particles
    for (let i = chips.length - 1; i >= 0; i--) {
        const c = chips[i];
        c.life -= dt; c.v.y -= 14 * dt;
        c.m.position.addScaledVector(c.v, dt);
        if (c.m.position.y < 0.05) { c.m.position.y = 0.05; c.v.multiplyScalar(0.4); }
        if (c.life <= 0) { scene.remove(c.m); chips.splice(i, 1); }
    }

    // log pickups
    for (let i = logs.length - 1; i >= 0; i--) {
        const l = logs[i], p = l.m.position;
        const dx = player.pos.x - p.x, dz = player.pos.z - p.z, d = Math.hypot(dx, dz);
        if (d < 5) { const pull = (5 - d) * 6 * dt; p.x += dx / (d || 1) * pull; p.z += dz / (d || 1) * pull; p.y += (1 - p.y) * 0.1; }
        l.vy -= 14 * dt; p.y += l.vy * dt;
        if (p.y < 0.2 && d >= 5) { p.y = 0.2; l.vy = 0; }
        l.m.rotation.y += dt * 2;
        if (d < 1.3) { save.logs += l.w; save.logBonus += l.bonus * l.w; pickupAcc += l.w; pickupT = 0.6; scene.remove(l.m); logs.splice(i, 1); sfx(700 + Math.random() * 200, 0.08, "triangle", 0.06, 1.5); }
    }
    if (pickupAcc > 0 && (pickupT -= dt) <= 0) { toast(`+${pickupAcc} log${pickupAcc === 1 ? "" : "s"}`, "log"); pickupAcc = 0; }

    // chute: queued logs drop into the hopper and slide down the tube
    if (sendVals.length > 0 && (sendTimer -= dt) <= 0) {
        sendTimer = 0.14;
        const m = new THREE.Mesh(logGeo, logMat);
        m.scale.setScalar(0.8);
        scene.add(m);
        sending.push({ m, t: -0.25, val: sendVals.shift() });
        sfx(220 + Math.random() * 60, 0.1, "square", 0.05, 0.6);
    }
    for (let i = sending.length - 1; i >= 0; i--) {
        const s = sending[i];
        s.t += dt / 2.6;
        if (s.t < 0) s.m.position.set(HOPPER.x, 2.5 - s.t * 4.4, HOPPER.z);
        else { const u = Math.min(1, s.t * s.t * 0.5 + s.t * 0.5); s.m.position.copy(tubeCurve.getPointAt(u)); }
        s.m.rotation.y += dt * 6;
        if (s.t >= 1) {
            scene.remove(s.m); sending.splice(i, 1);
            save.money += s.val; save.sold++; soldAcc += s.val; soldT = 0.8;
            contractProgress("sell");
            sfx(900 + Math.random() * 300, 0.1, "triangle", 0.07, 1.4);
        }
    }
    if (soldAcc > 0 && (soldT -= dt) <= 0) { toast(`Sold logs for +${money(soldAcc)}`, "cash"); soldAcc = 0; writeSave(); }

    ghostAcc += ghostIncome() * dt;
    if (ghostAcc >= 1) { const n = Math.floor(ghostAcc); save.money += n; ghostAcc -= n; }
    saveT += dt;
    if (saveT > 5) { saveT = 0; writeSave(); }

    // ambience
    if (windGain) windGain.gain.value = 0.014 + Math.sin(time * 0.35) * 0.008 + (night ? 0.008 : 0);
    if (night && (owlT -= dt) <= 0) { owl(); owlT = 18 + Math.random() * 30; }

    // camera feel
    shake = Math.max(0, shake - dt * 2.5);
    fovKick = Math.max(0, fovKick - dt * 5);
    flash = Math.max(0, flash - dt * 2);
    flashEl.style.opacity = flash * 0.5;
    hurtEl.style.opacity = hurtFlash + (player.hp < 30 && state === "playing" ? 0.25 + Math.sin(time * 6) * 0.1 : 0);
    camera.fov = 75 - fovKick * 3 + (keys.ShiftLeft && dir.lengthSq() > 0 ? 4 : 0);
    camera.updateProjectionMatrix();
    camera.position.set(
        player.pos.x + (Math.random() - 0.5) * shake * 0.2,
        player.pos.y + Math.sin(player.bob * 2) * 0.04 + (Math.random() - 0.5) * shake * 0.2,
        player.pos.z + (Math.random() - 0.5) * shake * 0.2
    );
    camera.rotation.set(player.pitch, player.yaw, 0);
    applySky();
}

// ---------- HUD ----------
const el = { hp: $("hpFill"), hpTxt: $("hpTxt"), cash: $("cash"), logs: $("logsN"), zone: $("zone"), prompt: $("prompt"), fps: $("fps"), hot: $("hotbar"), hud: $("hud"), clock: $("clock"), contract: $("contract") };
let hudT = 0, frames = 0, fpsT = 0, lastCash = -1;
const PROMPTS = {
    shop: () => "[F] Talk to the Reaper", bed: () => (isNight() ? "[F] Sleep until dawn" : "Too bright to sleep. Come back at night"),
    chute: () => (save.logs ? `[F] Send ${save.logs} logs down the chute` : "Bring logs here, then [F]"),
    ferry: () => "[F] Talk to the Ferryman",
    chest: n => (n.c.special ? "[F] Open the cursed chest" : "[F] Open chest"), altar: () => (save.altarDay === save.day ? "The altar is quiet today" : "[F] Pray at the altar")
};
function hud(dt) {
    frames++; fpsT += dt;
    if (fpsT >= 0.5) { el.fps.textContent = Math.round(frames / fpsT) + " fps"; frames = 0; fpsT = 0; }
    hudT += dt;
    if (hudT < 0.08) return;
    hudT = 0;
    const playing = state === "playing" || state === "dead";
    el.hud.style.display = playing ? "" : "none";
    if (!playing) return;
    el.hp.style.width = (player.hp / player.maxHp * 100) + "%";
    el.hp.classList.toggle("low", player.hp < 30);
    el.hpTxt.textContent = Math.ceil(player.hp) + " / " + player.maxHp;
    const c = Math.floor(save.money);
    el.cash.textContent = money(c);
    if (c !== lastCash) { if (lastCash >= 0 && c > lastCash) { el.cash.classList.remove("bump"); void el.cash.offsetWidth; el.cash.classList.add("bump"); } lastCash = c; }
    el.logs.textContent = save.logs + (sendVals.length + sending.length ? ` (+${sendVals.length + sending.length} in tube)` : "");
    el.zone.textContent = inSafe() ? "SAFE ZONE" : "THE WOODS";
    el.zone.className = inSafe() ? "safe" : "danger";
    el.clock.textContent = (isNight() ? "🌙 " : "☀ ") + fmtClock() + " · DAY " + save.day;
    const k = save.contract;
    el.contract.innerHTML = k ? `<b>CONTRACT</b> <i>${money(k.reward)}</i><br>${k.text} — ${Math.min(k.prog, k.goal)}/${k.goal}` : "";
    el.contract.style.display = k ? "" : "none";
    const n = panel ? null : nearest();
    const pr = n ? PROMPTS[n.k](n) : "";
    el.prompt.textContent = pr;
    el.prompt.classList.toggle("show", !!pr);
    const hot = ownedList().map((i, slot) => {
        const a = AXES[i], sel = save.equipped === i;
        return `<div class="slot ${sel ? "sel" : ""}" style="--c:${a.rarity}"><span class="k">${slot + 1}</span><span class="ic">🪓</span><span class="nm">${a.name}</span><span class="ct">${axeDmgFor(i)} dmg</span>${sel ? '<span class="eqtag">EQUIPPED</span>' : ""}</div>`;
    }).join("");
    if (el.hot.dataset.h !== hot) { el.hot.innerHTML = hot; el.hot.dataset.h = hot; }
    if (panel === "inv") renderInv();
    if (panel === "shop") renderShop();
    if (panel === "map") drawMap();
}
const axeDmgFor = i => { const a = AXES[i]; return Math.round(a.dmg * (a.night && isNight() ? a.night : 1)); };

// ---------- loop ----------
let last = performance.now();
function frame(now) {
    const real = Math.min(0.05, (now - last) / 1000);
    last = now;
    let dt = real;
    if (hitstop > 0) { hitstop -= real; dt *= 0.08; }
    if (state === "playing") {
        if (panel !== "inv" && panel !== "map") update(dt);
        animateAxe();
        updateBars(real);
    } else if (state === "dead") {
        deadT += real;
        hurtEl.style.opacity = 0.55;
    } else if (state === "title") {
        orbit += real * 0.12;
        time += real;
        clockT += real * 0.3;
        if (clockT >= DAY_LEN) clockT -= DAY_LEN;
        camera.position.set(Math.cos(orbit) * 15, 4.5, Math.sin(orbit) * 15 - 4);
        camera.lookAt(0, 2.2, -3);
        camera.fov = 70; camera.updateProjectionMatrix();
        updateWorldAnim(real);
        applySky();
    }
    camera.updateMatrixWorld();
    updateLabels();
    if (state === "playing" && panel !== "inv" && panel !== "map") updateNameplates(); else hidePlates();
    if (panel === "talk") updateTalk(real);
    hud(real);
    renderer.clear();
    renderer.render(scene, camera);
    if (state === "playing" || state === "paused" || state === "dead") {
        renderer.clearDepth();
        renderer.render(viewScene, viewCam);
    }
    requestAnimationFrame(frame);
}

player.maxHp = maxHpNow(); player.hp = player.maxHp;
renderMenu();
applySky();
requestAnimationFrame(frame);

// debug/test handle (used by automated checks, harmless in play)
if (DEBUG) window.__ts4 = {
    save, player, trees, camera, chests, LANDMARKS,
    get state() { return state; },
    get hour() { return hourNow(); },
    play() { state = "playing"; renderMenu(); },
    setPos(x, z, yaw = 0, pitch = 0) { player.pos.set(x, 1.7, z); player.yaw = yaw; player.pitch = pitch; },
    setClock(h) { clockT = (h / 24) * DAY_LEN; },
    swingAt(t) { swing.t = t; swing.hit = true; },
    panel(p) { panel = p; showPanels(); },
    hurt(n) { hurtPlayer(n); },
    deadTime(v) { deadT = v; },
    respawn,
    send() { return sendLogs(); },
    setState(s) { state = s; renderMenu(); },
    interact, hit: tryHit, equip: equipAxe, openPanel, closePanel, spawn: (k, x, z, h = 6) => makeTree(x, z, h, k)
};

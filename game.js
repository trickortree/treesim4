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
// raw mouse input (no Windows acceleration); falls back to a normal lock where it isn't supported
function lockPointer() {
    try { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch (e) { /* needs a click */ } }); }
    catch (e) { try { canvas.requestPointerLock(); } catch (e2) { /* needs a click */ } }
}
let lookSkip = 0;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.autoClear = false;
const SCALE = 3; // render at 1/3 res, CSS upscales with pixelated sampling

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x21143a);
scene.fog = new THREE.Fog(0x21143a, 6, 56);
const camera = new THREE.PerspectiveCamera(75, 16 / 10, 0.2, 640);
camera.rotation.order = "YXZ";
scene.add(camera);
// everything that belongs to the first island lives in one group, so a rebirth can hide it
const isle1 = new THREE.Group();
scene.add(isle1);
let curBuild = 1; // which island labels are being built for
let addTgt = null; // while set, scene.add puts new objects in this group
{ const _add = scene.add.bind(scene); scene.add = function (...o) { if (addTgt) { for (const x of o) addTgt.add(x); return this; } return _add(...o); }; }
let isle = 1; // 1 = Pine Island, 2 = the Highland Isle
let groundFn = null;
const groundY = (x, z) => (groundFn ? groundFn(x, z) : 0);
const curShoreAt = (x, z) => (isle === 2 ? shoreAt2(x, z) : shoreAt(x, z));
const curShoreR = a => (isle === 2 ? shoreR2(a) : shoreR(a));

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
const N_AXES = 11;

// ---------- save ----------
const SAVE_KEY = "ts4_save_v1";
const QS = new URLSearchParams(location.search), VERSION = QS.get("v") || "dev", DEBUG = QS.has("debug");
const save = {
    logs: 0, logBonus: 0, money: 0, owned: [1, 0, 0, 0, 0, 0, 0, 0], equipped: 0, ghosts: 0, bandages: 1, priceLvl: 0,
    hpLvl: 0, bootLvl: 0, oilLvl: 0, felled: 0, rareFelled: 0, deaths: 0, sold: 0, seconds: 0, day: 1, clock: 8,
    contract: null, chestsDay: 0, altarDay: 0, chestsOpened: 0,
    rodLvl: 0, fishBag: [], fishDex: {}, fishSold: 0, ghostCash: 0, ghostFelled: 0, bmSurvived: 0, rebirths: 0,
    isle: 1, gunOwned: [], gunEq: -1, gunAmmo: {}, vestLvl: 0, magLvl: 0, whetLvl: 0, powderLvl: 0, magnetLvl: 0, ferryTalks: 0, ferry2Talk: 0, mats: {}, hotbar: null, relic: [0, 0, 0, 0, 0, 0], caveFound: 0
};
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || localStorage.getItem("ts4_test3_save") || "{}")); } catch (e) { /* fresh save */ }
if (!Array.isArray(save.owned)) save.owned = [1, 0, 0, 0, 0, 0, 0, 0];
while (save.owned.length < N_AXES) save.owned.push(0);
if (!Array.isArray(save.fishBag)) save.fishBag = [];
if (!save.fishDex || typeof save.fishDex !== "object") save.fishDex = {};
if (!save.owned[save.equipped]) save.equipped = 0;
if (!Array.isArray(save.gunOwned)) save.gunOwned = [];
if (!save.gunAmmo || typeof save.gunAmmo !== "object") save.gunAmmo = {};
if (typeof save.gunEq !== "number" || !save.gunOwned[save.gunEq]) save.gunEq = -1;
if (!save.mats || typeof save.mats !== "object") save.mats = {};
if (!Array.isArray(save.relic) || save.relic.length !== 6) save.relic = [0, 0, 0, 0, 0, 0];
function writeSave() { save.clock = hourNow(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
// difficulty follows your best axe, so a strong axe never one-shots everything
const bestIdx = () => { let b = 0; save.owned.forEach((o, i) => { if (o) b = i; }); return b; };
const gunPow = () => { let p = 0; (save.gunOwned || []).forEach((o, i) => { if (o) p = Math.max(p, GUNS[i].pow); }); return p; };
const gunTier = () => (save.gunOwned || []).filter(Boolean).length * 2;
const bestDmg = () => Math.max(AXES[bestIdx()].dmg, gunPow());
const isleHp = () => (isle === 2 ? 2.2 : 1), isleRw = () => (isle === 2 ? 1.6 : 1), isleDm = () => (isle === 2 ? 1.5 : 1);
const hpScale = () => 1 + (bestDmg() - 1) * 0.7;
const rewardScale = () => 1 + (bestDmg() - 1) * 0.14;
const dmgScale = () => 1 + bestIdx() * 0.1;
const ghostCost = () => Math.floor(80 * Math.pow(1.65, save.ghosts));
const priceCost = () => Math.floor(120 * Math.pow(1.8, save.priceLvl));
const hpCost = () => Math.floor(120 * Math.pow(1.7, save.hpLvl));
const bootCost = () => Math.floor(150 * Math.pow(1.9, save.bootLvl));
const oilCost = () => Math.floor(90 * Math.pow(2, save.oilLvl));
const BANDAGE_COST = 25;
// rebirth: each trip on the ferry costs 3x more and gives +50% log/fish value and +10% axe damage, forever
const rebirthCost = () => Math.round(250000 * Math.pow(3, save.rebirths || 0));
const rebirthMult = () => 1 + 0.5 * (save.rebirths || 0);
const logValue = () => Math.round((4 + save.priceLvl * 2) * rebirthMult() * (isle === 2 ? 2.5 : 1));
const ghostIncome = () => 0; // ghosts now earn by really chopping trees
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
    isle1.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
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
    const gray = clamp(wx.rain * 0.8 + wx.cloud * 0.25 + wx.fog * 0.6, 0, 1), blood = isBlood() ? 1 - d : 0;
    tmpC.lerp(cGray, gray * (0.25 + 0.5 * d)).lerp(cBlood, blood * 0.7);
    if (wx.light > 0) tmpC.lerp(cLightning, wx.light * 0.6);
    scene.background.copy(tmpC);
    scene.fog.color.copy(tmpC);
    scene.fog.near = lerp(6, 16, d) * (1 - wx.fog * 0.75) * (1 - wx.rain * 0.25);
    scene.fog.far = lerp(lerp(56, 120, d), 34, wx.fog) * (1 - wx.rain * 0.25) * (1 - blood * 0.25);
    ambL.color.copy(cNightAmb).lerp(cDayAmb, d).lerp(cRed, blood * 0.45);
    ambL.intensity = lerp(1.5, 2.0, d) * (1 - 0.3 * gray) + wx.light * 3;
    sunL.color.copy(cNightSun).lerp(cDaySun, d).lerp(cDusk, dusk * 0.5).lerp(cRed, blood * 0.6);
    sunL.intensity = lerp(1.1, 2.6, d) * (1 - 0.65 * gray) * (1 + blood * 0.5);
    const a = ((hourNow() - 6) / 24) * Math.PI * 2;
    const dir = V3(Math.cos(a), Math.sin(a), -0.35).normalize();
    const lightDir = el >= 0 ? dir : dir.clone().negate();
    sunL.position.copy(lightDir).multiplyScalar(100);
    sunMesh.position.copy(camera.position).addScaledVector(dir, 330);
    moonMesh.position.copy(camera.position).addScaledVector(dir, -330);
    sunMesh.visible = el > -0.12;
    moonMesh.visible = el < 0.12;
    moonMesh.material.color.setHex(isBlood() ? 0xff3030 : 0xe8e4ff);
    moonMesh.scale.setScalar(isBlood() ? 1.35 : 1);
    sunMesh.visible = sunMesh.visible && wx.cloud < 0.85;
    starMat.color.setHex(isBlood() ? 0xffb0b0 : 0xffffff);
    starMat.opacity = clamp(1 - d * 1.6, 0, 1) * (1 - clamp(wx.cloud * 0.6 + wx.rain, 0, 1));
    wisps.material.opacity = (1 - d) * 0.9;
    wisps.visible = d < 0.9;
    cloudMat.color.copy(cNightAmb).lerp(cWhite, d).lerp(cGray, gray * 0.7).lerp(cRed, blood * 0.4);
    cloudMat.opacity = 0.25 + 0.7 * wx.cloud * (0.4 + 0.6 * d);
    viewAmb.intensity = lerp(1.1, 1.6, d);
    lantern.intensity = (lerp(26, 8, d) + save.oilLvl * 6) * (player && player.lantern ? 1 : 0);
    lantern.distance = 24 + save.oilLvl * 6;
    if (inCave()) caveSky();
}

addTgt = isle1;
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
    const l = { el, position: new THREE.Vector3(), visible: true, material: { opacity: 1 }, maxD: 95, blurK: 1, isle: curBuild };
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
        if (!l.visible || l.isle !== isle) { l.el.style.display = "none"; continue; }
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
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex("REBIRTH FERRY", "FROM $250,000", "#ffe080"), side: THREE.DoubleSide }));
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

    // far shore: the Highland Isle on the horizon, a snowy mountain with the Golden Tree on its peak
    const FI = dockPt(DOCK_LEN + 240, 0, 0);
    const farM = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true, fog: false });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(80, 96, 6, 14), farM(0x5e7254)); base.position.set(FI.x, -2.6, FI.z);
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(97, 101, 1.2, 14), farM(0xb8a878)); sand.position.set(FI.x, -1.0, FI.z);
    const mtn = new THREE.Mesh(new THREE.ConeGeometry(58, 64, 9), farM(0x56646c)); mtn.position.set(FI.x, 31, FI.z);
    const snow = new THREE.Mesh(new THREE.ConeGeometry(21, 22.5, 9), farM(0xeef2fa)); snow.position.set(FI.x, 51.9, FI.z);
    scene.add(base, sand, mtn, snow);
    for (const [ox, oz, r, hh] of [[-46, 30, 34, 30], [40, 36, 30, 24], [30, -44, 26, 20]]) { const p = FPERP.clone().multiplyScalar(ox).addScaledVector(FDIR, oz); const m = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 8), farM(0x627566)); m.position.set(FI.x + p.x, hh / 2 - 1, FI.z + p.z); scene.add(m); }
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 12, 8), farM(0x8a6a2a)); trunk.position.set(FI.x, 68, FI.z); scene.add(trunk);
    const canopyM = new THREE.MeshBasicMaterial({ color: 0xffd860, fog: false });
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(10 - i * 2.5, 8, 8), canopyM); c.position.set(FI.x, 76 + i * 4.2, FI.z); scene.add(c); }
    farBeam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 260, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.2, fog: false, depthWrite: false, side: THREE.DoubleSide }));
    farBeam.position.set(FI.x, 150, FI.z);
    scene.add(farBeam);
    const bl = label("THE HIGHLAND ISLE", "#ffe080", 5.6, 1.3); bl.position.set(FI.x, 128, FI.z); bl.maxD = 520; bl.blurK = 0.25;
    const bl2 = label("A NEW LIFE AWAITS", "#ffffff", 4.6, 1.0); bl2.position.set(FI.x, 112, FI.z); bl2.maxD = 520; bl2.blurK = 0.25;
    farGlow = canopyM;
}
function clampToIsland(p) {
    if (isle === 2) { clampIsle2(p); return; }
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
    "See that golden glow, far across the water? That is the Highland Isle.",
    "One ticket, one trip, one whole new life. Everything you've earned stays behind... but over there: mountains, strange trees, and guns.",
    "The first ticket costs $250,000. The second costs three times that. Then three times again.",
    "Come back when your pockets are heavy."
];
const FERRY_QUIPS = [
    "The water is patient, and so am I.",
    "Heavy pockets, light heart. That's how the best trips start.",
    "Every trip across, the island gives a little more back.",
    "I've ferried kings, and thieves, and one very rude goat.",
    "Take your time. The ferry always waits."
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

addTgt = null;
// ---------- the living trees (rarer ones come out at night) ----------
const TYPES = {
    pine:  { name: "Pine Tree",   leaf: [0x264a3a, 0x2f2c52, 0x3d2650], trunk: 0x4a3024, hp: 1,   logs: 1,   dmg: 1,    speed: 1,    bonus: 0,  wd: 1,    wn: 0.55, col: "#3f8a62" },
    elder: { name: "Elder Tree",  leaf: [0x4a2a6a],                     trunk: 0x33233a, hp: 1.7, logs: 1.6, dmg: 1.25, speed: 1,    bonus: 2,  wd: 0.1,  wn: 0.32, col: "#a070ff", glow: 0x1a0a30, rare: true },
    ghost: { name: "Ghost Tree",  leaf: [0x9fe8ff],                     trunk: 0x7aa0b0, hp: 2.3, logs: 2,   dmg: 1.1,  speed: 1.35, bonus: 6,  wd: 0,    wn: 0.2,  col: "#8ff0ff", glow: 0x2a5a6a, rare: true, night: true, ghost: true },
    blood: { name: "Blood Tree",  leaf: [0x8a1010],                     trunk: 0x3a0a0a, hp: 3,   logs: 2.5, dmg: 1.7,  speed: 1.15, bonus: 10, wd: 0,    wn: 0.12, col: "#ff3a3a", glow: 0x3a0000, rare: true, night: true, isl: [1, 2], mat: "magma" },
    ironwood: { name: "Ironwood",     leaf: [0x56687a],           trunk: 0x34343e, hp: 2.0, logs: 1.5, dmg: 1.2, speed: 1,    bonus: 3,  wd: 0.3,  wn: 0.22, col: "#a9bcd4", glow: 0x10161c, minTier: 2 },
    frostbark: { name: "Frostbark",    leaf: [0x9fe0ff],           trunk: 0x5a7a9a, hp: 2.6, logs: 2,   dmg: 1.3, speed: 1,    bonus: 8,  wd: 0.22, wn: 0.16, col: "#8fe0ff", glow: 0x0a3a5a, minTier: 3 },
    emberwood: { name: "Emberwood",    leaf: [0xff6a1a],           trunk: 0x3a1a0a, hp: 3.4, logs: 2.5, dmg: 1.6, speed: 1.1,  bonus: 14, wd: 0.2,  wn: 0.22, col: "#ff9a3a", glow: 0x6a2000, minTier: 5 },
    titan: { name: "Titan Tree",       leaf: [0x1f4a34, 0x2a3a5a], trunk: 0x4a3a2a, hp: 6,   logs: 5,   dmg: 2,   speed: 0.7,  bonus: 25, wd: 0.07, wn: 0.1,  col: "#ffd8a0", minTier: 6, titan: true },
    gold:  { name: "Golden Tree", leaf: [0xffd040],                     trunk: 0x9a7a20, hp: 2,   logs: 3,   dmg: 0,    speed: 1,    bonus: 25, wd: 0.03, wn: 0.03, col: "#ffd040", glow: 0x6a4a00, rare: true, flee: true, isl: [1, 2], mat: "gold" },
    // ---- the Highland Isle ----
    larch:    { name: "Highland Larch", leaf: [0x6a8a3a, 0x8a9a3a, 0x4a7a42], trunk: 0x5a4030, hp: 1.3, logs: 1.6, dmg: 1.1, speed: 1,    bonus: 4,  wd: 0.8,  wn: 0.4,  col: "#a0d060", isl: [2], round: true, mat: "wood" },
    stonebark:  { name: "Stonebark",   leaf: [0x7a7a84, 0x6a6a72], trunk: 0x5a5a62, hp: 1.6, logs: 1.4, dmg: 1.15, speed: 0.9, bonus: 5,  wd: 0.6,  wn: 0.35, col: "#c8c8d4", isl: [2], round: true, mat: "stone" },
    copperleaf: { name: "Copperleaf",  leaf: [0xd0763a, 0xe0904a], trunk: 0x5a3a22, hp: 1.5, logs: 1.2, dmg: 1.1, speed: 1,    bonus: 6,  wd: 0.45, wn: 0.3,  col: "#ff9a5a", isl: [2], mat: "copper" },
    ironbark:   { name: "Ironbark",    leaf: [0x4a5a6a, 0x56687a], trunk: 0x34343e, hp: 2.0, logs: 1.1, dmg: 1.2, speed: 1,    bonus: 8,  wd: 0.45, wn: 0.3,  col: "#a9c0dc", glow: 0x10161c, isl: [2], minTier: 1, mat: "iron" },
    powderwood: { name: "Powderwood",  leaf: [0x2a2228, 0x3a2a2a], trunk: 0x1a1418, hp: 2.2, logs: 1.1, dmg: 1.3, speed: 1.05, bonus: 9,  wd: 0.35, wn: 0.35, col: "#ff6a6a", glow: 0x400a0a, isl: [2], minTier: 2, mat: "gunpowder" },
    goldleaf:   { name: "Goldleaf",    leaf: [0xffd040, 0xffe070], trunk: 0x7a5a20, hp: 2.6, logs: 0.6, dmg: 1.2, speed: 1,    bonus: 20, wd: 0.16, wn: 0.16, col: "#ffd040", glow: 0x5a4000, isl: [2], minTier: 3, round: true, mat: "gold" },
    redwood:  { name: "Redwood",        leaf: [0x2a5a32],                     trunk: 0x7a3a22, hp: 2.4, logs: 2.2, dmg: 1.35, speed: 0.9, bonus: 10, wd: 0.35, wn: 0.25, col: "#e08a5a", isl: [2], minTier: 2, tall: true, alt: [0, 26], mat: "wood" },
    snowpine: { name: "Snowcap Pine",   leaf: [0xe8f4ff, 0xcfe4f4],           trunk: 0x4a4a52, hp: 2.8, logs: 2.4, dmg: 1.4, speed: 1,    bonus: 14, wd: 0.5,  wn: 0.35, col: "#d8f0ff", glow: 0x203040, isl: [2], minTier: 3, alt: [15, 70], mat: "iron" },
    crystal:  { name: "Crystal Tree",   leaf: [0x7affef, 0xff7ad8],           trunk: 0x3a4a6a, hp: 3.4, logs: 3,   dmg: 1.5, speed: 1.25, bonus: 30, wd: 0.05, wn: 0.4,  col: "#7affef", glow: 0x1a6a6a, isl: [2], rare: true, night: true, minTier: 4, mat: "crystal" },
    magma:    { name: "Magma Oak",      leaf: [0xff5a1a, 0xd03a10],           trunk: 0x2a1a14, hp: 4.5, logs: 3.4, dmg: 1.9, speed: 1.1, bonus: 45, wd: 0.14, wn: 0.14, col: "#ff7a3a", glow: 0x7a2000, isl: [2], minTier: 5, alt: [6, 70], mat: "magma" },
    colossus: { name: "Colossus Tree",  leaf: [0x1f5a3a, 0x2a4a6a],           trunk: 0x5a4a38, hp: 9,   logs: 8,   dmg: 2.6, speed: 0.6,  bonus: 80, wd: 0.05, wn: 0.05, col: "#ffe0a0", isl: [2], minTier: 8, titan: true, mat: "gold" }
};
const typeMats = {};
for (const [k, T] of Object.entries(TYPES)) {
    const base = { flatShading: true };
    if (T.glow !== undefined) base.emissive = T.glow;
    if (T.ghost) { base.transparent = true; base.opacity = 0.72; base.depthWrite = false; }
    typeMats[k] = { trunk: new THREE.MeshLambertMaterial({ color: T.trunk, ...base }), leaves: T.leaf.map(c => new THREE.MeshLambertMaterial({ color: c, ...base })) };
}
const armMat = new THREE.MeshLambertMaterial({ color: 0x2c1c16, flatShading: true });
// how each species is shaped: conifer tiers, round broadleaf canopies, tall redwoods, dead spiky blood trees, crystal shards
const TREE_STYLE = {
    pine: { s: "conifer" }, elder: { s: "round" }, ghost: { s: "conifer" }, blood: { s: "dead", dots: 0xff3030 }, ironwood: { s: "conifer" },
    frostbark: { s: "conifer", snow: true }, emberwood: { s: "round", dots: 0xffa040 }, titan: { s: "conifer" }, gold: { s: "round", dots: 0xfff4b0 },
    larch: { s: "round" }, stonebark: { s: "round", rocks: true }, copperleaf: { s: "round", dots: 0xffb070 }, ironbark: { s: "conifer" },
    powderwood: { s: "spiky", dots: 0xff3a2a }, goldleaf: { s: "round", dots: 0xfff4b0 }, redwood: { s: "tall" }, snowpine: { s: "conifer", snow: true },
    crystal: { s: "crystal", dots: 0xbffff6 }, magma: { s: "round", dots: 0xffa030 }, colossus: { s: "conifer" }
};
const snowMat = new THREE.MeshLambertMaterial({ color: 0xf2f6ff, flatShading: true }), rockMat = new THREE.MeshLambertMaterial({ color: 0x7a7a84, flatShading: true });
const dotMats = {};
const ni = g => (g.index ? g.toNonIndexed() : g);
function treeShape(key, r, h) {
    const st = TREE_STYLE[key] || { s: "conifer" }, leaf = [], deco = [], snow = [], dots = [], rocks = [];
    const R = Math.random, rot = g => { g.rotateY(R() * 6.28); return g; };
    // roots splaying out from the base
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * 6.283 + R() * 0.6, c = new THREE.ConeGeometry(r * 0.38, r * 2.0, 5);
        c.rotateZ(-(Math.PI / 2 + 0.45)); c.rotateY(-a); c.translate(Math.cos(a) * r * 0.75, r * 0.32, Math.sin(a) * r * 0.75);
        deco.push(ni(c));
    }
    const dot = (x, y, z, s = 0.13) => { const d = new THREE.IcosahedronGeometry(r * s * 2, 0); d.translate(x, y, z); dots.push(d); };
    if (st.s === "conifer" || st.s === "spiky") {
        const tiers = h > 7 ? 5 : 4, seg = st.s === "spiky" ? 4 : 8;
        for (let i = 0; i < tiers; i++) {
            const k = i / tiers, rad = r * (st.s === "spiky" ? 3.0 : 3.7) * (1 - k * 0.78), ht = h * 0.36, y = h * 0.45 + i * (h * 0.62 / tiers), jx = (R() - 0.5) * r * 0.25, jz = (R() - 0.5) * r * 0.25;
            const c = rot(new THREE.ConeGeometry(rad, ht, seg)); c.translate(jx, y, jz); leaf.push(ni(c));
            if (st.snow) { const sc = rot(new THREE.ConeGeometry(rad * 0.55, ht * 0.42, seg)); sc.translate(jx, y + ht * 0.3, jz); snow.push(ni(sc)); }
            if (st.dots) for (let d = 0; d < 3; d++) { const a = R() * 6.28, rr = rad * 0.55; dot(jx + Math.cos(a) * rr, y - ht * 0.15, jz + Math.sin(a) * rr); }
        }
    } else if (st.s === "round") {
        const blobs = [[0, h * 1.0, 0, 2.5]];
        for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283 + R() * 0.5; blobs.push([Math.cos(a) * r * 1.9, h * (0.7 + R() * 0.2), Math.sin(a) * r * 1.9, 1.8 + R() * 0.7]); }
        for (const [x, y, z, sz] of blobs) {
            const b = new THREE.IcosahedronGeometry(r * sz, 0); b.rotateY(R() * 6); b.scale(1, 0.82, 1); b.translate(x, y, z); leaf.push(b);
            if (x || z) { const br = new THREE.CylinderGeometry(r * 0.12, r * 0.22, Math.hypot(x, z) * 1.1, 5); br.translate(0, Math.hypot(x, z) * 0.55, 0); br.rotateZ(-Math.atan2(Math.hypot(x, z), y - h * 0.55) * 0.9); br.rotateY(-Math.atan2(z, x)); br.translate(0, h * 0.55, 0); deco.push(ni(br)); }
            if (st.dots) for (let d = 0; d < 2; d++) { const a = R() * 6.28, e = R() * 1.2; dot(x + Math.cos(a) * r * sz * 0.85, y + Math.sin(e) * r * sz * 0.6, z + Math.sin(a) * r * sz * 0.85); }
        }
        if (st.rocks) for (let i = 0; i < 4; i++) { const a = R() * 6.28, rk = new THREE.IcosahedronGeometry(r * (0.5 + R() * 0.5), 0); rk.translate(Math.cos(a) * r * 2.2, r * 0.3, Math.sin(a) * r * 2.2); rocks.push(rk); }
    } else if (st.s === "tall") {
        for (let i = 0; i < 5; i++) { const k = i / 5, c = rot(new THREE.ConeGeometry(r * 2.6 * (1 - k * 0.6), h * 0.2, 7)); c.translate((R() - 0.5) * r * 0.3, h * 0.6 + i * h * 0.11, (R() - 0.5) * r * 0.3); leaf.push(ni(c)); }
    } else if (st.s === "dead") {
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * 6.283 + R() * 0.4, len = h * (0.35 + R() * 0.2), c = new THREE.ConeGeometry(r * 0.55, len, 4);
            c.translate(0, len / 2, 0); c.rotateZ(-(0.5 + R() * 0.6)); c.rotateY(-a); c.translate(0, h * (0.65 + R() * 0.3), 0); leaf.push(ni(c));
            if (st.dots) dot(Math.cos(a) * len * 0.5, h * 0.9, Math.sin(a) * len * 0.5, 0.18);
        }
        const top = new THREE.ConeGeometry(r * 1.4, h * 0.5, 5); top.translate(0, h * 1.0, 0); leaf.push(ni(top));
    } else if (st.s === "crystal") {
        const mk = (x, y, z, w, l, tz, tx) => { const c = new THREE.ConeGeometry(w, l, 6); c.translate(0, l / 2, 0); c.rotateZ(tz); c.rotateX(tx); c.translate(x, y, z); leaf.push(ni(c)); };
        mk(0, h * 0.62, 0, r * 1.1, h * 0.7, 0, 0);
        for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.283; mk(Math.cos(a) * r * 0.6, h * (0.6 + R() * 0.2), Math.sin(a) * r * 0.6, r * (0.5 + R() * 0.3), h * (0.3 + R() * 0.25), Math.sin(a) * 0.7, -Math.cos(a) * 0.7); }
        for (let d = 0; d < 6; d++) dot((R() - 0.5) * r * 3, h * (0.7 + R() * 0.5), (R() - 0.5) * r * 3, 0.1);
    }
    const merge = a => (a.length ? mergeGeometries(a) : null);
    return { leaf: merge(leaf), deco: merge(deco), snow: merge(snow), dots: merge(dots), rocks: merge(rocks), dotCol: st.dots };
}


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
    const gy0 = groundY(x, z);
    g.position.set(x, gy0 - (isle === 2 ? 0.25 : 0), z);
    const body = new THREE.Group();
    g.add(body);
    // a slightly bent, knobbly trunk
    const tg = new THREE.CylinderGeometry(r * 0.6, r * 1.05, h * 1.05, 8, 4);
    { const p = tg.attributes.position, bend = (Math.random() - 0.5) * 0.1 * h, ph = Math.random() * 6;
      for (let i = 0; i < p.count; i++) { const u = p.getY(i) / (h * 1.05) + 0.5, k = 1 + 0.07 * Math.sin(u * 11 + ph + p.getX(i) * 3); p.setX(i, p.getX(i) * k + bend * u * u * u); p.setZ(i, p.getZ(i) * k); }
      tg.computeVertexNormals(); }
    const trunk = new THREE.Mesh(tg, M.trunk);
    trunk.position.y = h * 0.525;
    body.add(trunk);
    const shp = treeShape(key, r, h);
    const foliage = new THREE.Mesh(shp.leaf, M.leaves[Math.floor(Math.random() * M.leaves.length)]);
    body.add(foliage);
    if (shp.deco) body.add(new THREE.Mesh(shp.deco, M.trunk));
    if (shp.snow) body.add(new THREE.Mesh(shp.snow, snowMat));
    if (shp.rocks) body.add(new THREE.Mesh(shp.rocks, rockMat));
    if (shp.dots) body.add(new THREE.Mesh(shp.dots, dotMats[shp.dotCol] || (dotMats[shp.dotCol] = new THREE.MeshBasicMaterial({ color: shp.dotCol }))));
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
    const hp = Math.ceil(h * 0.7 * T.hp * (1 + 0.12 * (save.day - 1)) * hpScale() * isleHp());
    const t = {
        g, body, face, arms, h, r, x, z, gy: gy0, key, type: T, hp, maxHp: hp, solid: [trunk, foliage],
        dying: false, burn: false, t: 0, hurt: 0, phase: Math.random() * 6, gone: false,
        mode: "calm", atk: "idle", atkT: 0, cool: 1 + Math.random() * 3, armUp: 0, swing: 0, bar: null, barT: 0, _d: 99, _seen: false
    };
    trees.push(t);
    return t;
}

function pickType(px = 0, pz = 0) {
    const night = isNight(), here = isle === 2 ? groundY(px, pz) : 0;
    let total = 0;
    const tier = Math.max(bestIdx(), gunTier()), blood = isBlood(), tw = T => (night ? T.wn : T.wd) * (blood && T.rare ? 2.2 : 1);
    const ok = T => (T.isl || [1]).includes(isle) && (T.minTier || 0) <= tier && (!T.alt || (here >= T.alt[0] && here <= T.alt[1]));
    for (const T of Object.values(TYPES)) if (ok(T)) total += tw(T);
    let r = Math.random() * total;
    for (const [k, T] of Object.entries(TYPES)) { if (!ok(T)) continue; r -= tw(T); if (r <= 0) return k; }
    return isle === 2 ? "larch" : "pine";
}
let lastRareToast = -99;
function spawnTree(announce = true) {
    for (let tries = 0; tries < 40; tries++) {
        const a = Math.random() * Math.PI * 2, d = SAFE_R + 4 + Math.random() * (curShoreR(a) - 10 - SAFE_R - 4);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (Math.hypot(x - player.pos.x, z - player.pos.z) < 18) continue;
        let bad = false;
        for (const lm of curLM()) if (!lm.camp && Math.hypot(x - lm.x, z - lm.z) < lm.r + 2) { bad = true; break; }
        if (bad) continue;
        if (isle === 2 && Math.hypot(x - LAKE2.x, z - LAKE2.z) < LAKE2.r + 5) continue;
        for (const o of trees) if (!o.gone && Math.hypot(x - o.x, z - o.z) < 6) { bad = true; break; }
        if (bad) continue;
        const key = pickType(x, z), T = TYPES[key];
        const t = makeTree(x, z, T.titan ? 10 + Math.random() * 2 : T.tall ? 8 + Math.random() * 5 : 3 + Math.random() * 7, key);
        if (announce && (T.night || T.titan) && time - lastRareToast > 25) { lastRareToast = time; toast(T.titan ? `A ${T.name} towers somewhere in the woods...` : `A ${T.name} stirs somewhere in the woods...`, "rare"); }
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
    { name: "Reaper's Axe", dmg: 30, cost: 9000, steel: 0x10261a, edge: 0x6dffa0, glow: 0x0a6a30, scale: 1.42, rarity: "#6dffa0" },
    { name: "Glacier Axe",   dmg: 45, cost: 18000, steel: 0x6aa8d8, edge: 0xe8faff, glow: 0x2a6a9a, scale: 1.48, rarity: "#9fe8ff", isle2: true },
    { name: "Magma Axe",     dmg: 70, cost: 55000, steel: 0x3a1208, edge: 0xff6a1a, glow: 0xa03a00, scale: 1.54, rarity: "#ff7a3a", isle2: true },
    { name: "Worldsplitter", dmg: 120, cost: 160000, steel: 0x180a30, edge: 0xff5ae0, glow: 0x6a1a8a, scale: 1.62, rarity: "#ff7aea", isle2: true }
];
const axeDmg = () => { const a = AXES[save.equipped]; return Math.round(a.dmg * (a.night && isNight() ? a.night : 1) * (1 + 0.1 * (save.rebirths || 0)) * (1 + 0.1 * (save.whetLvl || 0))); };
const ownedList = () => AXES.map((a, i) => i).filter(i => save.owned[i]);
function applyAxeLook() {
    const a = AXES[save.equipped];
    steelM.color.setHex(a.steel); steelM.emissive.setHex(a.glow);
    edgeM.color.setHex(a.edge); edgeM.emissive.setHex(a.glow);
    headMesh.scale.setScalar(a.scale);
}
applyAxeLook();
if (save.isle !== 2) for (let i = 0; i < 60; i++) spawnTree(false); // (needs AXES for the difficulty scale)
const KF = {
    rest: [-0.2, 1.1, 0.08, 0.56, -0.78, -1.0],
    wind: [0.35, 0.95, 0.45, 0.46, -0.55, -1.1],
    hit: [-1.35, 0.25, -0.1, 0.3, -0.9, -1.15]
};
function mixKF(a, b, k) { return a.map((v, i) => lerp(v, b[i], k)); }
const swing = { t: 1, hit: false };
function animateAxe() {
    const hg = holdingGun();
    axe.visible = !hg; gun.visible = hg;
    if (hg && builtGun !== save.gunEq) buildGunModel(save.gunEq);
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
        const mk = isle === 2 ? (T.mat || "wood") : null;
        const m = mk ? new THREE.Mesh(matGeo, matMeshMat[mk]) : new THREE.Mesh(logGeo, logMats[key] || logMat);
        const d = Math.random() * 2.5;
        m.position.set(x + back.x * d, groundY(x + back.x * d, z + back.z * d) + 0.4, z + back.z * d);
        m.rotation.y = Math.random() * 3;
        scene.add(m);
        logs.push({ m, vy: 3 + Math.random() * 3, bonus: T.bonus, w: base + (i < extra ? 1 : 0), mat: mk });
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
const activateR = () => ACTIVATE * (isBlood() ? 1.4 : 1) * (1 - 0.3 * wx.fog);

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
    else { const g = 12 + Math.floor(Math.random() * 14); save.contract = { type: "sell", goal: g, prog: 0, reward: Math.round(g * 6 * m), text: isle === 2 ? `Sell ${g} materials at the Trading Post` : `Sell ${g} logs at the mill` }; }
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
function onDusk() {
    if (isBlood()) { toast("THE BLOOD MOON RISES. The woods are hungry... and pay double.", "bad"); sfx(80, 1.6, "sawtooth", 0.16, 0.4); bmFelled = 0; }
    else { toast("Night falls. Rare trees are stirring in the woods...", "rare"); sfx(190, 0.7, "sine", 0.07, 0.5); owl(); }
}
function onDawn() {
    const wasBlood = save.day % 3 === 0;
    save.day++;
    if (wasBlood) { const bonus = 100 + bmFelled * 25; save.money += bonus; save.bmSurvived = (save.bmSurvived || 0) + 1; toast("You survived the Blood Moon! +" + money(bonus) + " bonus.", "cash"); bmFelled = 0; }
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
    hitTree(best, axeDmg(), true);
}
const HIT_COL = { ghost: [0x9fe8ff, 0xffffff], blood: [0xaa1818, 0xff5a5a], gold: [0xffd040, 0xfff0a0], elder: [0x7a4aa0, 0xc8a0ff], ironwood: [0xa9bcd4, 0x6a7a8a], frostbark: [0x8fe0ff, 0xffffff], emberwood: [0xff9a3a, 0xffe070], titan: [0xd8a860, 0xfff0c0],
    larch: [0x8a9a3a, 0xb07a45], stonebark: [0x8a8a96, 0x5a5a62], copperleaf: [0xd0763a, 0xffb070], ironbark: [0xa9c0dc, 0x4a5a6a], powderwood: [0x2a2228, 0xff4a3a], goldleaf: [0xffd040, 0xfff0a0], redwood: [0x7a3a22, 0xd08a5a], snowpine: [0xe8f4ff, 0xffffff], crystal: [0x7affef, 0xff7ad8], magma: [0xff5a1a, 0xffd060], colossus: [0xd8a860, 0xfff0c0] };
function hitTree(best, dmg, melee) {
    best.hp -= dmg;
    best.hurt = 1;
    floatWorld(V3(best.x, best.gy + Math.min(best.h * 0.55, 3.2), best.z), "-" + dmg, "dmg");
    showBar(best);
    if (melee) { shake = Math.min(0.5, shake + 0.25); hitstop = 0.07; fovKick = 1; flash = 0.2; }
    const col = HIT_COL[best.key];
    burst(V3(best.x + (player.pos.x - best.x) * 0.1, best.gy + Math.min(best.h * 0.35, 2.2), best.z + (player.pos.z - best.z) * 0.1), melee ? 10 : 5, 4, col ? col.map(c => new THREE.MeshBasicMaterial({ color: c })) : chipMats);
    if (melee) { sfx(140, 0.14, "square", 0.18, 0.4); sfx(520 + Math.random() * 200, 0.2, "sawtooth", 0.07, 0.35); }
    else sfx(260 + Math.random() * 100, 0.07, "square", 0.06, 0.5);
    if (best.hp <= 0) fellTree(best);
}
function fellTree(t) {
    t.dying = true; t.t = 0;
    save.felled++;
    if (isBlood()) bmFelled++;
    contractProgress("fell");
    if (t.type.rare) { save.rareFelled++; contractProgress("rare"); toast(`You felled a ${t.type.name}!`, "rare"); }
    sfx(90, 0.4, "sawtooth", 0.15, 0.4);
}

function hurtPlayer(dmg, sx, sz) {
    if (player.invuln > 0 || state !== "playing") return;
    dmg = Math.max(1, Math.round(dmg * (1 - 0.1 * (save.vestLvl || 0))));
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
    endFishing();
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
    player.pos.set(RESPAWN.x, groundY(RESPAWN.x, RESPAWN.z) + 1.7, RESPAWN.z);
    player.vel.set(0, 0, 0);
    player.yaw = 0; player.pitch = 0;
    player.invuln = 3;
    state = "playing";
    $("death").classList.remove("show");
    toast("You wake up in the safehouse. The logs are gone.", "bad");
    if (document.pointerLockElement !== canvas) { try { lockPointer(); } catch (e) { /* needs a gesture */ } }
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
function startTalk(who, lines, then) {
    talk = { who, lines, i: 0, shown: 0, then };
    $("talkWho").textContent = who;
    openPanel("talk");
}
function advanceTalk() {
    const line = talk.lines[talk.i];
    if (!line) { closePanel(); return; }
    if (talk.shown < line.length) { talk.shown = line.length; return; }
    if (talk.i < talk.lines.length - 1) { talk.i++; talk.shown = 0; sfx(260, 0.08, "triangle", 0.05, 1.2); }
    else { const cb = talk.then; closePanel(); if (cb) cb(); }
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
    if (!save.owned[i]) { toast(`${AXES[i].name} is locked. ${isle === 2 ? "Craft it at the Forge." : "The Reaper sells it."}`, "bad"); return; }
    if (save.equipped === i && !holdingGun()) return;
    save.gunEq = -1; reloading = false;
    save.equipped = i;
    addToHotbar("a" + i);
    applyAxeLook();
    swing.t = 1;
    sfx(420, 0.12, "triangle", 0.1, 1.4);
    toast(`Equipped ${AXES[i].name}`);
}
function openChest(c) {
    if (c.opened) return;
    c.opened = true; c.beacon.visible = false; save.chestsOpened++;
    const m = (1 + 0.15 * (save.day - 1)) * (isBlood() ? 2 : 1), r = Math.random();
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
let shopMode = "reaper", shopPage = 0;
const PER_PAGE = 4;
const SHOP_TABS = {
    reaper: [["axes", "AXES"], ["gear", "GEAR"], ["sell", "SELL FISH"]],
    forge: [["axes", "CRAFT AXES"], ["guns", "CRAFT GUNS"], ["ammo", "AMMO"], ["gear", "GEAR"]],
    trade: [["trade", "SELL MATERIALS"]]
};
const SHOP_NAMES = { reaper: "THE REAPER'S SHOP", forge: "THE FORGE", trade: "TRADING POST" };
function reaperAxeItems() {
    const out = [];
    AXES.forEach((a, i) => {
        if (i === 0 || a.isle2) return;
        out.push({ name: a.name, icon: "a" + i, desc: `${a.dmg} damage per swing${a.night ? " (x1.5 at night)" : ""}`, cost: a.cost, owned: !!save.owned[i], axe: i, col: a.rarity, buy() { gainAxe(i); } });
    });
    return out;
}
function gainAxe(i) {
    const old = hpScale();
    save.owned[i] = 1;
    const f = hpScale() / old;
    for (const t of trees) if (!t.gone && !t.dying && !t.burn && f > 1) { t.hp = Math.ceil(t.hp * f); t.maxHp = Math.ceil(t.maxHp * f); }
    equipAxe(i);
}
function reaperGear() {
    return [
        { name: "Ghost Lumberjack", desc: `A spectral helper that chops trees in the woods and pays you for each one. Owned: ${save.ghosts}`, cost: ghostCost(), buy() { save.ghosts++; syncGhosts(); } },
        { name: "Bandage", icon: "bandage", desc: `Heals 40 HP (H). Owned: ${save.bandages}`, cost: BANDAGE_COST, buy() { save.bandages++; } },
        { name: "Better Log Price", icon: "logs", desc: `Each log sells for $${logValue()} → $${logValue() + 2}`, cost: priceCost(), buy() { save.priceLvl++; } },
        { name: "Vitality", desc: `+20 max health (${save.hpLvl}/5)`, cost: hpCost(), maxed: save.hpLvl >= 5, buy() { save.hpLvl++; player.maxHp = maxHpNow(); player.hp = player.maxHp; } },
        { name: "Swift Boots", desc: `+7% move speed (${save.bootLvl}/4)`, cost: bootCost(), maxed: save.bootLvl >= 4, buy() { save.bootLvl++; } },
        { name: "Lantern Oil", icon: "lantern", desc: `A brighter, longer-reaching lantern (${save.oilLvl}/3)`, cost: oilCost(), maxed: save.oilLvl >= 3, buy() { save.oilLvl++; } },
        { name: "Better Fishing Rod", icon: "fish", desc: `Wider catch zone, faster bites, rarer fish (${save.rodLvl}/3)`, cost: rodCost(), maxed: save.rodLvl >= 3, buy() { save.rodLvl++; } }
    ];
}
function shopItems() {
    if (shopTab === "sell") return sellItems();
    if (shopTab === "trade") return tradeItems();
    if (shopTab === "guns") return gunCraftItems();
    if (shopTab === "ammo") return ammoCraftItems();
    if (shopTab === "axes") return shopMode === "forge" ? axeCraftItems() : reaperAxeItems();
    return shopMode === "forge" ? gearItems2() : reaperGear();
}
function openShop(mode, say) {
    shopMode = mode; shopPage = 0;
    if (!SHOP_TABS[mode].some(t => t[0] === shopTab)) shopTab = SHOP_TABS[mode][0][0];
    $("shopSay").textContent = say ? "“" + say + "”" : "";
    openPanel("shop");
}
function buy(i) {
    const it = shopItems()[i];
    if (!it) return;
    if (it.sell) { it.buy(); renderShop(); return; }
    if (it.owned) { if (it.axe !== undefined) equipAxe(it.axe); else if (it.gun !== undefined) equipGun(it.gun); return; }
    if (it.maxed) { toast("Already maxed out.", "bad"); return; }
    if (it.craft) {
        if (!hasMats(it.craft)) { toast("Not enough materials. Chop the right trees!", "bad"); sfx(120, 0.15, "square", 0.08, 0.6); return; }
        payMats(it.craft);
        it.buy();
        sfx(330, 0.12, "square", 0.12, 0.6); setTimeout(() => sfx(660, 0.2, "triangle", 0.12, 1.5), 120); setTimeout(() => sfx(990, 0.3, "triangle", 0.1, 1.2), 260);
        flash = 0.3;
        toast(`Crafted ${it.name}!`, "good");
        renderShop(); writeSave();
        return;
    }
    if (save.money < it.cost) { toast("Not enough cash.", "bad"); sfx(120, 0.15, "square", 0.08, 0.6); return; }
    save.money -= it.cost;
    it.buy();
    sfx(520, 0.2, "triangle", 0.14, 2);
    toast(`Bought ${it.name}`, "good");
    renderShop();
    writeSave();
}
const recipeHtml = r => '<span class="recipe">' + Object.entries(r).map(([k, n]) => { const have = save.mats[k] || 0; return `<span class="rp ${have >= n ? "ok" : "no"}"><img src="${iconURL("m:" + k)}">${Math.min(have, n)}/${n} ${MATS[k].name}</span>`; }).join("") + "</span>";
function renderShop() {
    $("shopCash").textContent = money(save.money);
    $("shopName").textContent = SHOP_NAMES[shopMode];
    const tabs = SHOP_TABS[shopMode];
    if (!tabs.some(t => t[0] === shopTab)) shopTab = tabs[0][0];
    const th = tabs.length > 1 ? tabs.map(t => `<button class="tab ${t[0] === shopTab ? "on" : ""}" data-tab="${t[0]}">${t[1]}</button>`).join("") : "";
    if ($("shopTabs").dataset.h !== th) { $("shopTabs").innerHTML = th; $("shopTabs").dataset.h = th; }
    const items = shopItems(), pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
    shopPage = clamp(shopPage, 0, pages - 1);
    const start = shopPage * PER_PAGE;
    let shopHtml = items.slice(start, start + PER_PAGE).map((it, k) => {
        const i = start + k, eqd = it.owned && (it.axe !== undefined ? save.equipped === it.axe && !holdingGun() : save.gunEq === it.gun);
        const cls = it.sell ? (it.value > 0 ? "ok" : "no") : it.owned || it.maxed ? "owned" : it.craft ? (hasMats(it.craft) ? "ok" : "no") : save.money >= it.cost ? "ok" : "no";
        const costTxt = it.sell ? (it.value > 0 ? "+" + money(it.value) : "—") : it.owned ? (eqd ? "EQUIPPED" : "OWNED · click to equip") : it.maxed ? "MAX" : it.craft ? (hasMats(it.craft) ? "CRAFT" : "NEED MATERIALS") : money(it.cost);
        return `<div class="row ${cls}" data-i="${i}"><span class="key">${k + 1}</span>${it.icon ? `<img class="ico" src="${iconURL(it.icon)}">` : ""}<div class="info"><b${it.col ? ` style="color:${it.col}"` : ""}>${it.name}</b><small>${it.desc}</small>${it.craft && !it.owned ? recipeHtml(it.craft) : ""}</div><span class="cost">${costTxt}</span></div>`;
    }).join("");
    if (!items.length) shopHtml = `<div class="empty">Nothing here yet.</div>`;
    if (pages > 1) shopHtml += `<div class="pager"><button class="pg" data-pg="-1" ${shopPage === 0 ? "disabled" : ""}>◀ PREV</button><span>PAGE ${shopPage + 1} / ${pages}</span><button class="pg" data-pg="1" ${shopPage >= pages - 1 ? "disabled" : ""}>NEXT ▶</button></div>`;
    if ($("shopList").dataset.h !== shopHtml) { $("shopList").innerHTML = shopHtml; $("shopList").dataset.h = shopHtml; }
}

// ---------- weapons, the 5-slot hotbar, and the inventory (drag weapons onto the hotbar) ----------
const HOT_N = 5;
const wOwned = id => !!id && (id[0] === "a" ? !!save.owned[+id.slice(1)] : !!save.gunOwned[+id.slice(1)]);
const wName = id => (id[0] === "a" ? AXES[+id.slice(1)].name : GUNS[+id.slice(1)].name);
const wCol = id => (id[0] === "a" ? AXES[+id.slice(1)].rarity : GUNS[+id.slice(1)].col);
const wEquipped = id => (id[0] === "a" ? !holdingGun() && save.equipped === +id.slice(1) : holdingGun() && save.gunEq === +id.slice(1));
function wEquip(id) { if (!wOwned(id)) return; if (id[0] === "a") equipAxe(+id.slice(1)); else equipGun(+id.slice(1)); }
function allWeapons() { const o = []; AXES.forEach((a, i) => { if (save.owned[i]) o.push("a" + i); }); GUNS.forEach((g, i) => { if (save.gunOwned[i]) o.push("g" + i); }); return o; }
function ensureHotbar() {
    if (!Array.isArray(save.hotbar) || save.hotbar.length !== HOT_N) {
        const all = allWeapons().reverse();
        save.hotbar = Array.from({ length: HOT_N }, (_, k) => all[k] || null);
    }
    for (let k = 0; k < HOT_N; k++) if (save.hotbar[k] && !wOwned(save.hotbar[k])) save.hotbar[k] = null;
}
function addToHotbar(id) {
    ensureHotbar();
    if (save.hotbar.includes(id)) return;
    const k = save.hotbar.indexOf(null);
    if (k >= 0) save.hotbar[k] = id;
}
function setHotSlot(k, id) {
    ensureHotbar();
    const from = save.hotbar.indexOf(id);
    if (from >= 0) save.hotbar[from] = save.hotbar[k];
    save.hotbar[k] = id;
    sfx(500, 0.06, "square", 0.05, 1.3);
}
function weaponStat(id) {
    const i = +id.slice(1);
    if (id[0] === "a") return axeDmgFor(i) + " dmg";
    const G = GUNS[i], am = gunAm(i);
    return `${gunDmg(i)}${G.pel > 1 ? "×" + G.pel : ""} dmg · ${am.mag}+${am.res}`;
}
function renderInv() {
    ensureHotbar();
    const hot = save.hotbar.map((id, k) => id
        ? `<div class="hslot ${wEquipped(id) ? "eq" : ""}" data-slot="${k}" data-w="${id}" draggable="true" style="border-color:${wCol(id)}"><span class="k">${k + 1}</span><img src="${iconURL(id)}"><b style="color:${wCol(id)}">${wName(id)}</b></div>`
        : `<div class="hslot empty" data-slot="${k}"><span class="k">${k + 1}</span><small>drop here</small></div>`).join("");
    if ($("invHot").dataset.h !== hot) { $("invHot").innerHTML = hot; $("invHot").dataset.h = hot; }
    const cards = allWeapons().map(id => {
        const eq = wEquipped(id), on = save.hotbar.includes(id);
        return `<div class="card wcard ${eq ? "eq" : ""}" data-act="w" data-w="${id}" draggable="true" style="border-color:${wCol(id)}"><img class="big" src="${iconURL(id)}"><b style="color:${wCol(id)}">${wName(id)}</b><small>${weaponStat(id)}${eq ? " · EQUIPPED" : on ? " · on hotbar" : ""}</small></div>`;
    });
    const wHtml = cards.join("");
    if ($("invSlots").dataset.h !== wHtml) { $("invSlots").innerHTML = wHtml; $("invSlots").dataset.h = wHtml; }
    const items = [];
    if (isle === 2) for (const k of Object.keys(MATS)) items.push(`<div class="card"><img class="big" src="${iconURL("m:" + k)}"><b style="color:${MATS[k].col}">${MATS[k].name}</b><small>${save.mats[k] || 0} · $${matPrice(k)} each</small></div>`);
    else items.push(`<div class="card"><img class="big" src="${iconURL("logs")}"><b>Logs</b><small>${save.logs} carried · $${logValue()} each${save.logBonus ? " + $" + Math.floor(save.logBonus) + " bonus" : ""}</small></div>`);
    items.push(
        `<div class="card" data-act="bandage"><img class="big" src="${iconURL("bandage")}"><b>Bandages</b><small>${save.bandages} · click to heal 40</small></div>`,
        `<div class="card" data-act="lantern"><img class="big" src="${iconURL("lantern")}"><b>Lantern</b><small>${player.lantern ? "On" : "Off"} · click to toggle</small></div>`,
        `<div class="card"><img class="big" src="${iconURL("cash")}"><b>Cash</b><small>${money(save.money)}</small></div>`
    );
    if (isle === 2) items.push(`<div class="card" data-act="relic"><img class="big" src="assets/relic.jpg" style="width:52px;height:60px;object-fit:cover"><b style="color:#ffd040">Hypergamous Relic</b><small>${relicCount()} / 6 pieces · click to view</small></div>`);
    if (isle === 1) items.push(`<div class="card" data-act="fish"><img class="big" src="${iconURL("fish")}"><b>Fish</b><small>${save.fishBag.length} in bag · click for the journal</small></div>`);
    const iHtml = items.join("");
    if ($("invItems").dataset.h !== iHtml) { $("invItems").innerHTML = iHtml; $("invItems").dataset.h = iHtml; }
    const c = save.contract;
    const statsHtml = [
        ["Day", `${save.day} · ${fmtClock()}`],
        ["Health", `${Math.ceil(player.hp)} / ${player.maxHp}`],
        ["Equipped", holdingGun() ? GUNS[save.gunEq].name : AXES[save.equipped].name],
        ["Contract", c ? `${c.prog}/${c.goal}` : "none"],
        ["Trees felled", save.felled],
        ["Rare trees", save.rareFelled],
        ["Chests opened", save.chestsOpened],
        [isle === 2 ? "Materials sold" : "Logs sold", save.sold],
        ["Deaths", save.deaths],
        ["Fish caught", Object.values(save.fishDex || {}).reduce((a, d) => a + d.n, 0)],
        ["Blood moons survived", save.bmSurvived || 0],
        ["Rebirths", (save.rebirths || 0) + (save.rebirths ? "  (+" + save.rebirths * 50 + "% cash, +" + save.rebirths * 10 + "% dmg)" : "")],
        ["Time played", fmtTime(save.seconds)]
    ].map(r => `<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join("");
    if ($("invStats").dataset.h !== statsHtml) { $("invStats").innerHTML = statsHtml; $("invStats").dataset.h = statsHtml; }
}
// drag a weapon card (or a hotbar slot) onto a hotbar slot; drag a slot off the hotbar to clear it
document.addEventListener("dragstart", e => {
    const w = e.target.closest && e.target.closest("[data-w]");
    if (!w) return;
    e.dataTransfer.setData("text/plain", w.dataset.w + "|" + (w.dataset.slot ?? ""));
    e.dataTransfer.effectAllowed = "move";
    w.classList.add("dragging");
});
document.addEventListener("dragend", e => { const w = e.target.closest && e.target.closest("[data-w]"); if (w) w.classList.remove("dragging"); document.querySelectorAll(".hslot.over").forEach(s => s.classList.remove("over")); });
document.addEventListener("dragover", e => { const s = e.target.closest && e.target.closest(".hslot, #invSlots"); if (s) { e.preventDefault(); document.querySelectorAll(".hslot.over").forEach(q => q !== s && q.classList.remove("over")); if (s.classList.contains("hslot")) s.classList.add("over"); } });
document.addEventListener("drop", e => {
    const s = e.target.closest && e.target.closest(".hslot, #invSlots");
    if (!s) return;
    e.preventDefault();
    const [id, from] = (e.dataTransfer.getData("text/plain") || "").split("|");
    if (!id || !wOwned(id)) return;
    ensureHotbar();
    if (s.classList.contains("hslot")) setHotSlot(+s.dataset.slot, id);
    else if (from !== "") { save.hotbar[+from] = null; sfx(300, 0.06, "square", 0.05, 0.8); }
    renderInv(); writeSave();
});
document.addEventListener("contextmenu", e => {
    const s = e.target.closest && e.target.closest(".hslot[data-w]");
    if (!s) return;
    e.preventDefault(); save.hotbar[+s.dataset.slot] = null; renderInv(); writeSave();
});
function showPanels() {
    $("panelInv").classList.toggle("show", panel === "inv");
    $("panelMap").classList.toggle("show", panel === "map");
    $("panelShop").classList.toggle("show", panel === "shop");
    $("panelFish").classList.toggle("show", panel === "fish");
    $("panelFerry").classList.toggle("show", panel === "ferry");
    $("panelRelic").classList.toggle("show", panel === "relic");
    if (panel === "relic") renderRelic();
    $("panelTalk").classList.toggle("show", panel === "talk");
    $("panelBack").classList.toggle("show", panel !== null && panel !== "talk");
    if (panel === "inv") renderInv();
    if (panel === "map") drawMap();
    if (panel === "shop") renderShop();
    if (panel === "fish") renderFishLog();
    if (panel === "ferry") renderFerry();
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
    if (state === "playing" && document.pointerLockElement !== canvas) { try { lockPointer(); } catch (e) { /* click the game to re-lock */ } }
}
const togglePanel = p => (panel === p ? closePanel() : openPanel(p));
document.addEventListener("click", e => {
    if (e.target.closest("[data-close]") || e.target.id === "panelBack") closePanel();
    const tab = e.target.closest(".tab");
    if (e.target.closest("#panelTalk") && !e.target.closest("[data-close]")) advanceTalk();
    if (tab) { shopTab = tab.dataset.tab; shopPage = 0; renderShop(); }
    const pg = e.target.closest(".pg");
    if (pg && !pg.disabled) { shopPage += +pg.dataset.pg; renderShop(); }
    const row = e.target.closest("#shopList .row");
    if (row) buy(+row.dataset.i);
    const card = e.target.closest("#panelInv [data-act]");
    if (card) {
        if (card.dataset.act === "w") wEquip(card.dataset.w);
        else if (card.dataset.act === "axe") equipAxe(+card.dataset.i);
        else if (card.dataset.act === "gun") equipGun(+card.dataset.i);
        else if (card.dataset.act === "bandage") useBandage();
        else if (card.dataset.act === "lantern") toggleLantern();
        else if (card.dataset.act === "fish") { openPanel("fish"); return; }
        else if (card.dataset.act === "relic") { openPanel("relic"); return; }
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
        barV.set(t.x, t.gy + Math.min(t.h * 1.3, 9.5) + 0.7, t.z).project(camera);
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
const treeDmg = t => (t.type.flee ? 0 : Math.round((8 + t.h) * t.type.dmg * (1 + 0.05 * (save.day - 1)) * dmgScale() * (isBlood() ? 1.25 : 1) * isleDm()));
const treeLogs = t => Math.max(1, Math.round(Math.ceil(t.h / 2) * t.type.logs * rewardScale() * (isBlood() ? 2 : 1) * isleRw()));
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
        plateV.set(t.x, t.gy + Math.min(t.h * 1.3, 9.5) + 1.5, t.z).project(camera);
        if (plateV.z > 1 || Math.abs(plateV.x) > 1.1 || plateV.y < -1.1) { e.style.display = "none"; continue; }
        const px = (plateV.x * 0.5 + 0.5) * innerWidth, py = Math.max((-plateV.y * 0.5 + 0.5) * innerHeight, 30), nowMs = performance.now();
        if (!(nowMs - (t._occT || 0) < 120)) { t._occT = nowMs; t._occ = isOccluded(V3(t.x, t.gy + Math.min(t.h * 1.3, 9.5) + 1.5, t.z), t.solid); }
        if (t._occ || behindAxe(px, py)) { e.style.display = "none"; continue; }
        const T = t.type, dmg = treeDmg(t);
        const html = '<b style="color:' + T.col + '">' + T.name + '</b><span>' + (dmg ? '⚔ ' + dmg + ' dmg' : '⚔ harmless') + (isle === 2 ? ' · <em style="color:' + MATS[T.mat || "wood"].col + '">' + treeLogs(t) + ' ' + MATS[T.mat || "wood"].name + '</em>' : ' · 🪵 ' + treeLogs(t) + (T.bonus ? ' <em>+$' + T.bonus + '/log</em>' : '')) + '</span>';
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
    if (isle === 2) { drawMap2(); return; }
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
const CONTROLS = [["WASD", "Move"], ["Mouse", "Look"], ["Click", "Swing / shoot"], ["Drag", "Weapons onto hotbar (E)"], ["Shift", "Sprint"], ["Space", "Jump"], ["Q", "Dash"],
    ["E", "Inventory"], ["M", "Map"], ["F", "Interact"], ["1-5", "Hotbar slot"], ["R", "Reload"], ["Wheel", "Next weapon"], ["H", "Bandage"], ["K", "Relic"], ["L", "Lantern"], ["J", "Fish journal"]];
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
    if (state === "title") { if (isle === 2) player.pos.set(RESPAWN.x, 1.7, RESPAWN.z); else player.pos.set(0, 1.7, -0.5); }
    state = "playing";
    renderMenu();
    if (document.pointerLockElement !== canvas) { try { lockPointer(); } catch (e) { /* needs gesture */ } }
}
$("menuBtn").addEventListener("click", startPlaying);
$("menuQuit").addEventListener("click", () => { writeSave(); window.close(); });
$("death").addEventListener("mousedown", respawn);
document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === canvas;
    lookSkip = 3;
    if (!locked && state === "playing" && !panel) { showPanels(); endFishing(); state = "paused"; mouseDown = false; renderMenu(); }
});

// ---------- input ----------
addEventListener("keydown", e => {
    if ($("intro")) return; // studio intro is playing
    keys[e.code] = true;
    if (state === "dead" && (e.code === "Space" || e.code === "KeyR" || e.code === "Enter")) { respawn(); return; }
    if ((state === "title" || state === "paused") && (e.code === "Enter" || e.code === "Space")) { startPlaying(); return; }
    if (state !== "playing") return;
    if (DEBUG && e.code === "F8") { save.money += 250000; toast("[debug] +$250,000", "cash"); return; }
    if (DEBUG && e.code === "F9") { save.owned.fill(1); GUNS.forEach((g, i) => { save.gunOwned[i] = 1; const am = gunAm(i); am.mag = magSize(i); am.res = resCap(i); }); save.bandages += 5; for (const k of Object.keys(MATS)) save.mats[k] = (save.mats[k] || 0) + 300; toast("[debug] every axe and gun + 300 of each material", "cash"); return; }
    if (ride) return;
    if (panel === "talk") { if (e.code === "KeyF" || e.code === "Space" || e.code === "Enter") advanceTalk(); else if (e.code === "Escape") closePanel(); return; }
    if (e.code === "Escape") { if (panel) closePanel(); return; }
    if (e.code === "Tab") { e.preventDefault(); if (panel === "shop") { const tl = SHOP_TABS[shopMode].map(t => t[0]); shopPage = 0; shopTab = tl[(tl.indexOf(shopTab) + 1) % tl.length]; renderShop(); } return; }
    if (e.code === "KeyE") { togglePanel("inv"); return; }
    if (e.code === "KeyM") { togglePanel("map"); return; }
    if (e.code === "KeyF") { if (fishing.on) { fishAction(); return; } interact(); return; }
    if (e.code === "KeyJ") { togglePanel("fish"); return; }
    if (e.code === "KeyK") { togglePanel("relic"); return; }
    if (panel === "shop" && /^Digit[1-4]$/.test(e.code)) { buy(shopPage * PER_PAGE + (+e.code.slice(5) - 1)); return; }
    if (panel === "shop" && /^(ArrowLeft|ArrowRight|BracketLeft|BracketRight)$/.test(e.code)) { shopPage += /Right/.test(e.code) ? 1 : -1; renderShop(); return; }
    if (/^Digit[1-9]$/.test(e.code)) { equipSlot(+e.code.slice(5) - 1); return; }
    if (e.code === "KeyH") useBandage();
    if (e.code === "KeyR") startReload();
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
addEventListener("wheel", e => { if (state === "playing" && !panel && locked && !ride) cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });
addEventListener("mousedown", e => {
    if ($("intro")) return;
    if (e.button !== 0 || state !== "playing") return;
    if (!locked && !panel) { try { lockPointer(); } catch (er) { /* ignore */ } return; }
    if (locked) { if (fishing.on) fishAction(); else mouseDown = true; }
});
addEventListener("mouseup", e => { if (e.button === 0) mouseDown = false; });
addEventListener("mousemove", e => {
    if (state !== "playing" || !locked || panel === "inv" || panel === "map") return;
    if (lookSkip > 0) { lookSkip--; return; } // the first events after locking can carry the whole cursor jump
    const mx = e.movementX, my = e.movementY;
    if (Math.abs(mx) > 300 || Math.abs(my) > 200) return; // a browser glitch spike, not a real flick: ignore it
    player.yaw -= mx * 0.0022;
    player.pitch = clamp(player.pitch - my * 0.0022, -1.45, 1.45);
});

function nearest() {
    if (isle === 2) return nearest2();
    const px = player.pos.x, pz = player.pos.z;
    if (Math.hypot(px - SHOP.x, pz - (KEEPER.z + 1.6)) < 3.6) return { k: "shop" };
    if (Math.hypot(px - BED.x, pz - BED.z) < 2.8) return { k: "bed" };
    if (Math.hypot(px - HOPPER.x, pz - HOPPER.z) < 3.6) return { k: "chute" };
    if (Math.hypot(px - FERRYMAN.x, pz - FERRYMAN.z) < 3.4) return { k: "ferry" };
    for (const c of chests) if (!c.opened && Math.hypot(px - c.x, pz - c.z) < 2.6) return { k: "chest", c };
    if (altar && Math.hypot(px - altar.x, pz - altar.z) < 3.2) return { k: "altar" };
    const fs2 = fishSpot();
    if (fs2) return { k: "fish", spot: fs2 };
    return null;
}
function interact() {
    if (panel === "talk") { advanceTalk(); return; }
    if (panel === "shop") { closePanel(); return; }
    if (panel) return;
    const n = nearest();
    if (!n) return;
    if (n.k === "smith") {
        openShop("forge", SMITH_SAY[Math.floor(Math.random() * SMITH_SAY.length)]);
    } else if (n.k === "depot") openShop("trade", ["Wood, stone, ore, powder... I buy it all.", "Fresh from the trees? Let's see it.", "Gold's up today. Don't tell anyone."][Math.floor(Math.random() * 3)]);
    else if (n.k === "ferry2") { if (!save.ferry2Talk) { save.ferry2Talk = 1; startTalk("THE FERRYMAN", FERRY2_LINES, () => openFerry2()); } else openFerry2(); }
    else if (n.k === "relic") collectRelic(n.r);
    else if (n.k === "shop") {
        const lines = ["Hehehe... welcome, woodcutter.", "Everything has a price. Even your axe.", "The trees talk about you, you know.", "Spend it. You cannot take it with you.", "Smile! It suits you.", "Night is when the good ones grow."];
        openShop("reaper", lines[Math.floor(Math.random() * lines.length)]);
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
        if (first) startTalk("THE FERRYMAN", FERRY_FIRST, () => openFerry());
        else openFerry();
    } else if (n.k === "fish") {
        if (n.spot.blocked) toast("Face the water to cast your line.", "bad"); else startFishing(n.spot);
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
        if (!t.type.flee && !safe && !t._seen && dist < activateR() && dist > t.r + 2.1 && t.atk === "idle") cands.push(t);
    }
    cands.sort((a, b) => a._d - b._d);
    const movers = new Set(cands.slice(0, isBlood() ? 5 : 3)); // at most three (five on a blood moon) trees stalk you at once, so they never swarm

    for (const t of trees) {
        if (t.gone) continue;
        if (t.burn) {
            t.t += dt / 1.4;
            t.g.scale.setScalar(Math.max(0.01, 1 - t.t));
            if (Math.random() < dt * 14) burst(V3(t.x, t.gy + 0.5 + Math.random() * t.h, t.z), 1, 2, [chipMats[1], new THREE.MeshBasicMaterial({ color: 0xff7a2a })]);
            if (t.t >= 1) { scene.remove(t.g); t.gone = true; }
            continue;
        }
        if (t.dying) {
            t.t += dt / 0.9;
            t.body.rotation.x = -Math.min(1, t.t * t.t) * Math.PI / 2;
            if (t.t >= 1) {
                if (t.byGhost) { burst(V3(t.x, 0.6, t.z), 14, 4, [chipMats[1], new THREE.MeshBasicMaterial({ color: 0x9fe8ff })]); sfx(120, 0.2, "square", 0.08, 0.5); scene.remove(t.g); t.gone = true; continue; }
    const bx = -Math.sin(t.g.rotation.y), bz = -Math.cos(t.g.rotation.y);
                dropLogs(t.x, t.z, treeLogs(t), { x: bx, z: bz }, t.key);
                burst(V3(t.x + bx * t.h * 0.5, t.gy + 0.3, t.z + bz * t.h * 0.5), 18, 5);
                sfx(70, 0.35, "square", 0.2, 0.3);
                shake = Math.min(0.6, shake + 0.2);
                scene.remove(t.g);
                t.gone = true;
            }
            continue;
        }
        const dist = t._d, seen = t._seen;
        if (dist < activateR() * 1.6) t.g.rotation.y += angDiff(Math.atan2(player.pos.x - t.x, player.pos.z - t.z), t.g.rotation.y) * Math.min(1, 4 * dt);

        let mx = 0, mz = 0, sp = 0;
        if (t.type.flee) {
            if (dist < 14) { mx = -t._nx; mz = -t._nz; sp = 3.6; }
        } else if (movers.has(t)) { mx = t._nx; mz = t._nz; sp = 1.9 * t.type.speed; }
        if (sp > 0) {
            t.x += mx * sp * dt; t.z += mz * sp * dt;
            const od = Math.hypot(t.x, t.z);
            if (od < SAFE_R + t.r + 0.5) { t.x = t.x / od * (SAFE_R + t.r + 0.5); t.z = t.z / od * (SAFE_R + t.r + 0.5); }
            const tl = curShoreAt(t.x, t.z) - 8; if (od > tl) { t.x *= tl / od; t.z *= tl / od; }
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
                if (Math.random() < (isBlood() ? 0.6 : 0.4)) { t.atk = "wind"; t.atkT = 0; sfx(180, 0.3, "sawtooth", 0.05, 0.5); floatWorld(V3(t.x, t.gy + Math.min(t.h * 0.7, 3.4), t.z), "!", "warn"); }
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
        t.gy = groundY(t.x, t.z);
        t.g.position.set(t.x + (Math.random() - 0.5) * t.hurt * 0.15, t.gy - (isle === 2 ? 0.25 : 0), t.z + (Math.random() - 0.5) * t.hurt * 0.15);
        t.body.rotation.z = Math.sin(time * 0.9 + t.phase) * 0.025 * swayK + (sp > 0 ? Math.sin(time * 9 + t.phase) * 0.04 : 0);
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
    if (alive < treeTarget() && Math.random() < dt * (isBlood() ? 1.4 : 0.7) * (isle === 2 ? 1.6 : 1)) spawnTree();
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
    if (ferryman && !ride) {
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
    clampToIsland(player.pos);
    pushOutBoxes(player.pos, 0.45);
    if (ride) updateRide(dt);
    const gnd = groundY(player.pos.x, player.pos.z) + 1.7;
    if (!ride && (player.pos.y <= gnd || (player.onGround && player.vel.y <= 0 && player.pos.y - gnd < 0.7))) { player.pos.y = gnd; player.vel.y = 0; player.onGround = true; }
    player.dashCd -= dt;
    if (player.onGround) player.bob += dt * Math.hypot(player.vel.x, player.vel.z) * 1.6;
    const safe = inSafe();
    if (safe && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 2 * dt);

    // swing / shoot
    if (holdingGun()) updateGun(dt);
    if (swing.t < 1) {
        swing.t = Math.min(1, swing.t + dt / 0.36);
        if (!swing.hit && swing.t >= 0.46) { swing.hit = true; tryHit(); }
    } else if (mouseDown && !panel && !fishing.on && !holdingGun() && !ride) {
        swing.t = 0; swing.hit = false;
        sfx(260, 0.15, "sawtooth", 0.04, 0.5);
    }

    camera.getWorldDirection(fwd);
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    updateTrees(dt, safe, fwd.x / fl, fwd.z / fl);
    updateWorldAnim(dt); updateIsle2Anim(dt);
    updateWeather(dt); updateEcosystem(dt); updateGhosts(dt); updateFishing(dt); ambienceTick(dt); footsteps(dt);

    // particles
    for (let i = chips.length - 1; i >= 0; i--) {
        const c = chips[i];
        c.life -= dt; c.v.y -= 14 * dt;
        c.m.position.addScaledVector(c.v, dt);
        const cgy = groundY(c.m.position.x, c.m.position.z) + 0.05;
        if (c.m.position.y < cgy) { c.m.position.y = cgy; c.v.multiplyScalar(0.4); }
        if (c.life <= 0) { scene.remove(c.m); chips.splice(i, 1); }
    }

    // log pickups
    for (let i = logs.length - 1; i >= 0; i--) {
        const l = logs[i], p = l.m.position;
        const dx = player.pos.x - p.x, dz = player.pos.z - p.z, d = Math.hypot(dx, dz);
        const lgy = groundY(p.x, p.z), LR = 5 + 2.5 * (save.magnetLvl || 0);
        if (d < LR) { const pull = (LR - d) * 6 * dt; p.x += dx / (d || 1) * pull; p.z += dz / (d || 1) * pull; p.y += (lgy + 1 - p.y) * 0.1; }
        l.vy -= 14 * dt; p.y += l.vy * dt;
        if (p.y < lgy + 0.2 && d >= LR) { p.y = lgy + 0.2; l.vy = 0; }
        l.m.rotation.y += dt * 2;
        if (d < 1.3) { if (l.mat) { save.mats[l.mat] = (save.mats[l.mat] || 0) + l.w; matAcc[l.mat] = (matAcc[l.mat] || 0) + l.w; } else { save.logs += l.w; save.logBonus += l.bonus * l.w; pickupAcc += l.w; } pickupT = 0.6; scene.remove(l.m); logs.splice(i, 1); sfx(700 + Math.random() * 200, 0.08, "triangle", 0.06, 1.5); }
    }
    if ((pickupAcc > 0 || matAccN()) && (pickupT -= dt) <= 0) { if (pickupAcc) toast(`+${pickupAcc} log${pickupAcc === 1 ? "" : "s"}`, "log"); if (matAccN()) toast(Object.entries(matAcc).map(([k, v]) => "+" + v + " " + MATS[k].name).join("   "), "log"); pickupAcc = 0; for (const k in matAcc) delete matAcc[k]; }

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

// =====================================================================
//  1.0.1: a living island (water, clouds, flowers, wildlife, smoke)
// =====================================================================
const lamb = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const part = (g, geo, m, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(rx, ry, rz); g.add(o); return o; };
const POND = LANDMARKS[1];

// ---------- water: turquoise shallows fading to deep blue, plus a lapping foam line ----------
{
    const wg = new THREE.PlaneGeometry(720, 720, 144, 144);
    wg.rotateX(-Math.PI / 2);
    const pos = wg.attributes.position, col = [], c = new THREE.Color(), shallow = new THREE.Color(0x56d8d0), mid = new THREE.Color(0x2f86b8), deep = new THREE.Color(0x174a7a);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i), k = clamp((Math.hypot(x, z) - shoreAt(x, z)) / 30, 0, 1);
        c.copy(shallow).lerp(mid, clamp(k * 2, 0, 1)).lerp(deep, clamp(k * 2 - 1, 0, 1));
        col.push(c.r, c.g, c.b);
    }
    wg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    waterMesh.geometry.dispose();
    waterMesh.geometry = wg;
    waterMesh.material.color.setHex(0xffffff);
    waterMesh.material.vertexColors = true;
    waterMesh.material.needsUpdate = true;
}
addTgt = isle1;
const foam = (() => {
    const N = 260, p = [], idx = [];
    for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2, r = shoreR(th);
        p.push(Math.cos(th) * (r - 3.5), -0.4, Math.sin(th) * (r - 3.5), Math.cos(th) * (r - 2.2), -0.4, Math.sin(th) * (r - 2.2));
        if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    scene.add(m);
    return m;
})();

addTgt = null;
// ---------- clouds ----------
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
const clouds = [];
for (let i = 0; i < 14; i++) {
    const b = batch(cloudMat), n = 5 + Math.floor(srand() * 3);
    for (let k = 0; k < n; k++) b.add(ICO, (k - n / 2) * 4.5 + srange(-1, 1), srange(-1, 1.2), srange(-3, 3), 0, 0, 0, srange(4, 7), srange(2.4, 3.6), srange(3.5, 5.5));
    const m = b.build();
    m.position.set(srange(-170, 170), srange(62, 92), srange(-170, 170));
    clouds.push(m);
}

addTgt = isle1;
// ---------- flowers, tall grass ----------
const flowerPatches = [];
{
    const cols = [0xff7aa8, 0xffe060, 0xf4f4f4, 0x8ab8ff, 0xc08aff];
    const heads = cols.map(c => batch(lamb(c))), stems = batch(lamb(0x4a7a3a));
    const patch = (x, z) => {
        const a = Math.floor(srand() * cols.length), b = Math.floor(srand() * cols.length), n = 10 + Math.floor(srand() * 8);
        for (let i = 0; i < n; i++) {
            const fx = x + srange(-2.6, 2.6), fz = z + srange(-2.6, 2.6);
            stems.add(CYL6, fx, 0.22, fz, 0, 0, 0, 0.02, 0.44, 0.02);
            heads[srand() < 0.6 ? a : b].add(ICO, fx, 0.5, fz, 0, 0, 0, 0.12, 0.1, 0.12);
        }
        flowerPatches.push({ x, z });
    };
    scatter(30, patch, false, 2);
    scatter(8, patch, true, 0);
    heads.forEach(h => h.build()); stems.build();
    const g1 = batch(lamb(0x4a8a3a)), g2 = batch(lamb(0x6a9a42));
    scatter(170, (x, z) => { const gb = srand() < 0.5 ? g1 : g2; for (let i = 0; i < 4; i++) gb.add(CONE6, x + srange(-0.3, 0.3), 0.32, z + srange(-0.3, 0.3), srange(-0.25, 0.25), 0, srange(-0.25, 0.25), 0.05, srange(0.45, 0.8), 0.05); }, false, 0);
    g1.build(); g2.build();
}

// ---------- chimney + smoke ----------
const smokePuffs = [], smokeEmit = [];
const smokeMat = new THREE.MeshBasicMaterial({ color: 0xc8c8d4, transparent: true, opacity: 0.45, depthWrite: false });
for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(ICO, smokeMat); m.visible = false; scene.add(m); smokePuffs.push({ m, life: 0, vx: 0, vz: 0 }); }
const addSmoke = (x, y, z, rate = 0.6) => smokeEmit.push({ x, y, z, rate, acc: srand() });
{
    addBox(-3.3, -2.5, 0.2, 1.0, 3.4, 6.0, new THREE.MeshLambertMaterial({ color: 0x5a5a66, flatShading: true }), false);
    addSmoke(-2.9, 6.1, 0.6, 0.9);
    addSmoke(MILL.x + 1, 5.4, MILL.z + 1, 0.8);
    for (const lm of LANDMARKS) if (lm.name.includes("CAMP")) addSmoke(lm.x, 1.6, lm.z, 0.7);
}

// ---------- wildlife ----------
const critters = [];
const bx = (g, m, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => part(g, BOX, m, x, y, z, sx, sy, sz, rx, ry, rz);
function randLand(margin = 14) { for (let i = 0; i < 40; i++) { const a = Math.random() * 6.283, d = SAFE_R + 4 + Math.random() * (shoreR(a) - margin - SAFE_R - 4), x = Math.cos(a) * d, z = Math.sin(a) * d; if (okSpot(x, z, 4)) return { x, z }; } return { x: 40, z: 40 }; }
function randBeach() { for (let i = 0; i < 40; i++) { const a = Math.random() * 6.283, d = shoreR(a) - rand(4, 9), x = Math.cos(a) * d, z = Math.sin(a) * d, dx = x - FB.x, dz = z - FB.z, al = dx * FDIR.x + dz * FDIR.z, sd = dx * FPERP.x + dz * FPERP.z; if (al > -6 && al < 12 && Math.abs(sd) < 8) continue; return { x, z, a }; } return { x: 80, z: 0, a: 0 }; }
function addCritter(kind, g, x, z, y = 0, extra = {}) {
    g.position.set(x, y, z); scene.add(g);
    const c = Object.assign({ kind, g, x, z, y0: y, ph: srand() * 6, state: "idle", t: srand() * 3, tx: x, tz: z, hx: x, hz: z, hide: 0 }, extra);
    critters.push(c); return c;
}
function makeDeer() {
    const g = new THREE.Group(), body = lamb(0x8a5a30), pale = lamb(0xe8d8b8), dark = lamb(0x3a2412);
    bx(g, body, 0, 1.0, 0, 0.55, 0.55, 1.2); bx(g, pale, 0, 0.78, 0, 0.5, 0.18, 1.0);
    bx(g, body, 0, 1.45, 0.62, 0.22, 0.7, 0.22, 0.4); bx(g, body, 0, 1.85, 0.9, 0.26, 0.28, 0.42); bx(g, dark, 0, 1.8, 1.14, 0.1, 0.1, 0.1);
    bx(g, pale, 0, 1.2, -0.66, 0.14, 0.16, 0.14);
    for (const [x, z] of [[-0.18, 0.45], [0.18, 0.45], [-0.18, -0.45], [0.18, -0.45]]) bx(g, dark, x, 0.4, z, 0.1, 0.8, 0.1);
    for (const s of [-1, 1]) { bx(g, dark, s * 0.1, 2.12, 0.85, 0.04, 0.4, 0.04, 0, 0, s * 0.35); bx(g, dark, s * 0.2, 2.2, 0.85, 0.04, 0.22, 0.04, 0, 0, s * 0.9); }
    return g;
}
function makeRabbit() {
    const g = new THREE.Group(), fur = lamb(0xb8a894), white = lamb(0xf4f0e8);
    part(g, ICO, fur, 0, 0.28, 0, 0.26, 0.24, 0.34); part(g, ICO, fur, 0, 0.42, 0.28, 0.16, 0.15, 0.17); part(g, ICO, white, 0, 0.3, -0.34, 0.09, 0.09, 0.09);
    for (const s of [-1, 1]) bx(g, fur, s * 0.06, 0.66, 0.26, 0.05, 0.3, 0.05, 0, 0, s * 0.15);
    return g;
}
function makeCrab() {
    const g = new THREE.Group(), red = lamb(0xe0502a);
    part(g, ICO, red, 0, 0.14, 0, 0.26, 0.12, 0.2);
    for (const s of [-1, 1]) { part(g, ICO, red, s * 0.34, 0.18, 0.16, 0.1, 0.08, 0.1); bx(g, red, s * 0.1, 0.3, 0.14, 0.03, 0.08, 0.03); }
    return g;
}
function makeGull() {
    const g = new THREE.Group(), white = lamb(0xf2f2f2), grey = lamb(0x9a9aa2), yel = lamb(0xffc030);
    part(g, ICO, white, 0, 0.32, 0, 0.18, 0.18, 0.34); part(g, ICO, white, 0, 0.5, 0.26, 0.1, 0.1, 0.1); bx(g, yel, 0, 0.48, 0.38, 0.04, 0.04, 0.12);
    const wl = bx(g, grey, -0.3, 0.4, 0, 0.5, 0.03, 0.22), wr = bx(g, grey, 0.3, 0.4, 0, 0.5, 0.03, 0.22);
    g.userData.wings = [wl, wr];
    return g;
}
function makeFrog() {
    const g = new THREE.Group(), grn = lamb(0x58b04a);
    part(g, ICO, grn, 0, 0.1, 0, 0.14, 0.09, 0.17); part(g, ICO, grn, -0.07, 0.2, 0.1, 0.04, 0.04, 0.04); part(g, ICO, grn, 0.07, 0.2, 0.1, 0.04, 0.04, 0.04);
    return g;
}
const birdMat = lamb(0xeeeeee);
function makeBird() {
    const g = new THREE.Group();
    part(g, ICO, birdMat, 0, 0, 0, 0.14, 0.1, 0.3);
    const wl = bx(g, birdMat, -0.3, 0, 0, 0.5, 0.02, 0.22), wr = bx(g, birdMat, 0.3, 0, 0, 0.5, 0.02, 0.22);
    g.userData.wings = [wl, wr];
    return g;
}
function makeButterfly() {
    const g = new THREE.Group(), c = [0xff7ad8, 0xffd040, 0x7fd8ff, 0xffffff][Math.floor(Math.random() * 4)], m = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
    const wl = part(g, BOX, m, -0.1, 0, 0, 0.18, 0.01, 0.16), wr = part(g, BOX, m, 0.1, 0, 0, 0.18, 0.01, 0.16);
    g.userData.wings = [wl, wr];
    return g;
}
for (let i = 0; i < 6; i++) { const p = randLand(16); addCritter("deer", makeDeer(), p.x, p.z, 0, { hx: p.x, hz: p.z }); }
for (let i = 0; i < 11; i++) { const p = randLand(14); addCritter("rabbit", makeRabbit(), p.x, p.z, 0, { hx: p.x, hz: p.z }); }
for (let i = 0; i < 14; i++) { const p = randBeach(); addCritter("crab", makeCrab(), p.x, p.z, 0.02, { hx: p.x, hz: p.z, ang: p.a }); }
for (let i = 0; i < 8; i++) { const p = randBeach(); addCritter("gull", makeGull(), p.x, p.z, 0, { hx: p.x, hz: p.z }); }
for (let i = 0; i < 4; i++) { const p = dockPt(5 + i * 5.5, i % 2 ? 1.9 : -1.9, 1.15); addCritter("gull", makeGull(), p.x, p.z, 1.15, { hx: p.x, hz: p.z, perch: true }); }
for (let i = 0; i < 5; i++) { const a = srand() * 6.283, d = srange(6.7, 8); addCritter("frog", makeFrog(), POND.x + Math.cos(a) * d, POND.z + Math.sin(a) * d, 0.02, { hx: POND.x + Math.cos(a) * d, hz: POND.z + Math.sin(a) * d }); }
for (let i = 0; i < 10; i++) addCritter("bird", makeBird(), 0, 0, 22, { cx: srange(-40, 40), cz: srange(-40, 40), rad: srange(25, 70), spd: srange(0.07, 0.14) * (srand() < 0.5 ? 1 : -1), alt: srange(16, 30) });
for (let i = 0; i < 12; i++) { const fp = flowerPatches[Math.floor(srand() * flowerPatches.length)] || { x: 30, z: 30 }; addCritter("butterfly", makeButterfly(), fp.x, fp.z, 1, { hx: fp.x, hz: fp.z }); }

const WALK_OK = (x, z) => Math.hypot(x, z) < shoreAt(x, z) - 8 && Math.hypot(x - POND.x, z - POND.z) > 7.5;
function step(c, tx, tz, sp, dt) {
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz) || 1, m = Math.min(d, sp * dt);
    const nx = c.x + dx / d * m, nz = c.z + dz / d * m;
    if (WALK_OK(nx, nz)) { c.x = nx; c.z = nz; }
    c.g.rotation.y += angDiff(Math.atan2(dx, dz), c.g.rotation.y) * Math.min(1, 8 * dt);
    return d;
}
function updateCritters(dt) {
    const px = player.pos.x, pz = player.pos.z, dayA = dayAmt(), night = dayA < 0.25, calm = wx.rain < 0.3;
    birdMat.color.setHex(dayA > 0.3 ? 0xeeeeee : 0x3a2a4a);
    for (const c of critters) {
        const dp = Math.hypot(px - c.x, pz - c.z);
        const far = dp > 95;
        c.g.visible = !far;
        if (far && c.kind !== "bird") continue;
        c.t -= dt; c.ph += dt;
        switch (c.kind) {
            case "deer": {
                if (dp < 13 && state === "playing") { c.state = "flee"; const ax = c.x - px, az = c.z - pz, al = Math.hypot(ax, az) || 1; step(c, c.x + ax / al * 10, c.z + az / al * 10, 7.5, dt); c.g.position.y = Math.abs(Math.sin(c.ph * 9)) * 0.18; }
                else if (c.state === "flee" && dp < 22) { step(c, c.x + (c.x - px), c.z + (c.z - pz), 5, dt); }
                else { c.state = "idle"; if (c.t <= 0) { c.t = rand(2, 6); if (Math.random() < 0.6) { const a = Math.random() * 6.283, r = rand(4, 16); c.tx = c.hx + Math.cos(a) * r; c.tz = c.hz + Math.sin(a) * r; c.walking = true; } else c.walking = false; }
                    if (c.walking) { if (step(c, c.tx, c.tz, 1.5, dt) < 0.5) c.walking = false; c.g.position.y = Math.sin(c.ph * 4) * 0.03; } else c.g.position.y = 0; }
                break;
            }
            case "rabbit": {
                const fleeing = dp < 7 && state === "playing";
                if (c.t <= 0) { c.t = fleeing ? 0.25 : rand(1, 3.5); const a = fleeing ? Math.atan2(c.x - px, c.z - pz) + rand(-0.6, 0.6) : Math.random() * 6.283, r = fleeing ? 4 : rand(1, 3); c.tx = c.x + Math.sin(a) * r; c.tz = c.z + Math.cos(a) * r; c.hop = 0.35; }
                if (c.hop > 0) { c.hop -= dt; step(c, c.tx, c.tz, fleeing ? 9 : 3.5, dt); c.g.position.y = Math.sin((1 - c.hop / 0.35) * Math.PI) * 0.4; } else c.g.position.y = 0;
                break;
            }
            case "crab": {
                if (c.hide > 0) { c.hide -= dt; c.g.visible = false; if (c.hide <= 0) { c.x = c.hx; c.z = c.hz; } break; }
                if (dp < 5 && state === "playing") { const a = Math.atan2(c.z, c.x); c.x += Math.cos(a) * 5.5 * dt; c.z += Math.sin(a) * 5.5 * dt; if (Math.hypot(c.x, c.z) > shoreAt(c.x, c.z) - 3.2) { c.hide = 12; burst(V3(c.x, 0.1, c.z), 4, 2, [new THREE.MeshBasicMaterial({ color: 0xcfeaff })]); } }
                else if (c.t <= 0) { c.t = rand(0.6, 2.4); c.dir = Math.random() < 0.5 ? 1 : -1; c.go = Math.random() < 0.6 ? rand(0.3, 0.8) : 0; }
                if (c.go > 0) { c.go -= dt; const a = Math.atan2(c.z, c.x) + Math.PI / 2; c.x += Math.cos(a) * c.dir * 1.4 * dt; c.z += Math.sin(a) * c.dir * 1.4 * dt; }
                c.g.position.set(c.x, 0.02 + Math.abs(Math.sin(c.ph * 14)) * (c.go > 0 ? 0.03 : 0), c.z); c.g.rotation.y = Math.atan2(c.x, c.z);
                break;
            }
            case "gull": {
                c.g.visible = !far && !night;
                if (c.state === "fly") {
                    c.fly -= dt; c.ang += dt * 0.55; const r = 14;
                    c.x = c.cx + Math.cos(c.ang) * r; c.z = c.cz + Math.sin(c.ang) * r; c.g.position.y = 11 + Math.sin(c.ph) * 1.2;
                    c.g.rotation.y = -c.ang + Math.PI; c.g.userData.wings.forEach((w, i) => { w.rotation.z = Math.sin(c.ph * 9) * 0.6 * (i ? -1 : 1); });
                    if (c.fly <= 0) { c.state = "idle"; if (!c.perch) { const p = randBeach(); c.x = p.x; c.z = p.z; } else { c.x = c.hx; c.z = c.hz; } c.g.position.y = c.y0; c.g.userData.wings.forEach(w => (w.rotation.z = 0)); }
                } else {
                    c.g.rotation.y += angDiff(Math.atan2(px - c.x, pz - c.z) + Math.PI, c.g.rotation.y) * Math.min(1, dt);
                    if (dp < 7 && state === "playing" && !night) { c.state = "fly"; c.fly = rand(7, 12); c.ang = Math.random() * 6.283; c.cx = c.x - Math.cos(c.ang) * 14; c.cz = c.z - Math.sin(c.ang) * 14; sfx(900, 0.25, "triangle", 0.03, 1.5); }
                }
                c.g.position.x = c.x; c.g.position.z = c.z;
                break;
            }
            case "frog": {
                c.g.visible = !far && !night;
                if (c.hide > 0) { c.hide -= dt; c.g.visible = false; if (c.hide <= 0) { c.x = c.hx; c.z = c.hz; } break; }
                if (dp < 4 && state === "playing") { c.hide = 10; pondRipple(POND.x + (c.hx - POND.x) * 0.7, POND.z + (c.hz - POND.z) * 0.7); sfx(380, 0.12, "sine", 0.05, 0.7); }
                if (c.t <= 0) { c.t = rand(2, 7); c.jump = 0.3; }
                if (c.jump > 0) { c.jump -= dt; c.g.position.y = 0.02 + Math.sin((1 - c.jump / 0.3) * Math.PI) * 0.25; } else c.g.position.y = 0.02;
                break;
            }
            case "bird": {
                const showBird = dayA > 0.3 || (c.ph | 0) % 2 === 0 && night; // fewer, darker bats at night
                c.g.visible = showBird && calm;
                c.ang = (c.ang || c.ph) + c.spd * dt * (night ? 2.2 : 1);
                const bx2 = c.cx + Math.cos(c.ang) * c.rad, bz2 = c.cz + Math.sin(c.ang) * c.rad;
                c.g.position.set(bx2, c.alt + Math.sin(c.ph * 0.7) * 2, bz2);
                c.g.rotation.y = -c.ang + (c.spd > 0 ? 0 : Math.PI);
                c.g.userData.wings.forEach((w, i) => { w.rotation.z = Math.sin(c.ph * (night ? 18 : 10)) * 0.7 * (i ? -1 : 1); });
                break;
            }
            case "butterfly": {
                c.g.visible = !far && dayA > 0.5 && calm;
                const t = c.ph * 0.6;
                c.g.position.set(c.hx + Math.sin(t * 1.3) * 2.6, 0.8 + Math.sin(t * 2.1) * 0.35 + 0.3, c.hz + Math.sin(t * 0.9 + 1) * 2.6);
                c.g.rotation.y = t;
                c.g.userData.wings.forEach((w, i) => { w.rotation.z = Math.sin(c.ph * 16) * 0.9 * (i ? -1 : 1); });
                break;
            }
        }
        if (c.kind !== "gull" && c.kind !== "bird" && c.kind !== "butterfly" && c.kind !== "crab") { c.g.position.x = c.x; c.g.position.z = c.z; }
    }
}

// ---------- the pond: fish shadows, ripples, and the odd jumping fish ----------
const ripples = [];
{
    const rm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 20), rm.clone()); m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); ripples.push({ m, life: 0 }); }
}
function pondRipple(x, z, y = 0.08, scale = 1) { const r = ripples.find(q => q.life <= 0); if (!r) return; r.life = 1; r.sc = scale; r.m.position.set(x, y, z); r.m.visible = true; }
const pondFish = [], jumpFish = { m: null, t: -1, a: 0, sx: 0, sz: 0, ex: 0, ez: 0 };
{
    const sm = new THREE.MeshBasicMaterial({ color: 0x06202c, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
    for (let i = 0; i < 9; i++) {
        const g = new THREE.Group();
        part(g, ICO, sm, 0, 0, 0, 0.13, 0.02, 0.38); part(g, CONE6, sm, 0, 0, -0.42, 0.1, 0.02, 0.2, -Math.PI / 2, 0, 0);
        g.position.y = 0.07; scene.add(g);
        pondFish.push({ g, a: srand() * 6.283, r: srange(1.2, 5), sp: srange(0.25, 0.6) * (srand() < 0.5 ? 1 : -1), ph: srand() * 6 });
    }
    const jg = new THREE.Group(), fm = new THREE.MeshLambertMaterial({ color: 0xff9a3a, flatShading: true });
    part(jg, ICO, fm, 0, 0, 0, 0.12, 0.12, 0.34); part(jg, CONE6, fm, 0, 0, -0.38, 0.1, 0.1, 0.22, -Math.PI / 2, 0, 0);
    jg.visible = false; scene.add(jg); jumpFish.m = jg; jumpFish.cd = 4;
}
function updatePond(dt) {
    if (Math.hypot(player.pos.x - POND.x, player.pos.z - POND.z) > 60) return;
    for (const f of pondFish) {
        f.a += f.sp * dt;
        f.g.position.set(POND.x + Math.cos(f.a) * f.r, 0.07, POND.z + Math.sin(f.a) * f.r);
        f.g.rotation.y = -f.a + (f.sp > 0 ? Math.PI : 0) + (f.sp > 0 ? 0 : Math.PI) + Math.PI / 2;
        f.g.rotation.z = Math.sin(time * 5 + f.ph) * 0.15;
    }
    if (jumpFish.t < 0) { jumpFish.cd -= dt; if (jumpFish.cd <= 0) { jumpFish.t = 0; jumpFish.cd = rand(6, 14); const a = Math.random() * 6.283, r = rand(1, 4.5); jumpFish.sx = POND.x + Math.cos(a) * r; jumpFish.sz = POND.z + Math.sin(a) * r; const a2 = a + rand(-0.8, 0.8); jumpFish.ex = POND.x + Math.cos(a2) * rand(1, 4.8); jumpFish.ez = POND.z + Math.sin(a2) * rand(1, 4.8); jumpFish.m.visible = true; pondRipple(jumpFish.sx, jumpFish.sz); sfx(620, 0.08, "sine", 0.05, 1.8); } }
    else {
        jumpFish.t += dt / 0.9;
        const k = jumpFish.t, x = lerp(jumpFish.sx, jumpFish.ex, k), z = lerp(jumpFish.sz, jumpFish.ez, k), y = Math.sin(k * Math.PI) * 1.1;
        jumpFish.m.position.set(x, y + 0.05, z);
        jumpFish.m.rotation.set(-Math.cos(k * Math.PI) * 0.9, Math.atan2(jumpFish.ex - jumpFish.sx, jumpFish.ez - jumpFish.sz), 0);
        if (k >= 1) { jumpFish.t = -1; jumpFish.m.visible = false; pondRipple(jumpFish.ex, jumpFish.ez); sfx(300, 0.1, "sine", 0.05, 0.6); }
    }
}
function updateRipples(dt) {
    for (const r of ripples) if (r.life > 0) { r.life -= dt * 0.8; const s = (1.6 - r.life) * 1.8 * r.sc; r.m.scale.set(s, s, s); r.m.material.opacity = Math.max(0, r.life) * 0.6; if (r.life <= 0) r.m.visible = false; }
}

function updateEcosystem(dt) {
    const wind = 0.5 + wx.storm * 2;
    foam.scale.setScalar(1 + Math.sin(time * 0.8) * 0.004); foam.material.opacity = 0.38 + Math.sin(time * 0.8) * 0.14;
    for (const c of clouds) { c.position.x += dt * (1.2 + wind * 2); if (c.position.x > 190) c.position.x = -190; }
    updateCritters(dt); updatePond(dt); updateRipples(dt);
    for (const e of smokeEmit) {
        e.acc += dt * e.rate;
        if (e.acc >= 1) { e.acc -= 1; const p = smokePuffs.find(q => q.life <= 0); if (p) { p.life = 4; p.age = 0; p.m.position.set(e.x + srange(-0.15, 0.15), e.y, e.z + srange(-0.15, 0.15)); p.vx = 0.4 + wind * 0.6; p.vz = srange(-0.1, 0.1); p.m.visible = true; } }
    }
    for (const p of smokePuffs) if (p.life > 0) { p.life -= dt; p.age += dt; p.m.position.x += p.vx * dt; p.m.position.y += 0.9 * dt; p.m.position.z += p.vz * dt; const s = Math.sin(Math.min(1, p.age / 4) * Math.PI) * 0.55 + 0.05; p.m.scale.setScalar(s); if (p.life <= 0) p.m.visible = false; }
}

// =====================================================================
addTgt = null;
//  1.0.1: weather, blood moon, ghost lumberjacks, ambience
// =====================================================================
function isBlood() { return isNight() && save.day % 3 === 0; }
let bmFelled = 0, bmBeat = 0;

const WX_ICON = { clear: "☀", cloudy: "☁", rain: "🌧", storm: "⛈", fog: "🌫" };
const WX_MSG = { clear: "The sky clears.", cloudy: "Clouds roll in...", rain: "It starts to rain.", storm: "A storm is rolling in!", fog: "A thick fog creeps over the island." };
const wx = { type: "clear", t: rand(60, 110), rain: 0, cloud: 0.12, fog: 0, storm: 0, light: 0, nextBolt: 6 };
let swayK = 1, rainGain = null, waveGain = null;
const cGray = new THREE.Color(0x8a94a0), cBlood = new THREE.Color(0x5a0a14), cRed = new THREE.Color(0xff4a4a), cLightning = new THREE.Color(0xd8e4ff), cWhite = new THREE.Color(0xffffff);

function setWeather(type, announce = true) {
    wx.type = type; wx.t = rand(70, 170);
    if (announce) toast(WX_MSG[type], "");
}
function pickWeather() {
    const w = isBlood() ? [["clear", 0.2], ["fog", 0.3], ["cloudy", 0.2], ["storm", 0.3]] : [["clear", 0.38], ["cloudy", 0.26], ["rain", 0.18], ["fog", 0.1], ["storm", 0.08]];
    let r = Math.random();
    for (const [k, p] of w) { r -= p; if (r <= 0) return k === wx.type ? "clear" : k; }
    return "clear";
}
function thunder() { sfx(70, 1.4, "sawtooth", 0.2, 0.25); setTimeout(() => sfx(55, 0.9, "square", 0.12, 0.4), 260); }

const RAIN_N = 650;
const rainPos = new Float32Array(RAIN_N * 6), rainSeed = new Float32Array(RAIN_N * 3);
for (let i = 0; i < RAIN_N; i++) { rainSeed[i * 3] = (Math.random() - 0.5) * 44; rainSeed[i * 3 + 1] = Math.random() * 26 - 4; rainSeed[i * 3 + 2] = (Math.random() - 0.5) * 44; }
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
const rainLines = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaed0ff, transparent: true, opacity: 0.4, fog: false }));
rainLines.frustumCulled = false; rainLines.visible = false;
scene.add(rainLines);
const insideBuilding = () => { const x = player.pos.x, z = player.pos.z; return x > 1500 || (Math.abs(x) < 4.2 && Math.abs(z) < 3.2) || (x > -16.2 && x < -5.8 && z > -17.2 && z < -8.8); };
function updateRain(dt) {
    const on = wx.rain > 0.05 && !insideBuilding();
    rainLines.visible = on;
    if (!on) return;
    rainLines.material.opacity = 0.12 + 0.38 * wx.rain;
    const c = camera.position, fall = 20 + wx.storm * 10, slant = 0.04 + wx.storm * 0.05;
    for (let i = 0; i < RAIN_N; i++) {
        let y = rainSeed[i * 3 + 1] - dt * fall;
        if (y < -4) y += 26;
        rainSeed[i * 3 + 1] = y;
        const x = c.x + rainSeed[i * 3], z = c.z + rainSeed[i * 3 + 2], yy = c.y + y;
        rainPos[i * 6] = x; rainPos[i * 6 + 1] = yy; rainPos[i * 6 + 2] = z;
        rainPos[i * 6 + 3] = x + slant * 14; rainPos[i * 6 + 4] = yy + 0.9; rainPos[i * 6 + 5] = z;
    }
    rainGeo.attributes.position.needsUpdate = true;
}
function updateWeather(dt) {
    wx.t -= dt;
    if (wx.t <= 0) setWeather(pickWeather());
    const T = wx.type, k = Math.min(1, dt * 0.25);
    wx.rain = lerp(wx.rain, T === "rain" ? 0.8 : T === "storm" ? 1 : 0, k);
    wx.cloud = lerp(wx.cloud, T === "clear" ? 0.12 : T === "cloudy" ? 0.7 : 1, k);
    wx.fog = lerp(wx.fog, T === "fog" ? 1 : 0, k);
    wx.storm = lerp(wx.storm, T === "storm" ? 1 : 0, k);
    if (T === "storm") { wx.nextBolt -= dt; if (wx.nextBolt <= 0) { wx.nextBolt = rand(4, 11); wx.light = 1; flash = Math.max(flash, 0.5); setTimeout(thunder, rand(300, 2200)); } }
    wx.light = Math.max(0, wx.light - dt * 4);
    swayK = 1 + wx.storm * 2.2 + wx.rain * 0.6;
    if (rainGain) rainGain.gain.value = wx.rain * 0.05 * (insideBuilding() ? 0.3 : 1);
    updateRain(dt);
}

// ---------- ghost lumberjacks: spectral helpers that really chop the trees and pay you ----------
const ghostObjs = [];
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.6, depthWrite: false });
const ghostDark = new THREE.MeshBasicMaterial({ color: 0x08222e });
const ghostWood = lamb(0x6a4a2a), ghostSteel = new THREE.MeshBasicMaterial({ color: 0xe8f6ff });
function makeGhost(i) {
    const g = new THREE.Group();
    part(g, CONE6, ghostMat, 0, 0.8, 0, 0.55, 1.6, 0.55);
    part(g, ICO, ghostMat, 0, 1.78, 0, 0.3, 0.32, 0.3);
    for (const s of [-1, 1]) part(g, BOX, ghostDark, s * 0.1, 1.82, 0.27, 0.07, 0.1, 0.04);
    const arm = new THREE.Group(); arm.position.set(0.36, 1.35, 0.05);
    part(arm, BOX, ghostWood, 0, 0.3, 0.2, 0.05, 0.7, 0.05, 0.4, 0, 0);
    part(arm, BOX, ghostSteel, 0, 0.62, 0.34, 0.05, 0.2, 0.26);
    g.add(arm); g.userData.arm = arm;
    g.position.set(0, 1.6, -8); scene.add(g);
    return { g, arm, tgt: null, cd: rand(0.3, 1), swing: 0, ph: srand() * 6, i };
}
function syncGhosts() {
    const want = Math.min(save.ghosts, 10);
    while (ghostObjs.length < want) ghostObjs.push(makeGhost(ghostObjs.length));
    while (ghostObjs.length > want) { const o = ghostObjs.pop(); scene.remove(o.g); }
}
function updateGhosts(dt) {
    if (!ghostObjs.length) return;
    ghostMat.opacity = 0.32 + 0.34 * (1 - dayAmt() * 0.5);
    const claimed = new Set(ghostObjs.map(o => o.tgt).filter(Boolean)), mult = Math.max(1, save.ghosts / ghostObjs.length);
    for (const o of ghostObjs) {
        o.ph += dt;
        if (!o.tgt || o.tgt.gone || o.tgt.dying || o.tgt.burn) {
            o.tgt = null;
            let best = null, bd = 70;
            for (const t of trees) {
                if (t.gone || t.dying || t.burn || t.type.flee || claimed.has(t)) continue;
                if (Math.hypot(t.x, t.z) < SAFE_R + 2) continue;
                const d = Math.hypot(t.x - o.g.position.x, t.z - o.g.position.z);
                if (d < bd) { bd = d; best = t; }
            }
            if (best) { o.tgt = best; claimed.add(best); }
        }
        let tx, tz, ty = 1.5 + Math.sin(o.ph * 1.6) * 0.18, speed = 7;
        if (o.tgt) {
            const t = o.tgt, dx = o.g.position.x - t.x, dz = o.g.position.z - t.z, dl = Math.hypot(dx, dz) || 1, off = t.r + 1.7;
            tx = t.x + dx / dl * off; tz = t.z + dz / dl * off;
        } else {
            const a = o.ph * 0.35 + o.i * 1.1, r = 5 + (o.i % 3) * 2;
            tx = Math.cos(a) * r; tz = -8 + Math.sin(a) * r; speed = 4;
        }
        const gx = tx - o.g.position.x, gz = tz - o.g.position.z, gd = Math.hypot(gx, gz), m = Math.min(gd, speed * dt);
        if (gd > 0.05) { o.g.position.x += gx / gd * m; o.g.position.z += gz / gd * m; }
        o.g.position.y += (ty - o.g.position.y) * Math.min(1, 4 * dt);
        if (o.tgt) o.g.rotation.y += angDiff(Math.atan2(o.tgt.x - o.g.position.x, o.tgt.z - o.g.position.z), o.g.rotation.y) * Math.min(1, 8 * dt);
        else if (gd > 0.2) o.g.rotation.y += angDiff(Math.atan2(gx, gz), o.g.rotation.y) * Math.min(1, 4 * dt);
        // chop
        if (o.tgt && gd < 0.9) {
            o.cd -= dt;
            if (o.cd <= 0) {
                o.cd = 1.15; o.swing = 0.35;
                const t = o.tgt, dmg = Math.max(1, Math.round(bestDmg() * 0.5 * mult));
                t.hp -= dmg; t.hurt = 1;
                burst(V3(t.x, Math.min(t.h * 0.3, 1.8), t.z), 4, 3, [new THREE.MeshBasicMaterial({ color: 0x9fe8ff }), chipMats[0]]);
                if (Math.hypot(t.x - player.pos.x, t.z - player.pos.z) < 30) sfx(210, 0.08, "square", 0.04, 0.5);
                if (t.hp <= 0) {
                    t.dying = true; t.t = 0; t.byGhost = true;
                    const pay = Math.round(treeLogs(t) * (logValue() + t.type.bonus * 0.8) * 0.65);
                    save.money += pay; save.ghostCash = (save.ghostCash || 0) + pay; save.ghostFelled = (save.ghostFelled || 0) + 1;
                    floatWorld(V3(t.x, Math.min(t.h * 0.7, 4), t.z), "+$" + pay, "cash");
                    o.tgt = null;
                }
            }
        }
        if (o.swing > 0) { o.swing -= dt; o.arm.rotation.x = Math.sin((1 - Math.max(0, o.swing) / 0.35) * Math.PI) * -2.0; } else o.arm.rotation.x = -0.2 + Math.sin(o.ph * 2) * 0.08;
    }
}

// ---------- ambience: surf, rain, birdsong, crickets, frogs, footsteps ----------
function startAmbience() {
    if (!actx || windGain) return;
    const len = actx.sampleRate * 2, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const mk = (type, freq, gainVal) => {
        const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
        const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
        const g = actx.createGain(); g.gain.value = gainVal;
        src.connect(f).connect(g).connect(actx.destination); src.start();
        return g;
    };
    windGain = mk("lowpass", 360, 0.02);
    waveGain = mk("lowpass", 700, 0.0);
    rainGain = mk("highpass", 1400, 0.0);
}
let birdT = 4, cricketT = 0.3, frogT = 3, gullT = 8, stepAcc = 0, stepSide = 0;
function ambienceTick(dt) {
    if (!actx) return;
    const px = player.pos.x, pz = player.pos.z, night = isNight(), outside = !insideBuilding();
    const near = clamp(1 - (curShoreAt(px, pz) - Math.hypot(px, pz)) / 34, 0, 1);
    if (waveGain) waveGain.gain.value = (0.012 + 0.05 * near * near) * (0.65 + 0.35 * Math.sin(time * 0.45)) * (outside ? 1 : 0.3);
    if (windGain) windGain.gain.value = (0.014 + Math.sin(time * 0.35) * 0.008 + (night ? 0.008 : 0) + wx.storm * 0.03) * (outside ? 1 : 0.4);
    if (!outside) return;
    if (!night && wx.rain < 0.3 && (birdT -= dt) <= 0) { birdT = rand(2.5, 8); const b = rand(2200, 3200); sfx(b, 0.07, "sine", 0.02, 1.5); setTimeout(() => sfx(b * 1.2, 0.06, "sine", 0.018, 1.3), 110); }
    if (night && (cricketT -= dt) <= 0) { cricketT = rand(0.1, 0.22); sfx(4300, 0.025, "sine", 0.008, 1); }
    if (Math.hypot(px - POND.x, pz - POND.z) < 45 && (dayAmt() < 0.6) && (frogT -= dt) <= 0) { frogT = rand(2, 6); sfx(150, 0.12, "square", 0.025, 0.6); setTimeout(() => sfx(180, 0.1, "square", 0.02, 0.6), 160); }
    if (near > 0.7 && !night && (gullT -= dt) <= 0) { gullT = rand(7, 16); sfx(1100, 0.3, "triangle", 0.025, 0.7); }
    if (isBlood()) { bmBeat -= dt; if (bmBeat <= 0) { bmBeat = 1.4; sfx(60, 0.18, "sine", 0.16, 0.6); setTimeout(() => sfx(52, 0.15, "sine", 0.12, 0.6), 190); } }
}
function footsteps(dt) {
    const sp = Math.hypot(player.vel.x, player.vel.z);
    if (!player.onGround || sp < 1.2) { stepAcc = 0; return; }
    stepAcc += sp * dt;
    if (stepAcc < (keys.ShiftLeft ? 3.0 : 2.3)) return;
    stepAcc = 0; stepSide = 1 - stepSide;
    const x = player.pos.x, z = player.pos.z, dx = x - FB.x, dz = z - FB.z, along = dx * FDIR.x + dz * FDIR.z;
    const onDock = along > 4.5 && Math.abs(dx * FPERP.x + dz * FPERP.z) < 2.2;
    const inHouse = insideBuilding(), beach = curShoreAt(x, z) - Math.hypot(x, z) < 12;
    const f = onDock || inHouse ? 150 : beach ? 85 : 110;
    sfx(f + stepSide * 14, onDock || inHouse ? 0.07 : 0.1, onDock || inHouse ? "square" : "triangle", onDock || inHouse ? 0.03 : 0.025, 0.55);
}

// =====================================================================
//  1.0.1: fishing (the pond and the open sea) + the fish journal
// =====================================================================
const RCOL = { common: "#d8d8d8", uncommon: "#7dff9a", rare: "#7fd8ff", epic: "#ff7ad8", junk: "#a08a70" };
const RIDX = { junk: 0, common: 0, uncommon: 1, rare: 2, epic: 3 };
const FISH = {
    pond: [
        { n: "Minnow", r: "common", v: 5, w: [0.05, 0.2], wt: 30 }, { n: "Bluegill", r: "common", v: 9, w: [0.2, 0.9], wt: 22 }, { n: "Carp", r: "common", v: 14, w: [1, 5], wt: 20 },
        { n: "Catfish", r: "uncommon", v: 32, w: [2, 9], wt: 9 }, { n: "Pike", r: "uncommon", v: 40, w: [2, 8], wt: 7 }, { n: "Golden Koi", r: "rare", v: 150, w: [1, 4], wt: 2.2 },
        { n: "Old Boot", r: "junk", v: 1, wt: 6 }, { n: "Message in a Bottle", r: "rare", v: 120, wt: 1.4 },
        { n: "Rain Trout", r: "uncommon", v: 48, w: [1, 4], wt: 9, rain: true }, { n: "Ghost Carp", r: "rare", v: 120, w: [2, 6], wt: 5, night: true }, { n: "Blood Piranha", r: "epic", v: 220, w: [0.5, 2], wt: 8, blood: true }
    ],
    sea: [
        { n: "Sardine", r: "common", v: 6, w: [0.05, 0.3], wt: 30 }, { n: "Mackerel", r: "common", v: 12, w: [0.4, 1.5], wt: 22 }, { n: "Snapper", r: "uncommon", v: 28, w: [1, 6], wt: 12 },
        { n: "Pufferfish", r: "uncommon", v: 40, w: [0.3, 1.5], wt: 8 }, { n: "Tuna", r: "uncommon", v: 60, w: [8, 40], wt: 8 }, { n: "Swordfish", r: "rare", v: 170, w: [20, 90], wt: 2.4 },
        { n: "Old Boot", r: "junk", v: 1, wt: 6 }, { n: "Pearl Oyster", r: "rare", v: 150, wt: 1.4 },
        { n: "Glowing Squid", r: "rare", v: 130, w: [0.5, 3], wt: 5, night: true }, { n: "Storm Eel", r: "uncommon", v: 70, w: [1, 4], wt: 8, storm: true }, { n: "Kraken Tooth", r: "epic", v: 320, wt: 7, blood: true }
    ]
};
const ALL_FISH = [...FISH.pond.map(f => ({ ...f, where: "Pond" })), ...FISH.sea.filter(f => !FISH.pond.some(p => p.n === f.n)).map(f => ({ ...f, where: "Sea" }))];
const rodCost = () => Math.floor(80 * Math.pow(2, save.rodLvl));
const BAG_MAX = 40;

const fishing = { on: false, phase: "", t: 0, spot: null, fish: null, m: 0, dir: 1, zc: 0.5, zw: 0.2, sx: 0, sz: 0, tx: 0, tz: 0, speed: 1 };
const bobber = new THREE.Group(), rodGroup = new THREE.Group();
let fishLine = null;
{
    part(bobber, ICO, new THREE.MeshBasicMaterial({ color: 0xff3a3a }), 0, 0.07, 0, 0.1, 0.1, 0.1);
    part(bobber, ICO, new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, -0.03, 0, 0.09, 0.07, 0.09);
    bobber.visible = false; scene.add(bobber);
    const rod = new THREE.MeshLambertMaterial({ color: 0x8a5a34, flatShading: true });
    part(rodGroup, CYL6, rod, 0, 0.8, 0, 0.012, 1.7, 0.012);
    part(rodGroup, BOX, new THREE.MeshLambertMaterial({ color: 0x2a2230, flatShading: true }), 0, 0.0, 0, 0.08, 0.34, 0.08);
    part(rodGroup, CYL6, new THREE.MeshLambertMaterial({ color: 0xb8c2d8, flatShading: true }), 0.06, 0.18, 0, 0.05, 0.04, 0.05, 0, 0, Math.PI / 2);
    rodGroup.position.set(0.5, -0.62, -0.75); rodGroup.rotation.set(-1.15, 0.12, -0.12); rodGroup.visible = false;
    viewScene.add(rodGroup);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    fishLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    fishLine.frustumCulled = false; fishLine.visible = false; scene.add(fishLine);
}

function fishSpot() {
    if (isle !== 1) return null;
    const px = player.pos.x, pz = player.pos.z, fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const dp = Math.hypot(px - POND.x, pz - POND.z);
    if (dp > 6.4 && dp < 12.5) {
        const dot = ((POND.x - px) * fx + (POND.z - pz) * fz) / dp;
        let tx = px + fx * 6, tz = pz + fz * 6, dd = Math.hypot(tx - POND.x, tz - POND.z);
        if (dd > 5.2) { tx = POND.x + (tx - POND.x) / dd * 5.2; tz = POND.z + (tz - POND.z) / dd * 5.2; }
        return { kind: "pond", blocked: dot < 0.2, tx, tz };
    }
    const dx = px - FB.x, dz = pz - FB.z, along = dx * FDIR.x + dz * FDIR.z, onDock = along > 5 && Math.abs(dx * FPERP.x + dz * FPERP.z) < 2.4;
    if (onDock || shoreAt(px, pz) - Math.hypot(px, pz) < 8) {
        const tx = px + fx * 7, tz = pz + fz * 7, water = Math.hypot(tx, tz) > shoreAt(tx, tz) - 0.8;
        return { kind: "sea", blocked: !water, tx, tz };
    }
    return null;
}
function rollFish(kind) {
    const night = isNight(), rain = wx.rain > 0.3, storm = wx.storm > 0.3, blood = isBlood();
    const pool = FISH[kind].filter(f => (!f.night || night) && (!f.rain || rain) && (!f.storm || storm) && (!f.blood || blood));
    const wts = pool.map(f => f.wt * (RIDX[f.r] >= 1 && f.r !== "junk" ? 1 + 0.35 * save.rodLvl : 1));
    let r = Math.random() * wts.reduce((a, b) => a + b, 0);
    let f = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) { r -= wts[i]; if (r <= 0) { f = pool[i]; break; } }
    const kg = f.w ? +(f.w[0] + Math.pow(Math.random(), 1.6) * (f.w[1] - f.w[0])).toFixed(2) : 0;
    return { f, kg };
}
function startFishing(spot) {
    fishing.on = true; fishing.phase = "cast"; fishing.t = 0.6; fishing.spot = spot; fishing.tx = spot.tx; fishing.tz = spot.tz;
    fishing.sx = player.pos.x; fishing.sz = player.pos.z; fishing.fish = null;
    axe.visible = false; rodGroup.visible = true; bobber.visible = true; fishLine.visible = true;
    bobber.position.set(spot.tx, spot.kind === "pond" ? 0.08 : -0.38, spot.tz);
    sfx(600, 0.18, "sawtooth", 0.04, 0.3);
}
function endFishing() {
    if (!fishing.on) return;
    fishing.on = false; fishing.phase = "";
    axe.visible = true; rodGroup.visible = false; bobber.visible = false; fishLine.visible = false;
    $("fishUI").classList.remove("show");
}
const waterY = () => (fishing.spot && fishing.spot.kind === "pond" ? 0.08 : -0.38);
function splashAt(x, z, n = 8) { burst(V3(x, waterY() + 0.1, z), n, 3, [new THREE.MeshBasicMaterial({ color: 0xcfeaff }), new THREE.MeshBasicMaterial({ color: 0xffffff })]); if (fishing.spot && fishing.spot.kind === "pond") pondRipple(x, z); }
function fishAction() {
    if (!fishing.on) return;
    if (fishing.phase === "wait") { toast("You reel in your line."); endFishing(); }
    else if (fishing.phase === "bite") {
        const roll = rollFish(fishing.spot.kind);
        fishing.fish = roll;
        const ri = RIDX[roll.f.r] + (roll.f.r === "junk" ? 0 : 0), rodW = save.rodLvl * 0.035;
        fishing.speed = 0.9 + ri * 0.4; fishing.zw = clamp(0.24 - ri * 0.035 + rodW, 0.09, 0.34); fishing.zc = rand(0.25, 0.75); fishing.m = Math.random(); fishing.dir = 1;
        fishing.phase = "reel";
        $("fZone").style.left = ((fishing.zc - fishing.zw / 2) * 100) + "%"; $("fZone").style.width = (fishing.zw * 100) + "%";
        $("fishUI").classList.add("show");
        sfx(300, 0.1, "square", 0.05, 1.6);
    } else if (fishing.phase === "reel") {
        const hit = Math.abs(fishing.m - fishing.zc) <= fishing.zw / 2, perfect = Math.abs(fishing.m - fishing.zc) <= fishing.zw * 0.18;
        $("fishUI").classList.remove("show");
        if (hit) catchFish(perfect); else { toast("It got away...", "bad"); sfx(180, 0.25, "sawtooth", 0.05, 0.5); splashAt(fishing.tx, fishing.tz, 6); endFishing(); }
    }
}
function catchFish(perfect) {
    const { f, kg } = fishing.fish;
    let v = f.v;
    if (f.w) v = Math.round(f.v * (0.7 + 0.6 * (kg - f.w[0]) / Math.max(0.001, f.w[1] - f.w[0])));
    v = Math.round(v * (1 + 0.1 * save.rodLvl) * (perfect ? 1.25 : 1) * rebirthMult());
    splashAt(fishing.tx, fishing.tz, 12);
    const first = !(save.fishDex || (save.fishDex = {}))[f.n];
    const d = save.fishDex[f.n] || (save.fishDex[f.n] = { n: 0, best: 0, r: f.r });
    d.n++; d.best = Math.max(d.best, kg);
    if (save.fishBag.length >= BAG_MAX) { save.money += Math.round(v * 0.5); toast(`Fish bag full. Sold the ${f.n} on the spot for half price.`, "bad"); }
    else save.fishBag.push({ n: f.n, k: kg, v });
    $("catchPop").innerHTML = `<small>${perfect ? "PERFECT CATCH!" : "YOU CAUGHT"}${first ? " · NEW!" : ""}</small><b style="color:${RCOL[f.r]}">${f.n}</b><span>${kg ? kg + " kg · " : ""}worth ${money(v)}</span>`;
    $("catchPop").classList.remove("show"); void $("catchPop").offsetWidth; $("catchPop").classList.add("show");
    sfx(520, 0.15, "triangle", 0.08, 2); setTimeout(() => sfx(780, 0.2, "triangle", 0.08, 1.5), 130);
    if (f.r === "rare" || f.r === "epic") { flash = 0.4; setTimeout(() => sfx(1040, 0.3, "triangle", 0.07, 1.3), 260); }
    endFishing();
    writeSave();
}
function sellFish(name) {
    let total = 0, n = 0;
    save.fishBag = save.fishBag.filter(f => { if (name && f.n !== name) return true; total += f.v; n++; return false; });
    if (n) { save.money += total; save.fishSold = (save.fishSold || 0) + n; toast(`Sold ${n} fish for ${money(total)}`, "cash"); sfx(900, 0.12, "triangle", 0.08, 1.5); writeSave(); }
}
const fishPrompt = () => ({ cast: "Casting...", wait: "Waiting for a bite...  [F] reel in", bite: "A BITE!  Press F!", reel: "Hit F when the line is in the green!" }[fishing.phase] || "");
const camLocal = new THREE.Vector3();
function updateFishing(dt) {
    if (!fishing.on) return;
    if (Math.hypot(player.pos.x - fishing.sx, player.pos.z - fishing.sz) > 3.2) { toast("You walked away from your line.", ""); endFishing(); return; }
    fishing.t -= dt;
    const by = waterY();
    if (fishing.phase === "cast" && fishing.t <= 0) {
        fishing.phase = "wait";
        fishing.t = rand(2.5, 7) * (1 - 0.15 * save.rodLvl) * (wx.rain > 0.3 ? 0.7 : 1) * (isBlood() ? 0.8 : 1);
        splashAt(fishing.tx, fishing.tz, 5); sfx(260, 0.12, "sine", 0.05, 0.5);
    } else if (fishing.phase === "wait" && fishing.t <= 0) {
        fishing.phase = "bite"; fishing.t = 1.1 + save.rodLvl * 0.15;
        splashAt(fishing.tx, fishing.tz, 6); sfx(420, 0.12, "sine", 0.07, 0.6); setTimeout(() => sfx(520, 0.1, "sine", 0.06, 0.6), 120);
    } else if (fishing.phase === "bite" && fishing.t <= 0) { toast("It got away...", "bad"); endFishing(); return; }
    else if (fishing.phase === "reel") {
        fishing.m += fishing.dir * fishing.speed * dt;
        if (fishing.m >= 1) { fishing.m = 1; fishing.dir = -1; } else if (fishing.m <= 0) { fishing.m = 0; fishing.dir = 1; }
        $("fMark").style.left = (fishing.m * 100) + "%";
    }
    // the bobber bobs, dips on a bite and shakes while you reel
    const dip = fishing.phase === "bite" ? -0.14 + Math.sin(time * 40) * 0.05 : fishing.phase === "reel" ? Math.sin(time * 26) * 0.04 : Math.sin(time * 2.2) * 0.025;
    bobber.position.set(fishing.tx + (fishing.phase === "reel" ? Math.sin(time * 18) * 0.12 : 0), by + dip, fishing.tz);
    camLocal.set(0.62, -0.28, -1.15);
    const tip = camera.localToWorld(camLocal.clone()), arr = fishLine.geometry.attributes.position.array;
    arr[0] = tip.x; arr[1] = tip.y; arr[2] = tip.z; arr[3] = bobber.position.x; arr[4] = bobber.position.y + 0.1; arr[5] = bobber.position.z;
    fishLine.geometry.attributes.position.needsUpdate = true;
    rodGroup.rotation.x = -1.15 + (fishing.phase === "reel" ? Math.sin(time * 22) * 0.04 : fishing.phase === "bite" ? 0.25 : 0);
}
function renderFishLog() {
    const dex = save.fishDex || {};
    const cards = ALL_FISH.map(f => {
        const d = dex[f.n];
        return d
            ? `<div class="fcard" style="border-color:${RCOL[f.r]}"><div class="big">🐟</div><b style="color:${RCOL[f.r]}">${f.n}</b><small>${f.where} · ${f.r}</small><small>caught ${d.n}${d.best ? " · best " + d.best + " kg" : ""}</small></div>`
            : `<div class="fcard unk"><div class="big">❔</div><b>???</b><small>${f.where}${f.night ? " · night" : f.rain ? " · rain" : f.storm ? " · storm" : f.blood ? " · blood moon" : ""}</small></div>`;
    }).join("");
    const found = ALL_FISH.filter(f => dex[f.n]).length;
    $("fishGrid").innerHTML = cards;
    $("fishCount").textContent = `${found} / ${ALL_FISH.length} species · ${save.fishBag.length} fish in your bag (sell at the Reaper)`;
}


// ---------- the ferry: rebirth ----------
let ferryConfirm = 0;
function openFerry() {
    ferryConfirm = 0;
    $("ferrySay").textContent = "“" + FERRY_QUIPS[Math.floor(Math.random() * FERRY_QUIPS.length)] + "”";
    openPanel("ferry");
}
function renderFerry() {
    if (isle === 2) { renderFerry2(); return; }
    const cost = rebirthCost(), n = (save.rebirths || 0) + 1, can = save.money >= cost;
    const html = `<div class="fprice">Ticket #${n}: <b>${money(cost)}</b> <span>(you have ${money(save.money)})</span></div>
      <div class="flist">
        <div class="lose"><h4>YOU LEAVE BEHIND</h4>cash and logs · every axe except the Rusty one · all shop upgrades · ghost lumberjacks · fish bag · the day count. You can't come back to Pine Island.</div>
        <div class="keep"><h4>YOU KEEP</h4>your Fish Journal · stats and trophies · all your rebirths</div>
        <div class="gain"><h4>YOU GAIN (stacks every rebirth)</h4>★ +50% cash from logs and fish · ★ +10% axe damage · ★ a huge new island with mountains, new trees, GUNS and new upgrades</div>
      </div>`;
    if ($("ferryBody").dataset.h !== html) { $("ferryBody").innerHTML = html; $("ferryBody").dataset.h = html; }
    const b = $("ferryBuy");
    b.disabled = !can;
    b.textContent = !can ? "NEED " + money(cost - save.money) + " MORE" : ferryConfirm ? "CLICK AGAIN TO CONFIRM" : "BUY TICKET  " + money(cost);
    b.classList.toggle("danger", !!ferryConfirm);
}
$("ferryBuy").addEventListener("click", () => {
    if (isle === 2) return;
    if (save.money < rebirthCost()) return;
    if (!ferryConfirm) { ferryConfirm = 1; renderFerry(); setTimeout(() => { ferryConfirm = 0; if (panel === "ferry") renderFerry(); }, 5000); return; }
    doRebirth();
});
function doRebirth() { startRebirthRide(); }

function sellItems() {
    const bag = save.fishBag, total = bag.reduce((a, f) => a + f.v, 0), out = [];
    out.push({ name: `Sell all fish (${bag.length})`, desc: bag.length ? "Everything in your fish bag" : "Nothing to sell yet. Try the pond!", sell: true, value: total, buy() { sellFish(null); } });
    const groups = {};
    bag.forEach(f => { const g = groups[f.n] || (groups[f.n] = { n: f.n, c: 0, v: 0, k: 0 }); g.c++; g.v += f.v; g.k = Math.max(g.k, f.k); });
    Object.values(groups).forEach(g => { const r = ALL_FISH.find(x => x.n === g.n); out.push({ name: `${g.n} x${g.c}`, col: RCOL[r ? r.r : "common"], desc: g.k ? `best ${g.k} kg` : "treasure", sell: true, value: g.v, buy() { sellFish(g.n); } }); });
    return out;
}
syncGhosts();

// =====================================================================
//  REBIRTH: the ferry ride, guns, and the Highland Isle
// =====================================================================
// ---- island 2 terrain: shore, noise, heights ----
const shoreR2 = th => 150 + 14 * Math.sin(2 * th + 1.1) + 9 * Math.sin(3 * th + 0.3) + 6 * Math.sin(5 * th + 2.2);
const shoreAt2 = (x, z) => shoreR2(Math.atan2(z, x));
const hash2 = (ix, iz) => { let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + 1013904223) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const vnoise = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
};
const fbm2 = (x, z, o = 4) => { let a = 0.5, f = 1, s = 0; for (let i = 0; i < o; i++) { s += a * vnoise(x * f + i * 17.3, z * f - i * 9.1); f *= 2; a *= 0.5; } return s; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const LAKE2 = { x: -70, z: 58, r: 15 };
const D2TH = (() => { let b = 0, m = 1e9; for (let i = 0; i < 360; i++) { const th = (i / 360) * Math.PI * 2, r = shoreR2(th); if (r < m) { m = r; b = th; } } return b; })();
const GPEAK = { x: -112, z: -8 };
function terrain2(x, z) {
    const d = Math.hypot(x, z), inside = shoreAt2(x, z) - d;
    if (inside < 5) return Math.max(-3.4, -(5 - inside) * 0.2);
    const n = fbm2(x * 0.0105 + 3.1, z * 0.0105 + 8.7, 4);
    const cs = Math.cos(D2TH), sn = Math.sin(D2TH), along = x * cs + z * sn, lane = along > 0 ? Math.abs(z * cs - x * sn) : d;
    const gp = Math.hypot(x - GPEAK.x, z - GPEAK.z);
    let h = sstep(0.35, 0.64, n) * 48 * sstep(62, 112, d) * sstep(20, 52, lane) + fbm2(x * 0.03, z * 0.03, 3) * 7 * sstep(30, 80, d) + fbm2(x * 0.1, z * 0.1, 2) * 1.5 + 16 * sstep(38, 4, gp);
    h *= sstep(24, 36, d) * sstep(5, 34, inside);
    const ld = Math.hypot(x - LAKE2.x, z - LAKE2.z), lk = sstep(LAKE2.r + 11, LAKE2.r - 1, ld);
    return h * (1 - lk) - lk * 2.8;
}


// ---------- guns ----------
const GUNS = [
    { name: "Old Revolver",       kind: "revolver", dmg: 12,  pel: 1, spread: 0.004, mag: 6,   rate: 0.42, reload: 1.6, range: 80,  auto: false, cost: 3500,   pack: 18,  packCost: 90,   pow: 9,   metal: 0x7a7a86, wood: 0x6a4528, col: "#c0c0d0", muz: -0.52 },
    { name: "Pump Shotgun",       kind: "shotgun",  dmg: 8,   pel: 8, spread: 0.06,  mag: 5,   rate: 0.8,  reload: 2.2, range: 34,  auto: false, cost: 11000,  pack: 20,  packCost: 160,  pow: 26,  metal: 0x4a4a54, wood: 0x7a4a28, col: "#ffb060", muz: -0.85 },
    { name: "Chop-Chop SMG",      kind: "smg",      dmg: 8,   pel: 1, spread: 0.025, mag: 32,  rate: 0.085, reload: 1.9, range: 60, auto: true,  cost: 24000,  pack: 96,  packCost: 300,  pow: 30,  metal: 0x2e3a4a, wood: 0x2a2a30, col: "#7fd8ff", muz: -0.52 },
    { name: "Timber Rifle",       kind: "rifle",    dmg: 120, pel: 1, spread: 0.0015, mag: 5,  rate: 0.95, reload: 2.4, range: 140, auto: false, cost: 48000,  pack: 15,  packCost: 330,  pow: 38,  metal: 0x3a4a3a, wood: 0x8a5a34, col: "#6dffa0", muz: -1.0 },
    { name: "Lumberjack Minigun", kind: "minigun",  dmg: 16,  pel: 1, spread: 0.04,  mag: 150, rate: 0.05, reload: 4.0, range: 70,  auto: true,  cost: 150000, pack: 300, packCost: 1500, pow: 100, metal: 0x6a2a2a, wood: 0x2a1a1a, col: "#ff6a5a", muz: -0.95 }
];
const gunAm = i => save.gunAmmo[i] || (save.gunAmmo[i] = { mag: 0, res: 0 });
const magSize = i => Math.round(GUNS[i].mag * (1 + 0.25 * (save.magLvl || 0)));
const resCap = i => GUNS[i].pack * 6;
const holdingGun = () => save.gunEq >= 0 && !!save.gunOwned[save.gunEq];
const gunDmg = i => Math.round(GUNS[i].dmg * (1 + 0.1 * (save.rebirths || 0)) * (1 + 0.1 * (save.powderLvl || 0)));
const gun = new THREE.Group();
gun.visible = false;
viewScene.add(gun);
const gunFlash = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
gunFlash.visible = false;
gun.add(gunFlash);
const gunLight = new THREE.PointLight(0xffc060, 0, 5, 1.5);
viewScene.add(gunLight);
let gunCd = 0, gunKick = 0, gunFlashT = 0, reloadT = 0, reloading = false, fireLatch = false, builtGun = -2;
function buildGunModel(i) {
    builtGun = i;
    for (const c of [...gun.children]) if (c !== gunFlash) gun.remove(c);
    gunParts(i, gun, true);
    gunFlash.position.set(0, 0.03, GUNS[i].muz - 0.04);
}
function gunParts(i, grp, hands) {
    const G = GUNS[i], mt = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const metal = mt(G.metal), wd = mt(G.wood), dark = mt(0x16161c), glove = mt(0x2a2230);
    const gb = (w, h, d, x, y, z, m, rx = 0) => { const o = new THREE.Mesh(BOX, m); o.scale.set(w, h, d); o.position.set(x, y, z); o.rotation.x = rx; grp.add(o); return o; };
    const gc = (r, len, x, y, z, m) => { const g = new THREE.CylinderGeometry(r, r, len, 7); g.rotateX(Math.PI / 2); const o = new THREE.Mesh(g, m); o.position.set(x, y, z); grp.add(o); return o; };
    gb(0.075, 0.11, 0.34, 0, 0, -0.05, metal);
    gb(0.055, 0.17, 0.08, 0, -0.13, 0.1, wd, 0.3);
    if (hands) gb(0.095, 0.09, 0.11, 0, -0.2, 0.12, glove);
    if (G.kind === "revolver") { gc(0.022, 0.34, 0, 0.03, -0.34, metal); gc(0.058, 0.13, 0, 0, -0.07, metal); gb(0.05, 0.03, 0.05, 0, 0.075, -0.2, dark); }
    else if (G.kind === "shotgun") { gc(0.03, 0.62, 0, 0.035, -0.5, metal); gc(0.025, 0.5, 0, -0.02, -0.46, metal); gb(0.075, 0.07, 0.22, 0, -0.04, -0.45, wd); gb(0.06, 0.12, 0.3, 0, -0.03, 0.28, wd); }
    else if (G.kind === "smg") { gc(0.022, 0.26, 0, 0.025, -0.32, metal); gb(0.05, 0.23, 0.07, 0, -0.2, -0.08, dark, 0.1); gb(0.045, 0.1, 0.22, 0, -0.02, 0.22, dark); gb(0.03, 0.03, 0.05, 0, 0.075, -0.3, dark); }
    else if (G.kind === "rifle") { gc(0.024, 0.78, 0, 0.03, -0.62, metal); gb(0.065, 0.13, 0.34, 0, -0.03, 0.3, wd); gc(0.03, 0.26, 0, 0.115, -0.08, dark); gc(0.04, 0.05, 0, 0.115, -0.22, glove); }
    else { for (let k = 0; k < 6; k++) { const a = k * 1.047; gc(0.016, 0.62, Math.cos(a) * 0.045, 0.02 + Math.sin(a) * 0.045, -0.5, metal); } gb(0.14, 0.15, 0.3, 0, 0, -0.08, metal); gc(0.1, 0.2, 0, -0.17, -0.06, dark); gb(0.05, 0.05, 0.3, 0, 0.1, -0.08, dark); }
    if (hands) gb(0.095, 0.09, 0.12, 0, -0.07, -0.34, glove);
}
const tracers = [];
{
    const lm = new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.9, fog: false });
    for (let i = 0; i < 14; i++) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)); const l = new THREE.Line(g, lm.clone()); l.visible = false; l.frustumCulled = false; scene.add(l); tracers.push({ l, life: 0 }); }
}
const camRight = new THREE.Vector3(), gdir = new THREE.Vector3();
function addTracer(from, to) {
    const t = tracers.find(q => q.life <= 0) || tracers[0];
    const a = t.l.geometry.attributes.position;
    a.setXYZ(0, from.x, from.y, from.z); a.setXYZ(1, to.x, to.y, to.z); a.needsUpdate = true;
    t.life = 0.07; t.l.visible = true;
}
function equipGun(i) {
    if (!save.gunOwned[i]) return;
    save.gunEq = i; swing.t = 1; reloading = false; reloadT = 0; gunCd = 0.25;
    addToHotbar("g" + i);
    if (builtGun !== i) buildGunModel(i);
    sfx(300, 0.12, "square", 0.08, 1.5); sfx(180, 0.1, "triangle", 0.08, 1.2);
    toast(`Drew ${GUNS[i].name}`);
}
function startReload() {
    if (!holdingGun() || reloading) return;
    const i = save.gunEq, am = gunAm(i);
    if (am.mag >= magSize(i)) return;
    if (am.res <= 0) { toast("Out of ammo. Buy more from the Gunsmith.", "bad"); sfx(120, 0.12, "square", 0.07, 0.6); return; }
    reloading = true; reloadT = 0;
    sfx(240, 0.08, "square", 0.06, 0.6);
}
function finishReload() {
    const i = save.gunEq, am = gunAm(i), take = Math.min(magSize(i) - am.mag, am.res);
    am.mag += take; am.res -= take; reloading = false;
    sfx(520, 0.06, "square", 0.07, 1.4); sfx(300, 0.1, "triangle", 0.07, 0.8);
}
// ray vs. the trees: closest approach to the vertical trunk line
function rayTree(o, d, range) {
    const hl = Math.hypot(d.x, d.z);
    if (hl < 1e-5) return null;
    let best = null, bs = range;
    for (const t of trees) {
        if (t.gone || t.dying || t.burn) continue;
        const dx = t.x - o.x, dz = t.z - o.z;
        const s = (dx * d.x + dz * d.z) / (hl * hl);
        if (s <= 0.2 || s >= bs) continue;
        const perp = Math.abs(dx * d.z - dz * d.x) / hl, y = o.y + d.y * s, rel = (y - t.gy) / t.h;
        if (rel < -0.05 || rel > 1.08) continue;
        const R = rel < 0.55 ? t.r + 0.22 : t.r * (3.4 - 2.6 * rel) + 0.2;
        if (perp > R) continue;
        bs = s; best = t;
    }
    return best ? { t: best, s: bs } : null;
}
function fireGun() {
    const i = save.gunEq, G = GUNS[i], am = gunAm(i);
    if (reloading) return;
    if (am.mag <= 0) { if (am.res > 0) startReload(); else { toast("Out of ammo. Buy more from the Gunsmith.", "bad"); sfx(120, 0.1, "square", 0.06, 0.6); gunCd = 0.4; } return; }
    am.mag--; gunCd = G.rate; gunKick = 1; gunFlashT = 0.05;
    camera.getWorldDirection(gdir);
    camRight.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    const mz = V3(camera.position.x, camera.position.y - 0.25, camera.position.z).addScaledVector(camRight, 0.28).addScaledVector(gdir, 0.9);
    const dmg = gunDmg(i), hits = new Map();
    for (let p = 0; p < G.pel; p++) {
        const d = gdir.clone();
        d.x += (Math.random() - 0.5) * 2 * G.spread; d.y += (Math.random() - 0.5) * 2 * G.spread; d.z += (Math.random() - 0.5) * 2 * G.spread;
        d.normalize();
        const hit = rayTree(camera.position, d, G.range);
        const end = hit ? V3(camera.position.x + d.x * hit.s, camera.position.y + d.y * hit.s, camera.position.z + d.z * hit.s) : V3(camera.position.x + d.x * G.range, camera.position.y + d.y * G.range, camera.position.z + d.z * G.range);
        if (p < 4 || G.pel === 1) addTracer(mz, end);
        if (hit) hits.set(hit.t, (hits.get(hit.t) || 0) + 1);
    }
    for (const [t, n] of hits) hitTree(t, dmg * n, false);
    shake = Math.min(0.6, shake + (G.kind === "minigun" ? 0.03 : 0.12)); fovKick = Math.max(fovKick, 0.4);
    const big = G.kind === "shotgun" || G.kind === "rifle";
    sfx(big ? 90 : 140, big ? 0.22 : 0.1, "sawtooth", big ? 0.22 : 0.13, 0.25);
    sfx(big ? 1400 : 900, 0.05, "square", 0.08, 0.2);
    if (am.mag === 0 && am.res > 0) setTimeout(() => { if (holdingGun() && gunAm(save.gunEq).mag === 0) startReload(); }, 250);
}
function updateGun(dt) {
    gunCd -= dt;
    if (reloading) { reloadT += dt / GUNS[save.gunEq].reload; if (reloadT >= 1) finishReload(); }
    if (!mouseDown) fireLatch = false;
    if (mouseDown && !panel && !fishing.on && !ride && gunCd <= 0 && !reloading) {
        const G = GUNS[save.gunEq];
        if (G.auto || !fireLatch) { fireLatch = true; fireGun(); }
    }
    for (const t of tracers) if (t.life > 0) { t.life -= dt; t.l.material.opacity = Math.max(0, t.life / 0.07) * 0.9; if (t.life <= 0) t.l.visible = false; }
}
function animateGun(dt) {
    gunKick = Math.max(0, gunKick - dt * 9);
    gunFlashT = Math.max(0, gunFlashT - dt);
    gunFlash.visible = gunFlashT > 0; gunFlash.scale.setScalar(0.7 + Math.random() * 0.8);
    gunLight.intensity = gunFlashT > 0 ? 5 : 0;
    const sp = Math.hypot(player.vel.x, player.vel.z), bob = Math.sin(player.bob) * 0.012 * Math.min(1, sp / 5);
    const u = reloading ? reloadT : 0, rl = Math.sin(u * Math.PI);
    gun.position.set(0.3, -0.27 + bob - rl * 0.18, -0.62 + gunKick * 0.07);
    gun.rotation.set(gunKick * 0.14 + rl * 0.7, -0.03 - rl * 0.25, rl * 0.3);
    const G = GUNS[save.gunEq] || GUNS[0];
    gunLight.position.set(0.3, -0.2, -0.62 + G.muz);
}


// ---------- materials: on the Highland Isle every kind of tree drops something different ----------
const MATS = {
    wood:      { name: "Wood",      col: "#d09a5a", price: 6,   hex: 0x9a6a3a },
    stone:     { name: "Stone",     col: "#b8b8c4", price: 8,   hex: 0x8a8a96 },
    copper:    { name: "Copper",    col: "#ff9a5a", price: 14,  hex: 0xd0763a },
    iron:      { name: "Iron",      col: "#a9c0dc", price: 22,  hex: 0x8a9ab0 },
    gunpowder: { name: "Gunpowder", col: "#ff6a6a", price: 25,  hex: 0x2a2228 },
    gold:      { name: "Gold",      col: "#ffd040", price: 60,  hex: 0xffc830 },
    crystal:   { name: "Crystal",   col: "#7affef", price: 120, hex: 0x6dffe0 },
    magma:     { name: "Magma",     col: "#ff7a3a", price: 160, hex: 0xff5a1a }
};
const matPrice = k => Math.round(MATS[k].price * rebirthMult() * (1 + 0.15 * (save.priceLvl || 0)));
const hasMats = r => Object.entries(r).every(([k, n]) => (save.mats[k] || 0) >= n);
function payMats(r) { for (const [k, n] of Object.entries(r)) save.mats[k] -= n; }
const matMeshMat = {};
for (const [k, M] of Object.entries(MATS)) matMeshMat[k] = new THREE.MeshLambertMaterial({ color: M.hex, flatShading: true, emissive: k === "gold" || k === "crystal" || k === "magma" ? M.hex : 0x000000, emissiveIntensity: 0.35 });
const matGeo = new THREE.IcosahedronGeometry(0.28, 0);

// what you craft at the Forge
const AXE_RECIPES = [
    null,
    { wood: 8, stone: 6 },
    { wood: 12, stone: 10, copper: 4 },
    { wood: 16, iron: 6, copper: 6 },
    { stone: 30, iron: 12, gold: 2 },
    { iron: 22, gold: 5, gunpowder: 8 },
    { iron: 30, gold: 8, crystal: 4 },
    { iron: 40, gold: 12, crystal: 8, magma: 2 },
    { iron: 60, gold: 18, crystal: 14 },
    { iron: 80, gold: 25, magma: 16 },
    { iron: 120, gold: 40, crystal: 30, magma: 30 }
];
const GUN_RECIPES = [
    { wood: 10, iron: 8, gunpowder: 4 },
    { wood: 20, iron: 16, gunpowder: 10 },
    { iron: 30, copper: 16, gunpowder: 18 },
    { wood: 30, iron: 45, gold: 6, gunpowder: 24 },
    { iron: 140, gold: 40, gunpowder: 70, magma: 14 }
];
const AMMO_RECIPES = [{ copper: 2, gunpowder: 1 }, { copper: 3, gunpowder: 3 }, { copper: 5, gunpowder: 4 }, { copper: 4, gunpowder: 3 }, { copper: 16, gunpowder: 12 }];
function axeCraftItems() {
    const out = [];
    AXES.forEach((a, i) => {
        if (i === 0) return;
        out.push({ name: a.name, icon: "a" + i, col: a.rarity, desc: `${Math.round(a.dmg * (1 + 0.1 * (save.rebirths || 0)))} damage per swing${a.night ? " (x1.5 at night)" : ""}`, craft: AXE_RECIPES[i], owned: !!save.owned[i], axe: i, buy() { gainAxe(i); } });
    });
    return out;
}
function gunCraftItems() {
    return GUNS.map((g, i) => ({ name: g.name, icon: "g" + i, col: g.col, desc: `${g.pel > 1 ? g.pel + " pellets × " : ""}${gunDmg(i)} dmg · ${g.auto ? "full auto" : "semi-auto"} · ${g.mag} rounds · ${g.range}m range. Comes with ${g.pack} rounds.`, craft: GUN_RECIPES[i], owned: !!save.gunOwned[i], gun: i, buy() { save.gunOwned[i] = 1; const am = gunAm(i); am.mag = magSize(i); am.res = g.pack; equipGun(i); } }));
}
function ammoCraftItems() {
    const out = [];
    GUNS.forEach((g, i) => {
        if (!save.gunOwned[i]) return;
        const am = gunAm(i);
        out.push({ name: g.name + " ammo", icon: "g" + i, col: g.col, desc: `+${g.pack} rounds · you have ${am.mag} + ${am.res} (max ${resCap(i)} spare)`, craft: AMMO_RECIPES[i], maxed: am.res >= resCap(i), buy() { am.res = Math.min(resCap(i), am.res + g.pack); if (holdingGun() && save.gunEq === i && am.mag === 0) startReload(); } });
    });
    if (!out.length) out.push({ name: "No guns yet", desc: "Craft a gun first. Then bring Copper and Gunpowder here to make bullets.", sell: true, value: 0, buy() {} });
    return out;
}
function tradeItems() {
    const out = [], ks = Object.keys(MATS).filter(k => (save.mats[k] || 0) > 0);
    const total = ks.reduce((a, k) => a + save.mats[k] * matPrice(k), 0);
    out.push({ name: "Sell everything", desc: ks.length ? "Every material you're carrying. Careful: you need them to craft!" : "You have nothing to sell. Go chop some trees.", sell: true, value: total, buy() { for (const k of ks) sellMat(k, save.mats[k], true); if (total) { toast(`Sold everything for +${money(total)}`, "cash"); writeSave(); } } });
    for (const k of Object.keys(MATS)) {
        const n = save.mats[k] || 0;
        out.push({ name: `${MATS[k].name} ×${n}`, icon: "m:" + k, col: MATS[k].col, desc: `$${matPrice(k)} each · click sells ALL`, sell: true, value: n * matPrice(k), buy() { if (n) { sellMat(k, n); writeSave(); } } });
    }
    return out;
}
function sellMat(k, n, quiet) {
    if (!n) return;
    const v = n * matPrice(k);
    save.mats[k] -= n; save.money += v; save.sold += n;
    contractProgress("sell", n);
    if (!quiet) toast(`Sold ${n} ${MATS[k].name} for +${money(v)}`, "cash");
    sfx(900, 0.1, "triangle", 0.09, 1.4); setTimeout(() => sfx(1200, 0.12, "triangle", 0.08, 1.4), 90);
}

// ---------- item pictures: every axe, gun and material is rendered from its real 3D model ----------
const iconR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
iconR.setSize(96, 96, false);
iconR.setClearColor(0x000000, 0);
const iconScene = new THREE.Scene(), iconCam = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
iconScene.add(new THREE.AmbientLight(0xffffff, 1.3));
{ const d = new THREE.DirectionalLight(0xffffff, 2.4); d.position.set(1, 2, 2.5); iconScene.add(d); const d2 = new THREE.DirectionalLight(0x9fb0ff, 0.9); d2.position.set(-2, -1, 1); iconScene.add(d2); }
const iconCache = {};
const icM = (c, e = 0) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, emissive: e });
function axeModel(i) {
    const a = AXES[i], g = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.15, 6), icM(0x8a5a34)); handle.position.y = 0.36; g.add(handle);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), icM(0x6a4228)); knob.position.y = -0.22; g.add(knob);
    const sh = new THREE.Shape();
    sh.moveTo(-0.08, 0.0); sh.lineTo(-0.08, 0.27); sh.lineTo(0.03, 0.29); sh.lineTo(0.2, 0.38); sh.quadraticCurveTo(0.31, 0.16, 0.19, -0.1); sh.lineTo(0.04, 0.02); sh.closePath();
    const hg = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 });
    hg.translate(0, 0, -0.0175);
    const head = new THREE.Mesh(hg, [icM(a.steel, a.glow), icM(a.edge, a.glow)]);
    head.position.y = 0.6; head.scale.setScalar(a.scale); g.add(head);
    g.rotation.z = -0.75;
    return g;
}
function propModel(key) {
    const g = new THREE.Group(), add = (geo, m, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(rx, ry, rz); g.add(o); return o; };
    if (key === "logs") { for (const [x, y] of [[-0.3, 0], [0.3, 0], [0, 0.5]]) { add(CYL8, icM(0x8a5a34), x, y, 0, 0.28, 1.4, 0.28, Math.PI / 2, 0.3, 0); add(CYL8, icM(0xe0b070), x, y, 0.71, 0.24, 0.02, 0.24, Math.PI / 2); } g.rotation.y = 0.5; }
    else if (key === "bandage") { add(CYL8, icM(0xf2ece0), 0, 0, 0, 0.5, 0.5, 0.5, Math.PI / 2); add(BOX, icM(0xe02a2a), 0, 0, 0.26, 0.12, 0.42, 0.02); add(BOX, icM(0xe02a2a), 0, 0, 0.26, 0.42, 0.12, 0.02); g.rotation.set(0.4, 0.5, 0); }
    else if (key === "lantern") { add(BOX, icM(0x2a2a30), 0, 0.45, 0, 0.5, 0.1, 0.5); add(BOX, icM(0x2a2a30), 0, -0.35, 0, 0.55, 0.12, 0.55); add(BOX, icM(0xffb040, 0xff9020), 0, 0.05, 0, 0.36, 0.7, 0.36); add(new THREE.TorusGeometry(0.18, 0.03, 4, 10), icM(0x2a2a30), 0, 0.62, 0); g.rotation.y = 0.6; }
    else if (key === "cash") { for (let k = 0; k < 4; k++) add(BOX, icM(k % 2 ? 0x3aa05a : 0x4ab86a), (k % 2) * 0.06, k * 0.12, 0, 1, 0.1, 0.55); add(BOX, icM(0xe8d870), 0.03, 0.2, 0, 0.12, 0.42, 0.57); g.rotation.set(0.5, 0.6, 0); }
    else if (key === "fish") { add(ICO, icM(0x5a9ad0), 0, 0, 0, 0.32, 0.22, 0.75); add(CONE6, icM(0x4a80b0), 0, 0, -0.85, 0.25, 0.4, 0.06, -Math.PI / 2); g.rotation.set(0.2, 1.2, 0); }
    else if (key.startsWith("m:")) {
        const k = key.slice(2), m = icM(MATS[k].hex, k === "gold" || k === "crystal" || k === "magma" ? MATS[k].hex : 0);
        if (m.emissive) m.emissiveIntensity = 0.3;
        if (k === "wood") { add(CYL8, icM(0x8a5a34), 0, 0, 0, 0.32, 1.2, 0.32, Math.PI / 2, 0.4, 0); add(CYL8, icM(0xe0b070), Math.sin(0.4) * 0.61, 0, Math.cos(0.4) * 0.61, 0.28, 0.02, 0.28, Math.PI / 2, 0.4, 0); }
        else if (k === "stone") { add(ICO, m, 0, 0, 0, 0.55, 0.42, 0.5, 0.3, 0.4); add(ICO, icM(0x6a6a74), 0.45, -0.15, 0.2, 0.3, 0.25, 0.3); }
        else if (k === "copper" || k === "iron" || k === "gold") { const tg = new THREE.CylinderGeometry(0.42, 0.62, 0.3, 4); tg.rotateY(Math.PI / 4); add(tg, m, 0, 0, 0, 1, 1, 0.55); add(tg, m, 0.12, 0.32, 0.02, 0.9, 1, 0.5); g.rotation.set(0.35, 0.5, 0); }
        else if (k === "gunpowder") { add(CONE6, m, 0, 0, 0, 0.7, 0.55, 0.7); for (let s = 0; s < 6; s++) add(BOX, icM(0xff4a3a, 0xff2a1a), Math.cos(s) * 0.3, -0.05 + (s % 3) * 0.08, Math.sin(s) * 0.3, 0.06); add(CYL8, icM(0x6a4a2a), -0.5, -0.1, 0.3, 0.25, 0.5, 0.25); }
        else if (k === "crystal") { add(CONE6, m, 0, 0.2, 0, 0.3, 1.2, 0.3); add(CONE6, m, 0.3, 0, 0.1, 0.18, 0.7, 0.18, 0, 0, -0.5); add(CONE6, m, -0.28, -0.05, 0, 0.16, 0.6, 0.16, 0, 0, 0.5); }
        else { add(ICO, m, 0, 0, 0, 0.55); add(ICO, icM(0x3a1a10), 0.3, 0.25, 0.3, 0.25); }
    }
    return g;
}
function gunModel(i) { const g = new THREE.Group(); gunParts(i, g, false); g.rotation.set(0.25, Math.PI / 2 + 0.35, 0); return g; }
const icBox = new THREE.Box3(), icC = new THREE.Vector3(), icS = new THREE.Vector3();
function iconURL(id) {
    if (iconCache[id]) return iconCache[id];
    const o = id[0] === "a" && /^a\d+$/.test(id) ? axeModel(+id.slice(1)) : /^g\d+$/.test(id) ? gunModel(+id.slice(1)) : propModel(id);
    const wrap = new THREE.Group(); wrap.add(o); iconScene.add(wrap);
    wrap.updateMatrixWorld(true);
    icBox.setFromObject(wrap); icBox.getCenter(icC); icBox.getSize(icS);
    const r = Math.max(icS.x, icS.y, icS.z) * 0.62;
    iconCam.position.set(icC.x, icC.y, icC.z + r / Math.tan((iconCam.fov / 2) * Math.PI / 180) + icS.z * 0.5);
    iconCam.lookAt(icC);
    iconR.render(iconScene, iconCam);
    iconCache[id] = iconR.domElement.toDataURL();
    iconScene.remove(wrap);
    return iconCache[id];
}

// ---------- the hotbar: 5 slots you fill by dragging weapons in the inventory ----------
const matAcc = {}, matAccN = () => Object.keys(matAcc).length;
const weaponSlots = () => { ensureHotbar(); return save.hotbar; };
function equipSlot(k) { ensureHotbar(); const id = save.hotbar[k]; if (id) wEquip(id); }
function cycleWeapon(dir) {
    ensureHotbar();
    const l = save.hotbar.filter(Boolean); if (l.length < 2) return;
    const cur = l.findIndex(wEquipped);
    wEquip(l[(cur + dir + l.length) % l.length]);
}

// ---------- island 2: the Highland Isle ----------
const D2DIR = V3(Math.cos(D2TH), 0, Math.sin(D2TH)), D2PERP = V3(-D2DIR.z, 0, D2DIR.x), D2SHORE = shoreR2(D2TH), D2LEN = 24;
const D2B = V3(D2DIR.x * (D2SHORE - 8), 0, D2DIR.z * (D2SHORE - 8));
const dock2Pt = (a, s = 0, y = 0) => V3(D2B.x + D2DIR.x * a + D2PERP.x * s, y, D2B.z + D2DIR.z * a + D2PERP.z * s);
const FERRYMAN2 = { x: dock2Pt(D2LEN - 3.5, -0.9).x, z: dock2Pt(D2LEN - 3.5, -0.9).z };
const BED2 = { x: -8, z: 7 };
const DEPOT = { x: 11, z: -7 }, SMITH = { x: -11, z: -7 };
const standPt = (p, dist = 2.4) => { const r = Math.atan2(-p.x, -p.z); return { x: p.x + Math.sin(r) * dist, z: p.z + Math.cos(r) * dist }; };
const DEPOT_AT = standPt(DEPOT), SMITH_AT = standPt(SMITH);
const LM2 = [
    { name: "BASECAMP", x: 0, z: 0, r: 24, col: "#ffb060", camp: true },
    { name: "HIGHLAND LAKE", x: LAKE2.x, z: LAKE2.z, r: LAKE2.r + 4, col: "#7fd8ff" },
    { name: "CRYSTAL GROVE", x: -68, z: -56, r: 12, col: "#7affef" },
    { name: "GOLDEN PEAK", x: GPEAK.x, z: GPEAK.z, r: 10, col: "#ffd040" },
    { name: "RUINED TEMPLE", x: 58, z: -80, r: 11, col: "#ffd080" },
    { name: "OLD MINE", x: 28, z: -56, r: 9, col: "#c0a080" },
    { name: "HUNTER'S LODGE", x: 58, z: -14, r: 9, col: "#ff9a6a" }
];
function curLM() { return isle === 2 ? LM2 : LANDMARKS; }
let isle2Built = false, altar2 = null, ferry2 = null, ferryman2 = null, ferryBoat2 = null, smithMesh = null, clerkMesh = null, mapBg2 = null;
const treeTarget = () => (isle === 2 ? (isBlood() ? 125 : 90) : (isBlood() ? 82 : 60));

function npcFaceTex(kind) {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 140;
    const g = cv.getContext("2d");
    const eye = (x, y, look = 0) => { g.fillStyle = "#fff"; g.fillRect(x - 9, y - 6, 18, 12); g.fillStyle = kind === "smith" ? "#3a2210" : "#2a5a8a"; g.fillRect(x - 4 + look, y - 5, 8, 10); g.fillStyle = "#000"; g.fillRect(x - 2 + look, y - 3, 4, 6); };
    if (kind === "smith") {
        g.fillStyle = "rgba(40,30,30,.35)"; g.fillRect(14, 30, 30, 14); g.fillRect(86, 70, 22, 10); // soot
        eye(40, 56); eye(88, 56);
        g.fillStyle = "#3a1a0a"; g.save(); g.translate(40, 42); g.rotate(0.18); g.fillRect(-16, -5, 32, 9); g.restore(); g.save(); g.translate(88, 42); g.rotate(-0.18); g.fillRect(-16, -5, 32, 9); g.restore();
        g.fillStyle = "#5a2a12"; g.fillRect(30, 82, 68, 12); g.fillRect(22, 92, 84, 48); // bushy beard + moustache
        g.fillStyle = "#7a3a1a"; for (let i = 0; i < 14; i++) g.fillRect(24 + (i * 6) % 80, 96 + (i * 7) % 40, 4, 8);
        g.fillStyle = "#2a0a04"; g.fillRect(50, 98, 28, 6);
    } else {
        g.fillStyle = "rgba(255,120,120,.35)"; g.fillRect(16, 70, 20, 12); g.fillRect(92, 70, 20, 12); // rosy cheeks
        eye(40, 58, 1); eye(88, 58, 1);
        g.strokeStyle = "#222"; g.lineWidth = 4; g.strokeRect(26, 46, 28, 24); g.strokeRect(74, 46, 28, 24); g.beginPath(); g.moveTo(54, 56); g.lineTo(74, 56); g.stroke(); // glasses
        g.fillStyle = "#6a3a1a"; g.fillRect(28, 36, 24, 6); g.fillRect(76, 36, 24, 6);
        g.fillStyle = "#6a3a1a"; g.beginPath(); g.moveTo(34, 98); g.quadraticCurveTo(64, 82, 94, 98); g.lineTo(94, 92); g.quadraticCurveTo(64, 80, 34, 92); g.fill(); // moustache
        g.strokeStyle = "#5a1a10"; g.lineWidth = 4; g.beginPath(); g.arc(64, 98, 16, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}
// a proper little person: legs, boots, torso, two swinging arms, a head with a face, hair, beard and hat
const npcs = [];
function makeHumanoid(o) {
    const g = new THREE.Group(), sk = lamb(o.skin), sh = lamb(o.shirt), pa = lamb(o.pants), bo = lamb(0x2a1a12), W = o.wide || 1;
    const box = (par, m, x, y, z, sx, sy, sz) => part(par, BOX, m, x, y, z, sx, sy, sz);
    for (const sd of [-1, 1]) { box(g, pa, sd * 0.15 * W, 0.48, 0, 0.24 * W, 0.86, 0.26); box(g, bo, sd * 0.15 * W, 0.09, 0.05, 0.27 * W, 0.18, 0.36); }
    box(g, lamb(0x2a1a12), 0, 0.93, 0, 0.6 * W, 0.1, 0.32);
    const torso = new THREE.Group(); torso.position.y = 0.95; g.add(torso);
    box(torso, sh, 0, 0.38, 0, 0.62 * W, 0.74, 0.36);
    if (o.belly) part(torso, ICO, sh, 0, 0.26, 0.1, 0.34 * W, 0.3, 0.26);
    if (o.apron) { box(torso, lamb(o.apron), 0, 0.2, 0.2, 0.52 * W, 0.92, 0.04); box(torso, lamb(o.apron), 0, 0.62, 0.19, 0.36 * W, 0.3, 0.03); }
    if (o.vest) for (const sd of [-1, 1]) box(torso, lamb(o.vest), sd * 0.17 * W, 0.38, 0.185, 0.24 * W, 0.72, 0.03);
    box(torso, sk, 0, 0.8, 0, 0.16, 0.14, 0.16);
    const arms = [];
    for (const sd of [-1, 1]) {
        const p = new THREE.Group(); p.position.set(sd * (0.39 * W + 0.03), 0.66, 0);
        box(p, sh, 0, -0.27, 0, 0.19, 0.56, 0.21); box(p, sk, 0, -0.62, 0, 0.17, 0.18, 0.19);
        torso.add(p); arms.push(p);
    }
    const head = new THREE.Group(); head.position.set(0, 1.12, 0); torso.add(head);
    box(head, sk, 0, 0.0, 0, 0.44, 0.48, 0.42);
    box(head, sk, 0, -0.02, 0.24, 0.08, 0.11, 0.07);
    for (const sd of [-1, 1]) box(head, sk, sd * 0.23, 0, 0, 0.05, 0.12, 0.09);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.48), new THREE.MeshBasicMaterial({ map: npcFaceTex(o.face), transparent: true })); face.position.z = 0.214; head.add(face);
    if (o.hair) { box(head, lamb(o.hair), 0, 0.22, -0.02, 0.47, 0.1, 0.46); box(head, lamb(o.hair), 0, 0.04, -0.2, 0.47, 0.4, 0.08); for (const sd of [-1, 1]) box(head, lamb(o.hair), sd * 0.225, 0.1, -0.05, 0.04, 0.22, 0.3); }
    if (o.beard) { box(head, lamb(o.beard), 0, -0.24, 0.12, 0.44, 0.18, 0.2); box(head, lamb(o.beard), 0, -0.38, 0.15, 0.32, 0.16, 0.14); }
    if (o.hat === "cap") { part(head, CYL8, lamb(o.hatCol), 0, 0.28, 0, 0.25, 0.14, 0.25); box(head, lamb(o.hatCol), 0, 0.22, 0.28, 0.42, 0.03, 0.22); }
    if (o.hat === "mask") { const m = box(head, lamb(0x2a2a32), 0, 0.3, 0.06, 0.48, 0.26, 0.08); m.rotation.x = -1.1; const v = box(head, new THREE.MeshBasicMaterial({ color: 0x3a8ac0 }), 0, 0.34, 0.12, 0.3, 0.06, 0.02); v.rotation.x = -1.1; box(head, lamb(0x2a2a32), 0, 0.2, 0, 0.47, 0.06, 0.45); }
    return { g, head, torso, armL: arms[0], armR: arms[1], kind: o.face, ph: Math.random() * 6, swing: 0, cyc: 0 };
}
function updateNpcs(dt) {
    for (const p of npcs) {
        p.g.getWorldPosition(p.wp || (p.wp = new THREE.Vector3()));
        const dx = player.pos.x - p.wp.x, dz = player.pos.z - p.wp.z, d = Math.hypot(dx, dz);
        const want = d < 14 ? clamp(angDiff(Math.atan2(dx, dz), p.yaw), -1.0, 1.0) : 0;
        p.head.rotation.y += (want - p.head.rotation.y) * Math.min(1, 4 * dt);
        p.torso.scale.y = 1 + Math.sin(time * 2 + p.ph) * 0.015;
        if (p.kind === "smith") {
            p.cyc += dt / 1.5;
            const u = p.cyc % 1, prevHit = p.hitDone;
            // raise slowly, slam down fast, rest
            p.armR.rotation.x = u < 0.55 ? lerp(-0.5, -2.5, u / 0.55) : u < 0.65 ? lerp(-2.5, -0.35, (u - 0.55) / 0.1) : -0.35 - (u - 0.65) * 0.4;
            p.armL.rotation.x = -0.4 + Math.sin(time * 1.5) * 0.05;
            if (u >= 0.65 && !prevHit) { p.hitDone = true; p.hammer.getWorldPosition(npcV); if (d < 18 && state === "playing") { sfx(1400 + Math.random() * 200, 0.07, "square", 0.04 * (1 - d / 18), 0.5); sfx(520, 0.15, "triangle", 0.04 * (1 - d / 18), 0.7); } burst(npcV, 5, 3, [sparkMat, sparkMat2]); }
            if (u < 0.6) p.hitDone = false;
        } else {
            if (d < 9) { p.armR.rotation.z = lerp(p.armR.rotation.z, 2.6 + Math.sin(time * 9) * 0.35, Math.min(1, 6 * dt)); p.armR.rotation.x = lerp(p.armR.rotation.x, 0, Math.min(1, 6 * dt)); }
            else { p.armR.rotation.z = lerp(p.armR.rotation.z, 0.08, Math.min(1, 4 * dt)); p.armR.rotation.x = -0.35 + Math.sin(time * 1.1 + p.ph) * 0.1; }
            p.armL.rotation.x = -0.35 + Math.sin(time * 1.1 + p.ph + 1) * 0.1;
        }
    }
}
const npcV = new THREE.Vector3(), sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd060 }), sparkMat2 = new THREE.MeshBasicMaterial({ color: 0xff8a20 });

function buildIsle2() {
    isle2Built = true;
    curBuild = 2;
    const prevAdd = addTgt; addTgt = null;
    colliders.length = 0; circles.length = 0; occluders.length = 0; chests.length = 0; altar = null;
    const gy = terrain2;

    // ----- the land -----
    {
        const g = new THREE.PlaneGeometry(440, 440, 220, 220);
        g.rotateX(-Math.PI / 2);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setY(i, terrain2(pos.getX(i), pos.getZ(i)));
        g.computeVertexNormals();
        const nor = g.attributes.normal, col = [], c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i), ny = nor.getY(i), d = Math.hypot(x, z), inside = shoreAt2(x, z) - d, rn = Math.random();
            if (y < -0.5) c.setHSL(0.1, 0.35, 0.15 + rn * 0.04);
            else if (Math.hypot(x - LAKE2.x, z - LAKE2.z) < LAKE2.r + 5) c.setHSL(0.1, 0.3, 0.2 + rn * 0.04);
            else if (inside < 12 && y < 2.4) c.setHSL(0.12, 0.5, 0.4 + rn * 0.06);
            else if (d < SAFE_R + 1) c.setHSL(0.09, 0.28, 0.14 + rn * 0.05);
            else if (y > 33 + (rn - 0.5) * 6) c.setHSL(0.58, 0.25, 0.8 + rn * 0.1);
            else if (ny < 0.78 || y > 25) c.setHSL(0.62, 0.06, 0.28 + rn * 0.08 + Math.min(0.12, y * 0.003));
            else c.setHSL(lerp(0.34, 0.2, clamp(y / 24, 0, 1)) + rn * 0.04, 0.34, 0.14 + rn * 0.06 + clamp(y / 24, 0, 1) * 0.04);
            col.push(c.r, c.g, c.b);
        }
        g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
        const wg = new THREE.PlaneGeometry(760, 760, 152, 152);
        wg.rotateX(-Math.PI / 2);
        const wp = wg.attributes.position, wc = [], cc = new THREE.Color(), shallow = new THREE.Color(0x56d8d0), mid = new THREE.Color(0x2f86b8), deep = new THREE.Color(0x174a7a);
        for (let i = 0; i < wp.count; i++) {
            const x = wp.getX(i), z = wp.getZ(i), k = clamp((Math.hypot(x, z) - shoreAt2(x, z)) / 36, 0, 1);
            cc.copy(shallow).lerp(mid, clamp(k * 2, 0, 1)).lerp(deep, clamp(k * 2 - 1, 0, 1));
            wc.push(cc.r, cc.g, cc.b);
        }
        wg.setAttribute("color", new THREE.Float32BufferAttribute(wc, 3));
        isle2.waterGeo = wg;
        // a foam line round the whole shore
        const N = 300, fp = [], idx = [];
        for (let i = 0; i <= N; i++) { const th = (i / N) * Math.PI * 2, r = shoreR2(th); fp.push(Math.cos(th) * (r - 3.5), -0.4, Math.sin(th) * (r - 3.5), Math.cos(th) * (r - 2.2), -0.4, Math.sin(th) * (r - 2.2)); if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
        const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3)); fg.setIndex(idx);
        isle2.foam = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
        scene.add(isle2.foam);
        // the lake
        const lake = new THREE.Mesh(new THREE.CircleGeometry(LAKE2.r + 2.5, 22), new THREE.MeshLambertMaterial({ color: 0x3a9ac0, emissive: 0x0a2a40, transparent: true, opacity: 0.88, flatShading: true }));
        lake.rotation.x = -Math.PI / 2; lake.position.set(LAKE2.x, -0.3, LAKE2.z);
        scene.add(lake);
        circles.push({ x: LAKE2.x, z: LAKE2.z, r: LAKE2.r - 1.2 });
    }

    // ----- basecamp: fire, tents, depot, gunsmith -----
    const stoneM = new THREE.MeshLambertMaterial({ color: 0x6a6660, flatShading: true });
    const canvasM = new THREE.MeshLambertMaterial({ color: 0x8a7a58, flatShading: true, side: THREE.DoubleSide });
    {
        const stones = batch(stoneM);
        for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.28; stones.add(ICO, Math.cos(a) * 1.3, 0.18, -3 + Math.sin(a) * 1.3, 0, 0, 0, 0.28, 0.22, 0.28); }
        stones.build();
        const lg = batch(woodDark);
        for (let i = 0; i < 4; i++) lg.add(CYL6, 0, 0.25, -3, Math.PI / 2, i * 0.8, 0, 0.12, 1.3, 0.12);
        lg.build();
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.5, 6), new THREE.MeshBasicMaterial({ color: 0xff9a2a })); flame.position.set(0, 1.0, -3);
        const core = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 5), new THREE.MeshBasicMaterial({ color: 0xffe070 })); core.position.set(0, 0.7, -3);
        const pool = new THREE.Mesh(new THREE.CircleGeometry(5, 16), new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.16, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false }));
        pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.04, -3);
        scene.add(flame, core, pool);
        fires.push({ flame, core, ph: srand() * 6 });
        const fl = new THREE.PointLight(0xff9a40, 18, 16, 1.6); fl.position.set(0, 2, -3); scene.add(fl); isle2.fireLight = fl;
        circles.push({ x: 0, z: -3, r: 1.3 });
        isle2.emit = [{ x: 0, y: 2.0, z: -3, rate: 1.0, acc: 0.3 }];
        const seats = batch(wood);
        for (const [dx, dz, r] of [[-2.6, -3.5, 0.2], [2.5, -2.4, -0.5], [0.4, -5.9, Math.PI / 2]]) seats.add(CYL6, dx, 0.28, dz, 0, r, Math.PI / 2, 0.22, 1.7, 0.22);
        seats.build();
        const cl = label("BASECAMP", "#ffb060", 3.4, 0.8); cl.position.set(0, 4.4, -3); cl.maxD = 90;
    }
    // bed: a lean-to with a cot
    {
        const g = new THREE.Group(); g.position.set(BED2.x, 0, BED2.z); g.rotation.y = Math.atan2(-BED2.x, -BED2.z);
        const roof = new THREE.Mesh(BOX, canvasM); roof.scale.set(3.4, 0.08, 2.8); roof.position.set(0, 2.2, -0.3); roof.rotation.x = 0.28; g.add(roof);
        for (const [px, pz] of [[-1.6, 0.9], [1.6, 0.9], [-1.6, -1.5], [1.6, -1.5]]) { const p = new THREE.Mesh(CYL6, woodDark); p.scale.set(0.07, px === 0 ? 2 : (pz > 0 ? 2.0 : 2.5), 0.07); p.position.set(px, pz > 0 ? 1.0 : 1.25, pz); g.add(p); }
        const cot = new THREE.Mesh(BOX, wood); cot.scale.set(1.4, 0.3, 2.3); cot.position.set(0, 0.35, -0.2); g.add(cot);
        const blanket = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0x8a2a2a, flatShading: true })); blanket.scale.set(1.3, 0.14, 1.5); blanket.position.set(0, 0.58, -0.55); g.add(blanket);
        const pillow = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0xe8e0d0, flatShading: true })); pillow.scale.set(1.0, 0.14, 0.5); pillow.position.set(0, 0.58, 0.7); g.add(pillow);
        scene.add(g);
        circles.push({ x: BED2.x, z: BED2.z, r: 1.4 });
        const bl = label("BED", "#b8c8ff", 2, 0.6); bl.position.set(BED2.x, 3.0, BED2.z);
        // a second tent for flavour
        const tg = new THREE.ConeGeometry(2.3, 2.4, 4); tg.rotateY(Math.PI / 4);
        const tent = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ color: 0x5a6a48, flatShading: true, side: THREE.DoubleSide })); tent.position.set(12, 1.2, 9); tent.scale.z = 1.35; tent.rotation.y = 0.5;
        scene.add(tent); circles.push({ x: 12, z: 9, r: 2 });
    }
    const stall = (at, signA, signB, signCol, mood) => {
        const g = new THREE.Group(); g.position.set(at.x, 0, at.z); g.rotation.y = Math.atan2(-at.x, -at.z);
        const counter = new THREE.Mesh(BOX, wood); counter.scale.set(4.2, 1.05, 1.1); counter.position.set(0, 0.52, 0.7); g.add(counter);
        const top = new THREE.Mesh(BOX, woodDark); top.scale.set(4.5, 0.1, 1.4); top.position.set(0, 1.08, 0.7); g.add(top);
        for (const sx of [-2.1, 2.1]) { const p = new THREE.Mesh(CYL6, woodDark); p.scale.set(0.1, 3.2, 0.1); p.position.set(sx, 1.6, 0.1); g.add(p); const q = new THREE.Mesh(CYL6, woodDark); q.scale.set(0.1, 3.2, 0.1); q.position.set(sx, 1.6, -2.0); g.add(q); }
        const roof = new THREE.Mesh(BOX, canvasM); roof.scale.set(5, 0.12, 3.4); roof.position.set(0, 3.25, -0.9); roof.rotation.x = 0.08; g.add(roof);
        const back = new THREE.Mesh(BOX, wood); back.scale.set(4.2, 3, 0.12); back.position.set(0, 1.5, -2.0); g.add(back);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.28), new THREE.MeshBasicMaterial({ map: signTex(signA, signB, signCol), side: THREE.DoubleSide })); sign.position.set(0, 4.15, 0.95); g.add(sign);
        scene.add(g);
        colliders.push([at.x - 2.6, at.x + 2.6, at.z - 2.6, at.z + 2.6]);
        return g;
    };
    {   // lumber depot
        const g = stall(DEPOT, "TRADING POST", "SELL MATERIALS", "#ffd040");
        const pile = batch(new THREE.MeshLambertMaterial({ color: 0x8a5a34, flatShading: true }));
        for (let r = 0; r < 3; r++) for (let k = 0; k < 4 - r; k++) pile.add(CYL6, DEPOT.x + 3.3 + (r * 0.3), 0.3 + r * 0.45, DEPOT.z + k * 0.62 - 0.9 + r * 0.3, Math.PI / 2, 0, 0, 0.26, 1.4, 0.26);
        pile.build();
        circles.push({ x: DEPOT.x + 3.4, z: DEPOT.z, r: 1.6 });
        const clerk = makeHumanoid({ face: "clerk", skin: 0xf0c8a0, shirt: 0xe8e0c8, vest: 0x2a5a3a, pants: 0x4a3a28, hair: 0x8a5a2a, hat: "cap", hatCol: 0x2a4a8a });
        clerk.g.position.set(0, 0, -0.6); g.add(clerk.g);
        clerk.yaw = g.rotation.y; npcs.push(clerk); clerkMesh = clerk.g;
        { const sc = new THREE.Group(); sc.position.set(-1.3, 1.13, 0.7); part(sc, CYL8, lamb(0x6a6a74), 0, 0.25, 0, 0.04, 0.5, 0.04); part(sc, BOX, lamb(0x6a6a74), 0, 0.5, 0, 0.9, 0.04, 0.04); for (const sd of [-1, 1]) part(sc, CYL8, lamb(0xc8a040), sd * 0.42, 0.36, 0, 0.18, 0.03, 0.18); g.add(sc); }
        const l = label("TRADING POST", "#ffd040", 3.6, 0.8); l.position.set(DEPOT.x, 6.2, DEPOT.z);
    }
    {   // gunsmith
        const g = stall(SMITH, "THE FORGE", "CRAFT AXES · GUNS", "#ff9a5a");
        const rackM = lamb(0x3a3a44);
        for (let k = 0; k < 4; k++) { const r = new THREE.Mesh(BOX, rackM); r.scale.set(0.9, 0.12, 0.1); r.position.set(-1.4 + k * 0.95, 2.2 + (k % 2) * 0.3, -1.85); g.add(r); const b = new THREE.Mesh(BOX, lamb(0x6a4a2a)); b.scale.set(0.18, 0.5, 0.1); b.position.set(-1.4 + k * 0.95 - 0.3, 1.95 + (k % 2) * 0.3, -1.8); g.add(b); }
        const anvil = new THREE.Mesh(BOX, lamb(0x2a2a30)); anvil.scale.set(0.7, 0.5, 0.45); anvil.position.set(2.7, 0.25, 0.9); g.add(anvil);
        const crates = batch(lamb(0x5a4430)); crates.add(BOX, SMITH.x - 3.3, 0.45, SMITH.z + 0.2, 0, 0.2, 0, 0.9, 0.9, 0.9); crates.add(BOX, SMITH.x - 3.4, 1.2, SMITH.z + 0.3, 0, 0.5, 0, 0.7, 0.6, 0.7); crates.build();
        const smith = makeHumanoid({ face: "smith", skin: 0xd09a72, shirt: 0x8a2a22, pants: 0x2a2a34, apron: 0x5a3a22, beard: 0x5a2a12, hat: "mask", wide: 1.25, belly: true });
        smith.g.position.set(0, 0, -0.6); g.add(smith.g);
        smith.yaw = g.rotation.y; npcs.push(smith); smithMesh = smith.g;
        // the hammer, held in the right hand
        const hm = new THREE.Group(); hm.position.set(0, -0.64, 0.05); smith.armR.add(hm);
        part(hm, BOX, lamb(0x6a4a2a), 0, 0, 0.22, 0.05, 0.05, 0.5); const hh = part(hm, BOX, lamb(0x3a3a44), 0, 0, 0.48, 0.24, 0.13, 0.13); smith.hammer = hh;
        // a glowing ingot on the counter and the forge fire behind
        part(g, BOX, new THREE.MeshBasicMaterial({ color: 0xff7a2a }), 0, 1.16, 0.5, 0.36, 0.06, 0.14);
        const furnace = new THREE.Group(); furnace.position.set(1.4, 0, -1.4); g.add(furnace);
        part(furnace, BOX, lamb(0x4a4a52), 0, 0.6, 0, 1.0, 1.2, 0.8); part(furnace, BOX, new THREE.MeshBasicMaterial({ color: 0xff8a2a }), 0, 0.55, 0.41, 0.5, 0.35, 0.02); part(furnace, CYL8, lamb(0x3a3a42), 0, 1.6, -0.1, 0.18, 1.0, 0.18);
        isle2.emit.push({ x: SMITH.x, y: 3.2, z: SMITH.z - 1.2, rate: 0.6, acc: 0.5 });
        const l = label("THE FORGE", "#ff9a5a", 3.2, 0.8); l.position.set(SMITH.x, 6.2, SMITH.z);
    }
    // sign: ferry this way
    {
        const sp = batch(woodDark); sp.add(CYL6, 4, 1.2, 16, 0, 0, 0, 0.09, 2.4, 0.09); sp.build();
        const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: signTex("FERRY", "↓ SOUTH", "#9fe8ff"), side: THREE.DoubleSide })); board.position.set(4, 2.6, 16); scene.add(board);
        const bk = board.clone(); bk.rotation.y = Math.PI; bk.position.z += 0.03; scene.add(bk);
    }

    // ----- dock, ferry 2 ("coming soon"), ferryman -----
    {
        const yaw = Math.atan2(D2DIR.x, D2DIR.z);
        const planks = batch(new THREE.MeshLambertMaterial({ color: 0x6a5240, flatShading: true }));
        for (let i = 0; i < D2LEN; i++) { const p = dock2Pt(i + 0.5); planks.add(BOX, p.x, 0.22, p.z, 0, yaw, 0, 3.6, 0.14, 0.92); }
        planks.build();
        const posts = batch(woodDark), rails = batch(woodDark), bulbs = batch(new THREE.MeshBasicMaterial({ color: 0xc8a0ff }));
        for (let i = 0; i <= D2LEN; i += 3) for (const s of [-1.9, 1.9]) { const p = dock2Pt(i, s); posts.add(CYL6, p.x, -0.9, p.z, 0, 0, 0, 0.12, 4.2, 0.12); if (i % 6 === 0) bulbs.add(ICO, p.x, 1.45, p.z, 0, 0, 0, 0.16); }
        for (let i = 0; i < D2LEN; i++) for (const s of [-1.9, 1.9]) { const p = dock2Pt(i + 0.5, s, 0.95); rails.add(BOX, p.x, 0.95, p.z, 0, yaw, 0, 0.08, 0.1, 1.02); }
        posts.build(); rails.build(); bulbs.build();
        for (const s of [-2.0, 2.0]) { const p = dock2Pt(3.5, s); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.6, 6), woodDark); m.position.set(p.x, 1.8, p.z); scene.add(m); }
        const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex("REBIRTH 2", "COMING SOON", "#c8a0ff"), side: THREE.DoubleSide }));
        board.position.copy(dock2Pt(3.5, 0, 3.3)); board.rotation.y = yaw; scene.add(board);
        const board2 = board.clone(); board2.rotation.y = yaw + Math.PI; board2.position.add(V3(D2DIR.x * 0.03, 0, D2DIR.z * 0.03)); scene.add(board2);
        const fl = label("THE FERRY", "#c8a0ff", 3.2, 0.7); fl.position.copy(dock2Pt(3.5, 0, 4.6)); fl.maxD = 70;
        // boat
        ferryBoat2 = new THREE.Group(); ferryBoat2.position.copy(dock2Pt(D2LEN - 7, 4.4, -0.15)); ferryBoat2.rotation.y = yaw; scene.add(ferryBoat2);
        const hullM = lamb(0x2a2a4a), trimM = lamb(0x6a5a9a);
        const hull = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.0, 7.6), hullM); hull.position.y = 0.2;
        const bowG = new THREE.ConeGeometry(1.35, 2.4, 4); bowG.rotateX(Math.PI / 2); bowG.rotateZ(Math.PI / 4);
        const bow = new THREE.Mesh(bowG, hullM); bow.position.set(0, 0.2, 5.0); bow.scale.y = 0.75;
        const trim = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.18, 7.8), trimM); trim.position.y = 0.72;
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 2.6), trimM); cabin.position.set(0, 1.5, -1.3);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5, 6), woodDark); mast.position.set(0, 3.0, 1.6);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), new THREE.MeshBasicMaterial({ color: 0xc8a0ff })); lamp.position.set(0, 5.6, 1.6);
        ferryBoat2.add(hull, bow, trim, cabin, mast, lamp);
        // ferryman
        ferryman2 = new THREE.Group(); const fp = dock2Pt(D2LEN - 3.5, -0.9, 0.3); ferryman2.position.copy(fp); ferryman2.rotation.y = yaw + Math.PI; scene.add(ferryman2);
        const coatM = lamb(0x22163a), trimM2 = lamb(0x6a4a9a);
        const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.95, 2.3, 8), coatM); coat.position.y = 1.15;
        const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.99, 0.12, 8), trimM2); hem.position.y = 0.06;
        const shm = new THREE.Mesh(new THREE.SphereGeometry(0.62, 8, 5), coatM); shm.scale.set(1.15, 0.55, 0.85); shm.position.y = 2.2;
        const hood = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), coatM); hood.scale.set(1, 1.15, 1.1); hood.position.y = 2.6;
        const peak = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 7), coatM); peak.position.set(0, 3.15, -0.2); peak.rotation.x = -0.55;
        const ff = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: ferrymanTex(), transparent: true })); ff.position.set(0, 2.58, 0.56);
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.9, 6), coatM); sleeve.position.set(0.62, 1.95, 0.3); sleeve.rotation.set(0.6, 0, 0.75);
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), lamb(0xb8c8d8)); hand.position.set(0.95, 1.7, 0.55);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.2, 5), woodDark); pole.position.set(0.95, 1.6, 0.55);
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 6), new THREE.MeshBasicMaterial({ color: 0xe8d8ff })); orb.position.set(0.95, 3.25, 0.55);
        const cage = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: 0x2a1a3e, wireframe: true })); cage.position.copy(orb.position);
        ferryman2.add(coat, hem, shm, hood, peak, ff, sleeve, hand, pole, orb, cage);
        const fm = label("FERRYMAN", "#c8a0ff", 2.6, 0.6); fm.position.set(fp.x, 4.7, fp.z); fm.maxD = 60;
        // far beacon: the next rebirth
        const FI = dock2Pt(D2LEN + 90, 0, 0);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 200, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xc8a0ff, transparent: true, opacity: 0.18, fog: false, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.set(FI.x, 100, FI.z); scene.add(beam); isle2.beam = beam;
        const bl = label("REBIRTH 2", "#c8a0ff", 5.2, 1.2); bl.position.set(FI.x, 30, FI.z); bl.maxD = 420; bl.blurK = 0.25;
        const bl2 = label("COMING SOON", "#ffffff", 4.2, 1.0); bl2.position.set(FI.x, 25, FI.z); bl2.maxD = 420; bl2.blurK = 0.25;
    }

    // ----- landmarks -----
    const place = (obj, x, z, extra = 0) => { obj.position.set(x, terrain2(x, z) + extra, z); scene.add(obj); return obj; };
    const chestAt = (x, z, special) => { const c = makeChest(x, z, srand() * 6, special); const y = terrain2(x, z); c.g.position.y = y; c.beacon.position.y = y + 2.7; c.y = y; return c; };
    {   // crystal grove
        const lm = LM2[2], y0 = terrain2(lm.x, lm.z);
        const cr1 = batch(new THREE.MeshBasicMaterial({ color: 0x6dffe0 })), cr2 = batch(new THREE.MeshBasicMaterial({ color: 0xff7ad8 })), cr3 = batch(new THREE.MeshBasicMaterial({ color: 0x9a8aff }));
        for (let i = 0; i < 22; i++) {
            const a = srand() * 6.283, d = srange(0.5, lm.r - 2), x = lm.x + Math.cos(a) * d, z = lm.z + Math.sin(a) * d, s = srange(0.5, 2.4), b = [cr1, cr2, cr3][i % 3];
            b.add(CONE6, x, terrain2(x, z) + s * 0.9, z, srange(-0.3, 0.3), srand() * 3, srange(-0.3, 0.3), 0.35 * s, 1.8 * s, 0.35 * s);
            if (s > 1.7) circles.push({ x, z, r: 0.5 });
        }
        cr1.build(); cr2.build(); cr3.build();
        const gl = new THREE.PointLight(0x6dffe0, 14, 22, 1.6); gl.position.set(lm.x, y0 + 3, lm.z); scene.add(gl);
        chestAt(lm.x + 3, lm.z - 2, true);
        const l = label(lm.name, lm.col, 3.4, 0.8); l.position.set(lm.x, y0 + 7, lm.z);
    }
    {   // the golden peak
        const lm = LM2[3], y0 = terrain2(lm.x, lm.z);
        const cairn = batch(new THREE.MeshLambertMaterial({ color: 0xd8e0ee, flatShading: true }));
        for (let i = 0; i < 9; i++) cairn.add(ICO, lm.x + srange(-1.4, 1.4), y0 + 0.4 + i * 0.12, lm.z + srange(-1.4, 1.4), srand() * 3, srand() * 3, 0, srange(0.5, 1.1), srange(0.4, 0.8), srange(0.5, 1.1));
        cairn.build();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6, 6), woodDark); place(pole, lm.x + 2.5, lm.z, 3);
        const flag = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 0.05), new THREE.MeshBasicMaterial({ color: 0xff4a4a, side: THREE.DoubleSide })); place(flag, lm.x + 3.4, lm.z, 5.4);
        chestAt(lm.x - 2.2, lm.z + 1.5, true);
        // the Golden Tree: the glow you saw from the ferry
        const gt = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 12, 8), new THREE.MeshLambertMaterial({ color: 0x8a6a2a, flatShading: true, emissive: 0x3a2a08 })); place(gt, lm.x + 4, lm.z - 3, 5.5);
        const gm = new THREE.MeshBasicMaterial({ color: 0xffd860, fog: false });
        for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(8 - i * 2, 6.5, 8), gm); place(c, lm.x + 4, lm.z - 3, 13 + i * 3.4); }
        const gb2 = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 200, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.16, fog: false, depthWrite: false, side: THREE.DoubleSide })); place(gb2, lm.x + 4, lm.z - 3, 100);
        circles.push({ x: lm.x + 4, z: lm.z - 3, r: 1.8 });
        const l = label(lm.name, lm.col, 3.4, 0.8); l.position.set(lm.x, y0 + 25, lm.z);
        const lg = label("THE GOLDEN TREE", "#ffe080", 3.2, 0.7); lg.position.set(lm.x + 4, y0 + 22, lm.z - 3); lg.maxD = 260; lg.blurK = 0.4;
    }
    {   // ruined temple + shrine
        const lm = LM2[4], y0 = terrain2(lm.x, lm.z);
        const slab = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 8, 0.5, 8), lamb(0x7a7a84)); place(slab, lm.x, lm.z, 0.1);
        const col = batch(lamb(0x9a9aa6));
        for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283, h = srand() < 0.35 ? srange(1, 2.2) : srange(3.4, 5), x = lm.x + Math.cos(a) * 6, z = lm.z + Math.sin(a) * 6; col.add(CYL8, x, y0 + h / 2 + 0.3, z, 0, 0, 0, 0.5, h, 0.5); circles.push({ x, z, r: 0.6 }); }
        col.build();
        const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 0.1, 14), new THREE.MeshBasicMaterial({ color: 0xffd860, transparent: true, opacity: 0.5, depthWrite: false })); place(glow, lm.x, lm.z, 1.55);
        const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.3, 8), lamb(0x8a8a96)); place(pedestal, lm.x, lm.z, 0.85);
        altar = { x: lm.x, z: lm.z, glow };
        circles.push({ x: lm.x, z: lm.z, r: 1.3 });
        chestAt(lm.x + 4, lm.z + 3.5, false);
        const l = label(lm.name, lm.col, 3.4, 0.8); l.position.set(lm.x, y0 + 7, lm.z);
        const l2 = label("SHRINE", "#ffe080", 2, 0.6); l2.position.set(lm.x, y0 + 3.4, lm.z);
    }
    {   // old mine
        const lm = LM2[5], y0 = terrain2(lm.x, lm.z), st = batch(lamb(0x6a6a74)), tb = batch(woodDark);
        st.add(BOX, lm.x - 2, y0 + 1.6, lm.z, 0, 0, 0, 1.0, 3.4, 1.4); st.add(BOX, lm.x + 2, y0 + 1.6, lm.z, 0, 0, 0, 1.0, 3.4, 1.4); st.add(BOX, lm.x, y0 + 3.6, lm.z, 0, 0, 0, 5.2, 1.0, 1.6);
        tb.add(BOX, lm.x - 1.2, y0 + 1.5, lm.z + 0.3, 0, 0, 0, 0.25, 3, 0.25); tb.add(BOX, lm.x + 1.2, y0 + 1.5, lm.z + 0.3, 0, 0, 0, 0.25, 3, 0.25); tb.add(BOX, lm.x, y0 + 3.0, lm.z + 0.3, 0, 0, 0, 2.7, 0.25, 0.25);
        for (let i = 0; i < 6; i++) tb.add(BOX, lm.x + 5, y0 + 0.08, lm.z + 2 + i * 1.2, 0, 0, 0, 1.7, 0.08, 0.2);
        st.build(); tb.build();
        const door = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3), new THREE.MeshBasicMaterial({ color: 0x010204 })); place(door, lm.x, lm.z + 0.75, 1.5);
        const cart = new THREE.Mesh(BOX, lamb(0x5a3a22)); cart.scale.set(1.3, 0.8, 1.9); place(cart, lm.x + 5, lm.z + 5, 0.6); circles.push({ x: lm.x + 5, z: lm.z + 5, r: 1.2 });
        colliders.push([lm.x - 2.5, lm.x + 2.5, lm.z - 0.7, lm.z + 0.7]);
        chestAt(lm.x - 5, lm.z + 3, true);
        const l = label(lm.name, lm.col, 3.2, 0.8); l.position.set(lm.x, y0 + 6.2, lm.z);
    }
    {   // hunter's lodge
        const lm = LM2[6], y0 = terrain2(lm.x, lm.z);
        const g = new THREE.Group(); g.position.set(lm.x, y0, lm.z); g.rotation.y = 0.5;
        const walls = new THREE.Mesh(BOX, wood); walls.scale.set(5, 2.6, 4); walls.position.y = 1.3; g.add(walls);
        const rg = new THREE.ConeGeometry(4.2, 1.6, 4); rg.rotateY(Math.PI / 4);
        const roof = new THREE.Mesh(rg, woodDark); roof.position.y = 3.4; roof.scale.z = 0.85; g.add(roof);
        const door = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: 0x1a0e08 })); door.scale.set(1, 1.8, 0.1); door.position.set(0, 0.9, 2.02); g.add(door);
        const win = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: 0xffc060 })); win.scale.set(0.8, 0.6, 0.1); win.position.set(1.6, 1.5, 2.02); g.add(win);
        scene.add(g);
        const rad = 3.2; colliders.push([lm.x - rad, lm.x + rad, lm.z - rad, lm.z + rad]);
        isle2.emit.push({ x: lm.x + 1.2, y: y0 + 5, z: lm.z - 0.6, rate: 0.7, acc: 0.1 });
        chestAt(lm.x + 5.5, lm.z + 4.5, false);
        const l = label(lm.name, lm.col, 3.4, 0.8); l.position.set(lm.x, y0 + 6.4, lm.z);
    }
    { const ll = label("HIGHLAND LAKE", "#7fd8ff", 3.6, 0.8); ll.position.set(LAKE2.x, 4, LAKE2.z); }
    // scattered chests across the island
    for (const [x, z] of [[34, 46], [-74, -32], [-44, -86], [64, 106], [76, 82], [-104, 88], [88, -32], [46, -44]]) chestAt(x, z, false);

    // ----- scenery -----
    const okSpot2 = (x, z, margin = 0) => {
        const d = Math.hypot(x, z);
        if (d < SAFE_R + 1 || d > shoreAt2(x, z) - 8) return false;
        if (Math.hypot(x - LAKE2.x, z - LAKE2.z) < LAKE2.r + 3) return false;
        for (let k = 1; k < LM2.length; k++) { const lm = LM2[k]; if (Math.hypot(x - lm.x, z - lm.z) < lm.r + margin) return false; }
        return true;
    };
    const scatter2 = (count, fn, margin = 0) => {
        let made = 0, guard = 0;
        while (made < count && guard++ < count * 40) {
            const a = srand() * 6.283, d = srange(SAFE_R + 1, shoreR2(a) - 9), x = Math.cos(a) * d, z = Math.sin(a) * d;
            if (!okSpot2(x, z, margin)) continue;
            fn(x, z, terrain2(x, z)); made++;
        }
    };
    {
        const rocks = batch(lamb(0x6a6a74)), bigR = batch(lamb(0x56565e));
        scatter2(130, (x, z, y) => { const s = srange(0.4, 1.6); rocks.add(ICO, x, y + s * 0.4, z, srand() * 3, srand() * 3, 0, s, s * srange(0.6, 1), s); if (s > 1.15) circles.push({ x, z, r: s * 0.85 }); });
        scatter2(26, (x, z, y) => { const s = srange(2.2, 4.4); bigR.add(ICO, x, y + s * 0.35, z, srand() * 3, srand() * 3, 0, s, s * srange(0.6, 0.9), s * srange(0.8, 1.2)); circles.push({ x, z, r: s * 0.85 }); });
        rocks.build(); bigR.build();
        const bushes = batch(lamb(0x3a6a3a)), fern = batch(lamb(0x4a8a42)), g2 = batch(lamb(0x6a9a42));
        scatter2(110, (x, z, y) => { const s = srange(0.6, 1.3); if (y < 24) bushes.add(ICO, x, y + s * 0.4, z, 0, srand() * 3, 0, s, s * 0.8, s); });
        scatter2(240, (x, z, y) => { if (y > 26) return; for (let i = 0; i < 4; i++) (srand() < 0.5 ? fern : g2).add(CONE6, x + srange(-0.3, 0.3), y + 0.3, z + srange(-0.3, 0.3), srange(-0.25, 0.25), 0, srange(-0.25, 0.25), 0.05, srange(0.45, 0.85), 0.05); });
        bushes.build(); fern.build(); g2.build();
        const snow = batch(lamb(0xeef4ff));
        scatter2(70, (x, z, y) => { if (y < 30) return; const s = srange(0.8, 2.2); snow.add(ICO, x, y + s * 0.15, z, 0, srand() * 3, 0, s, s * 0.3, s * 1.2); });
        snow.build();
        const cols = [0xff7aa8, 0xffe060, 0xf4f4f4, 0x8ab8ff, 0xc08aff], heads = cols.map(c => batch(lamb(c))), stems = batch(lamb(0x4a7a3a));
        scatter2(44, (x, z, y) => {
            if (y > 18) return;
            const a = Math.floor(srand() * cols.length), b = Math.floor(srand() * cols.length), n = 10 + Math.floor(srand() * 8);
            for (let i = 0; i < n; i++) { const fx = x + srange(-2.6, 2.6), fz = z + srange(-2.6, 2.6), fy = terrain2(fx, fz); stems.add(CYL6, fx, fy + 0.22, fz, 0, 0, 0, 0.02, 0.44, 0.02); heads[srand() < 0.6 ? a : b].add(ICO, fx, fy + 0.5, fz, 0, 0, 0, 0.12, 0.1, 0.12); }
        });
        heads.forEach(h => h.build()); stems.build();
        const stumps = batch(lamb(0x4a3322));
        scatter2(30, (x, z, y) => { const s = srange(0.35, 0.75); stumps.add(CYL8, x, y + s * 0.5, z, 0, 0, 0, s, srange(0.5, 1.1), s); });
        scatter2(16, (x, z, y) => { stumps.add(CYL6, x, y + 0.3, z, Math.PI / 2, srand() * 3, 0, 0.3, srange(2, 3.4), 0.3); });
        stumps.build();
        // the beach: palms, driftwood, shells
        const beachSpot = (n, min, max, fn) => { for (let i = 0; i < n; i++) { const a = srand() * 6.283, d = shoreR2(a) - srange(min, max), x = Math.cos(a) * d, z = Math.sin(a) * d, dx = x - D2B.x, dz = z - D2B.z; if (Math.hypot(dx, dz) < 12) continue; if (Math.hypot(x - LAKE2.x, z - LAKE2.z) < LAKE2.r + 4) continue; fn(x, z, Math.max(0, terrain2(x, z))); } };
        const palmT = batch(lamb(0x7a5a3a)), palmL = batch(lamb(0x3a8a4a)), drift = batch(lamb(0x9a8a78)), shells = batch(new THREE.MeshBasicMaterial({ color: 0xf2e8d8 }));
        beachSpot(40, 5, 12, (x, z, y) => { const lean = srange(-0.25, 0.25); palmT.add(CYL6, x - lean * 1.1, y + 2.2, z, 0, 0, lean, 0.16, 4.4, 0.16); for (let k = 0; k < 6; k++) { const a2 = k * 1.047 + srand() * 0.3; palmL.add(BOX, x - lean * 2.2 + Math.cos(a2) * 0.95, y + 4.25, z + Math.sin(a2) * 0.95, 0, -a2, -0.4, 2.0, 0.07, 0.5); } circles.push({ x, z, r: 0.35 }); });
        beachSpot(30, 3, 11, (x, z, y) => drift.add(CYL6, x, y + 0.14, z, Math.PI / 2, 0, srand() * 3, 0.12, srange(1.5, 3.2), 0.12));
        beachSpot(90, 2, 12, (x, z, y) => shells.add(ICO, x, y + 0.06, z, 0, srand() * 3, 0, 0.13, 0.08, 0.13));
        palmT.build(); palmL.build(); drift.build(); shells.build();
    }
    isle2.emit.forEach(e => smokeEmit.push(e));
    addTgt = prevAdd; curBuild = 1;
}
const isle2 = { waterGeo: null, foam: null, emit: [], beam: null, fireLight: null };

function clampIsle2(p) {
    if (p.x > 1500) { clampCave(p); return; }
    const dx = p.x - D2B.x, dz = p.z - D2B.z, along = dx * D2DIR.x + dz * D2DIR.z, side = dx * D2PERP.x + dz * D2PERP.z;
    if (along > 4.5 && along < D2LEN + 3 && Math.abs(side) < 6) {
        const a = Math.min(along, D2LEN - 0.7), s = clamp(side, -1.65, 1.65);
        p.x = D2B.x + D2DIR.x * a + D2PERP.x * s; p.z = D2B.z + D2DIR.z * a + D2PERP.z * s;
        return;
    }
    const lim = shoreAt2(p.x, p.z) - 3, d = Math.hypot(p.x, p.z);
    if (d > lim) { p.x *= lim / d; p.z *= lim / d; }
}

// ---------- the ground, once you're on the Highland Isle ----------
function groundY2(x, z) {
    if (x > 1500) return caveGround(x, z);
    const dx = x - D2B.x, dz = z - D2B.z, along = dx * D2DIR.x + dz * D2DIR.z, side = dx * D2PERP.x + dz * D2PERP.z;
    if (along > 4 && along < D2LEN + 3 && Math.abs(side) < 3) return 0;
    return Math.max(-0.4, terrain2(x, z));
}
function enterIsle2() {
    if (!isle2Built) buildIsle2();
    if (!caveBuilt) buildRelics();
    isle = 2; save.isle = 2;
    isle1.visible = false;
    groundFn = groundY2;
    waterMesh.geometry = isle2.waterGeo; waterMesh.material.needsUpdate = true;
    for (const p of smokePuffs) if (p.m.parent === isle1) { isle1.remove(p.m); scene.add(p.m); }
    smokeEmit.length = 0; isle2.emit.forEach(e => smokeEmit.push(e));
    RESPAWN.x = 3; RESPAWN.z = 4;
    for (const t of trees) { scene.remove(t.g); t.gone = true; if (t.bar) { t.bar.remove(); t.bar = null; } }
    trees.length = 0;
    for (const l of logs) scene.remove(l.m);
    logs.length = 0;
    for (const q of sending) scene.remove(q.m);
    sending.length = 0; sendVals.length = 0;
    save.ghosts = 0; syncGhosts();
    for (let i = 0; i < 90; i++) spawnTree(false);
    resetChests();
}
function updateIsle2Anim(dt) {
    if (!isle2Built) return;
    updateRelics(dt);
    if (isle2.foam) { isle2.foam.scale.setScalar(1 + Math.sin(time * 0.8) * 0.004); isle2.foam.material.opacity = 0.38 + Math.sin(time * 0.8) * 0.14; }
    if (isle2.beam) isle2.beam.material.opacity = 0.14 + Math.sin(time * 1.5) * 0.05;
    if (isle2.fireLight) isle2.fireLight.intensity = 16 + Math.sin(time * 13) * 3 + Math.sin(time * 7.3) * 2;
    if (ferryBoat2) { ferryBoat2.position.y = -0.15 + Math.sin(time * 1.1) * 0.07; ferryBoat2.rotation.z = Math.sin(time * 0.9) * 0.03; }
    if (ferryman2) {
        ferryman2.position.y = 0.3 + Math.sin(time * 1.2) * 0.02;
        const base = Math.atan2(D2DIR.x, D2DIR.z) + Math.PI, near = Math.hypot(player.pos.x - FERRYMAN2.x, player.pos.z - FERRYMAN2.z) < 14;
        const tg = near ? base + clamp(angDiff(Math.atan2(player.pos.x - FERRYMAN2.x, player.pos.z - FERRYMAN2.z), base), -0.9, 0.9) : base;
        ferryman2.rotation.y += angDiff(tg, ferryman2.rotation.y) * Math.min(1, 3 * dt);
    }
    updateNpcs(dt);
}

// ---------- island 2: shops, talking, selling ----------
const FERRY2_LINES = [
    "You made it across. Most people just stare at the glow and never buy the ticket.",
    "There is another light out there, past the horizon. A third life. But I won't sail there for cash alone.",
    "Bring me the Hypergamous Relic. It shattered into six pieces, and every one of them is somewhere on this island.",
    "One sleeps at the bottom of a cave nobody is supposed to find. Look for a dark mouth in the eastern hills.",
    "Six pieces and $2,500,000. Then we talk. Rebirth 2 is coming soon."
];
const FERRY2_QUIPS = ["Six pieces. No fewer.", "The cave is in the east. Bring a lantern.", "Not yet, woodcutter. Not yet.", "The next ferry is still being cut and nailed.", "I can see it out there, in the dark. It's coming.", "Chop. Save. Wait. That's the whole job."];
const SMITH_SAY = ["Bring me the trees' insides and I'll make you something that hurts.", "Iron from Ironbark, powder from Powderwood. Copper makes bullets.", "Nothing here is for sale. Everything here is earned.", "Hammer's hot. What are we making?", "Gold makes it pretty. Magma makes it scary."];
const costOf = (base, g, n) => Math.floor(base * Math.pow(g, n));
const vestCost = () => costOf(6000, 2.2, save.vestLvl || 0), magCost = () => costOf(4000, 2.4, save.magLvl || 0), whetCost = () => costOf(5000, 2, save.whetLvl || 0);
const powderCost = () => costOf(7000, 2, save.powderLvl || 0), magnetCost = () => costOf(3000, 2.3, save.magnetLvl || 0);
function gunItems() {
    const out = [];
    GUNS.forEach((g, i) => out.push({ name: g.name, col: g.col, desc: `${g.pel > 1 ? g.pel + " pellets × " : ""}${g.dmg} dmg · ${g.auto ? "full auto" : "semi-auto"} · ${g.mag} rounds · ${g.range}m`, cost: g.cost, owned: !!save.gunOwned[i], gun: i, buy() { save.gunOwned[i] = 1; const am = gunAm(i); am.mag = magSize(i); am.res = g.pack; equipGun(i); } }));
    GUNS.forEach((g, i) => {
        if (!save.gunOwned[i]) return;
        const am = gunAm(i);
        out.push({ name: g.name + " ammo", col: g.col, desc: `+${g.pack} rounds · you have ${am.mag} + ${am.res} (max ${resCap(i)} spare)`, cost: g.packCost, maxed: am.res >= resCap(i), buy() { am.res = Math.min(resCap(i), am.res + g.pack); if (holdingGun() && save.gunEq === i && am.mag === 0) startReload(); } });
    });
    return out;
}
function gearItems2() {
    return [
        { name: "Bandage", desc: `Heals 40 HP (H). Owned: ${save.bandages}`, cost: BANDAGE_COST * 2, buy() { save.bandages++; } },
        { name: "Better Log Price", desc: `Each log sells for $${logValue()} → $${logValue() + 5}`, cost: priceCost(), buy() { save.priceLvl++; } },
        { name: "Vitality", desc: `+20 max health (${save.hpLvl}/5)`, cost: hpCost(), maxed: save.hpLvl >= 5, buy() { save.hpLvl++; player.maxHp = maxHpNow(); player.hp = player.maxHp; } },
        { name: "Swift Boots", desc: `+7% move speed (${save.bootLvl}/4)`, cost: bootCost(), maxed: save.bootLvl >= 4, buy() { save.bootLvl++; } },
        { name: "Lantern Oil", desc: `A brighter, longer-reaching lantern (${save.oilLvl}/3)`, cost: oilCost(), maxed: save.oilLvl >= 3, buy() { save.oilLvl++; } },
        { name: "Kevlar Vest", desc: `Take 10% less damage from trees (${save.vestLvl || 0}/4)`, cost: vestCost(), maxed: (save.vestLvl || 0) >= 4, buy() { save.vestLvl = (save.vestLvl || 0) + 1; } },
        { name: "Extended Mags", desc: `+25% magazine size for every gun (${save.magLvl || 0}/3)`, cost: magCost(), maxed: (save.magLvl || 0) >= 3, buy() { save.magLvl = (save.magLvl || 0) + 1; } },
        { name: "Whetstone", desc: `+10% axe damage (${save.whetLvl || 0}/5)`, cost: whetCost(), maxed: (save.whetLvl || 0) >= 5, buy() { save.whetLvl = (save.whetLvl || 0) + 1; } },
        { name: "Gunpowder Mix", desc: `+10% gun damage (${save.powderLvl || 0}/5)`, cost: powderCost(), maxed: (save.powderLvl || 0) >= 5, buy() { save.powderLvl = (save.powderLvl || 0) + 1; } },
        { name: "Log Magnet", desc: `Logs fly to you from further away (${save.magnetLvl || 0}/3)`, cost: magnetCost(), maxed: (save.magnetLvl || 0) >= 3, buy() { save.magnetLvl = (save.magnetLvl || 0) + 1; } }
    ];
}
function sellAtDepot() {
    if (save.logs <= 0) { toast("You're not carrying any logs.", "bad"); return; }
    const n = save.logs, total = Math.round(logValue() * n + save.logBonus);
    save.money += total; save.sold += n; save.logs = 0; save.logBonus = 0;
    contractProgress("sell", n);
    toast(`Sold ${n} logs for +${money(total)}`, "cash");
    sfx(900, 0.1, "triangle", 0.09, 1.4); setTimeout(() => sfx(1200, 0.12, "triangle", 0.08, 1.4), 90);
    writeSave();
}
function nearest2() {
    const px = player.pos.x, pz = player.pos.z;
    if (Math.hypot(px - SMITH_AT.x, pz - SMITH_AT.z) < 3.4) return { k: "smith" };
    if (Math.hypot(px - DEPOT_AT.x, pz - DEPOT_AT.z) < 3.4) return { k: "depot" };
    if (Math.hypot(px - BED2.x, pz - BED2.z) < 3.2) return { k: "bed" };
    if (Math.hypot(px - FERRYMAN2.x, pz - FERRYMAN2.z) < 3.4) return { k: "ferry2" };
    for (const r of relicObjs) if (!save.relic[r.i] && Math.hypot(px - r.x, pz - r.z) < 2.6) return { k: "relic", r };
    for (const c of chests) if (!c.opened && Math.hypot(px - c.x, pz - c.z) < 2.6) return { k: "chest", c };
    if (altar && Math.hypot(px - altar.x, pz - altar.z) < 3.2) return { k: "altar" };
    return null;
}

// ---------- map of the Highland Isle ----------
function drawMap2() {
    const cv = $("mapc"), g = cv.getContext("2d"), S = cv.width, c = S / 2, sc = (S / 2 - 14) / 172;
    if (!mapBg2) {
        const N = 320, oc = document.createElement("canvas"); oc.width = oc.height = N;
        const og = oc.getContext("2d"), img = og.createImageData(N, N), col = new THREE.Color();
        for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
            const x = ((px + 0.5) / N - 0.5) * 344, z = ((py + 0.5) / N - 0.5) * 344, d = Math.hypot(x, z), inside = shoreAt2(x, z) - d, i = (py * N + px) * 4;
            let r, gg, b;
            if (inside < 0) { r = 11; gg = 34; b = 54; }
            else if (inside < 5) { r = 90; gg = 150; b = 170; }
            else {
                const y = terrain2(x, z), sh = clamp((terrain2(x - 2, z - 2) - terrain2(x + 2, z + 2)) * 0.06, -0.5, 0.5);
                if (Math.hypot(x - LAKE2.x, z - LAKE2.z) < LAKE2.r) col.setRGB(0.2, 0.5, 0.7);
                else if (y > 33) col.setRGB(0.9, 0.94, 1);
                else if (y > 22) col.setRGB(0.5, 0.5, 0.54);
                else if (inside < 12 && y < 2.4) col.setRGB(0.72, 0.64, 0.4);
                else col.setHSL(lerp(0.34, 0.2, clamp(y / 24, 0, 1)), 0.4, 0.22 + clamp(y / 24, 0, 1) * 0.1);
                r = clamp((col.r + sh) * 255, 0, 255); gg = clamp((col.g + sh) * 255, 0, 255); b = clamp((col.b + sh) * 255, 0, 255);
            }
            img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
        og.putImageData(img, 0, 0);
        mapBg2 = oc;
    }
    g.clearRect(0, 0, S, S);
    g.fillStyle = "#0b2236"; g.beginPath(); g.arc(c, c, c - 6, 0, 7); g.fill();
    g.strokeStyle = "rgba(255,208,64,.4)"; g.lineWidth = 3; g.stroke();
    g.save(); g.beginPath(); g.arc(c, c, c - 8, 0, 7); g.clip();
    g.imageSmoothingEnabled = false; g.drawImage(mapBg2, c - 172 * sc, c - 172 * sc, 344 * sc, 344 * sc);
    g.restore();
    g.fillStyle = "rgba(255,170,60,.12)"; g.beginPath(); g.arc(c, c, SAFE_R * sc, 0, 7); g.fill();
    g.setLineDash([6, 6]); g.strokeStyle = "rgba(255,200,90,.8)"; g.lineWidth = 2; g.beginPath(); g.arc(c, c, SAFE_R * sc, 0, 7); g.stroke(); g.setLineDash([]);
    const X = x => c + x * sc, Z = z => c + z * sc;
    g.font = "bold 11px Consolas"; g.textAlign = "center";
    for (const lm of LM2) {
        if (lm.camp) continue;
        g.strokeStyle = lm.col; g.lineWidth = 1.5; g.beginPath(); g.arc(X(lm.x), Z(lm.z), lm.r * sc * 0.7, 0, 7); g.stroke();
        g.lineWidth = 3; g.strokeStyle = "#000"; g.strokeText(lm.name, X(lm.x), Z(lm.z) - lm.r * sc * 0.7 - 4); g.fillStyle = lm.col; g.fillText(lm.name, X(lm.x), Z(lm.z) - lm.r * sc * 0.7 - 4);
    }
    { const de = dock2Pt(D2LEN); g.strokeStyle = "#c8a0ff"; g.lineWidth = 4; g.beginPath(); g.moveTo(X(D2B.x), Z(D2B.z)); g.lineTo(X(de.x), Z(de.z)); g.stroke(); g.fillStyle = "#c8a0ff"; g.font = "bold 12px Consolas"; g.fillText("FERRY", X(de.x), Z(de.z) - 8); }
    for (const ch of chests) if (!ch.opened) { g.fillStyle = ch.special ? "#c8a0ff" : "#ffd040"; g.fillRect(X(ch.x) - 4, Z(ch.z) - 4, 8, 8); g.strokeStyle = "#000"; g.lineWidth = 1; g.strokeRect(X(ch.x) - 4, Z(ch.z) - 4, 8, 8); }
    for (const t of trees) {
        if (t.gone || t.dying) continue;
        const near = Math.hypot(t.x - player.pos.x, t.z - player.pos.z) < 14;
        g.fillStyle = near ? "#ff4a3a" : t.type.rare ? t.type.col : "rgba(20,70,40,.95)";
        g.beginPath(); g.arc(X(t.x), Z(t.z), (t.type.rare ? 2.5 : 1.5) + t.h * 0.2, 0, 7); g.fill();
    }
    g.font = "bold 12px Consolas"; g.fillStyle = "#ffd040"; g.textAlign = "center";
    g.strokeStyle = "#000"; g.lineWidth = 3;
    for (const [t, x, z] of [["BASECAMP", 0, 8.4], ["TRADING", DEPOT.x + 9, DEPOT.z - 1], ["FORGE", SMITH.x - 7, SMITH.z - 1], ["BED", BED2.x - 4, BED2.z + 2]]) { g.strokeText(t, X(x), Z(z)); g.fillText(t, X(x), Z(z)); }
    g.fillStyle = "#fff"; g.fillText("N", c, 22);
    g.save(); g.translate(X(player.pos.x), Z(player.pos.z)); g.rotate(-player.yaw);
    g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
}

// ---------- the rebirth ride: walk onto the ferry, sail into the light, wake on a new island ----------
let ride = null;
const BOAT_A = DOCK_LEN - 7, BOAT_S = 4.4, RIDE_T = 17;
const DECK = V3(0.55, 2.55, 3.0), deckV = new THREE.Vector3(); // where you stand on the ferry (boat-local): beside the bow, clear of the cabin and mast
const deckEye = () => { ferryBoat.updateMatrixWorld(); return deckV.copy(DECK).applyMatrix4(ferryBoat.matrixWorld); };
function say(t) { const e = $("rideCap"); e.textContent = t; e.classList.toggle("show", !!t); }
function startRebirthRide() {
    if (ride || save.money < rebirthCost()) return;
    closePanel();
    ride = { phase: "walk", t: 0, from: player.pos.clone(), fx: false, done: false };
    mouseDown = false; endFishing();
    player.invuln = 99999; player.vel.set(0, 0, 0);
    const fl = labelList.find(l => l.el.textContent === "FERRYMAN"); if (fl) fl.visible = false;
    $("rbSmall").textContent = "REBIRTH #" + ((save.rebirths || 0) + 1);
    say("All aboard.");
    sfx(200, 0.9, "sine", 0.1, 2);
    writeSave();
}
const eio = u => u * u * (3 - 2 * u);
function updateRide(dt) {
    const r = ride;
    r.t += dt;
    player.vel.set(0, 0, 0); player.invuln = 99999; mouseDown = false;
    const lookAt = (tx, tz) => { player.yaw += angDiff(Math.atan2(-(tx - player.pos.x), -(tz - player.pos.z)), player.yaw) * Math.min(1, 5 * dt); player.pitch += (0 - player.pitch) * Math.min(1, 3 * dt); };
    if (r.phase === "walk") {
        const A = dockPt(BOAT_A + DECK.z, 1.3), B = deckEye().clone(), t1 = 2.6, t2 = 1.4, by = B.y;
        if (r.t < t1) { const u = eio(r.t / t1); player.pos.set(lerp(r.from.x, A.x, u), 1.75, lerp(r.from.z, A.z, u)); lookAt(B.x, B.z); player.bob += dt * 6; }
        else if (r.t < t1 + t2) { const u = (r.t - t1) / t2; player.pos.set(lerp(A.x, B.x, u), lerp(1.75, by, eio(u)) + Math.sin(u * Math.PI) * 0.55, lerp(A.z, B.z, u)); lookAt(B.x, B.z); if (!r.hop && u > 0.8) { r.hop = true; sfx(140, 0.2, "square", 0.12, 0.4); } }
        else {
            r.phase = "sail"; r.t = 0; sfx(110, 0.5, "sawtooth", 0.1, 0.5);
            ferryBoat.add(ferryman); ferryman.position.set(0.35, 0.8, -3.0); ferryman.rotation.y = 0;
            player.yaw = Math.atan2(-FDIR.x, -FDIR.z); player.pitch = 0.04;
            say("The ferry pulls away...");
        }
    } else {
        const u = clamp(r.t / RIDE_T, 0, 1), s = BOAT_A + 125 * u * u, p = dockPt(s, BOAT_S);
        ferryBoat.position.x = p.x; ferryBoat.position.z = p.z;
        player.pos.copy(deckEye());
        player.bob += dt * 0.6;
        if (r.t > 6 && !r.c2) { r.c2 = true; say("The golden light grows closer..."); }
        if (r.t > 11 && !r.c3) { r.c3 = true; say("A new life awaits."); }
        if (r.t > 12.8 && !r.fx) { r.fx = true; $("rebirthFx").classList.add("show"); sfx(200, 1.6, "sine", 0.1, 3); setTimeout(() => sfx(400, 1.6, "sine", 0.08, 2.5), 500); }
        if (r.t > 0.5 && r.t < 12 && Math.random() < dt * 0.9) sfx(90 + Math.random() * 40, 0.5, "sine", 0.03, 0.8);
        if (r.t >= RIDE_T && !r.done) { r.done = true; finishRebirth(); }
    }
}
function finishRebirth() {
    save.money -= rebirthCost();
    save.rebirths = (save.rebirths || 0) + 1;
    save.money = 0; save.logs = 0; save.logBonus = 0;
    save.owned = new Array(N_AXES).fill(0); save.owned[0] = 1; save.equipped = 0; save.gunOwned = []; save.gunEq = -1; save.gunAmmo = {};
    save.bandages = 1; save.priceLvl = 0; save.hpLvl = 0; save.bootLvl = 0; save.oilLvl = 0; save.rodLvl = 0;
    save.vestLvl = 0; save.magLvl = 0; save.whetLvl = 0; save.powderLvl = 0; save.magnetLvl = 0;
    save.fishBag = []; save.day = 1; save.altarDay = 0; save.contract = null; save.ghosts = 0;
    save.mats = {}; save.hotbar = ["a0", null, null, null, null]; save.relic = [0, 0, 0, 0, 0, 0];
    applyAxeLook(); syncGhosts();
    clockT = (8 / 24) * DAY_LEN; bmFelled = 0; setWeather("clear", false);
    enterIsle2(); newContract();
    holdingReset();
    player.maxHp = maxHpNow(); player.hp = player.maxHp;
    const a = dock2Pt(D2LEN - 10, 0);
    player.pos.set(a.x, 1.75, a.z); player.vel.set(0, 0, 0); player.yaw = Math.atan2(D2DIR.x, D2DIR.z); player.pitch = 0;
    player.invuln = 6;
    ride = null;
    writeSave();
    say("");
    setTimeout(() => { $("rebirthFx").classList.remove("show"); say("THE HIGHLAND ISLE"); setTimeout(() => say(""), 3600); toast("You are reborn. ★" + save.rebirths + "  +" + save.rebirths * 50 + "% cash, +" + save.rebirths * 10 + "% damage.", "cash"); toast("Walk inland to Basecamp. Trees here drop materials: sell them at the Trading Post, craft axes and guns at the Forge.", "good"); }, 2200);
}
function holdingReset() { reloading = false; reloadT = 0; gun.visible = false; axe.visible = true; }

if (save.isle === 2) enterIsle2();


// =====================================================================
//  1.1.1: the secret cave and the Hypergamous Relic (6 pieces = the ticket to Rebirth 2)
// =====================================================================
const REBIRTH2_COST = 2500000;
const RELIC_N = 6;
const RELIC_HINTS = ["Somewhere deep underground...", "Beside the Golden Tree", "Among the crystals", "Inside the Ruined Temple", "At the mouth of the Old Mine", "Behind the Hunter's Lodge"];
const relicCount = () => save.relic.filter(Boolean).length;
// the cave lives far away from everything (x = 2000) and you get there through a hidden mouth in the eastern hills
const CX = 2000, CAVE_MOUTH = { x: 101.5, z: 21 }, CAVE_OUT = { x: 97.5, z: 21 };
function inCave() { return player.pos.x > 1500; }
const CAVE_PTS = [[0, -5, 0], [0, 0, 0], [0, 8, -0.5], [3, 16, -2], [10, 22, -4], [18, 26, -6], [26, 26, -8], [32, 20, -10], [34, 12, -12], [32, 4, -14], [28, -2, -15.6]];
const CHAMBER = { x: CX + 26, z: -10, y: -16, r: 9.5 };
const caveCurve = new THREE.CatmullRomCurve3(CAVE_PTS.map(([x, z, y]) => V3(CX + x, y, z)));
const CAVE_S = caveCurve.getSpacedPoints(400);
function caveNear(x, z) {
    let bi = 0, bd = 1e9;
    for (let i = 0; i < CAVE_S.length; i++) { const p = CAVE_S[i], d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z); if (d < bd) { bd = d; bi = i; } }
    return { p: CAVE_S[bi], d: Math.sqrt(bd), i: bi };
}
function caveGround(x, z) {
    if (Math.hypot(x - CHAMBER.x, z - CHAMBER.z) < CHAMBER.r) return CHAMBER.y;
    return caveNear(x, z).p.y;
}
function clampCave(p) {
    const dc = Math.hypot(p.x - CHAMBER.x, p.z - CHAMBER.z), lim = CHAMBER.r - 1.1;
    if (dc < lim) return;
    const n = caveNear(p.x, p.z);
    if (n.d <= 1.7) return;
    if (dc < CHAMBER.r + 1.5) { p.x = CHAMBER.x + (p.x - CHAMBER.x) * lim / dc; p.z = CHAMBER.z + (p.z - CHAMBER.z) * lim / dc; return; }
    p.x = n.p.x + (p.x - n.p.x) * 1.7 / n.d; p.z = n.p.z + (p.z - n.p.z) * 1.7 / n.d;
}

// the relic picture, cut into a 2 x 3 grid
const relicImg = new Image();
const relicTex = [];
function drawRelicTile(i) {
    const cv = relicTex[i].image, g = cv.getContext("2d"), col = i % 2, row = Math.floor(i / 2);
    g.fillStyle = "#1a1208"; g.fillRect(0, 0, cv.width, cv.height);
    if (relicImg.complete && relicImg.naturalWidth) { const sw = relicImg.naturalWidth / 2, sh = relicImg.naturalHeight / 3; g.drawImage(relicImg, col * sw, row * sh, sw, sh, 10, 10, cv.width - 20, cv.height - 20); }
    g.strokeStyle = "#ffd040"; g.lineWidth = 10; g.strokeRect(5, 5, cv.width - 10, cv.height - 10);
    relicTex[i].needsUpdate = true;
}
for (let i = 0; i < RELIC_N; i++) { const cv = document.createElement("canvas"); cv.width = 256; cv.height = 304; const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; relicTex.push(t); drawRelicTile(i); }
relicImg.onload = () => { for (let i = 0; i < RELIC_N; i++) drawRelicTile(i); };
relicImg.src = "assets/relic.jpg";

const relicObjs = [];
let caveBuilt = false, caveFx = 0;
function makeRelicPiece(i, x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.07), new THREE.MeshBasicMaterial({ map: relicTex[i], side: THREE.DoubleSide })); g.add(card);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 24), new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })); g.add(halo);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 9, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })); beam.position.y = 3.6; g.add(beam);
    const light = new THREE.PointLight(0xffd060, 6, 9, 1.6); g.add(light);
    const o = { i, g, card, halo, x, y, z, ph: Math.random() * 6 };
    relicObjs.push(o);
    g.visible = !save.relic[i];
    return o;
}
function buildCave() {
    caveBuilt = true;
    const prev = addTgt; addTgt = null;
    const rockM = new THREE.MeshLambertMaterial({ color: 0x3e3846, flatShading: true, side: THREE.BackSide });
    // the tunnel: a rough rock tube winding down into the dark
    const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(CAVE_PTS.map(([x, z, y]) => V3(CX + x, y + 1.6, z))), 220, 2.9, 9, false);
    { const p = tg.attributes.position; for (let k = 0; k < p.count; k++) { const s = Math.sin(p.getX(k) * 1.7) * Math.cos(p.getZ(k) * 1.3) * 0.35 + (hash2(Math.round(p.getX(k) * 3), Math.round(p.getZ(k) * 3 + p.getY(k) * 5)) - 0.5) * 0.5; p.setXYZ(k, p.getX(k) + s, p.getY(k) + s * 0.6, p.getZ(k) - s); } tg.computeVertexNormals(); }
    scene.add(new THREE.Mesh(tg, rockM));
    // a walkable floor ribbon along the path
    const fp = [], fi = [], N = 220;
    for (let k = 0; k <= N; k++) {
        const u = k / N, p = caveCurve.getPointAt(u), t = caveCurve.getTangentAt(u), sx = -t.z, sz = t.x, l = Math.hypot(sx, sz) || 1;
        fp.push(p.x + sx / l * 2.5, p.y, p.z + sz / l * 2.5, p.x - sx / l * 2.5, p.y, p.z - sz / l * 2.5);
        if (k < N) { const a = k * 2; fi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3)); fg.setIndex(fi); fg.computeVertexNormals();
    scene.add(new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ color: 0x2c2620, flatShading: true, side: THREE.DoubleSide })));
    // the chamber at the bottom
    const sg = new THREE.SphereGeometry(CHAMBER.r + 1.2, 16, 10);
    { const p = sg.attributes.position; for (let k = 0; k < p.count; k++) { const f = 1 + (hash2(Math.round(p.getX(k) * 2), Math.round(p.getY(k) * 2 + p.getZ(k) * 3)) - 0.5) * 0.18; p.setXYZ(k, p.getX(k) * f, p.getY(k) * f, p.getZ(k) * f); } sg.computeVertexNormals(); }
    const ch = new THREE.Mesh(sg, rockM); ch.scale.set(1, 0.62, 1); ch.position.set(CHAMBER.x, CHAMBER.y + 2.2, CHAMBER.z); scene.add(ch);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(CHAMBER.r + 1.4, 24), new THREE.MeshLambertMaterial({ color: 0x2c2620, flatShading: true })); floor.rotation.x = -Math.PI / 2; floor.position.set(CHAMBER.x, CHAMBER.y, CHAMBER.z); scene.add(floor);
    // crystals in the walls, torches along the way, a pool of light where the relic sleeps
    const cA = batch(new THREE.MeshBasicMaterial({ color: 0x7affef })), cB = batch(new THREE.MeshBasicMaterial({ color: 0xc08aff }));
    for (let k = 0; k < 46; k++) {
        const u = srand(), p = caveCurve.getPointAt(u), t = caveCurve.getTangentAt(u), side = srand() < 0.5 ? 1 : -1, sx = -t.z * side, sz = t.x * side;
        (k % 2 ? cA : cB).add(CONE6, p.x + sx * 2.3, p.y + srange(0.4, 3.2), p.z + sz * 2.3, srange(-0.6, 0.6), 0, side * 0.9, 0.1, srange(0.4, 0.9), 0.1);
    }
    for (let k = 0; k < 26; k++) { const a = srand() * 6.283; (k % 2 ? cA : cB).add(CONE6, CHAMBER.x + Math.cos(a) * (CHAMBER.r - 0.4), CHAMBER.y + srange(0.3, 4), CHAMBER.z + Math.sin(a) * (CHAMBER.r - 0.4), srange(-0.4, 0.4), 0, srange(-0.4, 0.4), srange(0.15, 0.3), srange(0.6, 1.6), srange(0.15, 0.3)); }
    cA.build(); cB.build();
    for (const u of [0.12, 0.38, 0.64, 0.88]) {
        const p = caveCurve.getPointAt(u), t = caveCurve.getTangentAt(u);
        const tx = p.x - t.z * 2.2, tz = p.z + t.x * 2.2;
        const stick = new THREE.Mesh(BOX, woodDark); stick.scale.set(0.08, 0.6, 0.08); stick.position.set(tx, p.y + 1.6, tz); scene.add(stick);
        const fl = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 5), new THREE.MeshBasicMaterial({ color: 0xffa040 })); fl.position.set(tx, p.y + 2.05, tz); scene.add(fl);
        const L = new THREE.PointLight(0xff9a40, 9, 14, 1.5); L.position.set(tx, p.y + 2.2, tz); scene.add(L);
        fires.push({ flame: fl, core: fl, ph: srand() * 6 });
    }
    const exitGlow = new THREE.Mesh(new THREE.CircleGeometry(2.6, 16), new THREE.MeshBasicMaterial({ color: 0xcfe8ff })); exitGlow.position.set(CX, 1.6, -4.6); scene.add(exitGlow);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.95, 1.1, 8), new THREE.MeshLambertMaterial({ color: 0x6a6070, flatShading: true })); ped.position.set(CHAMBER.x, CHAMBER.y + 0.55, CHAMBER.z); scene.add(ped);
    const runes = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.5, 6), new THREE.MeshBasicMaterial({ color: 0xffd040, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })); runes.rotation.x = -Math.PI / 2; runes.position.set(CHAMBER.x, CHAMBER.y + 0.03, CHAMBER.z); scene.add(runes);
    const cl = new THREE.PointLight(0xb08aff, 14, 22, 1.4); cl.position.set(CHAMBER.x, CHAMBER.y + 4.5, CHAMBER.z); scene.add(cl);
    makeRelicPiece(0, CHAMBER.x, CHAMBER.y + 2.0, CHAMBER.z);
    addTgt = prev;
}
function buildCaveMouth() {
    // a dark mouth in the eastern hillside, half hidden by boulders and bushes
    const gy = terrain2(CAVE_MOUTH.x, CAVE_MOUTH.z);
    const rk = batch(lamb(0x5a5660)), bu = batch(lamb(0x2e5a34));
    for (const [dx, dz, sx, sy, sz] of [[0.5, -2.1, 1.5, 2.6, 1.6], [0.5, 2.1, 1.5, 2.6, 1.6], [0.8, 0, 1.9, 1.0, 3.4], [-0.6, -3.4, 1.4, 1.2, 1.4], [1.6, 3.2, 1.8, 1.8, 1.6], [2.2, -3, 2, 2.2, 2]]) rk.add(ICO, CAVE_MOUTH.x + dx, gy + sy * 0.55 + (dx === 0.8 ? 2.2 : 0), CAVE_MOUTH.z + dz, srand(), srand() * 3, 0, sx, sy, sz);
    for (const [dx, dz] of [[-2.4, -2.6], [-2.8, 2.4], [-3.4, -0.8]]) bu.add(ICO, CAVE_MOUTH.x + dx, gy + 0.5, CAVE_MOUTH.z + dz, 0, srand() * 3, 0, 1.1, 0.9, 1.1);
    rk.build(); bu.build();
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.8), new THREE.MeshBasicMaterial({ color: 0x020203 })); dark.position.set(CAVE_MOUTH.x + 0.9, gy + 1.4, CAVE_MOUTH.z); dark.rotation.y = -Math.PI / 2; scene.add(dark);
    const darkIn = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.8, 2.6), new THREE.MeshBasicMaterial({ color: 0x020203 })); darkIn.position.set(CAVE_MOUTH.x + 2.3, gy + 1.4, CAVE_MOUTH.z); scene.add(darkIn);
    circles.push({ x: CAVE_MOUTH.x + 0.5, z: CAVE_MOUTH.z - 2.1, r: 1.3 }, { x: CAVE_MOUTH.x + 0.5, z: CAVE_MOUTH.z + 2.1, r: 1.3 });
}
function buildRelics() {
    const at = (i, x, z, up = 1.4) => makeRelicPiece(i, x, terrain2(x, z) + up, z);
    at(1, GPEAK.x + 7, GPEAK.z - 1);
    at(2, LM2[2].x - 2, LM2[2].z + 3);
    at(3, LM2[4].x - 3.5, LM2[4].z - 2.5, 1.9);
    at(4, LM2[5].x + 1.5, LM2[5].z + 3);
    const a = 0.5, lx = LM2[6].x - Math.sin(a) * 5.5, lz = LM2[6].z - Math.cos(a) * 5.5;
    at(5, lx, lz);
    buildCaveMouth();
    buildCave();
}
let caveCd = 0;
function fadeTo(fn) {
    if (caveFx) return;
    caveFx = 1; $("fadeBlk").classList.add("show");
    setTimeout(() => { fn(); setTimeout(() => { $("fadeBlk").classList.remove("show"); caveFx = 0; }, 120); }, 380);
}
function updateRelics(dt) {
    if (!caveBuilt) return;
    for (const o of relicObjs) {
        if (!o.g.visible) continue;
        o.card.rotation.y += dt * 1.2;
        o.g.position.y = o.y + Math.sin(time * 1.6 + o.ph) * 0.15;
        o.halo.rotation.z += dt * 0.8; o.halo.lookAt(camera.position);
    }
    caveCd -= dt;
    if (state !== "playing" || ride || caveCd > 0 || caveFx) return;
    const px = player.pos.x, pz = player.pos.z;
    if (!inCave() && Math.hypot(px - CAVE_MOUTH.x - 0.9, pz - CAVE_MOUTH.z) < 1.5) {
        caveCd = 1.5;
        fadeTo(() => { player.pos.set(CX, 1.7, 1.5); player.vel.set(0, 0, 0); player.yaw = Math.PI; player.pitch = -0.1; sfx(90, 0.6, "sine", 0.08, 0.6); if (!save.caveFound) { save.caveFound = 1; toast("You found a secret cave...", "rare"); writeSave(); } });
    } else if (inCave() && Math.hypot(px - CX, pz + 3.6) < 1.4) {
        caveCd = 1.5;
        fadeTo(() => { player.pos.set(CAVE_OUT.x, terrain2(CAVE_OUT.x, CAVE_OUT.z) + 1.7, CAVE_OUT.z); player.vel.set(0, 0, 0); player.yaw = Math.PI / 2; player.pitch = 0; });
    }
}
function collectRelic(o) {
    if (save.relic[o.i]) return;
    save.relic[o.i] = 1; o.g.visible = false;
    flash = 0.7; shake = 0.3;
    sfx(392, 0.5, "triangle", 0.12, 1.5); setTimeout(() => sfx(523, 0.5, "triangle", 0.12, 1.5), 140); setTimeout(() => sfx(784, 0.9, "triangle", 0.12, 1.2), 300);
    const n = relicCount();
    toast(`Hypergamous Relic (Piece ${o.i + 1}) found! ${n}/6`, "rare");
    writeSave();
    $("relicSay").textContent = n === RELIC_N ? "The relic is whole. Take it to the Ferryman." : `Piece ${o.i + 1} found. ${RELIC_N - n} still out there.`;
    openPanel("relic");
}
function renderRelic() {
    const n = relicCount();
    $("relicN").textContent = n + " / " + RELIC_N;
    const html = Array.from({ length: RELIC_N }, (_, i) => save.relic[i]
        ? `<div class="rtile got" style="background-position:${(i % 2) * 100}% ${Math.floor(i / 2) * 50}%"></div>`
        : `<div class="rtile"><b>?</b><small>Piece ${i + 1}<br>${RELIC_HINTS[i]}</small></div>`).join("");
    if ($("relicGrid").dataset.h !== html) { $("relicGrid").innerHTML = html; $("relicGrid").dataset.h = html; }
}
function caveSky() {
    scene.background.setHex(0x07060a); scene.fog.color.setHex(0x07060a);
    scene.fog.near = 4; scene.fog.far = 34;
    ambL.color.setHex(0x6a5a8a); ambL.intensity = 0.9;
    sunL.intensity = 0.05;
    sunMesh.visible = moonMesh.visible = false; starMat.opacity = 0; wisps.visible = false; cloudMat.opacity = 0;
}
function openFerry2() {
    ferryConfirm = 0;
    $("ferrySay").textContent = "“" + FERRY2_QUIPS[Math.floor(Math.random() * FERRY2_QUIPS.length)] + "”";
    openPanel("ferry");
}
function renderFerry2() {
    const n = relicCount(), cashOk = save.money >= REBIRTH2_COST, relicOk = n === RELIC_N;
    document.querySelector("#panelFerry h2").textContent = "THE FERRY TO REBIRTH 2";
    const html = `<div class="fprice">Ticket #2: <b>${money(REBIRTH2_COST)}</b> + <b>the Hypergamous Relic</b></div>
      <div class="flist">
        <div class="${cashOk ? "keep" : "lose"}"><h4>${cashOk ? "✔" : "✘"} CASH</h4>${money(save.money)} of ${money(REBIRTH2_COST)}</div>
        <div class="${relicOk ? "keep" : "lose"}"><h4>${relicOk ? "✔" : "✘"} RELIC PIECES</h4>${n} / ${RELIC_N} found · press K to see them</div>
        <div class="gain"><h4>REBIRTH 2</h4>The next island isn't finished yet. Coming soon. Get ready now.</div>
      </div>`;
    if ($("ferryBody").dataset.h !== html) { $("ferryBody").innerHTML = html; $("ferryBody").dataset.h = html; }
    const b = $("ferryBuy");
    b.disabled = true; b.classList.remove("danger");
    b.textContent = !relicOk ? `FIND ${RELIC_N - n} MORE RELIC PIECE${RELIC_N - n === 1 ? "" : "S"}` : !cashOk ? "NEED " + money(REBIRTH2_COST - save.money) + " MORE" : "READY. REBIRTH 2 IS COMING SOON";
}

// ---------- HUD ----------
const el = { hp: $("hpFill"), hpTxt: $("hpTxt"), cash: $("cash"), logs: $("logsN"), zone: $("zone"), prompt: $("prompt"), fps: $("fps"), hot: $("hotbar"), hud: $("hud"), clock: $("clock"), contract: $("contract") };
let hudT = 0, frames = 0, fpsT = 0, lastCash = -1;
const PROMPTS = {
    shop: () => "[F] Talk to the Reaper", bed: () => (isNight() ? "[F] Sleep until dawn" : "Too bright to sleep. Come back at night"),
    chute: () => (save.logs ? `[F] Send ${save.logs} logs down the chute` : "Bring logs here, then [F]"),
    ferry: () => "[F] Talk to the Ferryman", ferry2: () => "[F] Talk to the Ferryman", relic: n => `[F] Take the Hypergamous Relic (Piece ${n.r.i + 1})`, smith: () => "[F] Use the Forge",
    depot: () => "[F] Trade at the Trading Post",
    fish: n => (n.spot.blocked ? "Face the water to fish" : "[F] Cast your line"),
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
    if (isle === 2) { const mh = Object.keys(MATS).filter(k => save.mats[k] > 0).map(k => `<span class="mp"><img src="${iconURL("m:" + k)}">${save.mats[k]}</span>`).join("") || "nothing yet"; if (el.logs.dataset.h !== mh) { el.logs.innerHTML = mh; el.logs.dataset.h = mh; $("logsLbl").textContent = "MATERIALS"; } }
    else el.logs.textContent = save.logs + (sendVals.length + sending.length ? ` (+${sendVals.length + sending.length} in tube)` : "");
    el.zone.textContent = inSafe() ? (isle === 2 ? "BASECAMP" : "SAFE ZONE") : (isle === 2 ? "THE HIGHLANDS" : "THE WOODS");
    el.zone.className = inSafe() ? "safe" : "danger";
    el.clock.textContent = (isBlood() ? "🩸 BLOOD MOON " : isNight() ? "🌙 " : "☀ ") + fmtClock() + " · DAY " + save.day + "  " + WX_ICON[wx.type] + (save.rebirths ? "  ★" + save.rebirths : "");
    el.clock.classList.toggle("blood", isBlood());
    const k = save.contract;
    el.contract.innerHTML = k ? `<b>CONTRACT</b> <i>${money(k.reward)}</i><br>${k.text} — ${Math.min(k.prog, k.goal)}/${k.goal}` : "";
    el.contract.style.display = k ? "" : "none";
    const n = panel ? null : nearest();
    const pr = ride ? "" : fishing.on ? fishPrompt() : n ? PROMPTS[n.k](n) : "";
    el.prompt.textContent = pr;
    el.prompt.classList.toggle("show", !!pr);
    el.prompt.classList.toggle("alert", fishing.on && fishing.phase === "bite");
    ensureHotbar();
    const hot = save.hotbar.map((id, slot) => {
        if (!id) return `<div class="slot empty"><span class="k">${slot + 1}</span></div>`;
        const sel = wEquipped(id), dm = id[0] === "a" ? axeDmgFor(+id.slice(1)) : gunDmg(+id.slice(1));
        return `<div class="slot ${sel ? "sel" : ""}" style="--c:${wCol(id)}"><span class="k">${slot + 1}</span><img class="ic" src="${iconURL(id)}"><span class="nm">${wName(id)}</span><span class="ct">${dm} dmg</span>${sel ? '<span class="eqtag">EQUIPPED</span>' : ""}</div>`;
    }).join("");
    { const am = holdingGun() ? gunAm(save.gunEq) : null, ae = $("ammo"); ae.style.display = am ? "" : "none"; if (am) ae.innerHTML = `<small>${GUNS[save.gunEq].name.toUpperCase()}</small><b>${am.mag}</b> / ${am.res}${reloading ? "<em>RELOADING</em>" : am.mag === 0 && am.res === 0 ? "<em>NO AMMO</em>" : ""}`; }
    if (el.hot.dataset.h !== hot) { el.hot.innerHTML = hot; el.hot.dataset.h = hot; }
    if (panel === "inv") renderInv();
    if (panel === "shop") renderShop();
    if (panel === "map") drawMap();
    if (panel === "ferry") renderFerry();
}
const axeDmgFor = i => { const a = AXES[i]; return Math.round(a.dmg * (a.night && isNight() ? a.night : 1) * (1 + 0.1 * (save.rebirths || 0)) * (1 + 0.1 * (save.whetLvl || 0))); };

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
        if (holdingGun()) animateGun(real);
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
        updateWorldAnim(real); updateIsle2Anim(real); updateWeather(real); updateEcosystem(real);
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
    save, player, trees, camera, chests, LANDMARKS, enterIsle2, startRebirthRide, groundY, terrain2, GUNS, equipGun, fireGun, startReload, LM2, getIsle: () => isle, getRide: () => ride,
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
    interact, writeSave, doRebirth, relicObjs, collectRelic, CAVE_MOUTH, rebirthCost, setWeather, isBlood, fishing, fishSpot, startFishing, fishAction, rollFish, syncGhosts, critters, wx, ghostObjs, hit: tryHit, equip: equipAxe, openPanel, closePanel, spawn: (k, x, z, h = 6) => makeTree(x, z, h, k)
};

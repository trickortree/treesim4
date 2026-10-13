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
// player settings: kept on this computer, separate from the save (so resetting progress keeps them)
const SETTINGS_KEY = "ts4_settings";
const settings = Object.assign({ sens: 1, invert: false, fov: 75, vol: 0.8, pixel: 3, bob: true, fps: true },
    (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch (e) { return {}; } })());
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } };
let SCALE = settings.pixel; // render at 1/SCALE res, CSS upscales with pixelated sampling (RETRO)

// ---------- graphics style: MODERN (sharp, lit, shadows, glow) or RETRO (the original chunky pixels) ----------
// asked once on first launch, before the world is built; it can be changed any time in Settings
if (settings.gfx !== "modern" && settings.gfx !== "retro") {
    settings.gfx = await new Promise(res => {
        const box = $("gfxPick"), cards = [...box.querySelectorAll(".gpCard")];
        let pick = "modern", done = false;
        const sel = g => { pick = g; cards.forEach(c => c.classList.toggle("on", c.dataset.g === g)); };
        const go = () => {
            if (done) return; done = true;
            removeEventListener("keydown", key);
            $("gpGo").textContent = "LOADING…"; box.classList.add("busy");
            requestAnimationFrame(() => requestAnimationFrame(() => res(pick))); // let "LOADING" paint before the world builds
        };
        const key = e => {
            if (document.getElementById("intro")) return;
            if (e.code === "Enter" || e.code === "Space") { e.preventDefault(); go(); }
            if (e.code === "ArrowLeft" || e.code === "KeyA") sel("modern");
            if (e.code === "ArrowRight" || e.code === "KeyD") sel("retro");
        };
        cards.forEach(c => { c.addEventListener("click", () => sel(c.dataset.g)); c.addEventListener("dblclick", () => { sel(c.dataset.g); go(); }); });
        $("gpGo").addEventListener("click", go);
        addEventListener("keydown", key);
        box.classList.add("show");
    });
    saveSettings();
}
const MODERN = settings.gfx === "modern";
// quality tiers for MODERN: render scale, anti-aliasing, shadow map, grass
const GFXQ = {
    // (measured on the school laptops' Radeon Vega 8: 4x MSAA was the single most expensive thing, so LOW/MEDIUM smooth edges with FXAA instead)
    low: { rs: 0.7, msaa: 0, fxaa: 1, shadow: 0, every: 1, sr: 0, soft: 0, bloom: 1, grass: 3000, gr: 14 },
    med: { rs: 0.75, msaa: 0, fxaa: 1, shadow: 1024, every: 3, sr: 30, soft: 0, bloom: 1, grass: 6500, gr: 19 },
    high: { rs: 1, msaa: 4, fxaa: 0, shadow: 2048, every: 2, sr: 46, soft: 1, bloom: 1, grass: 12000, gr: 26 }
};
if (!GFXQ[settings.quality]) settings.quality = "med";
const GQ = GFXQ[settings.quality];
if (MODERN) canvas.style.imageRendering = "auto";
const terrainMesh = []; // each island's ground mesh (grass is baked from it)
const wtr = m => { if (MODERN) m.defines = Object.assign(m.defines || {}, { TS_WATER: "" }); return m; }; // marks a material as water
const windy = m => { if (MODERN) m.defines = Object.assign(m.defines || {}, { TS_WIND: "" }); return m; }; // leaves that sway

// shared shader inputs for every modern material
const TSU = { tsTime: { value: 0 }, tsNoise: { value: null }, tsSunDir: { value: new THREE.Vector3(0, 1, 0) }, tsSunCol: { value: new THREE.Color() }, tsSky: { value: new THREE.Color() } };
function makeNoiseTex() {
    // tileable value-noise fbm: R = fine grain, G = broad patches, B = another fine layer (water ripples)
    const N = 256, data = new Uint8Array(N * N * 4);
    const lat = (s, f) => { const a = new Float32Array(f * f); let x = s; for (let i = 0; i < a.length; i++) { x = (x * 16807) % 2147483647; a[i] = x / 2147483647; } return a; };
    const oct = (f, s) => {
        const L = lat(s, f), out = new Float32Array(N * N);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const fx = (x / N) * f, fy = (y / N) * f, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
            const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), g = (i, j) => L[((j + f) % f) * f + ((i + f) % f)];
            out[y * N + x] = lerp(lerp(g(x0, y0), g(x0 + 1, y0), sx), lerp(g(x0, y0 + 1), g(x0 + 1, y0 + 1), sx), sy);
        }
        return out;
    };
    const fbm = (fs, seedBase) => { const o = new Float32Array(N * N); let amp = 0.5, tot = 0; fs.forEach((f, i) => { const l = oct(f, seedBase + i * 977); for (let k = 0; k < o.length; k++) o[k] += l[k] * amp; tot += amp; amp *= 0.55; }); for (let k = 0; k < o.length; k++) o[k] /= tot; return o; };
    const r = fbm([8, 16, 32, 64, 128], 11), g = fbm([2, 4, 8], 5003), b = fbm([4, 8, 16, 32], 90001);
    for (let k = 0; k < N * N; k++) { data[k * 4] = clamp(r[k] * 255, 0, 255); data[k * 4 + 1] = clamp(g[k] * 255, 0, 255); data[k * 4 + 2] = clamp(b[k] * 255, 0, 255); data[k * 4 + 3] = 255; }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
    return t;
}
// every Lambert material gets: smooth shading, a subtle world-space surface texture, and (by define) wind or water
function modernShader(sh) {
    Object.assign(sh.uniforms, TSU);
    sh.vertexShader = "#undef FLAT_SHADED\nvarying vec3 vTsW;\nvarying vec3 vTsN;\nuniform float tsTime;\n" + sh.vertexShader
        .replace("#include <begin_vertex>", `#include <begin_vertex>
#ifdef TS_WIND
{ vec4 tw = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0); float ph = tw.x * 0.37 + tw.z * 0.29 + (transformed.x + transformed.z) * 0.08; float k = clamp(transformed.y * 0.08, 0.0, 1.2);
  transformed.x += (sin(tsTime * 1.6 + ph) + 0.4 * sin(tsTime * 3.7 + ph * 2.0 + transformed.y)) * 0.07 * k;
  transformed.z += (cos(tsTime * 1.3 + ph * 1.2) + 0.4 * sin(tsTime * 4.1 + transformed.x)) * 0.06 * k; }
#endif`)
        .replace("#include <fog_vertex>", `#include <fog_vertex>
{ vec4 tp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  tp = instanceMatrix * tp;
#endif
  vTsW = (modelMatrix * tp).xyz; vTsN = normalize(mat3(modelMatrix) * objectNormal); }`);
    sh.fragmentShader = "#undef FLAT_SHADED\nvarying vec3 vTsW;\nvarying vec3 vTsN;\nuniform sampler2D tsNoise;\nuniform float tsTime;\nuniform vec3 tsSunDir;\nuniform vec3 tsSunCol;\nuniform vec3 tsSky;\n" + sh.fragmentShader
        .replace("#include <color_fragment>", `#include <color_fragment>
#if !defined(TS_WATER) && !defined(TS_NODETAIL)
{ vec3 an = abs(vTsN); float up = smoothstep(0.35, 0.75, an.y);
  vec4 top = texture2D(tsNoise, vTsW.xz * 0.23);
  float side = texture2D(tsNoise, (an.x > an.z ? vTsW.zy : vTsW.xy) * 0.23).r;
  float n = mix(side, top.r, up);
  diffuseColor.rgb *= (0.78 + 0.44 * n) * mix(1.0, 0.86 + 0.28 * texture2D(tsNoise, vTsW.xz * 0.019).g, up); }
#endif`)
        .replace("#include <normal_fragment_begin>", `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
vec3 normal = vNormal;
if (dot(normal, normal) < 1e-8) normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
else {
  normal = normalize(normal);
#ifdef DOUBLE_SIDED
  normal *= faceDirection;
#endif
}
vec3 nonPerturbedNormal = normal;`)
        .replace("#include <opaque_fragment>", `#ifdef TS_WATER
{ vec2 uv = vTsW.xz;
  vec4 a = texture2D(tsNoise, uv * 0.035 + vec2(tsTime * 0.011, tsTime * 0.006));
  vec4 b = texture2D(tsNoise, uv * 0.061 - vec2(tsTime * 0.008, -tsTime * 0.012));
  vec3 wn = normalize(vec3((a.b - 0.5) * 1.4 + (b.r - 0.5), 1.0, (b.b - 0.5) * 1.4 + (a.r - 0.5)));
  vec3 V = normalize(cameraPosition - vTsW);
  float spec = pow(max(dot(reflect(-tsSunDir, wn), V), 0.0), 140.0) * 4.0;
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  outgoingLight = mix(outgoingLight, tsSky, fres * 0.6) + tsSunCol * spec + vec3(0.02, 0.04, 0.05) * (a.g - 0.5);
  diffuseColor.a = mix(diffuseColor.a, 1.0, fres * 0.7); }
#endif
#include <opaque_fragment>`);
}

// post: the scene goes to a high-precision target, bright bits bleed out (bloom), then a light grade + vignette
const FX = MODERN ? (() => {
    const mk = (o = {}) => new THREE.WebGLRenderTarget(4, 4, Object.assign({ type: THREE.HalfFloatType, depthBuffer: false }, o));
    const main = mk({ depthBuffer: true, samples: GQ.msaa, type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace }), b1 = mk(), b2 = mk();
    const fsScene = new THREE.Scene(), fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry(); tri.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(tri); quad.frustumCulled = false; fsScene.add(quad);
    const VS = "varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }";
    const pass = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    const bright = pass(`uniform sampler2D tSrc; uniform vec2 px; varying vec2 vUv;
void main(){ vec3 c = (texture2D(tSrc, vUv + px * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + px * vec2(1.0, -1.0)).rgb + texture2D(tSrc, vUv + px * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + px * vec2(1.0, 1.0)).rgb) * 0.25;
  float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * smoothstep(0.86, 1.0, l), 1.0); }`, { tSrc: { value: main.texture }, px: { value: new THREE.Vector2() } });
    const blur = pass(`uniform sampler2D tSrc; uniform vec2 dir; varying vec2 vUv;
void main(){ vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
  c += (texture2D(tSrc, vUv + dir * 1.385).rgb + texture2D(tSrc, vUv - dir * 1.385).rgb) * 0.316;
  c += (texture2D(tSrc, vUv + dir * 3.231).rgb + texture2D(tSrc, vUv - dir * 3.231).rgb) * 0.070;
  gl_FragColor = vec4(c, 1.0); }`, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    const comp = pass(`uniform sampler2D tScene; uniform sampler2D tBloom; uniform float bloom; uniform float time; uniform vec2 px; varying vec2 vUv;
// FXAA (the compact Lottes version): finds edges by luma and blends along them
vec3 fxaa(vec2 uv) {
  vec3 nw = texture2D(tScene, uv + vec2(-1.0, -1.0) * px).rgb, ne = texture2D(tScene, uv + vec2(1.0, -1.0) * px).rgb;
  vec3 sw = texture2D(tScene, uv + vec2(-1.0, 1.0) * px).rgb, se = texture2D(tScene, uv + vec2(1.0, 1.0) * px).rgb, m = texture2D(tScene, uv).rgb;
  vec3 L = vec3(0.299, 0.587, 0.114);
  float lnw = sqrt(dot(nw, L)), lne = sqrt(dot(ne, L)), lsw = sqrt(dot(sw, L)), lse = sqrt(dot(se, L)), lm = sqrt(dot(m, L));
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  if (lmax - lmin < max(0.04, lmax * 0.12)) return m;
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125), rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * px;
  vec3 a = 0.5 * (texture2D(tScene, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tScene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tScene, uv - dir * 0.5).rgb + texture2D(tScene, uv + dir * 0.5).rgb);
  float lb = sqrt(dot(b, L));
  return (lb < lmin || lb > lmax) ? a : b;
}
void main(){
#ifdef FXAA
  vec3 c = fxaa(vUv);
#else
  vec3 c = texture2D(tScene, vUv).rgb;
#endif
  c += texture2D(tBloom, vUv).rgb * bloom;
  c = linearToOutputTexel(vec4(c, 1.0)).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.1); c = (c - 0.5) * 1.06 + 0.5;
  vec2 d = vUv - 0.5; c *= mix(1.0, 0.74, smoothstep(0.1, 0.55, dot(d, d) * 2.0));
  c += (fract(sin(dot(gl_FragCoord.xy + fract(time) * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0); }`, { tScene: { value: main.texture }, tBloom: { value: b1.texture }, bloom: { value: GQ.bloom ? 1 : 0 }, time: { value: 0 }, px: { value: new THREE.Vector2() } });
    if (GQ.fxaa) comp.defines = { FXAA: "" };
    const run = (m, target) => { quad.material = m; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); };
    let bw = 1, bh = 1;
    return {
        main, comp,
        resize(w, h) { main.setSize(w, h); bw = Math.max(1, w >> 2); bh = Math.max(1, h >> 2); b1.setSize(bw, bh); b2.setSize(bw, bh); bright.uniforms.px.value.set(1 / w, 1 / h); comp.uniforms.px.value.set(1 / w, 1 / h); },
        render(withView) {
            renderer.setRenderTarget(main); renderer.clear();
            renderer.render(scene, camera);
            if (withView) { renderer.clearDepth(); renderer.render(viewScene, viewCam); }
            if (GQ.bloom) {
                run(bright, b1);
                for (const s of [1, 2]) {
                    blur.uniforms.tSrc.value = b1.texture; blur.uniforms.dir.value.set(s / bw, 0); run(blur, b2);
                    blur.uniforms.tSrc.value = b2.texture; blur.uniforms.dir.value.set(0, s / bh); run(blur, b1);
                }
            }
            comp.uniforms.time.value = TSU.tsTime.value;
            run(comp, null);
        }
    };
})() : null;
if (MODERN) { TSU.tsNoise.value = makeNoiseTex(); THREE.MeshLambertMaterial.prototype.onBeforeCompile = modernShader; }

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
let isle = 1; // 1 = Pine Island, 2 = the Highland Isle, 3 = Mooncap Isle
let groundFn = null;
const groundY = (x, z) => (x > 4500 ? 0 : groundFn ? groundFn(x, z) : 0); // x > 4500 is the casino's hall
const curShoreAt = (x, z) => (isle === 5 ? shoreAt5(x, z) : isle === 4 ? shoreAt4(x, z) : isle === 3 ? shoreAt3(x, z) : isle === 2 ? shoreAt2(x, z) : shoreAt(x, z));
const curShoreR = a => (isle === 5 ? shoreR5(a) : isle === 4 ? shoreR4(a) : isle === 3 ? shoreR3(a) : isle === 2 ? shoreR2(a) : shoreR(a));

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
    const k = MODERN ? Math.min(devicePixelRatio || 1, 2) * GQ.rs : 1 / SCALE;
    const w = Math.max(160, Math.floor(innerWidth * k));
    const h = Math.max(100, Math.floor(innerHeight * k));
    renderer.setSize(w, h, false);
    if (FX) FX.resize(w, h);
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
const N_AXES = 16;

// ---------- save ----------
const SAVE_KEY = "ts4_save_v1";
const QS = new URLSearchParams(location.search), VERSION = QS.get("v") || "dev", DEBUG = QS.has("debug");
const save = {
    logs: 0, logBonus: 0, money: 0, owned: [1, 0, 0, 0, 0, 0, 0, 0], equipped: 0, ghosts: 0, bandages: 1, priceLvl: 0,
    hpLvl: 0, bootLvl: 0, oilLvl: 0, felled: 0, rareFelled: 0, deaths: 0, sold: 0, seconds: 0, day: 1, clock: 8,
    contract: null, chestsDay: 0, altarDay: 0, chestsOpened: 0,
    rodLvl: 0, fishBag: [], fishDex: {}, fishSold: 0, ghostCash: 0, ghostFelled: 0, bmSurvived: 0, rebirths: 0,
    isle: 1, gunOwned: [], gunEq: -1, gunAmmo: {}, vestLvl: 0, magLvl: 0, whetLvl: 0, powderLvl: 0, magnetLvl: 0, ferryTalks: 0, ferry2Talk: 0, mats: {}, hotbar: null, relic: [0, 0, 0, 0, 0, 0], caveFound: 0,
    ferry3Talk: 0, bossKills: 0, bossDay: 0, buffs: {}, phoenix: 0, wellDay: 0, scopeDay: 0, starsCaught: 0, ench: {}, giftsOpened: 0
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
if (!Number.isFinite(save.money)) save.money = 0; // 1.6.1 could turn cash into NaN (Christmas palm presents)
if (!save.casino || typeof save.casino !== "object") save.casino = { net: 0, big: 0, plays: 0, jack: 0, wheelDay: -1, visits: 0 };
if (!Array.isArray(save.relic) || save.relic.length !== 6) save.relic = [0, 0, 0, 0, 0, 0];
if (!save.buffs || typeof save.buffs !== "object") save.buffs = {};
if (!save.ench || typeof save.ench !== "object") save.ench = {};
// enchantments live on each axe: save.ench[axeIndex] = { sharp, fortune, vamp, swift, bane }
const enchLv = (k, i = save.equipped) => (save.ench[i] && save.ench[i][k]) || 0;
let savesFrozen = false; // the dev panel sets this right before it swaps the save and reloads
function writeSave() { if (savesFrozen) return; save.clock = hourNow(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
// difficulty follows your best axe, so a strong axe never one-shots everything
const bestIdx = () => { let b = 0; save.owned.forEach((o, i) => { if (o) b = i; }); return b; };
const gunPow = () => { let p = 0; (save.gunOwned || []).forEach((o, i) => { if (o) p = Math.max(p, GUNS[i].pow); }); return p; };
const gunTier = () => (save.gunOwned || []).filter(Boolean).length * 2;
const bestDmg = () => Math.max(AXES[bestIdx()].dmg, gunPow());
const isleHp = () => [1, 1, 1.7, 2.2, 2.8, 3.6][isle], isleRw = () => [1, 1, 1.6, 2.1, 2.8, 3.6][isle], isleDm = () => [1, 1, 1.5, 1.9, 2.4, 3.0][isle];
// timed buffs from the Apothecary and the Moonwell (they tick on play time, so pausing doesn't waste them)
const buffOn = k => (save.buffs[k] || 0) > save.seconds;
const dmgBuff = () => (buffOn("fury") ? 1.4 : 1) * (buffOn("blessed") ? 1.25 : 1);
let godMode = false, devSpeed = 1; // dev panel only
const hpScale = () => Math.pow(bestDmg(), 0.6); // grows much slower than your damage, so every upgrade really chops faster
const rewardScale = () => 1.5 * (1 + (bestDmg() - 1) * 0.14);
const dmgScale = () => 1 + bestIdx() * 0.1;
const ghostCost = () => Math.floor(60 * Math.pow(1.5, save.ghosts));
// each ghost swings with 80% of your axe (the one you hold or your best, whichever is stronger), with every bonus on it
const ghostHit = () => Math.max(1, Math.round(Math.max(axeDmg(), bestDmg()) * 0.8));
const priceCost = () => Math.floor(120 * Math.pow(1.8, save.priceLvl));
const hpCost = () => Math.floor(120 * Math.pow(1.7, save.hpLvl));
const bootCost = () => Math.floor(150 * Math.pow(1.9, save.bootLvl));
const oilCost = () => Math.floor(90 * Math.pow(2, save.oilLvl));
const BANDAGE_COST = 25;
// rebirth: each trip on the ferry costs 3x more and gives +50% log/fish value and +10% axe damage, forever
const rebirthCost = () => Math.round(250000 * Math.pow(3, save.rebirths || 0));
const rebirthMult = () => 1 + 0.5 * (save.rebirths || 0);
const logValue = () => Math.round((4 + save.priceLvl * 2) * rebirthMult() * (isle === 3 ? 4 : isle === 2 ? 2.5 : 1));
const ghostIncome = () => 0; // ghosts now earn by really chopping trees
const maxHpNow = () => 100 + save.hpLvl * 20 + 50 * (save.rebirths || 0); // every rebirth makes you +50 HP tougher, forever

// ---------- time of day ----------
let clockT = (clamp(save.clock, 0, 24) / 24) * DAY_LEN;
const hourNow = () => (clockT / DAY_LEN) * 24;
const sunElev = () => Math.sin(((hourNow() - 6) / 24) * Math.PI * 2); // +1 noon, -1 midnight
const dayAmt = () => clamp(sunElev() * 2.2 + 0.35, 0, 1);
const isNight = () => dayAmt() < 0.2;
const fmtClock = () => { const h = hourNow(); const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0"); };

// ---------- audio ----------
let actx = null, windGain = null, master = null;
const audioOut = () => master || actx.destination; // every sound goes through the master volume
function sfx(freq, dur, type = "square", vol = 0.12, slide = 0.5) {
    if (!actx) return;
    const o = actx.createOscillator(), gn = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, actx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), actx.currentTime + dur);
    gn.gain.setValueAtTime(vol, actx.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(gn).connect(audioOut());
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
    isle1.add(terrainMesh[1] = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    const wg = new THREE.PlaneGeometry(1600, 1600);
    wg.rotateX(-Math.PI / 2);
    waterMesh = new THREE.Mesh(wg, wtr(new THREE.MeshLambertMaterial({ color: 0x2f78a8, emissive: 0x0a2a40, transparent: true, opacity: 0.9, flatShading: true })));
    waterMesh.position.y = -0.45;
    scene.add(waterMesh);

    const sp = [];
    for (let i = 0; i < 350; i++) {
        const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3 + 0.1, r = 380;
        sp.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    starMat = new THREE.PointsMaterial({ color: 0xffffff, size: MODERN ? 2.4 : 1.6, sizeAttenuation: false, fog: false, transparent: true });
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
// Mooncap Isle has its own sky: periwinkle days, pink dusks, deep violet nights
const cNightFog3 = new THREE.Color(0x150a30), cDayFog3 = new THREE.Color(0xa6b4f2), cDusk3 = new THREE.Color(0xff7ab4);
const cNightAmb3 = new THREE.Color(0x7a5ab8), cDayAmb3 = new THREE.Color(0xe6dcff);
// Ashfall Isle: hazy orange days, blood-red dusks, nights lit by the volcano
const cNightFog4 = new THREE.Color(0x1c0a06), cDayFog4 = new THREE.Color(0xb8907a), cDusk4 = new THREE.Color(0xff4a1a);
const cNightAmb4 = new THREE.Color(0x8a3a2a), cDayAmb4 = new THREE.Color(0xffe2cc);
const tmpC = new THREE.Color();
function applySky() {
    const d = dayAmt(), el = sunElev(), m3 = isle === 3, m4 = isle === 4;
    const dusk = clamp(1 - Math.abs(el) * 4.5, 0, 1) * 0.65;
    tmpC.copy(m4 ? cNightFog4 : m3 ? cNightFog3 : cNightFog).lerp(m4 ? cDayFog4 : m3 ? cDayFog3 : cDayFog, d).lerp(m4 ? cDusk4 : m3 ? cDusk3 : cDusk, dusk * 0.7);
    const gray = clamp(wx.rain * 0.8 + wx.cloud * 0.25 + wx.fog * 0.6, 0, 1), blood = isBlood() ? 1 - d : 0;
    tmpC.lerp(cGray, gray * (0.25 + 0.5 * d)).lerp(cBlood, blood * 0.7);
    if (wx.light > 0) tmpC.lerp(cLightning, wx.light * 0.6);
    scene.background.copy(tmpC);
    scene.fog.color.copy(tmpC);
    scene.fog.near = lerp(6, 16, d) * (1 - wx.fog * 0.75) * (1 - wx.rain * 0.25);
    scene.fog.far = lerp(lerp(56, 120, d), 34, wx.fog) * (1 - wx.rain * 0.25) * (1 - blood * 0.25);
    ambL.color.copy(m4 ? cNightAmb4 : m3 ? cNightAmb3 : cNightAmb).lerp(m4 ? cDayAmb4 : m3 ? cDayAmb3 : cDayAmb, d).lerp(cRed, blood * 0.45);
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
    if (m3) sky3(d);
    if (m4) { scene.fog.near *= 1.6; scene.fog.far *= 2.4; sky4(d); } // the volcano should always loom over the island
    if (isle === 5) { scene.fog.near *= 2.2; scene.fog.far *= 3.6; } // the other islands stay in sight across the water
    if (inCasino()) casinoSky(); else if (inCave()) caveSky();
    if (MODERN) gfxSky();
}

// ---------- MODERN: sky dome, hemisphere light, sun shadows that follow you, grass ----------
const hemiL = new THREE.HemisphereLight(0xffffff, 0x404040, 0);
const skyDome = MODERN ? new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { hz: { value: new THREE.Color() }, zn: { value: new THREE.Color() }, sd: { value: new THREE.Vector3(0, 1, 0) }, sc: { value: new THREE.Color() } },
    vertexShader: "varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 hz; uniform vec3 zn; uniform vec3 sd; uniform vec3 sc; varying vec3 vD;
void main(){ vec3 d = normalize(vD); vec3 c = mix(hz, zn, smoothstep(0.0, 0.62, d.y));
  float s = max(dot(d, sd), 0.0); c += sc * (pow(s, 10.0) * 0.3 + pow(s, 80.0) * 0.7); gl_FragColor = vec4(c, 1.0); }`
})) : null;
if (MODERN) {
    skyDome.renderOrder = -100; skyDome.frustumCulled = false; scene.add(skyDome);
    scene.add(hemiL, sunL.target);
    if (GQ.shadow) {
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = GQ.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
        sunL.castShadow = true; sunL.shadow.mapSize.set(GQ.shadow, GQ.shadow);
        const sc = sunL.shadow.camera; sc.left = sc.bottom = -GQ.sr; sc.right = sc.top = GQ.sr; sc.near = 1; sc.far = 340; sc.updateProjectionMatrix();
        sunL.shadow.bias = -0.0006; sunL.shadow.normalBias = 0.06;
    }
}
const gfxT = { v: new THREE.Vector3(), lx: new THREE.Vector3(), ly: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), c: new THREE.Color(), deep: new THREE.Color(0x2a5aa8) };
// runs at the end of applySky: turn the flat ambient into sky-above / ground-below light, aim the sun, tint the dome
function gfxSky() {
    const d = dayAmt(), fog = scene.fog.color;
    hemiL.color.copy(ambL.color).lerp(fog, 0.3);
    hemiL.groundColor.copy(ambL.color).multiplyScalar(0.32);
    hemiL.intensity = ambL.intensity * 0.82;
    ambL.intensity *= 0.42;
    const ld = gfxT.v.copy(sunL.position).normalize();
    TSU.tsSunDir.value.copy(ld);
    TSU.tsSunCol.value.copy(sunL.color).multiplyScalar(sunL.intensity * 0.55);
    TSU.tsSky.value.copy(fog).lerp(ambL.color, 0.25);
    // the shadow box follows the camera, snapped to whole shadow texels so edges don't crawl as you walk
    if (GQ.shadow) {
        const lx = gfxT.lx.crossVectors(gfxT.up, ld).normalize(), ly = gfxT.ly.crossVectors(ld, lx), p = camera.position, tx = (GQ.sr * 2) / GQ.shadow;
        const fx = Math.round(p.dot(lx) / tx) * tx, fy = Math.round(p.dot(ly) / tx) * tx, fz = p.dot(ld);
        sunL.target.position.set(0, 0, 0).addScaledVector(lx, fx).addScaledVector(ly, fy).addScaledVector(ld, fz);
        sunL.position.copy(sunL.target.position).addScaledVector(ld, 160);
        sunL.target.updateMatrixWorld();
    }
    const U = skyDome.material.uniforms;
    U.hz.value.copy(fog);
    U.zn.value.copy(fog).lerp(gfxT.deep, 0.42 * d).multiplyScalar(lerp(0.5, 0.82, d));
    const sunUp = sunMesh.visible;
    U.sd.value.copy(sunUp ? sunMesh.position : moonMesh.position).sub(camera.position).normalize();
    U.sc.value.copy(sunUp ? sunL.color : gfxT.c.setRGB(0.35, 0.4, 0.6)).multiplyScalar(sunUp ? 0.6 * (1 - 0.7 * wx.cloud) : 0.18);
    skyDome.visible = camera.position.x < 1500; // caves, the mine and the casino are indoors
}

// shadows + texture filtering for everything in the scene (new things get picked up on the next sweep)
function gfxSweep() {
    scene.traverse(o => {
        if (!o.isMesh || o.userData.gfx) return;
        o.userData.gfx = 1;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!m) return;
        for (const mm of Array.isArray(o.material) ? o.material : [o.material]) {
            const t = mm.map;
            if (t && t.magFilter === THREE.NearestFilter) { t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true; }
        }
        const lit = m.isMeshLambertMaterial || m.isMeshStandardMaterial || m.isMeshPhongMaterial;
        if (!GQ.shadow || !lit) return;
        o.receiveShadow = !m.transparent || m.opacity > 0.8;
        // only big things cast (trees, buildings, rocks): small parts cost a draw call each and their shadows are barely visible
        let big = false;
        if (!m.transparent && !terrainMesh.includes(o) && !o.userData.noCast && !(m.defines && m.defines.TS_WATER)) {
            const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
            o.getWorldScale(gfxT.v); big = g.boundingSphere.radius * Math.max(gfxT.v.x, gfxT.v.y, gfxT.v.z) > 0.9;
        }
        o.castShadow = big;
    });
}

// ---- grass: one instanced mesh; the GPU wraps every clump to the copy nearest you, and reads height + colour from the ground ----
const grass = MODERN && GQ.grass ? (() => {
    const blades = [], R = Math.random;
    for (let b = 0; b < 7; b++) {
        const a = R() * 6.283, ox = (R() - 0.5) * 0.45, oz = (R() - 0.5) * 0.45, h = 0.16 + R() * 0.28, w = 0.03 + R() * 0.025, lean = (R() - 0.5) * 0.3;
        const ca = Math.cos(a), sa = Math.sin(a);
        const P = [[-w, 0, 0], [w, 0, 0], [0, h, lean]];
        blades.push({ pts: P.map(([x, y, z]) => [ox + x * ca - z * sa, y, oz + x * sa + z * ca]) });
    }
    const pos = [], col = [], nor = [], idx = [];
    for (const bl of blades) {
        const base = pos.length / 3;
        for (const p of bl.pts) { pos.push(...p); const t = p[1] / 0.46; col.push(0.55 + t * 0.75, 0.6 + t * 0.75, 0.5 + t * 0.6); nor.push(0, 1, 0); }
        idx.push(base, base + 1, base + 2);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    const A = GQ.gr * 2.2, off = new Float32Array(GQ.grass * 4);
    for (let i = 0; i < GQ.grass; i++) { off[i * 4] = R() * A; off[i * 4 + 1] = R() * A; off[i * 4 + 2] = R() * 6.283; off[i * 4 + 3] = 0.7 + R() * 0.6; }
    g.setAttribute("aOff", new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = GQ.grass;
    const gu = { tsCam: { value: new THREE.Vector3() }, tsGA: { value: A }, tsGR: { value: GQ.gr }, tsTB: { value: new THREE.Vector4(0, 0, 1, 2) }, tsGrassC: { value: null }, tsGrassH: { value: null } };
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    m.defines = { TS_NODETAIL: "" };
    m.onBeforeCompile = sh => {
        modernShader(sh); Object.assign(sh.uniforms, gu);
        sh.fragmentShader = sh.fragmentShader.replace("normal *= faceDirection;", ""); // both sides of a blade face the sky
        sh.vertexShader = "attribute vec4 aOff;\nuniform vec3 tsCam;\nuniform float tsGA;\nuniform float tsGR;\nuniform vec4 tsTB;\nuniform sampler2D tsGrassC;\nuniform sampler2D tsGrassH;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
{ vec2 base = aOff.xy + floor((tsCam.xz - aOff.xy) / tsGA + 0.5) * tsGA;
  vec2 guv = ((base - tsTB.xy) / tsTB.z + 0.5) / tsTB.w;
  vec4 gc = texture2D(tsGrassC, guv); float gh = texture2D(tsGrassH, guv).r;
  float d = length(base - tsCam.xz);
  float s = aOff.w * smoothstep(0.35, 0.8, gc.a) * (1.0 - smoothstep(tsGR * 0.55, tsGR, d));
  float cr = cos(aOff.z), sr = sin(aOff.z);
  vec3 p = transformed * vec3(s, s * (0.8 + 0.4 * gc.a), s); p.xz = vec2(cr * p.x - sr * p.z, sr * p.x + cr * p.z);
  float bend = p.y * p.y;
  p.x += (sin(tsTime * 1.9 + base.x * 0.35 + base.y * 0.21) + 0.5 * sin(tsTime * 4.3 + base.x * 1.3)) * 0.16 * bend;
  p.z += cos(tsTime * 1.5 + base.y * 0.33 + base.x * 0.1) * 0.1 * bend;
  vec2 away = base - tsCam.xz; float pd = length(away); if (pd < 0.9 && pd > 0.01) p.xz += away / pd * (0.9 - pd) * p.y * 0.8;
  transformed = p + vec3(base.x, gh - 0.05, base.y);
  vColor *= gc.rgb * (0.85 + 0.3 * fract(aOff.z * 7.31)); }`);
    };
    m.customProgramCacheKey = () => "ts_grass";
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.userData.gfx = 1;
    scene.add(mesh);
    return { mesh, u: gu, isle: -1 };
})() : null;
// what counts as grassy ground on each island (by the ground's own colour)
function grassAmt(h, s, l, y, isl) {
    if (y < -0.25) return 0;
    if (isl === 5) return s > 0.3 && ((h > 0.2 && h < 0.45) || (h > 0.7 && h < 0.85)) && l < 0.42 ? 1 : 0; // tropical grass on Port Haven, heather on Storm Isle
    if (isl === 4) return h > 0.11 && h < 0.3 && s > 0.15 ? 0.75 : 0;          // tough olive scrub in the ash
    if (isl === 3) return s > 0.3 && h > 0.44 && h < 0.84 && l < 0.34 ? 1 : 0; // teal and violet meadows
    return s > 0.26 && h > 0.17 && h < 0.5 && l < 0.34 ? 1 : 0;
}
function bakeGrass() {
    const tm = terrainMesh[isle];
    grass.isle = isle; grass.tm = terrainMesh[isle];
    if (!tm) { grass.mesh.visible = false; return; }
    const g = tm.geometry, P = g.parameters, n = P.widthSegments + 1, step = P.width / P.widthSegments, minX = tm.position.x - P.width / 2, minZ = tm.position.z - P.height / 2;
    const pos = g.attributes.position, col = g.attributes.color, N = n * n, hsl = {}, c = gfxT.c;
    const C = new Float32Array(N * 4), H = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const y = pos.getY(i);
        c.fromBufferAttribute(col, i); c.getHSL(hsl);
        const a = grassAmt(hsl.h, hsl.s, hsl.l, y, isle);
        C[i * 4] = c.r * 1.25; C[i * 4 + 1] = c.g * 1.3; C[i * 4 + 2] = c.b * 1.15; C[i * 4 + 3] = a; H[i] = y + tm.position.y;
    }
    // no grass inside buildings, fences or on the paths round obstacles
    const clear = (x0, x1, z0, z1) => {
        const i0 = Math.max(0, Math.floor((x0 - minX) / step)), i1 = Math.min(n - 1, Math.ceil((x1 - minX) / step)), j0 = Math.max(0, Math.floor((z0 - minZ) / step)), j1 = Math.min(n - 1, Math.ceil((z1 - minZ) / step));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) C[(j * n + i) * 4 + 3] = 0;
    };
    for (const b of colliders) clear(b[0] - 0.6, b[1] + 0.6, b[2] - 0.6, b[3] + 0.6);
    for (const ci of circles) if (ci.r > 1.5) clear(ci.x - ci.r * 0.8, ci.x + ci.r * 0.8, ci.z - ci.r * 0.8, ci.z + ci.r * 0.8);
    const mk = (data, fmt) => { const hd = new Uint16Array(data.length); for (let i = 0; i < data.length; i++) hd[i] = THREE.DataUtils.toHalfFloat(data[i]); const t = new THREE.DataTexture(hd, n, n, fmt, THREE.HalfFloatType); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
    if (grass.u.tsGrassC.value) { grass.u.tsGrassC.value.dispose(); grass.u.tsGrassH.value.dispose(); }
    grass.u.tsGrassC.value = mk(C, THREE.RGBAFormat); grass.u.tsGrassH.value = mk(H, THREE.RedFormat);
    grass.u.tsTB.value.set(minX, minZ, step, n);
    grass.mesh.visible = true;
}
// ---- point-light pool: only the few lights nearest you actually light the scene ----
// (every point light costs every pixel, and the caves, mine and casino keep theirs in the scene the whole time)
const LIGHT_POOL = 8, lightPool = [], vLights = new Set(), lpV = new THREE.Vector3(), lpCand = [];
for (let i = 0; i < LIGHT_POOL; i++) { const L = new THREE.PointLight(0xffffff, 0, 1, 2); L.userData.pool = 1; scene.add(L); lightPool.push(L); }
let lpN = 0;
function lightsFrame() {
    if (lpN++ % 60 === 0) scene.traverse(o => { if (o.isPointLight && !o.userData.pool && o !== lantern && !vLights.has(o)) { vLights.add(o); o.layers.set(5); } }); // off the camera's layer: no longer drawn directly
    const cp = camera.position; lpCand.length = 0;
    for (const L of vLights) {
        if (!L.parent) { vLights.delete(L); continue; }
        let on = L.intensity > 0; for (let o = L; on && o; o = o.parent) if (!o.visible) on = false;
        if (!on) continue;
        L.getWorldPosition(lpV); const reach = L.distance > 0 ? L.distance : 80, d = lpV.distanceTo(cp);
        if (d > reach + 30) continue;
        lpCand.push({ L, d: d - reach * 0.5, x: lpV.x, y: lpV.y, z: lpV.z });
    }
    lpCand.sort((a, b) => a.d - b.d);
    for (let i = 0; i < LIGHT_POOL; i++) {
        const P = lightPool[i], c = lpCand[i];
        if (!c) { P.intensity = 0; continue; }
        P.position.set(c.x, c.y, c.z); P.color.copy(c.L.color); P.intensity = c.L.intensity; P.distance = c.L.distance; P.decay = c.L.decay;
    }
}
let gfxN = 0;
function gfxFrame(dt) {
    TSU.tsTime.value += dt;
    if (skyDome) skyDome.position.copy(camera.position);
    if (gfxN % 45 === 0) gfxSweep();
    if (GQ.shadow) renderer.shadowMap.needsUpdate = gfxN % GQ.every === 0 && camera.position.x < 1500;
    gfxN++;
    if (grass) {
        if (grass.isle !== isle || grass.tm !== terrainMesh[isle]) bakeGrass();
        grass.u.tsCam.value.copy(camera.position);
        grass.mesh.visible = !!terrainMesh[isle] && camera.position.x < 1500;
    }
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
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex("REBIRTH 1", "HIGHLAND ISLE", "#ffe080"), side: THREE.DoubleSide }));
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
    if (p.x > 4500) { clampCasino(p); return; }
    if (isle === 5) { clampIsle5(p); return; }
    if (isle === 4) { clampIsle4(p); return; }
    if (isle === 3) { clampIsle3(p); return; }
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
    const water = new THREE.Mesh(new THREE.CircleGeometry(7, 20), wtr(new THREE.MeshLambertMaterial({
        color: 0x2a5a8a, emissive: 0x0a2a4a, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
    })));
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
    colossus: { name: "Colossus Tree",  leaf: [0x1f5a3a, 0x2a4a6a],           trunk: 0x5a4a38, hp: 9,   logs: 8,   dmg: 2.6, speed: 0.6,  bonus: 80, wd: 0.05, wn: 0.05, col: "#ffe0a0", isl: [2], minTier: 8, titan: true, mat: "gold" },
    // ---- Mooncap Isle ----
    glowcap:     { name: "Glowcap",         leaf: [0x8a5ae0, 0x5a7ae8, 0xc06ad8], trunk: 0xe0d4c0, hp: 1.3, logs: 1.6, dmg: 1.1,  speed: 1,   bonus: 6,  wd: 0.9,  wn: 0.7,  col: "#c8a0ff", glow: 0x1a0a30, isl: [3], mat: "spore" },
    silverbirch: { name: "Silver Birch",    leaf: [0xb8e0c8, 0xd0ecf4, 0x9ad0b8], trunk: 0xe8e4f0, hp: 1.6, logs: 1.4, dmg: 1.15, speed: 1,   bonus: 8,  wd: 0.7,  wn: 0.4,  col: "#dfe8ff", isl: [3], mat: "silver" },
    amberpine:   { name: "Amber Pine",      leaf: [0x2a5a4a, 0x2a4a5a],           trunk: 0x6a3a1a, hp: 2.0, logs: 1.3, dmg: 1.2,  speed: 1,   bonus: 10, wd: 0.5,  wn: 0.35, col: "#ffb040", isl: [3], minTier: 2, mat: "amber" },
    moonbloom:   { name: "Moonbloom",       leaf: [0xe8d8ff, 0xd0c4f8],           trunk: 0x4a3a5a, hp: 2.4, logs: 1.3, dmg: 1.25, speed: 1,   bonus: 14, wd: 0.25, wn: 0.5,  col: "#9fd8ff", glow: 0x2a2a5a, isl: [3], minTier: 4, mat: "moonstone" },
    gloomwood:   { name: "Gloomwood",       leaf: [0x2a1a4a],                     trunk: 0x1a1024, hp: 3.0, logs: 1.5, dmg: 1.5,  speed: 1.2, bonus: 20, wd: 0,    wn: 0.22, col: "#a070ff", glow: 0x200a40, isl: [3], rare: true, night: true, minTier: 5, mat: "void" },
    voidspire:   { name: "Voidspire",       leaf: [0x6a3aff, 0x3a1a8a],           trunk: 0x1a1430, hp: 3.6, logs: 1.8, dmg: 1.6,  speed: 1.1, bonus: 30, wd: 0.08, wn: 0.18, col: "#8a5aff", glow: 0x3a10a0, isl: [3], minTier: 7, mat: "void" },
    starwisp:    { name: "Starwisp",        leaf: [0xfff2a0],                     trunk: 0xd8c8a0, hp: 2,   logs: 0.3, dmg: 0,    speed: 1,   bonus: 40, wd: 0.02, wn: 0.06, col: "#fff6a0", glow: 0x6a5a10, isl: [3], rare: true, flee: true, mat: "star" },
    mooncap:     { name: "Ancient Mooncap", leaf: [0x6a4ae0, 0x9a5ad8],           trunk: 0xd8ccb8, hp: 8,   logs: 6,   dmg: 2.4,  speed: 0.6, bonus: 90, wd: 0.05, wn: 0.06, col: "#e0c8ff", glow: 0x200a40, isl: [3], minTier: 8, titan: true, mat: "moonstone" },
    // ---- Ashfall Isle ----
    ashwood:   { name: "Ashwood",         leaf: [0x5a5450, 0x4a4440],           trunk: 0x2a2220, hp: 1.3, logs: 1.6, dmg: 1.1,  speed: 1,   bonus: 6,  wd: 0.9,  wn: 0.7,  col: "#c8bcb0", isl: [4], mat: "ash" },
    cinderpine:{ name: "Cinder Pine",     leaf: [0x2a2624, 0x3a2a24],           trunk: 0x1a1210, hp: 1.6, logs: 1.4, dmg: 1.15, speed: 1,   bonus: 8,  wd: 0.7,  wn: 0.45, col: "#ff8a5a", glow: 0x1a0600, isl: [4], mat: "cinder" },
    sulfurspire:{ name: "Sulfur Spire",   leaf: [0xd8c83a, 0xc8b030],           trunk: 0x5a4a1a, hp: 2.0, logs: 1.3, dmg: 1.2,  speed: 1,   bonus: 10, wd: 0.5,  wn: 0.35, col: "#ffe060", glow: 0x3a3000, isl: [4], minTier: 2, mat: "sulfur" },
    obsidianoak:{ name: "Obsidian Oak",   leaf: [0x1a1420, 0x24182e],           trunk: 0x100c14, hp: 2.6, logs: 1.3, dmg: 1.3,  speed: 1,   bonus: 14, wd: 0.3,  wn: 0.3,  col: "#b88aff", glow: 0x0a0414, isl: [4], minTier: 4, mat: "obsidian" },
    emberwillow:{ name: "Ember Willow",   leaf: [0xff6a1a, 0xff8a2a],           trunk: 0x2a1008, hp: 3.2, logs: 1.5, dmg: 1.5,  speed: 1.1, bonus: 22, wd: 0.12, wn: 0.35, col: "#ff7a3a", glow: 0x8a2a00, isl: [4], minTier: 6, mat: "ember" },
    phoenixtree:{ name: "Phoenix Tree",   leaf: [0xffa02a, 0xffd060],           trunk: 0x6a2a10, hp: 2,   logs: 0.3, dmg: 0,    speed: 1,   bonus: 50, wd: 0.02, wn: 0.07, col: "#ffc060", glow: 0xa04000, isl: [4], rare: true, flee: true, night: true, mat: "phoenixf" },
    basalt:    { name: "Basalt Colossus", leaf: [0x2a2626, 0x3a3030],           trunk: 0x1e1a1a, hp: 9,   logs: 7,   dmg: 2.8,  speed: 0.6, bonus: 100, wd: 0.05, wn: 0.05, col: "#d8a080", isl: [4], minTier: 9, titan: true, mat: "obsidian" },
    emberling: { name: "Emberling",       leaf: [0xff5a1a, 0xff8a2a],           trunk: 0x2a0a04, hp: 0.6, logs: 0.6, dmg: 0.85, speed: 2.5, bonus: 0,  wd: 0,    wn: 0,    col: "#ffa040", glow: 0x6a1a00, isl: [], rush: true, mat: "ash" },
    // Christmas trees: one on every island. Rare, harmless-ish, and a present falls out when they go down
    xmaspine: { name: "Christmas Pine",       leaf: [0x1e5a34, 0x1a4e2e],           trunk: 0x4a3024, hp: 1.8, logs: 2.2, dmg: 1.05, speed: 0.9, bonus: 18, wd: 0.06, wn: 0.07, col: "#ff5a5a", rare: true, xmas: true, isl: [1] },
    xmasfir:  { name: "Frosted Christmas Fir", leaf: [0x1e4e3e, 0x24584a],          trunk: 0x4a3a30, hp: 2.0, logs: 2.4, dmg: 1.1,  speed: 0.9, bonus: 24, wd: 0.06, wn: 0.07, col: "#ff6a6a", rare: true, xmas: true, isl: [2], mat: "wood" },
    xmasmoon: { name: "Starlight Spruce",      leaf: [0x1a2a5a, 0x22306a],          trunk: 0x3a3048, hp: 2.2, logs: 2.4, dmg: 1.15, speed: 0.9, bonus: 30, wd: 0.06, wn: 0.08, col: "#bfe0ff", glow: 0x0a1030, rare: true, xmas: true, isl: [3], mat: "silver" },
    xmasash:  { name: "Yule Ember Tree",       leaf: [0x2a2624, 0x342a26],          trunk: 0x1a1210, hp: 2.4, logs: 2.4, dmg: 1.2,  speed: 0.9, bonus: 36, wd: 0.06, wn: 0.08, col: "#ffb040", glow: 0x1a0800, rare: true, xmas: true, isl: [4], mat: "cinder" },
    // the Elder Heart's children: they never spawn on their own, and they don't care if you're looking
    thornling:   { name: "Thornling",       leaf: [0x6a1a3a, 0x8a2a4a],           trunk: 0x2a0a18, hp: 0.6, logs: 0.6, dmg: 0.8,  speed: 2.4, bonus: 0,  wd: 0,    wn: 0,    col: "#ff5a8a", glow: 0x3a0018, isl: [], rush: true, mat: "spore" }
};
const typeMats = {};
for (const [k, T] of Object.entries(TYPES)) {
    const base = { flatShading: true };
    if (T.glow !== undefined) base.emissive = T.glow;
    if (T.ghost) { base.transparent = true; base.opacity = 0.72; base.depthWrite = false; }
    typeMats[k] = { trunk: new THREE.MeshLambertMaterial({ color: T.trunk, ...base }), leaves: T.leaf.map(c => windy(new THREE.MeshLambertMaterial({ color: c, ...base }))) };
}
// ---------- tree mutations: rare glowing variants with their own look, sparkles and a big drop multiplier ----------
const MUTS = {
    golden:    { name: "GOLDEN",    col: "#ffd040", mult: 3, hp: 1.4, w: 30, leaf: 0xffd040, em: 0x6a4a00, trunk: 0xb08a30, temb: 0x3a2a00, fx: 0xfff0a0, mode: "sparkle" },
    frozen:    { name: "FROZEN",    col: "#9fe8ff", mult: 2, hp: 1.3, w: 30, leaf: 0xd8f6ff, em: 0x1a4a6a, trunk: 0x8aaac8, temb: 0x0a1a2a, fx: 0xffffff, mode: "snow" },
    shocked:   { name: "SHOCKED",   col: "#fff36a", mult: 2.5, hp: 1.3, w: 16, leaf: 0xfff6b0, em: 0x6a6000, fx: 0xffff70, mode: "zap", pulse: 1 },
    giant:     { name: "GIANT",     col: "#ffb08a", mult: 2.5, hp: 2, w: 16, giant: 1.65, fx: 0xffd8b0, mode: "dust" },
    molten:    { name: "MOLTEN",    col: "#ff8a2a", mult: 3, hp: 1.5, w: 10, leaf: 0x4a1a0a, em: 0xc03a00, trunk: 0x2a1008, temb: 0x601800, fx: 0xff8a2a, mode: "ember", pulse: 1 },
    bloodlit:  { name: "BLOODLIT",  col: "#ff3a4a", mult: 3, hp: 1.5, w: 0, leaf: 0xb0101a, em: 0x5a0008, fx: 0xff3040, mode: "drip", pulse: 1 },
    rainbow:   { name: "RAINBOW",   col: "#ffffff", mult: 5, hp: 1.6, w: 5, rainbow: 1, leaf: 0xff0000, em: 0x200000, fx: 0xffffff, mode: "sparkle" },
    celestial: { name: "CELESTIAL", col: "#d8e0ff", mult: 6, hp: 1.8, w: 0, leaf: 0x2a2a80, em: 0x30308a, trunk: 0x1a1a40, temb: 0x0a0a30, fx: 0xffffff, mode: "stars", pulse: 1 }
};
const MUT_KEYS = Object.keys(MUTS);
function mutW(k) {
    let w = MUTS[k].w, storm = 0;
    try { storm = wx.storm; } catch (e) { /* weather isn't set up yet on the very first spawn */ }
    if (k === "bloodlit") w = isBlood() ? 40 : 0;
    if (k === "celestial") w = isNight() ? 6 : 0;
    if (k === "shocked" && storm > 0.4) w *= 4;
    if (k === "molten") w *= isle === 4 ? 3 : 0.5;
    if (k === "frozen" && isle === 4) w *= 0.3;
    return w;
}
function rollMut() {
    if (Math.random() > 0.07 * (isBlood() ? 1.8 : 1) * (buffOn("lucky") ? 1.5 : 1)) return null;
    let tot = 0; for (const k of MUT_KEYS) tot += mutW(k);
    let r = Math.random() * tot;
    for (const k of MUT_KEYS) { r -= mutW(k); if (r <= 0) return k; }
    return null;
}
const mutMats = {};
function mutMat(k) {
    if (mutMats[k]) return mutMats[k];
    const M = MUTS[k], o = {};
    if (M.leaf !== undefined) o.leaf = windy(new THREE.MeshLambertMaterial({ color: M.leaf, emissive: M.em || 0, flatShading: true }));
    if (M.trunk !== undefined) o.trunk = new THREE.MeshLambertMaterial({ color: M.trunk, emissive: M.temb || 0, flatShading: true });
    o.fx = new THREE.MeshBasicMaterial({ color: M.fx, transparent: true, opacity: 0.95, depthWrite: false });
    return (mutMats[k] = o);
}
const mutCol = k => (k === "rainbow" ? `hsl(${Math.floor((performance.now() / 8) % 360)},90%,65%)` : MUTS[k].col);
function applyMut(t, k) {
    const M = MUTS[k], mm = mutMat(k), base = typeMats[t.key];
    t.mut = k;
    t.hp = t.maxHp = Math.ceil(t.maxHp * M.hp);
    t.body.traverse(o => { if (!o.isMesh) return; if (mm.leaf && base.leaves.includes(o.material)) o.material = mm.leaf; else if (mm.trunk && o.material === base.trunk) o.material = mm.trunk; });
    t.fxT = Math.random() * 0.3;
}
let lastMutToast = -99;
const armMat = new THREE.MeshLambertMaterial({ color: 0x2c1c16, flatShading: true });
// how each species is shaped: conifer tiers, round broadleaf canopies, tall redwoods, dead spiky blood trees, crystal shards
const TREE_STYLE = {
    pine: { s: "conifer" }, elder: { s: "round" }, ghost: { s: "conifer" }, blood: { s: "dead", dots: 0xff3030 }, ironwood: { s: "conifer" },
    frostbark: { s: "conifer", snow: true }, emberwood: { s: "round", dots: 0xffa040 }, titan: { s: "conifer" }, gold: { s: "round", dots: 0xfff4b0 },
    larch: { s: "round" }, stonebark: { s: "round", rocks: true }, copperleaf: { s: "round", dots: 0xffb070 }, ironbark: { s: "conifer" },
    powderwood: { s: "spiky", dots: 0xff3a2a }, goldleaf: { s: "round", dots: 0xfff4b0 }, redwood: { s: "tall" }, snowpine: { s: "conifer", snow: true },
    crystal: { s: "crystal", dots: 0xbffff6 }, magma: { s: "round", dots: 0xffa030 }, colossus: { s: "conifer" },
    glowcap: { s: "shroom", dots: 0xfff0ff }, silverbirch: { s: "birch", dots: 0x2a2a34 }, amberpine: { s: "conifer", dots: 0xffb040 }, moonbloom: { s: "round", dots: 0xf4f6ff },
    gloomwood: { s: "dead", dots: 0xb07aff }, voidspire: { s: "crystal", dots: 0xd8b0ff }, starwisp: { s: "round", dots: 0xffffff }, mooncap: { s: "shroom", dots: 0xfff0ff },
    thornling: { s: "spiky", dots: 0xff4a8a },
    ashwood: { s: "dead", dots: 0xff6a2a }, cinderpine: { s: "conifer", dots: 0xff7a2a }, sulfurspire: { s: "crystal", dots: 0xfff4a0 }, obsidianoak: { s: "round", dots: 0xb07aff },
    emberwillow: { s: "round", dots: 0xffe070 }, phoenixtree: { s: "round", dots: 0xffffff }, basalt: { s: "conifer", dots: 0xff6a2a }, emberling: { s: "spiky", dots: 0xffd040 },
    xmaspine: { s: "xmas", dots: 0xffe9a0, orn: [0xff3a3a, 0xffd040, 0x3a8aff], star: 0xffe060 }, xmasfir: { s: "xmas", dots: 0xffffff, snow: true, orn: [0xff3a3a, 0xf4f8ff, 0xffd040], star: 0xffe060 },
    xmasmoon: { s: "xmas", dots: 0xbfe0ff, orn: [0xd8e8ff, 0xb07aff, 0x7affef], star: 0xffffff }, xmasash: { s: "xmas", dots: 0xffd040, orn: [0xff6a1a, 0xffd040, 0xff2a2a], star: 0xffa020 }
};
const ornMats = {};
const ornMat = c => ornMats[c] || (ornMats[c] = new THREE.MeshBasicMaterial({ color: c }));
const snowMat = new THREE.MeshLambertMaterial({ color: 0xf2f6ff, flatShading: true }), rockMat = new THREE.MeshLambertMaterial({ color: 0x7a7a84, flatShading: true });
const dotMats = {};
const ni = g => (g.index ? g.toNonIndexed() : g);
// MODERN canopies: a rounder, lumpier blob instead of a 20-sided gem (normals stay round so it shades softly)
const lumpy = (g, rad) => {
    if (!MODERN) return g;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), q = v => Math.round((v / rad) * 500), h = Math.sin(q(x) * 12.9898 + q(y) * 78.233 + q(z) * 37.719) * 43758.5453, k = 1 + (h - Math.floor(h) - 0.5) * 0.24; p.setXYZ(i, x * k, y * k, z * k); }
    return g;
};
function treeShape(key, r, h) {
    const st = TREE_STYLE[key] || { s: "conifer" }, leaf = [], deco = [], snow = [], dots = [], rocks = [], orns = [], starG = [];
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
            const b = lumpy(new THREE.IcosahedronGeometry(r * sz, MODERN ? 1 : 0), r * sz); b.rotateY(R() * 6); b.scale(1, 0.82, 1); b.translate(x, y, z); leaf.push(b);
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
    } else if (st.s === "shroom") {
        // a giant living mushroom: one wide domed cap, gills underneath, a skirt round the stem and glowing spots on top
        const R2 = r * (3.1 + R() * 0.6), top = h * 0.98, tilt = (R() - 0.5) * 0.18;
        const cap = new THREE.SphereGeometry(R2, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5); cap.scale(1, 0.52, 1); cap.rotateZ(tilt); cap.translate(0, top, 0); leaf.push(ni(cap));
        const gill = new THREE.CylinderGeometry(R2 * 0.97, r * 0.9, R2 * 0.22, 12, 1, true); gill.rotateZ(tilt); gill.translate(0, top - R2 * 0.1, 0); deco.push(ni(gill));
        const skirt = new THREE.CylinderGeometry(r * 1.05, r * 1.35, r * 0.5, 10, 1, true); skirt.translate(0, h * 0.72, 0); deco.push(ni(skirt));
        for (let d = 0; d < 9; d++) { const a = R() * 6.283, e = 0.25 + R() * 1.1; dot(Math.cos(a) * Math.cos(e) * R2 * 0.98, top + Math.sin(e) * R2 * 0.5, Math.sin(a) * Math.cos(e) * R2 * 0.98, 0.16 + R() * 0.1); }
    } else if (st.s === "xmas") {
        // a proper Christmas tree: stacked tiers, baubles in three colours, a garland and a star on top
        const tiers = 5;
        st.orn.forEach(() => orns.push([]));
        for (let i = 0; i < tiers; i++) {
            const k = i / tiers, rad = r * 3.3 * (1 - k * 0.8), ht = h * 0.32, y = h * 0.5 + i * (h * 0.5 / tiers);
            const c = rot(new THREE.ConeGeometry(rad, ht, 9)); c.translate(0, y, 0); leaf.push(ni(c));
            if (st.snow) { const sc = rot(new THREE.ConeGeometry(rad * 0.6, ht * 0.4, 9)); sc.translate(0, y + ht * 0.32, 0); snow.push(ni(sc)); }
            const nb = 6 - i;
            for (let b = 0; b < nb; b++) { const a = (b / nb) * 6.283 + i * 0.7 + R() * 0.3, rr = rad * 0.86, o = new THREE.IcosahedronGeometry(r * 0.3, 0); o.translate(Math.cos(a) * rr, y - ht * 0.38, Math.sin(a) * rr); orns[(b + i) % orns.length].push(o); }
            for (let g = 0; g < 10; g++) { const a = (g / 10) * 6.283 + i, rr = rad * (0.62 + 0.3 * (g / 10)), d = new THREE.BoxGeometry(r * 0.12, r * 0.12, r * 0.12); d.translate(Math.cos(a) * rr, y - ht * 0.1 - (g / 10) * ht * 0.3, Math.sin(a) * rr); dots.push(d); }
        }
        const top = h * 0.5 + (tiers - 1) * (h * 0.5 / tiers) + h * 0.19;
        for (const ry of [0, Math.PI / 2]) { const p = new THREE.OctahedronGeometry(r * 0.55, 0); p.scale(0.8, 1.35, 0.35); p.rotateY(ry); p.translate(0, top, 0); starG.push(p); }
    } else if (st.s === "birch") {
        // tall pale trunk with dark bark marks and small airy leaf clumps up high
        for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.283 + R(), y = h * (0.62 + R() * 0.42), d = r * (0.6 + R() * 1.4), bs = r * (1.2 + R() * 0.7), b = lumpy(new THREE.IcosahedronGeometry(bs, MODERN ? 1 : 0), bs); b.scale(1, 1.25, 1); b.translate(Math.cos(a) * d, y, Math.sin(a) * d); leaf.push(b); }
        for (let i = 0; i < 10; i++) { const a = R() * 6.283, y = h * (0.08 + R() * 0.62), rr = r * (1.0 - 0.32 * (y / h)) * 0.97, m = new THREE.BoxGeometry(r * 0.5, r * 0.12, r * 0.08); m.rotateY(-a + Math.PI / 2); m.translate(Math.cos(a) * rr, y, Math.sin(a) * rr); dots.push(m); }
    }
    if (st.s === "palm") { // long drooping fronds from the top, coconuts underneath
        for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283 + R() * 0.3, len = h * (0.5 + R() * 0.15), c = new THREE.ConeGeometry(r * 0.95, len, 4); c.scale(1, 1, 0.22); c.translate(0, len / 2, 0); c.rotateZ(-(1.2 + R() * 0.35)); c.rotateY(-a); c.translate(0, h * 1.02, 0); leaf.push(ni(c)); }
        for (let i = 0; i < 4; i++) { const a = R() * 6.28; dot(Math.cos(a) * r * 0.55, h * 0.95, Math.sin(a) * r * 0.55, 0.32); }
    }
    const merge = a => (a.length ? mergeGeometries(a) : null);
    return { leaf: merge(leaf), deco: merge(deco), snow: merge(snow), dots: merge(dots), rocks: merge(rocks), dotCol: st.dots, orns: orns.map((a, i) => a.length ? { geo: mergeGeometries(a), col: st.orn[i] } : null).filter(Boolean), star: merge(starG), starCol: st.star };
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
    g.position.set(x, gy0 - (isle >= 2 ? 0.25 : 0), z);
    const body = new THREE.Group();
    g.add(body);
    // a slightly bent, knobbly trunk
    // how far up the canopy the trunk goes: pointed trees stop it inside their top tier so it never pokes out
    const th = h * ({ conifer: 0.86, spiky: 0.86, xmas: 0.82, tall: 0.97, birch: 0.95, dead: 0.98 }[(TREE_STYLE[key] || { s: "conifer" }).s] || 1.05);
    const tg = new THREE.CylinderGeometry(r * 0.6, r * 1.05, th, 8, 4);
    { const p = tg.attributes.position, bend = (Math.random() - 0.5) * 0.1 * h, ph = Math.random() * 6;
      for (let i = 0; i < p.count; i++) { const u = p.getY(i) / th + 0.5, k = 1 + 0.07 * Math.sin(u * 11 + ph + p.getX(i) * 3); p.setX(i, p.getX(i) * k + bend * u * u * u); p.setZ(i, p.getZ(i) * k); }
      tg.computeVertexNormals(); }
    const trunk = new THREE.Mesh(tg, M.trunk);
    trunk.position.y = th / 2;
    body.add(trunk);
    const shp = treeShape(key, r, h);
    const foliage = new THREE.Mesh(shp.leaf, M.leaves[Math.floor(Math.random() * M.leaves.length)]);
    body.add(foliage);
    if (shp.deco) body.add(new THREE.Mesh(shp.deco, M.trunk));
    if (shp.snow) body.add(new THREE.Mesh(shp.snow, snowMat));
    if (shp.rocks) body.add(new THREE.Mesh(shp.rocks, rockMat));
    if (shp.dots) body.add(new THREE.Mesh(shp.dots, dotMats[shp.dotCol] || (dotMats[shp.dotCol] = new THREE.MeshBasicMaterial({ color: shp.dotCol }))));
    for (const o of shp.orns) body.add(new THREE.Mesh(o.geo, ornMat(o.col)));
    if (shp.star) body.add(new THREE.Mesh(shp.star, ornMat(shp.starCol)));
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
    const hp = Math.ceil(h * 0.7 * T.hp * (1 + 0.05 * (save.day - 1)) * hpScale() * isleHp());
    const t = {
        g, body, face, arms, h, r, x, z, gy: gy0, key, type: T, hp, maxHp: hp, solid: [trunk, foliage],
        dying: false, burn: false, t: 0, hurt: 0, phase: Math.random() * 6, gone: false,
        mode: "calm", atk: "idle", atkT: 0, cool: 1 + Math.random() * 3, armUp: 0, swing: 0, bar: null, barT: 0, _d: 99, _seen: false
    };
    trees.push(t);
    return t;
}

function pickType(px = 0, pz = 0) {
    const night = isNight(), here = isle >= 2 ? groundY(px, pz) : 0;
    let total = 0;
    const tier = Math.max(bestIdx(), gunTier()), blood = isBlood(), tw = T => (night ? T.wn : T.wd) * (blood && T.rare ? 2.2 : 1);
    const ok = T => (T.isl || [1]).includes(isle) && (!T.arch || T.arch === arch5) && (T.minTier || 0) <= tier && (!T.alt || (here >= T.alt[0] && here <= T.alt[1]));
    for (const T of Object.values(TYPES)) if (ok(T)) total += tw(T);
    let r = Math.random() * total;
    for (const [k, T] of Object.entries(TYPES)) { if (!ok(T)) continue; r -= tw(T); if (r <= 0) return k; }
    return isle === 5 ? ({ haven: "palm", coral: "coralwood", skull: "tarpine", frost: "frostpine", storm: "stormoak" })[arch5] : isle === 4 ? "ashwood" : isle === 3 ? "glowcap" : isle === 2 ? "larch" : "pine";
}
let lastRareToast = -99;
function spawnTree(announce = true) {
    for (let tries = 0; tries < 40; tries++) {
        const a = Math.random() * Math.PI * 2, d = SAFE_R + 4 + Math.random() * (curShoreR(a) - 10 - SAFE_R - 4), sp5 = isle === 5 ? arch5Spot() : null;
        if (isle === 5 && !sp5) continue;
        const x = sp5 ? sp5.x : Math.cos(a) * d, z = sp5 ? sp5.z : Math.sin(a) * d;
        if (Math.hypot(x - player.pos.x, z - player.pos.z) < 18) continue;
        let bad = false;
        for (const lm of curLM()) if (!lm.camp && Math.hypot(x - lm.x, z - lm.z) < lm.r + 2) { bad = true; break; }
        if (bad) continue;
        if (isle === 2 && Math.hypot(x - LAKE2.x, z - LAKE2.z) < LAKE2.r + 5) continue;
        if (isle === 3 && !treeOk3(x, z)) continue;
        if (isle === 4 && !treeOk4(x, z)) continue;
        for (const o of trees) if (!o.gone && Math.hypot(x - o.x, z - o.z) < 6) { bad = true; break; }
        if (bad) continue;
        const key = pickType(x, z), T = TYPES[key], mk = T.rush ? null : rollMut();
        let hh = T.titan ? 10 + Math.random() * 2 : T.tall ? 8 + Math.random() * 5 : 3 + Math.random() * 7;
        if (mk === "giant") hh = Math.min(hh * MUTS.giant.giant, 16);
        const t = makeTree(x, z, hh, key);
        if (isle === 5) { t.arch = arch5; t.hp = t.maxHp = Math.ceil(t.maxHp * ARCH_BY[arch5].hp); } // the far islands grow tougher trees
        if (mk) { applyMut(t, mk); if (announce && time - lastMutToast > 20) { lastMutToast = time; toast(`✦ A ${MUTS[mk].name} ${T.name} appeared somewhere! (×${MUTS[mk].mult} drops)`, "rare"); } }
        if (announce && (T.night || T.titan || T.xmas) && time - lastRareToast > 25) { lastRareToast = time; toast(T.xmas ? `Jingle bells... a ${T.name} sprouted somewhere in the woods!` : T.titan ? `A ${T.name} towers somewhere in the woods...` : `A ${T.name} stirs somewhere in the woods...`, "rare"); }
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
const inSafe = () => Math.hypot(player.pos.x, player.pos.z) < SAFE_R || player.pos.x > 4500; // the casino is a safe zone


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
    { name: "Worldsplitter", dmg: 120, cost: 160000, steel: 0x180a30, edge: 0xff5ae0, glow: 0x6a1a8a, scale: 1.62, rarity: "#ff7aea", isle2: true },
    // forged on Mooncap Isle
    { name: "Lunar Cleaver",  dmg: 180, cost: 0, steel: 0xb8c4e8, edge: 0xf4f8ff, glow: 0x3a4a9a, scale: 1.66, rarity: "#cfe0ff", isle3: true, night: 1.3 },
    { name: "Voidreaver",     dmg: 280, cost: 0, steel: 0x1a0a3a, edge: 0x9a5aff, glow: 0x4a1aa0, scale: 1.72, rarity: "#9a6aff", isle3: true },
    { name: "Elder's Bane",   dmg: 450, cost: 0, steel: 0x3a0a1a, edge: 0xff4a7a, glow: 0x8a0a3a, scale: 1.82, rarity: "#ff5a8a", isle3: true },
    // forged in the Crucible on Ashfall Isle
    { name: "Cinderbrand",    dmg: 700, cost: 0, steel: 0x2a1410, edge: 0xff8a2a, glow: 0x8a3000, scale: 1.88, rarity: "#ff9a4a", isle3: true },
    { name: "Volcano's Wrath", dmg: 1100, cost: 0, steel: 0x1a0a08, edge: 0xffd040, glow: 0xc04000, scale: 1.96, rarity: "#ffd040", isle3: true }
];
const axeDmg = () => axeDmgFor(save.equipped);
const ownedList = () => AXES.map((a, i) => i).filter(i => save.owned[i]);
function applyAxeLook() {
    const a = AXES[save.equipped];
    steelM.color.setHex(a.steel); steelM.emissive.setHex(a.glow);
    edgeM.color.setHex(a.edge); edgeM.emissive.setHex(a.glow);
    headMesh.scale.setScalar(a.scale);
}
applyAxeLook();
if (!(save.isle >= 2)) for (let i = 0; i < 60; i++) spawnTree(false); // (needs AXES for the difficulty scale)
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
        const mk = isle >= 2 ? (T.mat || (isle === 5 ? "driftwood" : isle === 4 ? "ash" : isle === 3 ? "spore" : "wood")) : null;
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
    else { const g = 12 + Math.floor(Math.random() * 14); save.contract = { type: "sell", goal: g, prog: 0, reward: Math.round(g * 6 * m), text: isle >= 2 ? `Sell ${g} materials at the Trading Post` : `Sell ${g} logs at the mill` }; }
    if (isle >= 3) save.contract.reward *= isle === 5 ? 1000 : isle === 4 ? 400 : 40; // later islands pay bigger money
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
    if (isle === 3) dusk3();
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
    if (typeof syncVeins === "function" && mineBuilt) syncVeins();
    if (isle === 3) dawn3();
    if (isle === 4) dawn4();
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
    hitTree(best, Math.round(axeDmg() * (best.boss ? 1 + 0.25 * enchLv("bane") : 1)), true);
    if (enchTotal(save.equipped)) burst(V3(best.x + (player.pos.x - best.x) * 0.2, best.gy + Math.min(best.h * 0.35, 2.2), best.z + (player.pos.z - best.z) * 0.2), 8, 5, [axeRunes.mat, ornMat(0xffffff)]); // enchanted hits throw violet sparks
    const vamp = enchLv("vamp"); // Lifesteal: every swing that lands heals you a little
    if (vamp && player.hp > 0 && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + Math.max(1, Math.round(player.maxHp * 0.012 * vamp)));
}
const HIT_COL = { xmaspine: [0x1e5a34, 0xff3a3a, 0xffd040], xmasfir: [0x1e4e3e, 0xffffff, 0xff3a3a], xmasmoon: [0x1a2a5a, 0xd8e8ff, 0xb07aff], xmasash: [0x2a2624, 0xff6a1a, 0xffd040], ghost: [0x9fe8ff, 0xffffff], blood: [0xaa1818, 0xff5a5a], gold: [0xffd040, 0xfff0a0], elder: [0x7a4aa0, 0xc8a0ff], ironwood: [0xa9bcd4, 0x6a7a8a], frostbark: [0x8fe0ff, 0xffffff], emberwood: [0xff9a3a, 0xffe070], titan: [0xd8a860, 0xfff0c0],
    larch: [0x8a9a3a, 0xb07a45], stonebark: [0x8a8a96, 0x5a5a62], copperleaf: [0xd0763a, 0xffb070], ironbark: [0xa9c0dc, 0x4a5a6a], powderwood: [0x2a2228, 0xff4a3a], goldleaf: [0xffd040, 0xfff0a0], redwood: [0x7a3a22, 0xd08a5a], snowpine: [0xe8f4ff, 0xffffff], crystal: [0x7affef, 0xff7ad8], magma: [0xff5a1a, 0xffd060], colossus: [0xd8a860, 0xfff0c0] };
function hitTree(best, dmg, melee) {
    best.hp -= dmg;
    best.hurt = 1;
    floatWorld(V3(best.x + (player.pos.x - best.x) * (best.boss ? 0.3 : 0), best.gy + Math.min(best.h * 0.55, 3.2), best.z + (player.pos.z - best.z) * (best.boss ? 0.3 : 0)), "-" + dmg, "dmg");
    if (best.boss) bossHurt(best, dmg); else showBar(best);
    if (melee) { shake = Math.min(0.5, shake + 0.25); hitstop = 0.07; fovKick = 1; flash = 0.2; }
    const col = HIT_COL[best.key];
    burst(V3(best.x + (player.pos.x - best.x) * 0.1, best.gy + Math.min(best.h * 0.35, 2.2), best.z + (player.pos.z - best.z) * 0.1), melee ? 10 : 5, 4, col ? col.map(c => new THREE.MeshBasicMaterial({ color: c })) : chipMats);
    if (melee) { sfx(140, 0.14, "square", 0.18, 0.4); sfx(520 + Math.random() * 200, 0.2, "sawtooth", 0.07, 0.35); }
    else sfx(260 + Math.random() * 100, 0.07, "square", 0.06, 0.5);
    if (best.hp <= 0 && !best.dying) fellTree(best);
}
function fellTree(t) {
    t.dying = true; t.t = 0;
    if (t.boss) { (t.key === "cinderking" ? kingDefeated : bossDefeated)(t); return; }
    save.felled++;
    if (isBlood()) bmFelled++;
    contractProgress("fell");
    if (t.type.rare) { save.rareFelled++; contractProgress("rare"); if (!t.type.xmas) toast(`You felled a ${t.type.name}!`, "rare"); }
    if (t.type.xmas) openGift(t);
    if (t.mut) mutFelled(t);
    sfx(90, 0.4, "sawtooth", 0.15, 0.4);
}

// a present falls out of every Christmas tree: cash that fits the island, a bandage, and (past Pine Island) a pile of materials
function openGift(t, byGhost) {
    const sc = [1, 1, 4, 30, 300, 1500][isle] || 1500, cash = Math.round(rand(100, 240) * sc * rebirthMult() * (1 + 0.1 * (save.day - 1)));
    save.money += cash; save.bandages++; save.giftsOpened = (save.giftsOpened || 0) + 1;
    let extra = "";
    if (isle >= 2) { const ks = isleMats().filter(k => !["heartwood", "molten", "star", "phoenixf"].includes(k)).slice(0, 4), k = ks[Math.floor(Math.random() * ks.length)], n = Math.round(rand(5, 10)); save.mats[k] = (save.mats[k] || 0) + n; extra = ` and ${n} ${MATS[k].name}`; }
    toast(`${byGhost ? "Your ghost found a present" : "A present tumbled out of the " + t.type.name}: +${money(cash)}, a bandage${extra}!`, "cash");
    const p = V3(t.x, t.gy + 1, t.z);
    burst(p, 22, 6, [ornMat(0xff3a3a), ornMat(0x2aa04a), ornMat(0xffd040), ornMat(0xffffff)]);
    sfx(1046, 0.12, "triangle", 0.08, 1); setTimeout(() => sfx(1318, 0.12, "triangle", 0.08, 1), 110); setTimeout(() => sfx(1568, 0.25, "triangle", 0.08, 1), 220);
}
function hurtPlayer(dmg, sx, sz) {
    if (player.invuln > 0 || state !== "playing") return;
    if (godMode) return;
    dmg = Math.max(1, Math.round(dmg * (1 - 0.1 * (save.vestLvl || 0)) * (buffOn("ironhide") ? 0.6 : 1)));
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
    if (save.phoenix > 0) { // a Phoenix Tear burns away instead of you
        save.phoenix--;
        player.hp = Math.round(player.maxHp * 0.6); player.invuln = 3;
        flash = 0.9; shake = 0.6;
        sfx(300, 0.6, "sawtooth", 0.12, 2.5); setTimeout(() => sfx(600, 0.8, "triangle", 0.1, 1.6), 150);
        toast("The Phoenix Tear burns away... and you rise again!", "rare");
        burst(V3(player.pos.x, player.pos.y - 0.8, player.pos.z), 26, 6, [new THREE.MeshBasicMaterial({ color: 0xff9a3a }), new THREE.MeshBasicMaterial({ color: 0xffe070 })]);
        writeSave();
        return;
    }
    endFishing();
    if (isle === 4 && fight4.on) endFight4(false);
    if (isle === 3 && fight3.on) endFight(false); // dying ends the fight: the Elder Heart goes back to sleep and you wake up in camp
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
    if (isle === 5) boatRespawn();
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
    if (!save.owned[i]) { toast(`${AXES[i].name} is locked. ${isle >= 2 ? "Craft it at the Forge." : "The Reaper sells it."}`, "bad"); return; }
    if (save.equipped === i && !holdingGun()) return;
    save.gunEq = -1; reloading = false;
    save.equipped = i;
    addToHotbar("a" + i);
    applyAxeLook();
    swing.t = 1;
    sfx(420, 0.12, "triangle", 0.1, 1.4);
    toast(`Equipped ${AXES[i].name}${enchTotal(i) ? "  ✦ " + enchShort(i) : ""} · [Z] ${ABIL[i].name}`, enchTotal(i) ? "rare" : "");
}
function openChest(c) {
    if (c.opened) return;
    c.opened = true; c.beacon.visible = false; save.chestsOpened++;
    const m = (1 + 0.15 * (save.day - 1)) * (isBlood() ? 2 : 1), r = Math.random();
    let msg;
    if (isle >= 3) { // Mooncap and Ashfall chests: real money and a handful of materials
        const cash = Math.round(rand(1500, 3200) * m * (c.special ? 2.5 : 1) * (isle === 5 ? 25 : isle === 4 ? 10 : 1)), ks = isle === 5 ? (c.special ? ["pearl", "iceshard", "stormglass"] : ["driftwood", "salt", "coral", "tar"]) : isle === 4 ? (c.special ? ["obsidian", "ember", "sulfur"] : ["ash", "cinder", "sulfur"]) : c.special ? ["moonstone", "void", "amber"] : ["spore", "silver", "amber"], k = ks[Math.floor(Math.random() * ks.length)], n = Math.round(rand(4, 9) * (c.special ? 1.6 : 1));
        save.money += cash; save.mats[k] = (save.mats[k] || 0) + n; if (c.special) save.bandages++;
        msg = `${c.special ? (isle === 5 ? "Pirate chest" : isle === 4 ? "Scorched chest" : "Moonlit chest") : "Chest"}: +${money(cash)} and ${n} ${MATS[k].name}${c.special ? " and a bandage" : ""}`;
    } else if (c.special) { const cash = Math.round(rand(120, 260) * m); save.money += cash; save.bandages++; msg = `Cursed chest: +${money(cash)} and a bandage`; }
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
    reaper: [["axes", "AXES"], ["gear", "GEAR"], ["sellaxe", "SELL AXES"], ["sell", "SELL FISH"]],
    forge: [["axes", "CRAFT AXES"], ["guns", "CRAFT GUNS"], ["ammo", "AMMO"], ["gear", "GEAR"], ["sellaxe", "SELL AXES"]],
    trade: [["trade", "SELL MATERIALS"]],
    brew: [["brew", "BREWS"]],
    ench: [["ench", "ENCHANT"]],
    ship: [["boat", "BOAT"]]
};
const SHOP_NAMES = { reaper: "THE REAPER'S SHOP", forge: "THE FORGE", trade: "TRADING POST", brew: "THE APOTHECARY", ench: "THE ENCHANTING TABLE", ship: "THE SHIPWRIGHT" };
// what an axe is worth back: half its price, or half the value of the materials it was forged from
function axeSellValue(i) {
    const r = isle >= 2 ? axeRecipe(i) : null;
    const paid = r ? Object.entries(r).reduce((a, [k, n]) => a + n * matPrice(k), 0) : AXES[i].cost;
    return Math.max(1, Math.round(paid / 2));
}
let sellArm = -1, sellArmT = 0;
function sellAxeItems() {
    const out = [];
    AXES.forEach((a, i) => {
        if (i === 0 || !save.owned[i]) return;
        const v = axeSellValue(i), armed = sellArm === i && time - sellArmT < 3, en = save.ench[i] && Object.keys(save.ench[i]).length;
        out.push({ name: armed ? "CLICK AGAIN TO SELL " + a.name.toUpperCase() : a.name, icon: "a" + i, col: armed ? "#ff6a5a" : a.rarity, sell: true, value: v,
            desc: `Sell it back for half what it cost${en ? " · ✦ " + enchShort(i) + " will be lost" : ""}${save.equipped === i ? " · you're holding it" : ""}`,
            buy() {
                if (!(sellArm === i && time - sellArmT < 3)) { sellArm = i; sellArmT = time; sfx(300, 0.08, "square", 0.06, 1); return; }
                sellArm = -1;
                save.owned[i] = 0; delete save.ench[i];
                if (save.equipped === i) { save.equipped = bestIdx(); applyAxeLook(); }
                ensureHotbar();
                save.money += v;
                toast(`Sold ${a.name} for +${money(v)}`, "cash");
                sfx(900, 0.1, "triangle", 0.09, 1.4); setTimeout(() => sfx(600, 0.16, "triangle", 0.08, 0.8), 90);
                writeSave();
            } });
    });
    if (!out.length) out.push({ name: "Nothing to sell", desc: "You only have the Rusty Axe, and nobody wants that.", sell: true, value: 0, buy() {} });
    return out;
}
function reaperAxeItems() {
    const out = [];
    AXES.forEach((a, i) => {
        if (i === 0 || a.isle2 || a.isle3) return;
        out.push({ name: a.name, icon: "a" + i, desc: `${a.dmg} damage per swing${a.night ? " (x1.5 at night)" : ""} · [Z] ${ABIL[i].name}${save.owned[i] && enchTotal(i) ? " · ✦ " + enchShort(i) : ""}`, cost: a.cost, owned: !!save.owned[i], axe: i, col: a.rarity, buy() { gainAxe(i); } });
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
        { name: "Ghost Lumberjack", desc: `A spectral helper that chops trees and pays you for each one. Hits for ${ghostHit()} (80% of your axe). Owned: ${save.ghosts}`, cost: ghostCost(), buy() { save.ghosts++; syncGhosts(); } },
        { name: "Bandage", icon: "bandage", desc: `Heals 40 HP (H). Owned: ${save.bandages}`, cost: BANDAGE_COST, buy() { save.bandages++; } },
        { name: "Better Log Price", icon: "logs", desc: `Each log sells for $${logValue()} → $${logValue() + 2}`, cost: priceCost(), buy() { save.priceLvl++; } },
        { name: "Vitality", desc: `+20 max health (${save.hpLvl}/5)`, cost: hpCost(), maxed: save.hpLvl >= 5, buy() { save.hpLvl++; player.maxHp = maxHpNow(); player.hp = player.maxHp; } },
        { name: "Swift Boots", desc: `+7% move speed (${save.bootLvl}/4)`, cost: bootCost(), maxed: save.bootLvl >= 4, buy() { save.bootLvl++; } },
        { name: "Lantern Oil", icon: "lantern", desc: `A brighter, longer-reaching lantern (${save.oilLvl}/3)`, cost: oilCost(), maxed: save.oilLvl >= 3, buy() { save.oilLvl++; } },
        { name: "Better Fishing Rod", icon: "fish", desc: `Wider catch zone, faster bites, rarer fish (${save.rodLvl}/3)`, cost: rodCost(), maxed: save.rodLvl >= 3, buy() { save.rodLvl++; } }
    ];
}
function shopItems() {
    if (shopTab === "boat") return boatItems();
    if (shopTab === "brew") return isle === 5 ? brewItems5() : brewItems();
    if (shopTab === "ench") return enchItems();
    if (shopTab === "sellaxe") return sellAxeItems();
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
        if (it.cost && save.money < it.cost) { toast("Not enough cash.", "bad"); sfx(120, 0.15, "square", 0.08, 0.6); return; }
        payMats(it.craft);
        if (it.cost) save.money -= it.cost;
        it.buy();
        sfx(330, 0.12, "square", 0.12, 0.6); setTimeout(() => sfx(660, 0.2, "triangle", 0.12, 1.5), 120); setTimeout(() => sfx(990, 0.3, "triangle", 0.1, 1.2), 260);
        flash = 0.3;
        if (!it.quiet) toast(`${it.verb || "Crafted"} ${it.name}!`, "good");
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
    $("shopName").textContent = shopMode === "forge" && isle === 5 ? "THE SEA FORGE" : shopMode === "brew" && isle === 5 ? "THE SEA WITCH" : shopMode === "forge" && isle === 4 ? "THE CRUCIBLE" : shopMode === "forge" && isle === 3 ? "THE MOONFORGE" : shopMode === "brew" && isle === 4 ? "THE ALCHEMIST" : SHOP_NAMES[shopMode];
    const tabs = SHOP_TABS[shopMode];
    if (!tabs.some(t => t[0] === shopTab)) shopTab = tabs[0][0];
    const th = tabs.length > 1 ? tabs.map(t => `<button class="tab ${t[0] === shopTab ? "on" : ""}" data-tab="${t[0]}">${t[1]}</button>`).join("") : "";
    if ($("shopTabs").dataset.h !== th) { $("shopTabs").innerHTML = th; $("shopTabs").dataset.h = th; }
    const items = shopItems(), pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
    shopPage = clamp(shopPage, 0, pages - 1);
    const start = shopPage * PER_PAGE;
    let shopHtml = items.slice(start, start + PER_PAGE).map((it, k) => {
        const i = start + k, eqd = it.owned && (it.axe !== undefined ? save.equipped === it.axe && !holdingGun() : save.gunEq === it.gun);
        const canCraft = it.craft && hasMats(it.craft) && (!it.cost || save.money >= it.cost);
        const cls = it.sell ? (it.value > 0 ? "ok" : "no") : it.owned || it.maxed ? "owned" : it.craft ? (canCraft ? "ok" : "no") : save.money >= it.cost ? "ok" : "no";
        const costTxt = it.sell ? (it.value > 0 ? "+" + money(it.value) : "—") : it.owned ? (eqd ? "EQUIPPED" : "OWNED · click to equip") : it.maxed ? (it.maxTxt || "MAX") : it.craft ? (canCraft ? (it.verb ? it.verb.toUpperCase() : "CRAFT") + (it.cost ? " " + money(it.cost) : "") : !hasMats(it.craft) ? "NEED MATERIALS" : "NEED " + money(it.cost)) : money(it.cost);
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
        const en = id[0] === "a" && enchTotal(+id.slice(1));
        return `<div class="card wcard ${eq ? "eq" : ""}${en ? " ench" : ""}" data-act="w" data-w="${id}" draggable="true" style="border-color:${wCol(id)}"><img class="big" src="${iconURL(id)}"><b style="color:${wCol(id)}">${wName(id)}</b><small>${weaponStat(id)}${eq ? " · EQUIPPED" : on ? " · on hotbar" : ""}</small>${en ? `<em class="eline">✦ ${enchShort(+id.slice(1))}</em>` : ""}</div>`;
    });
    const wHtml = cards.join("");
    if ($("invSlots").dataset.h !== wHtml) { $("invSlots").innerHTML = wHtml; $("invSlots").dataset.h = wHtml; }
    const items = [];
    if (isle >= 2) for (const k of isleMats()) items.push(`<div class="card"><img class="big" src="${iconURL("m:" + k)}"><b style="color:${MATS[k].col}">${MATS[k].name}</b><small>${save.mats[k] || 0} · $${matPrice(k)} each</small></div>`);
    else items.push(`<div class="card"><img class="big" src="${iconURL("logs")}"><b>Logs</b><small>${save.logs} carried · $${logValue()} each${save.logBonus ? " + $" + Math.floor(save.logBonus) + " bonus" : ""}</small></div>`);
    items.push(
        `<div class="card" data-act="bandage"><img class="big" src="${iconURL("bandage")}"><b>Bandages</b><small>${save.bandages} · click to heal 40</small></div>`,
        `<div class="card" data-act="lantern"><img class="big" src="${iconURL("lantern")}"><b>Lantern</b><small>${player.lantern ? "On" : "Off"} · click to toggle</small></div>`,
        `<div class="card"><img class="big" src="${iconURL("cash")}"><b>Cash</b><small>${money(save.money)}</small></div>`
    );
    if (isle === 2) items.push(`<div class="card" data-act="relic"><img class="big" src="assets/relic.jpg" style="width:52px;height:60px;object-fit:cover"><b style="color:#ffd040">Hypergamous Relic</b><small>${relicCount()} / 6 pieces · click to view</small></div>`);
    if (isle === 1) items.push(`<div class="card" data-act="fish"><img class="big" src="${iconURL("fish")}"><b>Fish</b><small>${save.fishBag.length} in bag · click for the journal</small></div>`);
    if (isle === 3 || save.phoenix > 0) items.push(`<div class="card"><img class="big" src="${iconURL("phoenix")}"><b style="color:#ffb060">Phoenix Tears</b><small>${save.phoenix || 0} · saves you from one death</small></div>`);
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
        ["Mutations found", `${Object.keys(save.mutDex || {}).length} / ${MUT_KEYS.length}${Object.keys(save.mutDex || {}).length ? "  (" + Object.keys(save.mutDex).map(k => MUTS[k].name).join(", ") + ")" : ""}`],
        ["Chests opened", save.chestsOpened],
        [isle >= 2 ? "Materials sold" : "Logs sold", save.sold],
        ...(isle >= 3 || save.bossKills ? [["Elder Heart felled", save.bossKills || 0], ["Stars caught", save.starsCaught || 0]] : []),
        ...(isle >= 4 || save.kingKills ? [["Cinder King felled", save.kingKills || 0]] : []),
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
    $("panelEnch").classList.toggle("show", panel === "ench");
    if (panel === "ench") renderEnch();
    $("panelFish").classList.toggle("show", panel === "fish");
    $("panelFerry").classList.toggle("show", panel === "ferry");
    $("panelRelic").classList.toggle("show", panel === "relic");
    $("panelCasino").classList.toggle("show", panel === "casino");
    if (panel === "relic") renderRelic();
    $("panelTalk").classList.toggle("show", panel === "talk");
    $("panelBack").classList.toggle("show", panel !== null && panel !== "talk" && panel !== "dev");
    if (window.__ts4dev) window.__ts4dev.show(panel === "dev");
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
        t.bar.querySelector("u").textContent = (t.mut ? "✦ " + MUTS[t.mut].name + " " : "") + t.type.name;
        t.bar.querySelector("u").style.color = t.mut ? MUTS[t.mut].col : t.type.col;
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
const treeLogs = t => Math.max(1, Math.round(Math.ceil(t.h / 2) * t.type.logs * rewardScale() * (isBlood() ? 2 : 1) * isleRw() * (buffOn("lucky") ? 1.5 : 1) * (t.mut ? MUTS[t.mut].mult : 1)));
function hidePlates() { for (const p of plates) p.style.display = "none"; }
function updateNameplates() {
    const cands = [];
    for (const t of trees) {
        if (t.gone || t.dying || t.burn || t.boss) continue;
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
        const tm = T.mat || (isle === 5 ? "driftwood" : isle === 4 ? "ash" : isle === 3 ? "spore" : "wood");
        const mutHtml = t.mut ? '<i class="mut' + (t.mut === "rainbow" ? ' rbtxt' : '') + '" style="color:' + MUTS[t.mut].col + '">✦ ' + MUTS[t.mut].name + ' ×' + MUTS[t.mut].mult + ' ✦</i>' : '';
        const html = mutHtml + '<b style="color:' + T.col + '">' + T.name + '</b><span>' + (dmg ? '⚔ ' + dmg + ' dmg' : '⚔ harmless') + (isle >= 2 ? ' · <em style="color:' + MATS[tm].col + '">' + treeLogs(t) + ' ' + MATS[tm].name + '</em>' : ' · 🪵 ' + treeLogs(t) + (T.bonus ? ' <em>+$' + T.bonus + '/log</em>' : '')) + '</span>';
        if (e.dataset.h !== html) { e.innerHTML = html; e.dataset.h = html; e.style.borderColor = t.mut ? MUTS[t.mut].col : T.col; e.className = "np" + (t.mut ? " mutd" + (t.mut === "rainbow" ? " rbw" : "") : ""); e.style.setProperty("--mc", t.mut ? MUTS[t.mut].col : T.col); }
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
    if (isle === 5) { drawMap5(); return; }
    if (isle === 4) { drawMap4(); return; }
    if (isle === 3) { drawMap3(); return; }
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
        g.fillStyle = near ? "#ff4a3a" : t.mut ? mutCol(t.mut) : t.type.rare ? t.type.col : "#3f8a62";
        g.beginPath(); g.arc(X(t.x), Z(t.z), (t.mut ? 3.5 : t.type.rare ? 2.5 : 1.5) + t.h * 0.3, 0, 7); g.fill();
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
const CONTROLS = [["WASD", "Move"], ["Mouse", "Look"], ["Click", "Swing / shoot"], ["Drag", "Weapons onto hotbar (E)"], ["Shift", "Sprint"], ["Space", "Jump"], ["Q", "Dash"], ["Z", "Axe ability"],
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
    if (!actx) { try { actx = new AudioContext(); master = actx.createGain(); master.gain.value = settings.vol; master.connect(actx.destination); } catch (e) { /* no audio */ } }
    if (actx && actx.state === "suspended") actx.resume();
    startAmbience();
    if (state === "title") { if (isle >= 2) player.pos.set(RESPAWN.x, groundY(RESPAWN.x, RESPAWN.z) + 1.7, RESPAWN.z); else player.pos.set(0, 1.7, -0.5); }
    state = "playing";
    renderMenu();
    if (document.pointerLockElement !== canvas) { try { lockPointer(); } catch (e) { /* needs gesture */ } }
}
$("menuBtn").addEventListener("click", startPlaying);
$("menuQuit").addEventListener("click", () => { writeSave(); window.close(); });

// ---------- settings + reset progress ----------
const SET_ROWS = [
    { k: "sens", name: "Mouse sensitivity", type: "range", min: 0.2, max: 3, step: 0.05, show: v => v.toFixed(2) + "×" },
    { k: "invert", name: "Invert mouse Y", type: "toggle" },
    { k: "fov", name: "Field of view", type: "range", min: 60, max: 105, step: 1, show: v => v + "°" },
    { k: "vol", name: "Volume", type: "range", min: 0, max: 1, step: 0.05, show: v => Math.round(v * 100) + "%" },
    { k: "gfx", name: "Graphics style", type: "pick", opts: [["modern", "MODERN"], ["retro", "RETRO"]], restart: true },
    { k: "quality", name: "Quality", type: "pick", opts: [["low", "LOW"], ["med", "MEDIUM"], ["high", "HIGH"]], restart: true, only: "modern" },
    { k: "pixel", name: "Pixel size", type: "pick", opts: [[2, "SHARP"], [3, "CLASSIC"], [4, "CHUNKY"]], only: "retro" },
    { k: "bob", name: "Head bob", type: "toggle" },
    { k: "fps", name: "Show FPS", type: "toggle" }
];
const settingsOpen = () => $("settingsPanel").classList.contains("show");
function renderSettings() {
    $("setRows").innerHTML = SET_ROWS.filter(r => !r.only || r.only === settings.gfx).map(r => {
        const v = settings[r.k];
        const ctl = r.type === "range" ? `<input type="range" data-set="${r.k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}"><b>${r.show(v)}</b>`
            : r.type === "toggle" ? `<button class="stog ${v ? "on" : ""}" data-set="${r.k}">${v ? "ON" : "OFF"}</button>`
            : r.opts.map(([ov, ot]) => `<button class="stog ${v === ov ? "on" : ""}" data-set="${r.k}" data-v="${ov}">${ot}</button>`).join("");
        return `<div class="srow"><span>${r.name}</span><div class="sctl">${ctl}</div></div>`;
    }).join("") + `<div class="snote">Changing the graphics style or quality restarts the game. Your progress is saved.</div>`;
}
function applySettings() {
    if (master) master.gain.value = settings.vol;
    if (SCALE !== settings.pixel) { SCALE = settings.pixel; resize(); }
    el.fps.style.display = settings.fps ? "" : "none";
    saveSettings();
}
// graphics changes rebuild everything, so save and restart (skipping the studio intro)
function restartForGfx() {
    renderSettings();
    $("setRows").insertAdjacentHTML("beforeend", `<div class="srow"><span style="color:#ffd040">Restarting to apply…</span></div>`);
    writeSave();
    try { sessionStorage.setItem("ts4_skipIntro", "1"); } catch (e) { /* ignore */ }
    setTimeout(() => location.reload(), 400);
}
function openSettings(on) { $("settingsPanel").classList.toggle("show", on); if (on) { renderSettings(); armReset(false); } }
let resetArmed = false, resetTimer = null;
function armReset(on) {
    resetArmed = on; clearTimeout(resetTimer);
    $("resetBtn").textContent = on ? "CLICK AGAIN TO DELETE YOUR SAVE" : "RESET PROGRESS";
    $("resetBtn").classList.toggle("armed", on);
    if (on) resetTimer = setTimeout(() => armReset(false), 5000);
}
$("menuSettings").addEventListener("click", () => openSettings(true));
$("settingsPanel").addEventListener("input", e => { const k = e.target.dataset.set; if (!k) return; settings[k] = +e.target.value; e.target.nextElementSibling.textContent = SET_ROWS.find(r => r.k === k).show(settings[k]); applySettings(); });
$("settingsPanel").addEventListener("click", e => {
    if (e.target.closest("[data-sclose]")) { openSettings(false); return; }
    const b = e.target.closest("button[data-set]");
    if (b) {
        const k = b.dataset.set, row = SET_ROWS.find(x => x.k === k), dv = b.dataset.v, nv = dv !== undefined ? (isNaN(+dv) ? dv : +dv) : !settings[k];
        if (row && row.restart) { if (settings[k] !== nv) { settings[k] = nv; saveSettings(); restartForGfx(); } return; }
        settings[k] = nv; applySettings(); renderSettings(); return;
    }
    if (e.target.closest("#resetBtn")) {
        if (!resetArmed) { armReset(true); sfx(200, 0.2, "square", 0.08, 0.6); return; }
        // wipe the save (settings stay) and start over from the very beginning
        savesFrozen = true;
        try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem("ts4_test3_save"); } catch (er) { /* ignore */ }
        location.reload();
    }
});
$("death").addEventListener("mousedown", respawn);
document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === canvas;
    lookSkip = 3;
    if (!locked && state === "playing" && !panel) { showPanels(); endFishing(); state = "paused"; mouseDown = false; renderMenu(); }
});

// ---------- input ----------
addEventListener("keydown", e => {
    if ($("intro")) return; // studio intro is playing
    if (e.target && e.target.closest && e.target.closest("input, textarea, select")) { if (e.code === "Escape") e.target.blur(); return; } // typing into a field, not playing
    if (settingsOpen()) { if (e.code === "Escape") openSettings(false); return; } // the settings screen eats keys until it's closed
    if (DEBUG && e.code === "Backquote") { e.preventDefault(); if (state === "playing") togglePanel("dev"); else if (window.__ts4dev) window.__ts4dev.toggle(); return; }
    keys[e.code] = true;
    if (state === "dead" && (e.code === "Space" || e.code === "KeyR" || e.code === "Enter")) { respawn(); return; }
    if ((state === "title" || state === "paused") && (e.code === "Enter" || e.code === "Space")) { startPlaying(); return; }
    if (state !== "playing") return;
    if (DEBUG && e.code === "F8") { save.money += 250000; toast("[debug] +$250,000", "cash"); return; }
    if (DEBUG && e.code === "F9") { save.owned.fill(1); GUNS.forEach((g, i) => { save.gunOwned[i] = 1; const am = gunAm(i); am.mag = magSize(i); am.res = resCap(i); }); save.bandages += 5; for (const k of Object.keys(MATS)) save.mats[k] = (save.mats[k] || 0) + 300; toast("[debug] every axe and gun + 300 of each material", "cash"); return; }
    if (ride) return;
    if (panel === "casino") { if (e.code === "Escape") { closePanel(); return; } if (casinoKey(e.code)) e.preventDefault(); return; }
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
    if (e.code === "KeyZ") { useAbility(); return; }
    if (e.code === "KeyQ" && player.dashCd <= 0 && !panel && !boating()) {
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
    player.yaw -= mx * 0.0022 * settings.sens;
    player.pitch = clamp(player.pitch - my * 0.0022 * settings.sens * (settings.invert ? -1 : 1), -1.45, 1.45);
});

function nearest() {
    if (inCasino()) return nearestCasino();
    if (isle === 5 && B5.on) return nearest5();
    if (enchTable.g.visible && Math.hypot(player.pos.x - enchTable.x, player.pos.z - enchTable.z) < 2.9) return { k: "ench" };
    if (casino && casino.isle === isle && Math.hypot(player.pos.x - casino.door.x, player.pos.z - casino.door.z) < 3.4) return { k: "casino" };
    if (isle === 5) return nearest5();
    if (isle === 4) return nearest4();
    if (isle === 3) return nearest3();
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
    if (panel === "shop" || panel === "ench") { closePanel(); return; }
    if (panel) return;
    const n = nearest();
    if (!n) return;
    const pick = a => a[Math.floor(Math.random() * a.length)];
    if (ISLE5_ACT[n.k]) { ISLE5_ACT[n.k](n); return; }
    if (n.k === "ench") { openEnch(pick(ENCH_SAY)); return; }
    if (n.k === "casino") { enterCasino(); return; }
    if (CS_PROMPTS[n.k]) { casinoInteract(n); return; }
    if (n.k === "smith") {
        openShop("forge", pick(isle === 5 ? SMITH5_SAY : isle === 4 ? SMITH4_SAY : isle === 3 ? SMITH3_SAY : SMITH_SAY));
    } else if (n.k === "depot") openShop("trade", isle === 5 ? pick(DEPOT5_SAY) : isle === 4 ? pick(DEPOT4_SAY) : isle === 3 ? pick(DEPOT3_SAY) : pick(["Wood, stone, ore, powder... I buy it all.", "Fresh from the trees? Let's see it.", "Gold's up today. Don't tell anyone."]));
    else if (n.k === "witch") openShop("brew", pick(WITCH_SAY));
    else if (n.k === "ferry3") { if (!save.ferry3Talk) { save.ferry3Talk = 1; startTalk("THE FERRYMAN", FERRY3_LINES, () => openFerry3()); } else openFerry3(); }
    else if (n.k === "ferry4") openFerry4();
    else if (n.k === "well") drinkWell();
    else if (n.k === "scope") useScope();
    else if (n.k === "star") takeStar(n.s);
    else if (n.k === "ferry2") { if (!save.ferry2Talk) { save.ferry2Talk = 1; startTalk("THE FERRYMAN", FERRY2_LINES, () => openFerry2()); } else openFerry2(); }
    else if (n.k === "relic") collectRelic(n.r);
    else if (n.k === "vein") mineVein(n.v);
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
    const cands = [], rushers = new Set();
    for (const t of trees) {
        if (t.gone || t.dying || t.burn || t.boss) continue;
        const dx = player.pos.x - t.x, dz = player.pos.z - t.z, dist = Math.hypot(dx, dz) || 1;
        t._d = dist; t._nx = dx / dist; t._nz = dz / dist;
        t._seen = dist < 50 && (-t._nx * lookX - t._nz * lookZ) > 0.55;
        if (t.type.rush) { if (!safe && dist < 40 && dist > t.r + 2.1 && t.atk === "idle") rushers.add(t); continue; } // thornlings come at you, looking or not
        if (!t.type.flee && !safe && !t._seen && dist < activateR() && dist > t.r + 2.1 && t.atk === "idle") cands.push(t);
    }
    cands.sort((a, b) => a._d - b._d);
    const movers = new Set(cands.slice(0, isBlood() ? 5 : 3)); // at most three (five on a blood moon) trees stalk you at once, so they never swarm
    for (const t of rushers) movers.add(t);

    for (const t of trees) {
        if (t.gone || t.boss) continue;
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
                dropLogs(t.x, t.z, Math.round(treeLogs(t) * (1 + 0.2 * enchLv("fortune"))), { x: bx, z: bz }, t.key);
                burst(V3(t.x + bx * t.h * 0.5, t.gy + 0.3, t.z + bz * t.h * 0.5), 18, 5);
                sfx(70, 0.35, "square", 0.2, 0.3);
                shake = Math.min(0.6, shake + 0.2);
                scene.remove(t.g);
                t.gone = true;
            }
            continue;
        }
        const dist = t._d, seen = t._seen;
        if (dist < activateR() * 1.6 && !(t.stun > 0)) t.g.rotation.y += angDiff(Math.atan2(player.pos.x - t.x, player.pos.z - t.z), t.g.rotation.y) * Math.min(1, 4 * dt);

        let mx = 0, mz = 0, sp = 0;
        if (t.type.flee) {
            if (dist < 14) { mx = -t._nx; mz = -t._nz; sp = 3.6; }
        } else if (movers.has(t) && !(t.stun > 0)) { mx = t._nx; mz = t._nz; sp = 1.9 * t.type.speed * (t.mut === "frozen" ? 0.55 : 1); }
        if (sp > 0) {
            t.x += mx * sp * dt; t.z += mz * sp * dt;
            const od = Math.hypot(t.x, t.z);
            if (od < SAFE_R + t.r + 0.5) { t.x = t.x / od * (SAFE_R + t.r + 0.5); t.z = t.z / od * (SAFE_R + t.r + 0.5); }
            if (isle === 5) clampTree5(t); else { const tl = curShoreAt(t.x, t.z) - 8; if (od > tl) { t.x *= tl / od; t.z *= tl / od; } }
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
        if (!t.type.flee && !(t.stun > 0)) {
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
        t.g.position.set(t.x + (Math.random() - 0.5) * t.hurt * 0.15, t.gy - (isle >= 2 ? 0.25 : 0), t.z + (Math.random() - 0.5) * t.hurt * 0.15);
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
        if (a.gone || a.dying || a.burn || a.boss) continue;
        for (let j = i + 1; j < trees.length; j++) {
            const b = trees[j];
            if (b.gone || b.dying || b.burn || b.boss) continue;
            const ox = a.x - b.x, oz = a.z - b.z, d = Math.hypot(ox, oz), min = a.r + b.r + 2.2;
            if (d < min && d > 0.001) { const push = (min - d) * 0.5; a.x += ox / d * push; a.z += oz / d * push; b.x -= ox / d * push; b.z -= oz / d * push; }
        }
    }
    for (let i = trees.length - 1; i >= 0; i--) if (trees[i].gone) trees.splice(i, 1);
    let alive = 0;
    for (const t of trees) if (!t.dying && !t.burn && !t.boss && !t.type.rush) alive++;
    if (alive < treeTarget() && Math.random() < dt * (isBlood() ? 1.4 : 0.7) * (isle >= 2 ? 1.6 : 1)) spawnTree();
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
    const dir = boating() ? new THREE.Vector3() : new THREE.Vector3((keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), 0, (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0));
    if (dir.lengthSq() > 0) dir.normalize().applyAxisAngle(UP, player.yaw);
    if (boating()) driveBoat(dt); else {
    const maxSp = (keys.ShiftLeft ? 8.5 : 5.5) * (1 + 0.07 * save.bootLvl) * (buffOn("swift") ? 1.3 : 1) * devSpeed, accel = player.onGround ? 14 : 4;
    player.vel.x += (dir.x * maxSp - player.vel.x) * Math.min(1, accel * dt);
    player.vel.z += (dir.z * maxSp - player.vel.z) * Math.min(1, accel * dt);
    if (keys.Space && player.onGround && !panel) { player.vel.y = 7; player.onGround = false; }
    player.vel.y -= 22 * dt;
    player.pos.addScaledVector(player.vel, dt);
    clampToIsland(player.pos);
    pushOutBoxes(player.pos, 0.45);
    }
    if (ride) updateRide(dt);
    const gnd = groundY(player.pos.x, player.pos.z) + 1.7;
    if (!ride && !boating() && (player.pos.y <= gnd || (player.onGround && player.vel.y <= 0 && player.pos.y - gnd < 0.7))) { player.pos.y = gnd; player.vel.y = 0; player.onGround = true; }
    player.dashCd -= dt;
    updateAbilities(dt);
    if (player.onGround) player.bob += dt * Math.hypot(player.vel.x, player.vel.z) * 1.6;
    const safe = inSafe();
    if (safe && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 2 * dt);
    if (buffOn("blessed") && player.hp > 0 && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 1.5 * dt);

    // swing / shoot
    if (holdingGun()) updateGun(dt);
    if (swing.t < 1) {
        swing.t = Math.min(1, swing.t + dt / (0.36 / (1 + 0.12 * enchLv("swift"))));
        if (!swing.hit && swing.t >= 0.46) { swing.hit = true; tryHit(); }
    } else if (mouseDown && !panel && !fishing.on && !holdingGun() && !ride && !boating()) {
        swing.t = 0; swing.hit = false;
        sfx(260, 0.15, "sawtooth", 0.04, 0.5);
    }

    camera.getWorldDirection(fwd);
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    updateTrees(dt, safe, fwd.x / fl, fwd.z / fl);
    updateWorldAnim(dt); updateIsle2Anim(dt); updateIsle3(dt); updateIsle4(dt); updateIsle5(dt);
    updateWeather(dt); updateEcosystem(dt); updateGhosts(dt); updateEnchTable(dt); updateWild(dt); updateFishing(dt); ambienceTick(dt); footsteps(dt);

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
    camera.fov = settings.fov - fovKick * 3 + (keys.ShiftLeft && dir.lengthSq() > 0 ? 4 : 0);
    camera.updateProjectionMatrix();
    camera.position.set(
        player.pos.x + (Math.random() - 0.5) * shake * 0.2,
        player.pos.y + Math.sin(player.bob * 2) * 0.04 * (settings.bob ? 1 : 0) + (Math.random() - 0.5) * shake * 0.2,
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
// ---------- the animal kit: shared materials, shapes, pivots, eyes and legs ----------
const AMC = {};
const amat = (c, e = 0, side = false) => { const k = c + "_" + e + (side ? "d" : ""); return AMC[k] || (AMC[k] = new THREE.MeshLambertMaterial(Object.assign({ color: c, flatShading: true }, e ? { emissive: e } : {}, side ? { side: THREE.DoubleSide } : {}))); };
const aglow = (c, op = 0) => { const k = "g" + c + "_" + op; return AMC[k] || (AMC[k] = new THREE.MeshBasicMaterial(op ? { color: c, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false } : { color: c, side: THREE.DoubleSide })); };
const SPH = new THREE.IcosahedronGeometry(1, 1);
const TAPR = new THREE.CylinderGeometry(1, 0.55, 1, 6); // wide at the top, narrow at the bottom: legs
const CONE4 = new THREE.ConeGeometry(1, 1, 4);
const CAPG = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
const TOR = new THREE.TorusGeometry(1, 0.22, 4, 12, Math.PI * 1.75);
// a pivot: animate it and everything attached moves with it (yaw first, then pitch, then roll)
const pv = (parent, x, y, z, rx = 0, ry = 0, rz = 0) => { const g = new THREE.Group(); g.rotation.order = "YXZ"; g.position.set(x, y, z); g.rotation.set(rx, ry, rz); parent.add(g); return g; };
// eyes with a little white glint; they blink by squashing on y
function aEyes(head, x, y, z, s, mat = aglow(0x120c08), glint = true) {
    return [-1, 1].map(sd => { const e = pv(head, sd * x, y, z); part(e, SPH, mat, 0, 0, 0, s, s, s * 0.7); if (glint) part(e, BOX, aglow(0xffffff), sd * s * 0.2, s * 0.35, s * 0.6, s * 0.4, s * 0.4, s * 0.2); return e; });
}
// a leg hanging from a hip pivot, with a hoof or foot
function aLeg(parent, x, y, z, len, w, mat, footMat, footLen = 0) {
    const p = pv(parent, x, y, z);
    part(p, TAPR, mat, 0, -len / 2, 0, w, len, w);
    if (footMat) part(p, BOX, footMat, 0, -len + w * 0.5, footLen * 0.35, w * 1.5, w, w * 1.5 + footLen);
    return p;
}
// Pine Island's beach and pond animals (they use the original wildlife code, so they keep its "wings" array)
function makeCrab() {
    const g = new THREE.Group(), red = amat(0xe0502a), dark = amat(0xa83a1a), pale = amat(0xf4a888);
    const body = pv(g, 0, 0, 0);
    part(body, SPH, red, 0, 0.13, 0, 0.24, 0.085, 0.18);
    part(body, SPH, pale, 0, 0.09, 0, 0.2, 0.05, 0.15);
    for (const s of [-1, 1]) { part(body, SPH, dark, s * 0.08, 0.2, -0.02, 0.05, 0.02, 0.05); const st = pv(body, s * 0.06, 0.18, 0.13); part(st, BOX, red, 0, 0.04, 0, 0.016, 0.08, 0.016); part(st, SPH, aglow(0x101010), 0, 0.09, 0, 0.024, 0.024, 0.024); }
    const claws = [-1, 1].map(s => { const arm = pv(body, s * 0.2, 0.13, 0.1, 0, -s * 0.6, 0); part(arm, BOX, red, 0, 0, 0.07, 0.045, 0.04, 0.14); const cl = pv(arm, 0, 0, 0.15); part(cl, SPH, red, 0, 0, 0.04, 0.065, 0.05, 0.085); const pin = pv(cl, 0, 0.025, 0.07); part(pin, BOX, dark, 0, 0, 0.04, 0.03, 0.02, 0.085); return pin; });
    const legs = [];
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) { const p = pv(body, s * 0.18, 0.1, 0.05 - i * 0.07); part(p, BOX, red, s * 0.07, 0.02, 0, 0.14, 0.022, 0.022, 0, 0, s * 0.35); part(p, BOX, dark, s * 0.15, -0.045, 0, 0.022, 0.11, 0.022, 0, 0, s * 0.2); legs.push({ p, s, ph: (i % 2 === 0) === (s > 0) ? 0 : Math.PI }); }
    g.userData.crab = { claws, legs, body };
    return g;
}
function makeGull() {
    const g = new THREE.Group(), white = amat(0xf6f6f6), grey = amat(0x9aa2ae), dk = amat(0x2a2a30), yel = amat(0xffc030), leg = amat(0xf0a040);
    part(g, SPH, white, 0, 0.32, 0, 0.13, 0.13, 0.27);
    part(g, BOX, white, 0, 0.34, -0.31, 0.11, 0.025, 0.16, -0.15);
    const head = pv(g, 0, 0.46, 0.2);
    part(head, SPH, white, 0, 0.02, 0.02, 0.085, 0.085, 0.095);
    part(head, CONE6, yel, 0, 0.005, 0.14, 0.022, 0.12, 0.026, Math.PI / 2);
    part(head, BOX, aglow(0xe03a2a), 0, -0.012, 0.15, 0.01, 0.014, 0.014);
    aEyes(head, 0.06, 0.035, 0.05, 0.014, aglow(0x101010), false);
    for (const s of [-1, 1]) { part(g, BOX, leg, s * 0.04, 0.1, 0, 0.018, 0.2, 0.018); part(g, BOX, leg, s * 0.04, 0.01, 0.03, 0.05, 0.012, 0.07); }
    const wings = [-1, 1].map(s => { const p = pv(g, s * 0.1, 0.38, 0.02); part(p, BOX, grey, s * 0.25, 0, 0, 0.5, 0.025, 0.2); part(p, BOX, dk, s * 0.5, 0, -0.03, 0.14, 0.02, 0.15); part(p, BOX, aglow(0xffffff), s * 0.56, 0.012, -0.03, 0.03, 0.01, 0.03); return p; });
    g.userData.wings = wings; g.userData.foldable = true; g.userData.head = head;
    return g;
}
function makeFrog() {
    const g = new THREE.Group(), grn = amat(0x58b04a), dk = amat(0x2e6a2a), pale = amat(0xe8f0b0), iris = aglow(0xffd040);
    const body = pv(g, 0, 0, 0);
    part(body, SPH, grn, 0, 0.09, 0, 0.12, 0.075, 0.15);
    part(body, SPH, dk, 0.04, 0.15, -0.03, 0.035, 0.012, 0.035); part(body, SPH, dk, -0.05, 0.145, 0.03, 0.028, 0.012, 0.028); part(body, SPH, dk, 0.01, 0.15, -0.09, 0.025, 0.01, 0.025);
    const throat = part(body, SPH, pale, 0, 0.06, 0.1, 0.07, 0.04, 0.05);
    for (const s of [-1, 1]) { const e = pv(body, s * 0.06, 0.155, 0.08); part(e, SPH, grn, 0, 0, 0, 0.042, 0.042, 0.042); part(e, SPH, iris, 0, 0.006, 0.026, 0.027, 0.027, 0.02); part(e, BOX, aglow(0x101010), 0, 0.006, 0.044, 0.03, 0.008, 0.006); }
    const hind = [-1, 1].map(s => { const p = pv(body, s * 0.09, 0.07, -0.08); part(p, SPH, grn, s * 0.03, 0, 0.02, 0.045, 0.035, 0.085); part(p, BOX, grn, s * 0.06, -0.04, 0.06, 0.03, 0.02, 0.1); part(p, BOX, dk, s * 0.06, -0.06, 0.12, 0.055, 0.01, 0.055); return p; });
    for (const s of [-1, 1]) part(body, BOX, grn, s * 0.08, 0.03, 0.1, 0.025, 0.07, 0.025, 0, 0, s * 0.2);
    g.userData.frog = { throat, hind, body };
    return g;
}
const birdMat = lamb(0xeeeeee);
function makeBird() { // a swallow: forked tail, swept wings
    const g = new THREE.Group();
    part(g, SPH, birdMat, 0, 0, 0, 0.09, 0.08, 0.24);
    part(g, SPH, birdMat, 0, 0.03, 0.2, 0.065, 0.065, 0.075);
    for (const s of [-1, 1]) part(g, BOX, birdMat, s * 0.05, 0, -0.3, 0.025, 0.01, 0.2, 0, s * 0.3, 0);
    const wings = [-1, 1].map(s => { const p = pv(g, s * 0.06, 0.02, 0.03); part(p, BOX, birdMat, s * 0.24, 0, -0.03, 0.48, 0.014, 0.15, 0, s * 0.3, 0); return p; });
    g.userData.wings = wings;
    return g;
}
function makeButterfly() {
    const pals = [[0xff7ad8, 0x3a1a3a], [0xffd040, 0x3a2a0a], [0x7fd8ff, 0x0a2a4a], [0xffffff, 0x8a8a96], [0xff8a3a, 0x1a1008], [0xc8a0ff, 0x2a1a4a]], [c1, c2] = pals[Math.floor(Math.random() * pals.length)];
    const g = new THREE.Group(), m1 = aglow(c1), m2 = aglow(c2), bodyM = aglow(0x1a1418);
    part(g, SPH, bodyM, 0, 0, 0, 0.014, 0.014, 0.07);
    for (const s of [-1, 1]) part(g, BOX, bodyM, s * 0.015, 0.02, 0.08, 0.004, 0.004, 0.06, -0.6, s * 0.35, 0);
    const wings = [-1, 1].map(s => {
        const p = pv(g, 0, 0, 0);
        part(p, BOX, m1, s * 0.075, 0, 0.03, 0.14, 0.004, 0.11, 0, -s * 0.15, 0); part(p, BOX, m1, s * 0.055, 0, -0.06, 0.1, 0.004, 0.085, 0, s * 0.25, 0);
        part(p, BOX, m2, s * 0.125, 0.003, 0.055, 0.04, 0.004, 0.05, 0, -s * 0.15, 0); part(p, BOX, m2, s * 0.07, 0.003, -0.085, 0.032, 0.004, 0.032);
        return p;
    });
    g.userData.wings = wings;
    return g;
}
// little extra life for the original critters: folding wings, scuttling legs, snapping claws, croaking frogs
function critTick(c, dt) {
    const U = c.g.userData;
    const sp = c._lx === undefined ? 0 : Math.hypot(c.g.position.x - c._lx, c.g.position.z - c._lz) / Math.max(dt, 1e-3);
    c._lx = c.g.position.x; c._lz = c.g.position.z;
    if (U.foldable) {
        const fold = c.state === "fly" ? 0 : 1;
        U.wings.forEach((w, i) => { w.rotation.y = (i ? 1 : -1) * 1.45 * fold; });
        if (fold && U.head) { c.look = (c.look || 0) - dt; if (c.look <= 0) { c.look = rand(0.5, 2.5); c.lookY = rand(-0.9, 0.9); } U.head.rotation.y += ((c.lookY || 0) - U.head.rotation.y) * Math.min(1, dt * 10); }
    }
    if (U.crab) {
        const mv = sp > 0.2 ? 1 : 0;
        c.gait = (c.gait || 0) + dt * Math.min(sp, 6) * 10;
        U.crab.legs.forEach(L => { L.p.rotation.z = Math.sin(c.gait + L.ph) * 0.35 * mv; L.p.rotation.x = Math.cos(c.gait + L.ph) * 0.2 * mv; });
        if (Math.random() < dt * 0.4) c.snap = 0.45;
        c.snap = Math.max(0, (c.snap || 0) - dt);
        U.crab.claws.forEach(p => (p.rotation.x = c.snap > 0 ? -Math.abs(Math.sin(c.snap * 22)) * 0.7 : 0));
        U.crab.body.position.y = Math.abs(Math.sin(c.gait * 0.5)) * 0.015 * mv;
    }
    if (U.frog) {
        const air = c.jump > 0;
        U.frog.hind.forEach(h => (h.rotation.x += ((air ? 1.7 : 0) - h.rotation.x) * Math.min(1, dt * 20)));
        U.frog.body.rotation.x = air ? -0.35 : 0;
        c.croak = (c.croak === undefined ? rand(1, 6) : c.croak) - dt;
        if (c.croak <= -0.7) c.croak = rand(3, 9);
        const puff = c.croak < 0 ? Math.abs(Math.sin(-c.croak * 9)) : 0;
        U.frog.throat.scale.set(0.07 * (1 + puff * 0.7), 0.04 * (1 + puff * 1.3), 0.05 * (1 + puff * 0.6));
    }
}

// (deer and rabbits on Pine Island now live with the rest of the wildlife further down, along with the squirrels)
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
        critTick(c, dt);
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
const insideBuilding = () => { const x = player.pos.x, z = player.pos.z; return x > 1500 || (isle === 1 && ((Math.abs(x) < 4.2 && Math.abs(z) < 3.2) || (x > -16.2 && x < -5.8 && z > -17.2 && z < -8.8))); };
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
            let best = null, bd = 95;
            for (const t of trees) {
                if (t.gone || t.dying || t.burn || t.boss || t.type.flee || claimed.has(t)) continue;
                if (Math.hypot(t.x, t.z) < SAFE_R + 2) continue;
                const d = Math.hypot(t.x - o.g.position.x, t.z - o.g.position.z);
                if (d < bd) { bd = d; best = t; }
            }
            if (best) { o.tgt = best; claimed.add(best); }
        }
        let tx, tz, ty = 1.5 + Math.sin(o.ph * 1.6) * 0.18, speed = 10;
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
                o.cd = 0.8; o.swing = 0.3;
                const t = o.tgt, dmg = Math.max(1, Math.round(ghostHit() * mult * isleHp())); // your axe, scaled to each island's tougher trees
                t.hp -= dmg; t.hurt = 1;
                burst(V3(t.x, Math.min(t.h * 0.3, 1.8), t.z), 4, 3, [new THREE.MeshBasicMaterial({ color: 0x9fe8ff }), chipMats[0]]);
                if (Math.hypot(t.x - player.pos.x, t.z - player.pos.z) < 30) sfx(210, 0.08, "square", 0.04, 0.5);
                if (t.hp <= 0) {
                    t.dying = true; t.t = 0; t.byGhost = true;
                    save.ghostFelled = (save.ghostFelled || 0) + 1;
                    if (isle >= 2) { // past Pine Island they haul the tree's materials back to you
                        const k = t.type.mat || isleMats()[0], n = Math.max(1, Math.round(treeLogs(t) * 0.8));
                        save.mats[k] = (save.mats[k] || 0) + n;
                        floatWorld(V3(t.x, Math.min(t.h * 0.7, 4), t.z), "+" + n + " " + MATS[k].name, "cash");
                    } else {
                        const pay = Math.round(treeLogs(t) * (logValue() + t.type.bonus * 0.8) * 0.85);
                        save.money += pay; save.ghostCash = (save.ghostCash || 0) + pay;
                        floatWorld(V3(t.x, Math.min(t.h * 0.7, 4), t.z), "+$" + pay, "cash");
                    }
                    if (t.type.xmas) openGift(t, true);
                    o.tgt = null;
                }
            }
        }
        if (o.swing > 0) { o.swing -= dt; o.arm.rotation.x = Math.sin((1 - Math.max(0, o.swing) / 0.3) * Math.PI) * -2.0; } else o.arm.rotation.x = -0.2 + Math.sin(o.ph * 2) * 0.08;
    }
}

// ---------- the Enchanting Table: one in every camp. Pour cash into the axe you're holding ----------
const ENCH = {
    sharp:   { name: "Sharpness", max: 5, k: 1,   desc: l => `+${12 * l}% axe damage` },
    swift:   { name: "Swiftness", max: 3, k: 1.3, desc: l => `Swing ${12 * l}% faster` },
    fortune: { name: "Fortune",   max: 3, k: 1.5, desc: l => `+${20 * l}% logs and materials from trees you fell` },
    vamp:    { name: "Lifesteal", max: 3, k: 1.6, desc: l => `Every hit heals ${(1.2 * l).toFixed(1)}% of your max health` },
    bane:    { name: "Bossbane",  max: 3, k: 1.8, desc: l => `+${25 * l}% damage to the Elder Heart and the Cinder King` }
};
const ROMAN = ["", "I", "II", "III", "IV", "V"];
const ENCH_SAY = ["The runes are hungry. Feed them gold.", "Every blade remembers what you pour into it.", "The book turns its own pages. Don't read them out loud.", "Pick a rune. Any rune."];
// placed beside each camp, clear of the buildings
const ENCH_AT = { 1: { x: -8.5, z: 1.5 }, 2: { x: 0, z: -10.5 }, 3: { x: 0, z: -10.5 }, 4: { x: 0, z: -10.5 }, 5: { x: 0, z: -10.5 } };
const enchCost = (k, lvl, i = save.equipped) => Math.round(([0, 120, 1500, 15000, 150000, 600000][isle] || 600000) * ENCH[k].k * Math.pow(2.1, lvl) * (1 + i * 0.12));
function enchItems() {
    const i = save.equipped, a = AXES[i];
    if (holdingGun()) return [{ name: "Put the gun away", desc: "Only axes take enchantments. Switch to an axe, then come back.", sell: true, value: 0, buy() {} }];
    return Object.entries(ENCH).map(([k, E]) => {
        const lv = enchLv(k, i), max = lv >= E.max;
        return { name: `${E.name} ${ROMAN[Math.min(E.max, lv + 1)]}`, col: max ? "#c8a0ff" : "#b07aff", desc: max ? `${a.name}: ${E.name} ${ROMAN[lv]} (maxed) · ${E.desc(lv)}` : `${a.name}: ${lv ? E.name + " " + ROMAN[lv] + " → " : ""}${E.desc(lv + 1)}`,
            craft: {}, cost: max ? 0 : enchCost(k, lv), maxed: max, verb: "Enchant", quiet: true,
            buy() { save.ench[i] = save.ench[i] || {}; save.ench[i][k] = lv + 1; enchFx(); toast(`${a.name} is enchanted with ${E.name} ${ROMAN[lv + 1]}!`, "rare"); } };
    });
}
const enchTable = (() => {
    const g = new THREE.Group(), stoneE = lamb(0x2a1e3a), clothE = lamb(0x8a1a2a), goldE = new THREE.MeshBasicMaterial({ color: 0xffc040 });
    const runeE = new THREE.MeshBasicMaterial({ color: 0xb07aff, transparent: true, opacity: 0.9 }), pageE = new THREE.MeshBasicMaterial({ color: 0xf0e6c8 }), coverE = lamb(0x5a1a1a);
    part(g, BOX, stoneE, 0, 0.45, 0, 1.5, 0.9, 1.5); part(g, BOX, lamb(0x1a1226), 0, 0.06, 0, 1.7, 0.12, 1.7);
    part(g, BOX, clothE, 0, 0.93, 0, 1.56, 0.08, 1.56);
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) part(g, BOX, goldE, cx * 0.72, 0.93, cz * 0.72, 0.16, 0.1, 0.16);
    for (let s = 0; s < 4; s++) { const a = s * Math.PI / 2; part(g, BOX, runeE, Math.sin(a) * 0.76, 0.5, Math.cos(a) * 0.76, Math.abs(Math.cos(a)) * 0.9 + 0.04, 0.1, Math.abs(Math.sin(a)) * 0.9 + 0.04); }
    const book = new THREE.Group(); book.position.y = 1.25; book.scale.setScalar(1.25);
    for (const s of [-1, 1]) { const half = new THREE.Group(); half.rotation.z = s * 0.28; part(half, BOX, coverE, s * 0.27, 0, 0, 0.56, 0.04, 0.72); part(half, BOX, pageE, s * 0.25, 0.04, 0, 0.5, 0.05, 0.66); book.add(half); }
    g.add(book);
    const runes = [];
    for (let k = 0; k < 10; k++) { const m = new THREE.Mesh(BOX, runeE); m.scale.set(0.09, 0.12, 0.02); g.add(m); runes.push({ m, a: k * 0.628, r: 1.0 + (k % 3) * 0.25, y: 0.9 + (k % 4) * 0.25, sp: 0.5 + (k % 5) * 0.12 }); }
    g.visible = false; scene.add(g);
    const lb = label("ENCHANTING TABLE", "#c8a0ff", 3.4, 0.8);
    return { g, book, runes, runeE, lb, x: 0, z: 0, pulse: 0 };
})();
function placeEnchTable() {
    const p = ENCH_AT[isle]; if (!p) return;
    enchTable.x = p.x; enchTable.z = p.z;
    const y = groundY(p.x, p.z);
    enchTable.g.position.set(p.x, y, p.z); enchTable.g.rotation.y = Math.atan2(-p.x, -p.z); enchTable.g.visible = true;
    enchTable.lb.isle = isle; enchTable.lb.position.set(p.x, y + 2.6, p.z);
}
function enchFx() {
    enchTable.pulse = 1; flash = Math.max(flash, 0.35);
    burst(V3(enchTable.x, enchTable.g.position.y + 1.4, enchTable.z), 26, 4, [enchTable.runeE, ornMat(0xffffff), ornMat(0xffc040)]);
    sfx(440, 0.4, "triangle", 0.1, 2.2); setTimeout(() => sfx(660, 0.4, "sine", 0.1, 1.8), 120); setTimeout(() => sfx(990, 0.6, "triangle", 0.08, 1.4), 260);
}
const enchCol = new THREE.Color(), enchBase = new THREE.Color(), ENCH_PURPLE = new THREE.Color(0x9a4aff);
function updateEnchTable(dt) {
    updateAxeRunes(); updateMutFx(dt); updateCasino(); updateCasinoInside(dt);
    if (typeof ash4 !== "undefined") ash4.visible = isle === 4 && !inCasino();
    const T = enchTable;
    if (T.g.visible) {
        const d = Math.hypot(player.pos.x - T.x, player.pos.z - T.z), near = d < 6;
        T.book.position.y = 1.25 + Math.sin(time * 1.8) * 0.06 + (near ? 0.12 : 0);
        T.book.rotation.y += angDiff(near ? Math.atan2(player.pos.x - T.x, player.pos.z - T.z) - T.g.rotation.y : time * 0.3, T.book.rotation.y) * Math.min(1, 3 * dt);
        T.pulse = Math.max(0, T.pulse - dt * 0.7);
        for (const r of T.runes) { r.a += dt * r.sp * (1 + T.pulse * 4); const rr = near ? r.r * 0.75 : r.r; r.m.position.set(Math.cos(r.a) * rr, r.y + Math.sin(r.a * 2 + r.r) * 0.15 + T.pulse * 0.5, Math.sin(r.a) * rr); r.m.rotation.y = -r.a; }
        T.runeE.opacity = 0.55 + 0.35 * Math.sin(time * 3) + T.pulse * 0.3;
        if (d < 0.95 + 0.45) { const ux = (player.pos.x - T.x) / (d || 1), uz = (player.pos.z - T.z) / (d || 1); player.pos.x = T.x + ux * 1.4; player.pos.z = T.z + uz * 1.4; }
    }
    // an enchanted axe shimmers purple
    const en = save.ench[save.equipped] && Object.keys(save.ench[save.equipped]).length;
    if (en) { enchBase.setHex(AXES[save.equipped].glow); edgeM.emissive.copy(enchBase).lerp(ENCH_PURPLE, 0.35 + 0.3 * Math.sin(time * 3.2)); }
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
        src.connect(f).connect(g).connect(audioOut()); src.start();
        return g;
    };
    windGain = mk("lowpass", 360, 0.02);
    waveGain = mk("lowpass", 700, 0.0);
    rainGain = mk("highpass", 1400, 0.0);
}
let birdT = 4, cricketT = 0.3, frogT = 3, gullT = 8, chimeT = 3, stepAcc = 0, stepSide = 0;
function ambienceTick(dt) {
    if (!actx) return;
    const px = player.pos.x, pz = player.pos.z, night = isNight(), outside = !insideBuilding();
    const near = clamp(1 - (curShoreAt(px, pz) - Math.hypot(px, pz)) / 34, 0, 1);
    if (waveGain) waveGain.gain.value = (0.012 + 0.05 * near * near) * (0.65 + 0.35 * Math.sin(time * 0.45)) * (outside ? 1 : 0.3);
    if (windGain) windGain.gain.value = (0.014 + Math.sin(time * 0.35) * 0.008 + (night ? 0.008 : 0) + wx.storm * 0.03) * (outside ? 1 : 0.4);
    if (!outside) return;
    if (!night && wx.rain < 0.3 && (birdT -= dt) <= 0) { birdT = rand(2.5, 8); const b = rand(2200, 3200); sfx(b, 0.07, "sine", 0.02, 1.5); setTimeout(() => sfx(b * 1.2, 0.06, "sine", 0.018, 1.3), 110); }
    if (night && (cricketT -= dt) <= 0) { cricketT = rand(0.1, 0.22); sfx(4300, 0.025, "sine", 0.008, 1); }
    if (isle === 3 && (chimeT -= dt) <= 0) { chimeT = rand(5, 13); const b = [784, 880, 988, 1175, 1319][Math.floor(Math.random() * 5)]; sfx(b, 0.9, "sine", night ? 0.018 : 0.012, 1.0); setTimeout(() => sfx(b * 1.5, 0.7, "sine", 0.01, 1.0), 180); } // Mooncap hums with little chimes
    if (isle === 1 && Math.hypot(px - POND.x, pz - POND.z) < 45 && (dayAmt() < 0.6) && (frogT -= dt) <= 0) { frogT = rand(2, 6); sfx(150, 0.12, "square", 0.025, 0.6); setTimeout(() => sfx(180, 0.1, "square", 0.02, 0.6), 160); }
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
    if (isle === 5) { renderFerry5(); return; }
    if (isle === 4) { renderFerry4v2(); return; }
    if (isle === 3) { renderFerry3(); return; }
    if (isle === 2) { renderFerry2(); return; }
    const cost = rebirthCost(), n = (save.rebirths || 0) + 1, can = save.money >= cost;
    const html = `<div class="fprice">Rebirth 1 ticket: <b>${money(cost)}</b> <span>(you have ${money(save.money)})</span></div>
      <div class="flist">
        <div class="lose"><h4>YOU LEAVE BEHIND</h4>cash and logs · every axe except the Rusty one · all shop upgrades · ghost lumberjacks · fish bag · the day count. You can't come back to Pine Island.</div>
        <div class="keep"><h4>YOU KEEP</h4>your Fish Journal · stats and trophies · all your rebirths</div>
        <div class="gain"><h4>YOU GAIN (stacks every rebirth)</h4>★ +50% cash from logs and fish · ★ +10% axe damage · ★ +50 max health · ★ a huge new island with mountains, new trees, GUNS and new upgrades</div>
      </div>`;
    if ($("ferryBody").dataset.h !== html) { $("ferryBody").innerHTML = html; $("ferryBody").dataset.h = html; }
    const b = $("ferryBuy");
    b.disabled = !can;
    b.textContent = !can ? "NEED " + money(cost - save.money) + " MORE" : ferryConfirm ? "CLICK AGAIN TO CONFIRM" : "BUY TICKET  " + money(cost);
    b.classList.toggle("danger", !!ferryConfirm);
}
$("ferryBuy").addEventListener("click", () => {
    if (isle === 5) return;
    if (isle === 4 ? !rebirth4Ready() : isle === 3 ? !rebirth3Ready() : isle === 2 ? !rebirth2Ready() : save.money < rebirthCost()) return;
    if (!ferryConfirm) { ferryConfirm = 1; renderFerry(); setTimeout(() => { ferryConfirm = 0; if (panel === "ferry") renderFerry(); }, 5000); return; }
    if (isle >= 2) startRebirthRide(isle); else doRebirth();
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
const ARRTH = (() => { let b = 0, m = 1e9; for (let i = 0; i < 360; i++) { const th = (i / 360) * Math.PI * 2, r = shoreR2(th); if (r < m) { m = r; b = th; } } return b; })();
const D2TH = ARRTH + Math.PI; // the Rebirth Ferry: straight across the island from where you land
const GPEAK = { x: -112, z: -8 };
function terrain2(x, z) {
    const d = Math.hypot(x, z), inside = shoreAt2(x, z) - d;
    if (inside < 5) return Math.max(-3.4, -(5 - inside) * 0.2);
    const n = fbm2(x * 0.0105 + 3.1, z * 0.0105 + 8.7, 4);
    const cs = Math.cos(ARRTH), sn = Math.sin(ARRTH), along = x * cs + z * sn, lane = along > 0 ? Math.abs(z * cs - x * sn) : d;
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
    { name: "Lumberjack Minigun", kind: "minigun",  dmg: 16,  pel: 1, spread: 0.04,  mag: 150, rate: 0.05, reload: 4.0, range: 70,  auto: true,  cost: 150000, pack: 300, packCost: 1500, pow: 100, metal: 0x6a2a2a, wood: 0x2a1a1a, col: "#ff6a5a", muz: -0.95 },
    { name: "Moonbeam Lance",     kind: "lance",    dmg: 260, pel: 1, spread: 0.001, mag: 6,   rate: 0.55, reload: 2.2, range: 130, auto: false, cost: 0,      pack: 18,  packCost: 0,    pow: 220, metal: 0xd8e0f8, wood: 0x3a2a6a, col: "#c8a0ff", muz: -0.9, pierce: true },
    { name: "Magma Launcher",     kind: "launcher", dmg: 900, pel: 1, spread: 0.002, mag: 4,   rate: 0.9,  reload: 2.6, range: 90,  auto: false, cost: 0,      pack: 12,  packCost: 0,    pow: 420, metal: 0x3a2a24, wood: 0x6a2a14, col: "#ff7a3a", muz: -0.95, splash: 5 }
];
const gunAm = i => save.gunAmmo[i] || (save.gunAmmo[i] = { mag: 0, res: 0 });
const magSize = i => Math.round(GUNS[i].mag * (1 + 0.25 * (save.magLvl || 0)));
const resCap = i => GUNS[i].pack * 6;
const holdingGun = () => save.gunEq >= 0 && !!save.gunOwned[save.gunEq];
const gunDmg = i => Math.round(GUNS[i].dmg * (1 + 0.1 * (save.rebirths || 0)) * (1 + 0.1 * (save.powderLvl || 0)) * dmgBuff());
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
    else if (G.kind === "launcher") {
        const glowL = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
        gc(0.075, 0.7, 0, 0.04, -0.45, metal); gc(0.085, 0.08, 0, 0.04, -0.8, dark); gc(0.06, 0.02, 0, 0.04, -0.85, glowL);
        gb(0.08, 0.14, 0.3, 0, -0.03, 0.27, wd); gb(0.06, 0.08, 0.2, 0, 0.12, -0.2, dark); gb(0.03, 0.06, 0.1, 0, 0.17, -0.25, glowL);
    }
    else if (G.kind === "lance") {
        const glowL = new THREE.MeshBasicMaterial({ color: 0xc8a0ff });
        gc(0.034, 0.7, 0, 0.03, -0.55, metal); gb(0.07, 0.12, 0.3, 0, -0.03, 0.27, wd);
        for (let k = 0; k < 3; k++) { const o = gc(0.05, 0.035, 0, 0.03, -0.32 - k * 0.14, glowL); o.scale.setScalar(1 - k * 0.12); }
        gc(0.045, 0.06, 0, 0.03, -0.92, glowL); gb(0.02, 0.09, 0.2, 0, 0.1, -0.15, glowL);
    }
    else { for (let k = 0; k < 6; k++) { const a = k * 1.047; gc(0.016, 0.62, Math.cos(a) * 0.045, 0.02 + Math.sin(a) * 0.045, -0.5, metal); } gb(0.14, 0.15, 0.3, 0, 0, -0.08, metal); gc(0.1, 0.2, 0, -0.17, -0.06, dark); gb(0.05, 0.05, 0.3, 0, 0.1, -0.08, dark); }
    if (hands) gb(0.095, 0.09, 0.12, 0, -0.07, -0.34, glove);
}
const tracers = [];
{
    const lm = new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.9, fog: false });
    for (let i = 0; i < 14; i++) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)); const l = new THREE.Line(g, lm.clone()); l.visible = false; l.frustumCulled = false; scene.add(l); tracers.push({ l, life: 0 }); }
}
const camRight = new THREE.Vector3(), gdir = new THREE.Vector3();
function addTracer(from, to, col = 0xfff0b0, life = 0.07) {
    const t = tracers.find(q => q.life <= 0) || tracers[0];
    const a = t.l.geometry.attributes.position;
    a.setXYZ(0, from.x, from.y, from.z); a.setXYZ(1, to.x, to.y, to.z); a.needsUpdate = true;
    t.life = t.max = life; t.l.visible = true; t.l.material.color.setHex(col);
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
function rayTree(o, d, range, only) {
    const hl = Math.hypot(d.x, d.z);
    if (hl < 1e-5) return null;
    let best = null, bs = range;
    for (const t of (only ? [only] : trees)) {
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
    if (G.splash) { // the launcher lobs a ball of magma that bursts and burns every tree around where it lands
        const hit = rayTree(camera.position, gdir, G.range), s = hit ? hit.s : G.range;
        const ix = camera.position.x + gdir.x * s, iz = camera.position.z + gdir.z * s, iy = hit ? camera.position.y + gdir.y * s : groundY(ix, iz) + 0.5;
        addTracer(mz, V3(ix, iy, iz), 0xff8a2a, 0.18);
        let n = 0;
        for (const t of trees) { if (t.gone || t.dying || t.burn) continue; const dd = Math.hypot(t.x - ix, t.z - iz) - t.r; if (dd < G.splash) { hitTree(t, Math.round(dmg * (dd < 1.5 ? 1 : 0.6)), false); n++; } }
        burst(V3(ix, iy, iz), 40, 9, [new THREE.MeshBasicMaterial({ color: 0xff7a2a }), new THREE.MeshBasicMaterial({ color: 0xffd060 }), chipMats[2]]);
        if (n > 1) floatScreen(n + " TREES SCORCHED", "cash");
        shake = Math.min(0.8, shake + 0.35); fovKick = Math.max(fovKick, 1); flash = Math.max(flash, 0.15);
        sfx(70, 0.6, "sawtooth", 0.2, 0.3); sfx(140, 0.4, "square", 0.12, 0.4); setTimeout(() => sfx(55, 0.7, "sawtooth", 0.16, 0.4), 120);
        if (am.mag === 0 && am.res > 0) setTimeout(() => { if (holdingGun() && gunAm(save.gunEq).mag === 0) startReload(); }, 250);
        return;
    }
    if (G.pierce) { // the lance goes through everything in its way
        const end = V3(camera.position.x + gdir.x * G.range, camera.position.y + gdir.y * G.range, camera.position.z + gdir.z * G.range);
        for (const o of [0, 0.03, -0.03]) addTracer(mz.clone().addScaledVector(camRight, o), end, 0xd8b8ff, 0.16);
        let pierced = 0;
        for (const t of trees) { if (t.gone || t.dying || t.burn) continue; const h1 = rayTree(camera.position, gdir, G.range, t); if (h1) { hitTree(t, dmg, false); pierced++; } }
        if (pierced > 1) floatScreen(pierced + " TREES PIERCED", "cash");
        shake = Math.min(0.6, shake + 0.2); fovKick = Math.max(fovKick, 0.8); flash = Math.max(flash, 0.12);
        sfx(1200, 0.35, "sawtooth", 0.1, 0.15); sfx(320, 0.4, "sine", 0.14, 0.4);
        if (am.mag === 0 && am.res > 0) setTimeout(() => { if (holdingGun() && gunAm(save.gunEq).mag === 0) startReload(); }, 250);
        return;
    }
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
    if (mouseDown && !panel && !fishing.on && !ride && !boating() && gunCd <= 0 && !reloading) {
        const G = GUNS[save.gunEq];
        if (G.auto || !fireLatch) { fireLatch = true; fireGun(); }
    }
    for (const t of tracers) if (t.life > 0) { t.life -= dt; t.l.material.opacity = Math.max(0, t.life / (t.max || 0.07)) * 0.9; if (t.life <= 0) t.l.visible = false; }
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
    magma:     { name: "Magma",     col: "#ff7a3a", price: 160, hex: 0xff5a1a },
    // Mooncap Isle
    spore:     { name: "Spores",    col: "#d0a8ff", price: 18,   hex: 0xb08aff },
    silver:    { name: "Moonsilver", col: "#e4ecff", price: 30,  hex: 0xc8d4ee },
    amber:     { name: "Amber",     col: "#ffb040", price: 55,   hex: 0xffa020 },
    moonstone: { name: "Moonstone", col: "#9fe0ff", price: 95,   hex: 0x9fdcff },
    void:      { name: "Voidglass", col: "#a47aff", price: 180,  hex: 0x6a3aff },
    star:      { name: "Star Shard", col: "#fff4a0", price: 600, hex: 0xfff09a },
    heartwood: { name: "Heartwood", col: "#ff5a8a", price: 2500, hex: 0xd02a5a },
    // Ashfall Isle
    ash:       { name: "Ash",       col: "#c8bcb0", price: 40,  hex: 0x8a8480 },
    cinder:    { name: "Cinder",    col: "#ff8a5a", price: 70,  hex: 0x5a2a1a },
    sulfur:    { name: "Sulfur",    col: "#ffe060", price: 110, hex: 0xe0d040 },
    obsidian:  { name: "Obsidian",  col: "#b88aff", price: 180, hex: 0x1e1428 },
    ember:     { name: "Ember",     col: "#ff7a3a", price: 300, hex: 0xff6a1a },
    phoenixf:  { name: "Phoenix Feather", col: "#ffc060", price: 900, hex: 0xffa030 },
    molten:    { name: "Molten Core", col: "#ff6a2a", price: 9000, hex: 0xff4a10 }
};
const MATS_BY_ISLE = { 2: ["wood", "stone", "copper", "iron", "gunpowder", "gold", "crystal", "magma"], 3: ["spore", "silver", "amber", "moonstone", "void", "star", "heartwood"], 4: ["ash", "cinder", "sulfur", "obsidian", "ember", "phoenixf", "molten"] };
const isleMats = () => MATS_BY_ISLE[isle] || MATS_BY_ISLE[2];
const GLOW_MATS = ["gold", "crystal", "magma", "moonstone", "void", "star", "heartwood", "ember", "phoenixf", "molten"];
const matPrice = k => Math.round(MATS[k].price * rebirthMult() * (1 + 0.15 * (save.priceLvl || 0)));
const hasMats = r => Object.entries(r).every(([k, n]) => (save.mats[k] || 0) >= n);
function payMats(r) { for (const [k, n] of Object.entries(r)) save.mats[k] -= n; }
const matMeshMat = {};
for (const [k, M] of Object.entries(MATS)) matMeshMat[k] = new THREE.MeshLambertMaterial({ color: M.hex, flatShading: true, emissive: GLOW_MATS.includes(k) ? M.hex : 0x000000, emissiveIntensity: 0.35 });
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
// the Moonforge on Mooncap Isle: the same steel, new ingredients, and three blades nobody has made before
const AXE_RECIPES3 = [
    null,
    { spore: 8 },
    { spore: 12, silver: 4 },
    { spore: 16, silver: 8 },
    { silver: 14, amber: 4 },
    { silver: 20, amber: 10 },
    { silver: 26, amber: 12, moonstone: 4 },
    { amber: 20, moonstone: 10 },
    { moonstone: 18, void: 4 },
    { amber: 20, moonstone: 26, void: 10 },
    { moonstone: 30, void: 22, star: 2 },
    { silver: 60, void: 34, star: 5 },
    { moonstone: 50, void: 60, star: 10 },
    { void: 80, star: 16, heartwood: 3 }
];
const GUN_RECIPES3 = [
    { spore: 10, silver: 6 },
    { spore: 20, silver: 12, amber: 4 },
    { silver: 26, amber: 12 },
    { silver: 30, amber: 18, moonstone: 6 },
    { amber: 40, moonstone: 40, void: 18 },
    { moonstone: 30, void: 40, star: 8 }
];
const AMMO_RECIPES3 = [{ spore: 2, silver: 1 }, { spore: 3, silver: 3 }, { silver: 4, amber: 2 }, { silver: 3, amber: 3 }, { amber: 10, moonstone: 4 }, { moonstone: 3, void: 2 }];
// the Crucible on Ashfall Isle
const AXE_RECIPES4 = [null, { ash: 8 }, { ash: 12, cinder: 4 }, { ash: 16, cinder: 8 }, { cinder: 14, sulfur: 4 }, { cinder: 20, sulfur: 10 }, { cinder: 26, sulfur: 12, obsidian: 4 }, { sulfur: 20, obsidian: 10 },
    { obsidian: 18, ember: 4 }, { sulfur: 20, obsidian: 26, ember: 10 }, { obsidian: 30, ember: 22, phoenixf: 2 }, { cinder: 60, ember: 34, phoenixf: 5 }, { obsidian: 50, ember: 60, phoenixf: 10 }, { obsidian: 60, ember: 80, phoenixf: 16 }, { obsidian: 80, ember: 100, phoenixf: 20 }, { molten: 3, ember: 120, phoenixf: 30 }];
const GUN_RECIPES4 = [{ ash: 10, cinder: 6 }, { ash: 20, cinder: 12, sulfur: 4 }, { cinder: 26, sulfur: 12 }, { cinder: 30, sulfur: 18, obsidian: 6 }, { sulfur: 40, obsidian: 40, ember: 18 }, { obsidian: 30, ember: 40, phoenixf: 8 }, { obsidian: 60, ember: 60, phoenixf: 12 }];
const AMMO_RECIPES4 = [{ ash: 2, sulfur: 1 }, { ash: 3, sulfur: 3 }, { cinder: 4, sulfur: 2 }, { cinder: 3, sulfur: 3 }, { sulfur: 10, obsidian: 4 }, { obsidian: 3, ember: 2 }, { sulfur: 8, ember: 3 }];
for (const list of [AXE_RECIPES, GUN_RECIPES, AXE_RECIPES3, GUN_RECIPES3, AXE_RECIPES4, GUN_RECIPES4]) for (const rc of list) if (rc) for (const k in rc) rc[k] = Math.max(1, Math.round(rc[k] * 0.6));
const RECIPES = { 3: [AXE_RECIPES3, GUN_RECIPES3, AMMO_RECIPES3], 4: [AXE_RECIPES4, GUN_RECIPES4, AMMO_RECIPES4] };
const axeRecipe = i => (RECIPES[isle] ? RECIPES[isle][0] : AXE_RECIPES)[i];
const gunRecipe = i => (RECIPES[isle] ? RECIPES[isle][1] : GUN_RECIPES)[i];
const ammoRecipe = i => (RECIPES[isle] ? RECIPES[isle][2] : AMMO_RECIPES)[i];
function axeCraftItems() {
    const out = [];
    AXES.forEach((a, i) => {
        if (i === 0 || !axeRecipe(i)) return;
        const need = isle === 3 && i === 13 && !save.bossKills ? " · Heartwood only falls from the Elder Heart" : isle === 4 && i === 15 && !save.kingKills ? " · Molten Cores only come from the Cinder King" : "";
        out.push({ name: a.name, icon: "a" + i, col: a.rarity, desc: `${Math.round(a.dmg * (1 + 0.1 * (save.rebirths || 0)))} damage per swing${a.night ? ` (x${a.night} at night)` : ""} · [Z] ${ABIL[i].name}${need}${save.owned[i] && enchTotal(i) ? " · ✦ " + enchShort(i) : ""}`, craft: axeRecipe(i), owned: !!save.owned[i], axe: i, buy() { gainAxe(i); } });
    });
    return out;
}
function gunCraftItems() {
    return GUNS.map((g, i) => ({ g, i })).filter(({ i }) => gunRecipe(i)).map(({ g, i }) => ({ name: g.name, icon: "g" + i, col: g.col, desc: `${g.pel > 1 ? g.pel + " pellets × " : ""}${gunDmg(i)} dmg${g.pierce ? " · PIERCES every tree in a line" : ""} · ${g.auto ? "full auto" : "semi-auto"} · ${g.mag} rounds · ${g.range}m range. Comes with ${g.pack} rounds.`, craft: gunRecipe(i), owned: !!save.gunOwned[i], gun: i, buy() { save.gunOwned[i] = 1; const am = gunAm(i); am.mag = magSize(i); am.res = g.pack; equipGun(i); } }));
}
function ammoCraftItems() {
    const out = [];
    GUNS.forEach((g, i) => {
        if (!save.gunOwned[i] || !ammoRecipe(i)) return;
        const am = gunAm(i);
        out.push({ name: g.name + " ammo", icon: "g" + i, col: g.col, desc: `+${g.pack} rounds · you have ${am.mag} + ${am.res} (max ${resCap(i)} spare)`, craft: ammoRecipe(i), maxed: am.res >= resCap(i), buy() { am.res = Math.min(resCap(i), am.res + g.pack); if (holdingGun() && save.gunEq === i && am.mag === 0) startReload(); } });
    });
    if (!out.length) out.push({ name: "No guns yet", desc: isle === 4 ? "Craft a gun first. Then bring Ash, Cinder and Sulfur here to make rounds." : isle === 3 ? "Craft a gun first. Then bring Spores, Moonsilver and Amber here to make rounds." : "Craft a gun first. Then bring Copper and Gunpowder here to make bullets.", sell: true, value: 0, buy() {} });
    return out;
}
function tradeItems() {
    const out = [], ks = isleMats().filter(k => (save.mats[k] || 0) > 0);
    const total = ks.reduce((a, k) => a + save.mats[k] * matPrice(k), 0);
    out.push({ name: "Sell everything", desc: ks.length ? "Every material you're carrying. Careful: you need them to craft!" : "You have nothing to sell. Go chop some trees.", sell: true, value: total, buy() { for (const k of ks) sellMat(k, save.mats[k], true); if (total) { toast(`Sold everything for +${money(total)}`, "cash"); writeSave(); } } });
    for (const k of isleMats()) {
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
    else if (key === "phoenix") { add(ICO, icM(0xff8a2a, 0xff5a10), 0, -0.1, 0, 0.42, 0.46, 0.42); add(CONE6, icM(0xffb040, 0xff7a10), 0, 0.42, 0, 0.3, 0.6, 0.3); add(ICO, icM(0xfff0a0, 0xffd040), 0.12, 0.0, 0.3, 0.12); g.rotation.set(0.2, 0.4, 0.15); }
    else if (key.startsWith("m:")) {
        const k = key.slice(2), m = icM(MATS[k].hex, GLOW_MATS.includes(k) ? MATS[k].hex : 0);
        if (m.emissive) m.emissiveIntensity = 0.3;
        if (k === "spore") { for (const [x, z, s] of [[0, 0, 1], [0.42, 0.2, 0.7], [-0.36, 0.25, 0.6]]) { add(CYL8, icM(0xeee4d0), x, -0.3 + s * 0.28, z, 0.11 * s, 0.6 * s, 0.11 * s); const cp = new THREE.SphereGeometry(0.36 * s, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2); add(cp, m, x, -0.3 + s * 0.58, z, 1, 0.6, 1); } g.rotation.set(0.35, 0.4, 0); }
        else if (k === "amber") { add(ICO, icM(0xffa020, 0xc06000), 0, 0, 0, 0.55, 0.48, 0.45, 0.3, 0.6); add(BOX, icM(0x3a1a08), 0.05, 0.02, 0.36, 0.14, 0.06, 0.04, 0, 0, 0.4); }
        else if (k === "moonstone") { add(new THREE.IcosahedronGeometry(1, 1), m, 0, 0, 0, 0.5, 0.42, 0.5); add(new THREE.TorusGeometry(0.42, 0.05, 4, 16, Math.PI), icM(0xffffff, 0xcfe8ff), 0, 0, 0.3, 1, 1, 1, 0, 0, 0.5); }
        else if (k === "void") { add(CONE6, m, 0, 0.15, 0, 0.32, 1.25, 0.32); add(CONE6, icM(0x2a1050, 0x3a10a0), 0.3, -0.05, 0.1, 0.2, 0.75, 0.2, 0, 0, -0.55); add(CONE6, m, -0.3, -0.1, 0, 0.18, 0.62, 0.18, 0, 0, 0.55); }
        else if (k === "star") { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? 0.26 : 0.62; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } s.closePath(); const sg = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 1 }); sg.translate(0, 0, -0.08); add(sg, icM(0xfff09a, 0xffd040)); g.rotation.set(0.15, 0.5, 0.1); }
        else if (k === "heartwood") { add(CYL8, icM(0x5a2a1a), 0, 0, 0, 0.5, 0.8, 0.5, Math.PI / 2, 0.4, 0); add(CYL8, icM(0xff4a7a, 0xd01a4a), Math.sin(0.4) * 0.41, 0, Math.cos(0.4) * 0.41, 0.3, 0.02, 0.3, Math.PI / 2, 0.4, 0); add(CYL8, icM(0xc89a6a), Math.sin(0.4) * 0.405, 0, Math.cos(0.4) * 0.405, 0.46, 0.01, 0.46, Math.PI / 2, 0.4, 0); }
        else if (k === "molten") { add(new THREE.IcosahedronGeometry(1, 1), icM(0x2a1410), 0, 0, 0, 0.55); add(new THREE.IcosahedronGeometry(1, 1), icM(0xffa020, 0xff6a00), 0, 0, 0, 0.42); for (let s = 0; s < 6; s++) add(BOX, icM(0xff7a1a, 0xff4a00), Math.cos(s) * 0.5, Math.sin(s * 1.7) * 0.4, Math.sin(s) * 0.5, 0.18, 0.04, 0.04, 0, s, s); }
        else if (k === "ash") { add(ICO, m, 0, -0.1, 0, 0.6, 0.35, 0.55); add(ICO, icM(0x6a6460), 0.35, 0.05, 0.1, 0.3, 0.2, 0.3); add(ICO, icM(0xff6a2a, 0xff4a10), -0.2, 0.12, 0.25, 0.08); }
        else if (k === "cinder") { add(ICO, m, 0, 0, 0, 0.5, 0.45, 0.5, 0.3, 0.5); for (let s = 0; s < 5; s++) add(BOX, icM(0xff5a1a, 0xff3a0a), Math.cos(s * 1.3) * 0.38, Math.sin(s * 2) * 0.3, Math.sin(s * 1.3) * 0.38, 0.12, 0.05, 0.05, 0, s, 0); }
        else if (k === "sulfur") { add(CONE6, m, 0, 0.1, 0, 0.32, 1.0, 0.32); add(CONE6, m, 0.32, -0.08, 0.1, 0.2, 0.6, 0.2, 0, 0, -0.5); add(CONE6, m, -0.3, -0.12, 0, 0.18, 0.5, 0.18, 0, 0, 0.5); add(ICO, icM(0x8a7a2a), 0, -0.45, 0, 0.5, 0.15, 0.4); }
        else if (k === "obsidian") { add(ICO, icM(0x1e1428, 0x0a0414), 0, 0, 0, 0.6, 0.5, 0.35, 0.4, 0.7); add(BOX, icM(0xb07aff, 0x6a3aff), 0.12, 0.15, 0.25, 0.3, 0.02, 0.02, 0, 0, 0.5); }
        else if (k === "ember") { add(ICO, icM(0xff6a1a, 0xff4a00), 0, 0, 0, 0.45); add(ICO, icM(0xffe070, 0xffc020), 0, 0.05, 0.2, 0.22); for (let s = 0; s < 4; s++) add(CONE6, icM(0xff8a2a, 0xff5a10), Math.cos(s * 1.57) * 0.3, 0.35, Math.sin(s * 1.57) * 0.3, 0.1, 0.4, 0.1); }
        else if (k === "phoenixf") { const fg = new THREE.ConeGeometry(0.22, 1.4, 6); add(fg, icM(0xffa030, 0xff6a10), 0, 0, 0, 1, 1, 0.35, 0, 0, -0.6); add(CYL6, icM(0xfff0c0), 0.36, -0.5, 0, 0.03, 0.6, 0.03, 0, 0, -0.6); add(ICO, icM(0xff4a1a, 0xff2a00), -0.15, 0.3, 0.05, 0.12, 0.3, 0.05, 0, 0, -0.6); }
        else if (k === "wood") { add(CYL8, icM(0x8a5a34), 0, 0, 0, 0.32, 1.2, 0.32, Math.PI / 2, 0.4, 0); add(CYL8, icM(0xe0b070), Math.sin(0.4) * 0.61, 0, Math.cos(0.4) * 0.61, 0.28, 0.02, 0.28, Math.PI / 2, 0.4, 0); }
        else if (k === "stone") { add(ICO, m, 0, 0, 0, 0.55, 0.42, 0.5, 0.3, 0.4); add(ICO, icM(0x6a6a74), 0.45, -0.15, 0.2, 0.3, 0.25, 0.3); }
        else if (k === "copper" || k === "iron" || k === "gold" || k === "silver") { const tg = new THREE.CylinderGeometry(0.42, 0.62, 0.3, 4); tg.rotateY(Math.PI / 4); add(tg, m, 0, 0, 0, 1, 1, 0.55); add(tg, m, 0.12, 0.32, 0.02, 0.9, 1, 0.5); g.rotation.set(0.35, 0.5, 0); }
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
const ARRDIR = V3(Math.cos(ARRTH), 0, Math.sin(ARRTH)), ARRPERP = V3(-ARRDIR.z, 0, ARRDIR.x), ARRLEN = 20;
const ARRB = V3(ARRDIR.x * (shoreR2(ARRTH) - 8), 0, ARRDIR.z * (shoreR2(ARRTH) - 8));
const arrPt = (a, s = 0, y = 0) => V3(ARRB.x + ARRDIR.x * a + ARRPERP.x * s, y, ARRB.z + ARRDIR.z * a + ARRPERP.z * s);
// where you are along / across a dock (used for walking on both docks)
const dockLocal = (x, z, B, DIR, PERP) => { const dx = x - B.x, dz = z - B.z; return { along: dx * DIR.x + dz * DIR.z, side: dx * PERP.x + dz * PERP.z }; };
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
    { name: "OLD MINE", x: -81, z: -28.5, r: 9, col: "#c0a080" },
    { name: "HUNTER'S LODGE", x: 58, z: -14, r: 9, col: "#ff9a6a" }
];
function curLM() { return isle === 4 ? LM4 : isle === 3 ? LM3 : isle === 2 ? LM2 : LANDMARKS; }
let isle2Built = false, altar2 = null, ferry2 = null, ferryman2 = null, ferryBoat2 = null, smithMesh = null, clerkMesh = null, mapBg2 = null;
const isle2G = new THREE.Group(); // everything on the Highland Isle (and its cave and mine), so another island can hide it
scene.add(isle2G);
const treeTarget = () => (isle === 5 ? archTreeTarget() : isle >= 2 ? (isBlood() ? 125 : 90) : (isBlood() ? 82 : 60));

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
    } else if (kind === "witch") {
        g.fillStyle = "rgba(90,40,110,.35)"; g.fillRect(14, 74, 18, 10); g.fillRect(96, 74, 18, 10); // purple cheeks
        const weye = (x, y) => { g.fillStyle = "#fff6d0"; g.fillRect(x - 10, y - 7, 20, 14); g.fillStyle = "#b040ff"; g.fillRect(x - 5, y - 6, 10, 12); g.fillStyle = "#000"; g.fillRect(x - 2, y - 4, 4, 8); };
        weye(40, 54); weye(88, 54);
        g.fillStyle = "#2a1030"; g.save(); g.translate(40, 40); g.rotate(-0.25); g.fillRect(-14, -3, 28, 6); g.restore(); g.save(); g.translate(88, 40); g.rotate(0.25); g.fillRect(-14, -3, 28, 6); g.restore();
        g.fillStyle = "#4a7a3a"; g.beginPath(); g.moveTo(60, 58); g.lineTo(72, 58); g.lineTo(66, 86); g.closePath(); g.fill(); // long nose
        g.fillStyle = "#3a5a2a"; g.fillRect(70, 76, 6, 6); // wart
        g.fillStyle = "#1a0a14"; g.beginPath(); g.moveTo(40, 98); g.quadraticCurveTo(64, 118, 90, 96); g.lineTo(88, 102); g.quadraticCurveTo(64, 124, 42, 104); g.fill(); // crooked grin
        g.fillStyle = "#f4ecd0"; g.fillRect(56, 103, 7, 8); // one tooth
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
    if (o.hat === "witch") { const hc = lamb(o.hatCol); part(head, CYL8, hc, 0, 0.27, 0, 0.62, 0.04, 0.62); const cn = part(head, CONE6, hc, 0, 0.62, -0.04, 0.27, 0.72, 0.27); cn.rotation.x = -0.22; part(head, CYL8, new THREE.MeshBasicMaterial({ color: 0xb06aff }), 0, 0.33, 0, 0.29, 0.07, 0.29); }
    if (o.hat === "mask") { const m = box(head, lamb(0x2a2a32), 0, 0.3, 0.06, 0.48, 0.26, 0.08); m.rotation.x = -1.1; const v = box(head, new THREE.MeshBasicMaterial({ color: 0x3a8ac0 }), 0, 0.34, 0.12, 0.3, 0.06, 0.02); v.rotation.x = -1.1; box(head, lamb(0x2a2a32), 0, 0.2, 0, 0.47, 0.06, 0.45); }
    return { g, head, torso, armL: arms[0], armR: arms[1], kind: o.face, ph: Math.random() * 6, swing: 0, cyc: 0 };
}
function updateNpcs(dt, list = npcs) {
    for (const p of list) {
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
        } else if (p.kind === "witch") { // stirs the cauldron in slow circles, and waves you over when you're close
            p.armL.rotation.x = -1.0 + Math.sin(time * 2.2) * 0.25; p.armL.rotation.z = -0.25 + Math.cos(time * 2.2) * 0.25;
            if (d < 7) p.armR.rotation.z = lerp(p.armR.rotation.z, 2.5 + Math.sin(time * 8) * 0.3, Math.min(1, 6 * dt));
            else { p.armR.rotation.z = lerp(p.armR.rotation.z, 0.1, Math.min(1, 4 * dt)); p.armR.rotation.x = -0.3 + Math.sin(time * 1.1 + p.ph) * 0.1; }
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
    const prevAdd = addTgt; addTgt = isle2G;
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
        scene.add(terrainMesh[2] = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
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
        const lake = new THREE.Mesh(new THREE.CircleGeometry(LAKE2.r + 2.5, 22), wtr(new THREE.MeshLambertMaterial({ color: 0x3a9ac0, emissive: 0x0a2a40, transparent: true, opacity: 0.88, flatShading: true })));
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
        const sp = batch(woodDark); sp.add(CYL6, 4, 1.2, 16, 0, 0, 0, 0.09, 2.4, 0.09); sp.add(CYL6, 3, 1.2, -18, 0, 0, 0, 0.09, 2.4, 0.09); sp.build();
        const nb = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: signTex("REBIRTH 2 FERRY", "THIS WAY ↑", "#c8a0ff") })); nb.position.set(3, 2.6, -18); scene.add(nb);
        const nbk = nb.clone(); nbk.rotation.y = Math.PI; scene.add(nbk);
        const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: signTex("REBIRTH 2 FERRY", "↑ NORTH SHORE", "#c8a0ff") })); board.position.set(4, 2.6, 16); scene.add(board);
        const bk = board.clone(); bk.rotation.y = Math.PI; scene.add(bk);
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
        const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex("REBIRTH 2", "MOONCAP ISLE", "#c8a0ff") }));
        board.position.copy(dock2Pt(3.5, 0, 3.3)); board.rotation.y = yaw; scene.add(board);
        const board2 = board.clone(); board2.rotation.y = yaw + Math.PI; scene.add(board2);
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
        // ---- the arrivals dock: where you step off the ferry from Pine Island ----
        const ayaw = Math.atan2(ARRDIR.x, ARRDIR.z);
        const ap = batch(new THREE.MeshLambertMaterial({ color: 0x7a6048, flatShading: true }));
        for (let i = 0; i < ARRLEN; i++) { const p = arrPt(i + 0.5); ap.add(BOX, p.x, 0.22, p.z, 0, ayaw, 0, 3.6, 0.14, 0.92); }
        ap.build();
        const apo = batch(woodDark), ara = batch(woodDark), ab = batch(new THREE.MeshBasicMaterial({ color: 0xffd060 }));
        for (let i = 0; i <= ARRLEN; i += 3) for (const sd of [-1.9, 1.9]) { const p = arrPt(i, sd); apo.add(CYL6, p.x, -0.9, p.z, 0, 0, 0, 0.12, 4.2, 0.12); if (i % 6 === 0) ab.add(ICO, p.x, 1.45, p.z, 0, 0, 0, 0.16); }
        for (let i = 0; i < ARRLEN; i++) for (const sd of [-1.9, 1.9]) { const p = arrPt(i + 0.5, sd, 0.95); ara.add(BOX, p.x, 0.95, p.z, 0, ayaw, 0, 0.08, 0.1, 1.02); }
        apo.build(); ara.build(); ab.build();
        for (const sd of [-2.0, 2.0]) { const p = arrPt(3.5, sd); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.6, 6), woodDark); m.position.set(p.x, 1.8, p.z); scene.add(m); }
        const wb = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex("WELCOME TO THE", "HIGHLAND ISLE", "#ffe080") }));
        wb.position.copy(arrPt(3.5, 0, 3.3)); wb.rotation.y = ayaw; scene.add(wb);
        const wb2 = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex("ARRIVALS", "FROM PINE ISLAND", "#ffe080") }));
        wb2.position.copy(arrPt(3.5, 0, 3.3)); wb2.rotation.y = ayaw + Math.PI; scene.add(wb2);
        const al = label("ARRIVALS", "#ffe080", 3.2, 0.7); al.position.copy(arrPt(3.5, 0, 4.6)); al.maxD = 70;
        const ob = new THREE.Group(); ob.position.copy(arrPt(ARRLEN - 7, 4.4, -0.15)); ob.rotation.y = ayaw; scene.add(ob);
        const ohull = lamb(0x4a2a1a), otrim = lamb(0x8a5a34);
        const oh = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.0, 7.6), ohull); oh.position.y = 0.2;
        const obg = new THREE.ConeGeometry(1.35, 2.4, 4); obg.rotateX(Math.PI / 2); obg.rotateZ(Math.PI / 4);
        const obw = new THREE.Mesh(obg, ohull); obw.position.set(0, 0.2, 5.0); obw.scale.y = 0.75;
        const otr = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.18, 7.8), otrim); otr.position.y = 0.72;
        const ocb = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 2.6), otrim); ocb.position.set(0, 1.5, -1.3);
        const oms = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5, 6), woodDark); oms.position.set(0, 3.0, 1.6);
        const olp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), new THREE.MeshBasicMaterial({ color: 0x9fe8ff })); olp.position.set(0, 5.6, 1.6);
        ob.add(oh, obw, otr, ocb, oms, olp);
        isle2.arrBoat = ob;
        // far beacon: the next rebirth
        const FI = dock2Pt(D2LEN + 230, 0, 0);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 200, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xc8a0ff, transparent: true, opacity: 0.18, fog: false, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.set(FI.x, 100, FI.z); scene.add(beam); isle2.beam = beam;
        const bl = label("MOONCAP ISLE", "#c8a0ff", 5.2, 1.2); bl.position.set(FI.x, 58, FI.z); bl.maxD = 420; bl.blurK = 0.25;
        const bl2 = label("REBIRTH 2", "#ffffff", 4.2, 1.0); bl2.position.set(FI.x, 50, FI.z); bl2.maxD = 420; bl2.blurK = 0.25;
        // Mooncap Isle on the horizon: a low violet island under giant glowing mushrooms
        const farM = c => new THREE.MeshBasicMaterial({ color: c, fog: false });
        const fbase = new THREE.Mesh(new THREE.CylinderGeometry(60, 72, 5, 14), farM(0x2a2048)); fbase.position.set(FI.x, -2.2, FI.z); scene.add(fbase);
        for (const [ox, oz, h, cr, col] of [[0, 0, 26, 17, 0x9a6aff], [-30, 14, 16, 11, 0x6a8aff], [26, 10, 19, 12, 0xc87aff], [12, -24, 12, 8, 0x7affe0], [-18, -20, 10, 7, 0xff8ad8]]) {
            const p = D2PERP.clone().multiplyScalar(ox).addScaledVector(D2DIR, oz);
            const st = new THREE.Mesh(new THREE.CylinderGeometry(cr * 0.16, cr * 0.22, h, 8), farM(0x5a4a7a)); st.position.set(FI.x + p.x, h / 2, FI.z + p.z); scene.add(st);
            const cp = new THREE.Mesh(new THREE.SphereGeometry(cr, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), farM(col)); cp.scale.y = 0.5; cp.position.set(FI.x + p.x, h, FI.z + p.z); scene.add(cp);
        }
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
    {   // old mine: the entrance on the mountainside (the tunnels themselves are built far away and you walk in)
        buildMineMouth();
        chestAt(MINE_MOUTH.x + MINE_F.x * 6 + MINE_F.z * 4, MINE_MOUTH.z + MINE_F.z * 6 - MINE_F.x * 4, true);
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
        const beachSpot = (n, min, max, fn) => { for (let i = 0; i < n; i++) { const a = srand() * 6.283, d = shoreR2(a) - srange(min, max), x = Math.cos(a) * d, z = Math.sin(a) * d, dx = x - D2B.x, dz = z - D2B.z; if (Math.hypot(dx, dz) < 12 || Math.hypot(x - ARRB.x, z - ARRB.z) < 12) continue; if (Math.hypot(x - LAKE2.x, z - LAKE2.z) < LAKE2.r + 4) continue; fn(x, z, Math.max(0, terrain2(x, z))); } };
        const palmT = batch(lamb(0x7a5a3a)), palmL = batch(lamb(0x3a8a4a)), drift = batch(lamb(0x9a8a78)), shells = batch(new THREE.MeshBasicMaterial({ color: 0xf2e8d8 }));
        beachSpot(40, 5, 12, (x, z, y) => { const lean = srange(-0.25, 0.25); palmT.add(CYL6, x - lean * 1.1, y + 2.2, z, 0, 0, lean, 0.16, 4.4, 0.16); for (let k = 0; k < 6; k++) { const a2 = k * 1.047 + srand() * 0.3; palmL.add(BOX, x - lean * 2.2 + Math.cos(a2) * 0.95, y + 4.25, z + Math.sin(a2) * 0.95, 0, -a2, -0.4, 2.0, 0.07, 0.5); } circles.push({ x, z, r: 0.35 }); });
        beachSpot(30, 3, 11, (x, z, y) => drift.add(CYL6, x, y + 0.14, z, Math.PI / 2, 0, srand() * 3, 0.12, srange(1.5, 3.2), 0.12));
        beachSpot(90, 2, 12, (x, z, y) => shells.add(ICO, x, y + 0.06, z, 0, srand() * 3, 0, 0.13, 0.08, 0.13));
        palmT.build(); palmL.build(); drift.build(); shells.build();
    }
    isle2.emit.forEach(e => smokeEmit.push(e));
    addTgt = prevAdd; curBuild = 1;
}
const isle2 = { waterGeo: null, foam: null, emit: [], beam: null, fireLight: null, arrBoat: null };

function clampIsle2(p) {
    if (p.x > 2500) { clampMine(p); return; }
    if (p.x > 1500) { clampCave(p); return; }
    for (const [B, DIR, PERP, LEN] of [[D2B, D2DIR, D2PERP, D2LEN], [ARRB, ARRDIR, ARRPERP, ARRLEN]]) {
        const { along, side } = dockLocal(p.x, p.z, B, DIR, PERP);
        if (along > 4.5 && along < LEN + 3 && Math.abs(side) < 6) {
            const a = Math.min(along, LEN - 0.7), s = clamp(side, -1.65, 1.65);
            p.x = B.x + DIR.x * a + PERP.x * s; p.z = B.z + DIR.z * a + PERP.z * s;
            return;
        }
    }
    const lim = shoreAt2(p.x, p.z) - 3, d = Math.hypot(p.x, p.z);
    if (d > lim) { p.x *= lim / d; p.z *= lim / d; }
}

// ---------- the ground, once you're on the Highland Isle ----------
function groundY2(x, z) {
    if (x > 2500) return 0;
    if (x > 1500) return caveGround(x, z);
    for (const [B, DIR, PERP, LEN] of [[D2B, D2DIR, D2PERP, D2LEN], [ARRB, ARRDIR, ARRPERP, ARRLEN]]) { const { along, side } = dockLocal(x, z, B, DIR, PERP); if (along > 4 && along < LEN + 3 && Math.abs(side) < 3) return 0; }
    return Math.max(-0.4, terrain2(x, z));
}
function enterIsle2() {
    leaveWorld();
    if (!isle2Built) { buildIsle2(); buildRelics(); buildMine(); snapWorld(2); } else loadWorld(2);
    isle = 2; save.isle = 2;
    showWorld(2);
    groundFn = groundY2;
    waterMesh.geometry = isle2.waterGeo; waterMesh.material.needsUpdate = true;
    smokeEmit.length = 0; isle2.emit.forEach(e => smokeEmit.push(e));
    RESPAWN.x = 3; RESPAWN.z = 4;
    syncGhosts();
    resetIsleTrees(90);
    resetChests();
}
function updateIsle2Anim(dt) {
    if (!isle2Built || isle !== 2) return;
    updateRelics(dt); updateMine(dt);
    if (isle2.foam) { isle2.foam.scale.setScalar(1 + Math.sin(time * 0.8) * 0.004); isle2.foam.material.opacity = 0.38 + Math.sin(time * 0.8) * 0.14; }
    if (isle2.beam) isle2.beam.material.opacity = 0.14 + Math.sin(time * 1.5) * 0.05;
    if (isle2.fireLight) isle2.fireLight.intensity = 16 + Math.sin(time * 13) * 3 + Math.sin(time * 7.3) * 2;
    if (ferryBoat2) { ferryBoat2.position.y = -0.15 + Math.sin(time * 1.1) * 0.07; ferryBoat2.rotation.z = Math.sin(time * 0.9) * 0.03; }
    if (isle2.arrBoat) { isle2.arrBoat.position.y = -0.15 + Math.sin(time * 1.05 + 1) * 0.07; isle2.arrBoat.rotation.z = Math.sin(time * 0.85 + 1) * 0.03; }
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
    "Six pieces and $1,250,000. Then I'll take you to Mooncap Isle, where the trees glow and the sky has two moons."
];
const FERRY2_QUIPS = ["Six pieces. No fewer.", "The cave is in the east. Bring a lantern.", "Not yet, woodcutter. Not yet.", "Mooncap Isle is waiting. So is what sleeps there.", "See that violet light? Two moons rise over it.", "Chop. Save. Sail. That's the whole job."];
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
    const k3 = isle === 5 ? 200 : isle === 4 ? 60 : isle === 3 ? 6 : 1; // later islands pay more, so they charge more
    return [
        { name: "Ghost Lumberjack", desc: `A spectral helper that chops trees and brings back their materials. Hits for ${ghostHit()} (80% of your axe). Owned: ${save.ghosts}`, cost: ghostCost() * 15, buy() { save.ghosts++; syncGhosts(); } },
        { name: "Bandage", icon: "bandage", desc: `Heals 40 HP (H). Owned: ${save.bandages}`, cost: BANDAGE_COST * 2, buy() { save.bandages++; } },
        { name: "Better Prices", desc: `Materials sell for +15% more each level (now +${15 * (save.priceLvl || 0)}%)`, cost: priceCost(), buy() { save.priceLvl++; } },
        { name: "Vitality", desc: `+20 max health (${save.hpLvl}/5)`, cost: hpCost(), maxed: save.hpLvl >= 5, buy() { save.hpLvl++; player.maxHp = maxHpNow(); player.hp = player.maxHp; } },
        { name: "Swift Boots", desc: `+7% move speed (${save.bootLvl}/4)`, cost: bootCost(), maxed: save.bootLvl >= 4, buy() { save.bootLvl++; } },
        { name: "Lantern Oil", desc: `A brighter, longer-reaching lantern (${save.oilLvl}/3)`, cost: oilCost(), maxed: save.oilLvl >= 3, buy() { save.oilLvl++; } },
        { name: "Kevlar Vest", desc: `Take 10% less damage from trees (${save.vestLvl || 0}/4)`, cost: vestCost(), maxed: (save.vestLvl || 0) >= 4, buy() { save.vestLvl = (save.vestLvl || 0) + 1; } },
        { name: "Extended Mags", desc: `+25% magazine size for every gun (${save.magLvl || 0}/3)`, cost: magCost(), maxed: (save.magLvl || 0) >= 3, buy() { save.magLvl = (save.magLvl || 0) + 1; } },
        { name: "Whetstone", desc: `+10% axe damage (${save.whetLvl || 0}/5)`, cost: whetCost(), maxed: (save.whetLvl || 0) >= 5, buy() { save.whetLvl = (save.whetLvl || 0) + 1; } },
        { name: "Gunpowder Mix", desc: `+10% gun damage (${save.powderLvl || 0}/5)`, cost: powderCost(), maxed: (save.powderLvl || 0) >= 5, buy() { save.powderLvl = (save.powderLvl || 0) + 1; } },
        { name: "Log Magnet", desc: `Logs fly to you from further away (${save.magnetLvl || 0}/3)`, cost: magnetCost(), maxed: (save.magnetLvl || 0) >= 3, buy() { save.magnetLvl = (save.magnetLvl || 0) + 1; } }
    ].map(it => { it.cost *= k3; return it; });
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
    for (const v of veins) if (v.g.visible && Math.hypot(px - v.x, pz - v.z) < 2.8) return { k: "vein", v };
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
    { const de = dock2Pt(D2LEN); g.strokeStyle = "#c8a0ff"; g.lineWidth = 4; g.beginPath(); g.moveTo(X(D2B.x), Z(D2B.z)); g.lineTo(X(de.x), Z(de.z)); g.stroke(); g.fillStyle = "#c8a0ff"; g.font = "bold 12px Consolas"; g.fillText("REBIRTH 2 FERRY", X(de.x), Z(de.z) + 16); }
    { const ae = arrPt(ARRLEN); g.strokeStyle = "#ffe080"; g.lineWidth = 4; g.beginPath(); g.moveTo(X(ARRB.x), Z(ARRB.z)); g.lineTo(X(ae.x), Z(ae.z)); g.stroke(); g.fillStyle = "#ffe080"; g.font = "bold 12px Consolas"; g.fillText("ARRIVALS", X(ae.x), Z(ae.z) - 8); }
    for (const ch of chests) if (!ch.opened) { g.fillStyle = ch.special ? "#c8a0ff" : "#ffd040"; g.fillRect(X(ch.x) - 4, Z(ch.z) - 4, 8, 8); g.strokeStyle = "#000"; g.lineWidth = 1; g.strokeRect(X(ch.x) - 4, Z(ch.z) - 4, 8, 8); }
    for (const t of trees) {
        if (t.gone || t.dying) continue;
        const near = Math.hypot(t.x - player.pos.x, t.z - player.pos.z) < 14;
        g.fillStyle = near ? "#ff4a3a" : t.mut ? mutCol(t.mut) : t.type.rare ? t.type.col : "rgba(20,70,40,.95)";
        g.beginPath(); g.arc(X(t.x), Z(t.z), (t.mut ? 3.5 : t.type.rare ? 2.5 : 1.5) + t.h * 0.2, 0, 7); g.fill();
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
const deckEye = (boat = ferryBoat) => { boat.updateMatrixWorld(); return deckV.copy(DECK).applyMatrix4(boat.matrixWorld); };
function say(t) { const e = $("rideCap"); e.textContent = t; e.classList.toggle("show", !!t); }
// which ferry you're riding: Pine Island's (to the Highland Isle) or the Highland Isle's (to Mooncap Isle)
const rideCfg = n => (n === 4
    ? { boat: isle4.boat4, man: ferryman4, pt: dock4Pt, DIR: D4DIR, A: D4LEN - 7, S: 4.4, lines: ["The smoke thins. The sea turns turquoise...", "Islands. Dozens of them, glittering in the sun."], finish: finishRebirth4 }
    : n === 3
    ? { boat: isle3.boat3, man: ferryman3, pt: dock3Pt, DIR: D3DIR, A: D3LEN - 7, S: 4.4, lines: ["The air turns hot. Ash drifts over the water...", "A mountain on fire rises out of the sea."], finish: finishRebirth3 }
    : n === 2
    ? { boat: ferryBoat2, man: ferryman2, pt: dock2Pt, DIR: D2DIR, A: D2LEN - 7, S: 4.4, lines: ["The violet light grows closer...", "Two moons rise over the water."], finish: finishRebirth2 }
    : { boat: ferryBoat, man: ferryman, pt: dockPt, DIR: FDIR, A: BOAT_A, S: BOAT_S, lines: ["The golden light grows closer...", "A new life awaits."], finish: finishRebirth });
function startRebirthRide(from = 1) {
    if (ride || (from === 4 ? !rebirth4Ready() : from === 3 ? !rebirth3Ready() : from === 2 ? !rebirth2Ready() : save.money < rebirthCost())) return;
    closePanel();
    ride = { phase: "walk", t: 0, from: player.pos.clone(), fx: false, done: false, cfg: rideCfg(from) };
    mouseDown = false; endFishing();
    player.invuln = 99999; player.vel.set(0, 0, 0);
    const fl = labelList.find(l => l.el.textContent === "FERRYMAN" && l.isle === isle); if (fl) fl.visible = false;
    $("rbSmall").textContent = from === 4 ? "REBIRTH 4 · THE ARCHIPELAGO" : from === 3 ? "REBIRTH 3 · ASHFALL ISLE" : from === 2 ? "REBIRTH 2 · MOONCAP ISLE" : "REBIRTH 1 · THE HIGHLAND ISLE";
    $("rebirthFx").classList.toggle("violet", from === 2); $("rebirthFx").classList.toggle("ember", from === 3); $("rebirthFx").classList.toggle("ocean", from === 4);
    say(from === 4 ? "All aboard. Hold on to something." : from === 3 ? "All aboard. Mind the Heartwood, it's still warm." : from === 2 ? "All aboard. Hold the relic tight." : "All aboard.");
    sfx(200, 0.9, "sine", 0.1, 2);
    writeSave();
}
const eio = u => u * u * (3 - 2 * u);
function updateRide(dt) {
    const r = ride, C = r.cfg;
    r.t += dt;
    player.vel.set(0, 0, 0); player.invuln = 99999; mouseDown = false;
    const lookAt = (tx, tz) => { player.yaw += angDiff(Math.atan2(-(tx - player.pos.x), -(tz - player.pos.z)), player.yaw) * Math.min(1, 5 * dt); player.pitch += (0 - player.pitch) * Math.min(1, 3 * dt); };
    if (r.phase === "walk") {
        const A = C.pt(C.A + DECK.z, 1.3), B = deckEye(C.boat).clone(), t1 = 2.6, t2 = 1.4, by = B.y;
        if (r.t < t1) { const u = eio(r.t / t1); player.pos.set(lerp(r.from.x, A.x, u), 1.75, lerp(r.from.z, A.z, u)); lookAt(B.x, B.z); player.bob += dt * 6; }
        else if (r.t < t1 + t2) { const u = (r.t - t1) / t2; player.pos.set(lerp(A.x, B.x, u), lerp(1.75, by, eio(u)) + Math.sin(u * Math.PI) * 0.55, lerp(A.z, B.z, u)); lookAt(B.x, B.z); if (!r.hop && u > 0.8) { r.hop = true; sfx(140, 0.2, "square", 0.12, 0.4); } }
        else {
            r.phase = "sail"; r.t = 0; sfx(110, 0.5, "sawtooth", 0.1, 0.5);
            C.boat.add(C.man); C.man.position.set(0.35, 0.8, -3.0); C.man.rotation.y = 0;
            player.yaw = Math.atan2(-C.DIR.x, -C.DIR.z); player.pitch = 0.04;
            say("The ferry pulls away...");
        }
    } else {
        const u = clamp(r.t / RIDE_T, 0, 1), s = C.A + 125 * u * u, p = C.pt(s, C.S);
        C.boat.position.x = p.x; C.boat.position.z = p.z;
        player.pos.copy(deckEye(C.boat));
        player.bob += dt * 0.6;
        if (r.t > 6 && !r.c2) { r.c2 = true; say(C.lines[0]); }
        if (r.t > 11 && !r.c3) { r.c3 = true; say(C.lines[1]); }
        if (r.t > 12.8 && !r.fx) { r.fx = true; $("rebirthFx").classList.add("show"); sfx(200, 1.6, "sine", 0.1, 3); setTimeout(() => sfx(400, 1.6, "sine", 0.08, 2.5), 500); }
        if (r.t > 0.5 && r.t < 12 && Math.random() < dt * 0.9) sfx(90 + Math.random() * 40, 0.5, "sine", 0.03, 0.8);
        if (r.t >= RIDE_T && !r.done) { r.done = true; C.finish(); }
    }
}
// what every rebirth takes away (rebirths, the journal and your stats stay)
function resetForRebirth() {
    save.money = 0; save.logs = 0; save.logBonus = 0;
    save.owned = new Array(N_AXES).fill(0); save.owned[0] = 1; save.equipped = 0; save.gunOwned = []; save.gunEq = -1; save.gunAmmo = {};
    save.bandages = 1; save.priceLvl = 0; save.hpLvl = 0; save.bootLvl = 0; save.oilLvl = 0; save.rodLvl = 0;
    save.vestLvl = 0; save.magLvl = 0; save.whetLvl = 0; save.powderLvl = 0; save.magnetLvl = 0;
    save.fishBag = []; save.day = 1; save.altarDay = 0; save.contract = null; save.ghosts = 0;
    save.mats = {}; save.hotbar = ["a0", null, null, null, null]; save.relic = [0, 0, 0, 0, 0, 0];
    save.buffs = {}; save.wellDay = 0; save.scopeDay = 0; save.veins = []; save.ench = {};
    applyAxeLook(); syncGhosts();
    clockT = (8 / 24) * DAY_LEN; bmFelled = 0; setWeather("clear", false);
}
function finishRebirth() {
    save.rebirths = 1; // Pine Island is the start; the Highland Isle is Rebirth 1
    resetForRebirth();
    enterIsle2(); newContract();
    holdingReset();
    player.maxHp = maxHpNow(); player.hp = player.maxHp;
    const a = arrPt(ARRLEN - 9, 0);
    player.pos.set(a.x, 1.75, a.z); player.vel.set(0, 0, 0); player.yaw = Math.atan2(ARRDIR.x, ARRDIR.z); player.pitch = 0;
    player.invuln = 6;
    ride = null;
    writeSave();
    say("");
    setTimeout(() => { $("rebirthFx").classList.remove("show"); say("THE HIGHLAND ISLE"); setTimeout(() => say(""), 3600); toast("You are reborn. ★" + save.rebirths + "  +" + save.rebirths * 50 + "% cash, +" + save.rebirths * 10 + "% damage, +" + save.rebirths * 50 + " max HP.", "cash"); toast("Walk inland to Basecamp. Trees here drop materials: sell them at the Trading Post, craft axes and guns at the Forge.", "good"); toast("The Rebirth Ferry docks on the far side of the island (north shore).", "rare"); }, 2200);
}
function holdingReset() { reloading = false; reloadT = 0; gun.visible = false; axe.visible = true; }



// =====================================================================
//  1.1.1: the secret cave and the Hypergamous Relic (6 pieces = the ticket to Rebirth 2)
// =====================================================================
const REBIRTH2_COST = 1250000;
const RELIC_N = 6;
const RELIC_HINTS = ["Somewhere deep underground...", "Beside the Golden Tree", "Among the crystals", "Inside the Ruined Temple", "Deep inside the Old Mine", "Behind the Hunter's Lodge"];
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
    const prev = addTgt; addTgt = isle2G;
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
    const prev = addTgt; addTgt = isle2G;
    const at = (i, x, z, up = 1.4) => makeRelicPiece(i, x, terrain2(x, z) + up, z);
    at(1, GPEAK.x + 7, GPEAK.z - 1);
    at(2, LM2[2].x - 2, LM2[2].z + 3);
    at(3, LM2[4].x - 3.5, LM2[4].z - 2.5, 1.9);
    makeRelicPiece(4, MX, 1.7, 50);
    const a = 0.5, lx = LM2[6].x - Math.sin(a) * 5.5, lz = LM2[6].z - Math.cos(a) * 5.5;
    at(5, lx, lz);
    buildCaveMouth();
    buildCave();
    addTgt = prev;
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
const rebirth2Ready = () => relicCount() === RELIC_N && save.money >= REBIRTH2_COST;
function renderFerry2() {
    const n = relicCount(), cashOk = save.money >= REBIRTH2_COST, relicOk = n === RELIC_N;
    document.querySelector("#panelFerry h2").textContent = "THE FERRY TO MOONCAP ISLE";
    const html = `<div class="fprice">Rebirth 2 ticket: <b>${money(REBIRTH2_COST)}</b> + <b>the Hypergamous Relic</b></div>
      <div class="flist">
        <div class="${cashOk ? "keep" : "lose"}"><h4>${cashOk ? "✔" : "✘"} CASH</h4>${money(save.money)} of ${money(REBIRTH2_COST)}</div>
        <div class="${relicOk ? "keep" : "lose"}"><h4>${relicOk ? "✔" : "✘"} RELIC PIECES</h4>${n} / ${RELIC_N} found · press K to see them</div>
        <div class="lose"><h4>YOU LEAVE BEHIND</h4>cash and materials · every axe and gun · all upgrades · the relic (it pays for the crossing) · the day count</div>
        <div class="gain"><h4>YOU GAIN (stacks every rebirth)</h4>★ +50% cash · ★ +10% damage · ★ +50 max health · ★ MOONCAP ISLE: two moons, glowing forests, falling stars, potions, three new axes, a beam gun... and the Elder Heart</div>
      </div>`;
    if ($("ferryBody").dataset.h !== html) { $("ferryBody").innerHTML = html; $("ferryBody").dataset.h = html; }
    const b = $("ferryBuy"), ok = relicOk && cashOk;
    b.disabled = !ok; b.classList.toggle("danger", ok && !!ferryConfirm);
    b.textContent = !relicOk ? `FIND ${RELIC_N - n} MORE RELIC PIECE${RELIC_N - n === 1 ? "" : "S"}` : !cashOk ? "NEED " + money(REBIRTH2_COST - save.money) + " MORE" : ferryConfirm ? "CLICK AGAIN TO CONFIRM" : "SAIL TO MOONCAP ISLE";
}


// =====================================================================
//  the Old Mine: walk in, follow the rails, mine ore veins with F (they grow back every day)
// =====================================================================
const MX = 3000;
const MINE_UP = 2.75; // the direction the hillside rises (the mouth faces the other way, toward camp)
const MINE_F = { x: -Math.cos(MINE_UP), z: -Math.sin(MINE_UP) };
const MINE_MOUTH = { x: -80.9, z: -28.6 };
const MINE_OUT = { x: MINE_MOUTH.x + MINE_F.x * 4, z: MINE_MOUTH.z + MINE_F.z * 4 };
function inMine() { return player.pos.x > 2500 && player.pos.x < 4500; }
// the tunnels, as rectangles [x0, x1, z0, z1] relative to (MX, 0)
const MINE_R = [[-1.8, 1.8, -5, 41.2], [-24, 24, 18, 21.6], [-24, -20.4, 20.4, 45.2], [20.4, 24, -4, 21.6], [-7.5, 7.5, 40, 54], [-24, -12, 44, 47.6], [12.4, 24, -4, -0.4]];
const MINE_H = 3.4;
const inRect = (x, z, r, m = 0) => x >= MX + r[0] + m && x <= MX + r[1] - m && z >= r[2] + m && z <= r[3] - m;
function clampMine(p) {
    for (const r of MINE_R) if (inRect(p.x, p.z, r, 0.45)) return;
    let bx = p.x, bz = p.z, bd = 1e9;
    for (const r of MINE_R) { const cx = clamp(p.x, MX + r[0] + 0.45, MX + r[1] - 0.45), cz = clamp(p.z, r[2] + 0.45, r[3] - 0.45), d = Math.hypot(cx - p.x, cz - p.z); if (d < bd) { bd = d; bx = cx; bz = cz; } }
    p.x = bx; p.z = bz;
}
const MINE_VEINS = [
    ["stone", 1.8, 6], ["copper", -1.8, 11], ["iron", 1.8, 15], ["stone", -1.8, 26], ["iron", 1.8, 33], ["copper", -1.8, 37],
    ["iron", -10, 21.6], ["copper", 8, 18], ["gold", 16, 21.6], ["iron", -24, 30], ["gold", -20.4, 38], ["copper", 24, 6],
    ["iron", 20.4, 12], ["gold", -18, 47.6], ["crystal", -7.5, 47], ["gold", 7.5, 50], ["iron", 0, 54], ["crystal", 5, 40.3]
];
const VEIN_AMT = { stone: [6, 10], copper: [4, 7], iron: [4, 7], gold: [2, 4], crystal: [1, 2] };
const veins = [];
let mineBuilt = false;
function buildMine() {
    mineBuilt = true;
    const prev = addTgt; addTgt = isle2G;
    const rock = batch(new THREE.MeshLambertMaterial({ color: 0x4a4038, flatShading: true })), floorB = batch(new THREE.MeshLambertMaterial({ color: 0x3a2e24, flatShading: true }));
    const ceil = batch(new THREE.MeshLambertMaterial({ color: 0x3a3430, flatShading: true })), tim = batch(new THREE.MeshLambertMaterial({ color: 0x6a4a2a, flatShading: true })), rail = batch(new THREE.MeshLambertMaterial({ color: 0x6a6a74, flatShading: true }));
    const inside = (x, z) => MINE_R.some(r => inRect(x, z, r));
    for (const r of MINE_R) {
        const w = r[1] - r[0], d = r[3] - r[2], cx = MX + (r[0] + r[1]) / 2, cz = (r[2] + r[3]) / 2;
        floorB.add(BOX, cx, -0.1, cz, 0, 0, 0, w, 0.2, d);
        ceil.add(BOX, cx, MINE_H + 0.15, cz, 0, 0, 0, w + 0.6, 0.3, d + 0.6);
        // walls: rough rock blocks along every edge that doesn't open into another tunnel
        const edge = (x0, z0, x1, z1, ox, oz) => {
            const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len);
            for (let k = 0; k < n; k++) {
                const u = (k + 0.5) / n, x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u;
                if (inside(x + ox * 0.3, z + oz * 0.3)) continue;
                const j = (hash2(Math.round(x * 3), Math.round(z * 3)) - 0.5) * 0.5;
                rock.add(BOX, x + ox * (0.45 + j * 0.3), MINE_H / 2, z + oz * (0.45 + j * 0.3), 0, j, 0, ox ? 0.9 : len / n + 0.15, MINE_H + 0.3, oz ? 0.9 : len / n + 0.15);
            }
        };
        edge(MX + r[0], r[2], MX + r[0], r[3], -1, 0); edge(MX + r[1], r[2], MX + r[1], r[3], 1, 0);
        edge(MX + r[0], r[2], MX + r[1], r[2], 0, -1); edge(MX + r[0], r[3], MX + r[1], r[3], 0, 1);
        // timber supports every few metres along the long corridors
        const long = d > w ? "z" : "x", L = Math.max(w, d);
        if (Math.min(w, d) < 5) for (let s = 2; s < L - 1; s += 4) {
            if (long === "z") { const z = r[2] + s; tim.add(BOX, MX + r[0] + 0.15, MINE_H / 2, z, 0, 0, 0, 0.22, MINE_H, 0.22); tim.add(BOX, MX + r[1] - 0.15, MINE_H / 2, z, 0, 0, 0, 0.22, MINE_H, 0.22); tim.add(BOX, cx, MINE_H - 0.15, z, 0, 0, 0, w, 0.22, 0.25); }
            else { const x = MX + r[0] + s; tim.add(BOX, x, MINE_H / 2, r[2] + 0.15, 0, 0, 0, 0.22, MINE_H, 0.22); tim.add(BOX, x, MINE_H / 2, r[3] - 0.15, 0, 0, 0, 0.22, MINE_H, 0.22); tim.add(BOX, x, MINE_H - 0.15, cz, 0, 0, 0, 0.25, 0.22, d); }
        }
    }
    // a connected rail network: down the main shaft into the deep room, and round the east branch, the cross tunnel and the west tunnel
    const track = pts => { // a polyline with rounded corners -> evenly spaced sleepers and two rails
        const P = [];
        for (let k = 0; k < pts.length; k++) {
            const [x, z] = pts[k];
            if (k === 0 || k === pts.length - 1) { P.push([x, z]); continue; }
            const [ax, az] = pts[k - 1], [bx2, bz] = pts[k + 1], R = 1.7;
            const l1 = Math.hypot(x - ax, z - az), l2 = Math.hypot(bx2 - x, bz - z), d1 = [(x - ax) / l1, (z - az) / l1], d2 = [(bx2 - x) / l2, (bz - z) / l2];
            for (let s = 0; s <= 8; s++) { const u = s / 8, p0 = [x - d1[0] * R, z - d1[1] * R], p2 = [x + d2[0] * R, z + d2[1] * R]; P.push([(1 - u) * (1 - u) * p0[0] + 2 * u * (1 - u) * x + u * u * p2[0], (1 - u) * (1 - u) * p0[1] + 2 * u * (1 - u) * z + u * u * p2[1]]); }
        }
        const S = []; // resample every 0.3 m
        for (let k = 0; k < P.length - 1; k++) { const [x0, z0] = P[k], [x1, z1] = P[k + 1], L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 0.3)); for (let s = 0; s < n; s++) S.push([x0 + (x1 - x0) * s / n, z0 + (z1 - z0) * s / n]); }
        S.push(P[P.length - 1]);
        let acc = 0;
        for (let k = 0; k < S.length - 1; k++) {
            const [x0, z0] = S[k], [x1, z1] = S[k + 1], L = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0), nx = Math.cos(yaw), nz = -Math.sin(yaw);
            for (const sd of [-0.45, 0.45]) rail.add(BOX, MX + (x0 + x1) / 2 + nx * sd, 0.1, (z0 + z1) / 2 + nz * sd, 0, yaw, 0, 0.08, 0.08, L + 0.04);
            acc += L; if (acc >= 0.85) { acc = 0; tim.add(BOX, MX + x0, 0.03, z0, 0, yaw, 0, 1.3, 0.06, 0.2); }
        }
    };
    track([[0, -4.8], [0, 45], [4.2, 51.6]]);
    track([[22.2, -3.6], [22.2, 19.8], [-22.2, 19.8], [-22.2, 43.6]]);
    rock.build(); floorB.build(); ceil.build(); tim.build(); rail.build();
    // carts, crates, and lanterns hanging from the beams
    for (const [x, z, ry] of [[MX, 30, 0], [MX - 22.2, 34, 0], [MX + 3.5, 50.5, 0.57]]) { const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = ry; part(c, BOX, lamb(0x5a3a22), 0, 0.55, 0, 1.1, 0.7, 1.6); part(c, BOX, lamb(0x7a6a5a), 0, 0.95, 0, 0.9, 0.2, 1.4); for (const [wx, wz] of [[-0.6, -0.5], [0.6, -0.5], [-0.6, 0.5], [0.6, 0.5]]) part(c, CYL8, lamb(0x2a2a30), wx * 0.75, 0.32, wz, 0.18, 0.08, 0.18, 0, 0, Math.PI / 2); c.position.y = 0.04; scene.add(c); }
    for (const [x, z] of [[0, 4], [0, 20], [-14, 19.8], [14, 19.8], [-22, 32], [22, 8], [0, 47], [-18, 46]]) {
        const lx = MX + x;
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), new THREE.MeshBasicMaterial({ color: 0xffc060 })); lamp.position.set(lx, MINE_H - 0.55, z); scene.add(lamp);
        const L = new THREE.PointLight(0xffb050, 10, 13, 1.6); L.position.set(lx, MINE_H - 0.8, z); scene.add(L);
    }
    const exitGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, MINE_H), new THREE.MeshBasicMaterial({ color: 0xcfe8ff })); exitGlow.position.set(MX, MINE_H / 2, -4.95); scene.add(exitGlow);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1), new THREE.MeshBasicMaterial({ map: signTex("THE DEEP VEIN", "MIND YOUR HEAD", "#ffb060") })); sign.position.set(MX, 2.6, 39.7); sign.rotation.y = Math.PI; scene.add(sign);
    // ore veins: glowing lumps in the walls
    MINE_VEINS.forEach(([k, x, z], i) => {
        const g = new THREE.Group(); g.position.set(MX + x, 1.1 + (i % 3) * 0.35, z); scene.add(g);
        const m = matMeshMat[k];
        part(g, ICO, lamb(0x4a4038), 0, 0, 0, 0.65, 0.55, 0.65);
        for (let c = 0; c < 5; c++) part(g, ICO, m, Math.cos(c * 1.3) * 0.42, Math.sin(c * 2.1) * 0.3, Math.sin(c * 1.3) * 0.42, 0.2, 0.18, 0.2);
        veins.push({ i, k, g, x: MX + x, z, y: g.position.y });
    });
    addTgt = prev;
    syncVeins();
}
function syncVeins() { if (!Array.isArray(save.veins)) save.veins = []; for (const v of veins) v.g.visible = save.veins[v.i] !== save.day; }
function buildMineMouth() {
    const gy = terrain2(MINE_MOUTH.x, MINE_MOUTH.z), yaw = Math.atan2(MINE_F.x, MINE_F.z);
    const g = new THREE.Group(); g.position.set(MINE_MOUTH.x, gy, MINE_MOUTH.z); g.rotation.y = yaw; scene.add(g);
    const st = lamb(0x6a6a74), tb = woodDark;
    part(g, BOX, st, -2.2, 1.7, -0.6, 1.2, 3.6, 2.2); part(g, BOX, st, 2.2, 1.7, -0.6, 1.2, 3.6, 2.2); part(g, BOX, st, 0, 3.9, -0.6, 5.6, 1.2, 2.4);
    part(g, ICO, lamb(0x5a5660), -3.4, 1.0, -1.2, 1.6, 1.8, 1.6); part(g, ICO, lamb(0x5a5660), 3.4, 1.2, -1.2, 1.6, 2.0, 1.6);
    part(g, BOX, tb, -1.35, 1.5, 0.35, 0.28, 3.0, 0.28); part(g, BOX, tb, 1.35, 1.5, 0.35, 0.28, 3.0, 0.28); part(g, BOX, tb, 0, 3.05, 0.35, 3.0, 0.28, 0.3);
    part(g, BOX, new THREE.MeshBasicMaterial({ color: 0x010204 }), 0, 1.45, -0.9, 2.5, 2.9, 2.6);
    const swl = (lx, lz) => ({ x: MINE_MOUTH.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z: MINE_MOUTH.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz });
    const hAt = lz => { const p = swl(0, lz); return terrain2(p.x, p.z) - gy; }, railM = lamb(0x6a6a74);
    for (let i = 0; i < 9; i++) { const lz = -0.6 + i * 1.0; part(g, BOX, tb, 0, Math.max(hAt(lz), 0) + 0.03, lz, 1.4, 0.07, 0.2, 0, 0, 0); }
    for (let i = 0; i < 8; i++) { const z0 = -0.6 + i, z1 = z0 + 1, y0 = Math.max(hAt(z0), 0) + 0.1, y1 = Math.max(hAt(z1), 0) + 0.1, L = Math.hypot(1, y1 - y0), pitch = -Math.atan2(y1 - y0, 1); for (const sx of [-0.45, 0.45]) part(g, BOX, railM, sx, (y0 + y1) / 2, (z0 + z1) / 2, 0.08, 0.08, L + 0.03, pitch); }
    { const cy = Math.max(hAt(3.2), 0); part(g, BOX, lamb(0x5a3a22), 0, cy + 0.6, 3.2, 1.1, 0.7, 1.6); part(g, BOX, lamb(0x8a8a96), 0, cy + 1.0, 3.2, 0.9, 0.25, 1.4); for (const [wx2, wz2] of [[-0.45, 2.7], [0.45, 2.7], [-0.45, 3.7], [0.45, 3.7]]) part(g, CYL8, lamb(0x2a2a30), wx2, cy + 0.3, wz2, 0.18, 0.08, 0.18, 0, 0, Math.PI / 2); }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), new THREE.MeshBasicMaterial({ color: 0xffc060 })); lamp.position.set(0, 2.7, 0.55); g.add(lamp);
    const L = new THREE.PointLight(0xffb050, 8, 12, 1.6); L.position.set(0, 2.6, 1.2); g.add(L);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.95), new THREE.MeshBasicMaterial({ map: signTex("OLD MINE", "ORE INSIDE", "#c0a080") })); sign.position.set(0, 4.95, 0.62); g.add(sign);
    const sw = (lx, lz) => ({ x: MINE_MOUTH.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z: MINE_MOUTH.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz });
    for (const [lx, lz, r] of [[-2.2, -0.6, 1.3], [2.2, -0.6, 1.3], [0, 3.2, 0.9], [-3.4, -1.2, 1.5], [3.4, -1.2, 1.5]]) { const p = sw(lx, lz); circles.push({ x: p.x, z: p.z, r }); }
    const l = label("OLD MINE", "#c0a080", 3.2, 0.8); l.position.set(MINE_MOUTH.x, gy + 6.4, MINE_MOUTH.z);
}
let mineCd = 0;
function updateMine(dt) {
    if (!mineBuilt) return;
    for (const v of veins) if (v.g.visible) v.g.rotation.y += dt * 0.15;
    mineCd -= dt;
    if (state !== "playing" || ride || mineCd > 0 || caveFx) return;
    const px = player.pos.x, pz = player.pos.z;
    if (!inCave() && Math.hypot(px - (MINE_MOUTH.x - MINE_F.x * 0.3), pz - (MINE_MOUTH.z - MINE_F.z * 0.3)) < 1.3) {
        mineCd = 1.5;
        fadeTo(() => { player.pos.set(MX, 1.7, -2.5); player.vel.set(0, 0, 0); player.yaw = Math.PI; player.pitch = 0; syncVeins(); sfx(120, 0.5, "sine", 0.07, 0.6); if (!save.mineFound) { save.mineFound = 1; toast("The Old Mine. Press F on glowing ore veins to mine them. They grow back every day.", "rare"); writeSave(); } });
    } else if (inMine() && pz < -4.1) {
        mineCd = 1.5;
        fadeTo(() => { player.pos.set(MINE_OUT.x, terrain2(MINE_OUT.x, MINE_OUT.z) + 1.7, MINE_OUT.z); player.vel.set(0, 0, 0); player.yaw = Math.atan2(-MINE_F.x, -MINE_F.z); player.pitch = 0; });
    }
}
function mineVein(v) {
    if (save.veins[v.i] === save.day) return;
    save.veins[v.i] = save.day; v.g.visible = false;
    const [lo, hi] = VEIN_AMT[v.k], n = Math.round(rand(lo, hi) * (1 + bestIdx() * 0.12));
    save.mats[v.k] = (save.mats[v.k] || 0) + n;
    swing.t = 0; swing.hit = true; shake = 0.25;
    burst(V3(v.x, v.y, v.z), 14, 4, [matMeshMat[v.k], chipMats[2]]);
    sfx(900, 0.08, "square", 0.08, 0.5); setTimeout(() => sfx(1300, 0.06, "square", 0.06, 0.6), 90);
    toast(`+${n} ${MATS[v.k].name}`, "log");
    writeSave();
}

// =====================================================================
//  1.2.0: REBIRTH 2: Mooncap Isle, the Elder Heart, falling stars, the Apothecary
// =====================================================================
// ---- switching between islands: each island keeps its own colliders, chests and altar ----
const worldSnap = {};
let isle1Water = null, isle1Emit = null;
function snapWorld(n) { worldSnap[n] = { colliders: colliders.slice(), circles: circles.slice(), occluders: occluders.slice(), chests: chests.slice(), altar }; }
function loadWorld(n) {
    const s = worldSnap[n]; if (!s) return;
    for (const [arr, src] of [[colliders, s.colliders], [circles, s.circles], [occluders, s.occluders], [chests, s.chests]]) { arr.length = 0; arr.push(...src); }
    altar = s.altar;
}
function leaveWorld() {
    if (isle === 1 && !worldSnap[1]) { snapWorld(1); isle1Water = waterMesh.geometry; isle1Emit = smokeEmit.slice(); }
    if (isle === 3 && fight3.on) endFight(false, true);
    if (isle === 4 && fight4.on) endFight4(false, true);
    if (isle === 5) B5.on = false;
    for (const p of smokePuffs) if (p.m.parent === isle1) { isle1.remove(p.m); scene.add(p.m); }
}
function showWorld(n) {
    isle1.visible = n === 1; isle2G.visible = n === 2; isle3G.visible = n === 3; isle4G.visible = n === 4; isle5G.visible = n === 5;
    moon2.visible = false; for (const a of aurora) a.visible = false; spores3.visible = n === 3; ash4.visible = n === 4;
    wisps.material.color.setHex(n === 4 ? 0xffa060 : n === 3 ? 0xffb0f0 : 0x9dffd0);
    ghostMat.color.setHex(n === 4 ? 0xffb080 : n === 3 ? 0xd0b0ff : 0x9fe8ff); // the ghosts take on each island's glow
    placeEnchTable();
}
function resetIsleTrees(n) {
    for (const t of trees) { if (!t.boss) scene.remove(t.g); t.gone = true; if (t.bar) { t.bar.remove(); t.bar = null; } }
    trees.length = 0;
    for (const l of logs) scene.remove(l.m);
    logs.length = 0;
    for (const q of sending) scene.remove(q.m);
    sending.length = 0; sendVals.length = 0;
    for (let i = 0; i < n; i++) spawnTree(false);
}
// back to Pine Island (only the dev panel does this)
function enterIsle1() {
    if (isle === 1) return;
    leaveWorld(); loadWorld(1);
    isle = 1; save.isle = 1;
    showWorld(1);
    groundFn = null;
    if (isle1Water) { waterMesh.geometry = isle1Water; waterMesh.material.needsUpdate = true; }
    smokeEmit.length = 0; (isle1Emit || []).forEach(e => smokeEmit.push(e));
    RESPAWN.x = 1; RESPAWN.z = 0;
    resetIsleTrees(60);
    resetChests();
}

// ---- the shape of Mooncap Isle ----
const shoreR3 = th => 136 + 10 * Math.sin(2 * th + 0.4) + 7 * Math.sin(3 * th + 1.9) + 4 * Math.sin(5 * th + 0.7);
const shoreAt3 = (x, z) => shoreR3(Math.atan2(z, x));
const ARR3TH = (() => { let b = 0, m = 1e9; for (let i = 0; i < 360; i++) { const th = (i / 360) * Math.PI * 2, r = shoreR3(th); if (r < m) { m = r; b = th; } } return b; })();
const at3 = (k, d) => ({ x: Math.cos(ARR3TH + k * Math.PI) * d, z: Math.sin(ARR3TH + k * Math.PI) * d }); // k: half-turns round from where you land
const HOLLOW = { ...at3(1, 80), r: 21 };
const WELL = { ...at3(0.55, 62), r: 11 };
const CRATER = { ...at3(0.3, 75), r: 12 };
const OBS = at3(-0.78, 70);
const MARSH = { ...at3(-0.28, 72), r: 15 };
const GROVE3 = { ...at3(-0.55, 66), r: 20 };
const CIRCLE3 = at3(0.78, 46);
const ARR3DIR = V3(Math.cos(ARR3TH), 0, Math.sin(ARR3TH)), ARR3PERP = V3(-ARR3DIR.z, 0, ARR3DIR.x), ARR3LEN = 22;
const ARR3B = V3(ARR3DIR.x * (shoreR3(ARR3TH) - 8), 0, ARR3DIR.z * (shoreR3(ARR3TH) - 8));
const arr3Pt = (a, s = 0, y = 0) => V3(ARR3B.x + ARR3DIR.x * a + ARR3PERP.x * s, y, ARR3B.z + ARR3DIR.z * a + ARR3PERP.z * s);
// the Rebirth 3 ferry docks on the far side of the island from Arrivals, just past the Hollow
const D3TH = ARR3TH + Math.PI * 0.88;
const D3DIR = V3(Math.cos(D3TH), 0, Math.sin(D3TH)), D3PERP = V3(-D3DIR.z, 0, D3DIR.x), D3LEN = 24;
const D3B = V3(D3DIR.x * (shoreR3(D3TH) - 8), 0, D3DIR.z * (shoreR3(D3TH) - 8));
const dock3Pt = (a, s = 0, y = 0) => V3(D3B.x + D3DIR.x * a + D3PERP.x * s, y, D3B.z + D3DIR.z * a + D3PERP.z * s);
const FERRYMAN3 = { x: dock3Pt(D3LEN - 3.5, -0.9).x, z: dock3Pt(D3LEN - 3.5, -0.9).z };
const DOCKS3 = [[ARR3B, ARR3DIR, ARR3PERP, ARR3LEN], [D3B, D3DIR, D3PERP, D3LEN]];
const BED3 = { x: -9, z: 6 }, SMITH3 = { x: -11, z: -7 }, DEPOT3 = { x: 11, z: -7 }, WITCH3 = { x: 0, z: 14 };
const SMITH3_AT = standPt(SMITH3), DEPOT3_AT = standPt(DEPOT3), WITCH3_AT = standPt(WITCH3, 2.6);
const OBS_DOOR = { x: OBS.x + (0 - OBS.x) / Math.hypot(OBS.x, OBS.z) * 4.2, z: OBS.z + (0 - OBS.z) / Math.hypot(OBS.x, OBS.z) * 4.2 };
const LM3 = [
    { name: "LANTERN CAMP", x: 0, z: 0, r: 24, col: "#c8a0ff", camp: true },
    { name: "THE HOLLOW", x: HOLLOW.x, z: HOLLOW.z, r: HOLLOW.r + 5, col: "#ff5a8a" },
    { name: "MOONWELL", x: WELL.x, z: WELL.z, r: WELL.r + 4, col: "#7affef" },
    { name: "STARFALL CRATER", x: CRATER.x, z: CRATER.z, r: CRATER.r + 3, col: "#fff4a0" },
    { name: "OBSERVATORY", x: OBS.x, z: OBS.z, r: 8, col: "#9fd8ff" },
    { name: "GLOWCAP GROVE", x: GROVE3.x, z: GROVE3.z, r: 12, col: "#d0a8ff" },
    { name: "SPORE MARSH", x: MARSH.x, z: MARSH.z, r: MARSH.r, col: "#7affb0" },
    { name: "MOON CIRCLE", x: CIRCLE3.x, z: CIRCLE3.z, r: 8, col: "#e0d0ff" }
];
function terrain3(x, z) {
    const d = Math.hypot(x, z), inside = shoreAt3(x, z) - d;
    if (inside < 5) return Math.max(-3.4, -(5 - inside) * 0.2);
    let h = Math.max(0, fbm2(x * 0.016 + 11.3, z * 0.016 - 4.2, 4) - 0.4) * 24 * sstep(24, 56, d) + fbm2(x * 0.07, z * 0.07, 2) * 1.1;
    h += 11 * sstep(26, 3, Math.hypot(x - OBS.x, z - OBS.z));                                  // the observatory hill
    const dc = Math.hypot(x - CRATER.x, z - CRATER.z);
    h = lerp(h, 0.3, sstep(CRATER.r + 1, CRATER.r - 4, dc)) + 3.2 * Math.exp(-((dc - CRATER.r - 1) ** 2) / 10); // the crater: a flat floor inside a raised rim
    h *= sstep(16, 30, d) * sstep(5, 28, inside);
    h = lerp(h, 0.15, sstep(HOLLOW.r + 12, HOLLOW.r + 1, Math.hypot(x - HOLLOW.x, z - HOLLOW.z)));   // the Hollow: a flat arena
    h = lerp(h, 0.05 + fbm2(x * 0.2, z * 0.2, 2) * 0.45, sstep(MARSH.r + 8, MARSH.r - 3, Math.hypot(x - MARSH.x, z - MARSH.z)));
    const lk = sstep(WELL.r + 9, WELL.r - 1, Math.hypot(x - WELL.x, z - WELL.z));
    return h * (1 - lk) - lk * 2.6;
}
function groundY3(x, z) {
    for (const [B, DIR, PERP, LEN] of DOCKS3) { const { along, side } = dockLocal(x, z, B, DIR, PERP); if (along > 4 && along < LEN + 3 && Math.abs(side) < 3) return 0; }
    return Math.max(-0.4, terrain3(x, z));
}
function clampIsle3(p) {
    for (const [B, DIR, PERP, LEN] of DOCKS3) {
        const { along, side } = dockLocal(p.x, p.z, B, DIR, PERP);
        if (along > 4.5 && along < LEN + 3 && Math.abs(side) < 6) {
            const a = Math.min(along, LEN - 0.7), s = clamp(side, -1.65, 1.65);
            p.x = B.x + DIR.x * a + PERP.x * s; p.z = B.z + DIR.z * a + PERP.z * s;
            return;
        }
    }
    const lim = shoreAt3(p.x, p.z) - 3, d = Math.hypot(p.x, p.z);
    if (d > lim) { p.x *= lim / d; p.z *= lim / d; }
    if (fight3.on) { // the roots have sealed the Hollow
        const dx = p.x - HOLLOW.x, dz = p.z - HOLLOW.z, dd = Math.hypot(dx, dz), R = HOLLOW.r - 1.3;
        if (dd > R) { p.x = HOLLOW.x + dx / dd * R; p.z = HOLLOW.z + dz / dd * R; }
    }
}
const treeOk3 = (x, z) => Math.hypot(x - HOLLOW.x, z - HOLLOW.z) > HOLLOW.r + 9 && Math.hypot(x - WELL.x, z - WELL.z) > WELL.r + 7 && Math.hypot(x - ARR3B.x, z - ARR3B.z) > 12 && Math.hypot(x - D3B.x, z - D3B.z) > 12;
const inHollow = () => isle === 3 && Math.hypot(player.pos.x - HOLLOW.x, player.pos.z - HOLLOW.z) < HOLLOW.r;

// ---- the sky: a second moon, the aurora, drifting spores ----
const isle3G = new THREE.Group(); isle3G.visible = false; scene.add(isle3G);
const isle3 = { waterGeo: null, foam: null, emit: [], fire: null, fireLight: null, wellWater: null, wellLight: null, boat: null, cauldron: null, bubbles: [], lanterns: null, glowCaps: [], crater: null };
let isle3Built = false, ferryman3 = null, mapBg3 = null;
const npcs3 = [];
const moon2 = new THREE.Group();
{
    moon2.add(new THREE.Mesh(new THREE.SphereGeometry(22, 14, 10), new THREE.MeshBasicMaterial({ color: 0xd8c4ff, fog: false })));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(36, 1.4, 4, 48), new THREE.MeshBasicMaterial({ color: 0xb8a0ff, fog: false, transparent: true, opacity: 0.55 }));
    ring.rotation.x = 1.25; moon2.add(ring);
    moon2.visible = false; scene.add(moon2);
}
const aurora = [];
for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(320, 38, 64, 1), col = [], c = new THREE.Color(), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const top = pos.getY(i) > 0; c.setHex(top ? [0x5a1aa0, 0x2a1a8a, 0x8a1a8a][k] : [0x3affb0, 0x5ab8ff, 0xff6ad8][k]); col.push(c.r, c.g, c.b); }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.userData.base = Float32Array.from(pos.array); m.userData.k = k; m.visible = false; m.frustumCulled = false;
    scene.add(m); aurora.push(m);
}
const spores3 = (() => {
    const N = 420, p = new Float32Array(N * 3), col = new Float32Array(N * 3), c = new THREE.Color();
    for (let i = 0; i < N; i++) { p[i * 3] = rand(-40, 40); p[i * 3 + 1] = rand(0, 14); p[i * 3 + 2] = rand(-40, 40); c.setHex([0xd8a8ff, 0x8affe8, 0xff9ae0, 0xfff0a0][i % 4]); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
    pts.visible = false; pts.frustumCulled = false; scene.add(pts);
    return pts;
})();
const moon2Dir = V3(-0.55, 0.62, 0.56).normalize();
function sky3(d) {
    const night = 1 - d, cl = 1 - clamp(wx.cloud * 0.7 + wx.rain, 0, 1);
    moon2.visible = night > 0.08 && !inCave();
    moon2.position.copy(camera.position).addScaledVector(moon2Dir, 340);
    moon2.lookAt(camera.position);
    moon2.children[0].material.color.setHex(isBlood() ? 0xff6a8a : 0xd8c4ff);
    for (const a of aurora) { a.visible = night > 0.15; a.material.opacity = night * 0.55 * cl * (isBlood() ? 0.4 : 1); }
    spores3.material.opacity = 0.35 + night * 0.6;
    wisps.material.color.setHex(0xffb0f0);
}
function updateSky3(dt) {
    for (const a of aurora) {
        if (!a.visible) continue;
        const k = a.userData.k, b = a.userData.base, p = a.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) { const x = b[i * 3], y = b[i * 3 + 1]; p.setXYZ(i, x, y + Math.sin(x * 0.02 + time * 0.3 + k) * 6, Math.sin(x * 0.012 + time * 0.22 + k * 2) * 26 + (y > 0 ? 6 : 0)); }
        p.needsUpdate = true;
        a.position.set(camera.position.x + [0, -60, 70][k], 108 + k * 12, camera.position.z - 170 + k * 55);
        a.rotation.set(-0.35, [0.1, 0.5, -0.4][k], 0);
    }
    if (spores3.visible) {
        const p = spores3.geometry.attributes.position, cx = player.pos.x, cz = player.pos.z, cy = groundY(cx, cz);
        for (let i = 0; i < p.count; i++) {
            let x = p.getX(i), y = p.getY(i) + dt * (0.25 + (i % 5) * 0.06), z = p.getZ(i);
            x += Math.sin(time * 0.6 + i) * dt * 0.3; z += Math.cos(time * 0.5 + i * 1.3) * dt * 0.3;
            if (x - cx > 40) x -= 80; else if (x - cx < -40) x += 80;
            if (z - cz > 40) z -= 80; else if (z - cz < -40) z += 80;
            if (y > cy + 16) y = cy - 1 + Math.random();
            p.setXYZ(i, x, y, z);
        }
        p.needsUpdate = true;
    }
}

// ---- building the island ----
const glowM = c => new THREE.MeshBasicMaterial({ color: c });
const fxPink = glowM(0xff6a9a), fxRed = glowM(0xff3a6a), fxWhite = glowM(0xffe0ea), fxGold = glowM(0xfff4a0);
function makeFerrymanFigure(coat, trim, orbCol) {
    const f = new THREE.Group(), coatM = lamb(coat), trimM = lamb(trim);
    const p = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); f.add(o); return o; };
    p(new THREE.CylinderGeometry(0.32, 0.95, 2.3, 8), coatM, 0, 1.15, 0);
    p(new THREE.CylinderGeometry(0.97, 0.99, 0.12, 8), trimM, 0, 0.06, 0);
    p(new THREE.SphereGeometry(0.62, 8, 5), coatM, 0, 2.2, 0).scale.set(1.15, 0.55, 0.85);
    p(new THREE.SphereGeometry(0.5, 8, 6), coatM, 0, 2.6, 0).scale.set(1, 1.15, 1.1);
    p(new THREE.ConeGeometry(0.4, 0.8, 7), coatM, 0, 3.15, -0.2).rotation.x = -0.55;
    p(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: ferrymanTex(), transparent: true }), 0, 2.58, 0.56);
    p(new THREE.CylinderGeometry(0.03, 0.03, 3.2, 5), woodDark, 0.95, 1.6, 0.55);
    p(new THREE.SphereGeometry(0.22, 7, 6), glowM(orbCol), 0.95, 3.25, 0.55);
    return f;
}
function makeBoat3(hullC, trimC, lampC) {
    const b = new THREE.Group(), hullM = lamb(hullC), trimM = lamb(trimC);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.0, 7.6), hullM); hull.position.y = 0.2;
    const bowG = new THREE.ConeGeometry(1.35, 2.4, 4); bowG.rotateX(Math.PI / 2); bowG.rotateZ(Math.PI / 4);
    const bow = new THREE.Mesh(bowG, hullM); bow.position.set(0, 0.2, 5.0); bow.scale.y = 0.75;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.18, 7.8), trimM); trim.position.y = 0.72;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 2.6), trimM); cabin.position.set(0, 1.5, -1.3);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5, 6), woodDark); mast.position.set(0, 3.0, 1.6);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), glowM(lampC)); lamp.position.set(0, 5.6, 1.6);
    b.add(hull, bow, trim, cabin, mast, lamp);
    return b;
}
// a market stall facing camp: counter, posts, a canvas roof and a glowing sign
function stall3(at, signA, signB, signCol, roofCol) {
    const g = new THREE.Group(); g.position.set(at.x, groundY3(at.x, at.z), at.z); g.rotation.y = Math.atan2(-at.x, -at.z);
    const canvasM = new THREE.MeshLambertMaterial({ color: roofCol, flatShading: true, side: THREE.DoubleSide });
    const b = (m, x, y, z, sx, sy, sz, rx = 0) => { const o = new THREE.Mesh(BOX, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.rotation.x = rx; g.add(o); return o; };
    b(wood, 0, 0.52, 0.7, 4.2, 1.05, 1.1); b(woodDark, 0, 1.08, 0.7, 4.5, 0.1, 1.4);
    for (const sx of [-2.1, 2.1]) for (const sz of [0.1, -2.0]) { const p = new THREE.Mesh(CYL6, woodDark); p.scale.set(0.1, 3.2, 0.1); p.position.set(sx, 1.6, sz); g.add(p); }
    b(canvasM, 0, 3.25, -0.9, 5, 0.12, 3.4, 0.08); b(wood, 0, 1.5, -2.0, 4.2, 3, 0.12);
    for (let k = 0; k < 9; k++) { const o = new THREE.Mesh(ICO, glowM([0xffd890, 0xc8a0ff, 0x8affe8][k % 3])); o.scale.setScalar(0.09); o.position.set(-2.2 + k * 0.55, 3.05 - Math.abs(Math.sin(k * 0.9)) * 0.18, 0.75); g.add(o); } // string lights
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.28), new THREE.MeshBasicMaterial({ map: signTex(signA, signB, signCol), side: THREE.DoubleSide })); sign.position.set(0, 4.15, 0.95); g.add(sign);
    scene.add(g);
    colliders.push([at.x - 2.6, at.x + 2.6, at.z - 2.6, at.z + 2.6]);
    return g;
}
function buildIsle3() {
    isle3Built = true;
    curBuild = 3;
    const prevAdd = addTgt; addTgt = isle3G;
    colliders.length = 0; circles.length = 0; occluders.length = 0; chests.length = 0; altar = null;

    // ----- the land: teal and violet meadows, silver sand, a dark Hollow -----
    {
        const g = new THREE.PlaneGeometry(400, 400, 210, 210);
        g.rotateX(-Math.PI / 2);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setY(i, terrain3(pos.getX(i), pos.getZ(i)));
        g.computeVertexNormals();
        const nor = g.attributes.normal, col = [], c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i), ny = nor.getY(i), d = Math.hypot(x, z), inside = shoreAt3(x, z) - d, rn = Math.random();
            const dh = Math.hypot(x - HOLLOW.x, z - HOLLOW.z), dm = Math.hypot(x - MARSH.x, z - MARSH.z), dc = Math.hypot(x - CRATER.x, z - CRATER.z);
            if (y < -0.5) c.setHSL(0.72, 0.25, 0.14 + rn * 0.04);                                 // seabed
            else if (Math.hypot(x - WELL.x, z - WELL.z) < WELL.r + 4) c.setHSL(0.5, 0.3, 0.2 + rn * 0.05);
            else if (inside < 12 && y < 2.2) c.setHSL(0.72, 0.16, 0.6 + rn * 0.06);               // silver-lilac sand
            else if (d < SAFE_R + 1) c.setHSL(0.76, 0.18, 0.18 + rn * 0.05);
            else if (dh < HOLLOW.r + 1) c.setHSL(0.93, 0.32, 0.12 + rn * 0.04);                   // the Hollow's dark red earth
            else if (dm < MARSH.r) c.setHSL(0.46, 0.42, 0.13 + rn * 0.04);
            else if (dc < CRATER.r - 1) c.setHSL(0.62, 0.22, 0.2 + rn * 0.05);
            else if (ny < 0.8) c.setHSL(0.7, 0.12, 0.3 + rn * 0.06);                              // rocky slopes
            else { const v = sstep(0.42, 0.58, fbm2(x * 0.03 + 5, z * 0.03 - 7, 3)); c.setHSL(lerp(0.48, 0.78, v) + rn * 0.03, 0.38, 0.17 + rn * 0.06 + clamp(y / 20, 0, 1) * 0.06); }
            col.push(c.r, c.g, c.b);
        }
        g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        scene.add(terrainMesh[3] = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
        const wg = new THREE.PlaneGeometry(760, 760, 152, 152);
        wg.rotateX(-Math.PI / 2);
        const wp = wg.attributes.position, wc = [], cc = new THREE.Color(), shallow = new THREE.Color(0x7ae4f4), mid = new THREE.Color(0x4a6ad8), deep = new THREE.Color(0x221a62);
        for (let i = 0; i < wp.count; i++) { const x = wp.getX(i), z = wp.getZ(i), k = clamp((Math.hypot(x, z) - shoreAt3(x, z)) / 36, 0, 1); cc.copy(shallow).lerp(mid, clamp(k * 2, 0, 1)).lerp(deep, clamp(k * 2 - 1, 0, 1)); wc.push(cc.r, cc.g, cc.b); }
        wg.setAttribute("color", new THREE.Float32BufferAttribute(wc, 3));
        isle3.waterGeo = wg;
        const N = 300, fp = [], idx = [];
        for (let i = 0; i <= N; i++) { const th = (i / N) * Math.PI * 2, r = shoreR3(th); fp.push(Math.cos(th) * (r - 3.5), -0.4, Math.sin(th) * (r - 3.5), Math.cos(th) * (r - 2.2), -0.4, Math.sin(th) * (r - 2.2)); if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
        const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3)); fg.setIndex(idx);
        isle3.foam = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0xf0e8ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
        scene.add(isle3.foam);
    }

    // ----- Lantern Camp: a fire that burns violet, the Moonforge, the Trading Post, the Apothecary, a bed -----
    {
        const stones = batch(lamb(0x8a84a0));
        for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.28; stones.add(ICO, Math.cos(a) * 1.3, 0.18, -3 + Math.sin(a) * 1.3, 0, 0, 0, 0.28, 0.22, 0.28); }
        stones.build();
        const lg = batch(woodDark);
        for (let i = 0; i < 4; i++) lg.add(CYL6, 0, 0.25, -3, Math.PI / 2, i * 0.8, 0, 0.12, 1.3, 0.12);
        lg.build();
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.7, 6), glowM(0x8a6aff)); flame.position.set(0, 1.05, -3);
        const core = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 5), glowM(0xe8dcff)); core.position.set(0, 0.72, -3);
        const pool = new THREE.Mesh(new THREE.CircleGeometry(5.5, 16), new THREE.MeshBasicMaterial({ color: 0x9a7aff, transparent: true, opacity: 0.2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false }));
        pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.04, -3);
        scene.add(flame, core, pool);
        fires.push({ flame, core, ph: srand() * 6 });
        const fl = new THREE.PointLight(0xa88aff, 18, 18, 1.6); fl.position.set(0, 2, -3); scene.add(fl); isle3.fireLight = fl;
        circles.push({ x: 0, z: -3, r: 1.3 });
        isle3.fire = flame;
        const seats = batch(wood);
        for (const [dx, dz, r] of [[-2.6, -3.5, 0.2], [2.5, -2.4, -0.5], [0.4, -5.9, Math.PI / 2]]) seats.add(CYL6, dx, 0.28, dz, 0, r, Math.PI / 2, 0.22, 1.7, 0.22);
        seats.build();
        const cl = label("LANTERN CAMP", "#c8a0ff", 3.4, 0.8); cl.position.set(0, 4.6, -3); cl.maxD = 90;
    }
    {   // bed: a lean-to under violet canvas
        const g = new THREE.Group(); g.position.set(BED3.x, groundY3(BED3.x, BED3.z), BED3.z); g.rotation.y = Math.atan2(-BED3.x, -BED3.z);
        const canvasM = new THREE.MeshLambertMaterial({ color: 0x5a4a8a, flatShading: true, side: THREE.DoubleSide });
        const roof = new THREE.Mesh(BOX, canvasM); roof.scale.set(3.4, 0.08, 2.8); roof.position.set(0, 2.2, -0.3); roof.rotation.x = 0.28; g.add(roof);
        for (const [px, pz] of [[-1.6, 0.9], [1.6, 0.9], [-1.6, -1.5], [1.6, -1.5]]) { const p = new THREE.Mesh(CYL6, woodDark); p.scale.set(0.07, pz > 0 ? 2.0 : 2.5, 0.07); p.position.set(px, pz > 0 ? 1.0 : 1.25, pz); g.add(p); }
        const cot = new THREE.Mesh(BOX, wood); cot.scale.set(1.4, 0.3, 2.3); cot.position.set(0, 0.35, -0.2); g.add(cot);
        const blanket = new THREE.Mesh(BOX, lamb(0x3a2a7a)); blanket.scale.set(1.3, 0.14, 1.5); blanket.position.set(0, 0.58, -0.55); g.add(blanket);
        const pillow = new THREE.Mesh(BOX, lamb(0xe8e0f0)); pillow.scale.set(1.0, 0.14, 0.5); pillow.position.set(0, 0.58, 0.7); g.add(pillow);
        const lamp = new THREE.Mesh(ICO, glowM(0xffd890)); lamp.scale.setScalar(0.14); lamp.position.set(1.4, 1.9, 0.8); g.add(lamp);
        scene.add(g);
        circles.push({ x: BED3.x, z: BED3.z, r: 1.4 });
        const bl = label("BED", "#b8c8ff", 2, 0.6); bl.position.set(BED3.x, 3.0, BED3.z);
    }
    {   // the Moonforge
        const g = stall3(SMITH3, "THE MOONFORGE", "CRAFT AXES · GUNS", "#9fd8ff", 0x2a3a6a);
        const anvil = new THREE.Mesh(BOX, lamb(0x3a3a4a)); anvil.scale.set(0.7, 0.5, 0.45); anvil.position.set(2.7, 0.25, 0.9); g.add(anvil);
        const smith = makeHumanoid({ face: "smith", skin: 0xc8a0a0, shirt: 0x2a3a6a, pants: 0x1a1a2a, apron: 0x3a2a4a, beard: 0xd8d8e8, hat: "mask", wide: 1.25, belly: true });
        smith.g.position.set(0, 0, -0.6); g.add(smith.g); smith.yaw = g.rotation.y; npcs3.push(smith);
        const hm = new THREE.Group(); hm.position.set(0, -0.64, 0.05); smith.armR.add(hm);
        part(hm, BOX, lamb(0x6a4a2a), 0, 0, 0.22, 0.05, 0.05, 0.5); smith.hammer = part(hm, BOX, lamb(0xb8c4e8), 0, 0, 0.48, 0.24, 0.13, 0.13);
        part(g, BOX, glowM(0x9fe0ff), 0, 1.16, 0.5, 0.36, 0.06, 0.14); // a glowing moonsilver ingot
        const furnace = new THREE.Group(); furnace.position.set(1.4, 0, -1.4); g.add(furnace);
        part(furnace, BOX, lamb(0x4a4a5a), 0, 0.6, 0, 1.0, 1.2, 0.8); part(furnace, BOX, glowM(0x8ab8ff), 0, 0.55, 0.41, 0.5, 0.35, 0.02); part(furnace, CYL8, lamb(0x3a3a4a), 0, 1.6, -0.1, 0.18, 1.0, 0.18);
        isle3.emit.push({ x: SMITH3.x, y: 3.2, z: SMITH3.z - 1.2, rate: 0.6, acc: 0.5 });
        const l = label("THE MOONFORGE", "#9fd8ff", 3.2, 0.8); l.position.set(SMITH3.x, 6.2, SMITH3.z);
    }
    {   // the Trading Post
        const g = stall3(DEPOT3, "TRADING POST", "SELL MATERIALS", "#ffd040", 0x4a2a5a);
        const clerk = makeHumanoid({ face: "clerk", skin: 0xe8c8b0, shirt: 0xe8e0f0, vest: 0x5a2a6a, pants: 0x3a2a3a, hair: 0x3a2a5a, hat: "cap", hatCol: 0x6a3a9a });
        clerk.g.position.set(0, 0, -0.6); g.add(clerk.g); clerk.yaw = g.rotation.y; npcs3.push(clerk);
        const crates = batch(lamb(0x5a4430)); crates.add(BOX, DEPOT3.x + 3.3, 0.45, DEPOT3.z + 0.2, 0, 0.2, 0, 0.9, 0.9, 0.9); crates.add(BOX, DEPOT3.x + 3.4, 1.2, DEPOT3.z + 0.3, 0, 0.5, 0, 0.7, 0.6, 0.7); crates.build();
        const sp = batch(glowM(0xd0a8ff)); for (let k = 0; k < 7; k++) sp.add(ICO, DEPOT3.x + 3.3 + srange(-0.3, 0.3), 0.95, DEPOT3.z + 0.2 + srange(-0.3, 0.3), 0, 0, 0, 0.12); sp.build();
        circles.push({ x: DEPOT3.x + 3.4, z: DEPOT3.z + 0.2, r: 0.9 });
        const l = label("TRADING POST", "#ffd040", 3.6, 0.8); l.position.set(DEPOT3.x, 6.2, DEPOT3.z);
    }
    {   // the Apothecary: a little house inside a giant mushroom, a counter out front, a bubbling cauldron
        const at = WITCH3, g = new THREE.Group(); g.position.set(at.x, groundY3(at.x, at.z), at.z); g.rotation.y = Math.atan2(-at.x, -at.z); // local +z faces camp
        const stemM = lamb(0xe8dcc8), capM = new THREE.MeshLambertMaterial({ color: 0x7a3ad8, emissive: 0x2a0a50, flatShading: true, side: THREE.DoubleSide });
        part(g, new THREE.CylinderGeometry(2.3, 2.6, 3.4, 14), stemM, 0, 1.7, -2.4, 1, 1, 1);
        part(g, new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), capM, 0, 3.3, -2.4, 4.4, 2.4, 4.4);
        part(g, new THREE.CircleGeometry(4.4, 16), new THREE.MeshLambertMaterial({ color: 0xd8c0e8, flatShading: true, side: THREE.DoubleSide }), 0, 3.3, -2.4, 1, 1, 1, Math.PI / 2);
        for (let k = 0; k < 14; k++) { const a = k * 2.4, e = 0.2 + (k % 4) * 0.33; part(g, ICO, glowM(0xfff0ff), Math.cos(a) * Math.cos(e) * 4.45, 3.3 + Math.sin(e) * 2.43, -2.4 + Math.sin(a) * Math.cos(e) * 4.45, 0.34, 0.16, 0.34); }
        part(g, BOX, new THREE.MeshBasicMaterial({ color: 0x140a1a }), 0, 1.1, 0.12, 1.1, 2.1, 0.1); // the door
        part(g, BOX, woodDark, 0, 2.2, 0.16, 1.3, 0.14, 0.12);
        for (const sx of [-1, 1]) { const w = part(g, CYL8, glowM(0xffd890), sx * 1.62, 2.1, -0.66, 0.34, 0.06, 0.34, Math.PI / 2, 0, 0); w.rotation.y = -sx * 0.78; }
        for (const sx of [-1.75, 1.75]) { // bottle shelves either side of the door
            part(g, BOX, woodDark, sx, 0.85, -0.4, 0.95, 1.7, 0.36);
            for (const y of [0.55, 1.15]) for (let k = 0; k < 3; k++) part(g, CYL6, glowM([0x7aff9a, 0xff7ad8, 0x8ab8ff, 0xffd060][(k + (y > 1 ? 1 : 2) + (sx > 0 ? 1 : 0)) % 4]), sx - 0.28 + k * 0.28, y + 0.16, -0.2, 0.07, 0.26, 0.07);
        }
        part(g, BOX, wood, 0, 0.52, 1.5, 3.6, 1.05, 0.9); part(g, BOX, woodDark, 0, 1.08, 1.5, 3.9, 0.1, 1.15);
        for (let k = 0; k < 4; k++) part(g, CYL6, glowM([0x7aff9a, 0xff7ad8, 0xffd060, 0x8ab8ff][k]), -1.2 + k * 0.55, 1.28, 1.45, 0.08, 0.3, 0.08); // brews on the counter
        for (const sx of [-2.5, 2.5]) { part(g, ICO, glowM(0xffd890), sx, 2.5, 0.9, 0.2, 0.26, 0.2); part(g, CYL6, woodDark, sx, 3.0, 0.9, 0.02, 0.8, 0.02); } // lanterns hanging from the cap
        const cauldron = new THREE.Group(); cauldron.position.set(-2.6, 0, 1.3); g.add(cauldron);
        part(cauldron, new THREE.SphereGeometry(0.75, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x1a1a22, flatShading: true, side: THREE.DoubleSide }), 0, 0.85, 0, 1, 1, 1);
        part(cauldron, CYL8, glowM(0x7aff8a), 0, 0.8, 0, 0.66, 0.02, 0.66);
        for (const a of [0, 2.1, 4.2]) part(cauldron, BOX, woodDark, Math.cos(a) * 0.45, 0.2, Math.sin(a) * 0.45, 0.08, 0.4, 0.08);
        for (let k = 0; k < 6; k++) { const b = part(cauldron, ICO, glowM(0xb0ffb8), 0, 0.85, 0, 0.08, 0.08, 0.08); isle3.bubbles.push({ m: b, ph: k / 6, ox: Math.cos(k * 1.7) * 0.4, oz: Math.sin(k * 1.7) * 0.4 }); }
        const cl = new THREE.PointLight(0x7aff9a, 7, 10, 1.6); cl.position.set(-2.6, 1.6, 1.3); g.add(cl);
        const witch = makeHumanoid({ face: "witch", skin: 0x8ac08a, shirt: 0x3a1a4a, pants: 0x2a1a2a, hair: 0x1a1a1a, hat: "witch", hatCol: 0x2a1a3a });
        witch.g.position.set(0, 0, 0.55); g.add(witch.g); witch.yaw = g.rotation.y; npcs3.push(witch);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.28), new THREE.MeshBasicMaterial({ map: signTex("APOTHECARY", "BREWS · TONICS", "#7aff9a"), side: THREE.DoubleSide }));
        sign.position.set(0, 4.85, 1.75); sign.rotation.x = -0.3; sign.scale.setScalar(0.85); g.add(sign);
        scene.add(g);
        circles.push({ x: at.x, z: at.z + 2.4, r: 2.55 }, { x: at.x + 2.6, z: at.z - 1.3, r: 0.9 });
        colliders.push([at.x - 1.95, at.x + 1.95, at.z - 1.95, at.z - 1.05]);
        isle3.emit.push({ x: at.x + 2.6, y: 1.4, z: at.z - 1.3, rate: 0.5, acc: 0.2 });
        const l = label("APOTHECARY", "#7aff9a", 3.2, 0.8); l.position.set(at.x, 7.4, at.z + 1);
    }
    {   // signposts on the edge of camp: the side you read on the way out points ahead to the place, the back points home
        const post = (to, name, col) => {
            const dir = Math.atan2(to.x, to.z), x = Math.sin(dir) * 22, z = Math.cos(dir) * 22, y = groundY3(x, z), far = Math.round(Math.hypot(to.x - x, to.z - z) - (to.r || 0));
            const p = new THREE.Mesh(CYL6, woodDark); p.scale.set(0.09, 2.4, 0.09); p.position.set(x, y + 1.2, z); scene.add(p);
            const out = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: signTex(name, `AHEAD ↑ ${far}m`, col) })); out.position.set(x, y + 2.6, z); out.rotation.y = dir + Math.PI; scene.add(out);
            const home = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: signTex("LANTERN CAMP", "AHEAD ↑", "#c8a0ff") })); home.position.set(x, y + 2.6, z); home.rotation.y = dir; scene.add(home);
        };
        post(HOLLOW, "THE HOLLOW", "#ff5a8a");
        post(WELL, "MOONWELL", "#7affef");
        post({ x: D3B.x, z: D3B.z }, "REBIRTH 3 FERRY", "#9fe8ff");
    }

    // ----- the arrivals dock, the violet ferry, the Ferryman -----
    {
        const yaw = Math.atan2(ARR3DIR.x, ARR3DIR.z);
        const planks = batch(new THREE.MeshLambertMaterial({ color: 0x6a5a6a, flatShading: true }));
        for (let i = 0; i < ARR3LEN; i++) { const p = arr3Pt(i + 0.5); planks.add(BOX, p.x, 0.22, p.z, 0, yaw, 0, 3.6, 0.14, 0.92); }
        planks.build();
        const posts = batch(woodDark), rails = batch(woodDark), bulbs = batch(glowM(0xc8a0ff));
        for (let i = 0; i <= ARR3LEN; i += 3) for (const sd of [-1.9, 1.9]) { const p = arr3Pt(i, sd); posts.add(CYL6, p.x, -0.9, p.z, 0, 0, 0, 0.12, 4.2, 0.12); if (i % 6 === 0) bulbs.add(ICO, p.x, 1.45, p.z, 0, 0, 0, 0.16); }
        for (let i = 0; i < ARR3LEN; i++) for (const sd of [-1.9, 1.9]) { const p = arr3Pt(i + 0.5, sd, 0.95); rails.add(BOX, p.x, 0.95, p.z, 0, yaw, 0, 0.08, 0.1, 1.02); }
        posts.build(); rails.build(); bulbs.build();
        for (const sd of [-2.0, 2.0]) { const p = arr3Pt(3.5, sd); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.6, 6), woodDark); m.position.set(p.x, 1.8, p.z); scene.add(m); }
        const wb = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex("WELCOME TO", "MOONCAP ISLE", "#c8a0ff") })); wb.position.copy(arr3Pt(3.5, 0, 3.3)); wb.rotation.y = yaw; scene.add(wb);
        const wb2 = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex("ARRIVALS", "FROM THE HIGHLANDS", "#c8a0ff") })); wb2.position.copy(arr3Pt(3.5, 0, 3.3)); wb2.rotation.y = yaw + Math.PI; scene.add(wb2);
        const al = label("ARRIVALS", "#c8a0ff", 3.2, 0.7); al.position.copy(arr3Pt(3.5, 0, 4.6)); al.maxD = 70;
        isle3.boat = makeBoat3(0x2a2a4a, 0x6a5a9a, 0xc8a0ff); isle3.boat.position.copy(arr3Pt(ARR3LEN - 7, 4.4, -0.15)); isle3.boat.rotation.y = yaw; scene.add(isle3.boat);
        // lanterns light the way from each dock to camp
        const lp = batch(woodDark), lg = batch(glowM(0xffd890)), lc = batch(lamb(0x2a2a34));
        for (const [B, DIR, PERP] of DOCKS3) {
            const land = Math.hypot(B.x, B.z);
            for (let s = 4, k = 0; s < land - 26; s += 8, k++) {
                const sd = k % 2 ? 3.2 : -3.2, x = B.x - DIR.x * s + PERP.x * sd, z = B.z - DIR.z * s + PERP.z * sd, y = groundY3(x, z);
                lp.add(CYL6, x, y + 1.2, z, 0, 0, 0, 0.07, 2.4, 0.07); lp.add(BOX, x - PERP.x * sd * 0.12, y + 2.35, z - PERP.z * sd * 0.12, 0, Math.atan2(PERP.x, PERP.z), 0, 0.06, 0.06, 0.6);
                lg.add(ICO, x - PERP.x * sd * 0.2, y + 2.05, z - PERP.z * sd * 0.2, 0, 0, 0, 0.17, 0.22, 0.17); lc.add(CONE6, x - PERP.x * sd * 0.2, y + 2.32, z - PERP.z * sd * 0.2, 0, 0, 0, 0.22, 0.14, 0.22);
            }
        }
        lp.build(); isle3.lanterns = lg.build(); lc.build();
    }
    // ----- the Rebirth 3 dock on the far side: the Ferryman waits here, and the next light shines past it -----
    {
        const yaw = Math.atan2(D3DIR.x, D3DIR.z);
        const planks = batch(new THREE.MeshLambertMaterial({ color: 0x5a6a7a, flatShading: true }));
        for (let i = 0; i < D3LEN; i++) { const p = dock3Pt(i + 0.5); planks.add(BOX, p.x, 0.22, p.z, 0, yaw, 0, 3.6, 0.14, 0.92); }
        planks.build();
        const posts = batch(woodDark), rails = batch(woodDark), bulbs = batch(glowM(0x9fe8ff));
        for (let i = 0; i <= D3LEN; i += 3) for (const sd of [-1.9, 1.9]) { const p = dock3Pt(i, sd); posts.add(CYL6, p.x, -0.9, p.z, 0, 0, 0, 0.12, 4.2, 0.12); if (i % 6 === 0) bulbs.add(ICO, p.x, 1.45, p.z, 0, 0, 0, 0.16); }
        for (let i = 0; i < D3LEN; i++) for (const sd of [-1.9, 1.9]) { const p = dock3Pt(i + 0.5, sd, 0.95); rails.add(BOX, p.x, 0.95, p.z, 0, yaw, 0, 0.08, 0.1, 1.02); }
        posts.build(); rails.build(); bulbs.build();
        for (const sd of [-2.0, 2.0]) { const p = dock3Pt(3.5, sd); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.6, 6), woodDark); m.position.set(p.x, 1.8, p.z); scene.add(m); }
        const db = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex("REBIRTH 3", "ASHFALL ISLE", "#ff9a5a") })); db.position.copy(dock3Pt(3.5, 0, 3.3)); db.rotation.y = yaw + Math.PI; scene.add(db);
        const db2 = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex("LANTERN CAMP", "THIS WAY ↑", "#c8a0ff") })); db2.position.copy(dock3Pt(3.5, 0, 3.3)); db2.rotation.y = yaw; scene.add(db2);
        const dl = label("REBIRTH 3 FERRY", "#9fe8ff", 3.2, 0.7); dl.position.copy(dock3Pt(3.5, 0, 4.6)); dl.maxD = 80;
        isle3.boat3 = makeBoat3(0x1a2a3a, 0x4a7a9a, 0x9fe8ff); isle3.boat3.position.copy(dock3Pt(D3LEN - 7, 4.4, -0.15)); isle3.boat3.rotation.y = yaw; scene.add(isle3.boat3);
        ferryman3 = makeFerrymanFigure(0x22163a, 0x6a4a9a, 0xe8d8ff); ferryman3.position.set(FERRYMAN3.x, 0.3, FERRYMAN3.z); ferryman3.rotation.y = yaw + Math.PI; scene.add(ferryman3);
        const fm = label("FERRYMAN", "#c8a0ff", 2.6, 0.6); fm.position.set(FERRYMAN3.x, 4.7, FERRYMAN3.z); fm.maxD = 60;
        // the next light, out past the end of this dock
        const FI = dock3Pt(D3LEN + 240);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 220, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.12, fog: false, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.set(FI.x, 110, FI.z); scene.add(beam); isle3.beam = beam;
        const bl = label("ASHFALL ISLE", "#ff9a5a", 4.8, 1.1); bl.position.set(FI.x, 62, FI.z); bl.maxD = 420; bl.blurK = 0.25;
        const bl2 = label("REBIRTH 3", "#ffffff", 4.0, 0.9); bl2.position.set(FI.x, 54, FI.z); bl2.maxD = 420; bl2.blurK = 0.25;
        beam.material.color.setHex(0xff7a3a);
        // Ashfall Isle on the horizon: a dark island with a glowing volcano
        const farM = c => new THREE.MeshBasicMaterial({ color: c, fog: false });
        const fb = new THREE.Mesh(new THREE.CylinderGeometry(62, 74, 5, 14), farM(0x241a18)); fb.position.set(FI.x, -2.2, FI.z); scene.add(fb);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(48, 44, 12), farM(0x3a2620)); cone.position.set(FI.x, 22, FI.z); scene.add(cone);
        const lip = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 2, 12), farM(0xff6a1a)); lip.position.set(FI.x, 43, FI.z); scene.add(lip);
    }
    // ----- the Hollow: where the Elder Heart sleeps -----
    buildHollow();

    // ----- the Moonwell -----
    {
        const y0 = -0.3;
        const water = new THREE.Mesh(new THREE.CircleGeometry(WELL.r + 2.6, 28), wtr(new THREE.MeshLambertMaterial({ color: 0x5ae0e8, emissive: 0x1a8a9a, transparent: true, opacity: 0.86, flatShading: true })));
        water.rotation.x = -Math.PI / 2; water.position.set(WELL.x, y0, WELL.z); scene.add(water); isle3.wellWater = water;
        const sparkle = batch(glowM(0xd8ffff));
        for (let i = 0; i < 26; i++) { const a = srand() * 6.283, d = srange(0.5, WELL.r); sparkle.add(ICO, WELL.x + Math.cos(a) * d, y0 + 0.05, WELL.z + Math.sin(a) * d, 0, 0, 0, 0.09, 0.02, 0.09); }
        isle3.wellSparkle = sparkle.build();
        const ring = batch(lamb(0xc8c8dc)), runes = batch(glowM(0x7affef));
        for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283, x = WELL.x + Math.cos(a) * (WELL.r + 3.4), z = WELL.z + Math.sin(a) * (WELL.r + 3.4), y = terrain3(x, z), h = i % 3 === 0 ? 2.6 : 1.3; ring.add(BOX, x, y + h / 2, z, 0, -a, 0, 0.8, h, 0.5); runes.add(BOX, x - Math.cos(a) * 0.26, y + h * 0.62, z - Math.sin(a) * 0.26, 0, -a, 0, 0.3, 0.3, 0.03); circles.push({ x, z, r: 0.5 }); }
        ring.build(); runes.build();
        const wl = new THREE.PointLight(0x5affef, 10, 26, 1.5); wl.position.set(WELL.x, 2.5, WELL.z); scene.add(wl); isle3.wellLight = wl;
        circles.push({ x: WELL.x, z: WELL.z, r: WELL.r - 1.6 });
        const l = label("MOONWELL", "#7affef", 3.4, 0.8); l.position.set(WELL.x, 5, WELL.z);
    }

    // ----- Starfall Crater: a fallen star still glowing in the middle -----
    {
        const y0 = terrain3(CRATER.x, CRATER.z);
        const star = new THREE.Mesh(new THREE.IcosahedronGeometry(2.0, 0), new THREE.MeshBasicMaterial({ color: 0xfff2b0 })); star.position.set(CRATER.x, y0 + 1.2, CRATER.z); star.rotation.set(0.4, 0.3, 0.2); scene.add(star); isle3.crater = star;
        const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 0), new THREE.MeshLambertMaterial({ color: 0x3a3450, flatShading: true, transparent: true, opacity: 0.7 })); shell.position.copy(star.position); shell.rotation.set(1, 0.2, 0.5); scene.add(shell);
        const shards = batch(glowM(0xfff4a0)), stones = batch(glowM(0x9fdcff));
        for (let i = 0; i < 26; i++) { const a = srand() * 6.283, d = srange(3, CRATER.r - 2), x = CRATER.x + Math.cos(a) * d, z = CRATER.z + Math.sin(a) * d, s = srange(0.3, 0.9); (i % 2 ? shards : stones).add(CONE6, x, terrain3(x, z) + s * 0.6, z, srange(-0.5, 0.5), srand() * 3, srange(-0.5, 0.5), s * 0.3, s * 1.6, s * 0.3); }
        shards.build(); stones.build();
        const cl = new THREE.PointLight(0xffe8a0, 12, 26, 1.5); cl.position.set(CRATER.x, y0 + 3.5, CRATER.z); scene.add(cl);
        circles.push({ x: CRATER.x, z: CRATER.z, r: 2.8 });
        const chestAt = (x, z, sp) => { const c = makeChest(x, z, srand() * 6, sp); const y = terrain3(x, z); c.g.position.y = y; c.beacon.position.y = y + 2.7; return c; };
        chestAt(CRATER.x + 5, CRATER.z - 4, true);
        const l = label("STARFALL CRATER", "#fff4a0", 3.4, 0.8); l.position.set(CRATER.x, y0 + 7, CRATER.z);
    }

    // ----- the Observatory on its hill -----
    {
        const y0 = terrain3(OBS.x, OBS.z), face = Math.atan2(-OBS.x, -OBS.z);
        const g = new THREE.Group(); g.position.set(OBS.x, y0 - 0.2, OBS.z); g.rotation.y = face; scene.add(g);
        part(g, CYL8, lamb(0x8a86a0), 0, 2.4, 0, 3.4, 4.8, 3.4);
        part(g, CYL8, lamb(0x6a6680), 0, 4.95, 0, 3.6, 0.3, 3.6);
        part(g, new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), lamb(0xd8dcf0), 0, 5.1, 0, 3.3, 3.0, 3.3);
        part(g, BOX, lamb(0x2a2a3a), 0, 6.9, 1.7, 1.1, 2.4, 1.8, -0.4);
        const scope = part(g, CYL8, lamb(0x6a5a3a), 0, 7.6, 2.0, 0.42, 3.4, 0.42); scope.rotation.x = 0.85;
        part(g, CYL8, glowM(0x9fd8ff), 0, 8.75, 3.3, 0.36, 0.06, 0.36).rotation.x = 0.85;
        part(g, BOX, new THREE.MeshBasicMaterial({ color: 0x0a0812 }), 0, 1.1, 3.38, 1.2, 2.2, 0.1);
        for (const sx of [-1.6, 1.6]) part(g, BOX, glowM(0xffd890), sx, 3.0, 3.1, 0.5, 0.7, 0.1);
        circles.push({ x: OBS.x, z: OBS.z, r: 3.6 });
        const l = label("OBSERVATORY", "#9fd8ff", 3.2, 0.8); l.position.set(OBS.x, y0 + 11, OBS.z);
    }

    // ----- the Moon Circle: pray once a day -----
    {
        const y0 = terrain3(CIRCLE3.x, CIRCLE3.z);
        const st = batch(lamb(0xb8b4d0)), rn = batch(glowM(0xd0b8ff));
        for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.283, x = CIRCLE3.x + Math.cos(a) * 5.6, z = CIRCLE3.z + Math.sin(a) * 5.6, h = srange(2.6, 3.6), y = terrain3(x, z); st.add(BOX, x, y + h / 2, z, 0, -a, 0, 0.9, h, 0.6); rn.add(new THREE.TorusGeometry(0.22, 0.04, 4, 10, 4.2), x - Math.cos(a) * 0.32, y + h * 0.66, z - Math.sin(a) * 0.32, 0, -a + Math.PI / 2, 0, 1); circles.push({ x, z, r: 0.7 }); }
        st.add(CYL8, CIRCLE3.x, y0 + 0.5, CIRCLE3.z, 0, 0, 0, 1.1, 1.0, 1.1);
        st.build(); rn.build();
        const glow = new THREE.Mesh(new THREE.CircleGeometry(1.0, 16), new THREE.MeshBasicMaterial({ color: 0xd0b8ff, transparent: true, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
        glow.rotation.x = -Math.PI / 2; glow.position.set(CIRCLE3.x, y0 + 1.02, CIRCLE3.z); scene.add(glow);
        altar = { x: CIRCLE3.x, z: CIRCLE3.z, glow };
        circles.push({ x: CIRCLE3.x, z: CIRCLE3.z, r: 1.3 });
        const l = label("MOON CIRCLE", "#e0d0ff", 3.2, 0.8); l.position.set(CIRCLE3.x, y0 + 5.4, CIRCLE3.z);
        const l2 = label("ALTAR", "#d0b8ff", 1.6, 0.5); l2.position.set(CIRCLE3.x, y0 + 2.6, CIRCLE3.z);
    }

    // ----- the Spore Marsh -----
    {
        const pud = batch(new THREE.MeshLambertMaterial({ color: 0x1a6a6a, emissive: 0x0a3a3a, transparent: true, opacity: 0.85, flatShading: true }));
        for (let i = 0; i < 14; i++) { const a = srand() * 6.283, d = srange(0, MARSH.r - 3), x = MARSH.x + Math.cos(a) * d, z = MARSH.z + Math.sin(a) * d; pud.add(CYL8, x, 0.12, z, 0, srand() * 3, 0, srange(1.2, 2.8), 0.02, srange(1, 2.2)); }
        pud.build();
        const reeds = batch(lamb(0x2a6a5a)), tips = batch(glowM(0x7affb0));
        for (let i = 0; i < 90; i++) { const a = srand() * 6.283, d = srange(1, MARSH.r + 2), x = MARSH.x + Math.cos(a) * d, z = MARSH.z + Math.sin(a) * d, h = srange(0.8, 1.8), y = terrain3(x, z); reeds.add(CONE6, x, y + h / 2, z, srange(-0.2, 0.2), 0, srange(-0.2, 0.2), 0.05, h, 0.05); if (i % 3 === 0) tips.add(ICO, x, y + h, z, 0, 0, 0, 0.07); }
        reeds.build(); tips.build();
        const chestAt = (x, z, sp) => { const c = makeChest(x, z, srand() * 6, sp); const y = terrain3(x, z); c.g.position.y = y; c.beacon.position.y = y + 2.7; return c; };
        chestAt(MARSH.x + 4, MARSH.z - 3, true);
        const l = label("SPORE MARSH", "#7affb0", 3.2, 0.8); l.position.set(MARSH.x, 4, MARSH.z);
    }

    // ----- giant mushrooms: a whole grove of them, and plenty more scattered about -----
    const okSpot3 = (x, z, margin = 0) => {
        const d = Math.hypot(x, z);
        if (d < SAFE_R + 1 || d > shoreAt3(x, z) - 9) return false;
        if (!treeOk3(x, z)) return false;
        for (let k = 1; k < LM3.length; k++) { const lm = LM3[k]; if (k !== 5 && Math.hypot(x - lm.x, z - lm.z) < lm.r + margin) return false; }
        for (const [B, DIR, PERP] of DOCKS3) { const { along, side } = dockLocal(x, z, B, DIR, PERP); if (along < 0 && along > -(Math.hypot(B.x, B.z) - 24) && Math.abs(side) < 5) return false; } // keep the lantern paths clear
        return true;
    };
    const scatter3 = (count, fn, margin = 0) => { let made = 0, guard = 0; while (made < count && guard++ < count * 40) { const a = srand() * 6.283, d = srange(SAFE_R + 1, shoreR3(a) - 9), x = Math.cos(a) * d, z = Math.sin(a) * d; if (!okSpot3(x, z, margin)) continue; fn(x, z, terrain3(x, z)); made++; } };
    {
        const stems = batch(new THREE.MeshLambertMaterial({ color: 0xe8dcc8, flatShading: true }));
        const capCols = [0x8a5ae0, 0x5a7ae8, 0xc06ad8, 0x4ab0c8], capMats = capCols.map(c => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.22, flatShading: true }));
        const caps = capMats.map(m => batch(m)), gills = batch(new THREE.MeshLambertMaterial({ color: 0xd8c0e8, flatShading: true, side: THREE.DoubleSide })), dots = batch(glowM(0xfff0ff));
        const capGeo = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), gillGeo = new THREE.CylinderGeometry(0.97, 0.25, 0.22, 12, 1, true);
        const shroom = (x, z, y, h, cr) => {
            const lean = srange(-0.12, 0.12), tx = x + lean * h * 0.5, c = Math.floor(srand() * caps.length);
            stems.add(CYL8, x + lean * h * 0.25, y + h / 2, z, 0, 0, -lean, cr * 0.14, h, cr * 0.14);
            caps[c].add(capGeo, tx, y + h, z, 0, srand() * 3, 0, cr, cr * 0.48, cr);
            gills.add(gillGeo, tx, y + h - cr * 0.08, z, 0, 0, 0, cr, cr * 0.5, cr);
            for (let k = 0; k < 6; k++) { const a = srand() * 6.283, e = srange(0.3, 1.2); dots.add(ICO, tx + Math.cos(a) * Math.cos(e) * cr, y + h + Math.sin(e) * cr * 0.48, z + Math.sin(a) * Math.cos(e) * cr, 0, 0, 0, cr * 0.07, cr * 0.04, cr * 0.07); }
            circles.push({ x: x + lean * h * 0.25, z, r: cr * 0.16 + 0.25 });
            if (cr > 4) isle3.glowCaps.push({ x: tx, y: y + h, z });
        };
        for (let i = 0; i < 26; i++) { const a = srand() * 6.283, d = Math.sqrt(srand()) * GROVE3.r, x = GROVE3.x + Math.cos(a) * d, z = GROVE3.z + Math.sin(a) * d; if (i && Math.hypot(x - GROVE3.x, z - GROVE3.z) < 3) continue; const big = i < 1 || srand() < 0.35; shroom(x, z, terrain3(x, z), big ? srange(9, 15) : srange(4, 8), big ? srange(4.5, 7) : srange(2, 3.6)); }
        scatter3(38, (x, z, y) => shroom(x, z, y, srange(3.2, 8), srange(1.6, 3.6)), 2);
        stems.build(); caps.forEach(c => c.build()); gills.build(); dots.build();
        const gl = new THREE.PointLight(0xb08aff, 14, 30, 1.5); gl.position.set(GROVE3.x, terrain3(GROVE3.x, GROVE3.z) + 6, GROVE3.z); scene.add(gl);
        const l = label("GLOWCAP GROVE", "#d0a8ff", 3.4, 0.8); l.position.set(GROVE3.x, terrain3(GROVE3.x, GROVE3.z) + 18, GROVE3.z); l.maxD = 140;
    }
    {   // small glowing things: mushroom clusters, moonpetals, teal grass, silver rocks, fallen logs
        const st = batch(lamb(0xe8e0d0)), gA = batch(glowM(0xd0a0ff)), gB = batch(glowM(0x7affe8)), gC = batch(glowM(0xff9ad8));
        scatter3(170, (x, z, y) => { const b = [gA, gB, gC][Math.floor(srand() * 3)]; for (let i = 0; i < 4; i++) { const dx = srange(-0.6, 0.6), dz = srange(-0.6, 0.6), s = srange(0.18, 0.42), yy = terrain3(x + dx, z + dz); st.add(CYL6, x + dx, yy + s * 0.5, z + dz, 0, 0, 0, s * 0.18, s, s * 0.18); b.add(ICO, x + dx, yy + s, z + dz, 0, 0, 0, s * 0.42, s * 0.24, s * 0.42); } });
        st.build(); gA.build(); gB.build(); gC.build();
        const stem = batch(lamb(0x3a7a6a)), petals = batch(glowM(0xe8f0ff)), petals2 = batch(glowM(0x9fd8ff));
        scatter3(60, (x, z) => { const n = 8 + Math.floor(srand() * 8); for (let i = 0; i < n; i++) { const fx = x + srange(-2.4, 2.4), fz = z + srange(-2.4, 2.4), fy = terrain3(fx, fz); stem.add(CYL6, fx, fy + 0.22, fz, 0, 0, 0, 0.02, 0.44, 0.02); (srand() < 0.6 ? petals : petals2).add(ICO, fx, fy + 0.5, fz, 0, 0, 0, 0.11, 0.06, 0.11); } });
        stem.build(); petals.build(); petals2.build();
        const g1 = batch(lamb(0x3a8a8a)), g2 = batch(lamb(0x6a5aaa));
        scatter3(260, (x, z, y) => { const gb = srand() < 0.5 ? g1 : g2; for (let i = 0; i < 4; i++) gb.add(CONE6, x + srange(-0.3, 0.3), y + 0.3, z + srange(-0.3, 0.3), srange(-0.25, 0.25), 0, srange(-0.25, 0.25), 0.05, srange(0.45, 0.85), 0.05); });
        g1.build(); g2.build();
        const rocks = batch(lamb(0x8a86a4)), bigR = batch(lamb(0x5e5a78));
        scatter3(110, (x, z, y) => { const s = srange(0.4, 1.5); rocks.add(ICO, x, y + s * 0.4, z, srand() * 3, srand() * 3, 0, s, s * srange(0.6, 1), s); if (s > 1.15) circles.push({ x, z, r: s * 0.85 }); });
        scatter3(18, (x, z, y) => { const s = srange(2.2, 4); bigR.add(ICO, x, y + s * 0.35, z, srand() * 3, srand() * 3, 0, s, s * srange(0.6, 0.9), s * srange(0.8, 1.2)); circles.push({ x, z, r: s * 0.85 }); }, 3);
        rocks.build(); bigR.build();
        const logsB = batch(lamb(0x4a3a4a)), moss = batch(glowM(0x7affb0));
        scatter3(20, (x, z, y) => { const r = srand() * 3, l = srange(2.4, 4.4); logsB.add(CYL6, x, y + 0.32, z, Math.PI / 2, r, 0, 0.32, l, 0.32); for (let k = 0; k < 3; k++) moss.add(ICO, x + Math.sin(r) * srange(-l / 2, l / 2), y + 0.62, z + Math.cos(r) * srange(-l / 2, l / 2), 0, 0, 0, 0.12, 0.06, 0.12); });
        logsB.build(); moss.build();
        // the beach: pale driftwood, shells, glowing coral fans
        const beachSpot = (n, min, max, fn) => { for (let i = 0; i < n; i++) { const a = srand() * 6.283, d = shoreR3(a) - srange(min, max), x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.hypot(x - ARR3B.x, z - ARR3B.z) < 12) continue; fn(x, z, Math.max(0, terrain3(x, z))); } };
        const drift = batch(lamb(0xb8b0c0)), shells = batch(glowM(0xf8eef8)), coral = batch(glowM(0xff8ad8)), coral2 = batch(glowM(0x7ad8ff));
        beachSpot(30, 3, 11, (x, z, y) => drift.add(CYL6, x, y + 0.14, z, Math.PI / 2, 0, srand() * 3, 0.12, srange(1.5, 3.2), 0.12));
        beachSpot(90, 2, 12, (x, z, y) => shells.add(ICO, x, y + 0.06, z, 0, srand() * 3, 0, 0.13, 0.08, 0.13));
        beachSpot(40, 1, 7, (x, z, y) => { const b = srand() < 0.5 ? coral : coral2; for (let k = 0; k < 3; k++) b.add(CONE6, x + srange(-0.4, 0.4), y + 0.3, z + srange(-0.4, 0.4), srange(-0.4, 0.4), 0, srange(-0.4, 0.4), 0.07, srange(0.4, 0.9), 0.07); });
        drift.build(); shells.build(); coral.build(); coral2.build();
    }
    // chests scattered about
    for (let i = 0; i < 9; i++) { let guard = 0; while (guard++ < 60) { const a = srand() * 6.283, d = srange(36, 110), x = Math.cos(a) * d, z = Math.sin(a) * d; if (d > shoreAt3(x, z) - 12 || !okSpot3(x, z, 2)) continue; const c = makeChest(x, z, srand() * 6, i % 4 === 0); const y = terrain3(x, z); c.g.position.y = y; c.beacon.position.y = y + 2.7; break; } }
    // falling-star effects and the boss's attack pieces live in the island group too
    buildStarFx(); buildBossFx();
    isle3.emit.forEach(e => smokeEmit.push(e));
    addTgt = prevAdd; curBuild = 1;
}

// =====================================================================
//  the Elder Heart: a sleeping world-tree boss in the Hollow
// =====================================================================
const BOSS_H = 22, BOSS_R = 3.4;
const BOSS_T = { name: "The Elder Heart", col: "#ff5a8a", hp: 1, logs: 0, dmg: 1, speed: 0, bonus: 0, rare: true, wd: 0, wn: 0 };
HIT_COL.elderheart = [0xff3a6a, 0x3a1a24];
let boss = null; // the tree object (in `trees` only while the fight is on)
const fight3 = { on: false, phase: 1, cd: 3, atk: null, atkT: 0, wall: 0, beat: 0, lag: 1, minions: [], hitWave: new Set(), dyingT: -1, intro: 0, heart: 0, seen: false };
const bossMaxHp = () => Math.ceil(140 * hpScale() * (1 + 0.25 * (save.bossKills || 0)));
const bossDmg = (k = 1) => Math.round(24 * isleDm() * (1 + 0.04 * (save.day - 1)) * k);
const bossFx = { rings: [], spikes: [], seeds: [], waves: [] };
let bossG = null, bossWall = null, bossStump = null, bossLabel = null, bossLight = null, bossHeart = null, bossCrown = null, hollowLabel = null;
const bossCrownCol = new THREE.Color(0x3a1a5a), bossCrownRage = new THREE.Color(0x6a1030);
function buildHollow() {
    const H = HOLLOW, y0 = terrain3(H.x, H.z);
    // the arena floor: dark earth with glowing veins running into the middle
    const fl = new THREE.Mesh(new THREE.CircleGeometry(H.r + 0.5, 48), decalMat(0x24101c)); fl.rotation.x = -Math.PI / 2; fl.position.set(H.x, y0 + 0.03, H.z); scene.add(fl);
    const veins = batch(new THREE.MeshBasicMaterial({ color: 0x8a1a4a, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    for (let i = 0; i < 18; i++) { const a = (i / 18) * 6.283 + srand() * 0.2; let px = H.x + Math.cos(a) * 4, pz = H.z + Math.sin(a) * 4, aa = a; for (let s = 0; s < 6; s++) { aa += srange(-0.35, 0.35); const nx = px + Math.cos(aa) * 2.8, nz = pz + Math.sin(aa) * 2.8; if (Math.hypot(nx - H.x, nz - H.z) > H.r - 0.5) break; veins.add(BOX, (px + nx) / 2, y0 + 0.05, (pz + nz) / 2, 0, -aa, 0, 2.9, 0.02, 0.12); px = nx; pz = nz; } }
    veins.build();
    // gnarled roots arch over the rim, thorns and dark rocks crowd round it
    const archM = lamb(0x2a1a24);
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * 6.283 + 0.3, a2 = a + 0.42, r0 = H.r + 3.5;
        const pA = V3(H.x + Math.cos(a) * r0, y0 - 0.5, H.z + Math.sin(a) * r0), pB = V3(H.x + Math.cos(a2) * r0, y0 - 0.5, H.z + Math.sin(a2) * r0);
        const mid = pA.clone().add(pB).multiplyScalar(0.5).add(V3(0, srange(6, 9), 0)).addScaledVector(V3(H.x - mid0(pA, pB).x, 0, H.z - mid0(pA, pB).z).normalize(), 2.5);
        const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([pA, mid, pB]), 18, srange(0.45, 0.7), 6, false);
        scene.add(new THREE.Mesh(tg, archM));
    }
    const thorn = batch(lamb(0x3a1a2a)), rk = batch(lamb(0x3a3044));
    for (let i = 0; i < 70; i++) { const a = srand() * 6.283, d = srange(H.r + 2, H.r + 7), x = H.x + Math.cos(a) * d, z = H.z + Math.sin(a) * d, y = terrain3(x, z); if (srand() < 0.6) { for (let k = 0; k < 4; k++) thorn.add(CONE6, x + srange(-0.4, 0.4), y + 0.5, z + srange(-0.4, 0.4), srange(-0.6, 0.6), 0, srange(-0.6, 0.6), 0.08, srange(0.8, 1.6), 0.08); } else { const s = srange(0.6, 1.6); rk.add(ICO, x, y + s * 0.4, z, srand(), srand() * 3, 0, s, s * 0.7, s); } }
    thorn.build(); rk.build();
    // the wall of roots that rises when the fight begins
    bossWall = new THREE.Group(); bossWall.position.set(H.x, y0 - 6.2, H.z); scene.add(bossWall);
    const wb = batch(lamb(0x2a1420)), wt = batch(glowM(0xff3a6a));
    { const was = addTgt; addTgt = bossWall;
      for (let i = 0; i < 44; i++) { const a = (i / 44) * 6.283, r = H.r + 0.4 + srange(-0.3, 0.3), x = Math.cos(a) * r, z = Math.sin(a) * r, h = srange(5, 7.5); wb.add(CONE6, x, h / 2, z, srange(-0.15, 0.15), srand() * 3, srange(-0.15, 0.15), srange(0.6, 0.95), h, srange(0.6, 0.95)); if (i % 3 === 0) wt.add(ICO, x * 0.97, h * 0.62, z * 0.97, 0, 0, 0, 0.14); }
      wb.build(); wt.build(); addTgt = was; }
    bossWall.visible = false;
    // the stump left behind when it falls
    bossStump = new THREE.Group(); bossStump.position.set(H.x, y0, H.z); scene.add(bossStump);
    part(bossStump, new THREE.CylinderGeometry(BOSS_R * 1.05, BOSS_R * 1.35, 2.4, 12), lamb(0x2a1a24), 0, 1.2, 0, 1, 1, 1);
    part(bossStump, new THREE.CircleGeometry(BOSS_R * 1.03, 14), lamb(0x7a4a3a), 0, 2.42, 0, 1, 1, 1, -Math.PI / 2);
    part(bossStump, new THREE.CircleGeometry(BOSS_R * 0.35, 10), glowM(0xff3a6a), 0, 2.44, 0, 1, 1, 1, -Math.PI / 2);
    bossStump.visible = false;
    buildBossModel(y0);
    hollowLabel = label("THE HOLLOW", "#ff5a8a", 3.6, 0.8); hollowLabel.position.set(H.x, y0 + 31, H.z); hollowLabel.maxD = 260; hollowLabel.blurK = 0.4;
    bossLabel = label("THE ELDER HEART · sleeping", "#ff9ab8", 2.8, 0.7); bossLabel.position.set(H.x, y0 + 27, H.z); bossLabel.maxD = 120;
}
const mid0 = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
function buildBossModel(y0) {
    const H = HOLLOW;
    bossG = new THREE.Group(); bossG.position.set(H.x, y0 - 0.2, H.z); scene.add(bossG);
    const body = new THREE.Group(); bossG.add(body);
    const barkM = new THREE.MeshLambertMaterial({ color: 0x2e1c28, flatShading: true });
    const tg = new THREE.CylinderGeometry(BOSS_R * 0.7, BOSS_R * 1.25, BOSS_H, 12, 8);
    { const p = tg.attributes.position; for (let i = 0; i < p.count; i++) { const u = p.getY(i) / BOSS_H + 0.5, k = 1 + 0.1 * Math.sin(u * 13 + p.getX(i) * 2) + 0.06 * Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 5); p.setX(i, p.getX(i) * k + Math.sin(u * 3) * 0.6); p.setZ(i, p.getZ(i) * k); } tg.computeVertexNormals(); }
    const trunk = new THREE.Mesh(tg, barkM); trunk.position.y = BOSS_H / 2; body.add(trunk);
    const roots = batch(barkM); { const was = addTgt; addTgt = body;
        for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283 + srand() * 0.3; roots.add(CONE6, Math.cos(a) * BOSS_R * 1.5, BOSS_R * 0.4, Math.sin(a) * BOSS_R * 1.5, 0, -a, Math.PI / 2 + 0.5, BOSS_R * 0.5, BOSS_R * 2.8, BOSS_R * 0.5); }
        roots.build(); addTgt = was; }
    // the crown: dark violet clouds of leaves with glowing fruit and hanging vines
    bossCrown = new THREE.MeshLambertMaterial({ color: 0x3a1a5a, emissive: 0x14061e, flatShading: true });
    const crownB = batch(bossCrown), fruit = batch(glowM(0xff5a8a)), vines = batch(lamb(0x2a3a2a));
    { const was = addTgt; addTgt = body;
      crownB.add(ICO, 0, BOSS_H * 1.02, 0, 0, 0, 0, 6.5, 4.6, 6.5);
      for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283, d = srange(4.5, 6.5), y = BOSS_H * srange(0.78, 0.95), s = srange(3.2, 4.6); crownB.add(ICO, Math.cos(a) * d, y, Math.sin(a) * d, srand(), srand() * 3, 0, s, s * 0.8, s); for (let k = 0; k < 2; k++) fruit.add(ICO, Math.cos(a) * (d + s * 0.8), y - s * 0.3 + k, Math.sin(a) * (d + s * 0.8), 0, 0, 0, 0.45); }
      for (let i = 0; i < 16; i++) { const a = srand() * 6.283, d = srange(3, 8), l = srange(3, 7); vines.add(CYL6, Math.cos(a) * d, BOSS_H * 0.8 - l / 2, Math.sin(a) * d, 0, 0, 0, 0.08, l, 0.08); }
      const crownMesh = crownB.build(); fruit.build(); vines.build(); addTgt = was;
      // the heart: a glowing core in a cracked hollow of the trunk
      const front = BOSS_R * 1.06;
      part(body, new THREE.CircleGeometry(1.6, 12), new THREE.MeshBasicMaterial({ color: 0x0a0408 }), 0, 6, front + 0.02, 1, 1.3, 1);
      bossHeart = part(body, new THREE.IcosahedronGeometry(1, 1), glowM(0xff3a6a), 0, 6, front - 0.3, 0.95, 1.1, 0.8);
      const cracks = batch(glowM(0xb01a4a)); { const w2 = addTgt; addTgt = body; for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283, l = srange(1.5, 3); cracks.add(BOX, Math.cos(a) * (1.4 + l / 2), 6 + Math.sin(a) * (1.4 + l / 2) * 1.3, front + 0.05, 0, 0, a, l, 0.12, 0.05); } cracks.build(); addTgt = w2; }
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), faceMats.calm); face.scale.setScalar(6.2); face.position.set(0, 12.2, BOSS_R * 0.98 + 0.1); body.add(face);
      // four great arms
      const arms = [], aGeo = armGeometry(9);
      for (const [s, y, zz] of [[-1, 14.5, 0.6], [1, 14.5, 0.6], [-1, 11, -0.4], [1, 11, -0.4]]) {
          const pivot = new THREE.Group(); pivot.position.set(s * BOSS_R * 0.78, y, zz);
          const arm = new THREE.Mesh(aGeo, barkM); arm.scale.set(2.6, 1, 2.6); arm.rotation.z = -s * 2.2; pivot.add(arm); body.add(pivot);
          arms.push({ pivot, arm, s, low: y < 12 });
      }
      bossLight = new THREE.PointLight(0xff3a6a, 2, 30, 1.6); bossLight.position.set(0, 7, 6); bossG.add(bossLight);
      boss = { boss: true, key: "elderheart", type: BOSS_T, g: bossG, body, face, arms, h: BOSS_H, r: BOSS_R, x: H.x, z: H.z, gy: y0, hp: 1, maxHp: 1, solid: [trunk, crownMesh],
          dying: false, burn: false, gone: false, t: 0, hurt: 0, phase: 0, mode: "calm", atk: "idle", atkT: 0, cool: 0, armUp: 0, swing: 0, slam: 0, bar: null, barT: 0 };
    }
    circles.push({ x: H.x, z: H.z, r: BOSS_R * 1.15 });
    occluders.push(trunk);
}
function buildBossFx() {
    const ringM = new THREE.MeshBasicMaterial({ color: 0xff2a4a, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    for (let i = 0; i < 16; i++) {
        const g = new THREE.Group(), m = ringM.clone();
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 32), m); ring.rotation.x = -Math.PI / 2; g.add(ring);
        const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 32), m.clone()); fill.rotation.x = -Math.PI / 2; fill.material.opacity = 0.2; g.add(fill);
        g.visible = false; scene.add(g); bossFx.rings.push({ g, ring, fill, t: -1, life: 1, r: 1 });
    }
    const spM = lamb(0x3a1424), tipM = glowM(0xff3a6a);
    for (let i = 0; i < 10; i++) {
        const g = new THREE.Group();
        for (let k = 0; k < 7; k++) { const a = (k / 7) * 6.283 + Math.random(), d = k ? rand(0.6, 1.8) : 0, h = k ? rand(1.6, 2.8) : 3.4; const c = part(g, CONE6, spM, Math.cos(a) * d, h / 2, Math.sin(a) * d, 0.38, h, 0.38, rand(-0.3, 0.3), 0, rand(-0.3, 0.3)); part(g, ICO, tipM, c.position.x, h * 0.95, c.position.z, 0.1, 0.1, 0.1); }
        g.visible = false; scene.add(g); bossFx.spikes.push({ g, t: -1, x: 0, z: 0, y: 0, hit: false });
    }
    const seedM = glowM(0xff6a9a), seedM2 = glowM(0xffe0ea);
    for (let i = 0; i < 18; i++) { const g = new THREE.Group(); part(g, ICO, seedM, 0, 0, 0, 0.42, 0.42, 0.42); part(g, ICO, seedM2, 0, 0, 0, 0.2, 0.2, 0.2); g.visible = false; scene.add(g); bossFx.seeds.push({ g, t: -1, dur: 1, a: V3(0, 0, 0), b: V3(0, 0, 0), ring: null }); }
    for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.1, 64, 1, true), new THREE.MeshBasicMaterial({ color: 0xff6a9a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
        m.visible = false; scene.add(m); bossFx.waves.push({ m, R: -1 });
    }
}
// show the right thing in the Hollow: the sleeping tree, or the stump until dawn
function syncBoss() {
    if (!bossG) return;
    const dead = save.bossDay === save.day && save.bossKills > 0;
    bossG.visible = !dead; bossStump.visible = dead;
    bossLabel.el.textContent = dead ? "THE ELDER HEART · regrows at dawn" : "THE ELDER HEART · sleeping";
    bossLabel.visible = !fight3.on;
    if (!dead) { boss.body.rotation.set(0, 0, 0); boss.dying = false; boss.gone = false; bossG.scale.setScalar(1); }
}
function startFight() {
    const f = fight3;
    f.on = true; f.phase = 1; f.cd = 3.2; f.atk = null; f.atkT = 0; f.lag = 1; f.minions = []; f.dyingT = -1; f.intro = 0; f.heart = 0;
    boss.maxHp = boss.hp = bossMaxHp(); boss.dying = false; boss.gone = false; boss.t = 0; boss.hurt = 0;
    if (!trees.includes(boss)) trees.push(boss);
    bossWall.visible = true; bossLabel.visible = false;
    $("bossName").textContent = "THE ELDER HEART"; $("bossBar").classList.add("show"); $("bossPh").textContent = ""; $("bossBar").classList.remove("rage");
    roar(1); shake = 0.9; flash = 0.25;
    titleCard("THE ELDER HEART", "the oldest tree in the world wakes up");
    toast("Roots seal the Hollow. The only way out is through.", "bad");
    if (!f.seen) { f.seen = true; setTimeout(() => { if (fight3.on) toast("Watch the ground. Red rings burst. When it slams, JUMP the shockwave.", "rare"); }, 3500); }
}
function endFight(won, quiet) {
    const f = fight3;
    f.on = false; f.atk = null;
    $("bossBar").classList.remove("show");
    for (const t of f.minions) if (!t.gone && !t.dying) t.burn = true;
    f.minions = [];
    for (const r of bossFx.rings) { r.t = -1; r.g.visible = false; }
    for (const s of bossFx.spikes) if (s.t >= 0 && s.t < 0.8) s.t = 0.8;
    for (const s of bossFx.seeds) { s.on = false; s.g.visible = false; }
    for (const w of bossFx.waves) { w.R = -1; w.m.visible = false; }
    if (!won) {
        boss.hp = boss.maxHp; boss.gone = true; // out of the trees list; it goes back to sleep
        for (const a of boss.arms) a.pivot.rotation.x = 0;
        if (!quiet) setTimeout(() => toast("The Elder Heart sinks back into sleep...", "rare"), 1500);
        bossLabel.visible = true;
    }
}
function roar(k = 1) { sfx(70 * k, 1.3, "sawtooth", 0.2, 0.45); sfx(105 * k, 1.0, "square", 0.08, 0.4); sfx(52, 1.6, "sine", 0.22, 0.6); }
let titleT = null;
function titleCard(big, small) {
    const e = $("titleCard"); $("tcBig").textContent = big; $("tcSmall").textContent = small || "";
    e.classList.remove("show"); void e.offsetWidth; e.classList.add("show");
    clearTimeout(titleT); titleT = setTimeout(() => e.classList.remove("show"), 3600);
}
function bossHurt(t, dmg) {
    if (t.key === "cinderking") { fight4.heart = 1; return; }
    fight3.heart = 1;
    if (Math.random() < 0.3) sfx(60 + Math.random() * 20, 0.15, "sine", 0.12, 0.6);
}
function bossDefeated(t) {
    const f = fight3;
    f.dyingT = 0; t.gone = true; // out of the trees list right away; the fall is just for show
    endFight(true);
    save.bossKills = (save.bossKills || 0) + 1; save.bossDay = save.day;
    save.felled++; contractProgress("fell"); contractProgress("rare");
    roar(0.7); shake = 1; flash = 0.9; hitstop = 0.25;
    titleCard("THE ELDER HEART FALLS", "it will regrow at dawn");
    writeSave();
}
function bossRewards() {
    const k = save.bossKills, first = k === 1, cash = Math.round(60000 * rebirthMult() * (1 + 0.3 * (k - 1)));
    save.money += cash;
    const drops = [["heartwood", first ? 3 : 1 + (Math.random() < 0.5 ? 1 : 0)], ["star", 3 + Math.floor(Math.random() * 3)], ["moonstone", 18 + Math.floor(Math.random() * 18)], ["void", 10 + Math.floor(Math.random() * 10)]];
    for (const [m, n] of drops) dropMats(HOLLOW.x, HOLLOW.z, m, n);
    toast(`+${money(cash)} from the Elder Heart${first ? " · FIRST KILL!" : ""}`, "cash");
    toast("Heartwood, Star Shards, Moonstone and Voidglass spill out of the trunk. Grab them!", "rare");
    if (first) setTimeout(() => toast("The Moonforge can now make Elder's Bane, the strongest axe there is.", "good"), 2500);
    burst(V3(HOLLOW.x, boss.gy + 3, HOLLOW.z), 60, 9, [fxRed, fxWhite, fxGold]);
    sfx(392, 0.6, "triangle", 0.12, 1.5); setTimeout(() => sfx(523, 0.6, "triangle", 0.12, 1.5), 160); setTimeout(() => sfx(784, 1.0, "triangle", 0.12, 1.2), 340);
    writeSave();
}
// materials that burst out and fly to you, like logs do
function dropMats(x, z, mat, n) {
    const meshes = Math.min(n, 10), base = Math.floor(n / meshes), extra = n % meshes;
    for (let i = 0; i < meshes; i++) {
        const m = new THREE.Mesh(matGeo, matMeshMat[mat]), a = Math.random() * 6.283, d = rand(BOSS_R + 1, BOSS_R + 6);
        m.position.set(x + Math.cos(a) * d, groundY(x, z) + 1.5, z + Math.sin(a) * d);
        if (base > 1) m.scale.setScalar(Math.min(1.8, 1 + base * 0.08));
        scene.add(m);
        logs.push({ m, vy: 5 + Math.random() * 4, bonus: 0, w: base + (i < extra ? 1 : 0), mat });
    }
}
const bossDist = () => Math.hypot(player.pos.x - HOLLOW.x, player.pos.z - HOLLOW.z);
const grounded = () => player.pos.y - (groundY(player.pos.x, player.pos.z) + 1.7) < 0.32;
function bossHit(dmgK, sx, sz) { if (player.invuln > 0) return; hurtPlayer(bossDmg(dmgK), sx, sz); }
function ringAt(x, z, r, life, col = 0xff2a4a) {
    const o = bossFx.rings.find(q => q.t < 0); if (!o) return null;
    o.t = 0; o.life = life; o.r = r; o.g.position.set(x, groundY(x, z) + 0.08, z); o.g.scale.setScalar(r); o.g.visible = true;
    o.ring.material.color.setHex(col); o.fill.material.color.setHex(col);
    return o;
}
function eruptAt(x, z) {
    const s = bossFx.spikes.find(q => q.t < 0); if (!s) return;
    s.t = 0; s.x = x; s.z = z; s.y = groundY(x, z); s.hit = false; s.burst = false; s.g.position.set(x, s.y - 3.6, z); s.g.rotation.y = Math.random() * 6; s.g.visible = true;
}
function pickBossAttack() {
    const f = fight3, d = bossDist(), alive = f.minions.filter(t => !t.gone && !t.dying && !t.burn).length;
    const opts = [];
    if (d < BOSS_R + 7.5) opts.push(["swipe", 3.2]);
    opts.push(["roots", 3], ["seeds", 2.2]);
    if (f.phase >= 2) opts.push(["quake", 2.6]);
    if (alive < (f.phase >= 2 ? 5 : 2)) opts.push(["summon", f.phase >= 2 ? 1.1 : 0.6]);
    let r = Math.random() * opts.reduce((a, o) => a + o[1], 0);
    for (const [k, w] of opts) { r -= w; if (r <= 0 && k !== f.last) return k; }
    return opts[0][0];
}
function startBossAttack(k) {
    const f = fight3;
    f.atk = k; f.atkT = 0; f.last = k; f.fired = false; f.step = 0;
    if (k === "swipe") { floatWorld(V3(boss.x, boss.gy + 13, boss.z), "!", "warn"); sfx(150, 0.4, "sawtooth", 0.08, 0.5); }
    if (k === "roots") {
        const n = f.phase === 1 ? 1 : f.phase === 2 ? 3 : 5, vx = player.vel.x, vz = player.vel.z;
        f.targets = [];
        for (let i = 0; i < n; i++) {
            let x = player.pos.x, z = player.pos.z;
            if (i === 1) { x += vx * 0.8; z += vz * 0.8; } else if (i > 1) { const a = Math.random() * 6.283, d = rand(3, 7); x += Math.cos(a) * d; z += Math.sin(a) * d; }
            const dd = Math.hypot(x - HOLLOW.x, z - HOLLOW.z), lim = HOLLOW.r - 2; if (dd > lim) { x = HOLLOW.x + (x - HOLLOW.x) / dd * lim; z = HOLLOW.z + (z - HOLLOW.z) / dd * lim; }
            f.targets.push({ x, z }); ringAt(x, z, 2.6, f.phase >= 2 ? 0.95 : 1.15);
        }
        sfx(90, 0.6, "sawtooth", 0.06, 0.7);
    }
    if (k === "seeds") {
        const n = f.phase === 1 ? 5 : f.phase === 2 ? 8 : 11;
        for (let i = 0; i < n; i++) {
            const s = bossFx.seeds.find(q => !q.on); if (!s) break;
            const lead = i === 0 ? 0 : 0.9, a = Math.random() * 6.283, d = i === 0 ? 0 : rand(1.5, 6.5);
            let x = player.pos.x + player.vel.x * lead + Math.cos(a) * d, z = player.pos.z + player.vel.z * lead + Math.sin(a) * d;
            const dd = Math.hypot(x - HOLLOW.x, z - HOLLOW.z), lim = HOLLOW.r - 1.5; if (dd > lim) { x = HOLLOW.x + (x - HOLLOW.x) / dd * lim; z = HOLLOW.z + (z - HOLLOW.z) / dd * lim; }
            s.on = true; s.t = -0.12 * i; s.dur = rand(1.1, 1.5); s.a.set(boss.x + rand(-4, 4), boss.gy + BOSS_H * 0.85, boss.z + rand(-4, 4)); s.b.set(x, groundY(x, z), z);
            s.ring = null; s.g.visible = false;
        }
        sfx(500, 0.25, "triangle", 0.06, 0.6);
    }
    if (k === "quake") { floatScreen("JUMP!", "warn"); sfx(80, 0.9, "sawtooth", 0.1, 0.5); }
    if (k === "summon") { roar(1.4); }
}
function spawnThornling(x, z) {
    const t = makeTree(x, z, rand(2.4, 3.4), "thornling");
    t.minion = true; t.cool = 0.6; fight3.minions.push(t);
    burst(V3(x, groundY(x, z) + 0.5, z), 16, 5, [fxRed, chipMats[2]]);
    sfx(200, 0.3, "sawtooth", 0.07, 0.4);
}
function updateFight(dt) {
    const f = fight3, B = boss, d = bossDist();
    // walls rise, the heart pulses, the tree turns to watch you
    f.wall = Math.min(1, f.wall + dt * 0.8);
    bossWall.position.y = B.gy - 6.2 + eio(f.wall) * 6.2;
    f.heart = Math.max(0, f.heart - dt * 3);
    const yaw = Math.atan2(player.pos.x - B.x, player.pos.z - B.z);
    bossG.rotation.y += angDiff(yaw, bossG.rotation.y) * Math.min(1, (f.phase >= 2 ? 1.6 : 1.0) * dt);
    // phases
    const frac = B.hp / B.maxHp;
    if (f.phase === 1 && frac <= 0.5) {
        f.phase = 2; roar(0.8); shake = 0.8; flash = 0.3;
        $("bossPh").textContent = "· ENRAGED"; $("bossBar").classList.add("rage");
        toast("The Elder Heart is ENRAGED! Its shockwaves can be jumped.", "bad");
        for (let i = 0; i < 3; i++) { const a = Math.random() * 6.283; spawnThornling(B.x + Math.cos(a) * 9, B.z + Math.sin(a) * 9); }
        f.atk = null; f.cd = 1.2;
    } else if (f.phase === 2 && frac <= 0.2) { f.phase = 3; roar(0.6); $("bossPh").textContent = "· DESPERATE"; toast("It's nearly done. So is your health, probably.", "rare"); }
    bossCrown.color.copy(bossCrownCol).lerp(bossCrownRage, f.phase >= 2 ? 1 : 0);
    // heartbeat drone
    f.beat -= dt;
    if (f.beat <= 0) { f.beat = f.phase === 1 ? 1.2 : f.phase === 2 ? 0.85 : 0.6; sfx(58, 0.2, "sine", 0.2, 0.6); setTimeout(() => sfx(50, 0.16, "sine", 0.14, 0.6), 170); f.heart = Math.max(f.heart, 0.6); }
    // attacks
    if (!f.atk) { f.cd -= dt; if (f.cd <= 0) startBossAttack(pickBossAttack()); }
    else {
        f.atkT += dt;
        const A = f.atk, k = f.phase >= 2 ? 0.8 : 1;
        if (A === "swipe") {
            if (f.atkT < 0.8 * k) B.armUp = lerp(B.armUp, 1, Math.min(1, 8 * dt));
            else if (!f.fired) { f.fired = true; B.slam = 1; sfx(120, 0.25, "sawtooth", 0.12, 0.4); if (d < BOSS_R + 8) bossHit(1.3, B.x, B.z); }
            if (f.atkT > 0.8 * k + 0.5) endAttack();
        } else if (A === "roots") {
            const T = f.phase >= 2 ? 0.95 : 1.15;
            if (f.atkT >= T && !f.fired) { f.fired = true; for (const p of f.targets) eruptAt(p.x, p.z); shake = Math.max(shake, 0.4); sfx(70, 0.4, "square", 0.14, 0.5); }
            if (f.atkT > T + 0.6) endAttack();
        } else if (A === "seeds") {
            if (f.atkT > 2.4) endAttack();
        } else if (A === "quake") {
            if (f.atkT < 1.0 * k) B.armUp = lerp(B.armUp, 1.4, Math.min(1, 6 * dt));
            else if (f.step < (f.phase === 3 ? 2 : 1) && f.atkT > 1.0 * k + f.step * 0.7) {
                f.step++; B.slam = 1; shake = 0.9; f.hitWave = new Set();
                const w = bossFx.waves.find(q => q.R < 0); if (w) { w.R = BOSS_R + 1; w.m.visible = true; w.id = Math.random(); }
                sfx(55, 0.8, "sawtooth", 0.2, 0.4); sfx(90, 0.5, "square", 0.12, 0.5);
                burst(V3(B.x, B.gy + 0.5, B.z), 30, 7, [chipMats[2], fxPink]);
            }
            if (f.atkT > 1.0 * k + 2.4) endAttack();
        } else if (A === "summon") {
            if (f.atkT > 0.5 && !f.fired) { f.fired = true; const n = f.phase >= 2 ? 3 : 2; for (let i = 0; i < n; i++) { const a = yaw + Math.PI + rand(-1.4, 1.4), r = rand(7, 13); spawnThornling(B.x + Math.sin(a) * r, B.z + Math.cos(a) * r); } }
            if (f.atkT > 1.2) endAttack();
        }
    }
    // arms
    B.armUp = lerp(B.armUp, 0, Math.min(1, 2 * dt)); B.slam = Math.max(0, B.slam - dt * 3);
    for (const a of B.arms) {
        a.arm.rotation.z = -a.s * (2.2 - B.armUp * 1.0) + Math.sin(time * 1.1 + a.s + (a.low ? 1 : 0)) * 0.08;
        a.pivot.rotation.x = -B.slam * (a.low ? 0.9 : 1.4) + B.armUp * 0.3;
    }
    const mode = B.hurt > 0.25 || f.phase >= 3 ? "scream" : "angry";
    if (B.mode !== mode) { B.mode = mode; B.face.material = faceMats[mode]; }
    B.hurt = Math.max(0, B.hurt - dt * 4);
    B.body.rotation.z = Math.sin(time * 0.7) * 0.012 + (Math.random() - 0.5) * B.hurt * 0.02;
    // the bar (the white part catches up slowly)
    f.lag = Math.max(frac, f.lag - dt * 0.35);
    $("bossFill").style.width = (frac * 100) + "%"; $("bossLag").style.width = (f.lag * 100) + "%";
    $("bossHp").textContent = Math.max(0, Math.ceil(B.hp)).toLocaleString() + " / " + B.maxHp.toLocaleString();
}
function endAttack() { const f = fight3; f.atk = null; f.cd = f.phase === 1 ? rand(2.2, 3.2) : f.phase === 2 ? rand(1.5, 2.3) : rand(1.0, 1.6); }
// rings, spikes, seeds and shockwaves keep moving even right after the fight ends
function updateBossFx(dt) {
    for (const r of bossFx.rings) {
        if (r.t < 0) continue;
        r.t += dt; const u = r.t / r.life;
        r.fill.scale.setScalar(Math.min(1, u)); r.ring.material.opacity = 0.45 + Math.sin(time * 18) * 0.25; r.fill.material.opacity = 0.18 + u * 0.25;
        if (u >= 1) { r.t = -1; r.g.visible = false; }
    }
    for (const s of bossFx.spikes) {
        if (s.t < 0) continue;
        s.t += dt;
        const up = s.t < 0.12 ? s.t / 0.12 : s.t < 0.8 ? 1 : Math.max(0, 1 - (s.t - 0.8) / 0.4);
        s.g.position.y = s.y - 3.6 + up * 3.6;
        if (!s.hit && s.t < 0.3 && fight3.on && Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < 2.7) { s.hit = true; bossHit(1, s.x, s.z); player.vel.y = 6; }
        if (!s.burst) { s.burst = true; burst(V3(s.x, s.y + 0.3, s.z), 12, 5, [chipMats[2], fxRed]); }
        if (s.t > 1.2) { s.t = -1; s.g.visible = false; }
    }
    for (const s of bossFx.seeds) {
        if (!s.on) continue;
        s.t += dt;
        if (s.t < 0) continue;
        if (!s.ring) { s.ring = ringAt(s.b.x, s.b.z, 2.2, s.dur, 0xff6a9a); s.g.visible = true; }
        const u = Math.min(1, s.t / s.dur);
        s.g.position.set(lerp(s.a.x, s.b.x, u), lerp(s.a.y, s.b.y, u) + Math.sin(u * Math.PI) * 9, lerp(s.a.z, s.b.z, u));
        s.g.rotation.y += dt * 8;
        if (u >= 1) {
            s.on = false; s.g.visible = false;
            burst(V3(s.b.x, s.b.y + 0.4, s.b.z), 12, 6, [fxPink, fxWhite]);
            const dd = Math.hypot(player.pos.x - s.b.x, player.pos.z - s.b.z);
            if (dd < 2.3 && fight3.on) bossHit(0.7, s.b.x, s.b.z);
            if (dd < 25) sfx(160 + Math.random() * 60, 0.2, "square", 0.08 * (1 - dd / 25), 0.4);
        }
    }
    for (const w of bossFx.waves) {
        if (w.R < 0) continue;
        w.R += dt * 13;
        w.m.scale.set(w.R, 1, w.R); w.m.position.set(HOLLOW.x, boss.gy + 0.55, HOLLOW.z); w.m.material.opacity = 0.65 * (1 - w.R / (HOLLOW.r + 2));
        const dd = bossDist();
        if (fight3.on && Math.abs(dd - w.R) < 0.9 && grounded() && !fight3.hitWave.has(w.id)) { fight3.hitWave.add(w.id); bossHit(0.9, HOLLOW.x, HOLLOW.z); player.vel.y = 5; const ux = (player.pos.x - HOLLOW.x) / (dd || 1), uz = (player.pos.z - HOLLOW.z) / (dd || 1); player.vel.x += ux * 9; player.vel.z += uz * 9; }
        if (w.R > HOLLOW.r + 2) { w.R = -1; w.m.visible = false; }
    }
}
function updateBoss(dt, animOnly) {
    if (!bossG) return;
    const f = fight3, B = boss;
    if (bossLight) bossLight.intensity = (f.on ? 6 + Math.sin(time * 6) * 2 : 1.5 + Math.sin(time * 1.5) * 0.6) + f.heart * 10;
    if (bossHeart) { const s = 1 + Math.sin(time * (f.on ? 6 : 2)) * 0.08 + f.heart * 0.25; bossHeart.scale.set(0.95 * s, 1.1 * s, 0.8 * s); }
    updateBossFx(dt);
    if (f.dyingT >= 0) { // the great fall
        f.dyingT += dt;
        const u = Math.min(1, f.dyingT / 3.2);
        B.body.rotation.x = -Math.pow(u, 2.2) * Math.PI * 0.46;
        if (f.dyingT < 2.6 && Math.random() < dt * 20) burst(V3(B.x + rand(-3, 3), B.gy + rand(1, 12), B.z + rand(-3, 3)), 2, 3, [fxRed, chipMats[2]]);
        if (u >= 1 && !f.landed) { f.landed = true; shake = 1.2; sfx(45, 1.2, "sawtooth", 0.25, 0.4); bossRewards(); }
        if (f.dyingT > 4.4) { f.dyingT = -1; f.landed = false; bossG.visible = false; bossStump.visible = true; bossLabel.el.textContent = "THE ELDER HEART · regrows at dawn"; bossLabel.visible = true; bossWall.visible = false; }
    }
    if (!f.on && f.wall > 0) { f.wall = Math.max(0, f.wall - dt * 0.6); bossWall.position.y = B.gy - 6.2 + eio(f.wall) * 6.2; if (f.wall <= 0 && f.dyingT < 0) bossWall.visible = false; }
    if (f.on) { if (!animOnly && state === "playing") updateFight(dt); return; }
    if (f.dyingT >= 0 || !bossG.visible) return;
    // asleep: it breathes, and its arms drift
    B.body.rotation.z = Math.sin(time * 0.4) * 0.01;
    for (const a of B.arms) { a.arm.rotation.z = -a.s * 2.2 + Math.sin(time * 0.5 + a.s) * 0.05; a.pivot.rotation.x = 0; }
    if (B.mode !== "calm") { B.mode = "calm"; B.face.material = faceMats.calm; }
    bossG.rotation.y += angDiff(0, bossG.rotation.y) * Math.min(1, dt * 0.3);
    if (!animOnly && state === "playing" && !ride && bossDist() < HOLLOW.r - 3 && player.hp > 0 && !(save.bossDay === save.day && save.bossKills > 0)) startFight();
}

// =====================================================================
//  falling stars: at night, now and then, a star comes down somewhere on the island
// =====================================================================
const stars3 = []; // fallen stars waiting to be picked up
const falling = []; // stars still on their way down
let starT = 40;
const fallStarMat = new THREE.MeshBasicMaterial({ color: 0xfff4a0 }), starBeamMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false });
let starGeo = null;
function buildStarFx() {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? 0.26 : 0.62; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    s.closePath();
    starGeo = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 1 }); starGeo.translate(0, 0, -0.08);
}
const compass = (dx, dz) => ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(((Math.atan2(dx, -dz) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
function randStarSpot(nearX, nearZ, rMin = 0, rMax = 999) {
    for (let i = 0; i < 80; i++) {
        let x, z;
        if (nearX !== undefined) { const a = Math.random() * 6.283, d = rand(rMin, rMax); x = nearX + Math.cos(a) * d; z = nearZ + Math.sin(a) * d; }
        else { const a = Math.random() * 6.283, d = rand(SAFE_R + 8, shoreR3(a) - 14); x = Math.cos(a) * d; z = Math.sin(a) * d; }
        const d0 = Math.hypot(x, z);
        if (d0 < SAFE_R + 4 || d0 > shoreAt3(x, z) - 10 || !treeOk3(x, z)) continue;
        return { x, z };
    }
    return { x: CRATER.x + 4, z: CRATER.z + 4 };
}
function dropStar(x, z, announce = true) {
    const y = groundY(x, z), a = Math.random() * 6.283;
    const head = new THREE.Mesh(ICO, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })); head.scale.setScalar(1.1);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.9, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.7, fog: false, depthWrite: false }));
    isle3G.add(head, tail);
    falling.push({ head, tail, from: V3(x + Math.cos(a) * 170, y + 150, z + Math.sin(a) * 170), to: V3(x, y + 0.6, z), t: 0, dur: 2.6 });
    if (announce) { toast(`A star is falling to the ${compass(x - player.pos.x, z - player.pos.z)}!`, "rare"); sfx(1800, 1.4, "sine", 0.05, 0.4); }
}
function landStar(F) {
    isle3G.remove(F.head, F.tail);
    const x = F.to.x, z = F.to.z, y = groundY(x, z);
    const g = new THREE.Group(); g.position.set(x, y + 1.2, z); isle3G.add(g);
    const st = new THREE.Mesh(starGeo, fallStarMat); st.scale.setScalar(1.3); g.add(st);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 70, 8, 1, true), starBeamMat); beam.position.y = 35; g.add(beam);
    const crater = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.8, 16), new THREE.MeshBasicMaterial({ color: 0x2a2030, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); crater.rotation.x = -Math.PI / 2; crater.position.set(x, y + 0.05, z); isle3G.add(crater);
    stars3.push({ g, st, crater, x, z, y });
    const dd = Math.hypot(player.pos.x - x, player.pos.z - z);
    burst(V3(x, y + 0.5, z), 30, 8, [fallStarMat, fxWhite]);
    if (dd < 70) { shake = Math.max(shake, 0.5 * (1 - dd / 70)); flash = Math.max(flash, 0.35 * (1 - dd / 70)); }
    sfx(80, 0.8, "sawtooth", 0.12 * Math.max(0.2, 1 - dd / 120), 0.4); sfx(1200, 0.5, "triangle", 0.05, 0.3);
}
function takeStar(s) {
    const i = stars3.indexOf(s); if (i < 0) return;
    stars3.splice(i, 1); isle3G.remove(s.g, s.crater);
    const n = 1 + (Math.random() < 0.35 ? 1 : 0) + (isBlood() ? 1 : 0), cash = Math.round(2500 * rebirthMult());
    save.mats.star = (save.mats.star || 0) + n; save.money += cash; save.starsCaught = (save.starsCaught || 0) + 1;
    flash = 0.5; sfx(784, 0.3, "triangle", 0.1, 1.3); setTimeout(() => sfx(1047, 0.4, "triangle", 0.1, 1.3), 120);
    burst(V3(s.x, s.y + 1.2, s.z), 20, 5, [fallStarMat]);
    toast(`You caught a fallen star! +${n} Star Shard${n > 1 ? "s" : ""} and ${money(cash)}`, "cash");
    writeSave();
}
function updateStars(dt, animOnly) {
    for (let i = falling.length - 1; i >= 0; i--) {
        const F = falling[i];
        F.t += dt;
        const u = Math.min(1, F.t / F.dur), p = F.from.clone().lerp(F.to, u * u);
        F.head.position.copy(p);
        const dir = F.from.clone().sub(F.to).normalize(), len = 16;
        F.tail.position.copy(p).addScaledVector(dir, len / 2); F.tail.scale.set(1, len, 1); F.tail.quaternion.setFromUnitVectors(UP, dir);
        if (u >= 1) { falling.splice(i, 1); landStar(F); }
    }
    for (const s of stars3) { s.st.rotation.y += dt * 1.6; s.g.position.y = s.y + 1.2 + Math.sin(time * 2 + s.x) * 0.18; }
    if (animOnly || state !== "playing") return;
    if (isNight() && !inCave()) {
        starT -= dt;
        if (starT <= 0) { starT = rand(55, 110) * (isBlood() ? 0.6 : 1); if (stars3.length + falling.length < 4) { const p = randStarSpot(); dropStar(p.x, p.z); } }
    }
}
function clearStars(msg) {
    if (msg && stars3.length) toast("The fallen stars fade into the morning light.", "");
    for (const s of stars3) isle3G.remove(s.g, s.crater);
    stars3.length = 0;
}
function useScope() {
    if (!isNight()) { toast("The sky's too bright to see anything. Come back at night.", "bad"); return; }
    if (save.scopeDay === save.day) { toast("You already watched the sky tonight. Try again tomorrow night.", ""); return; }
    save.scopeDay = save.day;
    sfx(660, 0.3, "sine", 0.06, 1.2);
    toast("Through the telescope you spot a shooting star... it's coming down close by!", "rare");
    const p = randStarSpot(OBS.x, OBS.z, 18, 48);
    setTimeout(() => { if (isle === 3) dropStar(p.x, p.z); }, 3000);
    writeSave();
}

// =====================================================================
//  the Apothecary and the Moonwell: timed buffs
// =====================================================================
const BUFFS = {
    swift:    { name: "SWIFTROOT",  col: "#7affb0", icon: "»" },
    ironhide: { name: "IRONHIDE",   col: "#a9c0dc", icon: "◆" },
    fury:     { name: "LUMBERLUST", col: "#ff7a5a", icon: "⚔" },
    lucky:    { name: "LUCKY SPORE", col: "#ffd040", icon: "✦" },
    blessed:  { name: "MOONBLESSED", col: "#7affef", icon: "☾" },
    fireproof: { name: "FIREPROOF",  col: "#ff9a4a", icon: "♨" }
};
const BUFF_CAP = 900;
function giveBuff(k, secs) { const now = save.seconds, cur = Math.max(now, save.buffs[k] || 0); save.buffs[k] = Math.min(now + BUFF_CAP, cur + secs); }
const buffLeft = k => Math.max(0, (save.buffs[k] || 0) - save.seconds);
const mmss = s => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
function brewItems() {
    const b = (k, name, desc, secs, craft, cost) => ({ name, col: BUFFS[k].col, desc: `${desc} for ${secs / 60} min${buffLeft(k) > 0 ? ` · ACTIVE ${mmss(buffLeft(k))} (drinking adds more time)` : ""}`, craft, cost, verb: "Brewed", quiet: true, buy() { giveBuff(k, secs); sfx(300, 0.3, "sine", 0.1, 2); toast(`You drink the ${name}. ${BUFFS[k].name} for ${mmss(buffLeft(k))}.`, "good"); } });
    return [
        b("swift", "Swiftroot Tonic", "+30% move speed", 240, { spore: 6 }, 600),
        b("ironhide", "Ironhide Draught", "Take 40% less damage", 240, { spore: 4, silver: 6 }, 1200),
        b("fury", "Lumberlust Brew", "+40% axe and gun damage", 240, { spore: 6, amber: 5 }, 2500),
        b("lucky", "Lucky Spore Elixir", "+50% materials from every tree", 300, { spore: 12, moonstone: 2 }, 3500),
        ...(isle === 4 ? [b("fireproof", "Fireproof Tonic", "Walk through lava, and fire hurts half as much", 180, { ash: 10, sulfur: 6 }, 30000)] : []),
        { name: "Phoenix Tear", icon: "phoenix", col: "#ffb060", desc: `If you would die, you rise again with 60% health instead. You have ${save.phoenix || 0} (max 3)`, craft: { amber: 10, star: 1 }, cost: 25000, verb: "Brewed", maxed: (save.phoenix || 0) >= 3, maxTxt: "MAX 3", buy() { save.phoenix = (save.phoenix || 0) + 1; sfx(500, 0.4, "triangle", 0.1, 1.8); } }
    ];
}
function drinkWell() {
    if (save.wellDay === save.day) { toast("The Moonwell is still. It refills at dawn.", ""); return; }
    save.wellDay = save.day;
    player.hp = player.maxHp; giveBuff("blessed", 240);
    flash = 0.5; sfx(523, 0.6, "sine", 0.08, 1.5); setTimeout(() => sfx(784, 0.8, "sine", 0.08, 1.5), 200);
    burst(V3(player.pos.x, player.pos.y - 0.6, player.pos.z), 20, 4, [glowM(0x7affef), glowM(0xffffff)]);
    toast("You drink from the Moonwell. Health restored, and you feel MOONBLESSED: +25% damage and healing for 4 min.", "good");
    writeSave();
}
const WITCH_SAY = ["Mushrooms, moonlight, a pinch of panic. Stir.", "Drink it fast. Don't smell it.", "The Elder Heart hates my brews. That's how you know they work.", "Phoenix Tears aren't really tears. Don't ask whose.", "Heh. Another woodcutter. You'll be back."];
const SMITH3_SAY = ["Moonsilver sings when you hammer it. Annoying, honestly.", "Voidglass cuts the light around it. And trees. Mostly trees.", "Bring me Heartwood and I'll make you the last axe you'll ever need.", "Star shards. Don't touch them bare-handed. ...Too late.", "The lance? It goes through one tree and keeps going. Through the next one too."];
const DEPOT3_SAY = ["Spores by the sack, stars by the shard. I buy it all.", "Amber's up today. Something about bugs from a million years ago.", "Heartwood? You actually felled it? ...Name your price."];
const FERRY3_LINES = [
    "Mooncap Isle. Two moons, and trees that dream out loud.",
    "Your relic is gone. It burned away on the crossing... that was the price of passage.",
    "South of camp there's a sunken clearing called the Hollow. The oldest tree in the world sleeps there: the Elder Heart.",
    "Step inside and it wakes. Fell it and its Heartwood is yours. It always grows back by dawn.",
    "At night, watch the sky. Stars fall here, and they don't wait around to be picked up.",
    "Fell the Elder Heart, bring me five pieces of its Heartwood and $2,500,000, and I'll take you to Ashfall Isle. It's on fire. You'll love it."
];
const FERRY3_QUIPS = ["The Hollow is south. Your nerve is your own business.", "Two moons. Twice the werewolves. Kidding. Probably.", "Stars fall on clear nights. Fast feet catch them.", "See the smoke past the ??? light? That's Ashfall Isle. Rebirth 3.", "The Elder Heart has felled more woodcutters than you've felled trees."];
function openFerry3() {
    ferryConfirm = 0;
    $("ferrySay").textContent = "“" + FERRY3_QUIPS[Math.floor(Math.random() * FERRY3_QUIPS.length)] + "”";
    openPanel("ferry");
}
function renderFerry3() {
    document.querySelector("#panelFerry h2").textContent = "REBIRTH 3: THE FERRY TO ASHFALL ISLE";
    const k = save.bossKills || 0, hw = save.mats.heartwood || 0, cashOk = save.money >= REBIRTH3_COST, ok = rebirth3Ready();
    const html = `<div class="fprice">Rebirth 3 ticket: <b>${money(REBIRTH3_COST)}</b> + <b>${REBIRTH3_HEART} Heartwood</b></div>
      <div class="flist">
        <div class="${k ? "keep" : "lose"}"><h4>${k ? "✔" : "✘"} THE ELDER HEART</h4>${k ? `felled ${k} time${k === 1 ? "" : "s"}` : "still sleeping in the Hollow. Fell it at least once"}</div>
        <div class="${hw >= REBIRTH3_HEART ? "keep" : "lose"}"><h4>${hw >= REBIRTH3_HEART ? "✔" : "✘"} HEARTWOOD</h4>${hw} / ${REBIRTH3_HEART} (it falls from the Elder Heart)</div>
        <div class="${cashOk ? "keep" : "lose"}"><h4>${cashOk ? "✔" : "✘"} CASH</h4>${money(save.money)} of ${money(REBIRTH3_COST)}</div>
        <div class="lose"><h4>YOU LEAVE BEHIND</h4>cash and materials · every axe and gun · all upgrades and potions · the day count</div>
        <div class="gain"><h4>YOU GAIN (stacks every rebirth)</h4>★ +50% cash · ★ +10% damage · ★ +50 max health · ★ ASHFALL ISLE: a living volcano, rivers of lava, hot springs, obsidian, and trees that burn</div>
      </div>`;
    if ($("ferryBody").dataset.h !== html) { $("ferryBody").innerHTML = html; $("ferryBody").dataset.h = html; }
    const b = $("ferryBuy"); b.disabled = !ok; b.classList.toggle("danger", ok && !!ferryConfirm);
    b.textContent = !k ? "FELL THE ELDER HEART FIRST" : hw < REBIRTH3_HEART ? `BRING ${REBIRTH3_HEART - hw} MORE HEARTWOOD` : !cashOk ? "NEED " + money(REBIRTH3_COST - save.money) + " MORE" : ferryConfirm ? "CLICK AGAIN TO CONFIRM" : "SAIL TO ASHFALL ISLE";
}

// ---- getting there: the Highland ferry's ride ends here ----
function finishRebirth2() {
    save.rebirths = 2; // Mooncap Isle is Rebirth 2
    resetForRebirth();
    save.relicSpent = 1; save.bossDay = 0;
    enterIsle3(); newContract();
    holdingReset();
    player.maxHp = maxHpNow(); player.hp = player.maxHp;
    const a = arr3Pt(ARR3LEN - 9, 0);
    player.pos.set(a.x, 1.75, a.z); player.vel.set(0, 0, 0); player.yaw = Math.atan2(ARR3DIR.x, ARR3DIR.z); player.pitch = 0;
    player.invuln = 6;
    ride = null;
    writeSave();
    say("");
    setTimeout(() => {
        $("rebirthFx").classList.remove("show"); say("MOONCAP ISLE"); setTimeout(() => say(""), 3600);
        toast("You are reborn. ★" + save.rebirths + "  +" + save.rebirths * 50 + "% cash, +" + save.rebirths * 10 + "% damage, +" + save.rebirths * 50 + " max HP.", "cash");
        toast("Follow the lanterns to camp. New trees, new materials: craft at the Moonforge, brew at the Apothecary.", "good");
        toast("The Ferryman waits at the Rebirth 3 dock on the far side of the island. He knows what sleeps in the Hollow.", "rare");
    }, 2200);
}
function enterIsle3() {
    leaveWorld();
    if (!isle3Built) { buildIsle3(); snapWorld(3); } else loadWorld(3);
    isle = 3; save.isle = 3;
    showWorld(3);
    groundFn = groundY3;
    waterMesh.geometry = isle3.waterGeo; waterMesh.material.needsUpdate = true;
    smokeEmit.length = 0; isle3.emit.forEach(e => smokeEmit.push(e));
    RESPAWN.x = 2; RESPAWN.z = 4;
    syncGhosts();
    resetIsleTrees(95);
    resetChests();
    syncBoss();
}
function dawn3() {
    clearStars(true);
    if (save.bossKills > 0 && save.bossDay === save.day - 1 && !fight3.on) toast("Somewhere in the Hollow, the Elder Heart has grown back...", "rare");
    syncBoss();
}
function dusk3() { starT = rand(18, 40); }
function updateIsle3(dt, animOnly) {
    if (!isle3Built || isle !== 3) return;
    updateSky3(dt);
    updateBoss(dt, animOnly);
    updateStars(dt, animOnly);
    updateNpcs(dt, npcs3);
    if (isle3.foam) { isle3.foam.scale.setScalar(1 + Math.sin(time * 0.8) * 0.004); isle3.foam.material.opacity = 0.38 + Math.sin(time * 0.8) * 0.14; }
    if (isle3.fireLight) isle3.fireLight.intensity = 16 + Math.sin(time * 9) * 3 + Math.sin(time * 5.3) * 2;
    if (isle3.wellLight) isle3.wellLight.intensity = 8 + Math.sin(time * 1.3) * 2.5;
    if (isle3.wellWater) isle3.wellWater.material.emissive.setHex(save.wellDay === save.day ? 0x0a3a40 : 0x1a8a9a);
    if (isle3.crater) { isle3.crater.rotation.y += dt * 0.2; isle3.crater.scale.setScalar(1 + Math.sin(time * 2.2) * 0.05); }
    if (isle3.beam) isle3.beam.material.opacity = 0.08 + Math.sin(time * 1.2) * 0.04;
    for (const [b, ph] of [[isle3.boat, 0], [isle3.boat3, 1.3]]) if (b) { b.position.y = -0.15 + Math.sin(time * 1.1 + ph) * 0.07; b.rotation.z = Math.sin(time * 0.9 + ph) * 0.03; }
    for (const b of isle3.bubbles) { const k = (time * 0.6 + b.ph) % 1; b.m.position.set(b.ox * (1 - k * 0.5), 0.85 + k * 0.6, b.oz * (1 - k * 0.5)); b.m.scale.setScalar((Math.sin(k * Math.PI) + 0.1) * 0.1); }
    if (ferryman3) {
        ferryman3.position.y = 0.3 + Math.sin(time * 1.2) * 0.02;
        const base = Math.atan2(D3DIR.x, D3DIR.z) + Math.PI, near = Math.hypot(player.pos.x - FERRYMAN3.x, player.pos.z - FERRYMAN3.z) < 14;
        const tg = near ? Math.atan2(player.pos.x - FERRYMAN3.x, player.pos.z - FERRYMAN3.z) : base;
        ferryman3.rotation.y += angDiff(tg, ferryman3.rotation.y) * Math.min(1, 3 * dt);
    }
}
function nearest3() {
    const px = player.pos.x, pz = player.pos.z, near = (p, r) => Math.hypot(px - p.x, pz - p.z) < r;
    if (near(SMITH3_AT, 3.4)) return { k: "smith" };
    if (near(DEPOT3_AT, 3.4)) return { k: "depot" };
    if (near(WITCH3_AT, 3.4)) return { k: "witch" };
    if (near(BED3, 3.2)) return { k: "bed" };
    if (near(FERRYMAN3, 3.4)) return { k: "ferry3" };
    for (const s of stars3) if (Math.hypot(px - s.x, pz - s.z) < 2.8) return { k: "star", s };
    const dw = Math.hypot(px - WELL.x, pz - WELL.z); if (dw > WELL.r - 2.5 && dw < WELL.r + 4.5) return { k: "well" };
    if (near(OBS_DOOR, 3.2)) return { k: "scope" };
    for (const c of chests) if (!c.opened && Math.hypot(px - c.x, pz - c.z) < 2.6) return { k: "chest", c };
    if (altar && near(altar, 3.2)) return { k: "altar" };
    return null;
}

// ---------- the map of Mooncap Isle ----------
function drawMap3() {
    const cv = $("mapc"), g = cv.getContext("2d"), S = cv.width, c = S / 2, sc = (S / 2 - 14) / 160;
    if (!mapBg3) {
        const N = 320, oc = document.createElement("canvas"); oc.width = oc.height = N;
        const og = oc.getContext("2d"), img = og.createImageData(N, N), col = new THREE.Color();
        for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
            const x = ((px + 0.5) / N - 0.5) * 320, z = ((py + 0.5) / N - 0.5) * 320, d = Math.hypot(x, z), inside = shoreAt3(x, z) - d, i = (py * N + px) * 4;
            let r, gg, b;
            if (inside < 0) { r = 18; gg = 16; b = 58; }
            else if (inside < 5) { r = 110; gg = 170; b = 200; }
            else {
                const y = terrain3(x, z), sh = clamp((terrain3(x - 2, z - 2) - terrain3(x + 2, z + 2)) * 0.06, -0.5, 0.5);
                if (Math.hypot(x - WELL.x, z - WELL.z) < WELL.r) col.setRGB(0.3, 0.85, 0.9);
                else if (Math.hypot(x - HOLLOW.x, z - HOLLOW.z) < HOLLOW.r) col.setRGB(0.32, 0.1, 0.18);
                else if (Math.hypot(x - MARSH.x, z - MARSH.z) < MARSH.r) col.setRGB(0.1, 0.32, 0.3);
                else if (inside < 12 && y < 2.2) col.setRGB(0.68, 0.64, 0.76);
                else { const v = sstep(0.42, 0.58, fbm2(x * 0.03 + 5, z * 0.03 - 7, 3)); col.setHSL(lerp(0.48, 0.78, v), 0.35, 0.24 + clamp(y / 16, 0, 1) * 0.12); }
                r = clamp((col.r + sh) * 255, 0, 255); gg = clamp((col.g + sh) * 255, 0, 255); b = clamp((col.b + sh) * 255, 0, 255);
            }
            img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
        og.putImageData(img, 0, 0);
        mapBg3 = oc;
    }
    g.clearRect(0, 0, S, S);
    g.fillStyle = "#120e36"; g.beginPath(); g.arc(c, c, c - 6, 0, 7); g.fill();
    g.strokeStyle = "rgba(200,160,255,.45)"; g.lineWidth = 3; g.stroke();
    g.save(); g.beginPath(); g.arc(c, c, c - 8, 0, 7); g.clip();
    g.imageSmoothingEnabled = false; g.drawImage(mapBg3, c - 160 * sc, c - 160 * sc, 320 * sc, 320 * sc);
    g.restore();
    g.fillStyle = "rgba(200,160,255,.12)"; g.beginPath(); g.arc(c, c, SAFE_R * sc, 0, 7); g.fill();
    g.setLineDash([6, 6]); g.strokeStyle = "rgba(200,160,255,.85)"; g.lineWidth = 2; g.beginPath(); g.arc(c, c, SAFE_R * sc, 0, 7); g.stroke(); g.setLineDash([]);
    const X = x => c + x * sc, Z = z => c + z * sc;
    g.font = "bold 11px Consolas"; g.textAlign = "center";
    for (const lm of LM3) {
        if (lm.camp) continue;
        g.strokeStyle = lm.col; g.lineWidth = 1.5; g.beginPath(); g.arc(X(lm.x), Z(lm.z), lm.r * sc * 0.7, 0, 7); g.stroke();
        g.lineWidth = 3; g.strokeStyle = "#000"; g.strokeText(lm.name, X(lm.x), Z(lm.z) - lm.r * sc * 0.7 - 4); g.fillStyle = lm.col; g.fillText(lm.name, X(lm.x), Z(lm.z) - lm.r * sc * 0.7 - 4);
    }
    { // the Elder Heart: a pulsing skull while it lives, a stump when it doesn't
        const dead = save.bossDay === save.day && save.bossKills > 0;
        g.font = "bold 22px Segoe UI Emoji, sans-serif"; g.fillStyle = dead ? "#8a6a7a" : "#ff5a8a";
        g.fillText(dead ? "🪵" : "💀", X(HOLLOW.x), Z(HOLLOW.z) + 8);
        g.font = "bold 10px Consolas"; g.fillStyle = dead ? "#b8a0b0" : "#ffb0c8"; g.strokeStyle = "#000"; g.lineWidth = 3;
        const t = dead ? "regrows at dawn" : "THE ELDER HEART"; g.strokeText(t, X(HOLLOW.x), Z(HOLLOW.z) + 24); g.fillText(t, X(HOLLOW.x), Z(HOLLOW.z) + 24);
    }
    { const ae = arr3Pt(ARR3LEN); g.strokeStyle = "#c8a0ff"; g.lineWidth = 4; g.beginPath(); g.moveTo(X(ARR3B.x), Z(ARR3B.z)); g.lineTo(X(ae.x), Z(ae.z)); g.stroke(); g.fillStyle = "#c8a0ff"; g.font = "bold 12px Consolas"; g.fillText("ARRIVALS", X(ae.x), Z(ae.z) + (ae.z < 0 ? -8 : 16)); }
    { const de = dock3Pt(D3LEN); g.strokeStyle = "#9fe8ff"; g.lineWidth = 4; g.beginPath(); g.moveTo(X(D3B.x), Z(D3B.z)); g.lineTo(X(de.x), Z(de.z)); g.stroke(); g.fillStyle = "#9fe8ff"; g.font = "bold 12px Consolas"; g.fillText("REBIRTH 3 FERRY", X(de.x), Z(de.z) + (de.z < 0 ? -8 : 16)); }
    for (const ch of chests) if (!ch.opened) { g.fillStyle = ch.special ? "#c8a0ff" : "#ffd040"; g.fillRect(X(ch.x) - 4, Z(ch.z) - 4, 8, 8); g.strokeStyle = "#000"; g.lineWidth = 1; g.strokeRect(X(ch.x) - 4, Z(ch.z) - 4, 8, 8); }
    for (const t of trees) {
        if (t.gone || t.dying || t.boss) continue;
        const near = Math.hypot(t.x - player.pos.x, t.z - player.pos.z) < 14;
        g.fillStyle = near ? "#ff4a3a" : t.mut ? mutCol(t.mut) : t.type.rare ? t.type.col : "rgba(40,30,80,.95)";
        g.beginPath(); g.arc(X(t.x), Z(t.z), (t.mut ? 3.5 : t.type.rare ? 2.5 : 1.5) + t.h * 0.2, 0, 7); g.fill();
    }
    g.font = "bold 20px Segoe UI Symbol, sans-serif";
    for (const s of stars3) { g.fillStyle = "#fff4a0"; g.strokeStyle = "#000"; g.lineWidth = 3; g.strokeText("★", X(s.x), Z(s.z) + 7); g.fillText("★", X(s.x), Z(s.z) + 7); }
    g.font = "bold 12px Consolas"; g.fillStyle = "#e0c8ff"; g.strokeStyle = "#000"; g.lineWidth = 3;
    for (const [t, x, z] of [["CAMP", 0, 9], ["FORGE", SMITH3.x - 7, SMITH3.z - 1], ["TRADING", DEPOT3.x + 9, DEPOT3.z - 1], ["APOTHECARY", WITCH3.x, WITCH3.z + 6]]) { g.strokeText(t, X(x), Z(z)); g.fillText(t, X(x), Z(z)); }
    g.fillStyle = "#fff"; g.fillText("N", c, 22);
    g.save(); g.translate(X(player.pos.x), Z(player.pos.z)); g.rotate(-player.yaw);
    g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
}

// =====================================================================
//  REBIRTH 3: Ashfall Isle, a volcano island (part 1: the island, camp, trees, lava)
// =====================================================================
const shoreR4 = th => 148 + 12 * Math.sin(2 * th + 2.1) + 8 * Math.sin(3 * th + 0.4) + 5 * Math.sin(5 * th + 1.3);
const shoreAt4 = (x, z) => shoreR4(Math.atan2(z, x));
const ARR4TH = (() => { let b = 0, m = 1e9; for (let i = 0; i < 360; i++) { const th = (i / 360) * Math.PI * 2, r = shoreR4(th); if (r < m) { m = r; b = th; } } return b; })();
const at4 = (k, d) => ({ x: Math.cos(ARR4TH + k * Math.PI) * d, z: Math.sin(ARR4TH + k * Math.PI) * d });
const VOLC = { ...at4(0.66, 64), r: 56, rim: 17, peak: 58 };  // the volcano, off to one side so the far shore is clear for the next ferry
const SPRINGS = { ...at4(0.22, 58), r: 9 };
const SPIRES = { ...at4(-0.4, 72), r: 13 };
const BASALT = { ...at4(-0.14, 98), r: 12 };
const ASHWOOD4 = { ...at4(-0.72, 92), r: 15 };
const ARR4DIR = V3(Math.cos(ARR4TH), 0, Math.sin(ARR4TH)), ARR4PERP = V3(-ARR4DIR.z, 0, ARR4DIR.x), ARR4LEN = 22;
const ARR4B = V3(ARR4DIR.x * (shoreR4(ARR4TH) - 8), 0, ARR4DIR.z * (shoreR4(ARR4TH) - 8));
const arr4Pt = (a, s = 0, y = 0) => V3(ARR4B.x + ARR4DIR.x * a + ARR4PERP.x * s, y, ARR4B.z + ARR4DIR.z * a + ARR4PERP.z * s);
const D4TH = ARR4TH + Math.PI; // the next ferry: straight across the island from Arrivals
const D4DIR = V3(Math.cos(D4TH), 0, Math.sin(D4TH)), D4PERP = V3(-D4DIR.z, 0, D4DIR.x), D4LEN = 24;
const D4B = V3(D4DIR.x * (shoreR4(D4TH) - 8), 0, D4DIR.z * (shoreR4(D4TH) - 8));
const dock4Pt = (a, s = 0, y = 0) => V3(D4B.x + D4DIR.x * a + D4PERP.x * s, y, D4B.z + D4DIR.z * a + D4PERP.z * s);
const FERRYMAN4 = { x: dock4Pt(D4LEN - 3.5, -0.9).x, z: dock4Pt(D4LEN - 3.5, -0.9).z };
const DOCKS4 = [[ARR4B, ARR4DIR, ARR4PERP, ARR4LEN], [D4B, D4DIR, D4PERP, D4LEN]];
const BED4 = { x: -9, z: 6 }, SMITH4 = { x: -11, z: -7 }, DEPOT4 = { x: 11, z: -7 }, WITCH4 = { x: 10, z: 8 };
const SMITH4_AT = standPt(SMITH4), DEPOT4_AT = standPt(DEPOT4), WITCH4_AT = standPt(WITCH4);
const LM4 = [
    { name: "EMBER CAMP", x: 0, z: 0, r: 24, col: "#ffb060", camp: true },
    { name: "THE VOLCANO", x: VOLC.x, z: VOLC.z, r: 30, col: "#ff6a3a" },
    { name: "HOT SPRINGS", x: SPRINGS.x, z: SPRINGS.z, r: SPRINGS.r + 3, col: "#7ae8ff" },
    { name: "OBSIDIAN SPIRES", x: SPIRES.x, z: SPIRES.z, r: SPIRES.r, col: "#c8a0ff" },
    { name: "BASALT COLUMNS", x: BASALT.x, z: BASALT.z, r: BASALT.r, col: "#c0b8b0" },
    { name: "THE ASHWOOD", x: ASHWOOD4.x, z: ASHWOOD4.z, r: 6, col: "#d0c0b0" }
];
// three rivers of lava run from the crater down to the sea, away from camp
const LAVA = (() => {
    const out = [], vd = Math.atan2(VOLC.z, VOLC.x);
    for (const [off, wig] of [[-0.62, 0.7], [0.02, -0.5], [0.62, 0.6]]) {
        const pts = [];
        for (let s = 0; s <= 1.0001; s += 0.04) {
            const a = vd + off * s + Math.sin(s * 6 + off * 3) * 0.12 * wig, r0 = VOLC.rim + 2, x0 = VOLC.x + Math.cos(vd + off) * r0, z0 = VOLC.z + Math.sin(vd + off) * r0;
            const d = s * 130, x = x0 + Math.cos(a) * d, z = z0 + Math.sin(a) * d;
            if (Math.hypot(x, z) > shoreAt4(x, z) - 2) { pts.push([x, z]); break; }
            pts.push([x, z]);
        }
        out.push(pts);
    }
    return out;
})();
const LAVA_W = 2.4;
function lavaDist(x, z) { // distance to the nearest lava river centreline
    let best = 1e9;
    for (const pts of LAVA) for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (d < best) best = d;
    }
    return best;
}
function terrain4(x, z) {
    const d = Math.hypot(x, z), inside = shoreAt4(x, z) - d;
    if (inside < 5) return Math.max(-3.4, -(5 - inside) * 0.2);
    let h = Math.max(0, fbm2(x * 0.018 - 7.1, z * 0.018 + 2.6, 4) - 0.42) * 18 * sstep(24, 56, d) + fbm2(x * 0.08, z * 0.08, 2) * 1.0;
    const dv = Math.hypot(x - VOLC.x, z - VOLC.z);
    if (dv < VOLC.r) { // the cone: steep near the top, a crater inside the rim
        const k = 1 - dv / VOLC.r, rimH = VOLC.peak * Math.pow(1 - VOLC.rim / VOLC.r, 1.6);
        h = Math.max(h, VOLC.peak * Math.pow(k, 1.6) * (0.92 + fbm2(x * 0.05, z * 0.05, 2) * 0.16));
        if (dv < VOLC.rim + 2) h = lerp(rimH - 7, Math.max(h, rimH), sstep(VOLC.rim - 3, VOLC.rim + 1.5, dv)); // a flat crater floor inside a raised rim
    }
    h *= sstep(16, 30, d) * sstep(5, 28, inside);
    const ds = Math.hypot(x - SPRINGS.x, z - SPRINGS.z); h = lerp(h, -0.9, sstep(SPRINGS.r + 4, SPRINGS.r - 2, ds));
    const ld = lavaDist(x, z); if (dv > VOLC.rim) h -= 0.9 * sstep(LAVA_W + 2, LAVA_W - 0.5, ld); // the rivers cut little channels
    return h;
}
function groundY4(x, z) {
    if (Math.hypot(x - VOLC.x, z - VOLC.z) < VOLC.rim) for (const p of PILLARS4) if (Math.hypot(x - p.x, z - p.z) < p.r) return terrain4(x, z) + 0.8; // basalt pillars in the crater
    for (const [B, DIR, PERP, LEN] of DOCKS4) { const { along, side } = dockLocal(x, z, B, DIR, PERP); if (along > 4 && along < LEN + 3 && Math.abs(side) < 3) return 0; }
    return Math.max(-0.4, terrain4(x, z));
}
function clampIsle4(p) {
    for (const [B, DIR, PERP, LEN] of DOCKS4) {
        const { along, side } = dockLocal(p.x, p.z, B, DIR, PERP);
        if (along > 4.5 && along < LEN + 3 && Math.abs(side) < 6) { const a = Math.min(along, LEN - 0.7), s = clamp(side, -1.65, 1.65); p.x = B.x + DIR.x * a + PERP.x * s; p.z = B.z + DIR.z * a + PERP.z * s; return; }
    }
    const lim = shoreAt4(p.x, p.z) - 3, d = Math.hypot(p.x, p.z);
    if (d > lim) { p.x *= lim / d; p.z *= lim / d; }
    if (fight4.on) { const dx = p.x - VOLC.x, dz = p.z - VOLC.z, dd = Math.hypot(dx, dz), R = KARENA() - 0.6; if (dd > R) { p.x = VOLC.x + dx / dd * R; p.z = VOLC.z + dz / dd * R; } } // fire rings the crater
}
const treeOk4 = (x, z) => lavaDist(x, z) > LAVA_W + 3 && Math.hypot(x - VOLC.x, z - VOLC.z) > VOLC.rim + 6 && Math.hypot(x - SPRINGS.x, z - SPRINGS.z) > SPRINGS.r + 5 && Math.hypot(x - ARR4B.x, z - ARR4B.z) > 12 && Math.hypot(x - D4B.x, z - D4B.z) > 12;
const onLava = () => isle === 4 && !buffOn("fireproof") && player.onGround && lavaDist(player.pos.x, player.pos.z) < LAVA_W - 0.3 && Math.hypot(player.pos.x - VOLC.x, player.pos.z - VOLC.z) > VOLC.rim;
const inSprings = () => isle === 4 && Math.hypot(player.pos.x - SPRINGS.x, player.pos.z - SPRINGS.z) < SPRINGS.r;

const isle4G = new THREE.Group(); isle4G.visible = false; scene.add(isle4G);
const isle4 = { waterGeo: null, foam: null, emit: [], fireLight: null, lava: [], volcLight: null, boat: null, boat4: null, steam: [] };
let isle4Built = false, ferryman4 = null, mapBg4 = null;
const npcs4 = [];
// falling ash and drifting embers
const ash4 = (() => {
    const N = 480, p = new Float32Array(N * 3), col = new Float32Array(N * 3), c = new THREE.Color();
    for (let i = 0; i < N; i++) { p[i * 3] = rand(-40, 40); p[i * 3 + 1] = rand(0, 16); p[i * 3 + 2] = rand(-40, 40); c.setHex(i % 5 === 0 ? 0xff8a3a : i % 5 === 1 ? 0xffc060 : 0x8a8480); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.15, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
    pts.visible = false; pts.frustumCulled = false; scene.add(pts);
    return pts;
})();
function sky4(d) {
    ash4.material.opacity = 0.55 + (1 - d) * 0.4;
    wisps.material.color.setHex(0xffa060);
}
function updateSky4(dt) {
    const p = ash4.geometry.attributes.position, cx = player.pos.x, cz = player.pos.z, cy = groundY(cx, cz);
    for (let i = 0; i < p.count; i++) {
        const ember = i % 5 < 2;
        let x = p.getX(i) + Math.sin(time * 0.5 + i) * dt * 0.4 + dt * 0.6, y = p.getY(i) + dt * (ember ? 0.9 + (i % 7) * 0.1 : -(0.5 + (i % 4) * 0.15)), z = p.getZ(i) + Math.cos(time * 0.4 + i * 1.3) * dt * 0.4;
        if (x - cx > 40) x -= 80; else if (x - cx < -40) x += 80;
        if (z - cz > 40) z -= 80; else if (z - cz < -40) z += 80;
        if (y > cy + 18) y = cy - 1; else if (y < cy - 1) y = cy + 17;
        p.setXYZ(i, x, y, z);
    }
    p.needsUpdate = true;
}

function buildIsle4() {
    isle4Built = true;
    curBuild = 4;
    const prevAdd = addTgt; addTgt = isle4G;
    colliders.length = 0; circles.length = 0; occluders.length = 0; chests.length = 0; altar = null;

    // ----- the land: black sand, grey ash, red rock on the volcano -----
    {
        const g = new THREE.PlaneGeometry(420, 420, 220, 220);
        g.rotateX(-Math.PI / 2);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setY(i, terrain4(pos.getX(i), pos.getZ(i)));
        g.computeVertexNormals();
        const nor = g.attributes.normal, col = [], c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i), ny = nor.getY(i), d = Math.hypot(x, z), inside = shoreAt4(x, z) - d, rn = Math.random();
            const dv = Math.hypot(x - VOLC.x, z - VOLC.z), ld = lavaDist(x, z);
            if (y < -0.5 && Math.hypot(x - SPRINGS.x, z - SPRINGS.z) > SPRINGS.r + 2) c.setHSL(0.05, 0.15, 0.08 + rn * 0.03);
            else if (Math.hypot(x - SPRINGS.x, z - SPRINGS.z) < SPRINGS.r + 3) c.setHSL(0.12, 0.25, 0.42 + rn * 0.06);   // pale mineral crust round the springs
            else if (ld < LAVA_W + 1.4 && dv > VOLC.rim) c.setHSL(0.04, 0.5, 0.12 + rn * 0.04);                           // scorched banks
            else if (inside < 12 && y < 2.2) c.setHSL(0.08, 0.08, 0.1 + rn * 0.04);                                       // black sand
            else if (d < SAFE_R + 1) c.setHSL(0.06, 0.2, 0.2 + rn * 0.05);
            else if (dv < VOLC.rim + 1) c.setHSL(0.03, 0.55, 0.16 + rn * 0.06);                                           // the crater floor glows red
            else if (dv < VOLC.r * 0.7 || ny < 0.75) c.setHSL(0.02 + rn * 0.03, 0.32, 0.17 + rn * 0.06 + clamp(y / 60, 0, 1) * 0.08); // red-brown volcanic rock
            else { const v = sstep(0.4, 0.62, fbm2(x * 0.03 - 4, z * 0.03 + 9, 3)); c.setHSL(lerp(0.08, 0.2, v) + rn * 0.02, lerp(0.06, 0.28, v), 0.22 + rn * 0.06); } // ash fields with tough olive scrub
            col.push(c.r, c.g, c.b);
        }
        g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        scene.add(terrainMesh[4] = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
        const wg = new THREE.PlaneGeometry(760, 760, 152, 152);
        wg.rotateX(-Math.PI / 2);
        const wp = wg.attributes.position, wc = [], cc = new THREE.Color(), shallow = new THREE.Color(0x3a8a8a), mid = new THREE.Color(0x24506a), deep = new THREE.Color(0x101e30);
        for (let i = 0; i < wp.count; i++) { const x = wp.getX(i), z = wp.getZ(i), k = clamp((Math.hypot(x, z) - shoreAt4(x, z)) / 36, 0, 1); cc.copy(shallow).lerp(mid, clamp(k * 2, 0, 1)).lerp(deep, clamp(k * 2 - 1, 0, 1)); wc.push(cc.r, cc.g, cc.b); }
        wg.setAttribute("color", new THREE.Float32BufferAttribute(wc, 3));
        isle4.waterGeo = wg;
        const N = 300, fp = [], idx = [];
        for (let i = 0; i <= N; i++) { const th = (i / N) * Math.PI * 2, r = shoreR4(th); fp.push(Math.cos(th) * (r - 3.5), -0.4, Math.sin(th) * (r - 3.5), Math.cos(th) * (r - 2.2), -0.4, Math.sin(th) * (r - 2.2)); if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
        const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3)); fg.setIndex(idx);
        isle4.foam = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0xd8d0c8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
        scene.add(isle4.foam);
    }
    // ----- the lava rivers: glowing ribbons that hurt -----
    for (const pts of LAVA) {
        const p = [], cl = [], idx = [], c = new THREE.Color();
        for (let i = 0; i < pts.length; i++) {
            const [x, z] = pts[i], [nx, nz] = pts[Math.min(i + 1, pts.length - 1)], [px, pz] = pts[Math.max(i - 1, 0)], tx = nx - px, tz = nz - pz, tl = Math.hypot(tx, tz) || 1, sx = -tz / tl, sz = tx / tl;
            for (const sd of [-1, -0.4, 0.4, 1]) { const wx = x + sx * LAVA_W * sd, wz = z + sz * LAVA_W * sd; p.push(wx, Math.max(-0.35, terrain4(wx, wz) + 0.12), wz); c.setHex(Math.abs(sd) > 0.5 ? 0xd02a0a : 0xffa020); cl.push(c.r, c.g, c.b); }
            if (i < pts.length - 1) for (let k = 0; k < 3; k++) { const a = i * 4 + k; idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5); }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(cl, 3)); g.setIndex(idx); g.computeVertexNormals();
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
        scene.add(m); isle4.lava.push(m);
        // crusted rocks floating on the lava
        const crust = batch(lamb(0x2a1a14));
        for (let i = 2; i < pts.length; i += 2) { const [x, z] = pts[i]; crust.add(ICO, x + rand(-1, 1), terrain4(x, z) + 0.2, z + rand(-1, 1), srand(), srand() * 3, 0, rand(0.3, 0.7), 0.2, rand(0.3, 0.7)); }
        crust.build();
        for (let i = 3; i < pts.length; i += 5) { const [x, z] = pts[i]; isle4.emit.push({ x, y: terrain4(x, z) + 0.6, z, rate: 0.5, acc: srand() }); }
    }
    // ----- the volcano: a glowing crater, a smoke plume, a sign of what's to come -----
    {
        const y0 = terrain4(VOLC.x, VOLC.z);
        const pool = new THREE.Mesh(new THREE.CircleGeometry(3.2, 16), new THREE.MeshBasicMaterial({ color: 0xff6a1a })); pool.rotation.x = -Math.PI / 2; pool.position.set(VOLC.x, y0 + 0.4, VOLC.z); scene.add(pool); isle4.crater = pool;
        const vl = new THREE.PointLight(0xff5a1a, 30, 70, 1.4); vl.position.set(VOLC.x, y0 + 8, VOLC.z); scene.add(vl); isle4.volcLight = vl;
        for (let i = 0; i < 4; i++) isle4.emit.push({ x: VOLC.x + rand(-9, 9), y: y0 + 3, z: VOLC.z + rand(-9, 9), rate: 1.2, acc: srand(), big: true });
        const glow = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 7, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, side: THREE.DoubleSide })); glow.position.set(VOLC.x, y0 + 30, VOLC.z); scene.add(glow); isle4.plume = glow;
        const l = label("THE VOLCANO", "#ff6a3a", 3.8, 0.9); l.position.set(VOLC.x, y0 + 28, VOLC.z); l.maxD = 320; l.blurK = 0.4;
        buildCrater();
    }
    // ----- Ember Camp -----
    {
        const stones = batch(lamb(0x4a4040));
        for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.28; stones.add(ICO, Math.cos(a) * 1.3, 0.18, -3 + Math.sin(a) * 1.3, 0, 0, 0, 0.28, 0.22, 0.28); }
        stones.build();
        const lg = batch(woodDark); for (let i = 0; i < 4; i++) lg.add(CYL6, 0, 0.25, -3, Math.PI / 2, i * 0.8, 0, 0.12, 1.3, 0.12); lg.build();
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.7, 6), glowM(0xff8a2a)); flame.position.set(0, 1.05, -3);
        const core = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 5), glowM(0xffe070)); core.position.set(0, 0.72, -3);
        scene.add(flame, core); fires.push({ flame, core, ph: srand() * 6 });
        const fl = new THREE.PointLight(0xff9a40, 18, 18, 1.6); fl.position.set(0, 2, -3); scene.add(fl); isle4.fireLight = fl;
        circles.push({ x: 0, z: -3, r: 1.3 }); isle4.emit.push({ x: 0, y: 2.0, z: -3, rate: 1.0, acc: 0.3 });
        const seats = batch(lamb(0x3a3030)); for (const [dx, dz, r] of [[-2.6, -3.5, 0.2], [2.5, -2.4, -0.5], [0.4, -5.9, Math.PI / 2]]) seats.add(BOX, dx, 0.3, dz, 0, r, 0, 1.6, 0.6, 0.6); seats.build();
        const cl = label("EMBER CAMP", "#ffb060", 3.4, 0.8); cl.position.set(0, 4.6, -3); cl.maxD = 90;
        // the bed: a shelter of black stone
        const g = new THREE.Group(); g.position.set(BED4.x, groundY4(BED4.x, BED4.z), BED4.z); g.rotation.y = Math.atan2(-BED4.x, -BED4.z);
        part(g, BOX, lamb(0x2a2626), 0, 1.2, -1.3, 3.4, 2.4, 0.3); part(g, BOX, lamb(0x2a2626), -1.6, 1.2, -0.2, 0.3, 2.4, 2.4); part(g, BOX, lamb(0x2a2626), 1.6, 1.2, -0.2, 0.3, 2.4, 2.4);
        part(g, BOX, lamb(0x3a2a24), 0, 2.45, -0.2, 3.6, 0.2, 2.8);
        part(g, BOX, wood, 0, 0.35, -0.2, 1.4, 0.3, 2.3); part(g, BOX, lamb(0x8a2a1a), 0, 0.58, -0.55, 1.3, 0.14, 1.5); part(g, BOX, lamb(0xe8e0d0), 0, 0.58, 0.7, 1.0, 0.14, 0.5);
        scene.add(g); circles.push({ x: BED4.x, z: BED4.z, r: 1.6 });
        const bl = label("BED", "#ffc0a0", 2, 0.6); bl.position.set(BED4.x, 3.2, BED4.z);
    }
    {   // the Crucible (forge), the Trading Post, the alchemist
        const g = stall3(SMITH4, "THE CRUCIBLE", "CRAFT AXES · GUNS", "#ff8a3a", 0x3a2420);
        const smith = makeHumanoid({ face: "smith", skin: 0xb07a5a, shirt: 0x3a1a14, pants: 0x1a1414, apron: 0x2a1a14, beard: 0x1a1010, hat: "mask", wide: 1.3, belly: true });
        smith.g.position.set(0, 0, -0.6); g.add(smith.g); smith.yaw = g.rotation.y; npcs4.push(smith);
        const hm = new THREE.Group(); hm.position.set(0, -0.64, 0.05); smith.armR.add(hm);
        part(hm, BOX, lamb(0x6a4a2a), 0, 0, 0.22, 0.05, 0.05, 0.5); smith.hammer = part(hm, BOX, lamb(0x2a2a30), 0, 0, 0.48, 0.24, 0.13, 0.13);
        part(g, BOX, glowM(0xff7a2a), 0, 1.16, 0.5, 0.36, 0.06, 0.14);
        const furnace = new THREE.Group(); furnace.position.set(1.4, 0, -1.4); g.add(furnace);
        part(furnace, BOX, lamb(0x3a3434), 0, 0.6, 0, 1.0, 1.2, 0.8); part(furnace, BOX, glowM(0xff6a1a), 0, 0.55, 0.41, 0.5, 0.35, 0.02); part(furnace, CYL8, lamb(0x2a2626), 0, 1.6, -0.1, 0.18, 1.0, 0.18);
        isle4.emit.push({ x: SMITH4.x, y: 3.2, z: SMITH4.z - 1.2, rate: 0.7, acc: 0.5 });
        const l = label("THE CRUCIBLE", "#ff8a3a", 3.2, 0.8); l.position.set(SMITH4.x, 6.2, SMITH4.z);
        const g2 = stall3(DEPOT4, "TRADING POST", "SELL MATERIALS", "#ffd040", 0x4a3020);
        const clerk = makeHumanoid({ face: "clerk", skin: 0xe0b890, shirt: 0xd8c8b0, vest: 0x6a2a1a, pants: 0x3a2a20, hair: 0x2a1a10, hat: "cap", hatCol: 0x8a3a1a });
        clerk.g.position.set(0, 0, -0.6); g2.add(clerk.g); clerk.yaw = g2.rotation.y; npcs4.push(clerk);
        const l2 = label("TRADING POST", "#ffd040", 3.6, 0.8); l2.position.set(DEPOT4.x, 6.2, DEPOT4.z);
        const g3 = stall3(WITCH4, "ALCHEMIST", "BREWS · TONICS", "#7aff9a", 0x2a3a24);
        const witch = makeHumanoid({ face: "witch", skin: 0x8ac08a, shirt: 0x4a1a14, pants: 0x2a1a1a, hair: 0x1a1a1a, hat: "witch", hatCol: 0x3a1a14 });
        witch.g.position.set(0, 0, -0.6); g3.add(witch.g); witch.yaw = g3.rotation.y; npcs4.push(witch);
        const l3 = label("ALCHEMIST", "#7aff9a", 3.2, 0.8); l3.position.set(WITCH4.x, 6.2, WITCH4.z);
        // signposts out of camp
        const post = (to, name, col) => {
            const dir = Math.atan2(to.x, to.z), x = Math.sin(dir) * 22, z = Math.cos(dir) * 22, y = groundY4(x, z), far = Math.round(Math.hypot(to.x - x, to.z - z) - (to.r || 0));
            const p = new THREE.Mesh(CYL6, woodDark); p.scale.set(0.09, 2.4, 0.09); p.position.set(x, y + 1.2, z); scene.add(p);
            const out = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: signTex(name, `AHEAD ↑ ${far}m`, col) })); out.position.set(x, y + 2.6, z); out.rotation.y = dir + Math.PI; scene.add(out);
            const home = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: signTex("EMBER CAMP", "AHEAD ↑", "#ffb060") })); home.position.set(x, y + 2.6, z); home.rotation.y = dir; scene.add(home);
        };
        post({ x: VOLC.x, z: VOLC.z, r: VOLC.r * 0.4 }, "THE VOLCANO", "#ff6a3a");
        post(SPRINGS, "HOT SPRINGS", "#7ae8ff");
        post({ x: D4B.x, z: D4B.z }, "REBIRTH 4 FERRY", "#9fe8ff");
    }
    // ----- docks: arrivals, and the next ferry -----
    for (const [B, DIR, PERP, LEN, kind] of [[ARR4B, ARR4DIR, ARR4PERP, ARR4LEN, "arr"], [D4B, D4DIR, D4PERP, D4LEN, "next"]]) {
        const pt = (a, s = 0, y = 0) => V3(B.x + DIR.x * a + PERP.x * s, y, B.z + DIR.z * a + PERP.z * s), yaw = Math.atan2(DIR.x, DIR.z);
        const planks = batch(lamb(kind === "arr" ? 0x5a4a44 : 0x4a4a54));
        for (let i = 0; i < LEN; i++) { const p = pt(i + 0.5); planks.add(BOX, p.x, 0.22, p.z, 0, yaw, 0, 3.6, 0.14, 0.92); }
        planks.build();
        const posts = batch(woodDark), rails = batch(woodDark), bulbs = batch(glowM(kind === "arr" ? 0xffa050 : 0x9fe8ff));
        for (let i = 0; i <= LEN; i += 3) for (const sd of [-1.9, 1.9]) { const p = pt(i, sd); posts.add(CYL6, p.x, -0.9, p.z, 0, 0, 0, 0.12, 4.2, 0.12); if (i % 6 === 0) bulbs.add(ICO, p.x, 1.45, p.z, 0, 0, 0, 0.16); }
        for (let i = 0; i < LEN; i++) for (const sd of [-1.9, 1.9]) { const p = pt(i + 0.5, sd, 0.95); rails.add(BOX, p.x, 0.95, p.z, 0, yaw, 0, 0.08, 0.1, 1.02); }
        posts.build(); rails.build(); bulbs.build();
        for (const sd of [-2.0, 2.0]) { const p = pt(3.5, sd); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.6, 6), woodDark); m.position.set(p.x, 1.8, p.z); scene.add(m); }
        const [a1, a2, c1] = kind === "arr" ? ["ARRIVALS", "FROM MOONCAP ISLE", "#ffa050"] : ["REBIRTH 4", "THE ARCHIPELAGO", "#9fe8ff"];
        const s1 = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex(kind === "arr" ? "WELCOME TO" : a1, kind === "arr" ? "ASHFALL ISLE" : a2, c1) })); s1.position.copy(pt(3.5, 0, 3.3)); s1.rotation.y = kind === "arr" ? yaw : yaw + Math.PI; scene.add(s1);
        const s2 = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex(kind === "arr" ? a1 : "EMBER CAMP", kind === "arr" ? a2 : "THIS WAY ↑", c1) })); s2.position.copy(pt(3.5, 0, 3.3)); s2.rotation.y = kind === "arr" ? yaw + Math.PI : yaw; scene.add(s2);
        const dl = label(kind === "arr" ? "ARRIVALS" : "REBIRTH 4 FERRY", c1, 3.2, 0.7); dl.position.copy(pt(3.5, 0, 4.6)); dl.maxD = 80;
        const boat = makeBoat3(kind === "arr" ? 0x1a2a3a : 0x2a1a1a, kind === "arr" ? 0x4a7a9a : 0x7a3a2a, kind === "arr" ? 0x9fe8ff : 0xffa050);
        boat.position.copy(pt(LEN - 7, 4.4, -0.15)); boat.rotation.y = yaw; scene.add(boat);
        if (kind === "arr") isle4.boat = boat; else isle4.boat4 = boat;
        // lanterns from the dock to camp
        const lp = batch(woodDark), lg = batch(glowM(0xffb060)), land = Math.hypot(B.x, B.z);
        for (let s = 4, k = 0; s < land - 26; s += 9, k++) { const sd = k % 2 ? 3.2 : -3.2, x = B.x - DIR.x * s + PERP.x * sd, z = B.z - DIR.z * s + PERP.z * sd, y = groundY4(x, z); if (lavaDist(x, z) < LAVA_W + 1) continue; lp.add(CYL6, x, y + 1.2, z, 0, 0, 0, 0.07, 2.4, 0.07); lg.add(ICO, x, y + 2.5, z, 0, 0, 0, 0.18, 0.24, 0.18); }
        lp.build(); lg.build();
    }
    {
        const yaw = Math.atan2(D4DIR.x, D4DIR.z);
        ferryman4 = makeFerrymanFigure(0x22163a, 0x6a4a9a, 0xe8d8ff); ferryman4.position.set(FERRYMAN4.x, 0.3, FERRYMAN4.z); ferryman4.rotation.y = yaw + Math.PI; scene.add(ferryman4);
        const fm = label("FERRYMAN", "#c8a0ff", 2.6, 0.6); fm.position.set(FERRYMAN4.x, 4.7, FERRYMAN4.z); fm.maxD = 60;
        const FI = dock4Pt(D4LEN + 240);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 220, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.1, fog: false, depthWrite: false, side: THREE.DoubleSide })); beam.position.set(FI.x, 110, FI.z); scene.add(beam); isle4.beam = beam;
        const bl = label("THE ARCHIPELAGO", "#9fe8ff", 4.2, 1.0); bl.position.set(FI.x, 46, FI.z); bl.maxD = 420; bl.blurK = 0.25;
    }
    // ----- landmarks -----
    {   // hot springs: steaming turquoise pools that heal you
        const w = new THREE.Mesh(new THREE.CircleGeometry(SPRINGS.r + 1, 24), wtr(new THREE.MeshLambertMaterial({ color: 0x5ad8e8, emissive: 0x1a6a7a, transparent: true, opacity: 0.85, flatShading: true })));
        w.rotation.x = -Math.PI / 2; w.position.set(SPRINGS.x, -0.25, SPRINGS.z); scene.add(w);
        const rim = batch(lamb(0xd8c8a8)); for (let i = 0; i < 22; i++) { const a = (i / 22) * 6.283, x = SPRINGS.x + Math.cos(a) * (SPRINGS.r + 1.4), z = SPRINGS.z + Math.sin(a) * (SPRINGS.r + 1.4); rim.add(ICO, x, terrain4(x, z) + 0.2, z, srand(), srand() * 3, 0, rand(0.5, 1), 0.4, rand(0.5, 1)); } rim.build();
        for (let i = 0; i < 4; i++) isle4.emit.push({ x: SPRINGS.x + rand(-4, 4), y: 0.2, z: SPRINGS.z + rand(-4, 4), rate: 1.2, acc: srand(), steam: true });
        const l = label("HOT SPRINGS", "#7ae8ff", 3.2, 0.8); l.position.set(SPRINGS.x, 4, SPRINGS.z);
        const l2 = label("stand in the water to heal", "#bff4ff", 2.4, 0.5); l2.position.set(SPRINGS.x, 2.8, SPRINGS.z); l2.maxD = 40;
    }
    {   // obsidian spires: black glass shards taller than trees
        const ob = batch(new THREE.MeshLambertMaterial({ color: 0x1a1222, emissive: 0x0a0414, flatShading: true })), gl = batch(glowM(0xb07aff));
        for (let i = 0; i < 24; i++) { const a = srand() * 6.283, d = Math.sqrt(srand()) * SPIRES.r, x = SPIRES.x + Math.cos(a) * d, z = SPIRES.z + Math.sin(a) * d, h = rand(3, 12), y = terrain4(x, z); ob.add(CONE6, x, y + h / 2, z, rand(-0.25, 0.25), srand() * 3, rand(-0.25, 0.25), h * 0.13, h, h * 0.13); if (i % 3 === 0) gl.add(ICO, x, y + 0.3, z, 0, 0, 0, 0.18); if (h > 6) circles.push({ x, z, r: h * 0.12 }); }
        ob.build(); gl.build();
        const c = makeChest(SPIRES.x + 3, SPIRES.z - 2, srand() * 6, true); const cy = terrain4(SPIRES.x + 3, SPIRES.z - 2); c.g.position.y = cy; c.beacon.position.y = cy + 2.7;
        const l = label("OBSIDIAN SPIRES", "#c8a0ff", 3.2, 0.8); l.position.set(SPIRES.x, terrain4(SPIRES.x, SPIRES.z) + 14, SPIRES.z);
    }
    {   // basalt columns: hexagonal pillars stepping up like stairs
        const bs = batch(lamb(0x3a3636)), top = batch(lamb(0x4a4646)), hex = new THREE.CylinderGeometry(1, 1, 1, 6);
        for (let i = 0; i < 70; i++) { const a = srand() * 6.283, d = Math.sqrt(srand()) * BASALT.r, x = BASALT.x + Math.cos(a) * d, z = BASALT.z + Math.sin(a) * d, h = (1 - d / BASALT.r) * 7 + rand(0.4, 1.6), y = terrain4(x, z); bs.add(hex, x, y + h / 2, z, 0, 0, 0, 0.85, h, 0.85); top.add(hex, x, y + h + 0.03, z, 0, 0, 0, 0.8, 0.06, 0.8); }
        bs.build(); top.build();
        const l = label("BASALT COLUMNS", "#c0b8b0", 3.2, 0.8); l.position.set(BASALT.x, terrain4(BASALT.x, BASALT.z) + 11, BASALT.z);
    }
    {   // the Ashwood: a forest of burnt, dead trunks
        const tr = batch(lamb(0x1e1816)), em = batch(glowM(0xff6a2a));
        for (let i = 0; i < 40; i++) { const a = srand() * 6.283, d = Math.sqrt(srand()) * ASHWOOD4.r, x = ASHWOOD4.x + Math.cos(a) * d, z = ASHWOOD4.z + Math.sin(a) * d, h = rand(3, 9), y = terrain4(x, z); tr.add(CYL6, x, y + h / 2, z, rand(-0.12, 0.12), 0, rand(-0.12, 0.12), rand(0.18, 0.35), h, rand(0.18, 0.35)); for (let k = 0; k < 2; k++) tr.add(CYL6, x, y + h * rand(0.5, 0.9), z, 0, srand() * 3, rand(0.6, 1.2), 0.08, rand(1, 2.4), 0.08); if (i % 2) em.add(ICO, x, y + rand(0.5, h), z, 0, 0, 0, 0.08); circles.push({ x, z, r: 0.4 }); }
        tr.build(); em.build();
        const c = makeChest(ASHWOOD4.x - 3, ASHWOOD4.z + 2, srand() * 6, false); const cy = terrain4(ASHWOOD4.x - 3, ASHWOOD4.z + 2); c.g.position.y = cy; c.beacon.position.y = cy + 2.7;
        const l = label("THE ASHWOOD", "#d0c0b0", 3.2, 0.8); l.position.set(ASHWOOD4.x, terrain4(ASHWOOD4.x, ASHWOOD4.z) + 9, ASHWOOD4.z);
    }
    // ----- scenery: rocks, scrub, steam vents, charred logs, the black beach -----
    const okSpot4 = (x, z, m = 0) => { const d = Math.hypot(x, z); if (d < SAFE_R + 1 || d > shoreAt4(x, z) - 9 || !treeOk4(x, z)) return false; for (let k = 1; k < LM4.length; k++) { const lm = LM4[k]; if (Math.hypot(x - lm.x, z - lm.z) < lm.r + m) return false; } return true; };
    const scatter4 = (count, fn, m = 0) => { let made = 0, guard = 0; while (made < count && guard++ < count * 40) { const a = srand() * 6.283, d = srange(SAFE_R + 1, shoreR4(a) - 9), x = Math.cos(a) * d, z = Math.sin(a) * d; if (!okSpot4(x, z, m)) continue; fn(x, z, terrain4(x, z)); made++; } };
    {
        const rocks = batch(lamb(0x3a3434)), bigR = batch(lamb(0x2a2424)), scrub = batch(lamb(0x5a5a2a)), dry = batch(lamb(0x7a6a3a)), vents = batch(lamb(0x4a3a30)), emb = batch(glowM(0xff7a2a));
        scatter4(120, (x, z, y) => { const s = srange(0.4, 1.5); rocks.add(ICO, x, y + s * 0.4, z, srand() * 3, srand() * 3, 0, s, s * srange(0.6, 1), s); if (s > 1.15) circles.push({ x, z, r: s * 0.85 }); });
        scatter4(22, (x, z, y) => { const s = srange(2.2, 4.2); bigR.add(ICO, x, y + s * 0.35, z, srand() * 3, srand() * 3, 0, s, s * srange(0.6, 0.9), s * srange(0.8, 1.2)); circles.push({ x, z, r: s * 0.85 }); }, 3);
        scatter4(150, (x, z, y) => { for (let i = 0; i < 4; i++) (srand() < 0.5 ? scrub : dry).add(CONE6, x + srange(-0.4, 0.4), y + 0.25, z + srange(-0.4, 0.4), srange(-0.3, 0.3), 0, srange(-0.3, 0.3), 0.05, srange(0.3, 0.7), 0.05); });
        scatter4(14, (x, z, y) => { vents.add(CYL6, x, y + 0.25, z, 0, 0, 0, 0.6, 0.5, 0.6); emb.add(CYL6, x, y + 0.51, z, 0, 0, 0, 0.35, 0.02, 0.35); isle4.emit.push({ x, y: y + 0.6, z, rate: 0.9, acc: srand(), steam: true }); circles.push({ x, z, r: 0.7 }); }, 2);
        scatter4(70, (x, z, y) => emb.add(ICO, x, y + 0.08, z, 0, 0, 0, 0.12, 0.06, 0.12));
        rocks.build(); bigR.build(); scrub.build(); dry.build(); vents.build(); emb.build();
        const logsB = batch(lamb(0x1e1816)); scatter4(24, (x, z, y) => logsB.add(CYL6, x, y + 0.3, z, Math.PI / 2, srand() * 3, 0, 0.3, srange(2.2, 4.2), 0.3)); logsB.build();
        const beachSpot = (n, min, max, fn) => { for (let i = 0; i < n; i++) { const a = srand() * 6.283, d = shoreR4(a) - srange(min, max), x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.hypot(x - ARR4B.x, z - ARR4B.z) < 12 || Math.hypot(x - D4B.x, z - D4B.z) < 12 || lavaDist(x, z) < LAVA_W + 2) continue; fn(x, z, Math.max(0, terrain4(x, z))); } };
        const pum = batch(lamb(0x6a6460)), glass = batch(glowM(0x7a5aaa));
        beachSpot(70, 2, 12, (x, z, y) => pum.add(ICO, x, y + 0.1, z, srand(), srand() * 3, 0, 0.25, 0.15, 0.25));
        beachSpot(40, 2, 10, (x, z, y) => glass.add(CONE6, x, y + 0.12, z, srand(), 0, srand(), 0.06, 0.25, 0.06));
        pum.build(); glass.build();
    }
    for (let i = 0; i < 9; i++) { let guard = 0; while (guard++ < 60) { const a = srand() * 6.283, d = srange(36, 115), x = Math.cos(a) * d, z = Math.sin(a) * d; if (d > shoreAt4(x, z) - 12 || !okSpot4(x, z, 2)) continue; const c = makeChest(x, z, srand() * 6, i % 4 === 0); const y = terrain4(x, z); c.g.position.y = y; c.beacon.position.y = y + 2.7; break; } }
    isle4.emit.forEach(e => smokeEmit.push(e));
    addTgt = prevAdd; curBuild = 1;
}

// ---- getting there: Mooncap's Rebirth 3 ferry ----
const REBIRTH3_COST = 2500000, REBIRTH3_HEART = 5;
const rebirth3Ready = () => (save.bossKills || 0) > 0 && (save.mats.heartwood || 0) >= REBIRTH3_HEART && save.money >= REBIRTH3_COST;
function finishRebirth3() {
    save.rebirths = 3; // Ashfall Isle is Rebirth 3
    resetForRebirth();
    enterIsle4(); newContract();
    holdingReset();
    player.maxHp = maxHpNow(); player.hp = player.maxHp;
    const a = arr4Pt(ARR4LEN - 9, 0);
    player.pos.set(a.x, 1.75, a.z); player.vel.set(0, 0, 0); player.yaw = Math.atan2(ARR4DIR.x, ARR4DIR.z); player.pitch = 0;
    player.invuln = 6;
    ride = null;
    writeSave();
    say("");
    setTimeout(() => {
        $("rebirthFx").classList.remove("show"); say("ASHFALL ISLE"); setTimeout(() => say(""), 3600);
        toast("You are reborn. ★3  +150% cash, +30% damage, +150 max HP.", "cash");
        toast("Follow the lanterns to Ember Camp. Craft at the Crucible, brew at the Alchemist.", "good");
        toast("Stay out of the lava. It's exactly as hot as it looks.", "bad");
    }, 2200);
}
function enterIsle4() {
    leaveWorld();
    if (!isle4Built) { buildIsle4(); snapWorld(4); } else loadWorld(4);
    if (casinos[4]) casino = casinos[4];
    isle = 4; save.isle = 4;
    showWorld(4);
    groundFn = groundY4;
    waterMesh.geometry = isle4.waterGeo; waterMesh.material.needsUpdate = true;
    smokeEmit.length = 0; isle4.emit.forEach(e => smokeEmit.push(e));
    RESPAWN.x = 2; RESPAWN.z = 4;
    syncGhosts();
    resetIsleTrees(100);
    resetChests();
    syncKing();
}
function dawn4() { if (save.kingKills > 0 && save.kingDay === save.day - 1 && !fight4.on) toast("Deep in the crater, the Cinder King rekindles...", "rare"); syncKing(); }
let lavaT = 0, rumbleT = 6;
function updateIsle4(dt, animOnly) {
    if (!isle4Built || isle !== 4) return;
    updateSky4(dt);
    updateKing(dt, animOnly);
    if (!animOnly) updateEruption(dt);
    updateNpcs(dt, npcs4);
    if (isle4.foam) { isle4.foam.material.opacity = 0.32 + Math.sin(time * 0.8) * 0.12; }
    if (isle4.fireLight) isle4.fireLight.intensity = 16 + Math.sin(time * 13) * 3 + Math.sin(time * 7.3) * 2;
    if (isle4.volcLight) isle4.volcLight.intensity = 26 + Math.sin(time * 2.1) * 6 + Math.sin(time * 5.7) * 3;
    if (isle4.plume) isle4.plume.material.opacity = 0.04 + Math.sin(time * 0.9) * 0.015;
    if (isle4.beam) isle4.beam.material.opacity = 0.07 + Math.sin(time * 1.2) * 0.03;
    if (isle4.crater) isle4.crater.material.color.setHSL(0.05 + Math.sin(time * 1.7) * 0.015, 1, 0.5 + Math.sin(time * 3.1) * 0.06);
    for (const m of isle4.lava) m.material.color.setScalar(0.85 + Math.sin(time * 2.4 + m.id) * 0.15);
    for (const [b, ph] of [[isle4.boat, 0], [isle4.boat4, 1.3]]) if (b) { b.position.y = -0.15 + Math.sin(time * 1.1 + ph) * 0.07; b.rotation.z = Math.sin(time * 0.9 + ph) * 0.03; }
    if (ferryman4) {
        ferryman4.position.y = 0.3 + Math.sin(time * 1.2) * 0.02;
        const base = Math.atan2(D4DIR.x, D4DIR.z) + Math.PI, near = Math.hypot(player.pos.x - FERRYMAN4.x, player.pos.z - FERRYMAN4.z) < 14;
        ferryman4.rotation.y += angDiff(near ? Math.atan2(player.pos.x - FERRYMAN4.x, player.pos.z - FERRYMAN4.z) : base, ferryman4.rotation.y) * Math.min(1, 3 * dt);
    }
    if (animOnly || state !== "playing") return;
    // lava burns, hot springs heal
    if (onLava() && !ride) {
        lavaT -= dt;
        hurtEl.style.opacity = Math.max(+hurtEl.style.opacity || 0, 0.6);
        if (lavaT <= 0) { lavaT = 0.35; hurtPlayer(Math.round(14 * isleDm()), player.pos.x, player.pos.z); sfx(180 + Math.random() * 60, 0.2, "sawtooth", 0.08, 0.4); burst(V3(player.pos.x, player.pos.y - 1.5, player.pos.z), 4, 3, [glowM(0xff7a2a), glowM(0xffd060)]); }
    } else lavaT = 0;
    if (inSprings() && player.hp > 0 && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 10 * dt);
    // the volcano grumbles now and then
    rumbleT -= dt;
    if (rumbleT <= 0) { rumbleT = rand(14, 30); const dv = Math.hypot(player.pos.x - VOLC.x, player.pos.z - VOLC.z), k = clamp(1 - dv / 200, 0.15, 1); sfx(40, 2.2, "sawtooth", 0.1 * k, 0.6); sfx(55, 1.8, "sine", 0.16 * k, 0.7); shake = Math.max(shake, 0.25 * k); }
}
function nearest4() {
    const px = player.pos.x, pz = player.pos.z, near = (p, r) => Math.hypot(px - p.x, pz - p.z) < r;
    if (near(SMITH4_AT, 3.4)) return { k: "smith" };
    if (near(DEPOT4_AT, 3.4)) return { k: "depot" };
    if (near(WITCH4_AT, 3.4)) return { k: "witch" };
    if (near(BED4, 3.2)) return { k: "bed" };
    if (near(FERRYMAN4, 3.4)) return { k: "ferry4" };
    for (const c of chests) if (!c.opened && Math.hypot(px - c.x, pz - c.z) < 2.6) return { k: "chest", c };
    return null;
}
const SMITH4_SAY = ["Obsidian takes an edge you could shave a mountain with.", "Ember burns inside the blade forever. Don't lick it.", "Sulfur makes the rounds go bang. Bigger bang.", "Everything here is forged in the volcano's breath."];
const DEPOT4_SAY = ["Ash by the barrel, feathers by the one. I buy it all.", "Phoenix Feathers? Careful, they're still warm.", "Obsidian sells. Sells sharp."];
function openFerry4() { ferryConfirm = 0; $("ferrySay").textContent = "“She's built from something that won't burn. Bring me the King's cores and I'll take you past the smoke.”"; openPanel("ferry"); }
function renderFerry4() {
    document.querySelector("#panelFerry h2").textContent = "THE FERRYMAN";
    const html = `<div class="fprice">Rebirths so far: <b>★${save.rebirths || 0}</b> <span>(+${(save.rebirths || 0) * 50}% cash, +${(save.rebirths || 0) * 10}% damage, +${(save.rebirths || 0) * 50} max HP)</span></div>
      <div class="flist"><div class="gain"><h4>REBIRTH 4</h4>The Ferryman is building a boat that can cross whatever is out there. Coming in a future update.</div></div>`;
    if ($("ferryBody").dataset.h !== html) { $("ferryBody").innerHTML = html; $("ferryBody").dataset.h = html; }
    const b = $("ferryBuy"); b.disabled = true; b.classList.remove("danger"); b.textContent = "REBIRTH 4: COMING SOON";
}
function drawMap4() {
    const cv = $("mapc"), g = cv.getContext("2d"), S = cv.width, c = S / 2, sc = (S / 2 - 14) / 168;
    if (!mapBg4) {
        const N = 320, oc = document.createElement("canvas"); oc.width = oc.height = N;
        const og = oc.getContext("2d"), img = og.createImageData(N, N), col = new THREE.Color();
        for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
            const x = ((px + 0.5) / N - 0.5) * 336, z = ((py + 0.5) / N - 0.5) * 336, d = Math.hypot(x, z), inside = shoreAt4(x, z) - d, i = (py * N + px) * 4;
            let r, gg, b;
            if (inside < 0) { r = 12; gg = 24; b = 40; } else if (inside < 5) { r = 60; gg = 110; b = 120; }
            else {
                const y = terrain4(x, z), sh = clamp((terrain4(x - 2, z - 2) - terrain4(x + 2, z + 2)) * 0.05, -0.5, 0.5), dv = Math.hypot(x - VOLC.x, z - VOLC.z);
                if (lavaDist(x, z) < LAVA_W && dv > VOLC.rim) col.setRGB(1, 0.42, 0.1);
                else if (dv < VOLC.rim - 3) col.setRGB(1, 0.35, 0.05);
                else if (Math.hypot(x - SPRINGS.x, z - SPRINGS.z) < SPRINGS.r) col.setRGB(0.35, 0.85, 0.9);
                else if (inside < 12 && y < 2.2) col.setRGB(0.12, 0.11, 0.11);
                else if (dv < VOLC.r * 0.7) col.setRGB(0.35 + clamp(y / 60, 0, 1) * 0.2, 0.18, 0.14);
                else col.setRGB(0.3, 0.28, 0.24);
                r = clamp((col.r + sh) * 255, 0, 255); gg = clamp((col.g + sh) * 255, 0, 255); b = clamp((col.b + sh) * 255, 0, 255);
            }
            img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
        og.putImageData(img, 0, 0); mapBg4 = oc;
    }
    g.clearRect(0, 0, S, S);
    g.fillStyle = "#0c1828"; g.beginPath(); g.arc(c, c, c - 6, 0, 7); g.fill(); g.strokeStyle = "rgba(255,140,60,.45)"; g.lineWidth = 3; g.stroke();
    g.save(); g.beginPath(); g.arc(c, c, c - 8, 0, 7); g.clip(); g.imageSmoothingEnabled = false; g.drawImage(mapBg4, c - 168 * sc, c - 168 * sc, 336 * sc, 336 * sc); g.restore();
    g.fillStyle = "rgba(255,170,60,.12)"; g.beginPath(); g.arc(c, c, SAFE_R * sc, 0, 7); g.fill();
    g.setLineDash([6, 6]); g.strokeStyle = "rgba(255,180,90,.85)"; g.lineWidth = 2; g.beginPath(); g.arc(c, c, SAFE_R * sc, 0, 7); g.stroke(); g.setLineDash([]);
    const X = x => c + x * sc, Z = z => c + z * sc;
    g.font = "bold 11px Consolas"; g.textAlign = "center";
    for (const lm of LM4) { if (lm.camp) continue; g.strokeStyle = lm.col; g.lineWidth = 1.5; g.beginPath(); g.arc(X(lm.x), Z(lm.z), lm.r * sc * 0.7, 0, 7); g.stroke(); g.lineWidth = 3; g.strokeStyle = "#000"; g.strokeText(lm.name, X(lm.x), Z(lm.z) - lm.r * sc * 0.7 - 4); g.fillStyle = lm.col; g.fillText(lm.name, X(lm.x), Z(lm.z) - lm.r * sc * 0.7 - 4); }
    for (const [B, DIR, , LEN, txt, colr] of [[ARR4B, ARR4DIR, 0, ARR4LEN, "ARRIVALS", "#ffa050"], [D4B, D4DIR, 0, D4LEN, "REBIRTH 4 FERRY", "#9fe8ff"]]) { const e = V3(B.x + DIR.x * LEN, 0, B.z + DIR.z * LEN); g.strokeStyle = colr; g.lineWidth = 4; g.beginPath(); g.moveTo(X(B.x), Z(B.z)); g.lineTo(X(e.x), Z(e.z)); g.stroke(); g.fillStyle = colr; g.font = "bold 12px Consolas"; g.fillText(txt, X(e.x), Z(e.z) + (e.z < 0 ? -8 : 16)); }
    { const dead = save.kingDay === save.day && save.kingKills > 0; g.font = "bold 22px Segoe UI Emoji, sans-serif"; g.fillStyle = "#ff7a3a"; g.fillText(dead ? "🪨" : "👑", X(VOLC.x), Z(VOLC.z) + 8); g.font = "bold 10px Consolas"; g.strokeStyle = "#000"; g.lineWidth = 3; const tx = dead ? "regrows at dawn" : "THE CINDER KING"; g.strokeText(tx, X(VOLC.x), Z(VOLC.z) + 24); g.fillStyle = "#ffc090"; g.fillText(tx, X(VOLC.x), Z(VOLC.z) + 24); }
    for (const ch of chests) if (!ch.opened) { g.fillStyle = ch.special ? "#c8a0ff" : "#ffd040"; g.fillRect(X(ch.x) - 4, Z(ch.z) - 4, 8, 8); g.strokeStyle = "#000"; g.lineWidth = 1; g.strokeRect(X(ch.x) - 4, Z(ch.z) - 4, 8, 8); }
    for (const t of trees) { if (t.gone || t.dying || t.boss) continue; const near = Math.hypot(t.x - player.pos.x, t.z - player.pos.z) < 14; g.fillStyle = near ? "#ff4a3a" : t.mut ? mutCol(t.mut) : t.type.rare ? t.type.col : "rgba(30,20,16,.95)"; g.beginPath(); g.arc(X(t.x), Z(t.z), (t.mut ? 3.5 : t.type.rare ? 2.5 : 1.5) + t.h * 0.2, 0, 7); g.fill(); }
    g.font = "bold 12px Consolas"; g.fillStyle = "#ffc890"; g.strokeStyle = "#000"; g.lineWidth = 3;
    for (const [t, x, z] of [["CAMP", 0, 9], ["CRUCIBLE", SMITH4.x - 8, SMITH4.z - 1], ["TRADING", DEPOT4.x + 9, DEPOT4.z - 1], ["ALCHEMIST", WITCH4.x + 6, WITCH4.z + 4]]) { g.strokeText(t, X(x), Z(z)); g.fillText(t, X(x), Z(z)); }
    g.fillStyle = "#fff"; g.fillText("N", c, 22);
    g.save(); g.translate(X(player.pos.x), Z(player.pos.z)); g.rotate(-player.yaw); g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore();
}

// =====================================================================
//  Ashfall Isle part 2: the Cinder King (crater boss), eruptions, lava bombs
// =====================================================================
const KING_H = 16, KING_R = 2.8, KARENA = () => VOLC.rim - 2.5; // the crater floor you can fight on
const KING_T = { name: "The Cinder King", col: "#ff7a3a", hp: 1, logs: 0, dmg: 1, speed: 0, bonus: 0, rare: true, wd: 0, wn: 0 };
HIT_COL.cinderking = [0xff7a2a, 0x1a1214];
const PILLARS4 = [0, 1, 2, 3, 4].map(i => { const a = (i / 5) * Math.PI * 2 + 0.3; return { x: VOLC.x + Math.cos(a) * 8.2, z: VOLC.z + Math.sin(a) * 8.2, r: 1.25 }; });
const crater = () => isle === 4 && Math.hypot(player.pos.x - VOLC.x, player.pos.z - VOLC.z) < VOLC.rim - 1;
const fight4 = { on: false, phase: 1, cd: 3, atk: null, atkT: 0, beat: 0, lag: 1, minions: [], hitWave: new Set(), dyingT: -1, heart: 0, flood: 0, floodT: 0, seen: false, wall: 0 };
let king = null, kingG = null, kingLabel = null, kingLight = null, kingFlames = [], kingCore = null, kingFireRing = null, kingStump = null, kingLava = null;
const kfx = { rings: [], cols: [], rocks: [], waves: [] };
const kingMaxHp = () => Math.ceil(160 * hpScale() * (1 + 0.25 * (save.kingKills || 0)));
const kingDmg = (k = 1) => Math.round(30 * isleDm() * (1 + 0.04 * (save.day - 1)) * k * (buffOn("fireproof") ? 0.5 : 1));
const floorY4 = () => terrain4(VOLC.x, VOLC.z);
function buildCrater() {
    const y0 = floorY4();
    // basalt pillars to escape the lava flood on
    const hex = new THREE.CylinderGeometry(1, 1, 1, 6), pm = lamb(0x2a2626), pt = lamb(0x3a3434);
    for (const p of PILLARS4) { part(scene, hex, pm, p.x, y0 + 0.4, p.z, p.r, 0.8, p.r); part(scene, hex, pt, p.x, y0 + 0.82, p.z, p.r * 0.95, 0.04, p.r * 0.95); }
    // the lava that floods the crater floor
    kingLava = new THREE.Mesh(new THREE.CircleGeometry(KARENA() + 1.2, 32), new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.92 }));
    kingLava.rotation.x = -Math.PI / 2; kingLava.position.set(VOLC.x, y0 - 0.3, VOLC.z); kingLava.visible = false; scene.add(kingLava);
    // a ring of fire round the rim while the fight is on
    kingFireRing = new THREE.Group(); kingFireRing.position.set(VOLC.x, y0, VOLC.z); kingFireRing.visible = false; scene.add(kingFireRing);
    for (let i = 0; i < 30; i++) { const a = (i / 30) * Math.PI * 2, f = part(kingFireRing, CONE6, glowM(i % 2 ? 0xff7a1a : 0xffc040), Math.cos(a) * (KARENA() + 0.8), 1.2, Math.sin(a) * (KARENA() + 0.8), 0.5, 2.4, 0.5); f.userData.ph = i; }
    // the Cinder King: an obsidian tree, cracked with lava, crowned with fire
    kingG = new THREE.Group(); kingG.position.set(VOLC.x, y0 - 0.1, VOLC.z); scene.add(kingG);
    const body = new THREE.Group(); kingG.add(body);
    const obs = new THREE.MeshLambertMaterial({ color: 0x1a1216, emissive: 0x100406, flatShading: true });
    const tg = new THREE.CylinderGeometry(KING_R * 0.6, KING_R * 1.3, KING_H, 10, 6);
    { const p = tg.attributes.position; for (let i = 0; i < p.count; i++) { const u = p.getY(i) / KING_H + 0.5, k = 1 + 0.12 * Math.sin(u * 11 + p.getX(i) * 3); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } tg.computeVertexNormals(); }
    const trunk = new THREE.Mesh(tg, obs); trunk.position.y = KING_H / 2; body.add(trunk);
    const cracks = new THREE.MeshBasicMaterial({ color: 0xff6a1a });
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, y = rand(1, KING_H * 0.85), rr = KING_R * (1.3 - 0.7 * (y / KING_H)) * 0.98; const c = part(body, BOX, cracks, Math.cos(a) * rr, y, Math.sin(a) * rr, 0.12, rand(1, 3), 0.05); c.rotation.y = -a + Math.PI / 2; c.rotation.z = rand(-0.5, 0.5); }
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; part(body, CONE6, obs, Math.cos(a) * KING_R * 1.4, KING_R * 0.4, Math.sin(a) * KING_R * 1.4, KING_R * 0.4, KING_R * 2.4, KING_R * 0.4, 0, -a, Math.PI / 2 + 0.5); }
    const crown = new THREE.Group(); crown.position.y = KING_H; body.add(crown);
    let crownMesh = null;
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, s = part(crown, CONE6, obs, Math.cos(a) * 2.2, 1.6, Math.sin(a) * 2.2, 0.7, rand(3, 5), 0.7, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); if (!crownMesh) crownMesh = s; }
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, f = part(crown, CONE6, glowM(i % 3 ? 0xff7a1a : 0xffd040), Math.cos(a) * rand(0.8, 2.6), rand(1.5, 3.5), Math.sin(a) * rand(0.8, 2.6), 0.5, 2.2, 0.5); f.userData.ph = i * 0.7; kingFlames.push(f); }
    kingCore = part(body, new THREE.IcosahedronGeometry(1, 1), glowM(0xffa020), 0, 5.2, KING_R * 1.0, 0.8, 0.95, 0.6);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), faceMats.calm); face.scale.setScalar(4.6); face.position.set(0, 9.6, KING_R * 0.92 + 0.1); body.add(face);
    const arms = [], aGeo = armGeometry(7);
    for (const s of [-1, 1]) { const pivot = new THREE.Group(); pivot.position.set(s * KING_R * 0.8, 11.5, 0.3); const arm = new THREE.Mesh(aGeo, obs); arm.scale.set(2.4, 1, 2.4); arm.rotation.z = -s * 2.2; pivot.add(arm); body.add(pivot); arms.push({ pivot, arm, s }); }
    kingLight = new THREE.PointLight(0xff6a1a, 4, 34, 1.5); kingLight.position.set(0, 8, 4); kingG.add(kingLight);
    king = { boss: true, key: "cinderking", type: KING_T, g: kingG, body, face, arms, h: KING_H, r: KING_R, x: VOLC.x, z: VOLC.z, gy: y0, hp: 1, maxHp: 1, solid: [trunk, crownMesh], dying: false, burn: false, gone: true, t: 0, hurt: 0, mode: "calm", armUp: 0, slam: 0 };
    circles.push({ x: VOLC.x, z: VOLC.z, r: KING_R * 1.25 });
    kingStump = new THREE.Group(); kingStump.position.set(VOLC.x, y0, VOLC.z); kingStump.visible = false; scene.add(kingStump);
    part(kingStump, new THREE.CylinderGeometry(KING_R * 1.1, KING_R * 1.4, 2, 10), obs, 0, 1, 0, 1, 1, 1);
    part(kingStump, new THREE.CircleGeometry(KING_R * 0.4, 10), glowM(0xff6a1a), 0, 2.02, 0, 1, 1, 1, -Math.PI / 2);
    kingLabel = label("THE CINDER KING · sleeping", "#ffb080", 2.8, 0.7); kingLabel.position.set(VOLC.x, y0 + KING_H + 6, VOLC.z); kingLabel.maxD = 90;
    // attack pieces
    const ringM = new THREE.MeshBasicMaterial({ color: 0xff4a1a, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    for (let i = 0; i < 24; i++) { const g = new THREE.Group(), ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 28), ringM.clone()), fill = new THREE.Mesh(new THREE.CircleGeometry(1, 28), ringM.clone()); ring.rotation.x = fill.rotation.x = -Math.PI / 2; fill.material.opacity = 0.2; g.add(ring, fill); g.visible = false; scene.add(g); kfx.rings.push({ g, ring, fill, t: -1, life: 1 }); }
    for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })); m.visible = false; scene.add(m); kfx.cols.push({ m, t: -1, x: 0, z: 0, y: 0, hit: false }); }
    for (let i = 0; i < 24; i++) { const g = new THREE.Group(); part(g, ICO, lamb(0x2a1a14), 0, 0, 0, 0.6, 0.6, 0.6); part(g, ICO, glowM(0xff6a1a), 0, 0, 0, 0.45, 0.45, 0.45); const tail = part(g, CONE6, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.6, depthWrite: false }), 0, 2.2, 0, 0.45, 4, 0.45); tail.rotation.x = Math.PI; g.visible = false; scene.add(g); kfx.rocks.push({ g, on: false, t: 0, dur: 1, x: 0, z: 0, y: 0, sx: 0, sz: 0, ring: null, boss: false, drop: false }); }
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.0, 56, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })); m.visible = false; scene.add(m); kfx.waves.push({ m, R: -1, id: 0 }); }
}
function syncKing() {
    if (!kingG) return;
    const dead = save.kingDay === save.day && save.kingKills > 0;
    kingG.visible = !dead; kingStump.visible = dead;
    kingLabel.el.textContent = dead ? "THE CINDER KING · regrows at dawn" : "THE CINDER KING · sleeping";
    kingLabel.visible = !fight4.on;
    if (!dead) { king.body.rotation.set(0, 0, 0); king.dying = false; }
}
function kRing(x, z, r, life, col = 0xff4a1a) { const o = kfx.rings.find(q => q.t < 0); if (!o) return null; o.t = 0; o.life = life; o.g.position.set(x, groundY(x, z) + 0.08, z); o.g.scale.setScalar(r); o.g.visible = true; o.ring.material.color.setHex(col); o.fill.material.color.setHex(col); return o; }
function kRock(x, z, delay, dur, boss) { // a burning rock dropping out of the sky
    const r = kfx.rocks.find(q => !q.on); if (!r) return;
    r.on = true; r.t = -delay; r.dur = dur; r.x = x; r.z = z; r.y = groundY(x, z); r.sx = x + rand(-14, 14); r.sz = z + rand(-14, 14); r.ring = null; r.boss = boss; r.drop = !boss && Math.random() < 0.55;
}
function startFight4() {
    const f = fight4;
    Object.assign(f, { on: true, phase: 1, cd: 3.2, atk: null, atkT: 0, lag: 1, minions: [], dyingT: -1, heart: 0, flood: 0, floodT: 0 });
    king.maxHp = king.hp = kingMaxHp(); king.dying = false; king.gone = false; king.hurt = 0;
    if (!trees.includes(king)) trees.push(king);
    kingFireRing.visible = true; kingLabel.visible = false;
    $("bossName").textContent = "THE CINDER KING"; $("bossBar").classList.add("show"); $("bossPh").textContent = ""; $("bossBar").classList.remove("rage");
    roar(0.85); shake = 1; flash = 0.3;
    titleCard("THE CINDER KING", "the volcano wakes with him");
    toast("Fire rings the crater. Win, or wake up in camp.", "bad");
    if (!f.seen) { f.seen = true; setTimeout(() => { if (fight4.on) toast("When the crater floods with lava, get up on a basalt pillar. Jump the fire waves. Fireproof Tonic halves his fire.", "rare"); }, 3500); }
}
function endFight4(won, quiet) {
    const f = fight4;
    f.on = false; f.atk = null; f.flood = 0;
    $("bossBar").classList.remove("show");
    kingFireRing.visible = false; kingLava.visible = false;
    for (const t of f.minions) if (!t.gone && !t.dying) t.burn = true;
    f.minions = [];
    for (const r of kfx.rings) { r.t = -1; r.g.visible = false; }
    for (const c of kfx.cols) { c.t = -1; c.m.visible = false; }
    for (const r of kfx.rocks) if (r.boss) { r.on = false; r.g.visible = false; }
    for (const w of kfx.waves) { w.R = -1; w.m.visible = false; }
    if (!won) { king.hp = king.maxHp; king.gone = true; for (const a of king.arms) a.pivot.rotation.x = 0; kingLabel.visible = true; if (!quiet) setTimeout(() => toast("The Cinder King settles back into the magma...", "rare"), 1500); }
}
function kingDefeated(t) {
    fight4.dyingT = 0; t.gone = true;
    endFight4(true);
    save.kingKills = (save.kingKills || 0) + 1; save.kingDay = save.day;
    save.felled++; contractProgress("fell"); contractProgress("rare");
    roar(0.6); shake = 1.2; flash = 1; hitstop = 0.25;
    titleCard("THE CINDER KING FALLS", "the fire will rekindle at dawn");
    writeSave();
}
function kingRewards() {
    const k = save.kingKills, first = k === 1, cash = Math.round(900000 * rebirthMult() * (1 + 0.3 * (k - 1)));
    save.money += cash;
    for (const [m, n] of [["molten", first ? 3 : 1 + (Math.random() < 0.5 ? 1 : 0)], ["phoenixf", 3 + Math.floor(Math.random() * 3)], ["ember", 20 + Math.floor(Math.random() * 20)], ["obsidian", 18 + Math.floor(Math.random() * 18)]]) dropMatsAt(VOLC.x, VOLC.z, m, n, KING_R + 1, KING_R + 5);
    toast(`+${money(cash)} from the Cinder King${first ? " · FIRST KILL!" : ""}`, "cash");
    toast("Molten Cores, Phoenix Feathers, Ember and Obsidian spill across the crater. Grab them!", "rare");
    if (first) setTimeout(() => toast("The Crucible can now forge Volcano's Wrath, the hottest axe there is.", "good"), 2500);
    burst(V3(VOLC.x, king.gy + 3, VOLC.z), 60, 9, [glowM(0xff7a2a), glowM(0xffe070), chipMats[2]]);
    sfx(392, 0.6, "triangle", 0.12, 1.5); setTimeout(() => sfx(523, 0.6, "triangle", 0.12, 1.5), 160); setTimeout(() => sfx(784, 1.0, "triangle", 0.12, 1.2), 340);
    writeSave();
}
function dropMatsAt(x, z, mat, n, r0 = 1, r1 = 4) {
    const meshes = Math.min(n, 10), base = Math.floor(n / meshes), extra = n % meshes;
    for (let i = 0; i < meshes; i++) {
        const m = new THREE.Mesh(matGeo, matMeshMat[mat]), a = Math.random() * 6.283, d = rand(r0, r1);
        m.position.set(x + Math.cos(a) * d, groundY(x, z) + 1.5, z + Math.sin(a) * d);
        if (base > 1) m.scale.setScalar(Math.min(1.8, 1 + base * 0.08));
        scene.add(m); logs.push({ m, vy: 5 + Math.random() * 4, bonus: 0, w: base + (i < extra ? 1 : 0), mat });
    }
}
const kingDist = () => Math.hypot(player.pos.x - VOLC.x, player.pos.z - VOLC.z);
const onPillar = () => PILLARS4.some(p => Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < p.r);
function kingHit(k, sx, sz) { if (player.invuln > 0) return; hurtPlayer(kingDmg(k), sx, sz); }
function inArena(x, z, m = 1.5) { const dx = x - VOLC.x, dz = z - VOLC.z, d = Math.hypot(dx, dz), lim = KARENA() - m; return d > lim ? [VOLC.x + dx / d * lim, VOLC.z + dz / d * lim] : [x, z]; }
function pickKingAttack() {
    const f = fight4, d = kingDist(), alive = f.minions.filter(t => !t.gone && !t.dying && !t.burn).length, o = [];
    if (d < KING_R + 6.5) o.push(["swipe", 3]);
    o.push(["geysers", 3], ["meteors", 2.4]);
    if (f.phase >= 2) o.push(["wave", 2.4], ["flood", f.floodT <= 0 ? 1.6 : 0]);
    if (alive < (f.phase >= 2 ? 4 : 2)) o.push(["summon", 0.8]);
    let r = Math.random() * o.reduce((a, q) => a + q[1], 0);
    for (const [k, w] of o) { r -= w; if (r <= 0 && k !== f.last) return k; }
    return o[0][0];
}
function startKingAttack(k) {
    const f = fight4; f.atk = k; f.atkT = 0; f.last = k; f.fired = false; f.step = 0;
    if (k === "swipe") { floatWorld(V3(VOLC.x, king.gy + 11, VOLC.z), "!", "warn"); sfx(150, 0.4, "sawtooth", 0.08, 0.5); }
    if (k === "geysers") {
        const n = f.phase === 1 ? 2 : f.phase === 2 ? 4 : 6; f.targets = [];
        for (let i = 0; i < n; i++) { let x = player.pos.x, z = player.pos.z; if (i === 1) { x += player.vel.x * 0.8; z += player.vel.z * 0.8; } else if (i > 1) { const a = Math.random() * 6.283, dd = rand(3, 7); x += Math.cos(a) * dd; z += Math.sin(a) * dd; } [x, z] = inArena(x, z); f.targets.push({ x, z }); kRing(x, z, 2.3, f.phase >= 2 ? 0.9 : 1.1); }
        sfx(90, 0.6, "sawtooth", 0.06, 0.7);
    }
    if (k === "meteors") { const n = f.phase === 1 ? 6 : f.phase === 2 ? 10 : 14; for (let i = 0; i < n; i++) { const lead = i ? 0.9 : 0, a = Math.random() * 6.283, dd = i ? rand(1, 7) : 0; const [x, z] = inArena(player.pos.x + player.vel.x * lead + Math.cos(a) * dd, player.pos.z + player.vel.z * lead + Math.sin(a) * dd); kRock(x, z, i * 0.13, rand(1.1, 1.4), true); } sfx(400, 0.4, "sawtooth", 0.05, 0.3); }
    if (k === "wave") { floatScreen("JUMP!", "warn"); sfx(80, 0.9, "sawtooth", 0.1, 0.5); }
    if (k === "flood") { toast("THE CRATER IS FLOODING! GET ON A PILLAR!", "bad"); sfx(60, 1.6, "sawtooth", 0.14, 0.5); f.floodT = 22; }
    if (k === "summon") roar(1.3);
}
function spawnEmberling(x, z) { const t = makeTree(x, z, rand(1.5, 2.1), "emberling"); t.minion = true; t.cool = 0.6; fight4.minions.push(t); burst(V3(x, groundY(x, z) + 0.5, z), 16, 5, [glowM(0xff7a2a), chipMats[2]]); sfx(200, 0.3, "sawtooth", 0.07, 0.4); }
function updateFight4(dt) {
    const f = fight4, B = king, d = kingDist();
    f.heart = Math.max(0, f.heart - dt * 3); f.floodT -= dt;
    kingG.rotation.y += angDiff(Math.atan2(player.pos.x - B.x, player.pos.z - B.z), kingG.rotation.y) * Math.min(1, (f.phase >= 2 ? 1.6 : 1) * dt);
    const frac = B.hp / B.maxHp;
    if (f.phase === 1 && frac <= 0.5) { f.phase = 2; roar(0.7); shake = 0.9; flash = 0.3; $("bossPh").textContent = "· ENRAGED"; $("bossBar").classList.add("rage"); toast("The Cinder King is ENRAGED! The crater will flood. Find the pillars.", "bad"); for (let i = 0; i < 3; i++) { const a = Math.random() * 6.283; spawnEmberling(B.x + Math.cos(a) * 7, B.z + Math.sin(a) * 7); } f.atk = null; f.cd = 1.2; }
    else if (f.phase === 2 && frac <= 0.2) { f.phase = 3; roar(0.5); $("bossPh").textContent = "· INFERNO"; toast("He's burning out. So are you.", "rare"); }
    f.beat -= dt;
    if (f.beat <= 0) { f.beat = f.phase === 1 ? 1.2 : f.phase === 2 ? 0.85 : 0.6; sfx(58, 0.2, "sine", 0.2, 0.6); setTimeout(() => sfx(50, 0.16, "sine", 0.14, 0.6), 170); f.heart = Math.max(f.heart, 0.6); }
    if (!f.atk) { f.cd -= dt; if (f.cd <= 0) startKingAttack(pickKingAttack()); }
    else {
        f.atkT += dt;
        const A = f.atk, k = f.phase >= 2 ? 0.8 : 1;
        if (A === "swipe") { if (f.atkT < 0.8 * k) B.armUp = lerp(B.armUp, 1, Math.min(1, 8 * dt)); else if (!f.fired) { f.fired = true; B.slam = 1; sfx(120, 0.25, "sawtooth", 0.12, 0.4); if (d < KING_R + 7) kingHit(1.3, B.x, B.z); } if (f.atkT > 0.8 * k + 0.5) endKingAttack(); }
        else if (A === "geysers") { const T = f.phase >= 2 ? 0.9 : 1.1; if (f.atkT >= T && !f.fired) { f.fired = true; for (const p of f.targets) { const c = kfx.cols.find(q => q.t < 0); if (c) { c.t = 0; c.x = p.x; c.z = p.z; c.y = groundY(p.x, p.z); c.hit = false; c.m.visible = true; } } shake = Math.max(shake, 0.4); sfx(70, 0.5, "sawtooth", 0.14, 0.5); } if (f.atkT > T + 0.8) endKingAttack(); }
        else if (A === "meteors") { if (f.atkT > 2.6) endKingAttack(); }
        else if (A === "wave") {
            if (f.atkT < 1.0 * k) B.armUp = lerp(B.armUp, 1.4, Math.min(1, 6 * dt));
            else if (f.step < (f.phase === 3 ? 2 : 1) && f.atkT > 1.0 * k + f.step * 0.7) { f.step++; B.slam = 1; shake = 0.9; const w = kfx.waves.find(q => q.R < 0); if (w) { w.R = KING_R + 1; w.m.visible = true; w.id = Math.random(); } sfx(55, 0.8, "sawtooth", 0.2, 0.4); burst(V3(B.x, B.gy + 0.5, B.z), 30, 7, [chipMats[2], glowM(0xff7a2a)]); }
            if (f.atkT > 1.0 * k + 2.2) endKingAttack();
        }
        else if (A === "flood") { if (f.atkT > 7.5) endKingAttack(); }
        else if (A === "summon") { if (f.atkT > 0.5 && !f.fired) { f.fired = true; for (let i = 0; i < (f.phase >= 2 ? 3 : 2); i++) { const a = Math.random() * 6.283, [x, z] = inArena(B.x + Math.cos(a) * rand(6, 9), B.z + Math.sin(a) * rand(6, 9)); spawnEmberling(x, z); } } if (f.atkT > 1.2) endKingAttack(); }
    }
    // the flood: lava rises over the crater floor, stand on a pillar or burn
    const floodOn = f.atk === "flood" && f.atkT > 1.2 && f.atkT < 6.6;
    f.flood = lerp(f.flood, floodOn ? 1 : 0, Math.min(1, dt * (floodOn ? 1.6 : 2.4)));
    kingLava.visible = f.flood > 0.02; kingLava.position.y = B.gy - 0.4 + f.flood * 0.75; kingLava.material.opacity = 0.75 + f.flood * 0.2;
    if (f.flood > 0.6 && !onPillar() && player.pos.y - (groundY(player.pos.x, player.pos.z) + 1.7) < 0.4 && !buffOn("fireproof")) { f.lavaT = (f.lavaT || 0) - dt; if (f.lavaT <= 0) { f.lavaT = 0.5; kingHit(0.35, player.pos.x, player.pos.z); burst(V3(player.pos.x, player.pos.y - 1.5, player.pos.z), 4, 3, [glowM(0xff7a2a)]); } }
    B.armUp = lerp(B.armUp, 0, Math.min(1, 2 * dt)); B.slam = Math.max(0, B.slam - dt * 3);
    for (const a of B.arms) { a.arm.rotation.z = -a.s * (2.2 - B.armUp) + Math.sin(time * 1.1 + a.s) * 0.08; a.pivot.rotation.x = -B.slam * 1.4 + B.armUp * 0.3; }
    const mode = B.hurt > 0.25 || f.phase >= 3 ? "scream" : "angry"; if (B.mode !== mode) { B.mode = mode; B.face.material = faceMats[mode]; }
    B.hurt = Math.max(0, B.hurt - dt * 4);
    f.lag = Math.max(frac, f.lag - dt * 0.35);
    $("bossFill").style.width = (frac * 100) + "%"; $("bossLag").style.width = (f.lag * 100) + "%";
    $("bossHp").textContent = Math.max(0, Math.ceil(B.hp)).toLocaleString() + " / " + B.maxHp.toLocaleString();
}
function endKingAttack() { const f = fight4; f.atk = null; f.cd = f.phase === 1 ? rand(2.2, 3.2) : f.phase === 2 ? rand(1.5, 2.3) : rand(1.0, 1.6); }
function updateKingFx(dt) {
    for (const r of kfx.rings) { if (r.t < 0) continue; r.t += dt; const u = r.t / r.life; r.fill.scale.setScalar(Math.min(1, u)); r.ring.material.opacity = 0.45 + Math.sin(time * 18) * 0.25; r.fill.material.opacity = 0.18 + u * 0.25; if (u >= 1) { r.t = -1; r.g.visible = false; } }
    for (const c of kfx.cols) {
        if (c.t < 0) continue;
        c.t += dt; const h = c.t < 0.15 ? c.t / 0.15 * 9 : 9, fade = c.t > 0.7 ? Math.max(0, 1 - (c.t - 0.7) / 0.4) : 1;
        c.m.scale.set(1, h, 1); c.m.position.set(c.x, c.y + h / 2, c.z); c.m.material.opacity = 0.85 * fade;
        if (!c.hit && c.t < 0.4 && fight4.on && Math.hypot(player.pos.x - c.x, player.pos.z - c.z) < 2.3) { c.hit = true; kingHit(1, c.x, c.z); player.vel.y = 7; }
        if (c.t < 0.05) burst(V3(c.x, c.y + 0.4, c.z), 6, 6, [glowM(0xff7a2a), glowM(0xffd060)]);
        if (c.t > 1.1) { c.t = -1; c.m.visible = false; }
    }
    for (const r of kfx.rocks) {
        if (!r.on) continue;
        r.t += dt; if (r.t < 0) continue;
        if (!r.ring) { r.ring = kRing(r.x, r.z, r.boss ? 2.0 : 2.6, r.dur, 0xff7a2a); r.g.visible = true; }
        const u = Math.min(1, r.t / r.dur);
        r.g.position.set(lerp(r.sx, r.x, u), lerp(r.y + 70, r.y, u * u), lerp(r.sz, r.z, u)); r.g.rotation.set(Math.atan2(r.x - r.sx, 70) * 0, 0, 0);
        if (u >= 1) {
            r.on = false; r.g.visible = false;
            burst(V3(r.x, r.y + 0.4, r.z), 14, 7, [glowM(0xff7a2a), glowM(0xffd060), chipMats[2]]);
            const dd = Math.hypot(player.pos.x - r.x, player.pos.z - r.z);
            if (dd < (r.boss ? 2.2 : 2.7) && state === "playing") { if (r.boss) { if (fight4.on) kingHit(0.75, r.x, r.z); } else hurtPlayer(Math.round(18 * isleDm() * (buffOn("fireproof") ? 0.5 : 1)), r.x, r.z); }
            if (dd < 40) { sfx(120 + Math.random() * 40, 0.35, "sawtooth", 0.1 * (1 - dd / 40), 0.4); shake = Math.max(shake, 0.3 * (1 - dd / 40)); }
            if (r.drop) dropMatsAt(r.x, r.z, Math.random() < 0.6 ? "ember" : "obsidian", 1 + Math.floor(Math.random() * 3), 0.2, 1);
        }
    }
    for (const w of kfx.waves) {
        if (w.R < 0) continue;
        w.R += dt * 12; w.m.scale.set(w.R, 1, w.R); w.m.position.set(VOLC.x, king.gy + 0.5, VOLC.z); w.m.material.opacity = 0.65 * (1 - w.R / (KARENA() + 2));
        const dd = kingDist();
        if (fight4.on && Math.abs(dd - w.R) < 0.9 && grounded() && !fight4.hitWave.has(w.id)) { fight4.hitWave.add(w.id); kingHit(0.9, VOLC.x, VOLC.z); player.vel.y = 5; }
        if (w.R > KARENA() + 2) { w.R = -1; w.m.visible = false; }
    }
}
function updateKing(dt, animOnly) {
    if (!kingG) return;
    const f = fight4, B = king;
    for (const fl of kingFlames) fl.scale.set(0.5, 2.2 * (0.8 + Math.sin(time * 9 + fl.userData.ph) * 0.25), 0.5);
    if (kingFireRing.visible) for (const fl of kingFireRing.children) fl.scale.y = 2.4 * (0.75 + Math.sin(time * 10 + fl.userData.ph) * 0.25);
    if (kingLight) kingLight.intensity = (f.on ? 8 + Math.sin(time * 6) * 2 : 3 + Math.sin(time * 1.5)) + f.heart * 10;
    if (kingCore) kingCore.scale.setScalar(0.85 + Math.sin(time * (f.on ? 6 : 2)) * 0.08 + f.heart * 0.25);
    updateKingFx(dt);
    if (f.dyingT >= 0) {
        f.dyingT += dt; const u = Math.min(1, f.dyingT / 3);
        B.body.rotation.x = -Math.pow(u, 2.2) * Math.PI * 0.46;
        if (f.dyingT < 2.5 && Math.random() < dt * 20) burst(V3(B.x + rand(-2, 2), B.gy + rand(1, 10), B.z + rand(-2, 2)), 2, 3, [glowM(0xff7a2a), chipMats[2]]);
        if (u >= 1 && !f.landed) { f.landed = true; shake = 1.2; sfx(45, 1.2, "sawtooth", 0.25, 0.4); kingRewards(); }
        if (f.dyingT > 4.2) { f.dyingT = -1; f.landed = false; kingG.visible = false; kingStump.visible = true; kingLabel.el.textContent = "THE CINDER KING · regrows at dawn"; kingLabel.visible = true; }
    }
    if (f.on) { if (!animOnly && state === "playing") updateFight4(dt); return; }
    if (kingLava.visible) { f.flood = lerp(f.flood, 0, Math.min(1, dt * 2)); kingLava.position.y = B.gy - 0.4 + f.flood * 0.75; if (f.flood < 0.02) kingLava.visible = false; }
    if (f.dyingT >= 0 || !kingG.visible) return;
    B.body.rotation.z = Math.sin(time * 0.4) * 0.01;
    for (const a of B.arms) { a.arm.rotation.z = -a.s * 2.2 + Math.sin(time * 0.5 + a.s) * 0.05; a.pivot.rotation.x = 0; }
    if (B.mode !== "calm") { B.mode = "calm"; B.face.material = faceMats.calm; }
    if (!animOnly && state === "playing" && !ride && kingDist() < KARENA() - 1.5 && player.hp > 0 && !(save.kingDay === save.day && save.kingKills > 0)) startFight4();
}
// ---- eruptions: every few minutes the volcano throws burning rocks all over the island ----
let eruptT = rand(120, 220), eruptLeft = 0, eruptBomb = 0;
function startEruption() {
    eruptLeft = 24; eruptBomb = 1.5;
    toast("THE VOLCANO IS ERUPTING! Watch for red rings: lava bombs leave Ember and Obsidian behind.", "bad");
    sfx(35, 3, "sawtooth", 0.22, 0.5); sfx(50, 2.5, "sine", 0.24, 0.6); shake = 1; flash = 0.25;
    burst(V3(VOLC.x, floorY4() + 4, VOLC.z), 60, 14, [glowM(0xff7a2a), glowM(0xffd060), chipMats[2]]);
}
function updateEruption(dt) {
    if (inCasino()) return; // nothing falls on you indoors
    if (eruptLeft > 0) {
        eruptLeft -= dt; eruptBomb -= dt;
        if (isle4.plume) isle4.plume.material.opacity = 0.14;
        if (isle4.volcLight) isle4.volcLight.intensity = 60 + Math.sin(time * 9) * 15;
        if (Math.random() < dt * 4) shake = Math.max(shake, 0.12);
        if (eruptBomb <= 0) {
            eruptBomb = rand(0.35, 0.8);
            for (let n = 0; n < 2; n++) { const a = Math.random() * 6.283, d = rand(n ? 8 : 0, n ? 40 : 10), x = player.pos.x + Math.cos(a) * d + player.vel.x * 0.8, z = player.pos.z + Math.sin(a) * d + player.vel.z * 0.8; if (Math.hypot(x, z) < SAFE_R + 2 || Math.hypot(x, z) > shoreAt4(x, z) - 4 || crater()) continue; kRock(x, z, n * 0.4, rand(1.6, 2.2), false); }
        }
        if (eruptLeft <= 0) toast("The eruption dies down. Go pick up what fell.", "good");
        return;
    }
    if (fight4.on || state !== "playing" || ride) return;
    eruptT -= dt;
    if (eruptT <= 0) { eruptT = rand(180, 320); startEruption(); }
}
// =====================================================================
//  1.4.0: wildlife, a little ecosystem, and decorations on every island
// =====================================================================
const wildDone = {}, wildBy = { 1: [], 2: [], 3: [], 4: [], 5: [] };
const isleGroup = n => [null, isle1, isle2G, isle3G, isle4G, isle5G][n];
// where wildlife may stand or walk: on land, out of camp, clear of landmarks, lakes, lava and the docks
function wildOk(x, z, walk) {
    const d = Math.hypot(x, z);
    if (d > curShoreAt(x, z) - (walk ? 7 : 9) || d < SAFE_R + (walk ? 1 : 4)) return false;
    for (const lm of curLM()) if (!lm.camp && Math.hypot(x - lm.x, z - lm.z) < lm.r + (walk ? 0.5 : 3)) return false;
    if (isle === 2 && Math.hypot(x - LAKE2.x, z - LAKE2.z) < LAKE2.r + 3) return false;
    if (isle === 3 && !treeOk3(x, z)) return false;
    if (isle === 4 && !treeOk4(x, z)) return false;
    return true;
}
function wildSpot() {
    for (let i = 0; i < 80; i++) {
        const a = Math.random() * 6.283, d = rand(SAFE_R + 5, curShoreR(a) - 10), x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (wildOk(x, z)) return { x, z, y: groundY(x, z) };
    }
    return null;
}
const glowB = c => new THREE.MeshBasicMaterial({ color: c });
const glowL = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e, flatShading: true });

// ---------- decorations (each kind is one merged mesh per island) ----------
function decorate(n) {
    const S = (count, fn) => { for (let i = 0; i < count; i++) { const p = wildSpot(); if (p) fn(p.x, p.y, p.z); } };
    const B = {}, b = (k, mat) => B[k] || (B[k] = batch(mat));
    const mush = (x, y, z, cap, stem, spot, big = 1) => {
        const n2 = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n2; i++) {
            const mx = x + rand(-0.7, 0.7), mz = z + rand(-0.7, 0.7), my = groundY(mx, mz) - 0.05, h = rand(0.18, 0.5) * big, w = rand(0.14, 0.26) * big;
            stem.add(CYL6, mx, my + h / 2, mz, 0, 0, 0, w * 0.32, h, w * 0.32);
            cap.add(ICO, mx, my + h, mz, 0, Math.random() * 3, 0, w, w * 0.5, w);
            if (spot) spot.add(ICO, mx + w * 0.4, my + h + w * 0.3, mz, 0, 0, 0, w * 0.18);
        }
    };
    const log = (x, y, z, bark, top, moss) => {
        const ry = Math.random() * 3.14, len = rand(2.4, 4), r = rand(0.22, 0.34);
        bark.add(CYL8, x, y + r * 0.8, z, 0, ry, Math.PI / 2, r, len, r);
        for (const s of [-1, 1]) top.add(CYL8, x + Math.cos(ry) * s * len / 2, y + r * 0.8, z - Math.sin(ry) * s * len / 2, 0, ry, Math.PI / 2, r * 0.85, 0.04, r * 0.85);
        if (moss) moss.add(BOX, x, y + r * 1.75, z, 0, ry, 0, len * 0.55, 0.06, r * 1.1);
    };
    const stump = (x, y, z, bark, top) => { const r = rand(0.3, 0.5), h = rand(0.3, 0.7); bark.add(CYL8, x, y + h / 2 - 0.05, z, 0, Math.random(), 0, r, h, r); top.add(CYL8, x, y + h - 0.03, z, 0, 0, 0, r * 0.88, 0.06, r * 0.88); };
    const bush = (x, y, z, leaf, berry) => {
        for (let i = 0; i < 3; i++) { const s = rand(0.45, 0.75); leaf.add(ICO, x + rand(-0.5, 0.5), y + s * 0.6, z + rand(-0.5, 0.5), 0, Math.random() * 3, 0, s, s * 0.8, s); }
        if (berry) for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28; berry.add(ICO, x + Math.cos(a) * 0.6, y + rand(0.4, 1.0), z + Math.sin(a) * 0.6, 0, 0, 0, 0.07); }
    };
    const flowers = (x, y, z, heads, stems) => {
        for (let i = 0; i < 12; i++) { const fx = x + rand(-2.2, 2.2), fz = z + rand(-2.2, 2.2), fy = groundY(fx, fz); stems.add(CYL6, fx, fy + 0.2, fz, 0, 0, 0, 0.02, 0.4, 0.02); heads[Math.floor(Math.random() * heads.length)].add(ICO, fx, fy + 0.44, fz, 0, 0, 0, 0.11, 0.09, 0.11); }
    };
    const tufts = (x, y, z, grass, n2 = 5, hgt = 0.7) => { for (let i = 0; i < n2; i++) { const gx = x + rand(-0.35, 0.35), gz = z + rand(-0.35, 0.35); grass.add(CONE6, gx, groundY(gx, gz) + hgt * 0.4, gz, rand(-0.3, 0.3), 0, rand(-0.3, 0.3), 0.05, rand(0.6, 1) * hgt, 0.05); } };
    const crystals = (x, y, z, mat, sc = 1) => { for (let i = 0; i < 5; i++) { const h = rand(0.5, 1.4) * sc; mat.add(CONE6, x + rand(-0.4, 0.4), y + h * 0.4, z + rand(-0.4, 0.4), rand(-0.45, 0.45), Math.random() * 3, rand(-0.45, 0.45), 0.13 * sc, h, 0.13 * sc); } };
    const cairn = (x, y, z, stone) => { let yy = y; for (let i = 0; i < 4; i++) { const s = 0.7 - i * 0.14; stone.add(BOX, x + rand(-0.05, 0.05), yy + s * 0.3, z, 0, Math.random() * 3, rand(-0.1, 0.1), s, s * 0.55, s * 0.8); yy += s * 0.55; } };
    const ring = (x, y, z, cap, stem, glow) => { // a fairy ring: a circle of little mushrooms round a soft glow
        for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283, mx = x + Math.cos(a) * 2.2, mz = z + Math.sin(a) * 2.2, my = groundY(mx, mz) - 0.04, h = rand(0.2, 0.35); stem.add(CYL6, mx, my + h / 2, mz, 0, 0, 0, 0.05, h, 0.05); cap.add(ICO, mx, my + h, mz, 0, 0, 0, 0.16, 0.08, 0.16); }
        glow.add(CYL8, x, y + 0.03, z, 0, 0, 0, 1.7, 0.03, 1.7);
    };
    const cracks = (x, y, z, glow) => { let cx = x, cz = z, a = Math.random() * 6.28; for (let i = 0; i < 6; i++) { a += rand(-0.8, 0.8); const l = rand(0.6, 1.2), nx = cx + Math.cos(a) * l, nz = cz + Math.sin(a) * l, mx = (cx + nx) / 2, mz = (cz + nz) / 2; glow.add(BOX, mx, groundY(mx, mz) + 0.03, mz, 0, -a, 0, l, 0.05, 0.1); cx = nx; cz = nz; } };
    const bones = (x, y, z, bone, dark) => {
        const ry = Math.random() * 6.28;
        for (let i = 0; i < 5; i++) { const o = (i - 2) * 0.35; bone.add(BOX, x + Math.cos(ry) * o, y + 0.25, z - Math.sin(ry) * o, 0, ry, 0.7, 0.07, 0.7, 0.07); }
        bone.add(BOX, x, y + 0.08, z, 0, ry, 0, 1.8, 0.1, 0.1);
        const sx = x + Math.cos(ry) * 1.3, sz = z - Math.sin(ry) * 1.3; bone.add(ICO, sx, y + 0.22, sz, 0, ry, 0, 0.28, 0.24, 0.32);
        for (const s of [-1, 1]) dark.add(BOX, sx + Math.sin(ry) * s * 0.1 + Math.cos(ry) * 0.18, y + 0.28, sz + Math.cos(ry) * s * 0.1 - Math.sin(ry) * 0.18, 0, ry, 0, 0.1, 0.08, 0.06);
    };
    if (n === 1) {
        S(26, (x, y, z) => mush(x, y, z, b("cap", lamb(0x9a1a12)), b("stem", lamb(0xf0e8d8)), b("spot", glowB(0xffffff))));
        S(16, (x, y, z) => log(x, y, z, b("bark", lamb(0x5a3a24)), b("ring", lamb(0xc8a070)), b("moss", lamb(0x4a8a3a))));
        S(14, (x, y, z) => stump(x, y, z, b("bark", lamb(0x5a3a24)), b("ring", lamb(0xc8a070))));
        S(22, (x, y, z) => bush(x, y, z, b("bush", lamb(0x2f6a34)), b("berry", glowB(0xd02a4a))));
    } else if (n === 2) {
        const heads = [0xf4f4ff, 0xb07aff, 0xffe060, 0x7fb8ff].map(c => b("fl" + c, lamb(c)));
        S(34, (x, y, z) => flowers(x, y, z, heads, b("stem", lamb(0x4a7a3a))));
        S(18, (x, y, z) => log(x, y, z, b("bark", lamb(0x5a4030)), b("ring", lamb(0xc8a070)), b("moss", lamb(0x5a9a42))));
        S(12, (x, y, z) => cairn(x, y, z, b("stone", lamb(0x8a8a94))));
        S(26, (x, y, z) => bush(x, y, z, b("bush", lamb(0x3a6a2a)), b("berry", glowB(0x4a6aff))));
        S(16, (x, y, z) => mush(x, y, z, b("cap", lamb(0xb06a2a)), b("stem", lamb(0xe8dcc0))));
        S(140, (x, y, z) => tufts(x, y, z, b("grass", lamb(0x7a9a42))));
    } else if (n === 3) {
        for (const [k, c] of [["c1", 0x7affef], ["c2", 0xd07aff], ["c3", 0xff8ad8]]) S(16, (x, y, z) => mush(x, y, z, b(k, glowB(c)), b("stem", lamb(0xe0d4c0)), null, 1.4));
        S(9, (x, y, z) => ring(x, y, z, b("rcap", glowB(0xb8f4ff)), b("stem", lamb(0xe0d4c0)), b("rglow", new THREE.MeshBasicMaterial({ color: 0x8a6aff, transparent: true, opacity: 0.25, depthWrite: false }))));
        S(18, (x, y, z) => crystals(x, y, z, b("cry", glowL(0x9a7aff, 0x3a1a8a))));
        S(12, (x, y, z) => log(x, y, z, b("bark", lamb(0x3a3048)), b("ring", lamb(0xb8a8c8)), b("moss", glowL(0x3a8a8a, 0x0a3a3a))));
        S(150, (x, y, z) => tufts(x, y, z, b("grass", glowL(0x3a7a8a, 0x0a2a3a)), 4, 0.6));
    } else if (n === 4) {
        S(30, (x, y, z) => crystals(x, y, z, b("obs", glowL(0x14101c, 0x0a0414)), 1.3));
        S(16, (x, y, z) => crystals(x, y, z, b("sul", glowL(0xd8c83a, 0x3a3000)), 0.8));
        S(44, (x, y, z) => cracks(x, y, z, b("crack", glowB(0xff6a1a))));
        S(18, (x, y, z) => stump(x, y, z, b("char", lamb(0x1a1412)), b("charTop", glowB(0xff5a1a))));
        S(9, (x, y, z) => bones(x, y, z, b("bone", lamb(0xe8e0cc)), b("boneDk", glowB(0x100808))));
        S(90, (x, y, z) => tufts(x, y, z, b("ash", lamb(0x6a625c)), 4, 0.5));
    }
    for (const k in B) B[k].build();
}

// ---------- the animals: proper rigs (legs that walk, heads that look around, tails, ears, blinking eyes) ----------
// none of them ever attack: they graze, wander, play, and run away if you come too close
function makeDeer() {
    const g = new THREE.Group(), buck = Math.random() < 0.45, fur = amat(0x9a6434), pale = amat(0xf2e6cc), dark = amat(0x3a2414), hoof = amat(0x1a120c), ant = amat(0xd8c49a);
    const body = pv(g, 0, 0, 0);
    part(body, SPH, fur, 0, 1.0, 0, 0.27, 0.3, 0.56);
    part(body, SPH, fur, 0, 1.04, 0.34, 0.26, 0.31, 0.28);
    part(body, SPH, fur, 0, 1.04, -0.38, 0.25, 0.29, 0.28);
    part(body, SPH, pale, 0, 0.86, 0.06, 0.2, 0.13, 0.46);
    part(body, SPH, pale, 0, 1.06, -0.6, 0.15, 0.17, 0.07);
    if (!buck) for (let i = 0; i < 6; i++) part(body, SPH, pale, (i % 2 ? 0.12 : -0.12), 1.2 - (i % 3) * 0.04, -0.3 + i * 0.12, 0.03, 0.02, 0.03); // a doe's faint spots
    const neck = pv(body, 0, 1.16, 0.48, 0.5);
    part(neck, SPH, fur, 0, 0.24, 0, 0.11, 0.3, 0.12);
    part(neck, SPH, pale, 0, 0.16, 0.07, 0.07, 0.16, 0.05);
    const head = pv(neck, 0, 0.5, 0.02, -0.5);
    part(head, SPH, fur, 0, 0, 0.02, 0.12, 0.12, 0.15);
    part(head, SPH, fur, 0, -0.045, 0.16, 0.075, 0.07, 0.12);
    part(head, SPH, pale, 0, -0.085, 0.15, 0.055, 0.03, 0.09);
    part(head, BOX, dark, 0, -0.03, 0.275, 0.065, 0.05, 0.04);
    const eyes = aEyes(head, 0.095, 0.03, 0.08, 0.03);
    const ears = [-1, 1].map(s => { const e = pv(head, s * 0.08, 0.08, -0.04, -0.2, 0, -s * 0.95); e.userData.rz0 = -s * 0.95; part(e, SPH, fur, 0, 0.1, 0, 0.045, 0.11, 0.022); part(e, SPH, pale, 0, 0.1, 0.012, 0.03, 0.08, 0.012); return e; });
    if (buck) for (const s of [-1, 1]) {
        const a = pv(head, s * 0.06, 0.11, -0.03, -0.35, 0, -s * 0.45);
        part(a, BOX, ant, 0, 0.12, 0, 0.028, 0.24, 0.028);
        part(a, BOX, ant, 0, 0.16, 0.05, 0.02, 0.12, 0.02, 0.9);
        const b2 = pv(a, 0, 0.24, 0, 0.35, 0, s * 0.35);
        part(b2, BOX, ant, 0, 0.1, 0, 0.024, 0.2, 0.024);
        part(b2, BOX, ant, 0, 0.1, 0.04, 0.018, 0.1, 0.018, 0.8);
        part(b2, BOX, ant, 0, 0.18, 0, 0.018, 0.1, 0.018, -0.2, 0, -s * 0.4);
    }
    const tail = pv(body, 0, 1.13, -0.64, 0.5);
    part(tail, SPH, fur, 0, -0.06, -0.02, 0.055, 0.1, 0.04);
    part(tail, SPH, pale, 0, -0.07, -0.045, 0.04, 0.08, 0.02);
    const legs = [[-0.13, 0.36, 0], [0.13, 0.36, Math.PI], [-0.14, -0.4, Math.PI], [0.14, -0.4, 0]].map(([x, z, ph]) => { const p = aLeg(g, x, 0.95, z, 0.92, 0.05, fur, hoof); part(p, SPH, fur, 0, -0.12, 0, 0.085, 0.2, z < 0 ? 0.13 : 0.1); return { p, ph }; });
    g.userData.rig = { body, neck, nx0: 0.5, ngraze: 1.75, nrun: 0.25, head, hx0: -0.5, legs, tail: [tail], tailFlick: 0.5, ears, eyes, stride: 3.6, swing: 0.55, bob: 0.05 };
    return g;
}
function makeRabbit() {
    const g = new THREE.Group(), fur = amat([0xb09a80, 0x8a7a68, 0xd8ccbc][Math.floor(Math.random() * 3)]), pale = amat(0xf4eee4), pink = amat(0xf0a0a8);
    const body = pv(g, 0, 0, 0);
    part(body, SPH, fur, 0, 0.2, -0.04, 0.15, 0.15, 0.21);
    part(body, SPH, fur, 0, 0.19, -0.14, 0.15, 0.15, 0.13);
    for (const s of [-1, 1]) { part(body, SPH, fur, s * 0.1, 0.13, -0.12, 0.06, 0.1, 0.12); part(body, BOX, fur, s * 0.09, 0.025, -0.06, 0.055, 0.04, 0.17); }
    part(body, SPH, pale, 0, 0.15, 0.07, 0.1, 0.1, 0.1);
    const tail = pv(body, 0, 0.24, -0.27); part(tail, SPH, pale, 0, 0, 0, 0.055, 0.055, 0.05);
    const legs = [-1, 1].map(s => ({ p: aLeg(body, s * 0.06, 0.12, 0.12, 0.11, 0.022, fur, pale), ph: s > 0 ? Math.PI : 0 }));
    const head = pv(body, 0, 0.3, 0.14);
    part(head, SPH, fur, 0, 0, 0.03, 0.1, 0.09, 0.11);
    for (const s of [-1, 1]) part(head, SPH, pale, s * 0.035, -0.03, 0.1, 0.035, 0.035, 0.035);
    part(head, SPH, pink, 0, 0, 0.135, 0.018, 0.014, 0.012);
    const eyes = aEyes(head, 0.065, 0.025, 0.075, 0.024);
    const ears = [-1, 1].map(s => { const e = pv(head, s * 0.035, 0.06, -0.01, -0.25, 0, -s * 0.12); e.userData.rz0 = -s * 0.12; e.userData.rx0 = -0.25; part(e, SPH, fur, 0, 0.11, 0, 0.032, 0.12, 0.016); part(e, SPH, pink, 0, 0.11, 0.008, 0.02, 0.09, 0.01); return e; });
    g.userData.rig = { body, head, legs, ears, eyes, tail: [tail], wagA: 0.15, wag: 6 };
    return g;
}
function makeSquirrel() {
    const g = new THREE.Group(), fur = amat(0xa65a2a), pale = amat(0xf0dcc0), tip = amat(0xc87a44);
    const body = pv(g, 0, 0, 0);
    part(body, SPH, fur, 0, 0.14, -0.02, 0.09, 0.1, 0.14);
    part(body, SPH, pale, 0, 0.12, 0.06, 0.06, 0.07, 0.06);
    for (const s of [-1, 1]) { part(body, SPH, fur, s * 0.06, 0.09, -0.07, 0.045, 0.07, 0.08); part(body, BOX, fur, s * 0.055, 0.02, -0.03, 0.035, 0.03, 0.1); }
    const arms = [-1, 1].map(s => { const a = pv(body, s * 0.04, 0.12, 0.1, 0.3); part(a, BOX, fur, 0, -0.04, 0, 0.022, 0.08, 0.022); return a; });
    const head = pv(body, 0, 0.22, 0.11);
    part(head, SPH, fur, 0, 0, 0.02, 0.065, 0.06, 0.075);
    part(head, SPH, pale, 0, -0.02, 0.06, 0.04, 0.03, 0.04);
    part(head, BOX, aglow(0x1a0c08), 0, 0, 0.1, 0.02, 0.015, 0.01);
    const eyes = aEyes(head, 0.045, 0.02, 0.05, 0.016);
    const ears = [-1, 1].map(s => { const e = pv(head, s * 0.035, 0.05, -0.01, 0, 0, -s * 0.2); e.userData.rz0 = -s * 0.2; part(e, CONE4, fur, 0, 0.03, 0, 0.022, 0.05, 0.012); return e; });
    // a big bushy tail rising up behind and curling forward over the back
    const t0 = pv(body, 0, 0.13, -0.14, -0.9); part(t0, SPH, fur, 0, 0.08, 0, 0.06, 0.1, 0.06);
    const t1 = pv(t0, 0, 0.16, 0, 0.6); part(t1, SPH, fur, 0, 0.08, 0, 0.08, 0.11, 0.07);
    const t2 = pv(t1, 0, 0.15, 0, 0.9); part(t2, SPH, tip, 0, 0.06, 0, 0.07, 0.09, 0.06);
    g.userData.rig = { body, head, ears, eyes, arms, tailChain: [t0, t1, t2], tail0: [-0.9, 0.6, 0.9] };
    return g;
}
function makeGoat() {
    const g = new THREE.Group(), w = amat(0xeee8dc), shag = amat(0xd6ccbc), horn = amat(0x8a7a64), dk = amat(0x3a3028), hoof = amat(0x2a221c);
    const body = pv(g, 0, 0, 0);
    part(body, SPH, w, 0, 0.8, 0, 0.27, 0.29, 0.46);
    part(body, SPH, w, 0, 0.84, 0.28, 0.25, 0.29, 0.25);
    part(body, SPH, w, 0, 0.83, -0.3, 0.24, 0.27, 0.24);
    for (let i = 0; i < 6; i++) part(body, BOX, shag, (i % 2 ? 1 : -1) * 0.12, 0.57, -0.25 + i * 0.1, 0.07, 0.16, 0.08); // shaggy belly fringe
    const neck = pv(body, 0, 0.92, 0.4, 0.55);
    part(neck, SPH, w, 0, 0.16, 0, 0.11, 0.22, 0.12);
    const head = pv(neck, 0, 0.34, 0.02, -0.55);
    part(head, SPH, w, 0, 0, 0.02, 0.11, 0.12, 0.13);
    part(head, SPH, w, 0, -0.07, 0.15, 0.07, 0.07, 0.12);
    part(head, BOX, dk, 0, -0.06, 0.265, 0.06, 0.04, 0.03);
    part(head, BOX, shag, 0, -0.19, 0.13, 0.05, 0.14, 0.05, 0.2);
    const eyes = [-1, 1].map(s => { const e = pv(head, s * 0.085, 0.03, 0.07); part(e, SPH, aglow(0xd8b040), 0, 0, 0, 0.026, 0.026, 0.02); part(e, BOX, aglow(0x100c08), 0, 0, 0.018, 0.034, 0.009, 0.006); return e; });
    const ears = [-1, 1].map(s => { const e = pv(head, s * 0.1, 0.03, -0.03, 0, 0, -s * 1.45); e.userData.rz0 = -s * 1.45; part(e, SPH, w, 0, 0.08, 0, 0.032, 0.08, 0.018); return e; });
    for (const s of [-1, 1]) { // ridged horns sweeping back
        let p = pv(head, s * 0.05, 0.1, -0.02, -0.55, 0, -s * 0.15);
        for (let i = 0; i < 4; i++) { part(p, BOX, horn, 0, 0.045, 0, 0.042 - i * 0.006, 0.1, 0.046 - i * 0.006); p = pv(p, 0, 0.09, 0, -0.42, 0, -s * 0.08); }
    }
    const tail = pv(body, 0, 0.94, -0.52, -0.5); part(tail, SPH, w, 0, 0.05, 0, 0.045, 0.08, 0.03);
    const legs = [[-0.13, 0.3, 0], [0.13, 0.3, Math.PI], [-0.13, -0.32, Math.PI], [0.13, -0.32, 0]].map(([x, z, ph]) => { const p = aLeg(g, x, 0.64, z, 0.6, 0.055, w, hoof); part(p, SPH, w, 0, -0.1, 0, 0.08, 0.16, 0.1); return { p, ph }; });
    g.userData.rig = { body, neck, nx0: 0.55, ngraze: 1.8, nrun: 0.2, head, hx0: -0.55, legs, tail: [tail], wag: 7, wagA: 0.35, ears, eyes, stride: 4.4, swing: 0.6, bob: 0.04 };
    return g;
}
function makeMarmot() {
    const g = new THREE.Group(), fur = amat(0x8a6a44), dk = amat(0x5a4028), pale = amat(0xd8c4a0);
    const body = pv(g, 0, 0, -0.05); // pivots at its haunches: tip it forward to drop onto all fours
    part(body, SPH, fur, 0, 0.26, 0, 0.2, 0.26, 0.18);
    part(body, SPH, pale, 0, 0.26, 0.08, 0.14, 0.2, 0.12);
    const head = pv(body, 0, 0.54, 0.04);
    part(head, SPH, fur, 0, 0.02, 0, 0.12, 0.11, 0.12);
    part(head, SPH, pale, 0, -0.02, 0.09, 0.065, 0.05, 0.06);
    part(head, BOX, aglow(0x1a1410), 0, 0.005, 0.15, 0.03, 0.02, 0.015);
    part(head, BOX, aglow(0xfff8e8), 0, -0.06, 0.13, 0.025, 0.03, 0.01);
    for (const s of [-1, 1]) part(head, SPH, dk, s * 0.085, 0.09, -0.02, 0.03, 0.03, 0.02);
    const eyes = aEyes(head, 0.07, 0.04, 0.08, 0.02);
    const arms = [-1, 1].map(s => { const a = pv(body, s * 0.09, 0.38, 0.12, 0.5); part(a, BOX, fur, 0, -0.05, 0, 0.04, 0.11, 0.04); part(a, BOX, dk, 0, -0.11, 0.01, 0.045, 0.025, 0.05); return a; });
    for (const s of [-1, 1]) part(g, BOX, dk, s * 0.1, 0.025, 0.04, 0.07, 0.05, 0.12);
    const tail = pv(body, 0, 0.1, -0.16); part(tail, SPH, dk, 0, 0, -0.08, 0.055, 0.04, 0.12);
    g.userData.rig = { body, head, eyes, arms, tail: [tail], wagA: 0.2 };
    return g;
}
function makeEagle() {
    const g = new THREE.Group(), br = amat(0x5a3a22), dk = amat(0x3a2414), mid = amat(0x7a5232), wh = amat(0xf6f2ea), ye = amat(0xf0b020);
    const body = pv(g, 0, 0, 0);
    part(body, SPH, br, 0, 0, 0, 0.18, 0.17, 0.5);
    part(body, SPH, mid, 0, -0.03, 0.18, 0.15, 0.14, 0.24);
    const head = pv(body, 0, 0.06, 0.46);
    part(head, SPH, wh, 0, 0, 0.02, 0.12, 0.12, 0.15);
    part(head, CONE6, ye, 0, -0.01, 0.2, 0.045, 0.12, 0.05, Math.PI / 2 + 0.35);
    aEyes(head, 0.07, 0.03, 0.08, 0.018);
    for (let i = -2; i <= 2; i++) part(body, BOX, wh, i * 0.05, 0, -0.62 - Math.abs(i) * 0.015, 0.075, 0.018, 0.3, 0, i * 0.18);
    for (const s of [-1, 1]) part(body, BOX, ye, s * 0.06, -0.15, -0.28, 0.035, 0.03, 0.12);
    const wings = [-1, 1].map(s => {
        const sh = pv(body, s * 0.14, 0.05, 0.04);
        part(sh, BOX, br, s * 0.38, 0, 0, 0.76, 0.045, 0.46);
        part(sh, BOX, mid, s * 0.36, 0.02, 0.12, 0.66, 0.03, 0.18);
        const el = pv(sh, s * 0.74, 0, 0);
        part(el, BOX, dk, s * 0.3, 0, -0.04, 0.6, 0.035, 0.36);
        for (let f = 0; f < 5; f++) part(el, BOX, dk, s * (0.62 + f * 0.025), 0, 0.1 - f * 0.065, 0.32, 0.02, 0.06, 0, s * (0.25 - f * 0.12), 0);
        return { sh, el, s };
    });
    g.userData.rig = { body, head, wings2: wings };
    return g;
}
function makeFox() {
    const g = new THREE.Group(), fur = amat(0x9ab4dc, 0x0a1428), pale = amat(0xeef4ff, 0x10141c), dk = amat(0x2a3050), tipM = aglow(0xa8fff8);
    const body = pv(g, 0, 0, 0);
    part(body, SPH, fur, 0, 0.5, -0.02, 0.17, 0.18, 0.38);
    part(body, SPH, fur, 0, 0.52, 0.22, 0.16, 0.18, 0.18);
    part(body, SPH, pale, 0, 0.42, 0.12, 0.12, 0.1, 0.24);
    const neck = pv(body, 0, 0.6, 0.32, 0.7);
    part(neck, SPH, fur, 0, 0.08, 0, 0.1, 0.14, 0.1); part(neck, SPH, pale, 0, 0.06, 0.05, 0.07, 0.11, 0.05);
    const head = pv(neck, 0, 0.18, 0.02, -0.7);
    part(head, SPH, fur, 0, 0, 0, 0.12, 0.1, 0.11);
    part(head, CONE6, fur, 0, -0.025, 0.15, 0.06, 0.18, 0.05, Math.PI / 2);
    part(head, SPH, pale, 0, -0.05, 0.09, 0.07, 0.04, 0.08);
    part(head, BOX, aglow(0x101018), 0, -0.02, 0.245, 0.03, 0.025, 0.02);
    const eyes = aEyes(head, 0.065, 0.025, 0.08, 0.022, aglow(0x7affff));
    const ears = [-1, 1].map(s => { const e = pv(head, s * 0.065, 0.07, -0.02, -0.1, 0, -s * 0.3); e.userData.rz0 = -s * 0.3; part(e, CONE4, fur, 0, 0.07, 0, 0.055, 0.15, 0.025); part(e, CONE4, dk, 0, 0.065, 0.01, 0.035, 0.11, 0.012); return e; });
    const t0 = pv(body, 0, 0.56, -0.36, -2.2); part(t0, SPH, fur, 0, 0.13, 0, 0.08, 0.16, 0.08);
    const t1 = pv(t0, 0, 0.26, 0, 0.35); part(t1, SPH, fur, 0, 0.1, 0, 0.1, 0.15, 0.1); part(t1, SPH, tipM, 0, 0.24, 0, 0.07, 0.09, 0.07);
    const legs = [[-0.09, 0.22, 0], [0.09, 0.22, Math.PI], [-0.09, -0.24, Math.PI], [0.09, -0.24, 0]].map(([x, z, ph]) => { const p = aLeg(g, x, 0.46, z, 0.44, 0.035, fur, dk); part(p, TAPR, dk, 0, -0.33, 0, 0.032, 0.2, 0.032); return { p, ph }; });
    g.userData.rig = { body, neck, nx0: 0.7, ngraze: 1.6, nrun: 0.3, head, hx0: -0.7, legs, tail: [t0, t1], wagA: 0.25, ears, eyes, stride: 5.5, swing: 0.65, bob: 0.03, sitTilt: true, sitDrop: 0.1, sleepDrop: 0.3 };
    return g;
}
function makeShroomling() {
    const cols = [[0xc06ad8, 0x2a0a3a], [0x6a8aff, 0x0a1a4a], [0xff7ad8, 0x3a0a2a], [0x7affd0, 0x0a3a2a]], [cc, ce] = cols[Math.floor(Math.random() * cols.length)];
    const g = new THREE.Group(), cap = amat(cc, ce), stem = amat(0xf2e8d8, 0x1a1418), gill = amat(0xe0d0c8), spot = aglow(0xffffff);
    const body = pv(g, 0, 0, 0);
    part(body, SPH, stem, 0, 0.17, 0, 0.11, 0.15, 0.1);
    const capP = pv(body, 0, 0.29, 0);
    part(capP, CAPG, cap, 0, 0, 0, 0.25, 0.18, 0.25);
    part(capP, CYL8, gill, 0, 0, 0, 0.24, 0.015, 0.24);
    for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.3, e = i === 5 ? 1.45 : 0.75; part(capP, SPH, spot, Math.cos(a) * Math.cos(e) * 0.25, Math.sin(e) * 0.18, Math.sin(a) * Math.cos(e) * 0.25, 0.035, 0.02, 0.035); }
    const eyes = aEyes(body, 0.045, 0.2, 0.09, 0.024);
    part(body, BOX, aglow(0x3a1a2a), 0, 0.14, 0.1, 0.03, 0.012, 0.01);
    for (const s of [-1, 1]) part(body, BOX, aglow(0xff9ab8), s * 0.07, 0.165, 0.085, 0.025, 0.012, 0.01);
    const legs = [-1, 1].map(s => { const p = pv(g, s * 0.05, 0.07, 0); part(p, SPH, stem, 0, -0.04, 0.01, 0.04, 0.035, 0.055); return { p, ph: s > 0 ? Math.PI : 0 }; });
    const arms = [-1, 1].map(s => { const a = pv(body, s * 0.1, 0.19, 0, 0, 0, s * 0.6); part(a, SPH, stem, 0, -0.04, 0, 0.025, 0.05, 0.025); return a; });
    g.userData.rig = { body, capP, eyes, legs, arms, stride: 9, swing: 0.7, capCol: cc };
    return g;
}
function makeSnail() {
    const g = new THREE.Group(), skin = amat(0xcfc0a8, 0x14100c), shell = amat(0x7a4ad8, 0x2a0a6a), band = aglow(0xc8a0ff), tip = aglow(0x9fffff);
    const foot = pv(g, 0, 0, 0);
    const segs = [[0.14, 0.065], [0, 0.075], [-0.14, 0.06]].map(([z, w]) => part(foot, SPH, skin, 0, 0.045, z, w, 0.045, 0.1));
    const head = pv(foot, 0, 0.07, 0.24);
    part(head, SPH, skin, 0, 0, 0, 0.055, 0.05, 0.065);
    const stalks = [-1, 1].map(s => { const p = pv(head, s * 0.025, 0.03, 0.02, -0.35, 0, -s * 0.25); part(p, BOX, skin, 0, 0.06, 0, 0.012, 0.12, 0.012); part(p, SPH, tip, 0, 0.125, 0, 0.018, 0.018, 0.018); return p; });
    for (const s of [-1, 1]) part(head, BOX, skin, s * 0.02, -0.02, 0.06, 0.008, 0.008, 0.05, 0.3);
    const sh = pv(foot, 0, 0.17, -0.04);
    part(sh, SPH, shell, 0, 0, 0, 0.14, 0.15, 0.14);
    part(sh, SPH, shell, 0, 0.07, -0.08, 0.08, 0.08, 0.07);
    for (const s of [-1, 1]) { part(sh, TOR, band, s * 0.1, 0, 0, 0.09, 0.09, 0.09, 0, Math.PI / 2, 0); part(sh, TOR, band, s * 0.12, 0.01, 0.01, 0.045, 0.045, 0.045, 0, Math.PI / 2, 0); }
    g.userData.rig = { foot, segs, head, stalks, sh };
    return g;
}
function makeMoth() {
    const pal = [[0xcff4ff, 0x6ad8ff], [0xe8d0ff, 0xa06aff], [0xb8fff0, 0x3affc8], [0xfff0c0, 0xffb060]][Math.floor(Math.random() * 4)];
    const g = new THREE.Group(), wm = aglow(pal[0], 0.92), wa = aglow(pal[1], 0.95), bodyM = amat(0x8a7aa0, 0x2a1a3a);
    part(g, SPH, bodyM, 0, 0, -0.02, 0.03, 0.03, 0.09);
    part(g, SPH, bodyM, 0, 0.005, 0.07, 0.028, 0.028, 0.03);
    for (const s of [-1, 1]) part(g, BOX, bodyM, s * 0.03, 0.03, 0.12, 0.006, 0.006, 0.09, -0.5, s * 0.5, 0);
    const mk = (s, fore) => { const p = pv(g, s * 0.015, 0.01, fore ? 0.02 : -0.02), w = fore ? [0.19, 0.13] : [0.14, 0.1], ry = s * (fore ? -0.25 : 0.35); part(p, BOX, wm, s * w[0] / 2, 0, fore ? 0.01 : -0.03, w[0], 0.006, w[1], 0, ry, 0); part(p, BOX, wa, s * w[0] * 0.62, 0.004, fore ? 0 : -0.04, w[0] * 0.3, 0.006, w[1] * 0.35, 0, ry, 0); return p; };
    g.scale.setScalar(1.6);
    g.userData.rig = { fw: [mk(-1, true), mk(1, true)], hw: [mk(-1, false), mk(1, false)] };
    return g;
}
function makeSalamander() {
    const g = new THREE.Group(), sk = amat(0x1e1612), belly = amat(0x4a2414), spot = aglow(0xff7a1a), eyeM = aglow(0xffd040);
    const root = pv(g, 0, 0.06, 0);
    const s0 = pv(root, 0, 0, 0.08); part(s0, SPH, sk, 0, 0, 0, 0.075, 0.05, 0.11); part(s0, SPH, belly, 0, -0.02, 0, 0.06, 0.03, 0.09);
    for (const s of [-1, 1]) part(s0, SPH, spot, s * 0.03, 0.04, 0.02, 0.02, 0.015, 0.02);
    const head = pv(s0, 0, 0.01, 0.12); part(head, SPH, sk, 0, 0, 0.04, 0.065, 0.04, 0.075); aEyes(head, 0.045, 0.025, 0.05, 0.016, eyeM, false);
    const chain = [s0], dims = [[0.08, 0.05, 0.11], [0.06, 0.042, 0.1], [0.045, 0.034, 0.1], [0.03, 0.025, 0.1], [0.018, 0.016, 0.09]];
    let prev = s0;
    dims.forEach((d, i) => { const p = pv(prev, 0, 0, i === 0 ? -0.14 : -0.15 + i * 0.01); part(p, SPH, sk, 0, 0, 0, d[0], d[1], d[2]); if (i < 3) for (const s of [-1, 1]) part(p, SPH, spot, s * d[0] * 0.45, d[1] * 0.75, s * 0.03, d[0] * 0.3, d[0] * 0.2, d[0] * 0.3); chain.push(p); prev = p; });
    const legs = [];
    for (const [seg, z] of [[s0, 0.03], [chain[1], -0.01]]) for (const s of [-1, 1]) { const p = pv(seg, s * 0.06, -0.01, z); part(p, BOX, sk, s * 0.045, 0, 0, 0.09, 0.022, 0.025); part(p, BOX, sk, s * 0.085, -0.03, 0.01, 0.02, 0.05, 0.02); part(p, BOX, sk, s * 0.09, -0.055, 0.02, 0.04, 0.008, 0.04); legs.push({ p, s, ph: (seg === s0) === (s > 0) ? 0 : Math.PI }); }
    g.scale.setScalar(1.25);
    g.userData.rig = { chain, head, legs };
    return g;
}
function makeBeetle() {
    const g = new THREE.Group(), shell = amat(0xff5a1a, 0x6a1a00), dk = amat(0x140c0a), seam = aglow(0xffc050), wingM = aglow(0xffd0a0, 0.45);
    const body = pv(g, 0, 0.07, 0);
    part(body, SPH, dk, 0, -0.01, -0.03, 0.1, 0.05, 0.14);
    part(body, SPH, dk, 0, 0, 0.11, 0.075, 0.05, 0.06);
    const head = pv(body, 0, 0, 0.17); part(head, SPH, dk, 0, 0, 0.02, 0.05, 0.035, 0.045);
    for (const s of [-1, 1]) { part(head, BOX, dk, s * 0.025, -0.01, 0.07, 0.012, 0.012, 0.05, 0, -s * 0.5, 0); part(head, BOX, dk, s * 0.03, 0.03, 0.08, 0.006, 0.006, 0.09, -0.6, s * 0.4, 0); }
    aEyes(head, 0.04, 0.01, 0.03, 0.012, aglow(0xffd040), false);
    const elytra = [-1, 1].map(s => { const p = pv(body, s * 0.004, 0.03, 0.08); part(p, SPH, shell, s * 0.055, 0.005, -0.1, 0.06, 0.045, 0.14); part(p, BOX, seam, s * 0.003, 0.045, -0.1, 0.006, 0.006, 0.24); return p; });
    const uw = [-1, 1].map(s => { const p = pv(body, s * 0.02, 0.03, 0.04); part(p, BOX, wingM, s * 0.1, 0, -0.05, 0.2, 0.004, 0.1, 0, s * 0.3, 0); p.visible = false; return p; });
    const legs = [];
    for (const z of [0.1, 0.02, -0.07]) for (const s of [-1, 1]) { const p = pv(body, s * 0.06, -0.02, z); part(p, BOX, dk, s * 0.05, 0, 0, 0.1, 0.014, 0.014, 0, 0, -s * 0.5); part(p, BOX, dk, s * 0.11, -0.045, 0, 0.014, 0.07, 0.014, 0, 0, -s * 0.2); legs.push({ p, s, ph: ((z > 0.05 || z < -0.05) === (s > 0)) ? 0 : Math.PI }); }
    g.scale.setScalar(1.4);
    g.userData.rig = { body, head, elytra, uw, legs };
    return g;
}
const crowMat = lamb(0x14121a);
function makeCrow() {
    const g = new THREE.Group(), beak = amat(0x2a262c), eyeM = aglow(0xff9a3a), leg = amat(0x2a2228);
    const body = pv(g, 0, 0, 0);
    part(body, SPH, crowMat, 0, 0.24, -0.02, 0.12, 0.12, 0.22);
    part(body, BOX, crowMat, 0, 0.23, -0.3, 0.13, 0.02, 0.2, -0.25);
    const head = pv(body, 0, 0.34, 0.16);
    part(head, SPH, crowMat, 0, 0.02, 0.02, 0.085, 0.08, 0.095);
    part(head, CONE6, beak, 0, 0.005, 0.15, 0.028, 0.12, 0.03, Math.PI / 2);
    aEyes(head, 0.055, 0.035, 0.06, 0.016, eyeM, false);
    const legs = [-1, 1].map(s => ({ p: aLeg(g, s * 0.04, 0.14, 0, 0.13, 0.012, leg, leg, 0.04), ph: s > 0 ? Math.PI : 0 }));
    const wings = [-1, 1].map(s => {
        const sh = pv(body, s * 0.1, 0.29, 0.04);
        part(sh, BOX, crowMat, s * 0.15, 0, 0, 0.3, 0.025, 0.22);
        const el = pv(sh, s * 0.29, 0, 0);
        part(el, BOX, crowMat, s * 0.12, 0, -0.03, 0.24, 0.02, 0.17);
        for (let f = 0; f < 4; f++) part(el, BOX, crowMat, s * (0.24 + f * 0.015), 0, 0.03 - f * 0.05, 0.13, 0.012, 0.04, 0, s * (0.2 - f * 0.13), 0);
        return { sh, el, s };
    });
    g.userData.rig = { body, head, legs, wings2: wings, stride: 8, swing: 0.6 };
    return g;
}
const batWingGeo = (() => { const sh = new THREE.Shape(); sh.moveTo(0, 0.04); sh.lineTo(0.18, 0.09); sh.lineTo(0.34, 0.05); sh.lineTo(0.4, -0.04); sh.lineTo(0.3, -0.02); sh.lineTo(0.24, -0.1); sh.lineTo(0.15, -0.05); sh.lineTo(0.07, -0.11); sh.lineTo(0, -0.06); sh.closePath(); const geo = new THREE.ShapeGeometry(sh); geo.rotateX(Math.PI / 2); return geo; })();
function makeBat(eyeCol = 0xff6a3a) {
    const g = new THREE.Group(), fur = amat(0x2a1a24), mem = amat(0x3a2230, 0, true);
    part(g, SPH, fur, 0, 0, 0, 0.05, 0.05, 0.08);
    const head = pv(g, 0, 0.02, 0.07); part(head, SPH, fur, 0, 0, 0.01, 0.04, 0.04, 0.04);
    for (const s of [-1, 1]) part(head, CONE4, fur, s * 0.025, 0.045, 0, 0.018, 0.045, 0.01, 0, 0, -s * 0.3);
    aEyes(head, 0.02, 0.01, 0.035, 0.009, aglow(eyeCol), false);
    const wings = [-1, 1].map(s => { const p = pv(g, s * 0.03, 0.01, 0.02); const m = new THREE.Mesh(batWingGeo, mem); m.scale.set(s, 1, 1); p.add(m); return { sh: p, el: null, s }; });
    g.scale.setScalar(2.4);
    g.userData.rig = { wings2: wings };
    return g;
}
// two-part wings: the shoulder beats and the wingtip follows a moment later. fold = 1 tucks them along the body
function flap2(R, ph, amp, dih = 0.1, fold = 0) {
    for (const w of R.wings2) {
        w.sh.rotation.y = w.s * 1.45 * fold;
        w.sh.rotation.z = w.s * ((Math.sin(ph) * amp + dih) * (1 - fold) - 0.1 * fold);
        if (w.el) { w.el.rotation.z = w.s * Math.sin(ph - 0.9) * amp * 0.7 * (1 - fold); w.el.rotation.y = w.s * 0.2 * fold; }
    }
}
// shared body language: walking legs, breathing, looking around, grazing, sitting, sleeping, tails, twitching ears, blinking
function animRig(c, sp, dt) {
    const R = c.g.userData.rig; if (!R) return;
    const k3 = Math.min(1, dt * 3);
    c.mv = (c.mv || 0) + ((sp > 0.1 ? 1 : 0) - (c.mv || 0)) * Math.min(1, dt * 8);
    c.gait = (c.gait || 0) + dt * sp * (R.stride || 4);
    c.sitK = (c.sitK || 0) + ((c.sit ? 1 : 0) - (c.sitK || 0)) * k3;
    c.slpK = (c.slpK || 0) + ((c.sleep ? 1 : 0) - (c.slpK || 0)) * k3;
    const amp = (R.swing || 0.55) * Math.min(1.5, 0.75 + sp * 0.08) * c.mv;
    if (R.legs) for (const L of R.legs) { const back = L.p.position.z < 0; L.p.rotation.x = Math.sin(c.gait + L.ph) * amp + (R.sitTilt ? (back ? -1.3 : 0) * c.sitK * (1 - c.slpK) + (back ? -1.4 : 1.4) * c.slpK : 0); }
    if (R.body) {
        R.body.position.y = Math.abs(Math.cos(c.gait)) * (R.bob || 0.03) * c.mv + Math.sin(c.ph * 1.7) * 0.006;
        if (R.sitTilt) R.body.rotation.x = -0.3 * c.sitK * (1 - c.slpK);
    }
    if (R.sitDrop) c.yOff -= R.sitDrop * c.sitK * (1 - c.slpK) + R.sleepDrop * c.slpK;
    if (R.neck) { const want = c.slpK > 0.5 || c.graze ? R.ngraze : R.nx0 + (c.mv > 0.5 ? (R.nrun || 0) * Math.min(1, sp / 5) : 0) - (c.alert ? 0.25 : 0); R.neck.rotation.x += (want - R.neck.rotation.x) * k3; }
    if (R.head) {
        c.lookT = (c.lookT || 0) - dt;
        if (c.lookT <= 0) { c.lookT = rand(0.8, 3.5); c.lookY = Math.random() < 0.35 ? 0 : rand(-0.8, 0.8); c.lookP = rand(-0.2, 0.2); }
        const wy = c.alert ? c.alertY : c.mv > 0.5 || c.graze ? 0 : c.lookY, wp = (R.hx0 || 0) + (c.graze ? 0.35 + Math.sin(c.ph * 6) * 0.06 : c.alert ? -0.15 : c.mv > 0.5 ? 0 : c.lookP);
        R.head.rotation.y += (wy - R.head.rotation.y) * Math.min(1, dt * 5);
        R.head.rotation.x += (wp - R.head.rotation.x) * Math.min(1, dt * 4);
    }
    if (R.tail) R.tail.forEach((t, i) => { t.rotation.y = Math.sin(c.ph * (R.wag || 3) - i * 0.7) * (R.wagA || 0.2) * (1 + c.mv) + c.slpK * 1.2; if (R.tailFlick) t.rotation.x = R.tailFlick - (c.alert || c.st === "flee" ? 1.1 : 0); });
    if (R.ears) {
        if (Math.random() < dt * 0.4) { c.twitch = 0.3; c.twI = Math.random() < 0.5 ? 0 : 1; }
        c.twitch = Math.max(0, (c.twitch || 0) - dt);
        R.ears.forEach((e, i) => { const s = i ? 1 : -1; e.rotation.z = e.userData.rz0 + (c.twitch > 0 && i === c.twI ? Math.sin(c.twitch * 45) * 0.3 : 0) + (c.alert ? s * 0.35 : 0) - c.slpK * s * 0.4; });
    }
    if (R.eyes) { c.blink = (c.blink === undefined ? rand(1, 4) : c.blink) - dt; if (c.blink <= -0.13) c.blink = rand(2, 6); const shut = c.blink < 0 || c.slpK > 0.6 || c.shut; R.eyes.forEach(e => (e.scale.y = shut ? 0.12 : 1)); }
}
// deer, goats and moon foxes: wander, graze, sit, stop and stare when you come near, bolt if you get too close
function grazerAI(c, dt, dp, px, pz, live, panic, night, P) {
    let sp = 0;
    if (!c.st) { c.st = "calm"; c.act = "stand"; }
    if (live && (dp < P.flee || panic) && c.st !== "flee") { c.st = "flee"; c.fleeT = rand(2.5, 4); c.dodge = 0; if (dp < 25) sfx(P.snort || 170, 0.18, "sawtooth", 0.03, 0.6); }
    else if (c.st === "calm" && live && dp < P.alert) { c.st = "alert"; c.alertT = rand(1.5, 3); if (P.bleat && dp < 20) sfx(520, 0.35, "sawtooth", 0.025, 0.8); }
    if (c.st === "flee") {
        c.fleeT -= dt;
        if (c.blocked) { c.dodge += (Math.random() < 0.5 ? 1 : -1) * 1.3; c.blocked = false; }
        c.dodge *= Math.max(0, 1 - dt * 0.6);
        const a = Math.atan2(c.x - px, c.z - pz) + c.dodge;
        c.runK = Math.min(1, (c.runK || 0) + dt * 2.5);
        sp = P.run * (panic ? 1.15 : 1) * (0.45 + 0.55 * c.runK);
        wStep(c, c.x + Math.sin(a) * 5, c.z + Math.cos(a) * 5, sp, dt);
        if (c.fleeT <= 0 && dp > P.flee * 1.8 && !panic) { c.st = "calm"; c.act = "stand"; c.t = rand(1, 3); c.hx = c.x; c.hz = c.z; c.runK = 0; }
    } else if (c.st === "alert") {
        c.alertT -= dt;
        const want = angDiff(Math.atan2(px - c.x, pz - c.z), c.g.rotation.y);
        if (Math.abs(want) > 1.1) c.g.rotation.y += Math.sign(want) * Math.min(Math.abs(want) - 1.1, dt * 1.5);
        c.alertY = clamp(want, -1.1, 1.1);
        if (c.alertT <= 0 || dp > P.alert * 1.25) { c.st = "calm"; c.act = "stand"; c.t = rand(0.5, 2); }
    } else {
        if (c.t <= 0) {
            const r = Math.random();
            if (r < 0.42) {
                c.act = "walk"; c.t = rand(4, 9);
                let by = -1e9;
                for (let k = 0; k < (P.climb ? 4 : 1); k++) { const a = Math.random() * 6.283, rr = rand(3, P.roam || 14), tx = c.hx + Math.cos(a) * rr, tz = c.hz + Math.sin(a) * rr, y = P.climb ? groundY(tx, tz) : 0; if (y > by) { by = y; c.tx = tx; c.tz = tz; } } // goats pick the highest ground they can see
            } else if (r < 0.75) { c.act = "graze"; c.t = rand(3, 8); }
            else if (P.sit && r < 0.9) { c.act = night ? "sleep" : "sit"; c.t = rand(6, 14); }
            else { c.act = "stand"; c.t = rand(1.5, 4); }
        }
        if (c.act === "walk") { sp = P.walk; if (wStep(c, c.tx, c.tz, sp, dt) < 0.4 || c.blocked) { c.act = "stand"; c.blocked = false; c.t = rand(1, 3); } }
    }
    c.alert = c.st === "alert";
    c.graze = c.st === "calm" && c.act === "graze";
    c.sit = c.st === "calm" && (c.act === "sit" || c.act === "sleep");
    c.sleep = c.st === "calm" && c.act === "sleep";
    animRig(c, sp, dt);
}
// rabbits and squirrels: little hops, sitting up, nibbling, darting away in zig-zags when scared
function hopperAI(c, dt, dp, px, pz, live, panic, P) {
    const R = c.g.userData.rig, scared = live && (dp < P.flee || panic);
    if (c.hop > 0) {
        c.hop -= dt;
        const k = clamp(1 - c.hop / c.hopLen, 0, 1);
        wStep(c, c.tx, c.tz, c.hopSp, dt);
        c.yOff = Math.sin(k * Math.PI) * c.hopH;
        R.body.rotation.x = -Math.cos(k * Math.PI) * 0.28; // nose up taking off, nose down landing
        c.sitUp = false;
    } else {
        R.body.rotation.x += ((c.sitUp ? -0.6 : 0) - R.body.rotation.x) * Math.min(1, dt * 8);
        if (scared && c.t > 0.12) c.t = 0.05 + Math.random() * 0.08;
        if (c.t <= 0) {
            let go = true; c.sitUp = false;
            if (scared) { const a = Math.atan2(c.x - px, c.z - pz) + rand(-0.8, 0.8); c.tx = c.x + Math.sin(a) * 3; c.tz = c.z + Math.cos(a) * 3; c.hopLen = 0.26; c.hopSp = P.run; c.hopH = 0.3; c.t = 0.04; }
            else if (Math.random() < 0.6) {
                const home = Math.hypot(c.x - c.hx, c.z - c.hz) > 10, a = home ? Math.atan2(c.hx - c.x, c.hz - c.z) + rand(-0.5, 0.5) : Math.random() * 6.283;
                c.tx = c.x + Math.sin(a) * 0.9; c.tz = c.z + Math.cos(a) * 0.9; c.hopLen = 0.3; c.hopSp = 3; c.hopH = 0.14; c.t = Math.random() < 0.5 ? 0.05 : rand(0.6, 2.5);
            } else { go = false; c.sitUp = Math.random() < (P.nibble ? 0.7 : 0.45); c.t = rand(1.5, 4.5); }
            if (go) c.hop = c.hopLen;
        }
    }
    if (R.arms) R.arms.forEach(a => (a.rotation.x = c.sitUp ? -1.2 + Math.sin(c.ph * 14) * 0.15 : 0.3));
    if (R.tailChain) R.tailChain.forEach((t, i) => { t.rotation.x = R.tail0[i] + Math.sin(c.ph * 2.2 - i * 0.8) * 0.12 + (c.hop > 0 ? 0.25 : 0); t.rotation.z = Math.sin(c.ph * 1.3 - i) * 0.12; });
    if (R.ears) R.ears.forEach(e => (e.rotation.x = (e.userData.rx0 || 0) - (c.hop > 0 ? 0.5 : 0)));
    c.alert = scared && c.hop <= 0 && !c.sitUp; if (c.alert) c.alertY = clamp(angDiff(Math.atan2(px - c.x, pz - c.z), c.g.rotation.y), -1, 1);
    if (c.sitUp && R.head) R.head.rotation.x = Math.sin(c.ph * 16) * 0.05; // nibbling
    animRig(c, 0, dt);
}
function marmotAI(c, dt, dp, px, pz, live) {
    const R = c.g.userData.rig;
    if (!c.st) c.st = "watch";
    if (c.hide > 0) { c.hide -= dt; c.sink = Math.min(1, (c.sink || 0) + dt * 5); if (c.hide <= 0) c.st = "watch"; }
    else {
        c.sink = Math.max(0, (c.sink || 0) - dt * 1.2);
        if (live && dp < 9 && c.sink < 0.2) { c.hide = rand(5, 9); if (dp < 22) { sfx(1900, 0.12, "sine", 0.04, 1.4); setTimeout(() => sfx(1700, 0.16, "sine", 0.03, 1.2), 140); } }
        else if (c.t <= 0) { c.st = Math.random() < 0.55 ? "forage" : "watch"; c.t = rand(2, 6); }
    }
    const watching = c.hide <= 0 && c.st === "watch", fwd = c.hide > 0 ? 0.2 : c.st === "forage" ? 1.05 : -0.05;
    R.body.rotation.x += (fwd - R.body.rotation.x) * Math.min(1, dt * 6);
    R.arms.forEach((a, i) => (a.rotation.x = c.st === "forage" && c.hide <= 0 ? 0.4 + Math.sin(c.ph * 9 + i * 3) * 0.35 : 0.7));
    c.alert = watching && live && dp < 20; if (c.alert) c.alertY = clamp(angDiff(Math.atan2(px - c.x, pz - c.z), c.g.rotation.y), -1.3, 1.3);
    if (c.st === "forage" && c.hide <= 0) { R.head.rotation.x = 0.4 + Math.sin(c.ph * 7) * 0.12; R.head.rotation.y = 0; }
    animRig(c, 0, dt);
    if (c.st === "forage" && c.hide <= 0) R.head.rotation.x = 0.4 + Math.sin(c.ph * 7) * 0.12;
    c.yOff = -c.sink * 0.8;
}
// eagles soar in wide circles, flap now and then, and sometimes glide low over the meadows. They never dive at anything
function eagleAI(c, dt, px, pz) {
    const R = c.g.userData.rig;
    if (!c.mode) { c.mode = "soar"; c.ang = c.ph; c.flapT = rand(2, 6); c.y = c.alt; }
    if (c.t <= 0) { c.t = rand(15, 35); c.mode = c.mode === "soar" && Math.random() < 0.5 ? "glide" : "soar"; }
    c.ang += c.spd * dt * (c.mode === "glide" ? 1.5 : 1);
    const x = c.cx + Math.cos(c.ang) * c.rad, z = c.cz + Math.sin(c.ang) * c.rad, want = c.mode === "glide" ? Math.max(groundY(x, z) + 14, 18) : c.alt;
    c.y += (want - c.y) * Math.min(1, dt * 0.3);
    const climbing = want - c.y > 2;
    c.g.position.set(x, c.y + Math.sin(c.ph * 0.5) * 1.2, z);
    c.g.rotation.set(climbing ? -0.12 : 0.04, -c.ang + (c.spd > 0 ? 0 : Math.PI), (c.spd > 0 ? -1 : 1) * 0.28);
    c.flapT -= dt;
    if (c.flapT <= 0) { c.flapT = climbing ? rand(0.6, 1.5) : rand(5, 11); c.flapping = rand(1.2, 2.4); }
    c.flapping = Math.max(0, (c.flapping || 0) - dt);
    if (c.flapping > 0) { c.fph = (c.fph || 0) + dt * 6.5; flap2(R, c.fph, 0.5, 0.05); } else flap2(R, 0, 0, 0.12 + Math.sin(c.ph * 0.7) * 0.03);
    const d = Math.hypot(x - px, z - pz);
    c.g.visible = d < 160;
    if (d < 60 && Math.random() < dt * 0.015) sfx(1500, 0.6, "sawtooth", 0.02, 0.6);
}
// shroomlings waddle about, hop with a puff of spores, and freeze (pretending to be mushrooms) when you come close
function shroomAI(c, dt, dp, live) {
    const R = c.g.userData.rig;
    let sp = 0;
    if (live && dp < 6.5) c.freeze = Math.max(c.freeze || 0, 1.5);
    if (c.freeze > 0) {
        c.freeze -= dt; c.crouch = Math.min(1, (c.crouch || 0) + dt * 6);
        if (c.freeze <= 0) c.peek = 1;
    } else {
        c.crouch = Math.max(0, (c.crouch || 0) - dt * 3);
        if (c.peek > 0) { c.peek -= dt; R.body.rotation.z = Math.sin(c.peek * 26) * 0.14 * c.peek; } // shakes itself off
        else if (c.t <= 0) {
            const r = Math.random();
            if (r < 0.5) { c.act = "walk"; const a = Math.random() * 6.283; c.tx = c.x + Math.sin(a) * 2.5; c.tz = c.z + Math.cos(a) * 2.5; c.t = rand(2, 4); }
            else if (r < 0.75) { c.act = "hop"; c.hopT = 0.38; c.t = rand(1, 2); }
            else { c.act = "idle"; c.t = rand(1.5, 4); }
        }
        if (c.act === "walk" && !(c.peek > 0)) { sp = 0.9; if (wStep(c, c.tx, c.tz, sp, dt) < 0.2) c.act = "idle"; R.body.rotation.z = Math.sin(c.gait || 0) * 0.14; }
        else if (!(c.peek > 0)) R.body.rotation.z *= 0.9;
        if (c.act === "hop" && c.hopT > 0) {
            c.hopT -= dt; const k = 1 - c.hopT / 0.38;
            c.yOff = Math.sin(k * Math.PI) * 0.28;
            R.body.scale.set(1 - Math.sin(k * Math.PI) * 0.1, 1 + Math.sin(k * Math.PI) * 0.18, 1 - Math.sin(k * Math.PI) * 0.1);
            if (c.hopT <= 0) { c.act = "idle"; burst(V3(c.x, groundY(c.x, c.z) + 0.1, c.z), 5, 1.2, [aglow(R.capCol), aglow(0xffffff)]); }
        }
    }
    const cr = c.crouch;
    if (!(c.act === "hop" && c.hopT > 0)) R.body.scale.set(1 + cr * 0.14, 1 - cr * 0.32, 1 + cr * 0.14);
    R.capP.rotation.x = Math.sin(c.ph * 2) * 0.05;
    R.arms.forEach((a, i) => (a.rotation.z = (i ? 1 : -1) * (0.6 - cr * 0.55) + Math.sin(c.ph * 3 + i) * 0.12));
    c.shut = cr > 0.5;
    animRig(c, sp, dt);
}
function snailAI(c, dt, dp) {
    const R = c.g.userData.rig;
    if (c.t <= 0) { c.t = rand(4, 10); const a = Math.random() * 6.283; c.tx = c.x + Math.sin(a) * 2; c.tz = c.z + Math.cos(a) * 2; c.go = Math.random() < 0.75; }
    const shy = dp < 2.2; // pull the eye stalks in when you lean over it
    if (c.go && !shy && wStep(c, c.tx, c.tz, 0.22, dt) < 0.1) c.go = false;
    R.segs.forEach((s, i) => (s.scale.z = 0.1 * (1 + (c.go && !shy ? Math.sin(c.ph * 5 - i * 1.4) * 0.16 : 0))));
    R.stalks.forEach((s, i) => { s.rotation.x = -0.35 + Math.sin(c.ph * 1.3 + i * 2) * 0.2; s.rotation.z = (i ? -1 : 1) * 0.25 + Math.sin(c.ph * 0.9 + i) * 0.15; s.scale.y += ((shy ? 0.25 : 1) - s.scale.y) * Math.min(1, dt * 6); });
    R.head.rotation.y = Math.sin(c.ph * 0.5) * 0.3;
}
// ember beetles skitter on six legs, and now and then pop their shells and buzz off a few metres
function beetleAI(c, dt, dp, live, panic) {
    const R = c.g.userData.rig;
    let sp = 0;
    if (c.fly > 0) {
        c.fly -= dt;
        const k = 1 - c.fly / c.flyLen;
        wStep(c, c.tx, c.tz, 2.4, dt);
        c.yOff = Math.sin(k * Math.PI) * 0.9;
    } else {
        if ((live && dp < 2.8) || (panic && Math.random() < dt) || (c.t <= 0 && Math.random() < 0.12)) {
            c.flyLen = c.fly = rand(1.2, 2); const a = Math.random() * 6.283; c.tx = c.x + Math.sin(a) * 4; c.tz = c.z + Math.cos(a) * 4; c.t = rand(2, 5);
            if (dp < 14) sfx(160, 0.5, "sawtooth", 0.02, 1.1);
        } else if (c.t <= 0) { c.t = rand(2, 6); const a = Math.random() * 6.283; c.tx = c.x + Math.sin(a) * 1.5; c.tz = c.z + Math.cos(a) * 1.5; c.go = Math.random() < 0.7; }
        if (c.go) { sp = 0.55; if (wStep(c, c.tx, c.tz, sp, dt) < 0.1) c.go = false; }
    }
    c.open = (c.open || 0) + ((c.fly > 0 ? 1 : 0) - (c.open || 0)) * Math.min(1, dt * 10);
    R.elytra.forEach((e, i) => { const s = i ? 1 : -1; e.rotation.z = s * 0.9 * c.open; e.rotation.x = -0.4 * c.open; });
    R.uw.forEach((w, i) => { w.visible = c.open > 0.3; w.rotation.z = (i ? 1 : -1) * Math.sin(c.ph * 60) * 0.5; });
    c.mv = (c.mv || 0) + ((sp > 0.05 ? 1 : 0) - (c.mv || 0)) * Math.min(1, dt * 8);
    c.gait = (c.gait || 0) + dt * sp * 30;
    R.legs.forEach(L => { L.p.rotation.y = Math.sin(c.gait + L.ph) * 0.45 * c.mv; L.p.rotation.z = L.s * 0.6 * c.open; });
    R.head.rotation.y = Math.sin(c.ph * 1.7) * 0.15;
}
// salamanders dart in quick bursts, body and tail swinging side to side, and freeze between dashes
function salamanderAI(c, dt, dp, px, pz, live, panic) {
    const R = c.g.userData.rig, fleeing = (live && dp < 6) || panic;
    if (c.t <= 0) {
        if (fleeing) { const a = Math.atan2(c.x - px, c.z - pz) + rand(-0.7, 0.7); c.tx = c.x + Math.sin(a) * 3; c.tz = c.z + Math.cos(a) * 3; c.dash = rand(0.35, 0.5); c.dsp = 7; c.t = c.dash; }
        else if (Math.random() < 0.55) { const a = Math.random() * 6.283; c.tx = c.x + Math.sin(a) * 2; c.tz = c.z + Math.cos(a) * 2; c.dash = rand(0.3, 0.8); c.dsp = 2.6; c.t = c.dash + rand(0.8, 2.5); }
        else { c.dash = 0; c.t = rand(1, 3.5); }
    }
    let sp = 0;
    if (c.dash > 0) { c.dash -= dt; sp = c.dsp; wStep(c, c.tx, c.tz, sp, dt); }
    c.mv = (c.mv || 0) + ((sp > 0 ? 1 : 0) - (c.mv || 0)) * Math.min(1, dt * 10);
    c.gait = (c.gait || 0) + dt * sp * 9;
    R.chain.forEach((s, i) => (s.rotation.y = Math.sin(c.gait - i * 0.9) * 0.35 * c.mv + Math.sin(c.ph * 1.1 - i * 0.7) * 0.06));
    R.legs.forEach(L => { L.p.rotation.y = Math.sin(c.gait + L.ph) * 0.7 * c.mv; L.p.rotation.z = L.s * Math.max(0, Math.cos(c.gait + L.ph)) * 0.35 * c.mv; });
    R.head.rotation.y = c.mv < 0.2 ? Math.sin(c.ph * 0.8) * 0.35 : 0;
}
function mothAI(c, dt, dp, px, pz, night) {
    const R = c.g.userData.rig, lamp = night && player.lantern && dp < 14;
    const cx = lamp ? px : c.hx, cz = lamp ? pz : c.hz, cy = lamp ? player.pos.y + 0.2 : groundY(c.hx, c.hz) + 1.4;
    const t = c.ph * (lamp ? 1.1 : 0.5), r = lamp ? 1.6 + Math.sin(c.ph) * 0.5 : 2.4;
    const tx = cx + Math.cos(t + c.hx) * r, tz = cz + Math.sin(t * 1.3 + c.hz) * r, ty = cy + Math.sin(t * 2.3) * 0.5, P = c.g.position, ox = P.x, oz = P.z;
    P.x += (tx - P.x) * Math.min(1, 2 * dt); P.z += (tz - P.z) * Math.min(1, 2 * dt); P.y += (ty - P.y) * Math.min(1, 2 * dt);
    if (Math.hypot(P.x - ox, P.z - oz) > 1e-4) c.g.rotation.y += angDiff(Math.atan2(P.x - ox, P.z - oz), c.g.rotation.y) * Math.min(1, dt * 6);
    c.x = P.x; c.z = P.z;
    R.fw.forEach((w, i) => (w.rotation.z = (i ? 1 : -1) * (Math.sin(c.ph * 22) * 0.8 + 0.25)));
    R.hw.forEach((w, i) => (w.rotation.z = (i ? 1 : -1) * (Math.sin(c.ph * 22 - 0.5) * 0.7 + 0.25)));
}
function butterflyAI(c, dt) {
    const P = c.g.position;
    c.g.visible = dayAmt() > 0.45 && wx.rain < 0.3;
    if (!c.v) { c.v = new THREE.Vector3(); P.y = groundY(c.x, c.z) + 1; c.t = 0; }
    if (c.t <= 0) { c.t = rand(1.5, 4); c.land = Math.random() < 0.3; const gx = c.hx + rand(-3, 3), gz = c.hz + rand(-3, 3); c.goal = V3(gx, groundY(gx, gz) + (c.land ? 0.5 : rand(0.6, 1.9)), gz); }
    const d = c.goal.clone().sub(P), dl = d.length(), landed = c.land && dl < 0.15;
    if (landed) { c.v.set(0, 0, 0); c.g.userData.wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * (0.9 + Math.sin(c.ph * 2) * 0.5))); return; }
    c.v.addScaledVector(d, dt * 3 / Math.max(0.5, dl)).multiplyScalar(Math.max(0, 1 - dt * 1.8));
    c.v.y += Math.sin(c.ph * 9) * dt * 2;
    P.addScaledVector(c.v, dt);
    if (c.v.lengthSq() > 0.01) c.g.rotation.y = Math.atan2(c.v.x, c.v.z);
    c.x = P.x; c.z = P.z;
    c.g.userData.wings.forEach((w, i) => (w.rotation.z = Math.sin(c.ph * 18) * 0.95 * (i ? -1 : 1)));
}
// ash crows: hop, peck and look about; burst into the air when you come close, circle, then glide back down somewhere else
function crowAI(c, dt, dp, px, pz, live, panic) {
    const R = c.g.userData.rig;
    if (c.state === "fly" || c.state === "land") {
        if (c.state === "fly") {
            c.fly -= dt; c.ang += dt * 0.7 * c.dir;
            const x = c.cx + Math.cos(c.ang) * 11, z = c.cz + Math.sin(c.ang) * 11;
            c.y += (groundY(x, z) + 9 - c.y) * Math.min(1, dt * 1.5);
            c.g.position.set(x, c.y, z); c.g.rotation.set(0, -c.ang + (c.dir > 0 ? 0 : Math.PI), -c.dir * 0.3);
            c.fph = (c.fph || 0) + dt * 10; flap2(R, c.fph, 0.6, 0.05);
            if (c.fly <= 0 && !panic) { const p = wildSpot(); if (p) { c.lx = p.x; c.lz = p.z; c.state = "land"; } else c.fly = 3; }
        } else {
            const P = c.g.position, gy = groundY(c.lx, c.lz), dx = c.lx - P.x, dz = c.lz - P.z, dh = Math.hypot(dx, dz);
            const m = Math.min(dh, 8 * dt); if (dh > 0.01) { P.x += dx / dh * m; P.z += dz / dh * m; c.g.rotation.set(0.15, Math.atan2(dx, dz), 0); }
            c.y += (gy + Math.min(9, dh * 0.5) - c.y) * Math.min(1, dt * 2.5); P.y = c.y;
            c.fph = (c.fph || 0) + dt * (dh < 2 ? 14 : 3); flap2(R, c.fph, dh < 2 ? 0.7 : 0.15, 0.2);
            if (dh < 0.2) { c.state = "idle"; c.x = c.lx; c.z = c.lz; c.g.rotation.set(0, c.g.rotation.y, 0); }
        }
        c.x = c.g.position.x; c.z = c.g.position.z;
        return true;
    }
    if ((live && dp < 8) || panic) { c.state = "fly"; c.fly = rand(6, 11); c.dir = Math.random() < 0.5 ? 1 : -1; c.ang = Math.random() * 6.283; c.cx = c.x - Math.cos(c.ang) * 11; c.cz = c.z - Math.sin(c.ang) * 11; c.y = groundY(c.x, c.z); if (dp < 22) sfx(420, 0.2, "sawtooth", 0.04, 0.6); return true; }
    flap2(R, 0, 0, 0, 1);
    if (c.t <= 0) { const r = Math.random(); c.act = r < 0.35 ? "hop" : r < 0.7 ? "peck" : r < 0.85 ? "caw" : "look"; c.t = c.act === "hop" ? 0.3 : rand(0.8, 2.2); if (c.act === "hop") { const a = Math.random() * 6.283; c.tx = c.x + Math.sin(a) * 0.6; c.tz = c.z + Math.cos(a) * 0.6; } if (c.act === "caw" && dp < 25) sfx(380, 0.18, "sawtooth", 0.03, 0.55); }
    if (c.act === "hop") { wStep(c, c.tx, c.tz, 2, dt); c.yOff = Math.sin(clamp(1 - c.t / 0.3, 0, 1) * Math.PI) * 0.12; }
    R.head.rotation.x = c.act === "peck" ? (Math.sin(c.ph * 12) > 0.3 ? 0.9 : 0.1) : c.act === "caw" ? -0.6 : 0;
    if (c.act === "look" && Math.random() < dt * 3) R.head.rotation.y = rand(-1, 1); // jerky little head turns
    return false;
}
// circling flyers: bats by night, crows by day
function skyAI(c, dt, px, pz, night) {
    const R = c.g.userData.rig, show = c.night ? night : !night;
    c.g.visible = show && Math.hypot(c.g.position.x - px, c.g.position.z - pz) < 140;
    if (!show) return;
    const bat = c.kind === "bat";
    c.ang = (c.ang ?? c.ph) + c.spd * dt * (bat ? 2.2 : 1);
    const wob = bat ? Math.sin(c.ph * 2.3) * 4 : 0, x = c.cx + Math.cos(c.ang) * (c.rad + wob), z = c.cz + Math.sin(c.ang) * (c.rad + wob);
    c.g.position.set(x, c.alt + Math.sin(c.ph * (bat ? 3.1 : 0.7)) * (bat ? 1.5 : 2), z);
    c.g.rotation.set(0, -c.ang + (c.spd > 0 ? 0 : Math.PI), (c.spd > 0 ? -1 : 1) * 0.25);
    if (bat) flap2(R, c.ph * 20, 0.9, 0); else flap2(R, c.ph * 9, Math.sin(c.ph * 0.5) > 0 ? 0.55 : 0.06, 0.1);
}
function addWild(n, kind, g, x, z, extra = {}) {
    g.rotation.order = "YXZ"; g.rotation.y = Math.random() * 6.283;
    g.position.set(x, groundY(x, z), z); scene.add(g);
    const c = Object.assign({ kind, g, x, z, hx: x, hz: z, ph: Math.random() * 6, t: Math.random() * 3, state: "idle", tx: x, tz: z, hide: 0, yOff: 0 }, extra);
    wildBy[n].push(c); return c;
}
function populate(n) {
    const P = (count, fn) => { for (let i = 0; i < count; i++) { const p = wildSpot(); if (p) fn(p.x, p.z); } };
    const sky = (k, mk, count, alt, extra = {}) => { for (let i = 0; i < count; i++) addWild(n, k, mk(), rand(-60, 60), rand(-60, 60), Object.assign({ cx: rand(-60, 60), cz: rand(-60, 60), rad: rand(25, 70), spd: rand(0.05, 0.11) * (Math.random() < 0.5 ? 1 : -1), alt: rand(alt[0], alt[1]) }, extra)); };
    if (n === 1) {
        P(6, (x, z) => addWild(n, "deer", makeDeer(), x, z, { tilt: 0.5 }));
        P(11, (x, z) => addWild(n, "rabbit", makeRabbit(), x, z));
        P(10, (x, z) => addWild(n, "squirrel", makeSquirrel(), x, z));
    } else if (n === 2) {
        P(9, (x, z) => addWild(n, "goat", makeGoat(), x, z, { tilt: 0.4 }));
        P(12, (x, z) => { addWild(n, "marmot", makeMarmot(), x, z); const mound = new THREE.Mesh(SPH, amat(0x6a5236)); mound.scale.set(0.5, 0.14, 0.5); mound.position.set(x, groundY(x, z) - 0.02, z); scene.add(mound); const hole = new THREE.Mesh(CYL8, aglow(0x140c06)); hole.scale.set(0.22, 0.02, 0.22); hole.position.set(x, groundY(x, z) + 0.12, z); scene.add(hole); });
        P(12, (x, z) => addWild(n, "butterfly", makeButterfly(), x, z));
        P(8, (x, z) => addWild(n, "rabbit", makeRabbit(), x, z));
        sky("eagle", makeEagle, 4, [34, 46]);
    } else if (n === 3) {
        P(7, (x, z) => addWild(n, "fox", makeFox(), x, z, { tilt: 0.3 }));
        P(14, (x, z) => addWild(n, "shroom", makeShroomling(), x, z));
        P(16, (x, z) => addWild(n, "snail", makeSnail(), x, z));
        P(22, (x, z) => addWild(n, "moth", makeMoth(), x, z));
        sky("bat", () => makeBat(0xc87aff), 6, [10, 20], { night: true });
    } else if (n === 4) {
        P(14, (x, z) => addWild(n, "salamander", makeSalamander(), x, z));
        P(18, (x, z) => addWild(n, "beetle", makeBeetle(), x, z));
        P(10, (x, z) => addWild(n, "crow", makeCrow(), x, z));
        sky("bat", () => makeBat(0xff6a3a), 8, [14, 26], { night: true });
        sky("skycrow", makeCrow, 5, [20, 32], { day: true });
    } else if (n === 5) { // crabs scuttling, gulls on the sand and over the water
        P(14, (x, z) => addWild(n, "crab5", makeCrab(), x, z));
        P(10, (x, z) => addWild(n, "butterfly", makeButterfly(), x, z));
    }
}
function buildWild(n) {
    wildDone[n] = true;
    const prev = addTgt; addTgt = isleGroup(n);
    decorate(n); populate(n);
    addTgt = prev;
}
// a step that refuses to walk into water, lava, camp or landmarks
function wStep(c, tx, tz, sp, dt) {
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz) || 1, m = Math.min(d, sp * dt), nx = c.x + dx / d * m, nz = c.z + dz / d * m;
    if (wildOk(nx, nz, true)) { c.x = nx; c.z = nz; } else { c.t = 0; c.blocked = true; }
    c.g.rotation.y += angDiff(Math.atan2(dx, dz), c.g.rotation.y) * Math.min(1, 8 * dt);
    return d;
}
// beach crabs: wander a little, scuttle off when you come close
function crab5AI(c, dt, dp, px, pz, live) {
    if (live && dp < 5) { const ax = c.x - px, az = c.z - pz, l = Math.hypot(ax, az) || 1; wStep(c, c.x + ax / l * 3, c.z + az / l * 3, 3.6, dt); return; }
    if (c.t <= 0) { c.t = rand(1.5, 5); c.tx = c.x + rand(-3, 3); c.tz = c.z + rand(-3, 3); }
    if (c.tx !== undefined && Math.hypot(c.tx - c.x, c.tz - c.z) > 0.2) wStep(c, c.tx, c.tz, 1.1, dt);
}
const SMALL_WILD = { crab5: 1, rabbit: 1, squirrel: 1, marmot: 1, shroom: 1, snail: 1, beetle: 1, salamander: 1, moth: 1, butterfly: 1, crow: 1 };
function updateWild(dt) {
    if (!wildDone[isle]) buildWild(isle);
    const list = wildBy[isle], px = player.pos.x, pz = player.pos.z, night = dayAmt() < 0.25, live = state === "playing", panic = isle === 4 && eruptLeft > 0;
    crowMat.color.setHex(night ? 0x2a1a2a : 0x14121a);
    for (const c of list) {
        const dp = Math.hypot(px - c.x, pz - c.z);
        if (c.kind === "eagle") { c.t -= dt; c.ph += dt; eagleAI(c, dt, px, pz); continue; }
        if (c.kind === "bat" || c.kind === "skycrow") { c.ph += dt; skyAI(c, dt, px, pz, night); continue; }
        const far = dp > (SMALL_WILD[c.kind] ? 55 : 95);
        c.g.visible = !far; if (far) continue;
        c.t -= dt; c.ph += dt; c.yOff = 0;
        switch (c.kind) {
            case "deer": grazerAI(c, dt, dp, px, pz, live, panic, night, { alert: 22, flee: 12, walk: 1.3, run: 8, roam: 16 }); break;
            case "goat": grazerAI(c, dt, dp, px, pz, live, panic, night, { alert: 16, flee: 8.5, walk: 1.1, run: 6.2, roam: 14, climb: true, bleat: true, snort: 300 }); break;
            case "fox": grazerAI(c, dt, dp, px, pz, live, panic, night, { alert: 18, flee: 9.5, walk: 1.6, run: 8.5, roam: 18, sit: true, snort: 600 }); break;
            case "rabbit": hopperAI(c, dt, dp, px, pz, live, panic, { flee: 7, run: 8 }); break;
            case "squirrel": hopperAI(c, dt, dp, px, pz, live, panic, { flee: 6, run: 6.5, nibble: true }); break;
            case "marmot": marmotAI(c, dt, dp, px, pz, live); break;
            case "shroom": shroomAI(c, dt, dp, live); break;
            case "snail": snailAI(c, dt, dp); break;
            case "beetle": beetleAI(c, dt, dp, live, panic); break;
            case "crab5": crab5AI(c, dt, dp, px, pz, live); break;
            case "salamander": salamanderAI(c, dt, dp, px, pz, live, panic); break;
            case "moth": mothAI(c, dt, dp, px, pz, night); continue;
            case "butterfly": butterflyAI(c, dt); continue;
            case "crow": if (crowAI(c, dt, dp, px, pz, live, panic)) continue; break;
        }
        c.g.position.set(c.x, groundY(c.x, c.z) + c.yOff, c.z);
        if (c.tilt) { // lean with the slope
            const h = c.g.rotation.y, sx = Math.sin(h) * c.tilt, sz = Math.cos(h) * c.tilt;
            const pitch = -Math.atan2(groundY(c.x + sx, c.z + sz) - groundY(c.x - sx, c.z - sz), 2 * c.tilt);
            c.g.rotation.x += (clamp(pitch, -0.5, 0.5) - c.g.rotation.x) * Math.min(1, dt * 6);
        }
    }
    updateFireflies(dt, night);
}

// ---------- fireflies by night (glowing spores on Mooncap, drifting embers on Ashfall) ----------
const flyMat = new THREE.MeshBasicMaterial({ color: 0xd8ff6a, transparent: true, opacity: 0.9, depthWrite: false });
const fireflies = [];
for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(BOX, flyMat); m.scale.setScalar(0.1); m.visible = false; scene.add(m); fireflies.push({ m, x: 0, z: 0, y: 0, ph: Math.random() * 6, life: 0 }); }
function updateFireflies(dt, night) {
    const embers = isle === 4, on = embers || isle === 3 || night;
    flyMat.color.setHex(embers ? 0xff8a2a : isle === 3 ? 0x9ffff0 : 0xd8ff6a);
    flyMat.opacity = 0.55 + 0.4 * Math.sin(time * 4);
    for (const f of fireflies) {
        if (!on || insideBuilding()) { f.m.visible = false; f.life = 0; continue; }
        f.life -= dt; f.ph += dt;
        if (f.life <= 0) { const a = Math.random() * 6.283, r = rand(4, 24); f.x = player.pos.x + Math.cos(a) * r; f.z = player.pos.z + Math.sin(a) * r; f.y = groundY(f.x, f.z) + rand(0.4, 2.2); f.life = rand(4, 9); }
        if (embers) f.y += dt * 0.6; // embers drift upward
        f.m.visible = true;
        f.m.position.set(f.x + Math.sin(f.ph * 0.9) * 0.6, f.y + Math.sin(f.ph * 1.7) * 0.25, f.z + Math.cos(f.ph * 0.7) * 0.6);
        f.m.scale.setScalar(0.1 * Math.min(1, f.life));
    }
}

// ---------- mutation effects: sparkles, snow, embers, sparks, stars, and the odd crackle of lightning ----------
const mutParts = [], mutBolts = [];
{
    const m0 = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < 110; i++) { const m = new THREE.Mesh(BOX, m0); m.visible = false; scene.add(m); mutParts.push({ m, life: 0 }); }
    const bm = new THREE.MeshBasicMaterial({ color: 0xffffa0, transparent: true, opacity: 0.95, depthWrite: false });
    for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(BOX, bm); m.visible = false; scene.add(m); mutBolts.push({ m, life: 0 }); }
}
function mutEmit(t, M) {
    const p = mutParts.find(q => q.life <= 0); if (!p) return;
    const mode = M.mode, a = Math.random() * 6.283, rr = t.r * rand(1, 3.2);
    p.m.material = mutMat(t.mut).fx; p.mode = mode; p.life = p.max = rand(1.2, 2.4);
    const y = mode === "snow" || mode === "drip" ? t.gy + t.h * rand(0.75, 1.2) : mode === "ember" || mode === "dust" ? t.gy + rand(0.2, t.h * 0.7) : t.gy + t.h * rand(0.5, 1.2);
    p.m.position.set(t.x + Math.cos(a) * rr, y, t.z + Math.sin(a) * rr);
    p.vy = { snow: -0.6, drip: -2.2, ember: 1.5, dust: 0.25, stars: 0.08, zap: 0.5, sparkle: 0.35 }[mode];
    p.s = mode === "stars" ? 0.16 : mode === "drip" ? 0.07 : mode === "dust" ? 0.12 : 0.09;
    p.m.visible = true; p.m.scale.setScalar(p.s);
}
function mutZap(t, d) {
    const b = mutBolts.find(q => q.life <= 0); if (!b) return;
    const a1 = Math.random() * 6.283, a2 = a1 + rand(1.5, 3), r = t.r * 2.4;
    const p1 = V3(t.x + Math.cos(a1) * r, t.gy + t.h * rand(0.5, 1.1), t.z + Math.sin(a1) * r), p2 = V3(t.x + Math.cos(a2) * r, t.gy + t.h * rand(0.5, 1.1), t.z + Math.sin(a2) * r);
    b.m.position.copy(p1).add(p2).multiplyScalar(0.5); b.m.lookAt(p2); b.m.scale.set(0.05, 0.05, p1.distanceTo(p2)); b.m.visible = true; b.life = 0.09;
    if (d < 22) sfx(1800 + Math.random() * 800, 0.05, "square", 0.02, 0.3);
}
function updateMutFx(dt) {
    if (mutMats.rainbow) { const h = (time * 0.15) % 1; mutMats.rainbow.leaf.color.setHSL(h, 0.85, 0.6); mutMats.rainbow.leaf.emissive.setHSL(h, 0.8, 0.12); }
    for (const k of MUT_KEYS) if (MUTS[k].pulse && mutMats[k] && mutMats[k].leaf) mutMats[k].leaf.emissiveIntensity = k === "shocked" ? (Math.random() < 0.08 ? 2.2 : 0.8) : 0.75 + 0.45 * Math.sin(time * 3 + MUT_KEYS.indexOf(k));
    for (const t of trees) {
        if (!t.mut || t.gone || t.dying || t.burn) continue;
        const d = Math.hypot(t.x - player.pos.x, t.z - player.pos.z); if (d > 55) continue;
        const M = MUTS[t.mut];
        t.fxT -= dt;
        if (t.fxT <= 0) { t.fxT = M.mode === "stars" ? 0.1 : M.mode === "dust" ? 0.3 : 0.18; mutEmit(t, M); }
        if (M.mode === "zap" && Math.random() < dt * 0.9) mutZap(t, d);
    }
    for (const p of mutParts) if (p.life > 0) {
        p.life -= dt; p.m.position.y += p.vy * dt;
        if (p.mode === "snow") p.m.position.x += Math.sin(time * 2 + p.life * 3) * 0.3 * dt;
        const k = p.life / p.max;
        p.m.scale.setScalar(p.s * (p.mode === "stars" ? Math.abs(Math.sin(p.life * 9)) : Math.min(1, k * 3)));
        p.m.rotation.y += dt * 3; p.m.rotation.x += dt * 2;
        if (p.life <= 0) p.m.visible = false;
    }
    for (const b of mutBolts) if (b.life > 0) { b.life -= dt; if (b.life <= 0) b.m.visible = false; }
}
function mutFelled(t) {
    const M = MUTS[t.mut];
    save.mutDex = save.mutDex || {};
    const first = !save.mutDex[t.mut];
    save.mutDex[t.mut] = (save.mutDex[t.mut] || 0) + 1;
    const p = V3(t.x, t.gy + Math.min(t.h * 0.6, 4), t.z);
    burst(p, 34, 7, [mutMat(t.mut).fx, ornMat(0xffffff)]);
    floatWorld(V3(t.x, t.gy + Math.min(t.h * 0.9, 6), t.z), "×" + M.mult + " " + M.name, "cash");
    sfx(880, 0.15, "triangle", 0.1, 1.5); setTimeout(() => sfx(1320, 0.25, "triangle", 0.09, 1.3), 120); setTimeout(() => sfx(1760, 0.35, "sine", 0.07, 1.2), 240);
    if (first) titleCard(`NEW MUTATION: ${M.name}`, `×${M.mult} drops · ${Object.keys(save.mutDex).length} / ${MUT_KEYS.length} discovered`);
    else toast(`✦ ${M.name} ${t.type.name} felled: ×${M.mult} drops!`, "rare");
}

// ---------- the enchanting table's own window ----------
const ENCH_ICON = { sharp: "⚔", swift: "➶", fortune: "✤", vamp: "♥", bane: "☠" };
const ENCH_COL = { sharp: "#ff8a6a", swift: "#7fe8ff", fortune: "#ffd040", vamp: "#ff6a9a", bane: "#c8a0ff" };
let enchSel = 0;
const enchList = i => Object.entries(save.ench[i] || {}).filter(([, l]) => l > 0);
const enchTotal = i => enchList(i).reduce((a, [, l]) => a + l, 0);
const enchShort = i => enchList(i).map(([k, l]) => ENCH[k].name + " " + ROMAN[l]).join(" · ");
function openEnch(say) {
    enchSel = save.owned[save.equipped] ? save.equipped : 0;
    $("enchSay").textContent = say ? "“" + say + "”" : "";
    openPanel("ench");
}
function renderEnch() {
    $("enchCash").textContent = money(save.money);
    if (!save.owned[enchSel]) enchSel = save.equipped;
    const i = enchSel, a = AXES[i], list = enchList(i);
    const axesHtml = AXES.map((x, j) => save.owned[j] ? `<button class="eaxe ${j === i ? "on" : ""}" data-eaxe="${j}" style="--c:${x.rarity}"><img src="${iconURL("a" + j)}"><span>${x.name}</span>${enchTotal(j) ? `<em>✦${enchTotal(j)}</em>` : ""}</button>` : "").join("");
    const showHtml = `<div class="eshow ${list.length ? "glint" : ""}" style="--c:${a.rarity}"><div class="eframe"><img src="${iconURL("a" + i)}"></div><b style="color:${a.rarity}">${a.name}</b><div class="edmg">${axeDmgFor(i)} <small>dmg per swing</small></div>${list.length ? `<div class="elist">${list.map(([k, l]) => `<div style="color:${ENCH_COL[k]}"><span>${ENCH_ICON[k]}</span> ${ENCH[k].name} ${ROMAN[l]}<small>${ENCH[k].desc(l)}</small></div>`).join("")}</div>` : `<div class="enone">No enchantments yet.<br>Pick a rune →</div>`}</div>`;
    const runes = Object.entries(ENCH).map(([k, E]) => {
        const lv = enchLv(k, i), max = lv >= E.max, cost = max ? 0 : enchCost(k, lv, i), can = !max && save.money >= cost;
        const pips = Array.from({ length: E.max }, (_, n) => `<i class="${n < lv ? "on" : ""}"></i>`).join("");
        return `<div class="rune ${max ? "max" : can ? "ok" : "no"}" data-ench="${k}" style="--c:${ENCH_COL[k]}"><div class="rg">${ENCH_ICON[k]}</div><div class="ri"><b>${E.name} ${ROMAN[max ? lv : lv + 1]}</b><span class="pips">${pips}</span><small>${max ? E.desc(lv) + " · MAXED" : (lv ? "now " + E.desc(lv) + " → " : "") + E.desc(lv + 1)}</small></div><div class="rc">${max ? "MAX" : money(cost)}</div></div>`;
    }).join("");
    for (const [id, h] of [["enchAxes", axesHtml], ["enchShow", showHtml], ["enchRunes", runes]]) if ($(id).dataset.h !== h) { $(id).innerHTML = h; $(id).dataset.h = h; }
}
function buyEnch(k) {
    const i = enchSel, E = ENCH[k], lv = enchLv(k, i);
    if (lv >= E.max) { toast(`${E.name} is already maxed on the ${AXES[i].name}.`, "bad"); return; }
    const cost = enchCost(k, lv, i);
    if (save.money < cost) { toast("Not enough cash.", "bad"); sfx(120, 0.15, "square", 0.08, 0.6); return; }
    save.money -= cost;
    save.ench[i] = save.ench[i] || {}; save.ench[i][k] = lv + 1;
    enchFx();
    toast(`${AXES[i].name} is enchanted with ${E.name} ${ROMAN[lv + 1]}!`, "rare");
    writeSave(); renderEnch();
    const card = document.querySelector(`#enchRunes [data-ench="${k}"]`); if (card) { card.classList.remove("zap"); void card.offsetWidth; card.classList.add("zap"); }
    const pnl = $("panelEnch"); pnl.classList.remove("flash"); void pnl.offsetWidth; pnl.classList.add("flash");
}
document.addEventListener("click", e => {
    if (panel !== "ench") return;
    const ea = e.target.closest("[data-eaxe]"); if (ea) { enchSel = +ea.dataset.eaxe; sfx(500, 0.06, "square", 0.05, 1.3); renderEnch(); return; }
    const er = e.target.closest("[data-ench]"); if (er) buyEnch(er.dataset.ench);
});
// runes orbit the head of an enchanted axe in your hands
const axeRunes = (() => {
    const grp = new THREE.Group(); grp.position.set(0, 0.74, -0.08); axe.add(grp);
    const mat = new THREE.MeshBasicMaterial({ color: 0xc8a0ff, transparent: true, opacity: 0.9, depthWrite: false }), ms = [];
    for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(BOX, mat); m.scale.set(0.03, 0.045, 0.008); grp.add(m); ms.push(m); }
    grp.visible = false;
    return { grp, ms, mat };
})();
function updateAxeRunes() {
    const on = !holdingGun() && enchTotal(save.equipped) > 0;
    axeRunes.grp.visible = on;
    if (!on) return;
    axeRunes.ms.forEach((m, i) => { const a = time * 1.7 + i * 0.9; m.position.set(Math.cos(a) * 0.24, Math.sin(time * 2.3 + i) * 0.13, Math.sin(a) * 0.24); m.rotation.y = -a; });
    axeRunes.mat.color.setHSL(0.76 + 0.06 * Math.sin(time * 2), 0.9, 0.72);
}

// ---------- the Casino: a tower on the newest island. Walk through its doors (1.6.0) ----------
// it always lives on the latest island: when a new island ships, point CASINO_ISLE at it and give it a style here
const CASINO_ISLE = 4, casinos = {}; // the tower stands on Ashfall and on Port Haven
const CASINO_STYLE = {
    4: { at: () => at4(-0.55, 104), gy: (x, z) => groundY4(x, z), base: 0x221c1a, wall: 0x2c2624, trim: 0x9a7a3a, glow: 0xff8a3a, dim: 0x5a2a10, roof: 0x161214, sign: "#ff9a4a", rock: 0x2a2424, lm: "#ffb060" },
    5: { at: () => ({ x: Math.cos(-0.75) * 60, z: Math.sin(-0.75) * 60 }), gy: (x, z) => groundY5(x, z), base: 0xe8e0d0, wall: 0xf4f0e8, trim: 0xd8a840, glow: 0x5ae8ff, dim: 0x1a6a8a, roof: 0x1a4a6a, sign: "#5ae8ff", rock: 0xc8b898, lm: "#7af0ff" }
};
let casino = null;
const OCTA = new THREE.OctahedronGeometry(1, 0);
function casinoTex(lines, w, h, bg) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d");
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = "rgba(255,180,90,.6)"; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12); }
    g.textAlign = "center"; g.textBaseline = "middle";
    for (const [txt, size, col, y] of lines) { g.font = `900 ${size}px Consolas, monospace`; g.shadowColor = col; g.shadowBlur = size * 0.5; g.fillStyle = col; g.fillText(txt, w / 2, y); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildCasino(n) {
    const S = CASINO_STYLE[n]; if (!S || n !== 5) return; // the casino only stands on the newest island
    const prev = addTgt, prevB = curBuild; addTgt = isleGroup(n); curBuild = n;
    const p = S.at(), x = p.x, z = p.z, face = Math.atan2(-x, -z), gy = S.gy(x, z) - 0.4;
    const g = new THREE.Group(); g.position.set(x, gy, z); g.rotation.y = face; scene.add(g);
    const wall = lamb(S.wall), base = lamb(S.base), trim = lamb(S.trim), roof = lamb(S.roof), rock = lamb(S.rock), glow = new THREE.MeshBasicMaterial({ color: S.glow }), dim = new THREE.MeshBasicMaterial({ color: S.dim }), plank = lamb(0x5a3a22), H6 = Math.PI / 6;
    // a stepped hexagonal plinth, then four tapering tiers banded in old gold
    part(g, CYL6, base, 0, 0.6, 0, 10, 1.4, 10, 0, H6); part(g, CYL6, base, 0, 1.55, 0, 8.6, 0.7, 8.6, 0, H6);
    let y = 1.9;
    [[7, 9], [6, 7.5], [5, 6.5], [4.1, 5.5]].forEach(([r, h], ti) => {
        part(g, CYL6, wall, 0, y + h / 2, 0, r, h, r, 0, H6);
        part(g, CYL6, trim, 0, y + h, 0, r + 0.35, 0.35, r + 0.35, 0, H6);
        for (let f = 0; f < 6; f++) {
            if (ti < 2 && f === 0) continue; // the doorway, and the face the sign hangs on
            const a = f * Math.PI / 3, wr = r * 0.866 + 0.03, lit = (f * 7 + ti * 3) % 5 < 2;
            part(g, BOX, lit ? glow : dim, Math.sin(a) * wr, y + h * 0.55, Math.cos(a) * wr, 0.55, h * 0.45, 0.08, 0, a);
            part(g, BOX, trim, Math.sin(a) * (wr + 0.02), y + h * 0.55 + h * 0.25, Math.cos(a) * (wr + 0.02), 0.9, 0.14, 0.1, 0, a);
        }
        y += h;
    });
    part(g, CONE6, roof, 0, y + 3, 0, 4.8, 6, 4.8, 0, H6);
    part(g, CYL6, trim, 0, y + 6.6, 0, 0.12, 2.2, 0.12);
    part(g, OCTA, glow, 0, y + 7.9, 0, 0.45, 0.65, 0.45);
    // the boarded-up door, with a COMING SOON banner across it
    const fz = 7 * 0.866;
    part(g, BOX, new THREE.MeshBasicMaterial({ color: 0xffd890 }), 0, 1.9 + 2.2, fz + 0.02, 3, 4.4, 0.25); // open doors, warm light pouring out
    { const L = new THREE.PointLight(0xffc070, 16, 14, 1.6); L.position.set(0, 3.4, fz + 2); g.add(L); }
    part(g, BOX, trim, 0, 1.9 + 4.55, fz + 0.1, 3.6, 0.3, 0.3);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.1), new THREE.MeshBasicMaterial({ map: casinoTex([["OPEN 24/7", 64, "#ffd060", 64]], 512, 128, "#2a0e06") })); banner.position.set(0, 7.0, fz + 0.12); g.add(banner);
    const signMat = new THREE.MeshBasicMaterial({ map: casinoTex([["CASINO", 120, S.sign, 96]], 512, 192), transparent: true, depthWrite: false, color: 0xd8b8a8 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.1), signMat); sign.position.set(0, 1.9 + 9 + 3.8, 6 * 0.866 + 0.12); g.add(sign);
    for (const s of [-1, 1]) part(g, OCTA, trim, s * 3.4, 1.9 + 9 + 3.8, 6 * 0.866 + 0.15, 0.4, 0.6, 0.12); // diamond emblems either side of the sign
    // ember braziers by the steps, two huge obsidian dice, basalt columns round the base and scaffolding up one side
    for (const s of [-1, 1]) { part(g, CYL6, trim, s * 2.6, 2.4, fz + 1.2, 0.3, 1, 0.3); part(g, CYL8, lamb(0x1a1210), s * 2.6, 3.0, fz + 1.2, 0.55, 0.3, 0.55); part(g, ICO, glow, s * 2.6, 3.25, fz + 1.2, 0.38, 0.3, 0.38); }
    for (const [dx, dz, ry, sc] of [[-6.2, 9.4, 0.4, 1.3], [-4.6, 10.6, 1.1, 1]]) {
        const d = new THREE.Group(); d.position.set(dx, sc * 0.5 + 0.1, dz); d.rotation.set(0.15, ry, 0.08); g.add(d);
        part(d, BOX, rock, 0, 0, 0, sc, sc, sc);
        const pips = [[0, 0.51, 0], [-0.25, 0.51, -0.25], [0.25, 0.51, 0.25], [0.51, 0.2, 0.2], [0.51, -0.2, -0.2], [0, 0, 0.51]];
        for (const [px2, py2, pz2] of pips) part(d, BOX, glow, px2 * sc, py2 * sc, pz2 * sc, Math.abs(px2) > 0.5 ? 0.02 : 0.16 * sc, Math.abs(py2) > 0.5 ? 0.02 : 0.16 * sc, Math.abs(pz2) > 0.5 ? 0.02 : 0.16 * sc);
    }
    for (let i = 0; i < 16; i++) { const a = i * 0.4 + 0.9 + (i % 3) * 0.1, rr = 10.6 + (i % 4) * 0.5, h = 1.2 + ((i * 7) % 5) * 0.8; if (Math.abs(angDiff(a, 0)) < 0.7) continue; part(g, CYL6, rock, Math.sin(a) * rr, h / 2, Math.cos(a) * rr, 0.7, h, 0.7, 0, (i % 2) * 0.5); }
    for (let k = 0; k < 4; k++) { const sx = -5.2 - (k % 2) * 0.1; part(g, BOX, plank, sx, 4 + k * 4, -3 + (k % 2) * 3, 0.15, 8, 0.15); }
    for (let k = 0; k < 4; k++) part(g, BOX, plank, -5.4, 3 + k * 4, 0, 0.12, 0.12, 6.6);
    // easel sign by the path in
    const easel = new THREE.Group(); easel.position.set(3.5, 0, 13); easel.rotation.y = -0.25; g.add(easel);
    for (const s of [-1, 1]) part(easel, BOX, plank, s * 0.6, 0.9, 0, 0.1, 1.8, 0.1, 0.15);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), new THREE.MeshBasicMaterial({ map: casinoTex([["CASINO", 56, S.sign, 44], ["NOW OPEN", 34, "#ffe0b0", 96]], 256, 140, "#1a0c08") })); board.position.set(0, 1.3, 0.1); board.rotation.x = -0.15; easel.add(board);
    // collisions and a spot on the map
    const toW = (lx, lz) => ({ x: x + Math.cos(face) * lx + Math.sin(face) * lz, z: z - Math.sin(face) * lx + Math.cos(face) * lz });
    circles.push({ x, z, r: 10.2 });
    for (const [lx, lz, r] of [[-6.2, 9.4, 1], [-4.6, 10.6, 0.8], [3.5, 13, 0.6]]) { const w2 = toW(lx, lz); circles.push({ x: w2.x, z: w2.z, r }); }
    const door = { x: x + Math.sin(face) * 11.4, z: z + Math.cos(face) * 11.4 };
    const lm = { name: "THE CASINO", x, z, r: 13, col: S.lm };
    // a floating nametag over the tower, visible from across the island
    const tag = label("THE CASINO", S.lm, 4.4, 1.0); tag.position.set(x, gy + 43, z); tag.maxD = 260; tag.blurK = 0.35;
    const tag2 = label("OPEN 24/7", "#ffffff", 3, 0.7); tag2.position.set(x, gy + 39.5, z); tag2.maxD = 200; tag2.blurK = 0.35;
    if (n === 4) LM4.push(lm);
    casino = casinos[n] = { isle: n, x, z, door, signMat };
    addTgt = prev; curBuild = prevB;
}
function updateCasino() {
    if (!casino || casino.isle !== isle) return;
    casino.signMat.opacity = Math.random() < 0.015 ? 0.35 : 0.92; // an old neon sign, flickering
}


// =====================================================================
//  1.6.0: THE CASINO OPENS. Walk through the tower's doors into a safe, glittering hall:
//  slot machines, blackjack, roulette, the Wheel of Fortune and a bar. Nothing can hurt you in here.
// =====================================================================
const CSX = 5000;                                   // the hall lives far away from every island
const CS_X0 = CSX - 19, CS_X1 = CSX + 19, CS_Z0 = -16, CS_Z1 = 18, CS_H = 7.2;
function inCasino() { return player.pos.x > 4500; }
const SLOT_Z = [-6, -2.4, 1.2, 4.8, 8.4, 12];
const ROUL = { x: CSX, z: 4 }, BJ = { x: CSX + 11, z: 3 }, WHEEL_AT = { x: CSX, z: 17.5 }, BAR = { x0: CSX + 14, z0: 8.5, z1: 16.5 };
const csCircles = [{ x: ROUL.x, z: ROUL.z, r: 3.4 }, { x: BJ.x + 0.6, z: BJ.z, r: 3.1 }, { x: WHEEL_AT.x, z: 17, r: 2.4 }];
for (const sx of [-1, 1]) for (const z of [-8, 13]) csCircles.push({ x: CSX + sx * 7, z, r: 0.75 });
const casinoNpcs = [];
let casinoBuilt = false, csIn = null, csMusicT = 0, csChord = 0;
const slotMachines = [];
let roul3D = null, wheel3D = null, csSigns = [], csLights = [];

// ---- the symbols on the reels (plain text glyphs, drawn the same in 3D and in the panel) ----
const SYMS = ["7", "BAR", "★", "♦", "♥", "♣"];
const SYM_COL = { "7": "#ff3a3a", "BAR": "#ffffff", "★": "#ffd040", "♦": "#5ad8ff", "♥": "#ff6ab0", "♣": "#6aff8a" };
function drawSym(g, s, cx, cy, size) {
    g.save(); g.textAlign = "center"; g.textBaseline = "middle";
    if (s === "BAR") { g.fillStyle = "#111"; g.fillRect(cx - size * 0.55, cy - size * 0.24, size * 1.1, size * 0.48); g.strokeStyle = "#fff"; g.lineWidth = size * 0.05; g.strokeRect(cx - size * 0.55, cy - size * 0.24, size * 1.1, size * 0.48); g.fillStyle = "#fff"; g.font = `900 ${size * 0.34}px Consolas, monospace`; g.fillText("BAR", cx, cy + 1); }
    else { g.fillStyle = SYM_COL[s]; g.shadowColor = SYM_COL[s]; g.shadowBlur = size * 0.25; g.font = `900 ${size * 0.8}px "Segoe UI Symbol", Consolas, sans-serif`; g.fillText(s, cx, cy + size * 0.04); }
    g.restore();
}

// ---- textures ----
function csCanvas(w, h, fn) { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; fn(cv.getContext("2d"), w, h); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }
const carpetTex = () => { const t = csCanvas(128, 128, (g, w) => { g.fillStyle = "#5a0c18"; g.fillRect(0, 0, w, w); g.strokeStyle = "#b8862a"; g.lineWidth = 3; g.beginPath(); g.moveTo(64, 4); g.lineTo(124, 64); g.lineTo(64, 124); g.lineTo(4, 64); g.closePath(); g.stroke(); g.fillStyle = "#3a0610"; g.beginPath(); g.moveTo(64, 30); g.lineTo(98, 64); g.lineTo(64, 98); g.lineTo(30, 64); g.closePath(); g.fill(); g.fillStyle = "#d8a840"; for (const [x, y] of [[64, 64], [0, 0], [128, 0], [0, 128], [128, 128]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); } }); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(11, 10); t.magFilter = THREE.NearestFilter; return t; };
const wallTex = () => { const t = csCanvas(64, 128, (g, w, h) => { g.fillStyle = "#3a0e16"; g.fillRect(0, 0, w, h); g.fillStyle = "#4a141c"; g.fillRect(0, 0, 32, h); g.fillStyle = "rgba(216,168,64,.55)"; for (let y = 12; y < h; y += 32) { g.beginPath(); g.moveTo(16, y - 8); g.lineTo(24, y); g.lineTo(16, y + 8); g.lineTo(8, y); g.closePath(); g.fill(); } }); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14, 1); t.magFilter = THREE.NearestFilter; return t; };
const RED_N = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const numCol = n => (n === 0 ? "#1a9a4a" : RED_N.has(n) ? "#c8202a" : "#141418");
function drawRoulette(g, S, ang, ball, ballR) {
    const c = S / 2, R = S / 2 - 6, seg = (Math.PI * 2) / 37;
    g.clearRect(0, 0, S, S);
    g.fillStyle = "#3a1e0e"; g.beginPath(); g.arc(c, c, R, 0, 7); g.fill();
    g.fillStyle = "#c89a3a"; g.beginPath(); g.arc(c, c, R - 4, 0, 7); g.fill();
    for (let i = 0; i < 37; i++) {
        const a0 = ang + i * seg, n = WHEEL_ORDER[i];
        g.fillStyle = numCol(n); g.beginPath(); g.moveTo(c, c); g.arc(c, c, R - 8, a0, a0 + seg); g.closePath(); g.fill();
        g.save(); g.translate(c, c); g.rotate(a0 + seg / 2); g.fillStyle = "#fff"; g.font = `700 ${S * 0.04}px Consolas`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), R - 20, 0); g.restore();
    }
    g.fillStyle = "#2a160a"; g.beginPath(); g.arc(c, c, R * 0.62, 0, 7); g.fill();
    g.fillStyle = "#c89a3a"; g.beginPath(); g.arc(c, c, R * 0.2, 0, 7); g.fill();
    for (let k = 0; k < 4; k++) { const a = ang * 1 + k * Math.PI / 2; g.strokeStyle = "#e8c060"; g.lineWidth = 5; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * R * 0.5, c + Math.sin(a) * R * 0.5); g.stroke(); }
    if (ball !== undefined) { g.fillStyle = "#fff"; g.shadowColor = "#000"; g.shadowBlur = 4; g.beginPath(); g.arc(c + Math.cos(ball) * ballR, c + Math.sin(ball) * ballR, S * 0.022, 0, 7); g.fill(); g.shadowBlur = 0; }
    g.fillStyle = "#ffd040"; g.beginPath(); g.moveTo(c - 8, 2); g.lineTo(c + 8, 2); g.lineTo(c, 16); g.closePath(); g.fill();
}
// the Wheel of Fortune: twelve wedges
const WHEEL = [
    { t: "x0.3", k: 0.3, col: "#3a6aff" }, { t: "LUCKY", buff: "lucky", col: "#d8a820" }, { t: "x0.6", k: 0.6, col: "#e83a5a" }, { t: "BUST", k: 0, col: "#2a2a34" },
    { t: "x1", k: 1, col: "#2ab06a" }, { t: "MATS", mats: true, col: "#9a5ae8" }, { t: "x1.5", k: 1.5, col: "#ff8a2a" }, { t: "BUST", k: 0, col: "#2a2a34" },
    { t: "x2.5", k: 2.5, col: "#2aa8e8" }, { t: "SWIFT", buff: "swift", col: "#3ac08a" }, { t: "x0.4", k: 0.4, col: "#e85aa0" }, { t: "JACKPOT", k: 8, col: "#ffd040", jack: true }
];
const wheelBase = () => Math.round(20000 * Math.pow(2, save.rebirths || 0));
const wheelPrice = () => Math.round(wheelBase() * 1.4);
function drawWheel(g, S, ang) {
    const c = S / 2, R = S / 2 - 8, seg = (Math.PI * 2) / WHEEL.length;
    g.clearRect(0, 0, S, S);
    g.fillStyle = "#c89a3a"; g.beginPath(); g.arc(c, c, R + 6, 0, 7); g.fill();
    WHEEL.forEach((w, i) => {
        const a0 = ang + i * seg;
        g.fillStyle = w.col; g.beginPath(); g.moveTo(c, c); g.arc(c, c, R, a0, a0 + seg); g.closePath(); g.fill();
        g.strokeStyle = "rgba(255,230,160,.7)"; g.lineWidth = 2; g.stroke();
        g.save(); g.translate(c, c); g.rotate(a0 + seg / 2); g.fillStyle = w.jack ? "#3a2000" : "#fff"; g.font = `900 ${S * (w.t.length > 5 ? 0.045 : 0.06)}px Consolas`; g.textAlign = "right"; g.textBaseline = "middle"; g.fillText(w.t, R - 10, 0); g.restore();
    });
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; g.fillStyle = i % 2 ? "#fff6c0" : "#ffb020"; g.beginPath(); g.arc(c + Math.cos(a) * (R + 1), c + Math.sin(a) * (R + 1), 4, 0, 7); g.fill(); }
    g.fillStyle = "#3a1e0e"; g.beginPath(); g.arc(c, c, R * 0.16, 0, 7); g.fill(); g.fillStyle = "#ffd040"; g.beginPath(); g.arc(c, c, R * 0.1, 0, 7); g.fill();
}

// ---- the hall ----
function buildCasinoHall() {
    casinoBuilt = true;
    const prev = addTgt, prevB = curBuild; addTgt = null; curBuild = CASINO_ISLE;
    const W = CS_X1 - CS_X0, D = CS_Z1 - CS_Z0, cz = (CS_Z0 + CS_Z1) / 2;
    const gold = new THREE.MeshLambertMaterial({ color: 0xd8a840, emissive: 0x3a2a08, flatShading: true }), darkWood = lamb(0x2a140c), marble = lamb(0xe8e0d8);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: carpetTex() })); floor.rotation.x = -Math.PI / 2; floor.position.set(CSX, 0.01, cz); scene.add(floor);
    const wt = wallTex(), wallM = new THREE.MeshLambertMaterial({ map: wt });
    for (const [x, z, w, d, ry] of [[CSX, CS_Z0, W, 0, 0], [CS_X0, cz, D, 0, Math.PI / 2], [CS_X1, cz, D, 0, -Math.PI / 2]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, CS_H), wallM); m.position.set(x, CS_H / 2, z); m.rotation.y = ry; scene.add(m);
    }
    const wain = batch(darkWood), trimB = batch(gold);
    for (const [x, z, sx, sz] of [[CSX, CS_Z0 + 0.15, W, 0.3], [CS_X0 + 0.15, cz, 0.3, D], [CS_X1 - 0.15, cz, 0.3, D]]) {
        wain.add(BOX, x, 0.6, z, 0, 0, 0, sx, 1.2, sz);
        trimB.add(BOX, x, 1.22, z, 0, 0, 0, sx + 0.02, 0.08, sz + 0.06);
        trimB.add(BOX, x, CS_H - 0.5, z, 0, 0, 0, sx + 0.02, 0.12, sz + 0.06);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), lamb(0x1a0a10)); ceil.rotation.x = Math.PI / 2; ceil.position.set(CSX, CS_H, cz); scene.add(ceil);
    for (let x = CS_X0 + 4; x < CS_X1; x += 6) trimB.add(BOX, x, CS_H - 0.1, cz, 0, 0, 0, 0.16, 0.16, D);
    for (let z = CS_Z0 + 4; z < CS_Z1; z += 6) trimB.add(BOX, CSX, CS_H - 0.1, z, 0, 0, 0, W, 0.16, 0.16);
    // marble pillars
    for (const c of csCircles.slice(3)) { trimB.add(CYL8, c.x, 0.2, c.z, 0, 0, 0, 0.9, 0.4, 0.9); trimB.add(CYL8, c.x, CS_H - 0.3, c.z, 0, 0, 0, 0.85, 0.5, 0.85); const p = new THREE.Mesh(CYL8, marble); p.scale.set(0.6, CS_H, 0.6); p.position.set(c.x, CS_H / 2, c.z); scene.add(p); }
    // the doors you came in through, with a velvet rope path
    trimB.add(BOX, CSX, 2.2, CS_Z0 + 0.1, 0, 0, 0, 4.4, 4.4, 0.2);
    const doorM = new THREE.MeshBasicMaterial({ color: 0xffe0a0 });
    for (const s of [-1, 1]) { const d = new THREE.Mesh(BOX, doorM); d.scale.set(1.9, 4, 0.1); d.position.set(CSX + s * 1, 2, CS_Z0 + 0.22); scene.add(d); }
    const rope = new THREE.MeshLambertMaterial({ color: 0xa01020, flatShading: true });
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { const z = CS_Z0 + 3 + k * 2.6; trimB.add(CYL6, CSX + s * 2.4, 0.5, z, 0, 0, 0, 0.07, 1, 0.07); trimB.add(ICO, CSX + s * 2.4, 1.02, z, 0, 0, 0, 0.12); if (k < 2) { const r = new THREE.Mesh(CYL6, rope); r.scale.set(0.05, 2.6, 0.05); r.rotation.x = Math.PI / 2; r.position.set(CSX + s * 2.4, 0.85, z + 1.3); scene.add(r); } }
    // chandeliers
    const crystal = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
    for (const z of [-6, 4, 13]) {
        const ch = new THREE.Group(); ch.position.set(CSX, CS_H - 1.6, z); scene.add(ch);
        part(ch, CYL6, gold, 0, 1.2, 0, 0.04, 1.6, 0.04);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.07, 6, 16), gold); ring.rotation.x = Math.PI / 2; ch.add(ring);
        const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.06, 6, 12), gold); ring2.rotation.x = Math.PI / 2; ring2.position.y = -0.35; ch.add(ring2);
        for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; part(ch, CONE6, crystal, Math.cos(a) * 1.2, -0.25, Math.sin(a) * 1.2, 0.07, 0.4, 0.07, Math.PI); }
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; part(ch, CONE6, crystal, Math.cos(a) * 0.7, -0.6, Math.sin(a) * 0.7, 0.06, 0.32, 0.06, Math.PI); }
        part(ch, ICO, crystal, 0, -0.75, 0, 0.22);
        const L = new THREE.PointLight(0xffd8a0, 34, 24, 1.5); L.position.set(0, -0.6, 0); ch.add(L); L.userData.b = 34; csLights.push(L);
    }
    // neon signs
    const sign = (txt, col, x, y, z, ry, w = 6, h = 1.5) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: casinoTex([[txt, 92, col, 96]], 768, 192), transparent: true, depthWrite: false })); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); csSigns.push(m); return m; };
    sign("SLOTS", "#ff5ad8", CS_X0 + 0.12, 5.4, 3, Math.PI / 2, 5);
    sign("BLACKJACK", "#5ad8ff", CS_X1 - 0.12, 5.4, 2, -Math.PI / 2, 6.5);
    sign("BAR", "#ffb040", CS_X1 - 0.12, 5.4, 12.5, -Math.PI / 2, 3.2);
    sign("EXIT", "#6aff8a", CSX, 5.1, CS_Z0 + 0.14, 0, 3, 1.1);
    sign("★ WELCOME TO THE CASINO ★", "#ffd040", CSX, 6.1, CS_Z0 + 0.14, 0, 12, 1.2);

    // slot machines along the west wall, each with its own screen
    const cabCols = [0x6a1aa0, 0xa01a3a, 0x1a6aa0, 0xa07a1a, 0x1aa06a, 0xa01a8a];
    SLOT_Z.forEach((z, i) => {
        const m = new THREE.Group(); m.position.set(CS_X0 + 1.6, 0, z); m.rotation.y = Math.PI / 2; scene.add(m);
        const body = lamb(cabCols[i]);
        part(m, BOX, body, 0, 0.55, 0, 1.4, 1.1, 1.0); part(m, BOX, body, 0, 1.55, -0.12, 1.4, 1.0, 0.76); part(m, BOX, gold, 0, 1.06, 0.38, 1.44, 0.06, 0.3);
        part(m, BOX, lamb(0x14080a), 0, 2.25, -0.08, 1.3, 0.45, 0.8);
        const topM = new THREE.MeshBasicMaterial({ color: 0xffd040 }); part(m, BOX, topM, 0, 2.62, -0.1, 1.2, 0.26, 0.7);
        const cv = document.createElement("canvas"); cv.width = 192; cv.height = 96; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshBasicMaterial({ map: tex })); scr.position.set(0, 1.62, 0.27); m.add(scr);
        part(m, CYL6, gold, 0.78, 1.5, 0.1, 0.04, 0.8, 0.04); const knob = part(m, ICO, new THREE.MeshBasicMaterial({ color: 0xff3a3a }), 0.78, 1.95, 0.1, 0.11);
        part(m, CYL8, gold, 0, 0.45, 1.25, 0.32, 0.06, 0.32); part(m, CYL6, darkWood, 0, 0.22, 1.25, 0.05, 0.45, 0.05); // a stool
        const sm = { i, g: m, cv, tex, topM, knob, syms: [0, 1, 2].map(() => SYMS[Math.floor(Math.random() * 6)]), t: Math.random() * 3, spin: 0, result: null, win: 0 };
        drawSlotScreen(sm); slotMachines.push(sm);
    });
    // roulette table in the middle, with a real spinning wheel
    {
        const t = new THREE.Group(); t.position.set(ROUL.x, 0, ROUL.z); scene.add(t);
        part(t, CYL8, darkWood, 0, 0.45, 0, 0.6, 0.9, 0.6);
        const felt = csCanvas(512, 256, (g, w, h) => {
            g.fillStyle = "#0e5a2a"; g.fillRect(0, 0, w, h); g.strokeStyle = "#e8d8a0"; g.lineWidth = 2;
            const cw = 30, ch = 52, x0 = 70, y0 = 30;
            g.fillStyle = numCol(0); g.fillRect(x0 - 34, y0, 32, ch * 3); g.strokeRect(x0 - 34, y0, 32, ch * 3);
            for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) { const n = c * 3 + 3 - r; g.fillStyle = numCol(n); g.fillRect(x0 + c * cw, y0 + r * ch, cw - 2, ch - 2); }
            g.fillStyle = "#fff"; g.font = "700 14px Consolas"; g.textAlign = "center"; g.textBaseline = "middle";
            g.fillText("0", x0 - 18, y0 + ch * 1.5); for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) g.fillText(String(c * 3 + 3 - r), x0 + c * cw + cw / 2 - 1, y0 + r * ch + ch / 2);
            g.font = "700 16px Consolas"; ["1st 12", "2nd 12", "3rd 12"].forEach((s, k) => { g.strokeRect(x0 + k * cw * 4, y0 + ch * 3 + 4, cw * 4 - 2, 30); g.fillText(s, x0 + k * cw * 4 + cw * 2, y0 + ch * 3 + 20); });
        });
        const top = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.2, 3.4), [lamb(0x2a140c), lamb(0x2a140c), new THREE.MeshLambertMaterial({ map: felt }), lamb(0x2a140c), lamb(0x2a140c), lamb(0x2a140c)]);
        top.position.set(0.6, 1.0, 0); t.add(top);
        part(t, BOX, gold, 0.6, 1.12, 1.72, 6.6, 0.08, 0.12); part(t, BOX, gold, 0.6, 1.12, -1.72, 6.6, 0.08, 0.12); part(t, BOX, gold, 3.92, 1.12, 0, 0.12, 0.08, 3.5); part(t, BOX, gold, -2.72, 1.12, 0, 0.12, 0.08, 3.5);
        const bowl = new THREE.Group(); bowl.position.set(-2.4, 1.15, 0); t.add(bowl);
        part(bowl, CYL8, lamb(0x3a1e0e), 0, 0.05, 0, 1.1, 0.22, 1.1);
        const wcv = document.createElement("canvas"); wcv.width = wcv.height = 256; drawRoulette(wcv.getContext("2d"), 256, 0);
        const wtex = new THREE.CanvasTexture(wcv); wtex.colorSpace = THREE.SRGBColorSpace;
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1.0, 37), new THREE.MeshBasicMaterial({ map: wtex })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.17; bowl.add(disc);
        part(bowl, CYL6, gold, 0, 0.32, 0, 0.06, 0.3, 0.06);
        const chips = batch(lamb(0xc8202a)), chips2 = batch(lamb(0x1a4ac8)), chips3 = batch(lamb(0xe8e0d0));
        for (let k = 0; k < 7; k++) { const b = [chips, chips2, chips3][k % 3], h = 1 + (k % 4); for (let j = 0; j < h; j++) b.add(CYL8, ROUL.x + 0.6 + (k - 3) * 0.55, 1.15 + j * 0.06, ROUL.z + ((k * 7) % 3 - 1) * 0.6, 0, 0, 0, 0.16, 0.05, 0.16); }
        chips.build(); chips2.build(); chips3.build();
        roul3D = { disc, ang: 0, speed: 0.3 };
        const croupier = makeHumanoid({ face: "clerk", skin: 0xe8c0a0, shirt: 0xf2f2f2, vest: 0x141414, pants: 0x141414, hair: 0x2a1a10 });
        croupier.g.position.set(ROUL.x + 0.6, 0, ROUL.z + 2.5); croupier.g.rotation.y = Math.PI; scene.add(croupier.g); croupier.yaw = Math.PI; casinoNpcs.push(croupier);
    }
    // blackjack: a half-moon table, the dealer on the flat side
    {
        const felt = csCanvas(512, 256, (g, w, h) => { g.fillStyle = "#0e5a2a"; g.fillRect(0, 0, w, h); g.fillStyle = "#e8d8a0"; g.font = "900 26px Consolas"; g.textAlign = "center"; g.fillText("BLACKJACK PAYS 3 TO 2", w / 2, h * 0.42); g.font = "700 18px Consolas"; g.fillText("DEALER STANDS ON 17", w / 2, h * 0.58); });
        const topG = new THREE.CylinderGeometry(3, 3, 0.2, 24, 1, false, Math.PI, Math.PI);
        const top = new THREE.Mesh(topG, [lamb(0x2a140c), new THREE.MeshLambertMaterial({ map: felt }), lamb(0x2a140c)]); top.position.set(BJ.x + 1.4, 1.0, BJ.z); scene.add(top);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(3, 0.1, 6, 24, Math.PI), gold); rim.rotation.set(Math.PI / 2, 0, Math.PI / 2); rim.position.set(BJ.x + 1.4, 1.1, BJ.z); scene.add(rim);
        const legs = batch(darkWood); legs.add(CYL8, BJ.x, 0.45, BJ.z, 0, 0, 0, 0.6, 0.9, 0.6); legs.build();
        const cards = batch(new THREE.MeshLambertMaterial({ color: 0xffffff })), backs = batch(new THREE.MeshLambertMaterial({ color: 0xa01a2a }));
        for (let k = 0; k < 4; k++) { cards.add(BOX, BJ.x + 0.2 - k * 0.15, 1.12, BJ.z - 1.2 + k * 0.8, 0, 0.3 * k, 0, 0.28, 0.01, 0.4); backs.add(BOX, BJ.x + 1.0, 1.12 + k * 0.012, BJ.z + 1.6, 0, 0.2, 0, 0.28, 0.01, 0.4); }
        cards.build(); backs.build();
        const dealer = makeHumanoid({ face: "clerk", skin: 0xc89070, shirt: 0xf2f2f2, vest: 0x5a0a14, pants: 0x141414, hair: 0x101010 });
        dealer.g.position.set(BJ.x + 2.2, 0, BJ.z); dealer.g.rotation.y = -Math.PI / 2; scene.add(dealer.g); dealer.yaw = -Math.PI / 2; casinoNpcs.push(dealer);
    }
    // the Wheel of Fortune on the back wall
    {
        const g = new THREE.Group(); g.position.set(WHEEL_AT.x, 4.0, CS_Z1 - 0.5); g.rotation.y = Math.PI; scene.add(g);
        const wcv = document.createElement("canvas"); wcv.width = wcv.height = 384; drawWheel(wcv.getContext("2d"), 384, -Math.PI / 2);
        const wtex = new THREE.CanvasTexture(wcv); wtex.colorSpace = THREE.SRGBColorSpace;
        const disc = new THREE.Mesh(new THREE.CircleGeometry(2.9, 48), new THREE.MeshBasicMaterial({ map: wtex })); g.add(disc);
        part(g, CYL8, gold, 0, 0, -0.1, 3.05, 0.12, 3.05, Math.PI / 2);
        const ptr = part(g, CONE6, new THREE.MeshBasicMaterial({ color: 0xffd040 }), 0, 3.2, 0.12, 0.3, 0.6, 0.12, Math.PI); ptr.rotation.z = 0;
        part(g, BOX, darkWood, 0, -3.4, -0.2, 0.5, 1.6, 0.4);
        const sg = sign("WHEEL OF FORTUNE", "#ffd040", WHEEL_AT.x, 6.8, CS_Z1 - 0.2, Math.PI, 7, 0.9);
        const L = new THREE.PointLight(0xffe0a0, 18, 10, 1.5); L.position.set(WHEEL_AT.x, 4, CS_Z1 - 3.5); scene.add(L); L.userData.b = 18; csLights.push(L);
        wheel3D = { disc, ang: 0 };
    }
    // the bar: counter, stools, shelves of glowing bottles and a bartender
    {
        const g = batch(darkWood), tops = batch(lamb(0x1a1a1e)), bottlesB = [0xffb040, 0x5ad8ff, 0xff5a8a, 0x7aff9a, 0xc08aff].map(c => batch(new THREE.MeshBasicMaterial({ color: c })));
        g.add(BOX, BAR.x0 + 0.7, 0.55, (BAR.z0 + BAR.z1) / 2, 0, 0, 0, 1.2, 1.1, BAR.z1 - BAR.z0);
        tops.add(BOX, BAR.x0 + 0.7, 1.14, (BAR.z0 + BAR.z1) / 2, 0, 0, 0, 1.5, 0.08, BAR.z1 - BAR.z0 + 0.2);
        trimB.add(BOX, BAR.x0 + 0.08, 0.9, (BAR.z0 + BAR.z1) / 2, 0, 0, 0, 0.06, 0.08, BAR.z1 - BAR.z0);
        for (let k = 0; k < 3; k++) g.add(BOX, CS_X1 - 0.35, 2.0 + k * 0.9, (BAR.z0 + BAR.z1) / 2, 0, 0, 0, 0.5, 0.06, BAR.z1 - BAR.z0 - 1);
        for (let k = 0; k < 3; k++) for (let j = 0; j < 14; j++) bottlesB[(j + k) % 5].add(CYL6, CS_X1 - 0.35, 2.25 + k * 0.9, BAR.z0 + 1 + j * 0.5, 0, 0, 0, 0.08, 0.4, 0.08);
        for (let j = 0; j < 4; j++) { const z = BAR.z0 + 1.2 + j * 2; trimB.add(CYL8, BAR.x0 - 0.9, 0.8, z, 0, 0, 0, 0.32, 0.06, 0.32); g.add(CYL6, BAR.x0 - 0.9, 0.4, z, 0, 0, 0, 0.05, 0.8, 0.05); }
        g.build(); tops.build(); bottlesB.forEach(b => b.build());
        const bt = makeHumanoid({ face: "clerk", skin: 0xf0c8a0, shirt: 0xf2f2f2, vest: 0x1a3a5a, pants: 0x141414, hair: 0x8a5a2a });
        bt.g.position.set(CS_X1 - 1.6, 0, 12.5); bt.g.rotation.y = -Math.PI / 2; scene.add(bt.g); bt.yaw = -Math.PI / 2; casinoNpcs.push(bt);
        const L = new THREE.PointLight(0xffb060, 14, 12, 1.5); L.position.set(CS_X1 - 3, 4, 12.5); scene.add(L); L.userData.b = 14; csLights.push(L);
    }
    // a few regulars, so the place feels alive
    for (const [x, z, ry, sh, pa] of [[CS_X0 + 2.9, SLOT_Z[1], -Math.PI / 2, 0x3a5a8a, 0x2a2a34], [CS_X0 + 2.9, SLOT_Z[4], -Math.PI / 2, 0x8a3a5a, 0x1a1a24], [BAR.x0 - 0.9, BAR.z0 + 3.2, Math.PI / 2, 0x5a8a3a, 0x3a2a1a], [ROUL.x + 2.6, ROUL.z - 2.6, 0, 0xc8a040, 0x1a1a1a]]) {
        const p = makeHumanoid({ face: "clerk", skin: [0xf0c8a0, 0xc89070, 0x8a5a3a][Math.floor(Math.random() * 3)], shirt: sh, pants: pa, hair: [0x2a1a10, 0x8a5a2a, 0xd8c08a][Math.floor(Math.random() * 3)] });
        p.g.position.set(x, 0, z); p.g.rotation.y = ry; scene.add(p.g); p.yaw = ry; p.patron = true; casinoNpcs.push(p);
    }
    buildCasinoWing();
    wain.build(); trimB.build();
    addTgt = prev; curBuild = prevB;
}
function drawSlotScreen(sm) {
    const g = sm.cv.getContext("2d"), W = sm.cv.width, H = sm.cv.height;
    g.fillStyle = "#0a0410"; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 3; k++) { g.fillStyle = "#f4ecd8"; g.fillRect(8 + k * 61, 8, 55, H - 16); drawSym(g, sm.syms[k], 35 + k * 61, H / 2, 44); }
    g.fillStyle = "rgba(255,60,60,.8)"; g.fillRect(4, H / 2 - 1, W - 8, 2);
    sm.tex.needsUpdate = true;
}

// ---- walking in and out ----
let casinoCd = 0;
function enterCasino() {
    if (!casinoBuilt) buildCasinoHall();
    sfx(260, 0.2, "triangle", 0.08, 1.5); setTimeout(() => sfx(390, 0.3, "triangle", 0.07, 1.4), 120);
    fadeTo(() => {
        player.pos.set(CSX, 1.7, CS_Z0 + 2.2); player.vel.set(0, 0, 0); player.yaw = Math.PI; player.pitch = -0.05;
        csIn = true; casinoCd = 1.5;
        if (!save.casino.visits) toast("Welcome to the Casino! Nothing can hurt you in here. Walk up to a game and press F.", "rare");
        save.casino.visits = (save.casino.visits || 0) + 1;
    });
}
function leaveCasino() {
    const c = casino, face = Math.atan2(-c.x, -c.z), dx = Math.sin(face), dz = Math.cos(face);
    fadeTo(() => {
        const x = c.x + dx * 13.5, z = c.z + dz * 13.5;
        player.pos.set(x, groundY(x, z) + 1.7, z); player.vel.set(0, 0, 0); player.yaw = Math.atan2(-dx, -dz); player.pitch = 0;
        csIn = false; casinoCd = 1.5; CS.auto = false;
        writeSave();
    });
}
function clampCasino(p) {
    p.x = clamp(p.x, CS_X0 + 0.6, CS_X1 - 0.6); p.z = clamp(p.z, CS_Z0 + 0.6, WING_Z1 - 0.6);
    clampWing(p);
    if (p.x < CS_X0 + 3.0 && p.z > SLOT_Z[0] - 1.5 && p.z < SLOT_Z[5] + 1.5) p.x = CS_X0 + 3.0; // the slot machines
    if (p.x > BAR.x0 - 0.5 && p.z > BAR.z0 - 0.4 && p.z < BAR.z1 + 0.4) p.x = BAR.x0 - 0.5; // the bar counter
    for (const c of csCircles) { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + 0.45; if (d < m && d > 0.001) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; } }
}
function nearestCasino() {
    const wn = nearestWing(); if (wn) return wn;
    const px = player.pos.x, pz = player.pos.z;
    for (let i = 0; i < SLOT_Z.length; i++) if (px < CS_X0 + 4.6 && Math.abs(pz - SLOT_Z[i]) < 1.8) return { k: "cslot", i };
    if (Math.hypot(px - ROUL.x, pz - ROUL.z) < 4.9) return { k: "croul" };
    if (Math.hypot(px - BJ.x, pz - BJ.z) < 4.6) return { k: "cbj" };
    if (Math.hypot(px - WHEEL_AT.x, pz - (WHEEL_AT.z - 2)) < 3.8) return { k: "cwheel" };
    if (px > BAR.x0 - 2.6 && pz > BAR.z0 - 0.5 && pz < BAR.z1 + 0.5) return { k: "cbar" };
    return null;
}
const CS_PROMPTS = { cslot: () => "[F] Play the slot machine", croul: () => "[F] Play roulette", cbj: () => "[F] Play blackjack", cwheel: () => (save.casino.wheelDay !== save.day ? "[F] Spin the Wheel of Fortune (FREE today!)" : "[F] Spin the Wheel of Fortune"), cbar: () => "[F] Order a drink" };
function casinoInteract(n) {
    if (wingInteract(n)) return;
    const pick = a => a[Math.floor(Math.random() * a.length)];
    if (n.k === "cslot") { CS.slot = n.i; openCasino("slots", pick(["Pull the lever, hotshot.", "Three sevens. That's all you need.", "This one's been running hot all night."])); }
    else if (n.k === "croul") openCasino("roulette", pick(["Place your bets.", "Red or black? Trust your gut.", "No more bets... after you bet."]));
    else if (n.k === "cbj") openCasino("blackjack", pick(["Twenty-one. Don't go over.", "The house stands on seventeen.", "Feeling lucky? Sit down."]));
    else if (n.k === "cwheel") openCasino("wheel", pick(["Round and round she goes...", "One free spin a day. Everybody wins something. Mostly."]));
    else if (n.k === "cbar") openCasino("bar", pick(["What'll it be?", "On the rocks?", "These drinks do more than taste good."]));
}

// ---- the game panel ----
const CS = { game: null, busy: false, auto: false, slot: 0, bj: null, roulPick: null, roulHist: [], roulAng: 0, wheelAng: -Math.PI / 2 };
const CHIPS = [100, 1000, 10000, 100000, 1000000, 10000000];
const chipLbl = v => (v >= 1e6 ? v / 1e6 + "M" : v >= 1e3 ? v / 1e3 + "K" : String(v));
const curBet = () => Math.max(1, save.csBet || 1000);
const CS_TITLE = { slots: "LUCKY 7s SLOTS", roulette: "ROULETTE", blackjack: "BLACKJACK", wheel: "WHEEL OF FORTUNE", bar: "THE BAR" };
function openCasino(game, say) {
    CS.game = game; CS.auto = false;
    $("csTitle").textContent = CS_TITLE[game];
    $("csSay").textContent = say ? "“" + say + "”" : "";
    $("csMsg").innerHTML = ""; $("csMsg").className = "";
    renderCasinoGame();
    openPanel("casino");
}
function csMsg(html, cls = "") { const m = $("csMsg"); m.innerHTML = html; m.className = cls; if (cls) { m.classList.remove("pop"); void m.offsetWidth; m.classList.add("pop"); } }
function renderBetRow() {
    if (CS.game === "wheel" || CS.game === "bar" || (CSG[CS.game] && CSG[CS.game].noBet)) { $("csBet").innerHTML = ""; return; }
    const b = curBet();
    $("csBet").innerHTML = `<span class="lbl">BET</span>` + CHIPS.map(v => `<button class="chip ${b === v ? "on" : ""} c${v}" data-chip="${v}" ${save.money < v && b !== v ? "disabled" : ""}>${chipLbl(v)}</button>`).join("") + `<button class="chip max" data-chip="max" ${save.money < 1 ? "disabled" : ""}>MAX</button><span class="betv">${money(b)}</span>`;
}
function renderCasinoGame() {
    const G = $("csGame");
    if (CSG[CS.game]) { CSG[CS.game].render(G); renderBetRow(); $("csFoot").textContent = csFoot(); return; }
    if (CS.game === "slots") {
        G.innerHTML = `<div class="slotm"><div class="slotTop">★ LUCKY 7s ★ <small>MACHINE ${CS.slot + 1}</small></div>
          <div class="reels">${[0, 1, 2].map(k => `<div class="reel"><div class="strip" id="strip${k}">${stripHtml([SYMS[(k * 2) % 6], slotMachines[CS.slot] ? slotMachines[CS.slot].syms[k] : SYMS[k], SYMS[(k + 3) % 6]])}</div></div>`).join("")}<div class="payline"></div></div>
          <div class="pjack">PROGRESSIVE JACKPOT <b>${money(csPool())}</b> · line up 7 7 7 to win it all</div><div class="paytable"><span><b class="s7">7 7 7</b> ×100 + JACKPOT</span><span><b class="sBAR">BAR</b>×3 ×25</span><span><b class="sstar">★★★</b> ×12</span><span><b class="sdia">♦♦♦</b> ×6</span><span><b class="shrt">♥♥♥</b> ×3</span><span><b class="sclb">♣♣♣</b> ×2</span><span>any pair ×1</span></div></div>
          <div class="csActions"><button class="csbtn big" data-cs="spin">SPIN <kbd>Space</kbd></button><button class="csbtn" data-cs="auto">AUTO: ${CS.auto ? "ON" : "OFF"}</button></div>`;
    } else if (CS.game === "blackjack") {
        G.innerHTML = `<div class="bjTable"><div class="bjLbl">DEALER <b id="bjDv"></b></div><div class="hand" id="bjDealer"></div><div class="bjMid">BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON 17</div><div class="hand" id="bjYou"></div><div class="bjLbl">YOU <b id="bjYv"></b></div></div><div class="csActions" id="bjAct"></div>`;
        renderBJ();
    } else if (CS.game === "roulette") {
        const nb = n => `<button class="rn ${CS.roulPick === "n" + n ? "on" : ""}" data-rb="n${n}" style="background:${numCol(n)}">${n}</button>`;
        let grid = "";
        for (let r = 0; r < 3; r++) for (let c = 0; c < 12; c++) grid += nb(c * 3 + 3 - r);
        const ob = (k, t, cls = "") => `<button class="rb ${cls} ${CS.roulPick === k ? "on" : ""}" data-rb="${k}">${t}</button>`;
        G.innerHTML = `<div class="roulWrap"><canvas id="roulC" width="300" height="300"></canvas>
          <div class="roulBets"><div class="rzero">${nb(0)}</div><div class="numGrid">${grid}</div>
          <div class="outside">${ob("red", "RED ×2", "red")}${ob("black", "BLACK ×2", "black")}${ob("odd", "ODD ×2")}${ob("even", "EVEN ×2")}${ob("low", "1-18 ×2")}${ob("high", "19-36 ×2")}${ob("d1", "1st 12 ×3")}${ob("d2", "2nd 12 ×3")}${ob("d3", "3rd 12 ×3")}</div>
          <div class="rhint">${CS.roulPick ? "Your bet: <b>" + roulName(CS.roulPick) + "</b>" : "Pick a bet: a number (×36) or an outside bet"}</div></div></div>
          <div class="roulHist">LAST: ${CS.roulHist.map(n => `<span style="background:${numCol(n)}">${n}</span>`).join("") || "—"}</div>
          <div class="csActions"><button class="csbtn big" data-cs="rspin" ${CS.roulPick ? "" : "disabled"}>SPIN <kbd>Space</kbd></button></div>`;
        drawRoulette($("roulC").getContext("2d"), 300, CS.roulAng);
    } else if (CS.game === "wheel") {
        const free = save.casino.wheelDay !== save.day;
        G.innerHTML = `<div class="wheelWrap"><canvas id="wheelC" width="340" height="340"></canvas>
          <div class="wheelInfo"><p>Land on a multiplier to win that many times <b>${money(wheelBase())}</b>.</p><p><b class="gold">JACKPOT</b> pays ${money(wheelBase() * 8)}. LUCKY and SWIFT give a 4-minute buff, MATS gives a pile of materials.</p>
          <p>${free ? '<b class="green">Your free spin for today is ready!</b>' : "Free spin used today. Come back tomorrow (in-game)."}</p></div></div>
          <div class="csActions"><button class="csbtn big" data-cs="wspin">${free ? "FREE SPIN" : "SPIN · " + money(wheelPrice())} <kbd>Space</kbd></button></div>`;
        drawWheel($("wheelC").getContext("2d"), 340, CS.wheelAng);
    } else if (CS.game === "bar") {
        G.innerHTML = `<div class="barList">${DRINKS.map((d, i) => `<div class="drink" data-drink="${i}"><b>${d.n}</b><small>${d.d}</small><span>${d.p ? money(d.p * drinkBase()) : "FREE"}</span></div>`).join("")}</div>`;
    }
    renderBetRow();
    $("csFoot").textContent = csFoot();
}
const stripHtml = syms => syms.map(s => `<div class="sym ${symCls(s)}">${s}</div>`).join("");
const symCls = s => ({ "7": "s7", "BAR": "sBAR", "★": "sstar", "♦": "sdia", "♥": "shrt", "♣": "sclb" })[s];
function takeBet() {
    const b = curBet();
    if (save.money < b) { csMsg("Not enough cash for that bet.", "bad"); sfx(120, 0.15, "square", 0.08, 0.6); return 0; }
    save.money -= b; save.casino.plays = (save.casino.plays || 0) + 1; save.casino.net = (save.casino.net || 0) - b; wagered(b);
    return b;
}
function payOut(amount, bet) {
    if (amount > 0) { save.money += amount; save.casino.net += amount; wonBack(amount); }
    const profit = amount - bet;
    if (profit > (save.casino.big || 0)) save.casino.big = profit;
    if (amount >= bet * 10) { coinRain(60); flash = 0.5; jingle(true); }
    else if (amount > bet) { coinRain(18); jingle(false); }
    writeSave();
}
function jingle(big) { const notes = big ? [523, 659, 784, 1047, 784, 1047, 1319] : [659, 784, 1047]; notes.forEach((f, k) => setTimeout(() => sfx(f, 0.18, "triangle", 0.1, 1.02), k * 110)); }
function coinRain(n) {
    const box = $("floaters");
    for (let i = 0; i < n; i++) { const c = document.createElement("div"); c.className = "coin"; c.style.left = Math.random() * 100 + "vw"; c.style.animationDelay = Math.random() * 0.6 + "s"; c.style.animationDuration = 1.2 + Math.random() * 0.9 + "s"; box.appendChild(c); setTimeout(() => c.remove(), 3000); }
}

// ---- slots ----
const SLOT_ODDS = [["7", 0.002, 100], ["BAR", 0.006, 25], ["★", 0.012, 12], ["♦", 0.02, 6], ["♥", 0.035, 3], ["♣", 0.05, 2]];
function rollSlots() {
    let r = Math.random();
    for (const [s, p, m] of SLOT_ODDS) { if (r < p) return { syms: [s, s, s], mult: m, jack: s === "7" }; r -= p; }
    if (r < 0.12) { const s = SYMS[Math.floor(Math.random() * 6)]; let o; do o = SYMS[Math.floor(Math.random() * 6)]; while (o === s); const pos = Math.floor(Math.random() * 3), syms = [s, s, s]; syms[pos] = o; return { syms, mult: 1 }; }
    const bag = SYMS.slice().sort(() => Math.random() - 0.5);
    return { syms: bag.slice(0, 3), mult: 0 };
}
function spinSlots() {
    if (CS.busy) return;
    const bet = takeBet(); if (!bet) { CS.auto = false; return; }
    save.casino.pool = csPool() + Math.round(bet * 0.03); // 3% of every spin feeds the progressive jackpot
    CS.busy = true; renderBetRow();
    const res = rollSlots(), sm = slotMachines[CS.slot];
    if (sm) { sm.spin = 2.1; sm.result = res.syms; }
    csMsg("Spinning...", "");
    const SH = 84;
    for (let k = 0; k < 3; k++) {
        const strip = $("strip" + k); if (!strip) continue;
        const syms = []; for (let j = 0; j < 22 + k * 6; j++) syms.push(SYMS[Math.floor(Math.random() * 6)]);
        syms.push(res.syms[k], SYMS[Math.floor(Math.random() * 6)]);
        strip.style.transition = "none"; strip.style.transform = "translateY(0)"; strip.innerHTML = stripHtml(syms);
        void strip.offsetWidth;
        strip.style.transition = `transform ${1.2 + k * 0.45}s cubic-bezier(.2,.7,.25,1.02)`;
        strip.style.transform = `translateY(${-(syms.length - 3) * SH}px)`;
        setTimeout(() => sfx(180 + k * 40, 0.09, "square", 0.08, 0.7), (1.2 + k * 0.45) * 1000);
    }
    for (let t = 0; t < 18; t++) setTimeout(() => sfx(900 + Math.random() * 300, 0.03, "square", 0.025, 1), t * 100);
    setTimeout(() => {
        CS.busy = false;
        const pool = res.jack ? csPool() : 0, win = Math.round(bet * res.mult) + pool;
        if (res.jack) save.casino.pool = poolBase();
        payOut(win, bet);
        if (sm) sm.win = res.mult >= 2 ? 3 : 0;
        if (res.jack) { save.casino.jack = (save.casino.jack || 0) + 1; csMsg(`★ PROGRESSIVE JACKPOT! ★ +${money(win)}`, "jack"); toast(`PROGRESSIVE JACKPOT! You won ${money(win)} on the slots!`, "cash"); }
        else if (res.mult > 1) csMsg(`WIN! +${money(win)}`, "win");
        else if (res.mult === 1) csMsg(`A pair: your ${money(bet)} back.`, "push");
        else csMsg(`No luck. -${money(bet)}`, "lose");
        if (panel === "casino" && CS.game === "slots") { renderBetRow(); $("csFoot").textContent = `Casino total: ${save.casino.net >= 0 ? "+" : "-"}${money(Math.abs(save.casino.net))} overall · biggest win ${money(save.casino.big || 0)} · F or Esc to leave the table`; }
        if (CS.auto && panel === "casino" && CS.game === "slots") setTimeout(() => { if (CS.auto && panel === "casino" && CS.game === "slots") spinSlots(); }, 700);
    }, (1.2 + 2 * 0.45) * 1000 + 150);
}

// ---- blackjack ----
const SUITS = ["♠", "♥", "♦", "♣"], RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const drawCard = () => ({ r: RANKS[Math.floor(Math.random() * 13)], s: SUITS[Math.floor(Math.random() * 4)] });
function handVal(h) { let v = 0, aces = 0; for (const c of h) { if (c.r === "A") { v += 11; aces++; } else v += ["J", "Q", "K"].includes(c.r) ? 10 : +c.r; } while (v > 21 && aces) { v -= 10; aces--; } return v; }
const cardHtml = (c, hidden, k) => hidden ? `<div class="pcard back" style="animation-delay:${k * 0.08}s"></div>` : `<div class="pcard ${c.s === "♥" || c.s === "♦" ? "red" : ""}" style="animation-delay:${k * 0.08}s"><b>${c.r}</b><i>${c.s}</i><b class="br">${c.r}</b></div>`;
function renderBJ() {
    const b = CS.bj, act = $("bjAct"); if (!act) return;
    if (!b) { $("bjDealer").innerHTML = ""; $("bjYou").innerHTML = ""; $("bjDv").textContent = ""; $("bjYv").textContent = ""; act.innerHTML = `<button class="csbtn big" data-cs="deal">DEAL <kbd>Space</kbd></button>`; return; }
    const hideHole = b.phase === "play";
    $("bjDealer").innerHTML = b.d.map((c, k) => cardHtml(c, hideHole && k === 1, k)).join("");
    $("bjYou").innerHTML = b.p.map((c, k) => cardHtml(c, false, k)).join("");
    $("bjDv").textContent = hideHole ? handVal([b.d[0]]) + " + ?" : handVal(b.d);
    $("bjYv").textContent = handVal(b.p);
    act.innerHTML = b.phase === "play"
        ? `<button class="csbtn big" data-cs="hit">HIT <kbd>Space</kbd></button><button class="csbtn big" data-cs="stand">STAND <kbd>S</kbd></button>${b.p.length === 2 && save.money >= b.bet ? `<button class="csbtn" data-cs="double">DOUBLE <kbd>D</kbd></button>` : ""}`
        : b.phase === "dealer" ? `<button class="csbtn" disabled>DEALER'S TURN...</button>` : `<button class="csbtn big" data-cs="deal">DEAL AGAIN <kbd>Space</kbd></button>`;
}
function bjDeal() {
    if (CS.bj && CS.bj.phase !== "done") return;
    const bet = takeBet(); if (!bet) return;
    CS.bj = { bet, p: [drawCard(), drawCard()], d: [drawCard(), drawCard()], phase: "play" };
    sfx(1400, 0.04, "square", 0.04, 0.7); setTimeout(() => sfx(1300, 0.04, "square", 0.04, 0.7), 120);
    csMsg("", ""); renderBetRow();
    const pv = handVal(CS.bj.p), dv = handVal(CS.bj.d);
    if (pv === 21 || dv === 21) { bjFinish(); return; }
    renderBJ();
}
function bjHit() {
    const b = CS.bj; if (!b || b.phase !== "play") return;
    b.p.push(drawCard()); sfx(1400, 0.04, "square", 0.04, 0.7);
    if (handVal(b.p) > 21) { bjFinish(); return; }
    if (handVal(b.p) === 21) { bjStand(); return; }
    renderBJ();
}
function bjDouble() {
    const b = CS.bj; if (!b || b.phase !== "play" || b.p.length !== 2 || save.money < b.bet) return;
    save.money -= b.bet; save.casino.net -= b.bet; b.bet *= 2;
    b.p.push(drawCard()); sfx(1400, 0.04, "square", 0.04, 0.7);
    if (handVal(b.p) > 21) bjFinish(); else bjStand();
}
function bjStand() {
    const b = CS.bj; if (!b || b.phase !== "play") return;
    b.phase = "dealer"; renderBJ();
    const step = () => {
        if (handVal(b.d) < 17) { b.d.push(drawCard()); sfx(1300, 0.04, "square", 0.04, 0.7); if (panel === "casino" && CS.game === "blackjack") renderBJ(); setTimeout(step, 650); }
        else bjFinish();
    };
    setTimeout(step, 600);
}
function bjFinish() {
    const b = CS.bj; b.phase = "done";
    const pv = handVal(b.p), dv = handVal(b.d), pbj = pv === 21 && b.p.length === 2, dbj = dv === 21 && b.d.length === 2;
    let pay = 0, msg, cls;
    if (pv > 21) { msg = `BUST with ${pv}. -${money(b.bet)}`; cls = "lose"; }
    else if (pbj && !dbj) { pay = Math.round(b.bet * 2.5); msg = `BLACKJACK! +${money(pay)}`; cls = "jack"; }
    else if (dbj && !pbj) { msg = `Dealer has blackjack. -${money(b.bet)}`; cls = "lose"; }
    else if (dv > 21) { pay = b.bet * 2; msg = `Dealer busts! +${money(pay)}`; cls = "win"; }
    else if (pv > dv) { pay = b.bet * 2; msg = `You win, ${pv} to ${dv}! +${money(pay)}`; cls = "win"; }
    else if (pv === dv) { pay = b.bet; msg = `Push at ${pv}. Bet returned.`; cls = "push"; }
    else { msg = `Dealer wins, ${dv} to ${pv}. -${money(b.bet)}`; cls = "lose"; }
    payOut(pay, b.bet);
    if (panel === "casino" && CS.game === "blackjack") { renderBJ(); csMsg(msg, cls); renderBetRow(); }
    else toast("Blackjack: " + msg, pay > b.bet ? "cash" : "");
}

// ---- roulette ----
function roulName(k) { return k[0] === "n" ? "number " + k.slice(1) : { red: "RED", black: "BLACK", odd: "ODD", even: "EVEN", low: "1-18", high: "19-36", d1: "1st 12", d2: "2nd 12", d3: "3rd 12" }[k]; }
function roulPays(k, n) {
    if (k[0] === "n") return +k.slice(1) === n ? 36 : 0;
    if (n === 0) return 0;
    const ok = { red: RED_N.has(n), black: !RED_N.has(n), odd: n % 2 === 1, even: n % 2 === 0, low: n <= 18, high: n >= 19, d1: n <= 12, d2: n > 12 && n <= 24, d3: n > 24 }[k];
    return ok ? (k[0] === "d" ? 3 : 2) : 0;
}
function spinRoulette() {
    if (CS.busy || !CS.roulPick) return;
    const bet = takeBet(); if (!bet) return;
    CS.busy = true; renderBetRow();
    const pick = CS.roulPick, idx = Math.floor(Math.random() * 37), n = WHEEL_ORDER[idx], seg = (Math.PI * 2) / 37;
    const start = CS.roulAng, want = -Math.PI / 2 - (idx + 0.5) * seg, diff = ((want - start) % (Math.PI * 2) + Math.PI * 4) % (Math.PI * 2), end = start + Math.PI * 8 + diff;
    const t0 = performance.now(), T = 4600, c = $("roulC");
    csMsg("No more bets...", "");
    if (roul3D) roul3D.speed = 6;
    let lastTick = 0;
    const tick = now => {
        const u = Math.min(1, (now - t0) / T), e = 1 - Math.pow(1 - u, 3);
        CS.roulAng = start + (end - start) * e;
        const ball = -Math.PI / 2 + Math.PI * 12 * (1 - e) * -1, ballR = 300 / 2 - 14 - Math.max(0, (u - 0.6) / 0.4) * 30;
        if (c && c.isConnected) drawRoulette(c.getContext("2d"), 300, CS.roulAng, ball, ballR);
        if (now - lastTick > 60 + u * 260) { lastTick = now; sfx(2200 + Math.random() * 400, 0.02, "square", 0.02 * (1 - u * 0.6), 1); }
        if (u < 1) requestAnimationFrame(tick);
        else {
            CS.busy = false; if (roul3D) roul3D.speed = 0.3;
            CS.roulHist.unshift(n); CS.roulHist.length = Math.min(CS.roulHist.length, 10);
            const m = roulPays(pick, n), win = bet * m;
            payOut(win, bet);
            const col = n === 0 ? "GREEN" : RED_N.has(n) ? "RED" : "BLACK";
            if (panel === "casino" && CS.game === "roulette") {
                renderCasinoGame();
                csMsg(m ? `${n} ${col}! You win +${money(win)}` : `${n} ${col}. -${money(bet)}`, m >= 36 ? "jack" : m ? "win" : "lose");
            } else toast(`Roulette: ${n} ${col}. ${m ? "+" + money(win) : "-" + money(bet)}`, m ? "cash" : "");
        }
    };
    requestAnimationFrame(tick);
}

// ---- the Wheel of Fortune ----
function spinWheel() {
    if (CS.busy) return;
    const free = save.casino.wheelDay !== save.day, price = wheelPrice();
    if (!free) { if (save.money < price) { csMsg("Not enough cash for a spin.", "bad"); return; } save.money -= price; save.casino.net -= price; }
    else save.casino.wheelDay = save.day;
    CS.busy = true;
    const segN = WHEEL.length, seg = (Math.PI * 2) / segN, idx = Math.floor(Math.random() * segN), W = WHEEL[idx];
    const start = CS.wheelAng, want = -Math.PI / 2 - (idx + 0.5) * seg + (Math.random() - 0.5) * seg * 0.6, diff = ((want - start) % (Math.PI * 2) + Math.PI * 4) % (Math.PI * 2), end = start + Math.PI * 6 + diff;
    const t0 = performance.now(), T = 5200, c = $("wheelC");
    csMsg(free ? "Free spin! Round and round..." : "Round and round...", "");
    let lastSeg = -1;
    const tick = now => {
        const u = Math.min(1, (now - t0) / T), e = 1 - Math.pow(1 - u, 3.2);
        CS.wheelAng = start + (end - start) * e;
        if (c && c.isConnected) drawWheel(c.getContext("2d"), 340, CS.wheelAng);
        const sNow = Math.floor(((-Math.PI / 2 - CS.wheelAng) / seg % segN + segN * 100) % segN);
        if (sNow !== lastSeg) { lastSeg = sNow; sfx(1500, 0.03, "square", 0.04, 0.8); }
        if (u < 1) requestAnimationFrame(tick);
        else { CS.busy = false; wheelPrize(W, free ? 0 : price); if (panel === "casino" && CS.game === "wheel") { const keep = $("csMsg").innerHTML, cls = $("csMsg").className; renderCasinoGame(); $("csMsg").innerHTML = keep; $("csMsg").className = cls; } }
    };
    requestAnimationFrame(tick);
}
function wheelPrize(W, paid) {
    const B = wheelBase();
    if (W.buff) { giveBuff(W.buff, 240); csMsg(`${BUFFS[W.buff].name}! A 4-minute buff.`, "win"); jingle(false); }
    else if (W.mats) { const ks = isleMats(), k = ks[Math.floor(Math.random() * Math.min(ks.length, 4))], n = 25 + (save.rebirths || 0) * 15; save.mats[k] = (save.mats[k] || 0) + n; csMsg(`+${n} ${MATS[k].name}!`, "win"); jingle(false); }
    else if (W.k > 0) { const win = Math.round(B * W.k); save.money += win; save.casino.net += win; if (win - paid > (save.casino.big || 0)) save.casino.big = win - paid; coinRain(W.jack ? 70 : 20); jingle(!!W.jack); if (W.jack) flash = 0.5; csMsg(W.jack ? `★ JACKPOT! ★ +${money(win)}` : `+${money(win)}`, W.jack ? "jack" : "win"); if (W.jack) toast(`WHEEL OF FORTUNE JACKPOT! +${money(win)}`, "cash"); }
    else { csMsg("BUST. Better luck next spin.", "lose"); sfx(140, 0.4, "sawtooth", 0.08, 0.5); }
    writeSave();
}

// ---- the bar ----
const DRINKS = [
    { n: "Lucky Cocktail", d: "LUCKY SPORE: +50% loot from trees for 4 minutes", buff: "lucky", secs: 240, p: 3 },
    { n: "Rage Shot", d: "LUMBERLUST: hit 40% harder for 3 minutes", buff: "fury", secs: 180, p: 3 },
    { n: "Lumberjack Espresso", d: "SWIFTROOT: run 30% faster for 4 minutes", buff: "swift", secs: 240, p: 2 },
    { n: "Iron Stout", d: "IRONHIDE: take 40% less damage for 4 minutes", buff: "ironhide", secs: 240, p: 2 },
    { n: "Firewater", d: "FIREPROOF: walk on lava for 3 minutes", buff: "fireproof", secs: 180, p: 2 },
    { n: "Glass of Water", d: "Heals you to full. On the house.", heal: true, p: 0 }
];
const drinkBase = () => Math.round(4000 * Math.pow(2, save.rebirths || 0));
function buyDrink(i) {
    const d = DRINKS[i], price = d.p * drinkBase();
    if (save.money < price) { csMsg("You can't afford that one.", "bad"); sfx(120, 0.15, "square", 0.08, 0.6); return; }
    save.money -= price;
    if (d.heal) { player.hp = player.maxHp; csMsg("Refreshing. Health restored.", "win"); }
    else { giveBuff(d.buff, d.secs); csMsg(`${d.n}! ${BUFFS[d.buff].name} for ${Math.round(d.secs / 60)} minutes.`, "win"); }
    sfx(700, 0.08, "triangle", 0.08, 1.3); setTimeout(() => sfx(500, 0.12, "sine", 0.06, 0.8), 120);
    writeSave();
}

// ---- input inside the panel ----
document.addEventListener("click", e => {
    if (panel !== "casino") return;
    const ch = e.target.closest("[data-chip]");
    if (ch && !ch.disabled) { const v = ch.dataset.chip; save.csBet = v === "max" ? Math.max(1, Math.min(Math.floor(save.money), 1e9)) : +v; renderBetRow(); sfx(800, 0.04, "square", 0.04, 1.2); return; }
    const rb = e.target.closest("[data-rb]");
    if (rb && !CS.busy) { CS.roulPick = rb.dataset.rb; renderCasinoGame(); sfx(900, 0.04, "square", 0.04, 1.1); return; }
    const dr = e.target.closest("[data-drink]");
    if (dr) { buyDrink(+dr.dataset.drink); return; }
    const b = e.target.closest("[data-cs]");
    if (!b || b.disabled) return;
    const a = b.dataset.cs;
    if (a === "spin") spinSlots();
    else if (a === "auto") { CS.auto = !CS.auto; b.textContent = "AUTO: " + (CS.auto ? "ON" : "OFF"); if (CS.auto && !CS.busy) spinSlots(); }
    else if (a === "deal") bjDeal(); else if (a === "hit") bjHit(); else if (a === "stand") bjStand(); else if (a === "double") bjDouble();
    else if (a === "rspin") spinRoulette();
    else if (a === "wspin") spinWheel();
});
function casinoKey(code) {
    if (CSG[CS.game] && CSG[CS.game].key && CSG[CS.game].key(code)) return true;
    if (code === "Space" || code === "Enter") {
        if (CS.game === "slots") spinSlots();
        else if (CS.game === "roulette") spinRoulette();
        else if (CS.game === "wheel") spinWheel();
        else if (CS.game === "blackjack") { if (!CS.bj || CS.bj.phase === "done") bjDeal(); else bjHit(); }
        return true;
    }
    if (CS.game === "blackjack" && code === "KeyS") { bjStand(); return true; }
    if (CS.game === "blackjack" && code === "KeyD") { bjDouble(); return true; }
    if (code === "KeyF") { closePanel(); return true; }
    return false;
}

// ---- inside: lights, music, the machines blinking ----
function casinoSky() {
    scene.background.setHex(0x14080a); scene.fog.color.setHex(0x14080a); scene.fog.near = 26; scene.fog.far = 90;
    ambL.color.setHex(0xffd0a8); ambL.intensity = 1.25; sunL.intensity = 0.35; sunL.color.setHex(0xffc890);
    sunMesh.visible = moonMesh.visible = false; starMat.opacity = 0; wisps.visible = false; cloudMat.opacity = 0;
}
const LOUNGE = [[146.8, 174.6, 220, 261.6], [196, 246.9, 293.7, 349.2], [130.8, 164.8, 196, 246.9], [110, 130.8, 164.8, 196]];
function updateCasinoInside(dt) {
    if (!casinoBuilt) return;
    { const v = inCasino(); if (csLights.length && csLights[0].visible !== v) for (const L of csLights) L.visible = v; } // no casino lights lighting up the islands
    dbUpdate();
    if (panel === "casino") { const cc = $("csCash"); if (cc) cc.textContent = money(save.money); }
    if (!inCasino()) return;
    updateNpcs(dt, casinoNpcs.filter(p => !p.patron));
    for (const p of casinoNpcs) if (p.patron) p.torso.scale.y = 1 + Math.sin(time * 2 + p.ph) * 0.015;
    for (const s of csSigns) s.material.opacity = Math.random() < 0.006 ? 0.4 : 0.95;
    for (const L of csLights) L.intensity = L.userData.b * (0.96 + Math.random() * 0.08);
    updateWing(dt);
    if (roul3D) { roul3D.ang += dt * roul3D.speed; roul3D.disc.rotation.z = roul3D.ang; }
    if (wheel3D) wheel3D.disc.rotation.z = -(CS.wheelAng + Math.PI / 2);
    for (const sm of slotMachines) {
        if (sm.spin > 0) {
            sm.spin -= dt; sm.t -= dt;
            if (sm.t <= 0) { sm.t = 0.06; sm.syms = sm.syms.map(() => SYMS[Math.floor(Math.random() * 6)]); drawSlotScreen(sm); }
            if (sm.spin <= 0 && sm.result) { sm.syms = sm.result.slice(); drawSlotScreen(sm); }
        } else if ((sm.t -= dt) <= 0) { sm.t = 2 + Math.random() * 4; sm.syms = sm.syms.map(() => SYMS[Math.floor(Math.random() * 6)]); drawSlotScreen(sm); } // attract mode
        if (sm.win > 0) sm.win -= dt;
        const blink = sm.win > 0 ? (Math.floor(time * 10) % 2 ? 0xffffff : 0xff3a3a) : [0xffd040, 0xff5ad8, 0x5ad8ff][Math.floor(time * 1.5 + sm.i) % 3];
        sm.topM.color.setHex(blink);
    }
    // a soft lounge loop, only while you're inside
    if (actx && (csMusicT -= dt) <= 0) {
        csMusicT = 0.42;
        const ch = LOUNGE[Math.floor(csChord / 8) % 4], k = csChord % 8; csChord++;
        if (k === 0) sfx(ch[0] / 2, 1.4, "sine", 0.05, 1);
        if (k % 2 === 0) sfx(ch[1 + (k / 2) % 3] * 2, 0.35, "triangle", 0.018, 1);
        if (k === 3 || k === 6) sfx(ch[3] * 2, 0.5, "sine", 0.014, 1);
    }
    casinoCd -= dt;
    if (casinoCd <= 0 && !caveFx && state === "playing" && player.pos.z < CS_Z0 + 1.1 && Math.abs(player.pos.x - CSX) < 2.4) leaveCasino();
}


// =====================================================================
//  1.6.1: THE HIGH ROLLER WING. Through the arches either side of the Wheel of Fortune:
//  the Tree Derby, Axe Rocket, Plinko, Mines, Video Poker, Scratchers and the VIP desk.
//  The slots also get a progressive jackpot that grows with every spin.
// =====================================================================
let plBoard3D = null, derby3D = null, crashScreen = null, derbyBoard = null, jackSign = null; // the wing's 3D bits (built on first visit)
const WING_Z1 = 46, ARCH_X = 12, ARCH_HW = 2.2, ARCH_H = 4.6;     // arches at CSX ± 12, 4.4 wide
const DERBY = { x: CSX, z: 33.5, a: 7, b: 4.2 };                   // the oval race track
const DERBY_WIN = { x: CSX, z: 24.6 };                             // the betting window, facing the arches
const CRASH_POD = { x: CS_X1 - 3.6, z: 27.5 };
const PLINKO_Z = 26.5, POKER_Z = [33, 36.5, 40];
const MINES_AT = [{ x: CS_X1 - 3.6, z: 34.5 }, { x: CS_X1 - 3.6, z: 39.8 }];
const VIP_AT = { x: CSX, z: 44.8 };
const wingBoxes = [
    [DERBY_WIN.x - 2.4, DERBY_WIN.x + 2.4, DERBY_WIN.z - 0.45, DERBY_WIN.z + 1.6],   // derby window counter + booth
    [CS_X0, CS_X0 + 1.5, PLINKO_Z - 2, PLINKO_Z + 2],                               // the Plinko board
    [CS_X0, CS_X0 + 2.5, POKER_Z[0] - 1, POKER_Z[2] + 1],                           // video poker machines
    [CS_X1 - 2.6, CS_X1, 42.8, WING_Z1],                                            // scratch kiosk
    [VIP_AT.x - 2.6, VIP_AT.x + 2.6, VIP_AT.z - 0.6, WING_Z1]                        // VIP desk
];
const wingCircles = [{ x: CRASH_POD.x, z: CRASH_POD.z, r: 0.55 }, ...MINES_AT.map(m => ({ x: m.x, z: m.z, r: 1.25 }))];
const inWingArch = x => Math.abs(Math.abs(x - CSX) - ARCH_X) < ARCH_HW - 0.45;
// keeps you out of the wing's furniture and the race track (called from clampCasino)
function clampWing(p) {
    // the wall between the hall and the wing, with its two arches
    if (Math.abs(p.z - CS_Z1) < 0.55 && !inWingArch(p.x)) p.z = p.z < CS_Z1 ? CS_Z1 - 0.55 : CS_Z1 + 0.55;
    if (p.z < CS_Z1) return;
    // the race track rail is an ellipse you walk around
    const ex = (p.x - DERBY.x) / (DERBY.a + 1.1), ez = (p.z - DERBY.z) / (DERBY.b + 1.1), ed = Math.hypot(ex, ez);
    if (ed < 1 && ed > 0.0001) { p.x = DERBY.x + (ex / ed) * (DERBY.a + 1.1); p.z = DERBY.z + (ez / ed) * (DERBY.b + 1.1); }
    for (const b of wingBoxes) {
        const r = 0.4; if (p.x < b[0] - r || p.x > b[1] + r || p.z < b[2] - r || p.z > b[3] + r) continue;
        const dl = p.x - (b[0] - r), dr = b[1] + r - p.x, dn = p.z - (b[2] - r), df = b[3] + r - p.z, m = Math.min(dl, dr, dn, df);
        if (m === dl) p.x = b[0] - r; else if (m === dr) p.x = b[1] + r; else if (m === dn) p.z = b[2] - r; else p.z = b[3] + r;
    }
    for (const c of wingCircles) { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + 0.45; if (d < m && d > 0.001) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; } }
}
function nearestWing() {
    const px = player.pos.x, pz = player.pos.z;
    if (pz < CS_Z1) return null;
    if (Math.abs(px - DERBY_WIN.x) < 2.8 && pz < DERBY_WIN.z - 0.2 && pz > DERBY_WIN.z - 3.4) return { k: "cderby" };
    if (Math.hypot(px - CRASH_POD.x, pz - CRASH_POD.z) < 2.4) return { k: "ccrash" };
    if (px < CS_X0 + 3.6 && Math.abs(pz - PLINKO_Z) < 2.2) return { k: "cplinko" };
    for (let i = 0; i < POKER_Z.length; i++) if (px < CS_X0 + 4.2 && Math.abs(pz - POKER_Z[i]) < 1.6) return { k: "cpoker", i };
    for (const m of MINES_AT) if (Math.hypot(px - m.x, pz - m.z) < 2.6) return { k: "cmines" };
    if (px > CS_X1 - 4.8 && pz > 42) return { k: "cscratch" };
    if (Math.abs(px - VIP_AT.x) < 3.4 && pz > 41.4) return { k: "cvip" };
    return null;
}
Object.assign(CS_PROMPTS, {
    cderby: () => (DB.phase === "race" ? "[F] Watch the Tree Derby" : "[F] Bet on the Tree Derby"), ccrash: () => "[F] Play Axe Rocket", cplinko: () => "[F] Play Plinko",
    cpoker: () => "[F] Play Video Poker", cmines: () => "[F] Play Mines", cscratch: () => "[F] Buy a scratch card", cvip: () => (vipClaimable() ? "[F] VIP desk (a gift is waiting!)" : "[F] Visit the VIP desk")
});
Object.assign(CS_TITLE, { derby: "TREE DERBY", crash: "AXE ROCKET", plinko: "PLINKO", mines: "MINES", poker: "VIDEO POKER", scratch: "SCRATCHERS", vip: "VIP LOUNGE" });
function wingInteract(n) {
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const say = {
        cderby: ["Five trees, one track. Pick a winner.", "Old Oaky's been training all week.", "Never bet against a pine in the rain."],
        ccrash: ["It goes up. It goes boom. Cash out in between.", "How high are you willing to ride?"], cplinko: ["Drop it and pray.", "Edges pay big. The middle... not so much."],
        cpoker: ["Jacks or better, friend.", "Hold the good ones."], cmines: ["Twenty-five tiles. Some of them bite.", "Know when to walk away."],
        cscratch: ["Scratch three of a kind and it's yours.", "Feeling lucky? These are hot today."], cvip: ["Welcome back. The house appreciates you.", "Right this way. VIPs only."]
    }[n.k];
    if (!say) return false;
    if (n.k === "cpoker") VP.machine = n.i;
    openCasino({ cderby: "derby", ccrash: "crash", cplinko: "plinko", cpoker: "poker", cmines: "mines", cscratch: "scratch", cvip: "vip" }[n.k], pick(say));
    return true;
}

// ---- money helpers shared by the new games ----
const csScale = () => Math.pow(2, save.rebirths || 0);
const poolBase = () => Math.round(25 * wheelBase());
const csPool = () => Math.max(save.casino.pool || 0, poolBase());
function wagered(b) { save.casino.wag = (save.casino.wag || 0) + b; save.casino.wagT = (save.casino.wagT || 0) + b; }
function wonBack(a) { save.casino.wonT = (save.casino.wonT || 0) + a; }
const csFoot = () => `Casino total: ${save.casino.net >= 0 ? "+" : "-"}${money(Math.abs(save.casino.net || 0))} · biggest win ${money(save.casino.big || 0)} · VIP ${VIP[vipTier()].n} · F or Esc to leave`;
const fmtX = m => (m >= 100 ? m.toFixed(0) : m.toFixed(2)) + "×";

// =========================== AXE ROCKET (crash) ===========================
const CR = { phase: "idle", bet: 0, m: 1, crash: 1, t0: 0, auto: 0, hist: [], cashed: 0, demo: { t0: 0, crash: 2, phase: "fly" } };
const crM = t => Math.exp(0.11 * t);
function crRoll() { const u = Math.random(); return u < 0.03 ? 1 : Math.min(1000, Math.max(1, Math.floor((0.97 / (1 - u)) * 100) / 100)); }
function drawCrash(g, W, H, t, m, crashed, cashedAt) {
    g.fillStyle = "#0c0612"; g.fillRect(0, 0, W, H);
    const tMax = Math.max(8, t * 1.15), mMax = Math.max(2, m * 1.2), X = s => 40 + (s / tMax) * (W - 60), Y = v => H - 30 - ((v - 1) / (mMax - 1)) * (H - 60);
    g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 1; g.font = "12px Consolas"; g.fillStyle = "rgba(255,255,255,.4)";
    for (let k = 1; k <= 5; k++) { const v = 1 + ((mMax - 1) * k) / 5, y = Y(v); g.beginPath(); g.moveTo(40, y); g.lineTo(W - 10, y); g.stroke(); g.fillText(v.toFixed(1) + "×", 2, y + 4); }
    const col = crashed ? "#ff3a3a" : cashedAt ? "#6dffa0" : "#ffb020";
    g.strokeStyle = col; g.lineWidth = 4; g.shadowColor = col; g.shadowBlur = 12; g.beginPath();
    for (let k = 0; k <= 60; k++) { const s = (t * k) / 60, x = X(s), y = Y(crM(s)); k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.shadowBlur = 0;
    const tx = X(t), ty = Y(m), ang = Math.atan2(Y(crM(t)) - Y(crM(Math.max(0, t - 0.3))), X(t) - X(Math.max(0, t - 0.3)));
    if (!crashed) { // the rocket axe, flame first
        g.save(); g.translate(tx, ty); g.rotate(ang);
        g.fillStyle = "#ff7a1a"; g.beginPath(); g.moveTo(-14, -5); g.lineTo(-30 - Math.random() * 12, 0); g.lineTo(-14, 5); g.fill();
        g.fillStyle = "#8a5a34"; g.fillRect(-14, -3, 28, 6); g.fillStyle = "#cfd8ee"; g.beginPath(); g.moveTo(8, -3); g.lineTo(18, -16); g.quadraticCurveTo(26, -2, 18, 12); g.lineTo(8, 3); g.fill();
        g.restore();
    } else { g.fillStyle = "#ff5a1a"; for (let k = 0; k < 14; k++) { const a = (k / 14) * 6.28; g.beginPath(); g.arc(tx + Math.cos(a) * 16, ty + Math.sin(a) * 16, 5, 0, 7); g.fill(); } }
    g.textAlign = "center"; g.font = `900 ${Math.round(H * 0.2)}px Consolas`; g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 18;
    g.fillText(crashed ? "CRASHED @ " + fmtX(m) : fmtX(m), W / 2, H * 0.36); g.shadowBlur = 0;
    if (cashedAt && !crashed) { g.font = "700 18px Consolas"; g.fillStyle = "#6dffa0"; g.fillText("CASHED OUT @ " + fmtX(cashedAt), W / 2, H * 0.36 + 28); }
    g.textAlign = "left";
}
function crRender(G) {
    const flying = CR.phase === "fly";
    G.innerHTML = `<div class="crWrap"><canvas id="crC" width="680" height="300"></canvas></div>
      <div class="crRow"><span class="lbl">AUTO CASH-OUT</span>${[0, 1.5, 2, 3, 5, 10, 25].map(v => `<button class="pill ${CR.auto === v ? "on" : ""}" data-c2="auto:${v}">${v ? v + "×" : "OFF"}</button>`).join("")}</div>
      <div class="crHist">LAST: ${CR.hist.map(v => `<span class="${v >= 2 ? "hi" : "lo"}">${fmtX(v)}</span>`).join("") || "—"}</div>
      <div class="csActions" id="crAct">${flying ? (CR.cashed ? `<button class="csbtn" disabled>CASHED OUT +${money(Math.round(CR.bet * CR.cashed))}</button>` : `<button class="csbtn big green" data-c2="cash">CASH OUT <span id="crCash">${money(Math.round(CR.bet * CR.m))}</span> <kbd>Space</kbd></button>`) : `<button class="csbtn big" data-c2="launch">LAUNCH <kbd>Space</kbd></button>`}</div>`;
    crDraw();
}
function crDraw() { const c = $("crC"); if (c && c.isConnected) drawCrash(c.getContext("2d"), c.width, c.height, CR.phase === "idle" ? 0 : (performance.now() - CR.t0) / 1000 * (CR.phase === "done" ? 0 : 1) + (CR.phase === "done" ? CR.tEnd : 0), CR.m, CR.phase === "done" && CR.m >= CR.crash, CR.cashed); }
function crLaunch() {
    if (CR.phase === "fly") return;
    const bet = takeBet(); if (!bet) return;
    Object.assign(CR, { phase: "fly", bet, m: 1, crash: crRoll(), t0: performance.now(), cashed: 0 });
    csMsg("3... 2... 1... LIFT OFF!", ""); sfx(120, 0.6, "sawtooth", 0.08, 3);
    if (panel === "casino" && CS.game === "crash") crRender($("csGame"));
    let lastBeep = 0;
    const tick = now => {
        const t = (now - CR.t0) / 1000; CR.m = Math.min(crM(t), CR.crash);
        if (!CR.cashed && CR.auto && CR.m >= CR.auto) crCash(CR.auto);
        if (!CR.cashed && (panel !== "casino" || CS.game !== "crash")) crCash(CR.m); // walked away: we cash you out
        if (now - lastBeep > Math.max(60, 400 / CR.m)) { lastBeep = now; sfx(300 + CR.m * 40, 0.03, "square", 0.02, 1); }
        const cc = $("crCash"); if (cc) cc.textContent = money(Math.round(CR.bet * CR.m));
        if (CR.m >= CR.crash) {
            CR.phase = "done"; CR.tEnd = t; CR.hist.unshift(CR.crash); CR.hist.length = Math.min(CR.hist.length, 12);
            sfx(80, 0.6, "sawtooth", 0.16, 0.3); sfx(50, 0.8, "square", 0.12, 0.4);
            if (!CR.cashed) { payOut(0, CR.bet); csMsg(`CRASHED at ${fmtX(CR.crash)}. -${money(CR.bet)}`, "lose"); }
            if (panel === "casino" && CS.game === "crash") { const keep = $("csMsg").innerHTML, cls = $("csMsg").className; crRender($("csGame")); renderBetRow(); $("csMsg").innerHTML = keep; $("csMsg").className = cls; }
            return;
        }
        crDraw();
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}
function crCash(at) {
    if (CR.phase !== "fly" || CR.cashed) return;
    CR.cashed = Math.min(at || CR.m, CR.crash);
    const win = Math.round(CR.bet * CR.cashed); payOut(win, CR.bet);
    csMsg(`Cashed out at ${fmtX(CR.cashed)}! +${money(win)}`, CR.cashed >= 10 ? "jack" : "win");
    if (panel === "casino" && CS.game === "crash") { const a = $("crAct"); if (a) a.innerHTML = `<button class="csbtn" disabled>CASHED OUT +${money(win)}</button>`; }
    else toast(`Axe Rocket: cashed out at ${fmtX(CR.cashed)} for +${money(win)}`, "cash");
}

// =========================== PLINKO ===========================
const PLINKO = { low: [10, 3, 1.6, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.6, 3, 10], med: [33, 11, 4, 2, 1.1, 0.5, 0.4, 0.5, 1.1, 2, 4, 11, 33], high: [170, 24, 8.1, 1.9, 0.7, 0.2, 0.2, 0.2, 0.7, 1.9, 8.1, 24, 170] };
const PL = { risk: "med", balls: [], flash: {}, loop: false };
const PL_ROWS = 12, PL_W = 520, PL_H = 470;
const plSlotCol = m => (m >= 10 ? "#ff3a5a" : m >= 3 ? "#ff8a2a" : m >= 1.5 ? "#ffd040" : m >= 1 ? "#6dffa0" : "#5a8aff");
// where a ball is, t rows into its fall (board coordinates 0..1)
function plPos(b, t) {
    const r = Math.min(PL_ROWS, Math.floor(t)), f = t - r;
    let x = 0; for (let k = 0; k < r; k++) x += b.path[k] ? 0.5 : -0.5;
    const nx = r < PL_ROWS ? x + (b.path[r] ? 0.5 : -0.5) : x;
    const xx = x + (nx - x) * f, yy = r + f - Math.sin(f * Math.PI) * 0.35 * (r < PL_ROWS ? 1 : 0);
    return { x: 0.5 + xx / (PL_ROWS + 2), y: (yy + 0.6) / (PL_ROWS + 1.6) };
}
function drawPlinko(g, W, H, balls, risk) {
    g.fillStyle = "#0e0818"; g.fillRect(0, 0, W, H);
    const M = PLINKO[risk], sp = W / (PL_ROWS + 2);
    g.fillStyle = "#e8dcff";
    for (let r = 0; r < PL_ROWS; r++) for (let k = 0; k <= r + 2; k++) { const x = W / 2 + (k - (r + 2) / 2) * sp, y = ((r + 1.1) / (PL_ROWS + 1.6)) * (H - 40); g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill(); }
    const sw = sp * 0.94, y0 = H - 34;
    M.forEach((m, k) => { const x = W / 2 + (k - 6) * sp - sw / 2, lit = PL.flash[k] > performance.now(); g.fillStyle = plSlotCol(m); g.globalAlpha = lit ? 1 : 0.75; g.fillRect(x, y0 - (lit ? 6 : 0), sw, 28); g.globalAlpha = 1; g.fillStyle = "#14080e"; g.font = `800 ${m >= 100 ? 10 : 11}px Consolas`; g.textAlign = "center"; g.fillText(m + "×", x + sw / 2, y0 + 18 - (lit ? 6 : 0)); });
    g.textAlign = "left";
    for (const b of balls) { const p = plPos(b, b.t); g.fillStyle = "#ff5ad8"; g.shadowColor = "#ff5ad8"; g.shadowBlur = 10; g.beginPath(); g.arc(p.x * W, p.y * (H - 40), 7, 0, 7); g.fill(); g.shadowBlur = 0; }
}
function plRender(G) {
    G.innerHTML = `<div class="plWrap"><canvas id="plC" width="${PL_W}" height="${PL_H}"></canvas>
      <div class="plSide"><span class="lbl">RISK</span>${["low", "med", "high"].map(r => `<button class="pill ${PL.risk === r ? "on" : ""}" data-c2="risk:${r}">${r === "med" ? "MEDIUM" : r.toUpperCase()}</button>`).join("")}
      <p>Each drop costs one bet. The ball bounces off 12 rows of pegs into a slot: the edges pay big, the middle pays small.</p><p>Drop as many balls as you like.</p></div></div>
      <div class="csActions"><button class="csbtn big" data-c2="drop">DROP BALL <kbd>Space</kbd></button><button class="csbtn" data-c2="drop5">DROP 5</button></div>`;
    const c = $("plC"); drawPlinko(c.getContext("2d"), PL_W, PL_H, PL.balls, PL.risk);
}
function plDrop() {
    if (PL.balls.length >= 15) return;
    const bet = takeBet(); if (!bet) return;
    const path = []; for (let k = 0; k < PL_ROWS; k++) path.push(Math.random() < 0.5 ? 0 : 1);
    const b = { path, t: 0, bet, risk: PL.risk, slot: path.reduce((s, v) => s + v, 0) };
    PL.balls.push(b); plBoard3D && plBoard3D.drop(b);
    sfx(1200, 0.05, "triangle", 0.05, 0.8);
    if (!PL.loop) { PL.loop = true; let last = performance.now();
        const tick = now => {
            const dt = Math.min(0.05, (now - last) / 1000); last = now;
            for (let i = PL.balls.length - 1; i >= 0; i--) {
                const b = PL.balls[i], r0 = Math.floor(b.t); b.t += dt * 7.5;
                if (Math.floor(b.t) !== r0 && b.t < PL_ROWS) sfx(1400 + Math.random() * 600, 0.02, "square", 0.015, 1);
                if (b.t >= PL_ROWS + 0.4) { PL.balls.splice(i, 1); const m = PLINKO[b.risk][b.slot], win = Math.round(b.bet * m); payOut(win, b.bet); PL.flash[b.slot] = performance.now() + 500;
                    csMsg(m >= 1 ? `${m}× · +${money(win)}` : `${m}× · ${money(win)} back`, m >= 10 ? "jack" : m > 1 ? "win" : "lose"); sfx(m >= 1 ? 900 : 300, 0.12, "triangle", 0.06, m >= 1 ? 1.4 : 0.7); }
            }
            const c = $("plC"); if (c && c.isConnected) drawPlinko(c.getContext("2d"), PL_W, PL_H, PL.balls, PL.risk);
            if (PL.balls.length || Object.values(PL.flash).some(v => v > now)) requestAnimationFrame(tick); else PL.loop = false;
        };
        requestAnimationFrame(tick);
    }
}

// =========================== MINES ===========================
const MN = { mines: 3, phase: "idle", bet: 0, grid: [], open: [], picks: 0, boom: -1 };
const mnMult = (mines, picks) => { let m = 1; for (let i = 0; i < picks; i++) m *= (25 - i) / (25 - mines - i); return picks ? m * 0.97 : 1; };
function mnRender(G) {
    const play = MN.phase === "play", cur = mnMult(MN.mines, MN.picks), nxt = mnMult(MN.mines, MN.picks + 1);
    G.innerHTML = `<div class="mnWrap"><div class="mnGrid">${Array.from({ length: 25 }, (_, i) => {
        const o = MN.open[i], mine = MN.grid[i], show = o || (MN.phase === "done" && mine);
        return `<button class="mt ${show ? (mine ? (i === MN.boom ? "boom" : "mine") : "gem") : ""} ${MN.phase === "done" && !o && !mine ? "dim" : ""}" data-c2="t:${i}" ${play && !o ? "" : "disabled"}>${show ? (mine ? "✹" : "◆") : ""}</button>`; }).join("")}</div>
      <div class="mnSide"><span class="lbl">MINES</span><div>${[1, 3, 5, 10, 20].map(n => `<button class="pill ${MN.mines === n ? "on" : ""}" data-c2="mines:${n}" ${play ? "disabled" : ""}>${n}</button>`).join("")}</div>
      ${play ? `<p>Gems found: <b>${MN.picks}</b></p><p>Now: <b class="gold">${fmtX(cur)}</b> = ${money(Math.round(MN.bet * cur))}</p><p>Next gem: <b>${fmtX(nxt)}</b></p>` : `<p>Find gems, dodge mines. Every gem raises your multiplier. Cash out whenever you like, but hit a mine and you lose the bet.</p><p>More mines = bigger multipliers.</p>`}</div></div>
      <div class="csActions">${play ? `<button class="csbtn big green" data-c2="mcash" ${MN.picks ? "" : "disabled"}>CASH OUT ${money(Math.round(MN.bet * cur))} <kbd>Space</kbd></button>` : `<button class="csbtn big" data-c2="mstart">START <kbd>Space</kbd></button>`}</div>`;
}
function mnStart() {
    if (MN.phase === "play") return;
    const bet = takeBet(); if (!bet) return;
    const g = Array(25).fill(false); let n = 0; while (n < MN.mines) { const i = Math.floor(Math.random() * 25); if (!g[i]) { g[i] = true; n++; } }
    Object.assign(MN, { phase: "play", bet, grid: g, open: Array(25).fill(false), picks: 0, boom: -1 });
    csMsg("Pick a tile.", ""); mnRender($("csGame")); renderBetRow();
}
function mnPick(i) {
    if (MN.phase !== "play" || MN.open[i]) return;
    MN.open[i] = true;
    if (MN.grid[i]) { MN.phase = "done"; MN.boom = i; payOut(0, MN.bet); csMsg(`BOOM! -${money(MN.bet)}`, "lose"); sfx(60, 0.6, "sawtooth", 0.18, 0.3); sfx(90, 0.4, "square", 0.12, 0.4); shake = 0.3; }
    else { MN.picks++; sfx(900 + MN.picks * 60, 0.1, "triangle", 0.07, 1.3); if (MN.picks >= 25 - MN.mines) { mnCash(); return; } csMsg(`Gem! ${fmtX(mnMult(MN.mines, MN.picks))}`, "win"); }
    mnRender($("csGame"));
}
function mnCash() {
    if (MN.phase !== "play" || !MN.picks) return;
    const m = mnMult(MN.mines, MN.picks), win = Math.round(MN.bet * m); MN.phase = "done";
    payOut(win, MN.bet); csMsg(`Cashed out at ${fmtX(m)}! +${money(win)}`, m >= 10 ? "jack" : "win");
    mnRender($("csGame")); renderBetRow();
}

// =========================== TREE DERBY ===========================
const RACERS = [
    { n: "Old Oaky", leaf: 0x3a7a2a, sash: 0xff3a3a, css: "#ff5a5a" }, { n: "Pine Bolt", leaf: 0x1e5a34, sash: 0xffd040, css: "#ffd040" },
    { n: "Sir Birchalot", leaf: 0x9ac85a, sash: 0x3a8aff, css: "#5a9aff" }, { n: "Shroom Zoom", leaf: 0x7a3ad8, sash: 0xffffff, css: "#e8e0ff" },
    { n: "Ember Dash", leaf: 0xff6a1a, sash: 0x2a2a2a, css: "#ff8a3a" }
];
const DB = { phase: "card", pick: -1, bet: 0, p: [], odds: [], fin: [], winner: -1, t0: 0, T: 10, prog: [0, 0, 0, 0, 0], order: [], last: [] };
function dbCard() {
    const w = RACERS.map(() => 0.4 + Math.random() * 1.6), fav = Math.floor(Math.random() * 5); w[fav] += 1.2;
    const s = w.reduce((a, b) => a + b, 0);
    DB.p = w.map(v => v / s); DB.odds = DB.p.map(p => Math.max(1.3, Math.floor((0.92 / p) * 10) / 10));
    DB.phase = "card"; DB.prog = [0, 0, 0, 0, 0]; drawDerbyBoard();
}
dbCard();
function dbStart() {
    if (DB.phase === "race") return;
    if (DB.phase === "done") { dbCard(); DB.pick = -1; derbyRender($("csGame")); return; }
    if (DB.pick < 0) { csMsg("Pick a tree first.", "bad"); return; }
    const bet = takeBet(); if (!bet) return;
    DB.bet = bet;
    let r = Math.random(), win = 0; for (let i = 0; i < 5; i++) { r -= DB.p[i]; if (r <= 0) { win = i; break; } win = i; }
    DB.winner = win;
    const others = [0, 1, 2, 3, 4].filter(i => i !== win).sort(() => Math.random() - 0.5);
    DB.fin = []; DB.fin[win] = DB.T; others.forEach((i, k) => { DB.fin[i] = DB.T * (1.02 + k * 0.035 + Math.random() * 0.02); });
    DB.wob = RACERS.map(() => [Math.random() * 6, 0.5 + Math.random(), Math.random() * 6]);
    DB.order = [win, ...others]; DB.phase = "race"; DB.t0 = performance.now();
    csMsg("And they're OFF!", ""); sfx(800, 0.5, "square", 0.08, 1); setTimeout(() => sfx(1000, 0.5, "square", 0.08, 1), 250);
    derbyRender($("csGame"));
}
// how far round the track each racer is at time t (0..1); the winner crosses first
function dbProg(i, t) {
    const f = DB.fin[i], w = DB.wob[i], k = Math.min(1, t / f), wob = 0.05 * Math.sin(t * w[1] + w[0]) * Math.sin(Math.PI * k) + 0.02 * Math.sin(t * 3.1 + w[2]) * Math.sin(Math.PI * k);
    return Math.min(1, Math.max(0, k + wob));
}
function dbUpdate() {
    if (DB.phase !== "race") return;
    const t = (performance.now() - DB.t0) / 1000;
    DB.prog = DB.prog.map((_, i) => dbProg(i, t));
    if (panel === "casino" && CS.game === "derby") { const c = $("dbC"); if (c && c.isConnected) drawDerbyRace(c.getContext("2d"), c.width, c.height); }
    if (t >= Math.max(...DB.fin) + 0.4) {
        DB.phase = "done"; DB.last.unshift(DB.winner); DB.last.length = Math.min(DB.last.length, 6);
        const won = DB.pick === DB.winner, win = won ? Math.round(DB.bet * DB.odds[DB.winner]) : 0;
        payOut(win, DB.bet);
        const msg = won ? `${RACERS[DB.winner].n} WINS! +${money(win)}` : `${RACERS[DB.winner].n} wins. Your tree came ${["", "first", "second", "third", "fourth", "last"][DB.order.indexOf(DB.pick) + 1]}. -${money(DB.bet)}`;
        if (panel === "casino" && CS.game === "derby") { csMsg(msg, won ? (DB.odds[DB.winner] >= 6 ? "jack" : "win") : "lose"); derbyRender($("csGame")); renderBetRow(); }
        else if (DB.bet) toast("Tree Derby: " + msg, won ? "cash" : "");
        DB.bet = 0; drawDerbyBoard();
    }
}
function drawDerbyRace(g, W, H) {
    g.fillStyle = "#1a3a1a"; g.fillRect(0, 0, W, H);
    const lane = (H - 20) / 5, x0 = 70, x1 = W - 40;
    for (let i = 0; i < 5; i++) { const y = 10 + i * lane; g.fillStyle = i % 2 ? "#6a4a2a" : "#7a5634"; g.fillRect(0, y, W, lane - 2); g.fillStyle = RACERS[i].css; g.font = "700 12px Consolas"; g.fillText(RACERS[i].n.split(" ")[0].toUpperCase(), 6, y + lane / 2 + 4); }
    g.fillStyle = "#fff"; for (let k = 0; k < 10; k++) { g.fillStyle = k % 2 ? "#fff" : "#111"; g.fillRect(x1, 10 + k * (H - 20) / 10, 8, (H - 20) / 10); }
    for (let i = 0; i < 5; i++) {
        const y = 10 + i * lane + lane / 2, x = x0 + DB.prog[i] * (x1 - x0 - 10), bob = DB.phase === "race" ? Math.abs(Math.sin(performance.now() / 90 + i)) * 4 : 0, L = "#" + RACERS[i].leaf.toString(16).padStart(6, "0");
        g.fillStyle = "#5a3a22"; g.fillRect(x - 3, y - 2 - bob, 6, 12);
        g.fillStyle = L; g.beginPath(); g.moveTo(x, y - 20 - bob); g.lineTo(x + 12, y + 2 - bob); g.lineTo(x - 12, y + 2 - bob); g.fill();
        g.fillStyle = RACERS[i].css; g.fillRect(x - 7, y - 6 - bob, 14, 4);
        if (DB.pick === i) { g.strokeStyle = "#ffd040"; g.lineWidth = 2; g.strokeRect(x - 15, y - 23 - bob, 30, 36); }
    }
}
function derbyRender(G) {
    const racing = DB.phase === "race";
    G.innerHTML = `<canvas id="dbC" width="680" height="200"></canvas>
      <div class="dbCard">${RACERS.map((r, i) => `<button class="dbR ${DB.pick === i ? "on" : ""} ${DB.phase === "done" && DB.winner === i ? "won" : ""}" data-c2="pick:${i}" ${racing ? "disabled" : ""} style="--c:${r.css}"><b>${r.n}</b><span>${DB.odds[i].toFixed(1)}×</span><small>form ${"★".repeat(Math.max(1, Math.round(DB.p[i] * 12)))}</small></button>`).join("")}</div>
      <div class="crHist">LAST WINNERS: ${DB.last.map(i => `<span style="color:${RACERS[i].css}">${RACERS[i].n}</span>`).join(" · ") || "—"}</div>
      <div class="csActions">${racing ? `<button class="csbtn" disabled>RACING...</button>` : DB.phase === "done" ? `<button class="csbtn big" data-c2="race">NEXT RACE <kbd>Space</kbd></button>` : `<button class="csbtn big" data-c2="race" ${DB.pick < 0 ? "disabled" : ""}>START RACE <kbd>Space</kbd></button>`}</div>`;
    const c = $("dbC"); drawDerbyRace(c.getContext("2d"), c.width, c.height);
}

// =========================== VIDEO POKER (Jacks or Better) ===========================
const VP_PAY = [["Royal Flush", 250], ["Straight Flush", 50], ["Four of a Kind", 25], ["Full House", 9], ["Flush", 6], ["Straight", 4], ["Three of a Kind", 3], ["Two Pair", 2], ["Jacks or Better", 1]];
const VP = { phase: "idle", bet: 0, hand: [], held: [false, false, false, false, false], deck: [], result: -1, machine: 0 };
function vpDeck() { const d = []; for (const s of SUITS) for (const r of RANKS) d.push({ r, s }); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; }
function vpEval(h) {
    const val = c => ({ A: 14, K: 13, Q: 12, J: 11 })[c.r] || +c.r, v = h.map(val).sort((a, b) => a - b), cnt = {};
    for (const x of v) cnt[x] = (cnt[x] || 0) + 1;
    const groups = Object.values(cnt).sort((a, b) => b - a), flush = h.every(c => c.s === h[0].s);
    const uniq = groups.length === 5, straight = uniq && (v[4] - v[0] === 4 || (v[4] === 14 && v[0] === 2 && v[3] === 5));
    if (straight && flush) return v[0] === 10 ? 0 : 1;
    if (groups[0] === 4) return 2; if (groups[0] === 3 && groups[1] === 2) return 3; if (flush) return 4; if (straight) return 5;
    if (groups[0] === 3) return 6; if (groups[0] === 2 && groups[1] === 2) return 7;
    if (groups[0] === 2) { const pr = +Object.keys(cnt).find(k => cnt[k] === 2); if (pr >= 11) return 8; }
    return -1;
}
function vpRender(G) {
    const hold = VP.phase === "hold";
    G.innerHTML = `<div class="vpPay">${VP_PAY.map(([n, m], i) => `<div class="${VP.result === i && VP.phase === "done" ? "hit" : ""}"><span>${n}</span><b>${m}×</b></div>`).join("")}</div>
      <div class="vpHand">${VP.hand.length ? VP.hand.map((c, k) => `<div class="vpSlot ${VP.held[k] ? "held" : ""}" data-c2="hold:${k}">${cardHtml(c, false, k)}<em>${VP.held[k] ? "HELD" : hold ? "click / " + (k + 1) : ""}</em></div>`).join("") : [0, 1, 2, 3, 4].map(k => `<div class="vpSlot">${cardHtml(null, true, k)}</div>`).join("")}</div>
      <div class="csActions">${hold ? `<button class="csbtn big" data-c2="draw">DRAW <kbd>Space</kbd></button>` : `<button class="csbtn big" data-c2="deal">DEAL <kbd>Space</kbd></button>`}</div>`;
}
function vpDeal() {
    if (VP.phase === "hold") return vpDraw();
    const bet = takeBet(); if (!bet) return;
    VP.deck = vpDeck(); VP.hand = VP.deck.splice(0, 5); VP.held = [false, false, false, false, false]; VP.bet = bet; VP.phase = "hold"; VP.result = -1;
    const pre = vpEval(VP.hand); csMsg(pre >= 0 ? `You're holding ${VP_PAY[pre][0]}! Hold the cards you want, then DRAW.` : "Hold the cards you want to keep, then DRAW.", "");
    sfx(600, 0.06, "triangle", 0.06, 1.2); vpRender($("csGame")); renderBetRow();
}
function vpDraw() {
    if (VP.phase !== "hold") return;
    VP.hand = VP.hand.map((c, k) => (VP.held[k] ? c : VP.deck.shift()));
    const r = vpEval(VP.hand), m = r >= 0 ? VP_PAY[r][1] : 0, win = Math.round(VP.bet * m);
    VP.phase = "done"; VP.result = r;
    payOut(win, VP.bet);
    csMsg(r >= 0 ? `${VP_PAY[r][0]}! ${m > 1 ? "+" + money(win) : "Your bet back."}` : `Nothing. -${money(VP.bet)}`, r >= 0 && r <= 2 ? "jack" : r >= 0 && m > 1 ? "win" : r >= 0 ? "push" : "lose");
    sfx(500, 0.06, "triangle", 0.06, 1.2); vpRender($("csGame")); renderBetRow();
}

// =========================== SCRATCHERS ===========================
const SC_TIERS = [{ n: "Lucky Leaf", k: 1, col: "#6dffa0" }, { n: "Gold Rush", k: 10, col: "#ffd040" }, { n: "Diamond Dream", k: 100, col: "#9fe8ff" }];
const SC_PRIZES = [[1, 0.14], [2, 0.08], [5, 0.035], [10, 0.015], [50, 0.003], [500, 0.0003]];
const scUnit = () => Math.round(1000 * csScale());
const SC = { card: null };
function scBuy(tier) {
    if (SC.card && !SC.card.done) { csMsg("Finish scratching this one first.", "bad"); return; }
    const T = SC_TIERS[tier], price = T.k * scUnit();
    if (save.money < price) { csMsg("Not enough cash for that card.", "bad"); return; }
    save.money -= price; save.casino.net -= price; save.casino.plays = (save.casino.plays || 0) + 1; wagered(price);
    let r = Math.random(), win = -1; for (let i = 0; i < SC_PRIZES.length; i++) { if (r < SC_PRIZES[i][1]) { win = i; break; } r -= SC_PRIZES[i][1]; }
    const cells = []; if (win >= 0) cells.push(win, win, win);
    const cnt = {}; if (win >= 0) cnt[win] = 3;
    while (cells.length < 9) { const s = Math.floor(Math.random() * SC_PRIZES.length); if (s === win || (cnt[s] || 0) >= 2) continue; cnt[s] = (cnt[s] || 0) + 1; cells.push(s); }
    cells.sort(() => Math.random() - 0.5);
    SC.card = { tier, price, cells, win, done: false, revealed: Array(9).fill(false) };
    sfx(700, 0.08, "triangle", 0.07, 1.3);
    scRender($("csGame"));
}
function scRender(G) {
    const c = SC.card;
    G.innerHTML = `<div class="scWrap"><div class="scShop">${SC_TIERS.map((T, i) => `<button class="scBuy" data-c2="buy:${i}" style="--c:${T.col}"><b>${T.n}</b><span>${money(T.k * scUnit())}</span><small>top prize ${money(T.k * scUnit() * 500)}</small></button>`).join("")}
      <p>Match three of the same prize to win it. Click and drag to scratch.</p></div>
      <div class="scCard" style="--c:${c ? SC_TIERS[c.tier].col : "#888"}">${c ? `<div class="scHead">${SC_TIERS[c.tier].n.toUpperCase()}</div><div class="scBox"><canvas id="scBase" width="330" height="330"></canvas><canvas id="scFoil" width="330" height="330"></canvas></div>` : `<div class="scEmpty">Buy a card to start</div>`}</div></div>
      <div class="csActions">${c && !c.done ? `<button class="csbtn" data-c2="reveal">REVEAL ALL <kbd>Space</kbd></button>` : ""}</div>`;
    if (!c) return;
    const g = $("scBase").getContext("2d"), cw = 110;
    g.fillStyle = "#f4ecd8"; g.fillRect(0, 0, 330, 330);
    c.cells.forEach((s, k) => { const x = (k % 3) * cw, y = Math.floor(k / 3) * cw, amt = c.price * SC_PRIZES[s][0], hit = c.done && s === c.win;
        g.fillStyle = hit ? "#ffd040" : "#e8dcc0"; g.fillRect(x + 4, y + 4, cw - 8, cw - 8); g.fillStyle = hit ? "#3a1a00" : "#3a2a1a"; g.textAlign = "center";
        g.font = "900 20px Consolas"; g.fillText(money(amt), x + cw / 2, y + cw / 2 + 6); });
    const f = $("scFoil"), fg = f.getContext("2d");
    if (c.done) { f.style.display = "none"; return; }
    const grd = fg.createLinearGradient(0, 0, 330, 330); grd.addColorStop(0, "#b8bcc8"); grd.addColorStop(0.5, "#e8ecf4"); grd.addColorStop(1, "#9aa0ae");
    fg.fillStyle = grd; fg.fillRect(0, 0, 330, 330);
    fg.fillStyle = "rgba(60,60,80,.35)"; fg.font = "900 18px Consolas"; fg.textAlign = "center";
    for (let k = 0; k < 9; k++) { const x = (k % 3) * cw, y = Math.floor(k / 3) * cw; fg.fillText("SCRATCH", x + cw / 2, y + cw / 2 + 6); fg.strokeStyle = "rgba(60,60,80,.25)"; fg.strokeRect(x + 4, y + 4, cw - 8, cw - 8); }
    c.revealed.forEach((v, k) => { if (v) fg.clearRect((k % 3) * cw, Math.floor(k / 3) * cw, cw, cw); });
    let down = false;
    const scratch = e => {
        const rc = f.getBoundingClientRect(), x = (e.clientX - rc.left) * (330 / rc.width), y = (e.clientY - rc.top) * (330 / rc.height);
        fg.globalCompositeOperation = "destination-out"; fg.beginPath(); fg.arc(x, y, 21, 0, 7); fg.fill(); fg.globalCompositeOperation = "source-over";
        if (Math.random() < 0.3) sfx(3000 + Math.random() * 1500, 0.02, "sawtooth", 0.008, 0.5);
        scCheck(fg);
    };
    f.addEventListener("pointerdown", e => { down = true; scratch(e); });
    f.addEventListener("pointermove", e => { if (down) scratch(e); });
    addEventListener("pointerup", () => (down = false), { once: true });
}
function scCheck(fg) {
    const c = SC.card; if (!c || c.done) return;
    const d = fg.getImageData(0, 0, 330, 330).data, cw = 110;
    for (let k = 0; k < 9; k++) {
        if (c.revealed[k]) continue;
        let clear = 0, n = 0; const x0 = (k % 3) * cw, y0 = Math.floor(k / 3) * cw;
        for (let y = y0 + 10; y < y0 + cw - 10; y += 6) for (let x = x0 + 10; x < x0 + cw - 10; x += 6) { n++; if (d[(y * 330 + x) * 4 + 3] < 40) clear++; }
        if (clear / n > 0.42) c.revealed[k] = true;
    }
    if (c.revealed.every(Boolean)) scFinish();
}
function scFinish() {
    const c = SC.card; if (!c || c.done) return;
    c.done = true;
    const win = c.win >= 0 ? Math.round(c.price * SC_PRIZES[c.win][0]) : 0;
    payOut(win, c.price);
    csMsg(win ? `Three of a kind! +${money(win)}` : "No match this time.", win >= c.price * 10 ? "jack" : win > c.price ? "win" : win ? "push" : "lose");
    scRender($("csGame"));
}

// =========================== VIP ===========================
const VIP = [{ n: "BRONZE", at: 0, cb: 0, gift: 0, col: "#d8925a" }, { n: "SILVER", at: 25, cb: 0.05, gift: 1, col: "#d8dce8" }, { n: "GOLD", at: 250, cb: 0.08, gift: 3, col: "#ffd040" }, { n: "PLATINUM", at: 2500, cb: 0.12, gift: 8, col: "#bfe8ff" }, { n: "DIAMOND", at: 25000, cb: 0.15, gift: 20, col: "#9ff8ff" }];
const vipNeed = i => VIP[i].at * 20000; // fixed amounts, so rebirths don't knock you down a tier
function vipTier() { const w = save.casino.wag || 0; let t = 0; VIP.forEach((v, i) => { if (w >= vipNeed(i)) t = i; }); return t; }
const vipCashback = () => Math.max(0, Math.round(((save.casino.wagT || 0) - (save.casino.wonT || 0)) * VIP[vipTier()].cb));
const vipGift = () => Math.round(VIP[vipTier()].gift * wheelBase());
const vipClaimable = () => vipTier() > 0 && save.casino.vipDay !== save.day && (vipGift() + vipCashback()) > 0;
function vipRender(G) {
    const t = vipTier(), V = VIP[t], nx = VIP[t + 1], w = save.casino.wag || 0, pct = nx ? Math.min(100, ((w - vipNeed(t)) / (vipNeed(t + 1) - vipNeed(t))) * 100) : 100;
    G.innerHTML = `<div class="vipWrap"><div class="vipBadge" style="--c:${V.col}"><small>YOUR STATUS</small><b>${V.n}</b></div>
      <div class="vipBar"><div style="width:${pct}%;background:${nx ? nx.col : V.col}"></div></div>
      <p class="vipNext">${nx ? `Wagered ${money(w)} · ${money(vipNeed(t + 1) - w)} more to <b style="color:${nx.col}">${nx.n}</b>` : `Wagered ${money(w)} · the highest tier there is.`}</p>
      <div class="vipTiers">${VIP.map((v, i) => `<div class="${i === t ? "on" : ""}" style="--c:${v.col}"><b>${v.n}</b><span>${i ? money(vipNeed(i)) + " wagered" : "everyone"}</span><small>${i ? `${Math.round(v.cb * 100)}% cashback on losses · daily gift ${money(Math.round(v.gift * wheelBase()))}` : "no perks yet"}</small></div>`).join("")}</div>
      <p>${t === 0 ? "Wager at any game in the casino to climb the tiers." : save.casino.vipDay === save.day ? "You've collected today's perks. Come back tomorrow (in-game)." : `Today: gift <b>${money(vipGift())}</b> + cashback <b>${money(vipCashback())}</b>`}</p></div>
      <div class="csActions"><button class="csbtn big" data-c2="claim" ${vipClaimable() ? "" : "disabled"}>CLAIM <kbd>Space</kbd></button></div>`;
}
function vipClaim() {
    if (!vipClaimable()) return;
    const amt = vipGift() + vipCashback();
    save.money += amt; save.casino.vipDay = save.day; save.casino.wagT = 0; save.casino.wonT = 0;
    coinRain(30); jingle(true); csMsg(`VIP perks collected: +${money(amt)}`, "win"); writeSave();
    vipRender($("csGame"));
}

// ---- one table of handlers for all the new games ----
const CSG = {
    crash: { render: crRender, act(a) { if (a === "launch") crLaunch(); else if (a === "cash") crCash(); else if (a.startsWith("auto:")) { CR.auto = +a.slice(5); crRender($("csGame")); } }, key(c) { if (c === "Space" || c === "Enter") { CR.phase === "fly" ? crCash() : crLaunch(); return true; } } },
    plinko: { render: plRender, act(a) { if (a === "drop") plDrop(); else if (a === "drop5") for (let k = 0; k < 5; k++) setTimeout(plDrop, k * 160); else if (a.startsWith("risk:")) { PL.risk = a.slice(5); plRender($("csGame")); } }, key(c) { if (c === "Space" || c === "Enter") { plDrop(); return true; } } },
    mines: { render: mnRender, act(a) { if (a === "mstart") mnStart(); else if (a === "mcash") mnCash(); else if (a.startsWith("t:")) mnPick(+a.slice(2)); else if (a.startsWith("mines:")) { MN.mines = +a.slice(6); mnRender($("csGame")); } }, key(c) { if (c === "Space" || c === "Enter") { MN.phase === "play" ? mnCash() : mnStart(); return true; } } },
    derby: { render: derbyRender, act(a) { if (a === "race") dbStart(); else if (a.startsWith("pick:") && DB.phase !== "race") { if (DB.phase === "done") { dbCard(); } DB.pick = +a.slice(5); derbyRender($("csGame")); } }, key(c) { if (c === "Space" || c === "Enter") { dbStart(); return true; } const n = +(c.match(/^Digit([1-5])$/) || [])[1]; if (n && DB.phase !== "race") { if (DB.phase === "done") dbCard(); DB.pick = n - 1; derbyRender($("csGame")); return true; } } },
    poker: { render: vpRender, act(a) { if (a === "deal") vpDeal(); else if (a === "draw") vpDraw(); else if (a.startsWith("hold:") && VP.phase === "hold") { const k = +a.slice(5); VP.held[k] = !VP.held[k]; sfx(900, 0.03, "square", 0.03, 1); vpRender($("csGame")); } }, key(c) { if (c === "Space" || c === "Enter") { VP.phase === "hold" ? vpDraw() : vpDeal(); return true; } const n = +(c.match(/^Digit([1-5])$/) || [])[1]; if (n && VP.phase === "hold") { VP.held[n - 1] = !VP.held[n - 1]; vpRender($("csGame")); return true; } } },
    scratch: { noBet: true, render: scRender, act(a) { if (a.startsWith("buy:")) scBuy(+a.slice(4)); else if (a === "reveal") scFinish(); }, key(c) { if ((c === "Space" || c === "Enter") && SC.card && !SC.card.done) { scFinish(); return true; } } },
    vip: { noBet: true, render: vipRender, act(a) { if (a === "claim") vipClaim(); }, key(c) { if (c === "Space" || c === "Enter") { vipClaim(); return true; } } }
};
document.addEventListener("click", e => {
    if (panel !== "casino" || !CSG[CS.game]) return;
    const b = e.target.closest("[data-c2]"); if (!b || b.disabled) return;
    CSG[CS.game].act(b.dataset.c2, b, e);
});

// =========================== the wing itself (3D) ===========================
function wingSign(txt, col, x, y, z, ry, w = 6, h = 1.4) { const fs = Math.min(92, Math.floor(1300 / Math.max(6, txt.length))); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: casinoTex([[txt, fs, col, 96]], 768, 192), transparent: true, depthWrite: false })); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); csSigns.push(m); return m; }
function liveScreen(w, h, cw, ch, x, y, z, ry) { const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex })); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return { m, cv, g: cv.getContext("2d"), tex }; }
function buildCasinoWing() {
    const gold = new THREE.MeshLambertMaterial({ color: 0xd8a840, emissive: 0x3a2a08, flatShading: true }), darkWood = lamb(0x2a140c);
    const W = CS_X1 - CS_X0, D = WING_Z1 - CS_Z1, cz = (CS_Z1 + WING_Z1) / 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: carpetTex() })); floor.rotation.x = -Math.PI / 2; floor.position.set(CSX, 0.01, cz); scene.add(floor);
    const wallM = new THREE.MeshLambertMaterial({ map: wallTex() });
    const plane = (w, h, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallM); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); };
    plane(W, CS_H, CSX, CS_H / 2, WING_Z1, Math.PI); plane(D, CS_H, CS_X0, CS_H / 2, cz, Math.PI / 2); plane(D, CS_H, CS_X1, CS_H / 2, cz, -Math.PI / 2);
    // the shared wall, both faces, with two arches in it
    const segs = [[CS_X0, CSX - ARCH_X - ARCH_HW], [CSX - ARCH_X + ARCH_HW, CSX + ARCH_X - ARCH_HW], [CSX + ARCH_X + ARCH_HW, CS_X1]];
    const wain = batch(darkWood), trim = batch(gold);
    for (const [a, b] of segs) for (const [z, ry, s] of [[CS_Z1 - 0.01, Math.PI, -1], [CS_Z1 + 0.01, 0, 1]]) {
        plane(b - a, CS_H, (a + b) / 2, CS_H / 2, z, ry);
        wain.add(BOX, (a + b) / 2, 0.6, z + s * 0.15, 0, 0, 0, b - a, 1.2, 0.3); trim.add(BOX, (a + b) / 2, 1.22, z + s * 0.15, 0, 0, 0, b - a, 0.08, 0.36); trim.add(BOX, (a + b) / 2, CS_H - 0.5, z + s * 0.15, 0, 0, 0, b - a, 0.12, 0.36);
    }
    for (const sx of [-1, 1]) {
        const ax = CSX + sx * ARCH_X;
        for (const [z, ry] of [[CS_Z1 - 0.01, Math.PI], [CS_Z1 + 0.01, 0]]) plane(ARCH_HW * 2, CS_H - ARCH_H, ax, (CS_H + ARCH_H) / 2, z, ry);
        trim.add(BOX, ax - ARCH_HW, ARCH_H / 2, CS_Z1, 0, 0, 0, 0.3, ARCH_H, 0.7); trim.add(BOX, ax + ARCH_HW, ARCH_H / 2, CS_Z1, 0, 0, 0, 0.3, ARCH_H, 0.7); trim.add(BOX, ax, ARCH_H, CS_Z1, 0, 0, 0, ARCH_HW * 2 + 0.3, 0.3, 0.7);
        wingSign("HIGH ROLLER WING", "#ff5ad8", ax, ARCH_H + 1.0, CS_Z1 - 0.14, Math.PI, 5.2, 1.3);
    }
    for (const [x, z, sx, sz] of [[CSX, WING_Z1 - 0.15, W, 0.3], [CS_X0 + 0.15, cz, 0.3, D], [CS_X1 - 0.15, cz, 0.3, D]]) { wain.add(BOX, x, 0.6, z, 0, 0, 0, sx, 1.2, sz); trim.add(BOX, x, 1.22, z, 0, 0, 0, sx + 0.02, 0.08, sz + 0.06); trim.add(BOX, x, CS_H - 0.5, z, 0, 0, 0, sx + 0.02, 0.12, sz + 0.06); }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), lamb(0x1a0a10)); ceil.rotation.x = Math.PI / 2; ceil.position.set(CSX, CS_H, cz); scene.add(ceil);
    for (let x = CS_X0 + 4; x < CS_X1; x += 6) trim.add(BOX, x, CS_H - 0.1, cz, 0, 0, 0, 0.16, 0.16, D);
    // two chandeliers (the only real lights in here; everything else glows)
    const crystal = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
    for (const x of [CSX - 9, CSX + 9]) {
        const ch = new THREE.Group(); ch.position.set(x, CS_H - 1.6, 32); scene.add(ch);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.07, 6, 16), gold); ring.rotation.x = Math.PI / 2; ch.add(ring);
        for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; part(ch, CONE6, crystal, Math.cos(a) * 1.2, -0.25, Math.sin(a) * 1.2, 0.07, 0.4, 0.07, Math.PI); }
        part(ch, ICO, crystal, 0, -0.6, 0, 0.22); part(ch, CYL6, gold, 0, 1.0, 0, 0.04, 1.4, 0.04);
        const L = new THREE.PointLight(0xffd8a0, 40, 30, 1.4); L.position.set(0, -0.6, 0); ch.add(L); L.userData.b = 40; csLights.push(L);
    }
    // ---- Tree Derby: an oval track, a rail, five little racing trees, a betting window and a big board ----
    {
        const sh = new THREE.Shape(), hole = new THREE.Path(), A = DERBY.a, B = DERBY.b;
        sh.absellipse(0, 0, A + 0.9, B + 0.9, 0, Math.PI * 2, false, 0); hole.absellipse(0, 0, A - 0.9, B - 0.9, 0, Math.PI * 2, true, 0); sh.holes.push(hole);
        const track = new THREE.Mesh(new THREE.ShapeGeometry(sh, 48), lamb(0x8a6040)); track.rotation.x = -Math.PI / 2; track.position.set(DERBY.x, 0.03, DERBY.z); scene.add(track);
        const inner = new THREE.Mesh(new THREE.CircleGeometry(1, 40), lamb(0x2a6a2a)); inner.scale.set(A - 0.9, B - 0.9, 1); inner.rotation.x = -Math.PI / 2; inner.position.set(DERBY.x, 0.025, DERBY.z); scene.add(inner);
        const rail = batch(lamb(0xf2f2f2));
        for (const k of [1.0, -1.0]) for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2, x = DERBY.x + Math.cos(a) * (A + k * 0.95), z = DERBY.z + Math.sin(a) * (B + k * 0.95); rail.add(CYL6, x, 0.4, z, 0, 0, 0, 0.05, 0.8, 0.05); const a2 = ((i + 1) / 40) * Math.PI * 2, x2 = DERBY.x + Math.cos(a2) * (A + k * 0.95), z2 = DERBY.z + Math.sin(a2) * (B + k * 0.95); rail.add(BOX, (x + x2) / 2, 0.8, (z + z2) / 2, 0, -Math.atan2(z2 - z, x2 - x), 0, Math.hypot(x2 - x, z2 - z) + 0.02, 0.06, 0.06); }
        rail.build();
        const fin = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.4), new THREE.MeshBasicMaterial({ map: csCanvas(64, 16, (g) => { for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? "#111" : "#fff"; g.fillRect(i * 4, j * 4, 4, 4); } }) }));
        fin.rotation.x = -Math.PI / 2; fin.rotation.z = Math.PI / 2; fin.position.set(DERBY.x, 0.04, DERBY.z - B); scene.add(fin);
        derby3D = RACERS.map((r, i) => {
            const g = new THREE.Group(); scene.add(g);
            const bark = lamb(0x5a3a22), leaf = lamb(r.leaf);
            part(g, CYL6, bark, 0, 0.35, 0, 0.13, 0.7, 0.13); part(g, CONE6, leaf, 0, 1.05, 0, 0.45, 0.9, 0.45); part(g, CONE6, leaf, 0, 1.45, 0, 0.32, 0.6, 0.32);
            part(g, BOX, new THREE.MeshBasicMaterial({ color: r.sash }), 0, 0.62, 0, 0.32, 0.1, 0.32);
            const eyes = new THREE.MeshBasicMaterial({ color: 0xffd040 }); part(g, BOX, eyes, -0.06, 0.95, 0.24, 0.05, 0.05, 0.02); part(g, BOX, eyes, 0.06, 0.95, 0.24, 0.05, 0.05, 0.02);
            const legs = [-1, 1].map(s => part(g, CYL6, bark, s * 0.09, 0.1, 0, 0.04, 0.25, 0.04));
            return { g, legs, lane: (i - 2) * 0.32 };
        });
        // the window and the clerk
        const booth = batch(darkWood); booth.add(BOX, DERBY_WIN.x, 0.55, DERBY_WIN.z, 0, 0, 0, 4.6, 1.1, 0.7); booth.add(CYL6, DERBY_WIN.x - 2.2, 1.8, DERBY_WIN.z, 0, 0, 0, 0.08, 3.6, 0.08); booth.add(CYL6, DERBY_WIN.x + 2.2, 1.8, DERBY_WIN.z, 0, 0, 0, 0.08, 3.6, 0.08); booth.build();
        trim.add(BOX, DERBY_WIN.x, 1.14, DERBY_WIN.z - 0.1, 0, 0, 0, 4.7, 0.08, 0.9);
        wingSign("TREE DERBY", "#6dffa0", DERBY_WIN.x, 3.9, DERBY_WIN.z - 0.4, 0, 4.4, 1.1);
        const clerk = makeHumanoid({ face: "clerk", skin: 0xe8c0a0, shirt: 0xf2f2f2, vest: 0x1a5a2a, pants: 0x141414, hair: 0x5a3a1a });
        clerk.g.position.set(DERBY_WIN.x, 0, DERBY_WIN.z + 1.0); clerk.g.rotation.y = Math.PI; scene.add(clerk.g); clerk.yaw = Math.PI; clerk.patron = true; casinoNpcs.push(clerk);
        derbyBoard = liveScreen(7, 2.4, 768, 264, VIP_AT.x, 4.9, WING_Z1 - 0.14, Math.PI);
        trim.add(BOX, VIP_AT.x, 4.9, WING_Z1 - 0.08, 0, 0, 0, 7.3, 2.7, 0.08);
        drawDerbyBoard();
    }
    // ---- Axe Rocket: a giant screen on the east wall and a little podium to bet at ----
    crashScreen = liveScreen(6.6, 3.4, 640, 330, CS_X1 - 0.14, 3.6, CRASH_POD.z, -Math.PI / 2);
    trim.add(BOX, CS_X1 - 0.08, 3.6, CRASH_POD.z, 0, 0, 0, 0.08, 3.7, 6.9);
    trim.add(CYL8, CRASH_POD.x, 0.5, CRASH_POD.z, 0, 0, 0, 0.45, 1.0, 0.45); part(scene, BOX, new THREE.MeshBasicMaterial({ color: 0xffb020 }), CRASH_POD.x, 1.05, CRASH_POD.z, 0.6, 0.06, 0.6);
    wingSign("AXE ROCKET", "#ffb020", CS_X1 - 0.12, 6.0, CRASH_POD.z, -Math.PI / 2, 4.6, 1.1);
    // ---- Plinko: a tall glowing board on the west wall; balls you drop fall down it in 3D ----
    {
        const BW = 3.4, BH = 4.6, bx = CS_X0 + 0.25, cyy = 3.0;
        const tex = csCanvas(256, 340, (g, w, h) => { g.fillStyle = "#0e0818"; g.fillRect(0, 0, w, h); const sp = w / (PL_ROWS + 2); g.fillStyle = "#e8dcff"; for (let r = 0; r < PL_ROWS; r++) for (let k = 0; k <= r + 2; k++) { g.beginPath(); g.arc(w / 2 + (k - (r + 2) / 2) * sp, ((r + 1.1) / (PL_ROWS + 1.6)) * (h - 30), 2.4, 0, 7); g.fill(); } PLINKO.med.forEach((m, k) => { g.fillStyle = plSlotCol(m); g.fillRect(w / 2 + (k - 6) * sp - sp * 0.46, h - 26, sp * 0.92, 22); }); });
        const board = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: tex })); board.position.set(bx, cyy, PLINKO_Z); board.rotation.y = Math.PI / 2; scene.add(board);
        trim.add(BOX, bx - 0.05, cyy, PLINKO_Z, 0, 0, 0, 0.12, BH + 0.3, BW + 0.3); wain.add(BOX, CS_X0 + 0.7, 0.4, PLINKO_Z, 0, 0, 0, 1.2, 0.8, BW);
        wingSign("PLINKO", "#ff5ad8", CS_X0 + 0.12, 6.1, PLINKO_Z, Math.PI / 2, 3.4, 1.0);
        const ballM = new THREE.MeshBasicMaterial({ color: 0xff5ad8 }), live = [];
        plBoard3D = {
            drop(b) { const m = new THREE.Mesh(ICO, ballM); m.scale.setScalar(0.09); scene.add(m); live.push({ b, m }); },
            update() { for (let i = live.length - 1; i >= 0; i--) { const { b, m } = live[i]; if (!PL.balls.includes(b)) { scene.remove(m); live.splice(i, 1); continue; } const p = plPos(b, b.t); m.position.set(bx + 0.1, cyy + BH / 2 - p.y * (BH - 0.4), PLINKO_Z - (p.x - 0.5) * BW); } }
        };
    }
    // ---- video poker cabinets ----
    POKER_Z.forEach((z, i) => {
        const m = new THREE.Group(); m.position.set(CS_X0 + 1.5, 0, z); m.rotation.y = Math.PI / 2; scene.add(m);
        const body = lamb([0x1a3a8a, 0x8a1a3a, 0x1a6a4a][i]);
        part(m, BOX, body, 0, 0.55, 0, 1.3, 1.1, 0.9); part(m, BOX, body, 0, 1.6, -0.12, 1.3, 1.1, 0.66); part(m, BOX, gold, 0, 1.06, 0.32, 1.34, 0.06, 0.28);
        const tex = csCanvas(256, 160, (g, w, h) => { g.fillStyle = "#0a1a5a"; g.fillRect(0, 0, w, h); g.fillStyle = "#ffd040"; g.font = "900 22px Consolas"; g.textAlign = "center"; g.fillText("JACKS OR BETTER", w / 2, 28); ["A♠", "K♠", "Q♠", "J♠", "10♠"].forEach((c, k) => { g.fillStyle = "#fffef6"; g.fillRect(14 + k * 46, 50, 40, 60); g.fillStyle = "#141418"; g.font = "800 16px Consolas"; g.fillText(c, 34 + k * 46, 86); }); g.fillStyle = "#6dffa0"; g.font = "800 14px Consolas"; g.fillText("ROYAL FLUSH ×250", w / 2, 140); });
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.68), new THREE.MeshBasicMaterial({ map: tex })); scr.position.set(0, 1.62, 0.22); m.add(scr);
        part(m, CYL8, gold, 0, 0.45, 1.15, 0.32, 0.06, 0.32); part(m, CYL6, darkWood, 0, 0.22, 1.15, 0.05, 0.45, 0.05);
    });
    wingSign("VIDEO POKER", "#5a9aff", CS_X0 + 0.12, 5.4, POKER_Z[1], Math.PI / 2, 5, 1.2);
    // ---- mines tables ----
    const mineTop = csCanvas(256, 256, (g, w) => { g.fillStyle = "#0e1a2a"; g.fillRect(0, 0, w, w); for (let i = 0; i < 25; i++) { const x = 18 + (i % 5) * 45, y = 18 + Math.floor(i / 5) * 45; g.fillStyle = [3, 11, 17].includes(i) ? "#ff3a5a" : "#2a4a7a"; g.fillRect(x, y, 40, 40); if (![3, 11, 17].includes(i) && i % 3 === 0) { g.fillStyle = "#6dffa0"; g.beginPath(); g.moveTo(x + 20, y + 8); g.lineTo(x + 32, y + 20); g.lineTo(x + 20, y + 32); g.lineTo(x + 8, y + 20); g.fill(); } } });
    for (const mt of MINES_AT) {
        trim.add(CYL8, mt.x, 0.45, mt.z, 0, 0, 0, 0.35, 0.9, 0.35);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.12, 24), [lamb(0x2a140c), new THREE.MeshBasicMaterial({ map: mineTop }), lamb(0x2a140c)]); top.position.set(mt.x, 0.96, mt.z); scene.add(top);
    }
    wingSign("MINES", "#5ad8ff", CS_X1 - 0.12, 5.4, (MINES_AT[0].z + MINES_AT[1].z) / 2, -Math.PI / 2, 3.2, 1.0);
    // ---- scratch kiosk ----
    {
        const k = batch(darkWood); k.add(BOX, CS_X1 - 1.3, 0.55, 44.4, 0, 0, 0, 2.4, 1.1, 3); k.build();
        trim.add(BOX, CS_X1 - 1.3, 1.14, 44.4, 0, 0, 0, 2.5, 0.08, 3.1);
        const cards = [0x6dffa0, 0xffd040, 0x9fe8ff].map(c => batch(new THREE.MeshBasicMaterial({ color: c })));
        for (let j = 0; j < 9; j++) cards[j % 3].add(BOX, CS_X1 - 0.3, 1.6 + Math.floor(j / 3) * 0.5, 43.4 + (j % 3) * 0.9, 0, 0, 0, 0.04, 0.4, 0.6);
        cards.forEach(c => c.build());
        wingSign("SCRATCHERS", "#6dffa0", CS_X1 - 0.12, 4.4, 44.4, -Math.PI / 2, 3.2, 0.8);
        const seller = makeHumanoid({ face: "clerk", skin: 0x8a5a3a, shirt: 0xf2f2f2, vest: 0x5a3a8a, pants: 0x141414, hair: 0x101010 });
        seller.g.position.set(CS_X1 - 0.9, 0, 45.4); seller.g.rotation.y = -Math.PI / 2; scene.add(seller.g); seller.yaw = -Math.PI / 2; seller.patron = true; casinoNpcs.push(seller);
    }
    // ---- the VIP desk ----
    {
        const d = batch(darkWood); d.add(BOX, VIP_AT.x, 0.55, VIP_AT.z, 0, 0, 0, 4.8, 1.1, 0.8); d.build();
        trim.add(BOX, VIP_AT.x, 1.14, VIP_AT.z, 0, 0, 0, 4.9, 0.08, 0.9);
        const rope = new THREE.MeshLambertMaterial({ color: 0xa01020, flatShading: true });
        for (const s of [-1, 1]) { trim.add(CYL6, VIP_AT.x + s * 3.2, 0.5, VIP_AT.z - 1.4, 0, 0, 0, 0.07, 1, 0.07); trim.add(ICO, VIP_AT.x + s * 3.2, 1.02, VIP_AT.z - 1.4, 0, 0, 0, 0.12); const r = new THREE.Mesh(CYL6, rope); r.scale.set(0.05, 1.6, 0.05); r.rotation.z = Math.PI / 2; r.position.set(VIP_AT.x + s * 3.2 - s * 0.8, 0.85, VIP_AT.z - 1.4); scene.add(r); }
        wingSign("VIP", "#ffd040", VIP_AT.x, 3.0, WING_Z1 - 0.14, Math.PI, 2.2, 0.9);
        const host = makeHumanoid({ face: "clerk", skin: 0xf0c8a0, shirt: 0xf2f2f2, vest: 0x8a6a1a, pants: 0x141414, hair: 0xd8c08a });
        host.g.position.set(VIP_AT.x, 0, VIP_AT.z + 0.75); host.g.rotation.y = Math.PI; scene.add(host.g); host.yaw = Math.PI; host.patron = true; casinoNpcs.push(host);
    }
    // a few high rollers
    for (const [x, z, ry, shc] of [[CS_X0 + 3.0, POKER_Z[0], -Math.PI / 2, 0x2a2a2a], [CS_X0 + 3.0, POKER_Z[2], -Math.PI / 2, 0x6a1a2a], [DERBY.x + DERBY.a + 2.2, DERBY.z - 1, -Math.PI / 2, 0x3a6a8a], [DERBY.x + 4.5, DERBY.z + DERBY.b + 1.8, Math.PI, 0x8a6a2a], [MINES_AT[1].x - 1.7, MINES_AT[1].z, Math.PI / 2, 0x4a2a6a]]) {
        const p = makeHumanoid({ face: "clerk", skin: [0xf0c8a0, 0xc89070, 0x8a5a3a][Math.floor(Math.random() * 3)], shirt: shc, pants: 0x1a1a24, hair: [0x2a1a10, 0x8a5a2a, 0xd8c08a][Math.floor(Math.random() * 3)] });
        p.g.position.set(x, 0, z); p.g.rotation.y = ry; scene.add(p.g); p.yaw = ry; p.patron = true; casinoNpcs.push(p);
    }
    // the progressive jackpot, in lights over the slot machines (back in the main hall)
    jackSign = liveScreen(5.2, 0.9, 520, 90, CS_X0 + 0.13, 3.75, 3, Math.PI / 2);
    wain.build(); trim.build();
}
function drawDerbyBoard() {
    if (!derbyBoard) return;
    const g = derbyBoard.g, W = derbyBoard.cv.width, H = derbyBoard.cv.height;
    g.fillStyle = "#06120a"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#6dffa0"; g.font = "900 34px Consolas"; g.textAlign = "center"; g.fillText(DB.phase === "race" ? "★ RACE IN PROGRESS ★" : DB.phase === "done" ? `WINNER: ${RACERS[DB.winner].n.toUpperCase()}` : "TREE DERBY · NEXT RACE", W / 2, 40);
    const order = DB.phase === "race" ? [0, 1, 2, 3, 4].sort((a, b) => DB.prog[b] - DB.prog[a]) : [0, 1, 2, 3, 4];
    order.forEach((i, k) => { const y = 82 + k * 36; g.textAlign = "left"; g.fillStyle = RACERS[i].css; g.font = "800 26px Consolas"; g.fillText(`${DB.phase === "race" ? k + 1 + "." : "•"} ${RACERS[i].n}`, 60, y); g.textAlign = "right"; g.fillStyle = "#ffd040"; g.fillText(DB.odds[i].toFixed(1) + "×", W - 60, y); });
    g.textAlign = "left"; derbyBoard.tex.needsUpdate = true;
}
let wingT = 0, crDemo = { t0: 0, crash: 2.4 };
function updateWing(dt) {
    if (!derby3D) return;
    wingT += dt;
    dbUpdate();
    plBoard3D.update();
    // the racers: lined up at the gate, then a lap of the track during a race
    derby3D.forEach((r, i) => {
        const p = DB.phase === "card" ? 0 : DB.prog[i], th = -Math.PI / 2 + p * Math.PI * 2 + 0.02, rr = 1 + r.lane / DERBY.a;
        const x = DERBY.x + Math.cos(th) * DERBY.a * rr, z = DERBY.z + Math.sin(th) * DERBY.b * rr;
        r.g.position.set(x, DB.phase === "race" ? Math.abs(Math.sin(wingT * 14 + i)) * 0.12 : 0, z);
        r.g.rotation.y = Math.atan2(-Math.sin(th) * DERBY.a, Math.cos(th) * DERBY.b);
        const run = DB.phase === "race" && p < 1; r.legs[0].rotation.x = run ? Math.sin(wingT * 16 + i) * 0.7 : 0; r.legs[1].rotation.x = run ? -Math.sin(wingT * 16 + i) * 0.7 : 0;
    });
    // the screens refresh a few times a second (cheap enough, and only while you're inside)
    if ((wingT * 10 | 0) !== ((wingT - dt) * 10 | 0)) {
        if (DB.phase === "race") drawDerbyBoard();
        if (CR.phase === "fly" || CR.phase === "done" && performance.now() - CR.t0 < (CR.tEnd + 3) * 1000) drawCrash(crashScreen.g, 640, 330, CR.phase === "fly" ? (performance.now() - CR.t0) / 1000 : CR.tEnd, CR.m, CR.phase === "done" && CR.m >= CR.crash, CR.cashed);
        else { const t = (performance.now() - crDemo.t0) / 1000, m = Math.min(crM(t), crDemo.crash); drawCrash(crashScreen.g, 640, 330, t, m, m >= crDemo.crash, 0); if (m >= crDemo.crash && t > Math.log(crDemo.crash) / 0.11 + 2.5) crDemo = { t0: performance.now(), crash: crRoll() }; }
        crashScreen.tex.needsUpdate = true;
        const jg = jackSign.g; jg.fillStyle = "#14020a"; jg.fillRect(0, 0, 520, 90); jg.fillStyle = Math.floor(wingT * 3) % 2 ? "#ffd040" : "#ff5a3a"; jg.font = "900 26px Consolas"; jg.textAlign = "center"; jg.fillText("PROGRESSIVE JACKPOT", 260, 32); jg.fillStyle = "#6dffa0"; jg.font = "900 38px Consolas"; jg.fillText(money(csPool()), 260, 76); jackSign.tex.needsUpdate = true;
    }
}

// =====================================================================
//  REBIRTH 4: THE ARCHIPELAGO. Five islands scattered over open sea. Port Haven is home;
//  everything else is a boat ride away, and the boat runs on fuel. Run dry in open water
//  and the sea takes you, and every material you were carrying goes down with the boat.
// =====================================================================
const ARCH = [
    { k: "haven", name: "PORT HAVEN", x: 0, z: 0, r: 92, w: [6, 4, 3], ph: [0.3, 1.7, 2.9], col: "#ffd890", hp: 1, pump: true },
    { k: "coral", name: "CORAL KEY", x: 232, z: 196, r: 54, w: [5, 3, 2], ph: [1.1, 0.4, 2.2], col: "#ff8aa0", hp: 1.15, pump: true },
    { k: "skull", name: "SKULL ROCK", x: -302, z: 128, r: 58, w: [6, 4, 2], ph: [2.4, 1.2, 0.5], col: "#d8c8b0", hp: 1.3 },
    { k: "frost", name: "FROSTCAP", x: -112, z: -338, r: 56, w: [4, 5, 2], ph: [0.8, 2.6, 1.4], col: "#bff4ff", hp: 1.45 },
    { k: "storm", name: "STORM ISLE", x: 362, z: -268, r: 52, w: [5, 3, 3], ph: [1.9, 0.2, 2.7], col: "#c8a0ff", hp: 1.7 }
];
const ARCH_BY = Object.fromEntries(ARCH.map(I => [I.k, I]));
const archR = (I, th) => I.r + I.w[0] * Math.sin(2 * th + I.ph[0]) + I.w[1] * Math.sin(3 * th + I.ph[1]) + I.w[2] * Math.sin(5 * th + I.ph[2]);
const archIn = (I, x, z) => archR(I, Math.atan2(z - I.z, x - I.x)) - Math.hypot(x - I.x, z - I.z); // how far inside the shore (negative = at sea)
function archAt(x, z) { // the island a point belongs to (or is nearest)
    let best = ARCH[0], bd = 1e9;
    for (const I of ARCH) { const d = Math.hypot(x - I.x, z - I.z) - I.r; if (d < bd) { bd = d; best = I; } }
    return best;
}
const shoreR5 = th => archR(ARCH[0], th), shoreAt5 = (x, z) => shoreR5(Math.atan2(z, x));
function archTerrain(I, x, z) {
    const lx = x - I.x, lz = z - I.z, d = Math.hypot(lx, lz), inside = archR(I, Math.atan2(lz, lx)) - d;
    if (inside < 5) return Math.max(-3.4, -(5 - inside) * 0.22);
    let h = 0;
    if (I.k === "haven") h = Math.max(0, fbm2(x * 0.021 + 3.1, z * 0.021 - 5.3, 3) - 0.36) * 14 * sstep(22, 40, d) + fbm2(x * 0.09, z * 0.09, 2) * 0.6;
    else if (I.k === "coral") h = 0.5 + fbm2(x * 0.05 + 1.7, z * 0.05 - 2.2, 3) * 2.4;
    else if (I.k === "skull") { h = Math.max(0, fbm2(x * 0.04 - 2, z * 0.04 + 8, 3) - 0.3) * 12; const k = 1 - d / (I.r * 0.42); if (k > 0) h = Math.max(h, 19 * Math.pow(k, 1.3)); }
    else if (I.k === "frost") h = 30 * Math.pow(Math.max(0, 1 - d / (I.r * 0.86)), 1.5) + fbm2(x * 0.06, z * 0.06, 3) * 3;
    else if (I.k === "storm") h = 9 * sstep(4, 20, inside) + fbm2(x * 0.07 + 4, z * 0.07, 3) * 2.5;
    return h * sstep(4, 15, inside) + (inside < 15 ? (1 - sstep(4, 15, inside)) * 0.35 : 0);
}
// ---- docks: one harbor dock on every island, plus arrivals and the next ferry at Port Haven ----
function mkDock(I, th, len, kind) {
    const DIR = V3(Math.cos(th), 0, Math.sin(th)), PERP = V3(-DIR.z, 0, DIR.x), R = archR(I, th) - 8;
    return { I, kind, th, LEN: len, DIR, PERP, B: V3(I.x + DIR.x * R, 0, I.z + DIR.z * R), pt(a, s = 0, y = 0) { return V3(this.B.x + this.DIR.x * a + this.PERP.x * s, y, this.B.z + this.DIR.z * a + this.PERP.z * s); } };
}
const DOCKS5 = [
    mkDock(ARCH[0], 2.45, 22, "arr"), mkDock(ARCH[0], 0.62, 26, "harbor"), mkDock(ARCH[0], -1.95, 24, "next"),
    mkDock(ARCH[1], 0.69 + Math.PI, 22, "harbor"), mkDock(ARCH[2], -0.4, 22, "harbor"), mkDock(ARCH[3], 1.25, 22, "harbor"), mkDock(ARCH[4], 2.5, 22, "harbor")
];
const HARBOR5 = DOCKS5[1], ARR5 = DOCKS5[0], NEXT5 = DOCKS5[2];
const harborOf = I => DOCKS5.find(D => D.I === I && D.kind === "harbor");
const pumpAt = D => D.pt(D.LEN - 3, -1.2);
const FERRYMAN5 = (() => { const p = NEXT5.pt(NEXT5.LEN - 3.5, -0.9); return { x: p.x, z: p.z }; })();
function onDock5(x, z) { for (const D of DOCKS5) { const { along, side } = dockLocal(x, z, D.B, D.DIR, D.PERP); if (along > 4 && along < D.LEN + 0.4 && Math.abs(side) < 2.0) return D; } return null; }
function groundY5(x, z) {
    if (onDock5(x, z)) return 0;
    const I = archAt(x, z);
    return Math.max(-0.4, archTerrain(I, x, z));
}
const landH5 = (x, z) => (onDock5(x, z) ? 0.3 : archTerrain(archAt(x, z), x, z));
// the camp at Port Haven
const BED5 = { x: -9, z: 6 }, SMITH5 = { x: -11, z: -7 }, DEPOT5 = { x: 11, z: -7 }, WITCH5 = { x: 10, z: 8 };
const SMITH5_AT = standPt(SMITH5), DEPOT5_AT = standPt(DEPOT5), WITCH5_AT = standPt(WITCH5);
const SHIPWRIGHT = (() => { const p = HARBOR5.pt(-3, 5.5); return { x: p.x, z: p.z }; })();
const LM5 = [
    { name: "PORT HAVEN", x: 0, z: 0, r: 24, col: "#ffd890", camp: true },
    ...ARCH.slice(1).map(I => ({ name: I.name, x: I.x, z: I.z, r: 6, col: I.col }))
];
function clampIsle5(p) {
    if (B5.on) return; // the boat moves itself
    for (const D of DOCKS5) {
        const { along, side } = dockLocal(p.x, p.z, D.B, D.DIR, D.PERP);
        if (along > 4.5 && along < D.LEN + 3 && Math.abs(side) < 6) { const a = Math.min(along, D.LEN - 0.7), s = clamp(side, -1.65, 1.65); p.x = D.B.x + D.DIR.x * a + D.PERP.x * s; p.z = D.B.z + D.DIR.z * a + D.PERP.z * s; return; }
    }
    const I = archAt(p.x, p.z), dx = p.x - I.x, dz = p.z - I.z, d = Math.hypot(dx, dz), lim = archR(I, Math.atan2(dz, dx)) - 3;
    if (d > lim) { p.x = I.x + dx / d * lim; p.z = I.z + dz / d * lim; }
}
// ---- trees live on whichever island you're on ----
let arch5 = "haven";
const archOK5 = (x, z, I) => { if (archIn(I, x, z) < 10) return false; if (I.k === "haven" && Math.hypot(x, z) < SAFE_R + 4) return false; for (const D of DOCKS5) if (D.I === I && Math.hypot(x - D.B.x, z - D.B.z) < 12) return false; if (I.k === "storm" && Math.hypot(x - I.x, z - I.z) < 9) return false; return true; };
function arch5Spot() {
    const I = ARCH_BY[arch5];
    for (let k = 0; k < 20; k++) { const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * (archR(I, a) - 10), x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d; if (archOK5(x, z, I)) return { x, z }; }
    return null;
}
function clampTree5(t) {
    const I = ARCH_BY[t.arch] || archAt(t.x, t.z), dx = t.x - I.x, dz = t.z - I.z, d = Math.hypot(dx, dz) || 1, lim = archR(I, Math.atan2(dz, dx)) - 8;
    if (d > lim) { t.x = I.x + dx / d * lim; t.z = I.z + dz / d * lim; }
}
const archTreeTarget = () => Math.round((arch5 === "haven" ? 55 : 38) * (isBlood() ? 1.4 : 1));
function setArch5(k, quiet) {
    if (arch5 === k) return;
    arch5 = k; terrainMesh[5] = isle5.terrain[k] || terrainMesh[5];
    resetIsleTrees(Math.round(archTreeTarget() * 0.8));
    if (!quiet) { const I = ARCH_BY[k]; say(I.name); setTimeout(() => say(""), 2600); }
}

// ---- materials, trees and recipes for the Archipelago ----
Object.assign(MATS, {
    driftwood: { name: "Driftwood", col: "#d8b890", price: 120, hex: 0xa08a6a },
    salt: { name: "Sea Salt", col: "#e8f4ff", price: 170, hex: 0xe0ecf4 },
    coral: { name: "Coral", col: "#ff7a8a", price: 260, hex: 0xff6a7a },
    tar: { name: "Pitch Tar", col: "#a89078", price: 380, hex: 0x2a201a },
    iceshard: { name: "Glacier Shard", col: "#9fe8ff", price: 560, hex: 0x8ad8ff },
    pearl: { name: "Pearl", col: "#f4f0ff", price: 900, hex: 0xf0eaff },
    stormglass: { name: "Stormglass", col: "#c8a0ff", price: 1600, hex: 0x9a7aff }
});
MATS_BY_ISLE[5] = ["driftwood", "salt", "coral", "tar", "iceshard", "pearl", "stormglass"];
GLOW_MATS.push("iceshard", "pearl", "stormglass");
for (const k of MATS_BY_ISLE[5]) matMeshMat[k] = new THREE.MeshLambertMaterial({ color: MATS[k].hex, flatShading: true, emissive: GLOW_MATS.includes(k) ? MATS[k].hex : 0x000000, emissiveIntensity: 0.35 });
const TYPES5 = {
    palm:       { name: "Palm Tree",    leaf: [0x3aa04a, 0x2e8a3e], trunk: 0xa8885a, hp: 3.0, logs: 1.3, dmg: 1.3, speed: 1,   bonus: 0,  wd: 0.55, wn: 0.4,  col: "#7affa0", isl: [5], mat: "driftwood", arch: "haven" },
    mangrove:   { name: "Mangrove",     leaf: [0x2a6a3a, 0x3a7a2a], trunk: 0x5a4a3a, hp: 3.4, logs: 1.4, dmg: 1.4, speed: 0.9, bonus: 0,  wd: 0.35, wn: 0.35, col: "#9ad08a", isl: [5], mat: "salt", arch: "haven", minTier: 2 },
    coralwood:  { name: "Coralwood",    leaf: [0xff6a8a, 0xff8a6a], trunk: 0xe88a7a, hp: 3.6, logs: 1.4, dmg: 1.4, speed: 1,   bonus: 0,  wd: 0.5,  wn: 0.45, col: "#ff8aa0", isl: [5], mat: "coral", arch: "coral" },
    pearlbloom: { name: "Pearlbloom",   leaf: [0xf4f0ff, 0xd8e8ff], trunk: 0xc8b8d8, glow: 0x2a2a44, hp: 2.6, logs: 0.6, dmg: 0.9, speed: 1, bonus: 60, wd: 0.07, wn: 0.14, col: "#f4f0ff", isl: [5], rare: true, mat: "pearl", arch: "coral" },
    tarpine:    { name: "Tar Pine",     leaf: [0x2a2a22, 0x3a3428], trunk: 0x1a1612, hp: 4.0, logs: 1.5, dmg: 1.6, speed: 1,   bonus: 0,  wd: 0.5,  wn: 0.45, col: "#c8b098", isl: [5], mat: "tar", arch: "skull" },
    cursedmast: { name: "Cursed Mast",  leaf: [0x3a1a3a, 0x5a2a5a], trunk: 0x2a1a14, glow: 0x2a0a2a, hp: 3.0, logs: 0.8, dmg: 2.0, speed: 1.4, bonus: 80, wd: 0.03, wn: 0.12, col: "#d08aff", isl: [5], rare: true, night: true, mat: "pearl", arch: "skull" },
    frostpine:  { name: "Frost Pine",   leaf: [0xd8f4ff, 0x9ad8f0], trunk: 0x6a7a8a, hp: 4.4, logs: 1.6, dmg: 1.7, speed: 0.9, bonus: 0,  wd: 0.5,  wn: 0.45, col: "#bff4ff", isl: [5], mat: "iceshard", arch: "frost" },
    stormoak:   { name: "Storm Oak",    leaf: [0x3a3a6a, 0x5a5a9a], trunk: 0x2a2a3a, glow: 0x14143a, hp: 5.2, logs: 1.6, dmg: 2.0, speed: 1.1, bonus: 0, wd: 0.5, wn: 0.5, col: "#c8a0ff", isl: [5], mat: "stormglass", arch: "storm" },
    xmaspalm:   { name: "Tinsel Palm",  leaf: [0x2a8a4a, 0x1e7a3e], trunk: 0xa8885a, hp: 2.6, logs: 2.6, dmg: 1.2, speed: 0.9, bonus: 40, wd: 0.05, wn: 0.06, col: "#ff6a6a", isl: [5], rare: true, xmas: true, mat: "driftwood", arch: "haven" }
};
Object.assign(TYPES, TYPES5);
Object.assign(TREE_STYLE, { palm: { s: "palm", dots: 0x6a4a2a }, mangrove: { s: "round" }, coralwood: { s: "dead", dots: 0xffd0e0 }, pearlbloom: { s: "round", dots: 0xffffff }, tarpine: { s: "conifer" },
    cursedmast: { s: "dead", dots: 0xb07aff }, frostpine: { s: "conifer", snow: true }, stormoak: { s: "round", dots: 0xc8a0ff }, xmaspalm: { s: "palm", dots: 0xff3a3a } });
for (const [k, T] of Object.entries(TYPES5)) {
    const base = { flatShading: true }; if (T.glow !== undefined) base.emissive = T.glow;
    typeMats[k] = { trunk: new THREE.MeshLambertMaterial({ color: T.trunk, ...base }), leaves: T.leaf.map(c => windy(new THREE.MeshLambertMaterial({ color: c, ...base }))) };
}
Object.assign(HIT_COL, { palm: [0x3aa04a, 0xa8885a], coralwood: [0xff6a8a, 0xffd0e0], pearlbloom: [0xf4f0ff, 0xd8e8ff], tarpine: [0x2a2a22, 0x5a4a3a], cursedmast: [0x5a2a5a, 0xb07aff], frostpine: [0xd8f4ff, 0xffffff], stormoak: [0x5a5a9a, 0xc8a0ff] });
// the Sea Forge: every axe again, from sea materials
const AXE_RECIPES5 = [null, { driftwood: 8 }, { driftwood: 12, salt: 4 }, { driftwood: 16, salt: 8 }, { salt: 14, coral: 4 }, { salt: 20, coral: 10 }, { salt: 26, coral: 12, tar: 4 }, { coral: 20, tar: 10 },
    { tar: 18, iceshard: 4 }, { coral: 20, tar: 26, iceshard: 10 }, { tar: 30, iceshard: 22, pearl: 2 }, { salt: 60, iceshard: 34, pearl: 5 }, { tar: 50, iceshard: 60, pearl: 10 }, { tar: 60, iceshard: 80, pearl: 16, stormglass: 2 }, { iceshard: 80, pearl: 20, stormglass: 6 }, { pearl: 30, stormglass: 14 }];
const GUN_RECIPES5 = [{ driftwood: 10, salt: 6 }, { driftwood: 20, salt: 12, coral: 4 }, { salt: 26, coral: 12 }, { salt: 30, coral: 18, tar: 6 }, { coral: 40, tar: 40, iceshard: 18 }, { tar: 30, iceshard: 40, pearl: 8 }, { iceshard: 60, pearl: 12, stormglass: 4 }];
const AMMO_RECIPES5 = [{ driftwood: 2, salt: 1 }, { driftwood: 3, salt: 3 }, { salt: 4, coral: 2 }, { salt: 3, coral: 3 }, { coral: 10, tar: 4 }, { tar: 3, iceshard: 2 }, { coral: 8, iceshard: 3 }];
for (const list of [AXE_RECIPES5, GUN_RECIPES5]) for (const rc of list) if (rc) for (const k in rc) rc[k] = Math.max(1, Math.round(rc[k] * 0.6));
RECIPES[5] = [AXE_RECIPES5, GUN_RECIPES5, AMMO_RECIPES5];
function brewItems5() {
    const b = (k, name, desc, secs, craft, cost) => ({ name, col: BUFFS[k].col, desc: `${desc} for ${secs / 60} min${buffLeft(k) > 0 ? ` · ACTIVE ${mmss(buffLeft(k))} (drinking adds more time)` : ""}`, craft, cost, verb: "Brewed", quiet: true, buy() { giveBuff(k, secs); } });
    return [
        b("swift", "Sea Breeze Tonic", "+30% move speed", 240, { salt: 6 }, 9000),
        b("ironhide", "Barnacle Draught", "Take 40% less damage", 240, { salt: 4, coral: 6 }, 18000),
        b("fury", "Grog of Fury", "+40% axe and gun damage", 240, { coral: 6, tar: 5 }, 36000),
        b("lucky", "Mermaid's Luck", "+50% materials from every tree", 300, { salt: 12, pearl: 2 }, 50000),
        { name: "Phoenix Tear", icon: "phoenix", col: "#ffb060", desc: `If you would die, you rise again with 60% health instead (not at sea: the sea doesn't give back). You have ${save.phoenix || 0} (max 3)`, craft: { pearl: 3, stormglass: 1 }, cost: 300000, verb: "Brewed", maxed: (save.phoenix || 0) >= 3, buy() { save.phoenix = (save.phoenix || 0) + 1; } }
    ];
}

// =========================== THE BOAT ===========================
const B5 = { on: false, x: 0, z: 0, yaw: 0, speed: 0, mesh: null, prop: null, wakeT: 0, engT: 0, strand: 0, warned: 0, docked: "haven", lastLand: 0 };
if (!save.boat || typeof save.boat !== "object") save.boat = { fuel: 100, tank: 0, engine: 0, cans: 0, hull: 0 };
const boatMaxFuel = () => 100 * (1 + 0.45 * (save.boat.tank || 0));
const boatTop = () => 15 * (1 + 0.13 * (save.boat.engine || 0));
const fuelPrice = () => Math.round(18 * rebirthMult()); // per unit
const boating = () => B5.on;
function makeSpeedboat() {
    const g = new THREE.Group(), hullM = lamb(0xf2f2f2), stripe = lamb(0x1a6ab0), deck = lamb(0xb08a5a), dark = lamb(0x22262e);
    // hull: a box with a pointed bow
    part(g, BOX, hullM, 0, 0.45, -0.3, 2.2, 0.9, 4.6);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.8, 4), hullM); bow.rotation.set(Math.PI / 2, 0, Math.PI / 4); bow.scale.set(1, 1, 0.64); bow.position.set(0, 0.45, 2.75); g.add(bow);
    part(g, BOX, stripe, 0, 0.62, -0.3, 2.24, 0.14, 4.62); part(g, BOX, deck, 0, 0.92, -0.6, 1.9, 0.06, 3.6);
    part(g, BOX, dark, 0, 1.68, 0.68, 1.7, 0.05, 0.06); for (const sx of [-0.83, 0.83]) part(g, BOX, dark, sx, 1.33, 0.78, 0.05, 0.7, 0.05); // a slim windscreen frame
    const glass = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.18 })); glass.scale.set(1.6, 0.6, 0.03); glass.position.set(0, 1.36, 0.74); glass.rotation.x = -0.35; g.add(glass);
    part(g, BOX, lamb(0x8a2a2a), -0.45, 1.15, -0.5, 0.7, 0.4, 0.7); part(g, BOX, lamb(0x8a2a2a), 0.45, 1.15, -0.5, 0.7, 0.4, 0.7); // seats
    part(g, CYL8, dark, 0, 1.45, 0.35, 0.22, 0.05, 0.22, Math.PI / 2.5); // wheel
    part(g, BOX, dark, 0, 1.0, -2.75, 0.5, 1.1, 0.5); part(g, BOX, lamb(0xffb020), 0, 1.5, -2.75, 0.56, 0.2, 0.56); // outboard motor
    const prop = new THREE.Group(); prop.position.set(0, 0.25, -2.9); g.add(prop); part(prop, BOX, dark, 0, 0, 0, 0.9, 0.12, 0.05); part(prop, BOX, dark, 0, 0, 0, 0.12, 0.9, 0.05);
    part(g, ICO, glowM(0x6dff8a), 1.05, 1.05, 2.0, 0.08); part(g, ICO, glowM(0xff4a4a), -1.05, 1.05, 2.0, 0.08); // nav lights
    g.userData.prop = prop;
    return g;
}
function boatHome(fuelFloor = 0) {
    const D = HARBOR5, p = D.pt(D.LEN - 7, 4.2);
    B5.x = p.x; B5.z = p.z; B5.yaw = Math.atan2(D.DIR.x, D.DIR.z); B5.speed = 0; B5.docked = "haven";
    save.boat.fuel = Math.max(save.boat.fuel, boatMaxFuel() * fuelFloor);
    placeBoat();
}
function placeBoat() { if (!B5.mesh) return; B5.mesh.position.set(B5.x, -0.32, B5.z); B5.mesh.rotation.set(0, B5.yaw, 0); }
const seatPos = new THREE.Vector3();
function boatSeat() { return seatPos.set(B5.x + Math.sin(B5.yaw) * -0.5, 1.95 + B5.mesh.position.y + 0.32, B5.z + Math.cos(B5.yaw) * -0.5); }
// where you'd step out onto land (a dock or a beach) from where the boat is
function landingSpot() {
    let best = null, bd = 1e9;
    for (let r = 2.5; r <= 11; r += 1.5) for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, x = B5.x + Math.cos(a) * r, z = B5.z + Math.sin(a) * r;
        const dock = onDock5(x, z), I = archAt(x, z), inside = archIn(I, x, z);
        if (!(dock || inside > 4.5)) continue;
        if (r < bd) { bd = r; best = { x, z, I, dock }; }
    }
    return best;
}
function boatEnter() {
    if (B5.on) return;
    B5.on = true; B5.speed = 0; player.vel.set(0, 0, 0); mouseDown = false;
    player.yaw = B5.yaw + Math.PI; player.pitch = -0.05;
    sfx(90, 0.4, "sawtooth", 0.1, 1.6); setTimeout(() => sfx(70, 0.6, "sawtooth", 0.08, 1.3), 200);
    if (!save.boatTip) { save.boatTip = 1; toast("W / S throttle · A / D steer · Shift to boost (burns fuel fast) · F to get out next to land", "good"); toast("Watch your fuel! Run dry out at sea and you'll lose everything you're carrying.", "bad"); }
}
function boatExit() {
    const s = landingSpot(); if (!s) { toast("Too far from land to get out. Get closer to a dock or a beach.", "bad"); return; }
    B5.on = false; B5.speed = 0; B5.strand = 0;
    player.pos.set(s.x, groundY5(s.x, s.z) + 1.7, s.z); player.vel.set(0, 0, 0);
    B5.docked = s.I.k;
    sfx(140, 0.2, "square", 0.08, 0.5);
    if (s.I.k !== arch5) setArch5(s.I.k);
    writeSave();
}
function driveBoat(dt) {
    const fuel = save.boat.fuel, can = fuel > 0;
    let thr = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 0.45 : 0);
    if (!can || panel) thr = 0;
    const boost = can && thr > 0 && (keys.ShiftLeft || keys.ShiftRight);
    const target = thr * boatTop() * (boost ? 1.45 : 1);
    B5.speed += (target - B5.speed) * Math.min(1, (thr ? 0.7 : 0.35) * dt);
    const steer = panel ? 0 : (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0), turn = steer * 1.05 * clamp(Math.abs(B5.speed) / 7, 0.2, 1) * (B5.speed < -0.2 ? -1 : 1) * dt;
    B5.yaw += turn; player.yaw += turn;
    if (can && thr) save.boat.fuel = Math.max(0, fuel - Math.abs(thr) * (boost ? 6 : 2.8) * dt);
    // move, unless that would beach us or hit a dock
    const fx = Math.sin(B5.yaw), fz = Math.cos(B5.yaw), nx = B5.x + fx * B5.speed * dt, nz = B5.z + fz * B5.speed * dt;
    const bowX = nx + fx * 3.2 * Math.sign(B5.speed || 1), bowZ = nz + fz * 3.2 * Math.sign(B5.speed || 1);
    const hit = landH5(bowX, bowZ) > -0.85 || landH5(nx + fz * 1.1, nz - fx * 1.1) > -0.85 || landH5(nx - fz * 1.1, nz + fx * 1.1) > -0.85;
    if (hit) { if (Math.abs(B5.speed) > 4) { sfx(60, 0.3, "square", 0.14, 0.5); shake = Math.min(0.6, shake + Math.abs(B5.speed) * 0.03); } B5.speed *= -0.25; }
    else if (Math.hypot(nx, nz) > 760) B5.speed *= -0.3;
    else { B5.x = nx; B5.z = nz; }
    // ride the swell
    const bob = Math.sin(time * 1.3) * 0.07 + Math.sin(time * 2.1 + B5.x * 0.05) * 0.04;
    B5.mesh.position.set(B5.x, -0.32 + bob, B5.z);
    B5.mesh.rotation.set(-Math.min(0.12, Math.abs(B5.speed) * 0.006) + Math.sin(time * 1.7) * 0.02, B5.yaw, -turn * 4 + Math.sin(time * 1.1) * 0.025);
    B5.mesh.userData.prop.rotation.z += B5.speed * dt * 4;
    player.pos.copy(boatSeat()); player.vel.set(0, 0, 0); player.onGround = true;
    // wake and engine noise
    if (Math.abs(B5.speed) > 2 && (B5.wakeT -= dt) <= 0) { B5.wakeT = 0.05; burst(V3(B5.x - fx * 2.8 + (Math.random() - 0.5), -0.3, B5.z - fz * 2.8 + (Math.random() - 0.5)), 1, 1.5, [wakeMat]); }
    if ((B5.engT -= dt) <= 0 && can) { B5.engT = 0.11; sfx(55 + Math.abs(B5.speed) * 6 + (boost ? 30 : 0), 0.13, "sawtooth", 0.025 + Math.abs(thr) * 0.03, 1.05); }
    // fuel: warnings, then the sea
    const f = save.boat.fuel / boatMaxFuel();
    if (f < 0.2 && f > 0 && B5.warned < 1) { B5.warned = 1; toast("LOW FUEL! Head for a fuel dock (Port Haven or Coral Key).", "bad"); }
    if (f >= 0.2) B5.warned = 0;
    if (save.boat.fuel <= 0) {
        if ((save.boat.cans || 0) > 0) { save.boat.cans--; save.boat.fuel = boatMaxFuel() * 0.25; toast("You pour your spare fuel can into the tank. 25% fuel.", "good"); sfx(300, 0.4, "sine", 0.08, 1.5); return; }
        const near = landingSpot();
        if (near) { B5.strand = 0; if (B5.warned < 2) { B5.warned = 2; toast("Out of fuel! You're close enough to land: press F to get out.", "bad"); } }
        else {
            B5.strand += dt;
            if (B5.warned < 3) { B5.warned = 3; toast("OUT OF FUEL in open water... the boat is drifting. Nobody is coming.", "bad"); sfx(90, 1.2, "sawtooth", 0.1, 0.4); }
            const left = 14 - B5.strand;
            say(left > 0 ? `OUT OF FUEL · DRIFTING · ${Math.ceil(left)}` : "");
            hurtEl.style.opacity = Math.max(+hurtEl.style.opacity || 0, clamp(B5.strand / 14, 0, 0.8));
            if (B5.strand >= 14) loseAtSea();
        }
    } else if (B5.strand) { B5.strand = 0; say(""); }
}
const wakeMat = new THREE.MeshBasicMaterial({ color: 0xe8f8ff, transparent: true, opacity: 0.8 });
function loseAtSea() {
    say("");
    const lostN = Object.values(save.mats || {}).reduce((a, b) => a + (b || 0), 0);
    save.mats = {};
    B5.on = false; B5.speed = 0; B5.strand = 0; B5.warned = 0;
    boatHome(0.3);
    endFishing(); player.hp = 0; state = "dead"; deadT = 0; save.deaths++; mouseDown = false; panel = null;
    $("deathLost").textContent = lostN ? `Lost at sea. ${lostN} materials went down with the boat.` : "Lost at sea. Good thing your pockets were empty.";
    $("death").classList.add("show");
    sfx(50, 1.4, "sawtooth", 0.3, 0.2); sfx(110, 1.0, "sine", 0.12, 0.3);
    writeSave(); showPanels();
}
function boatRespawn() { // after any death on the Archipelago you wake at Port Haven; the harbor master tows your boat home
    if (arch5 !== "haven") setArch5("haven", true);
    if (B5.docked !== "haven" || Math.hypot(B5.x - HARBOR5.B.x, B5.z - HARBOR5.B.z) > 40) { boatHome(0.3); toast("The harbor master towed your boat back to Port Haven.", ""); }
}
function refuel() {
    const need = boatMaxFuel() - save.boat.fuel;
    if (need < 0.5) { toast("The tank is already full.", ""); return; }
    const price = fuelPrice(), afford = Math.floor(save.money / price), units = Math.min(need, afford);
    if (units < 1) { toast(`Fuel costs ${money(price)} a unit. You can't afford any.`, "bad"); return; }
    save.money -= Math.round(units * price); save.boat.fuel += units;
    toast(units < need ? `Filled ${Math.round(units)} units (that's all you could afford). -${money(Math.round(units * price))}` : `Tank full! -${money(Math.round(units * price))}`, "cash");
    sfx(200, 0.6, "sine", 0.06, 2.4); writeSave();
}
function ringTow() {
    const cost = Math.round(2500 * rebirthMult());
    if (save.money < cost) { toast(`The harbor tow costs ${money(cost)}. You can't afford it.`, "bad"); return; }
    save.money -= cost;
    sfx(880, 1.2, "sine", 0.1, 1); setTimeout(() => sfx(880, 1.2, "sine", 0.08, 1), 600);
    fadeTo(() => { boatHome(0.3); B5.on = false; const p = HARBOR5.pt(HARBOR5.LEN - 4); player.pos.set(p.x, 1.75, p.z); player.vel.set(0, 0, 0); setArch5("haven", true); });
    toast(`The harbor tow hauls you and your boat back to Port Haven. -${money(cost)}`, "");
}
function boatItems() {
    const m = rebirthMult(), lvl = k => save.boat[k] || 0;
    return [
        { name: "Bigger Fuel Tank", desc: `+45% fuel capacity (${lvl("tank")}/5) · now ${Math.round(boatMaxFuel())} units`, cost: Math.round([6000, 18000, 50000, 130000, 320000][lvl("tank")] * m || 0), maxed: lvl("tank") >= 5, buy() { save.boat.tank++; save.boat.fuel = Math.min(boatMaxFuel(), save.boat.fuel + 40); } },
        { name: "Faster Engine", desc: `+13% top speed (${lvl("engine")}/5) · now ${boatTop().toFixed(1)} m/s`, cost: Math.round([8000, 24000, 65000, 160000, 400000][lvl("engine")] * m || 0), maxed: lvl("engine") >= 5, buy() { save.boat.engine++; } },
        { name: "Spare Fuel Can", desc: `Pours itself in the moment your tank runs dry: +25% fuel. Carry up to 3. You have ${lvl("cans")}`, cost: Math.round(4000 * m), maxed: lvl("cans") >= 3, buy() { save.boat.cans = lvl("cans") + 1; } },
        { name: "Fill the Tank", desc: `Fuel is ${money(fuelPrice())} a unit. You have ${Math.round(save.boat.fuel)} / ${Math.round(boatMaxFuel())}`, sell: true, value: 0, buy() { refuel(); } }
    ];
}

// =========================== the islands (3D) ===========================
const isle5G = new THREE.Group(); isle5G.visible = false; scene.add(isle5G);
const isle5 = { waterGeo: null, terrain: {}, emit: [], fireLight: null, beam: null, lighthouse: null, boatArr: null, boatNext: null, labels: [], bells: [] };
let isle5Built = false, ferryman5 = null, mapBg5 = null;
const npcs5 = [];
const ISLE_PAL = {
    haven: (x, z, y, ny, inside, d, rn, c) => { if (inside < 12 && y < 1.6) c.setHSL(0.12, 0.5, 0.62 + rn * 0.06); else if (d < SAFE_R + 1) c.setHSL(0.09, 0.32, 0.32 + rn * 0.05); else if (ny < 0.8) c.setHSL(0.08, 0.2, 0.32 + rn * 0.06); else c.setHSL(0.3 + rn * 0.05, 0.48, 0.26 + rn * 0.06); },
    coral: (x, z, y, ny, inside, d, rn, c) => { const v = fbm2(x * 0.08, z * 0.08, 2); if (v > 0.6 && inside > 10) c.setHSL(0.97, 0.45, 0.62 + rn * 0.05); else c.setHSL(0.11, 0.32, 0.78 + rn * 0.06); },
    skull: (x, z, y, ny, inside, d, rn, c) => { if (inside < 10 && y < 1.4) c.setHSL(0.08, 0.06, 0.14 + rn * 0.04); else if (ny < 0.82 || y > 6) c.setHSL(0.07, 0.08, 0.24 + rn * 0.06 + Math.min(0.12, y * 0.006)); else c.setHSL(0.15, 0.25, 0.28 + rn * 0.05); },
    frost: (x, z, y, ny, inside, d, rn, c) => { if (y > 7 || (y > 3 && ny > 0.8)) c.setHSL(0.58, 0.22, 0.72 + rn * 0.06); else if (ny < 0.8) c.setHSL(0.6, 0.12, 0.46 + rn * 0.06); else if (inside < 10) c.setHSL(0.58, 0.1, 0.62 + rn * 0.05); else c.setHSL(0.47, 0.22, 0.48 + rn * 0.05); },
    storm: (x, z, y, ny, inside, d, rn, c) => { if (inside < 10 && y < 1.5) c.setHSL(0.7, 0.08, 0.2 + rn * 0.04); else if (ny < 0.8) c.setHSL(0.72, 0.14, 0.24 + rn * 0.05); else c.setHSL(0.76 + rn * 0.03, 0.34, 0.26 + rn * 0.05); }
};
function buildIsle5() {
    isle5Built = true; curBuild = 5;
    const prevAdd = addTgt; addTgt = isle5G;
    colliders.length = 0; circles.length = 0; occluders.length = 0; chests.length = 0; altar = null;
    // ----- the land: one terrain per island -----
    for (const I of ARCH) {
        const S = Math.ceil((I.r + 22) * 2), seg = Math.round(S / 1.6), g = new THREE.PlaneGeometry(S, S, seg, seg);
        g.rotateX(-Math.PI / 2);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setY(i, archTerrain(I, pos.getX(i) + I.x, pos.getZ(i) + I.z));
        g.computeVertexNormals();
        const nor = g.attributes.normal, col = [], c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i) + I.x, z = pos.getZ(i) + I.z, y = pos.getY(i), inside = archIn(I, x, z), d = Math.hypot(x, z);
            if (y < -0.5) c.setHSL(0.5, 0.35, 0.3 + Math.random() * 0.05); else ISLE_PAL[I.k](x, z, y, nor.getY(i), inside, d, Math.random(), c);
            col.push(c.r, c.g, c.b);
        }
        g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })); m.position.set(I.x, 0, I.z); scene.add(m);
        isle5.terrain[I.k] = m;
        // a floating name over every island, readable from far across the water
        const l = label(I.name, I.col, 4.6, 1.0); l.position.set(I.x, I.k === "frost" ? 40 : 26, I.z); l.maxD = 900; l.blurK = 0.18; l.base = I.name; isle5.labels.push({ l, I });
    }
    terrainMesh[5] = isle5.terrain.haven;
    // ----- the sea: shallow turquoise round every island, deep blue between -----
    {
        const wg = new THREE.PlaneGeometry(1600, 1600, 200, 200); wg.rotateX(-Math.PI / 2);
        const wp = wg.attributes.position, wc = [], cc = new THREE.Color(), shallow = new THREE.Color(0x5ae8e0), mid = new THREE.Color(0x2f96c8), deep = new THREE.Color(0x0e3a6a);
        for (let i = 0; i < wp.count; i++) { const x = wp.getX(i), z = wp.getZ(i), I = archAt(x, z), k = clamp(-archIn(I, x, z) / 46, 0, 1); cc.copy(shallow).lerp(mid, clamp(k * 2, 0, 1)).lerp(deep, clamp(k * 2 - 1, 0, 1)); wc.push(cc.r, cc.g, cc.b); }
        wg.setAttribute("color", new THREE.Float32BufferAttribute(wc, 3)); isle5.waterGeo = wg;
        const fp = [], idx = []; let base = 0;
        for (const I of ARCH) { const N = Math.round(I.r * 3); for (let i = 0; i <= N; i++) { const th = (i / N) * Math.PI * 2, r = archR(I, th); fp.push(I.x + Math.cos(th) * (r - 3.5), -0.4, I.z + Math.sin(th) * (r - 3.5), I.x + Math.cos(th) * (r - 2.2), -0.4, I.z + Math.sin(th) * (r - 2.2)); if (i < N) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } } base += (N + 1) * 2; }
        const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3)); fg.setIndex(idx);
        isle5.foam = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
        scene.add(isle5.foam);
    }
    // ----- docks -----
    for (const D of DOCKS5) {
        const yaw = Math.atan2(D.DIR.x, D.DIR.z);
        const planks = batch(lamb(D.kind === "harbor" ? 0x8a6a4a : 0x6a5a4a)), posts = batch(woodDark), rails = batch(woodDark), bulbs = batch(glowM(D.kind === "next" ? 0x9fe8ff : 0xffd890));
        for (let i = 0; i < D.LEN; i++) { const p = D.pt(i + 0.5); planks.add(BOX, p.x, 0.22, p.z, 0, yaw, 0, 3.6, 0.14, 0.92); }
        for (let i = 0; i <= D.LEN; i += 3) for (const sd of [-1.9, 1.9]) { const p = D.pt(i, sd); posts.add(CYL6, p.x, -0.9, p.z, 0, 0, 0, 0.12, 4.2, 0.12); if (i % 6 === 0) bulbs.add(ICO, p.x, 1.45, p.z, 0, 0, 0, 0.16); }
        for (let i = 0; i < D.LEN; i++) for (const sd of [-1.9, 1.9]) { if (D.kind === "harbor" && sd > 0 && i > D.LEN - 12) continue; const p = D.pt(i + 0.5, sd, 0.95); rails.add(BOX, p.x, 0.95, p.z, 0, yaw, 0, 0.08, 0.1, 1.02); }
        planks.build(); posts.build(); rails.build(); bulbs.build();
        if (D.kind === "harbor") {
            // a fuel pump (Port Haven and Coral Key) or a tow bell (everywhere else)
            const p = pumpAt(D);
            if (D.I.pump) {
                const g = new THREE.Group(); g.position.set(p.x, 0.3, p.z); g.rotation.y = yaw; scene.add(g);
                part(g, BOX, lamb(0xc8202a), 0, 0.75, 0, 0.6, 1.5, 0.45); part(g, BOX, glowM(0xffe070), 0, 1.25, 0.24, 0.4, 0.25, 0.02); part(g, CYL6, lamb(0x1a1a1a), 0.38, 0.9, 0, 0.05, 0.6, 0.05);
                const l = label("FUEL", "#ffe070", 2, 0.6); l.position.set(p.x, 2.6, p.z); l.maxD = 60;
            } else {
                const g = new THREE.Group(); g.position.set(p.x, 0.3, p.z); scene.add(g);
                part(g, CYL6, woodDark, -0.5, 1.1, 0, 0.07, 2.2, 0.07); part(g, CYL6, woodDark, 0.5, 1.1, 0, 0.07, 2.2, 0.07); part(g, BOX, woodDark, 0, 2.2, 0, 1.2, 0.1, 0.1);
                const bell = part(g, CONE6, lamb(0xd8a840), 0, 1.85, 0, 0.32, 0.5, 0.32); isle5.bells.push(bell);
                const l = label("TOW BELL", "#ffd040", 2.2, 0.6); l.position.set(p.x, 3.0, p.z); l.maxD = 50;
            }
            const sl = label(D.I.name + " HARBOR", D.I.col, 3, 0.7); const sp = D.pt(3.5, 0, 4.2); sl.position.copy(sp); sl.maxD = 90;
        } else {
            const [a1, a2, c1] = D.kind === "arr" ? ["WELCOME TO", "PORT HAVEN", "#ffd890"] : ["REBIRTH 5", "COMING SOON", "#9fe8ff"];
            const s1 = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex(a1, a2, c1) })); s1.position.copy(D.pt(3.5, 0, 3.3)); s1.rotation.y = D.kind === "arr" ? yaw : yaw + Math.PI; scene.add(s1);
            const s2 = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: signTex(D.kind === "arr" ? "ARRIVALS" : "PORT HAVEN", D.kind === "arr" ? "FROM ASHFALL ISLE" : "THIS WAY ↑", c1) })); s2.position.copy(D.pt(3.5, 0, 3.3)); s2.rotation.y = D.kind === "arr" ? yaw + Math.PI : yaw; scene.add(s2);
            for (const sd of [-2.0, 2.0]) { const p = D.pt(3.5, sd); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.6, 6), woodDark); m.position.set(p.x, 1.8, p.z); scene.add(m); }
            const b = makeBoat3(D.kind === "arr" ? 0x2a1a1a : 0x1a2a3a, D.kind === "arr" ? 0x7a3a2a : 0x4a7a9a, D.kind === "arr" ? 0xffa050 : 0x9fe8ff);
            b.position.copy(D.pt(D.LEN - 7, 4.4, -0.15)); b.rotation.y = yaw; scene.add(b);
            if (D.kind === "arr") isle5.boatArr = b; else isle5.boatNext = b;
        }
    }
    // ----- Port Haven: camp, stalls, shipwright, ferryman, lanterns -----
    {
        const stones = batch(lamb(0x6a6460)); for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.28; stones.add(ICO, Math.cos(a) * 1.3, 0.18, -3 + Math.sin(a) * 1.3, 0, 0, 0, 0.28, 0.22, 0.28); } stones.build();
        const lg = batch(woodDark); for (let i = 0; i < 4; i++) lg.add(CYL6, 0, 0.25, -3, Math.PI / 2, i * 0.8, 0, 0.12, 1.3, 0.12); lg.build();
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.7, 6), glowM(0xff8a2a)); flame.position.set(0, 1.05, -3);
        const core = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 5), glowM(0xffe070)); core.position.set(0, 0.72, -3);
        scene.add(flame, core); fires.push({ flame, core, ph: srand() * 6 });
        const fl = new THREE.PointLight(0xff9a40, 18, 18, 1.6); fl.position.set(0, 2, -3); scene.add(fl); isle5.fireLight = fl;
        circles.push({ x: 0, z: -3, r: 1.3 }); isle5.emit.push({ x: 0, y: 2.0, z: -3, rate: 1.0, acc: 0.3 });
        const cl = label("PORT HAVEN", "#ffd890", 3.4, 0.8); cl.position.set(0, 4.6, -3); cl.maxD = 90;
        // a beach hut to sleep in
        const g = new THREE.Group(); g.position.set(BED5.x, groundY5(BED5.x, BED5.z), BED5.z); g.rotation.y = Math.atan2(-BED5.x, -BED5.z);
        for (const [x, z] of [[-1.5, -1.2], [1.5, -1.2], [-1.5, 1.0], [1.5, 1.0]]) part(g, CYL6, lamb(0x8a6a4a), x, 1.2, z, 0.1, 2.4, 0.1);
        const thatch = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.4, 4), lamb(0xc8a860)); thatch.position.set(0, 3.0, -0.1); thatch.rotation.y = Math.PI / 4; g.add(thatch);
        part(g, BOX, wood, 0, 0.35, -0.2, 1.4, 0.3, 2.3); part(g, BOX, lamb(0x2a8ab0), 0, 0.58, -0.55, 1.3, 0.14, 1.5); part(g, BOX, lamb(0xf0ece0), 0, 0.58, 0.7, 1.0, 0.14, 0.5);
        scene.add(g); circles.push({ x: BED5.x, z: BED5.z, r: 1.6 });
        const bl = label("BED", "#ffe0b0", 2, 0.6); bl.position.set(BED5.x, 3.6, BED5.z);
        const gS = stall3(SMITH5, "THE SEA FORGE", "CRAFT AXES · GUNS", "#7ad8ff", 0x2a4a5a);
        const smith = makeHumanoid({ face: "smith", skin: 0xc8946a, shirt: 0x2a4a6a, pants: 0x1a2a3a, apron: 0x3a2a1a, beard: 0x5a3a1a, hat: "cap", hatCol: 0x1a3a5a, wide: 1.25, belly: true });
        smith.g.position.set(0, 0, -0.6); gS.add(smith.g); smith.yaw = gS.rotation.y; npcs5.push(smith);
        const hm = new THREE.Group(); hm.position.set(0, -0.64, 0.05); smith.armR.add(hm); part(hm, BOX, lamb(0x6a4a2a), 0, 0, 0.22, 0.05, 0.05, 0.5); smith.hammer = part(hm, BOX, lamb(0x2a2a30), 0, 0, 0.48, 0.24, 0.13, 0.13);
        const l1 = label("THE SEA FORGE", "#7ad8ff", 3.2, 0.8); l1.position.set(SMITH5.x, 6.2, SMITH5.z);
        const gD = stall3(DEPOT5, "TRADING POST", "SELL MATERIALS", "#ffd040", 0x5a3a20);
        const clerk = makeHumanoid({ face: "clerk", skin: 0x8a5a3a, shirt: 0xf0e8d8, vest: 0x1a6ab0, pants: 0x3a2a20, hair: 0x101010, hat: "cap", hatCol: 0xf0f0f0 });
        clerk.g.position.set(0, 0, -0.6); gD.add(clerk.g); clerk.yaw = gD.rotation.y; npcs5.push(clerk);
        const l2 = label("TRADING POST", "#ffd040", 3.6, 0.8); l2.position.set(DEPOT5.x, 6.2, DEPOT5.z);
        const gW = stall3(WITCH5, "SEA WITCH", "BREWS · TONICS", "#7affd8", 0x1a4a4a);
        const witch = makeHumanoid({ face: "witch", skin: 0x7ac8b0, shirt: 0x1a3a4a, pants: 0x1a2a2a, hair: 0x2a6a6a, hat: "witch", hatCol: 0x1a3a3a });
        witch.g.position.set(0, 0, -0.6); gW.add(witch.g); witch.yaw = gW.rotation.y; npcs5.push(witch);
        const l3 = label("SEA WITCH", "#7affd8", 3.2, 0.8); l3.position.set(WITCH5.x, 6.2, WITCH5.z);
        // the shipwright's shed by the harbor
        const sw = new THREE.Group(), sy = groundY5(SHIPWRIGHT.x, SHIPWRIGHT.z); sw.position.set(SHIPWRIGHT.x, sy, SHIPWRIGHT.z); sw.rotation.y = Math.atan2(HARBOR5.DIR.x, HARBOR5.DIR.z) + Math.PI / 2; scene.add(sw);
        part(sw, BOX, lamb(0x8a6a4a), 0, 0.55, 0, 3.4, 1.1, 1.2); part(sw, BOX, lamb(0xd8c8a0), 0, 1.14, 0, 3.5, 0.08, 1.3);
        for (const x of [-1.6, 1.6]) part(sw, CYL6, woodDark, x, 1.6, -0.5, 0.08, 3.2, 0.08);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(4, 0.14, 2.4), lamb(0x2a6a9a)); roof.position.set(0, 3.25, -0.2); roof.rotation.x = 0.15; sw.add(roof);
        part(sw, CYL6, lamb(0xffb020), 1.2, 1.5, 0, 0.12, 0.6, 0.12, Math.PI / 2); // a life ring
        const wright = makeHumanoid({ face: "clerk", skin: 0xf0c8a0, shirt: 0xf2f2f2, pants: 0x1a2a4a, beard: 0xd8d0c0, hat: "cap", hatCol: 0x1a2a4a });
        wright.g.position.set(0, 0, -0.9); sw.add(wright.g); wright.yaw = sw.rotation.y; npcs5.push(wright);
        circles.push({ x: SHIPWRIGHT.x, z: SHIPWRIGHT.z, r: 1.8 });
        const l4 = label("SHIPWRIGHT", "#9fe8ff", 3.2, 0.8); l4.position.set(SHIPWRIGHT.x, sy + 4.4, SHIPWRIGHT.z);
        const l5 = label("boat upgrades · fuel cans", "#cfe8ff", 2.4, 0.5); l5.position.set(SHIPWRIGHT.x, sy + 3.6, SHIPWRIGHT.z); l5.maxD = 40;
        // lanterns from camp to every dock
        const lp = batch(woodDark), lgl = batch(glowM(0xffd890));
        for (const D of DOCKS5.slice(0, 3)) { const land = Math.hypot(D.B.x, D.B.z); for (let s = 4, k = 0; s < land - 26; s += 9, k++) { const sd = k % 2 ? 3.2 : -3.2, x = D.B.x - D.DIR.x * s + D.PERP.x * sd, z = D.B.z - D.DIR.z * s + D.PERP.z * sd, y = groundY5(x, z); lp.add(CYL6, x, y + 1.2, z, 0, 0, 0, 0.07, 2.4, 0.07); lgl.add(ICO, x, y + 2.5, z, 0, 0, 0, 0.18, 0.24, 0.18); } }
        lp.build(); lgl.build();
        // the Rebirth 5 ferryman (not sailing yet)
        const yaw = Math.atan2(NEXT5.DIR.x, NEXT5.DIR.z);
        ferryman5 = makeFerrymanFigure(0x1a2a3a, 0x3a7aaa, 0x9fe8ff); ferryman5.position.set(FERRYMAN5.x, 0.3, FERRYMAN5.z); ferryman5.rotation.y = yaw + Math.PI; scene.add(ferryman5);
        const fm = label("FERRYMAN", "#9fe8ff", 2.6, 0.6); fm.position.set(FERRYMAN5.x, 4.7, FERRYMAN5.z); fm.maxD = 60;
    }
    // ----- landmarks you can see from the water -----
    {   // Storm Isle's lighthouse, with a sweeping beam
        const I = ARCH_BY.storm, y = archTerrain(I, I.x, I.z), g = new THREE.Group(); g.position.set(I.x, y, I.z); scene.add(g);
        part(g, CYL8, lamb(0xf2f2f2), 0, 5, 0, 2.2, 10, 2.2); part(g, CYL8, lamb(0xc8202a), 0, 3.3, 0, 2.25, 1.4, 2.25); part(g, CYL8, lamb(0xc8202a), 0, 7.2, 0, 2.05, 1.4, 2.05);
        part(g, CYL8, lamb(0x2a2a30), 0, 10.4, 0, 2.4, 0.4, 2.4); part(g, CYL8, glowM(0xfff4c0), 0, 11.4, 0, 1.4, 1.6, 1.4); part(g, CONE6, lamb(0xc8202a), 0, 12.9, 0, 1.8, 1.4, 1.8);
        const beam = new THREE.Mesh(new THREE.ConeGeometry(5, 70, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff4c0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
        beam.rotation.z = Math.PI / 2; beam.position.set(35, 0, 0); const piv = new THREE.Group(); piv.position.set(0, 11.4, 0); piv.add(beam); g.add(piv); isle5.beam = piv;
        circles.push({ x: I.x, z: I.z, r: 2.6 });
    }
    {   // Skull Rock: a huge stone skull glaring at the sea
        const I = ARCH_BY.skull, y = archTerrain(I, I.x, I.z), g = new THREE.Group(); g.position.set(I.x, y - 2, I.z); g.rotation.y = Math.atan2(-I.x, -I.z); scene.add(g);
        const bone = lamb(0xd8d0c0), dark = new THREE.MeshBasicMaterial({ color: 0x0a0806 });
        part(g, SPH, bone, 0, 9, 0, 8, 7, 7); part(g, BOX, bone, 0, 3.6, 2.6, 7, 4, 5);
        for (const s of [-1, 1]) part(g, SPH, dark, s * 2.8, 9.5, 5.2, 2, 2.4, 1.6);
        part(g, CONE6, dark, 0, 6.5, 6.4, 1, 2, 0.8, Math.PI);
        for (let i = 0; i < 6; i++) part(g, BOX, bone, -2.5 + i, 2.6, 5.15, 0.7, 1.4, 0.4);
        const l = label("☠", "#ffd8a0", 2, 1); l.position.set(I.x, y + 22, I.z); l.maxD = 600;
        // a wrecked pirate ship on the beach
        const wd = archR(I, 0.6) - 9, wx = I.x + Math.cos(0.6) * wd, wz = I.z + Math.sin(0.6) * wd, wg = new THREE.Group(); wg.position.set(wx, archTerrain(I, wx, wz) - 0.6, wz); wg.rotation.set(0.25, 1.2, 0.18); scene.add(wg);
        part(wg, BOX, lamb(0x4a2a1a), 0, 1, 0, 3.4, 2, 9); part(wg, CYL6, lamb(0x3a2214), 0, 5, 0.5, 0.18, 8, 0.18, 0.2); part(wg, BOX, lamb(0xd8d0c0), 0.3, 5.5, 0.5, 0.06, 3, 3.2);
        circles.push({ x: wx, z: wz, r: 4.5 });
    }
    {   // Coral Key: a big pink coral arch
        const I = ARCH_BY.coral, g = new THREE.Group(), y = archTerrain(I, I.x + 6, I.z - 4); g.position.set(I.x + 6, y, I.z - 4); scene.add(g);
        const cm = lamb(0xff7a9a), cm2 = lamb(0xffb0c0);
        for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI, x = Math.cos(a) * 6, yy = Math.sin(a) * 7; part(g, SPH, k % 2 ? cm : cm2, x, yy, 0, 1.4, 1.4, 1.4); }
        for (let k = 0; k < 14; k++) { const a = srand() * 6.28, d = srange(3, 10); part(g, CONE6, k % 2 ? cm : lamb(0xffa060), Math.cos(a) * d, 0.8, Math.sin(a) * d, 0.3, srange(1.2, 2.6), 0.3); }
        circles.push({ x: I.x + 0, z: I.z - 4, r: 1.6 }, { x: I.x + 12, z: I.z - 4, r: 1.6 });
    }
    {   // Frostcap: an ice spire on the summit
        const I = ARCH_BY.frost, y = archTerrain(I, I.x, I.z);
        const ice = new THREE.MeshLambertMaterial({ color: 0xbff0ff, emissive: 0x1a4a6a, transparent: true, opacity: 0.9, flatShading: true });
        for (let k = 0; k < 7; k++) { const a = (k / 7) * 6.28, m = new THREE.Mesh(CONE6, ice); m.scale.set(0.9, srange(4, 9), 0.9); m.position.set(I.x + Math.cos(a) * 2, y + 2, I.z + Math.sin(a) * 2); m.rotation.set(Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3); scene.add(m); }
        const m = new THREE.Mesh(CONE6, ice); m.scale.set(1.4, 14, 1.4); m.position.set(I.x, y + 6, I.z); scene.add(m);
    }
    // ----- scenery on every island -----
    {
        const rocks = batch(lamb(0x6a6460)), palmT = batch(lamb(0xa8885a)), palmL = batch(lamb(0x3aa04a)), shells = batch(glowM(0xffe8d8)), ice = batch(lamb(0xe8f6ff)), dead = batch(lamb(0x2a2420)), heather = batch(lamb(0x7a4a9a));
        for (const I of ARCH) {
            const spots = (n, fn, minIn = 12) => { let made = 0, guard = 0; while (made < n && guard++ < n * 30) { const a = srand() * 6.283, d = srand() * (archR(I, a) - minIn), x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d; if (!archOK5(x, z, I)) continue; fn(x, z, archTerrain(I, x, z)); made++; } };
            const beach = (n, fn) => { for (let i = 0; i < n; i++) { const a = srand() * 6.283, d = archR(I, a) - srange(2, 9), x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d; if (onDock5(x, z)) continue; fn(x, z, Math.max(-0.3, archTerrain(I, x, z))); } };
            spots(I.k === "skull" ? 50 : 22, (x, z, y) => { const s = srange(0.4, 1.4); rocks.add(ICO, x, y + s * 0.4, z, srand() * 3, srand() * 3, 0, s, s * srange(0.6, 1), s); if (s > 1.1) circles.push({ x, z, r: s * 0.85 }); });
            beach(I.r * 0.8, (x, z, y) => shells.add(ICO, x, y + 0.06, z, srand(), srand() * 3, 0, 0.14, 0.08, 0.14));
            if (I.k === "haven" || I.k === "coral") beach(I.k === "haven" ? 26 : 14, (x, z, y) => { const h = srange(5, 8), lean = srange(0.15, 0.35), dir = Math.atan2(z - I.z, x - I.x); palmT.add(CYL6, x + Math.cos(dir) * lean * h * 0.5, y + h / 2, z + Math.sin(dir) * lean * h * 0.5, Math.sin(dir) * -lean, 0, Math.cos(dir) * lean, 0.22, h, 0.22);
                for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.28; palmL.add(BOX, x + Math.cos(dir) * lean * h + Math.cos(a) * 1.3, y + h - 0.2, z + Math.sin(dir) * lean * h + Math.sin(a) * 1.3, 0, -a, 0.35, 2.6, 0.06, 0.6); } });
            if (I.k === "frost") spots(40, (x, z, y) => ice.add(CONE6, x, y + 0.5, z, srand() * 0.4, 0, srand() * 0.4, 0.25, srange(0.8, 2), 0.25));
            if (I.k === "skull") spots(30, (x, z, y) => dead.add(CYL6, x, y + 1.5, z, srange(-0.2, 0.2), 0, srange(-0.2, 0.2), 0.12, srange(2, 4), 0.12));
            if (I.k === "storm") spots(60, (x, z, y) => heather.add(ICO, x, y + 0.15, z, 0, srand() * 3, 0, srange(0.3, 0.6), 0.25, srange(0.3, 0.6)));
            // treasure chests on every island
            const nC = I.k === "haven" ? 4 : 3;
            for (let i = 0; i < nC; i++) { let guard = 0; while (guard++ < 60) { const a = srand() * 6.283, d = srange(I.k === "haven" ? 34 : 8, archR(I, a) - 14), x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d; if (!archOK5(x, z, I)) continue; const c = makeChest(x, z, srand() * 6, I.k !== "haven" && i === 0); const y = archTerrain(I, x, z); c.g.position.y = y; c.beacon.position.y = y + 2.7; break; } }
        }
        rocks.build(); palmT.build(); palmL.build(); shells.build(); ice.build(); dead.build(); heather.build();
    }
    isle5.emit.forEach(e => smokeEmit.push(e));
    // your boat, waiting at the harbor
    B5.mesh = makeSpeedboat(); scene.add(B5.mesh);
    addTgt = prevAdd; curBuild = 1;
}
function enterIsle5() {
    leaveWorld();
    if (!isle5Built) { buildIsle5(); buildCasino(5); snapWorld(5); } else loadWorld(5);
    isle = 5; save.isle = 5;
    showWorld(5);
    if (casinos[5]) casino = casinos[5];
    groundFn = groundY5;
    waterMesh.geometry = isle5.waterGeo; waterMesh.material.needsUpdate = true;
    smokeEmit.length = 0; isle5.emit.forEach(e => smokeEmit.push(e));
    RESPAWN.x = 2; RESPAWN.z = 4;
    arch5 = "haven"; terrainMesh[5] = isle5.terrain.haven;
    boatHome(0); B5.on = false;
    syncGhosts();
    resetIsleTrees(archTreeTarget());
    resetChests();
}
function updateIsle5(dt, animOnly) {
    if (!isle5Built || isle !== 5) return;
    updateNpcs(dt, npcs5);
    if (isle5.foam) isle5.foam.material.opacity = 0.42 + Math.sin(time * 0.8) * 0.14;
    if (isle5.fireLight) isle5.fireLight.intensity = 16 + Math.sin(time * 13) * 3 + Math.sin(time * 7.3) * 2;
    if (isle5.beam) isle5.beam.rotation.y = time * 0.8;
    for (const [b, ph] of [[isle5.boatArr, 0], [isle5.boatNext, 1.3]]) if (b) { b.position.y = -0.15 + Math.sin(time * 1.1 + ph) * 0.07; b.rotation.z = Math.sin(time * 0.9 + ph) * 0.03; }
    if (!B5.on && B5.mesh) { B5.mesh.position.y = -0.32 + Math.sin(time * 1.2) * 0.05; B5.mesh.rotation.z = Math.sin(time * 0.9) * 0.025; }
    if (ferryman5) { ferryman5.position.y = 0.3 + Math.sin(time * 1.2) * 0.02; const base = Math.atan2(NEXT5.DIR.x, NEXT5.DIR.z) + Math.PI, near = Math.hypot(player.pos.x - FERRYMAN5.x, player.pos.z - FERRYMAN5.z) < 14; ferryman5.rotation.y += angDiff(near ? Math.atan2(player.pos.x - FERRYMAN5.x, player.pos.z - FERRYMAN5.z) : base, ferryman5.rotation.y) * Math.min(1, 3 * dt); }
    // island names show how far away they are
    if ((time * 2 | 0) !== ((time - dt) * 2 | 0)) for (const { l, I } of isle5.labels) { const d = Math.round(Math.hypot(player.pos.x - I.x, player.pos.z - I.z) - I.r); const t = d > 30 ? `${I.name} · ${d}m` : I.name; if (l.el.textContent !== t) l.el.textContent = t; }
    if (animOnly || state !== "playing") return;
    // walking onto another island (from a dock) moves the trees there too
    if (!B5.on) { const I = archAt(player.pos.x, player.pos.z); if (I.k !== arch5 && archIn(I, player.pos.x, player.pos.z) > 0) setArch5(I.k); }
}
function nearest5() {
    const px = player.pos.x, pz = player.pos.z, near = (p, r) => Math.hypot(px - p.x, pz - p.z) < r;
    if (B5.on) return landingSpot() ? { k: "boatout" } : null;
    if (near(SMITH5_AT, 3.4)) return { k: "smith" };
    if (near(DEPOT5_AT, 3.4)) return { k: "depot" };
    if (near(WITCH5_AT, 3.4)) return { k: "witch" };
    if (near(BED5, 3.2)) return { k: "bed" };
    if (near(SHIPWRIGHT, 3.6)) return { k: "ship" };
    if (near(FERRYMAN5, 3.4)) return { k: "ferry5" };
    for (const D of DOCKS5) if (D.kind === "harbor" && near(pumpAt(D), 2.4)) return D.I.pump ? { k: "fuel", D } : { k: "bell", D };
    if (B5.mesh && near({ x: B5.x, z: B5.z }, 5.2)) return { k: "boatin" };
    for (const c of chests) if (!c.opened && Math.hypot(px - c.x, pz - c.z) < 2.6) return { k: "chest", c };
    return null;
}
const PROMPTS5 = {
    boatin: () => `[F] Drive the boat · fuel ${Math.round((save.boat.fuel / boatMaxFuel()) * 100)}%`, boatout: () => "[F] Get out",
    fuel: () => (save.boat.fuel >= boatMaxFuel() - 0.5 ? "The tank is full" : `[F] Refuel the boat · ${money(Math.round((boatMaxFuel() - save.boat.fuel) * fuelPrice()))}`),
    bell: () => `[F] Ring for the harbor tow back to Port Haven · ${money(Math.round(2500 * rebirthMult()))}`, ship: () => "[F] Talk to the Shipwright", ferry5: () => "[F] Talk to the Ferryman"
};
const ISLE5_ACT = { boatin: () => boatEnter(), boatout: () => boatExit(), fuel: () => refuel(), bell: () => ringTow(), ship: () => openShop("ship", ["She's fast, but she's thirsty. Mind the gauge.", "Bigger tank, bigger trips.", "I've pulled a lot of sailors out of the water. Most of them were already empty-handed.", "Spare cans. Cheapest life insurance there is."][Math.floor(Math.random() * 4)]), ferry5: () => openFerry5() };
function openFerry5() { ferryConfirm = 0; $("ferrySay").textContent = "“Beyond the storm there's something else. I can hear it at night. I'm not ready to sail there yet.”"; openPanel("ferry"); }
function renderFerry5() {
    document.querySelector("#panelFerry h2").textContent = "THE FERRYMAN";
    const html = `<div class="fprice">Rebirths so far: <b>★${save.rebirths || 0}</b> <span>(+${(save.rebirths || 0) * 50}% cash, +${(save.rebirths || 0) * 10}% damage, +${(save.rebirths || 0) * 50} max HP)</span></div>
      <div class="flist"><div class="gain"><h4>REBIRTH 5</h4>Something waits past Storm Isle. The Ferryman won't sail there yet. Coming in a future update.</div></div>`;
    if ($("ferryBody").dataset.h !== html) { $("ferryBody").innerHTML = html; $("ferryBody").dataset.h = html; }
    const b = $("ferryBuy"); b.disabled = true; b.classList.remove("danger"); b.textContent = "REBIRTH 5: COMING SOON";
}
// ---- getting there: Ashfall's Rebirth 4 ferry ----
const REBIRTH4_COST = 5000000, REBIRTH4_CORE = 2;
const rebirth4Ready = () => (save.kingKills || 0) > 0 && (save.mats.molten || 0) >= REBIRTH4_CORE && save.money >= REBIRTH4_COST;
function renderFerry4v2() {
    document.querySelector("#panelFerry h2").textContent = "REBIRTH 4: THE FERRY TO THE ARCHIPELAGO";
    const k = save.kingKills || 0, mc = save.mats.molten || 0, cashOk = save.money >= REBIRTH4_COST, ok = rebirth4Ready();
    const html = `<div class="fprice">Rebirth 4 ticket: <b>${money(REBIRTH4_COST)}</b> + <b>${REBIRTH4_CORE} Molten Cores</b></div>
      <div class="flist">
        <div class="${k ? "keep" : "lose"}"><h4>${k ? "✔" : "✘"} THE CINDER KING</h4>${k ? `felled ${k} time${k === 1 ? "" : "s"}` : "still burning in the crater. Fell him at least once"}</div>
        <div class="${mc >= REBIRTH4_CORE ? "keep" : "lose"}"><h4>${mc >= REBIRTH4_CORE ? "✔" : "✘"} MOLTEN CORES</h4>${mc} / ${REBIRTH4_CORE} (they drop from the Cinder King)</div>
        <div class="${cashOk ? "keep" : "lose"}"><h4>${cashOk ? "✔" : "✘"} CASH</h4>${money(save.money)} of ${money(REBIRTH4_COST)}</div>
        <div class="lose"><h4>YOU LEAVE BEHIND</h4>cash and materials · every axe and gun · all upgrades and potions · the day count</div>
        <div class="gain"><h4>YOU GAIN (stacks every rebirth)</h4>★ +50% cash · ★ +10% damage · ★ +50 max health · ★ THE ARCHIPELAGO: five islands, your own speedboat, and an ocean that will kill you if you run out of fuel</div>
      </div>`;
    if ($("ferryBody").dataset.h !== html) { $("ferryBody").innerHTML = html; $("ferryBody").dataset.h = html; }
    const b = $("ferryBuy"); b.disabled = !ok; b.classList.toggle("danger", ok && !!ferryConfirm);
    b.textContent = !k ? "FELL THE CINDER KING FIRST" : mc < REBIRTH4_CORE ? `BRING ${REBIRTH4_CORE - mc} MORE MOLTEN CORE${REBIRTH4_CORE - mc === 1 ? "" : "S"}` : !cashOk ? "NEED " + money(REBIRTH4_COST - save.money) + " MORE" : ferryConfirm ? "CLICK AGAIN TO CONFIRM" : "SAIL TO THE ARCHIPELAGO";
}
function finishRebirth4() {
    save.rebirths = 4; // the Archipelago is Rebirth 4
    resetForRebirth();
    save.boat = { fuel: 100, tank: 0, engine: 0, cans: 1, hull: 0 };
    enterIsle5(); newContract();
    holdingReset();
    player.maxHp = maxHpNow(); player.hp = player.maxHp;
    const a = ARR5.pt(ARR5.LEN - 9, 0);
    player.pos.set(a.x, 1.75, a.z); player.vel.set(0, 0, 0); player.yaw = Math.atan2(ARR5.DIR.x, ARR5.DIR.z); player.pitch = 0;
    player.invuln = 6;
    ride = null;
    writeSave();
    say("");
    setTimeout(() => {
        $("rebirthFx").classList.remove("show"); say("THE ARCHIPELAGO"); setTimeout(() => say(""), 3600);
        toast("You are reborn. ★4  +200% cash, +40% damage, +200 max HP.", "cash");
        toast("Port Haven is home. Your speedboat waits at the harbor: every other island is a boat ride away.", "good");
        toast("Watch the fuel gauge. Run dry out at sea and you lose every material you're carrying.", "bad");
    }, 2200);
}
function drawMap5() {
    const cv = $("mapc"), g = cv.getContext("2d"), S = cv.width, c = S / 2, sc = (S / 2 - 14) / 470;
    if (!mapBg5) {
        const N = 360, oc = document.createElement("canvas"); oc.width = oc.height = N;
        const og = oc.getContext("2d"), img = og.createImageData(N, N), col = new THREE.Color();
        for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
            const x = ((px + 0.5) / N - 0.5) * 940, z = ((py + 0.5) / N - 0.5) * 940, I = archAt(x, z), inside = archIn(I, x, z), i = (py * N + px) * 4;
            if (inside < 0) { const k = clamp(-inside / 40, 0, 1); col.setRGB(lerp(0.3, 0.05, k), lerp(0.75, 0.2, k), lerp(0.8, 0.4, k)); }
            else { const y = archTerrain(I, x, z); if (inside < 8) col.setRGB(0.9, 0.82, 0.6); else if (I.k === "frost") col.setRGB(0.85, 0.92, 1); else if (I.k === "skull") col.setRGB(0.35, 0.32, 0.3); else if (I.k === "storm") col.setRGB(0.42, 0.3, 0.55); else if (I.k === "coral") col.setRGB(0.95, 0.75, 0.75); else col.setRGB(0.3, 0.6, 0.3); col.multiplyScalar(0.85 + clamp(y / 30, 0, 0.3)); }
            img.data[i] = col.r * 255; img.data[i + 1] = col.g * 255; img.data[i + 2] = col.b * 255; img.data[i + 3] = 255;
        }
        og.putImageData(img, 0, 0); mapBg5 = oc;
    }
    g.clearRect(0, 0, S, S);
    g.fillStyle = "#0a1a2a"; g.beginPath(); g.arc(c, c, c - 6, 0, 7); g.fill(); g.strokeStyle = "rgba(120,200,255,.5)"; g.lineWidth = 3; g.stroke();
    g.save(); g.beginPath(); g.arc(c, c, c - 8, 0, 7); g.clip(); g.drawImage(mapBg5, c - 470 * sc, c - 470 * sc, 940 * sc, 940 * sc); g.restore();
    const X = x => c + x * sc, Z = z => c + z * sc;
    g.textAlign = "center"; g.font = "bold 12px Consolas";
    for (const I of ARCH) { g.lineWidth = 3; g.strokeStyle = "#000"; g.strokeText(I.name, X(I.x), Z(I.z) - I.r * sc - 6); g.fillStyle = I.col; g.fillText(I.name, X(I.x), Z(I.z) - I.r * sc - 6); }
    for (const D of DOCKS5) { const e = D.pt(D.LEN); g.strokeStyle = D.kind === "next" ? "#9fe8ff" : "#ffd890"; g.lineWidth = 3; g.beginPath(); g.moveTo(X(D.B.x), Z(D.B.z)); g.lineTo(X(e.x), Z(e.z)); g.stroke(); if (D.kind === "harbor") { const p = pumpAt(D); g.font = "bold 10px Consolas"; g.fillStyle = D.I.pump ? "#ffe070" : "#d8c8a0"; g.fillText(D.I.pump ? "⛽ FUEL" : "🔔 TOW", X(p.x), Z(p.z) + 14); } }
    for (const ch of chests) if (!ch.opened) { g.fillStyle = ch.special ? "#c8a0ff" : "#ffd040"; g.fillRect(X(ch.x) - 3, Z(ch.z) - 3, 6, 6); }
    g.font = "bold 18px Segoe UI Emoji, sans-serif"; g.fillText("⛵", X(B5.x), Z(B5.z) + 6);
    const f = save.boat.fuel / boatMaxFuel(), range = save.boat.fuel / 2.8 * boatTop();
    g.setLineDash([5, 6]); g.strokeStyle = f < 0.2 ? "rgba(255,90,90,.7)" : "rgba(160,230,255,.45)"; g.lineWidth = 1.5; g.beginPath(); g.arc(X(B5.x), Z(B5.z), range * sc, 0, 7); g.stroke(); g.setLineDash([]);
    g.font = "bold 11px Consolas"; g.fillStyle = "#cfefff"; g.fillText(`fuel range ~${Math.round(range)}m`, X(B5.x), Z(B5.z) - 10);
    g.fillStyle = "#fff"; g.font = "bold 12px Consolas"; g.fillText("N", c, 22);
    g.save(); g.translate(X(player.pos.x), Z(player.pos.z)); g.rotate(-player.yaw); g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore();
}
// the boat's dashboard (bottom right, while you're driving)
function boatHud() {
    const e = $("boatHud"); if (!e) return;
    e.style.display = B5.on ? "" : "none";
    if (!B5.on) return;
    const f = save.boat.fuel / boatMaxFuel(), kts = Math.abs(B5.speed) * 1.94;
    e.innerHTML = `<small>SPEEDBOAT</small><div class="bspd"><b>${Math.round(kts)}</b> knots</div>
      <div class="bfuel ${f < 0.2 ? "low" : ""}"><span>FUEL</span><div><i style="width:${Math.round(f * 100)}%"></i></div><em>${Math.round(f * 100)}%</em></div>
      <div class="bhint">${save.boat.cans ? `${save.boat.cans} spare can${save.boat.cans === 1 ? "" : "s"} · ` : ""}W/S throttle · A/D steer · Shift boost · F out by land</div>`;
}
const SMITH5_SAY = ["Salt in the steel keeps it hungry.", "Stormglass hums when lightning's near. Don't hold it in the rain.", "Pearls polish an edge like nothing else.", "Bring me tar and I'll make you something that floats AND cuts."];
const DEPOT5_SAY = ["Driftwood by the ton, pearls by the one. I buy it all.", "Stormglass? You went out THAT far? Name your price.", "Coral's up today. The tourists love it."];

// =====================================================================
//  1.6.1: axe abilities. Every axe has its own special move on [Z]
// =====================================================================
const ABIL = [
    { name: "Heavy Chop", cd: 7, mult: 3, col: 0xffe0a0, desc: "One huge overhead chop on the tree in front of you (3x damage)." },
    { name: "Cleave", cd: 8, mult: 2, col: 0xd8e4ff, desc: "A wide sweep that hits every tree in front of you (2x damage)." },
    { name: "Whirlwind", cd: 9, mult: 2.2, col: 0x9fe8ff, desc: "Spin and hit every tree around you (2.2x damage)." },
    { name: "Frost Nova", cd: 13, mult: 1.6, col: 0x8fe8ff, desc: "A blast of ice that freezes every tree near you for 4 seconds." },
    { name: "Shadow Step", cd: 10, mult: 3, col: 0xc07aff, desc: "Blink forward through the trees, slashing everything you pass (3x)." },
    { name: "Fire Line", cd: 11, mult: 4, col: 0xff8a2a, desc: "A long slash of fire straight ahead: 4x damage and sets trees burning." },
    { name: "Crescent Wave", cd: 11, mult: 4, col: 0xd8e4ff, desc: "Throws a moonlit wave that cuts every tree in a line (4x, 6x at night)." },
    { name: "Soul Harvest", cd: 13, mult: 3, col: 0x6dffa0, desc: "Rips the souls out of the trees around you (3x) and heals you for each one." },
    { name: "Avalanche", cd: 13, mult: 4, col: 0xbff4ff, desc: "Ice spikes burst out in a cone (4x) and freeze what they hit." },
    { name: "Eruption", cd: 14, mult: 5, col: 0xff6a1a, desc: "Slam the ground: a ring of lava bursts out (5x) and sets trees burning." },
    { name: "Earthsplitter", cd: 14, mult: 6, col: 0xff7aea, desc: "Tears the ground open in a long straight line (6x)." },
    { name: "Starfall", cd: 15, mult: 5, col: 0xe8f0ff, desc: "Stars rain down on up to 6 trees around you (5x each)." },
    { name: "Black Hole", cd: 17, mult: 1.3, col: 0xa070ff, desc: "Opens a vortex that drags trees in and grinds them for 3 seconds." },
    { name: "Thorn Burst", cd: 15, mult: 6, col: 0xff5a8a, desc: "Roots erupt under every tree around you (6x) and hold them still." },
    { name: "Meteor", cd: 16, mult: 10, col: 0xff9a4a, desc: "Calls a meteor down where you're looking (10x in a big blast)." },
    { name: "Cataclysm", cd: 18, mult: 9, col: 0xffd040, desc: "Lava fissures split out in every direction (9x) and burn everything." }
];
const abCd = {}; // cooldown left, per axe
const abFx = []; // live effect objects
const abMat = (c, o = 0.9, add = true) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
const AB_CONE = new THREE.ConeGeometry(0.5, 1, 6), AB_ICO = new THREE.IcosahedronGeometry(0.5, 1), AB_BOX = new THREE.BoxGeometry(1, 1, 1), AB_SHARED = new Set([AB_CONE, AB_ICO, AB_BOX]);
const abPMs = {}, abPM = c => abPMs[c] || (abPMs[c] = abMat(c, 1, false)); // shared particle materials
function abAdd(o, life, upd) { scene.add(o); const f = { o, t: 0, life, upd }; abFx.push(f); return f; }
const abAlive = () => trees.filter(t => !t.gone && !t.dying && !t.burn);
const abIn = {
    circle: (t, x, z, r) => Math.hypot(t.x - x, t.z - z) - t.r < r,
    line(t, x, z, dx, dz, len, w) { const px = t.x - x, pz = t.z - z, al = px * dx + pz * dz; return al > -t.r && al < len + t.r && Math.abs(px * dz - pz * dx) < w + t.r; },
    cone(t, x, z, dx, dz, range, cosA) { const px = t.x - x, pz = t.z - z, d = Math.hypot(px, pz); if (d - t.r > range) return false; return d < t.r + 1.2 || (px * dx + pz * dz) / d > cosA; }
};
// hit one tree with the ability: damage, then freeze / root / burn on top
function abHit(t, mult, o = {}) {
    if (t.gone || t.dying || t.burn) return;
    const dmg = Math.max(1, Math.round(axeDmg() * mult * (t.boss ? 1 + 0.25 * enchLv("bane") : 1)));
    hitTree(t, dmg, false);
    if (t.dying || t.gone) return;
    if (o.stun && !t.boss) { t.stun = Math.max(t.stun || 0, o.stun); t.stunCol = o.stunCol || 0x9fe8ff; t.atk = "idle"; }
    if (o.burn) t.dot = { left: o.burn, tick: 0.25, dmg: Math.max(1, Math.round(axeDmg() * 0.5)) };
    if (o.heal) player.hp = Math.min(player.maxHp, player.hp + Math.max(2, Math.round(player.maxHp * o.heal)));
}
// ---- effect builders ----
function abRing(x, z, col, r1, life, y = 0.15) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), abMat(col, 0.9)); m.rotation.x = -Math.PI / 2; m.position.set(x, groundY(x, z) + y, z);
    abAdd(m, life, f => { const k = f.t / f.life; m.scale.setScalar(0.5 + r1 * Math.sqrt(k)); m.material.opacity = 0.9 * (1 - k); });
}
function abArc(col, start, len, r, life, tilt = 0) { // a slash arc around the player at chest height
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.55, r, 40, 1, start, len), abMat(col, 0.85));
    const g = new THREE.Group(); g.add(m); m.rotation.x = -Math.PI / 2 + tilt;
    g.position.set(player.pos.x, player.pos.y - 0.5, player.pos.z); g.rotation.y = player.yaw + Math.PI / 2;
    abAdd(g, life, f => { const k = f.t / f.life; m.material.opacity = 0.85 * (1 - k); g.scale.setScalar(1 + k * 0.3); });
}
function abSpike(x, z, col, h, life, delay = 0, w = 0.5) { // a cone that bursts up out of the ground, then sinks
    const m = new THREE.Mesh(AB_CONE, abMat(col, 0.95, false)); const gy = groundY(x, z);
    m.position.set(x, gy - h, z); m.scale.set(w, h, w); m.rotation.set((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4);
    abAdd(m, life + delay, f => { const k = Math.max(0, f.t - delay) / life, up = k < 0.15 ? k / 0.15 : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1; m.position.y = gy - h * 0.5 + (up - 0.5) * h; m.visible = f.t >= delay; });
}
// soft additive sprites for fire and glows (they always face you, so fire looks like fire from every angle)
const abTex = (() => {
    const mk = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
    const flame = mk(64, 128, (g, w, h) => {
        const grd = g.createRadialGradient(w / 2, h * 0.72, 2, w / 2, h * 0.6, h * 0.55);
        grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.25, "rgba(255,240,180,.95)"); grd.addColorStop(0.55, "rgba(255,170,60,.6)"); grd.addColorStop(1, "rgba(255,80,0,0)");
        g.fillStyle = grd; g.beginPath(); g.moveTo(w / 2, 2); g.bezierCurveTo(w * 0.95, h * 0.45, w * 0.98, h * 0.9, w / 2, h - 2); g.bezierCurveTo(w * 0.02, h * 0.9, w * 0.05, h * 0.45, w / 2, 2); g.fill();
    });
    const glow = mk(64, 64, (g, w) => { const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.3, "rgba(255,255,255,.55)"); grd.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = grd; g.fillRect(0, 0, w, w); });
    return { flame, glow };
})();
const abSprite = (tex, col, o = 1) => new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: col, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending }));
function abFlame(x, z, col, h, life, delay = 0) { // a flickering tongue of fire, with a hot glow at its root
    const g = new THREE.Group(), gy = groundY(x, z), w = h * (0.5 + Math.random() * 0.15);
    const fl = abSprite(abTex.flame, col), core = abSprite(abTex.flame, 0xfff0c0, 0.8), glow = abSprite(abTex.glow, col, 0.6);
    g.add(glow, fl, core); g.visible = false; g.position.set(x, gy, z);
    const ph = Math.random() * 6;
    abAdd(g, life + delay, f => {
        const k = Math.max(0, f.t - delay) / life; g.visible = f.t >= delay;
        const s = Math.sin(Math.min(1, k * 4) * Math.PI / 2) * (1 - k * k), fk = 0.85 + 0.2 * Math.sin(f.t * 26 + ph) + 0.1 * Math.sin(f.t * 47 + ph * 2);
        fl.scale.set(w * s, h * s * fk, 1); fl.position.y = h * s * fk * 0.45;
        core.scale.set(w * 0.45 * s, h * 0.5 * s * fk, 1); core.position.y = h * 0.25 * s * fk;
        glow.scale.setScalar(w * 2.2 * s); glow.position.y = 0.3;
        fl.material.opacity = 1 - k; core.material.opacity = 0.8 * (1 - k); glow.material.opacity = 0.55 * (1 - k);
        if (Math.random() < 0.15 * (1 - k)) burst(V3(x, gy + h * s * 0.8, z), 1, 1.5, [abPM(col)]);
    });
}
function abOrb(from, to, col, life, size = 0.35, onEnd) { // a glowing ball flying from one point to another
    const m = new THREE.Mesh(AB_ICO, abMat(col, 1)); m.scale.setScalar(size);
    const halo = abSprite(abTex.glow, col, 0.9); halo.scale.setScalar(6); m.add(halo);
    abAdd(m, life, f => { const k = f.t / f.life; m.position.lerpVectors(from, to, k); m.position.y += Math.sin(k * Math.PI) * 1.2; if (Math.random() < 0.5) burst(m.position.clone(), 1, 1, [abPM(col)]); if (f.t + 0.0001 >= f.life && onEnd) onEnd(); });
}
function abBoom(strength = 0.35) { shake = Math.min(0.8, shake + strength); fovKick = 1.4; hitstop = 0.05; }

function useAbility() {
    if (state !== "playing" || panel || ride || fishing.on || boating()) return;
    if (holdingGun()) { toast("Abilities come from axes: switch to an axe first.", "bad"); return; }
    if (inCasino()) { toast("No fighting in the casino.", "bad"); return; }
    if (insideBuilding()) { toast("There's no room for that in here.", "bad"); return; }
    const i = save.equipped, A = ABIL[i];
    if ((abCd[i] || 0) > 0) { sfx(150, 0.1, "square", 0.05, 0.8); return; }
    abCd[i] = A.cd * (1 - 0.06 * enchLv("swift"));
    swing.t = 0; swing.hit = true; // swing the axe, without the normal hit
    camera.getWorldDirection(fwd);
    const fl = Math.hypot(fwd.x, fwd.z) || 1, dx = fwd.x / fl, dz = fwd.z / fl, px = player.pos.x, pz = player.pos.z, all = abAlive();
    let n = 0;
    const hitWhere = (test, o) => { for (const t of all) if (test(t)) { abHit(t, A.mult, o); n++; } };
    switch (i) {
        case 0: { // Heavy Chop
            let best = null, bd = 1e9; for (const t of all) { if (!abIn.cone(t, px, pz, dx, dz, 4.5, 0.6)) continue; const d = Math.hypot(t.x - px, t.z - pz); if (d < bd) { bd = d; best = t; } }
            if (best) { abHit(best, A.mult); n = 1; abRing(best.x, best.z, A.col, 4, 0.45); }
            abArc(A.col, -0.6, 1.2, 3.2, 0.3, 1.2); abBoom(0.4); sfx(90, 0.35, "square", 0.22, 0.3); sfx(400, 0.2, "sawtooth", 0.08, 0.3);
            break;
        }
        case 1: hitWhere(t => abIn.cone(t, px, pz, dx, dz, 5.5, 0.35)); abArc(A.col, -1.1, 2.2, 5, 0.35); abBoom(0.3); sfx(300, 0.25, "sawtooth", 0.1, 0.3); break;
        case 2: hitWhere(t => abIn.circle(t, px, pz, 5.5)); for (let k = 0; k < 3; k++) setTimeout(() => abArc(A.col, 0, Math.PI * 2, 5.2, 0.3), k * 110); abBoom(0.3); sfx(250, 0.4, "sawtooth", 0.09, 2.2); break;
        case 3: hitWhere(t => abIn.circle(t, px, pz, 9), { stun: 4, stunCol: 0x9fe8ff }); abRing(px, pz, A.col, 10, 0.6); abRing(px, pz, 0xffffff, 7, 0.4);
            for (let k = 0; k < 14; k++) { const a = (k / 14) * 6.283, r = 3 + Math.random() * 5; abSpike(px + Math.cos(a) * r, pz + Math.sin(a) * r, 0xbff4ff, 1.2 + Math.random(), 1.2, 0.05 * k / 3, 0.35); }
            abBoom(0.3); sfx(1200, 0.5, "triangle", 0.07, 0.3); sfx(200, 0.4, "sine", 0.1, 0.5); break;
        case 4: { // Shadow Step: a dash forward that slashes through the line
            hitWhere(t => abIn.line(t, px, pz, dx, dz, 10, 1.4));
            player.vel.x += dx * 40; player.vel.z += dz * 40; fovKick = 2.4;
            for (let k = 0; k < 10; k++) { const x = px + dx * k, z = pz + dz * k; burst(V3(x, groundY(x, z) + 1, z), 2, 2, [abPM(A.col)]); }
            sfx(160, 0.3, "sawtooth", 0.08, 3); sfx(700, 0.2, "triangle", 0.05, 0.3); break;
        }
        case 5: { // Fire Line: a wall of fire races forward
            hitWhere(t => abIn.line(t, px, pz, dx, dz, 18, 1.6), { burn: 3 });
            for (let k = 0; k < 26; k++) { const d = 1.5 + k * 0.65, j = (Math.random() - 0.5) * 0.9, x = px + dx * d - dz * j, z = pz + dz * d + dx * j; abFlame(x, z, k % 3 ? 0xff7a1a : 0xffd040, 1.6 + Math.random() * 1.6, 1.1, k * 0.022); }
            abArc(A.col, -0.5, 1.0, 4, 0.3); abBoom(0.35); sfx(120, 0.6, "sawtooth", 0.12, 0.4); sfx(60, 0.7, "square", 0.1, 0.5); break;
        }
        case 6: { // Crescent Wave: a moving blade that cuts what it passes
            const mult = A.mult * (isNight() ? 1.5 : 1), hit = new Set(), g = new THREE.Group();
            const m = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.16, 6, 28, Math.PI), abMat(A.col, 0.95)); m.rotation.x = Math.PI / 2; g.add(m);
            g.position.set(px + dx, player.pos.y - 0.6, pz + dz); g.rotation.y = Math.atan2(dx, dz);
            abAdd(g, 0.9, (f, dt) => {
                g.position.x += dx * 30 * dt; g.position.z += dz * 30 * dt; m.material.opacity = 0.95 * (1 - f.t / f.life);
                for (const t of abAlive()) if (!hit.has(t) && Math.hypot(t.x - g.position.x, t.z - g.position.z) < t.r + 2.2) { hit.add(t); abHit(t, mult); }
            });
            sfx(900, 0.4, "triangle", 0.07, 0.4); sfx(300, 0.3, "sine", 0.08, 0.5); n = 1; break;
        }
        case 7: { // Soul Harvest
            for (const t of all) if (abIn.circle(t, px, pz, 10)) { const from = V3(t.x, t.gy + Math.min(t.h * 0.5, 3), t.z); abHit(t, A.mult, { heal: 0.05 }); abOrb(from, V3(px, player.pos.y - 0.3, pz), A.col, 0.6, 0.3); n++; }
            abRing(px, pz, A.col, 11, 0.6); abBoom(0.25); sfx(220, 0.6, "sine", 0.1, 2); sfx(110, 0.5, "triangle", 0.08, 0.5); break;
        }
        case 8: { // Avalanche: a cone of ice spikes
            hitWhere(t => abIn.cone(t, px, pz, dx, dz, 15, 0.7), { stun: 3, stunCol: 0xbff4ff });
            for (let k = 0; k < 36; k++) { const d = 2 + Math.random() * 13, a = Math.atan2(dx, dz) + (Math.random() - 0.5) * 1.4, x = px + Math.sin(a) * d, z = pz + Math.cos(a) * d; abSpike(x, z, k % 2 ? 0xbff4ff : 0xffffff, 1.5 + Math.random() * 2, 1.4, d * 0.03, 0.45); }
            abBoom(0.35); sfx(1500, 0.5, "triangle", 0.06, 0.25); sfx(150, 0.5, "square", 0.1, 0.4); break;
        }
        case 9: { // Eruption: a ring of lava rushes out from you
            hitWhere(t => abIn.circle(t, px, pz, 10), { burn: 4 });
            abRing(px, pz, 0xff4a0a, 11, 0.7); abRing(px, pz, 0xffd040, 8, 0.5);
            for (let k = 0; k < 24; k++) { const a = (k / 24) * 6.283, r = 4 + (k % 3) * 2.5; abFlame(px + Math.cos(a) * r, pz + Math.sin(a) * r, k % 2 ? 0xff5a0a : 0xffb030, 2 + Math.random() * 1.5, 1.2, r * 0.03); }
            abBoom(0.5); sfx(60, 0.8, "sawtooth", 0.16, 0.4); sfx(40, 0.9, "square", 0.12, 0.5); break;
        }
        case 10: { // Earthsplitter: a glowing crack in the ground, then rock spikes along it
            hitWhere(t => abIn.line(t, px, pz, dx, dz, 26, 1.8));
            const L = 26, crack = new THREE.Mesh(AB_BOX, abMat(A.col, 0.9)); crack.scale.set(0.5, 0.05, L); crack.rotation.y = Math.atan2(dx, dz);
            crack.position.set(px + dx * L / 2, groundY(px + dx * L / 2, pz + dz * L / 2) + 0.06, pz + dz * L / 2);
            abAdd(crack, 1.4, f => { const k = f.t / f.life; crack.scale.x = 0.2 + Math.min(1, k * 5) * 0.9; crack.material.opacity = 0.9 * (1 - k); });
            for (let k = 0; k < 20; k++) { const d = 1.5 + k * 1.25, s = (k % 2 ? 1 : -1) * 0.9, x = px + dx * d - dz * s, z = pz + dz * d + dx * s; abSpike(x, z, 0x5a4a5a, 1.4 + Math.random() * 1.6, 1.3, k * 0.025, 0.7); }
            abBoom(0.55); sfx(50, 0.9, "sawtooth", 0.18, 0.5); sfx(90, 0.6, "square", 0.12, 0.4); break;
        }
        case 11: { // Starfall: stars drop onto the nearest trees
            const tgts = all.filter(t => abIn.circle(t, px, pz, 20)).sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz)).slice(0, 6);
            if (!tgts.length) for (let k = 0; k < 4; k++) tgts.push({ x: px + dx * 6 + (Math.random() - 0.5) * 8, z: pz + dz * 6 + (Math.random() - 0.5) * 8, fake: 1 });
            tgts.forEach((t, k) => { const to = V3(t.x, groundY(t.x, t.z) + 0.5, t.z), from = to.clone().add(V3((Math.random() - 0.5) * 8, 30, (Math.random() - 0.5) * 8));
                setTimeout(() => abOrb(from, to, A.col, 0.45, 0.6, () => { if (!t.fake) abHit(t, A.mult); abRing(t.x, t.z, A.col, 4, 0.4); burst(to, 10, 6, [abPM(0xffffff), abPM(A.col)]); sfx(900 - k * 60, 0.3, "triangle", 0.07, 0.3); shake = Math.min(0.6, shake + 0.15); }), k * 140); });
            n = tgts.length; sfx(1400, 0.6, "sine", 0.05, 0.5); break;
        }
        case 12: { // Black Hole: a vortex in front of you pulls trees in and grinds them
            const cx = px + dx * 8, cz = pz + dz * 8, cy = groundY(cx, cz) + 1.6, g = new THREE.Group(); g.position.set(cx, cy, cz);
            const core = new THREE.Mesh(AB_ICO, new THREE.MeshBasicMaterial({ color: 0x050008 })); core.scale.setScalar(1.6); g.add(core);
            const rings = [0, 1, 2].map(k => { const r = new THREE.Mesh(new THREE.TorusGeometry(2 + k * 0.9, 0.08, 6, 40), abMat(k === 1 ? 0xff7ae8 : A.col, 0.8)); r.rotation.x = Math.PI / 2 + (k - 1) * 0.3; g.add(r); return r; });
            let tick = 0;
            abAdd(g, 3.2, (f, dt) => {
                const k = f.t / f.life; rings.forEach((r, j) => { r.rotation.z += (0.08 + j * 0.04); r.material.opacity = 0.8 * (1 - k * k); }); g.scale.setScalar(Math.min(1, f.t * 4) * (1 - k * k * k));
                for (const t of abAlive()) { if (t.boss) continue; const ox = cx - t.x, oz = cz - t.z, d = Math.hypot(ox, oz); if (d < 13 && d > 1.4) { const s = Math.min(d - 1.4, 5 * dt); t.x += ox / d * s; t.z += oz / d * s; } }
                if ((tick -= dt) <= 0) { tick = 0.5; for (const t of abAlive()) if (abIn.circle(t, cx, cz, 4)) abHit(t, A.mult); }
                if (Math.random() < 0.6) { const a = Math.random() * 6.283, r = 6; burst(V3(cx + Math.cos(a) * r, cy + (Math.random() - 0.5) * 2, cz + Math.sin(a) * r), 1, 1, [abPM(A.col)]); }
            });
            n = 1; sfx(60, 1.5, "sine", 0.18, 0.3); sfx(30, 2, "sawtooth", 0.06, 0.5); break;
        }
        case 13: { // Thorn Burst
            for (const t of all) if (abIn.circle(t, px, pz, 14)) { abHit(t, A.mult, { stun: 3, stunCol: 0xff5a8a }); n++; for (let k = 0; k < 5; k++) { const a = (k / 5) * 6.283, r = t.r + 0.4; abSpike(t.x + Math.cos(a) * r, t.z + Math.sin(a) * r, k % 2 ? 0x2a6a2a : 0x8a1a3a, 2.2 + Math.random(), 1.6, Math.random() * 0.15, 0.35); } }
            for (let k = 0; k < 12; k++) { const a = Math.random() * 6.283, r = 2 + Math.random() * 10; abSpike(px + Math.cos(a) * r, pz + Math.sin(a) * r, 0x2a6a2a, 1 + Math.random(), 1.2, Math.random() * 0.2, 0.3); }
            abRing(px, pz, A.col, 14, 0.6); abBoom(0.35); sfx(180, 0.5, "sawtooth", 0.1, 0.4); sfx(90, 0.6, "square", 0.08, 0.6); break;
        }
        case 14: { // Meteor: lands where you aim (up to 32m away)
            let tx = px + dx * 14, tz = pz + dz * 14;
            if (fwd.y < -0.05) { const d = Math.min(32, (player.pos.y - groundY(px, pz)) / -fwd.y); tx = px + dx * d; tz = pz + dz * d; } else { tx = px + dx * 24; tz = pz + dz * 24; }
            const to = V3(tx, groundY(tx, tz) + 0.4, tz), from = to.clone().add(V3(-dx * 14 + 6, 40, -dz * 14));
            const mark = new THREE.Mesh(new THREE.RingGeometry(6.2, 7, 40), abMat(0xff3a1a, 0.7)); mark.rotation.x = -Math.PI / 2; mark.position.set(tx, to.y - 0.25, tz);
            abAdd(mark, 0.85, f => { mark.material.opacity = 0.4 + 0.4 * Math.sin(f.t * 30); });
            const rock = new THREE.Mesh(AB_ICO, abMat(0xff7a2a, 1)); rock.scale.setScalar(2.2);
            abAdd(rock, 0.85, f => { rock.position.lerpVectors(from, to, Math.pow(f.t / f.life, 1.6)); rock.rotation.x += 0.2; burst(rock.position.clone(), 2, 2, [abPM(0xffd040), abPM(0xff4a0a)]);
                if (f.t + 0.0001 >= f.life) { for (const t of abAlive()) if (abIn.circle(t, tx, tz, 7)) abHit(t, A.mult, { burn: 3 }); abRing(tx, tz, 0xffd040, 9, 0.6); abRing(tx, tz, 0xff3a0a, 12, 0.9);
                    for (let k = 0; k < 14; k++) { const a = (k / 14) * 6.283, r = 2 + Math.random() * 4; abFlame(tx + Math.cos(a) * r, tz + Math.sin(a) * r, k % 2 ? 0xff5a0a : 0xffc040, 2 + Math.random() * 2, 1.3); }
                    burst(to, 24, 9, [abPM(0xffd040), abPM(0xff4a0a), chipMats[0]]); shake = Math.min(0.9, shake + 0.6); sfx(40, 1, "sawtooth", 0.22, 0.4); sfx(70, 0.8, "square", 0.16, 0.3); } });
            n = 1; sfx(300, 0.9, "sawtooth", 0.05, 0.2); break;
        }
        case 15: { // Cataclysm: 8 fissures of lava burst out from you
            for (let s = 0; s < 8; s++) {
                const a = (s / 8) * 6.283 + player.yaw, ux = Math.sin(a), uz = Math.cos(a);
                for (const t of all) if (!t._cata && abIn.line(t, px, pz, ux, uz, 22, 1.8)) { t._cata = 1; abHit(t, A.mult, { burn: 4 }); n++; }
                for (let k = 0; k < 11; k++) { const d = 1.5 + k * 1.9; abFlame(px + ux * d, pz + uz * d, k % 2 ? 0xff4a0a : 0xffd040, 2 + Math.random() * 2.5, 1.3, k * 0.04); }
            }
            for (const t of all) delete t._cata;
            abRing(px, pz, 0xffd040, 16, 0.8); abBoom(0.7); sfx(35, 1.2, "sawtooth", 0.22, 0.4); sfx(55, 1, "square", 0.16, 0.5); break;
        }
    }
    flash = Math.max(flash, 0.25);
}
// per frame: effects, cooldowns, burning and frozen trees
function updateAbilities(dt) {
    for (const k in abCd) if (abCd[k] > 0) abCd[k] = Math.max(0, abCd[k] - dt);
    for (let i = abFx.length - 1; i >= 0; i--) {
        const f = abFx[i]; f.t = Math.min(f.life, f.t + dt);
        try { f.upd(f, dt); } catch (e) { f.t = f.life; }
        if (f.t >= f.life) { scene.remove(f.o); f.o.traverse(o => { if (o.material) o.material.dispose(); if (o.geometry && !AB_SHARED.has(o.geometry)) o.geometry.dispose(); }); abFx.splice(i, 1); }
    }
    for (const t of trees) {
        if (t.gone || t.dying || t.burn) { if (t.dot) t.dot = null; continue; }
        if (t.stun > 0) { t.stun -= dt; if (Math.random() < dt * 8) burst(V3(t.x + (Math.random() - 0.5) * t.r * 2, t.gy + Math.random() * Math.min(t.h, 4), t.z + (Math.random() - 0.5) * t.r * 2), 1, 1, [abPM(t.stunCol || 0x9fe8ff)]); }
        if (t.dot) {
            const d = t.dot; d.left -= dt; d.tick -= dt;
            if (Math.random() < dt * 10) burst(V3(t.x + (Math.random() - 0.5) * t.r * 2, t.gy + Math.random() * Math.min(t.h, 4), t.z + (Math.random() - 0.5) * t.r * 2), 1, 2, [abPM(0xff7a1a), abPM(0xffd040)]);
            if (d.tick <= 0) { d.tick = 0.5; hitTree(t, d.dmg, false); }
            if (d.left <= 0) t.dot = null;
        }
    }
}

// a save that's already on another island starts there (this must run after everything above is defined)
if (save.isle === 5) enterIsle5(); else if (save.isle === 4) enterIsle4(); else if (save.isle === 3) enterIsle3(); else if (save.isle === 2) enterIsle2();
placeEnchTable();
if (save.isle >= 2) save.rebirths = save.isle - 1; // Highland Isle = Rebirth 1, Mooncap Isle = Rebirth 2, Ashfall Isle = Rebirth 3

// ---------- HUD ----------
const el = { hp: $("hpFill"), hpTxt: $("hpTxt"), cash: $("cash"), logs: $("logsN"), zone: $("zone"), prompt: $("prompt"), fps: $("fps"), hot: $("hotbar"), hud: $("hud"), clock: $("clock"), contract: $("contract") };
let hudT = 0, frames = 0, fpsT = 0, lastCash = -1;
const PROMPTS = {
    ...PROMPTS5,
    shop: () => "[F] Talk to the Reaper", ench: () => "[F] Use the Enchanting Table", casino: () => "[F] Enter the Casino", ...CS_PROMPTS, bed: () => (isNight() ? "[F] Sleep until dawn" : "Too bright to sleep. Come back at night"),
    chute: () => (save.logs ? `[F] Send ${save.logs} logs down the chute` : "Bring logs here, then [F]"),
    ferry: () => "[F] Talk to the Ferryman", ferry2: () => "[F] Talk to the Ferryman", relic: n => `[F] Take the Hypergamous Relic (Piece ${n.r.i + 1})`, vein: n => `[F] Mine the ${MATS[n.v.k].name} vein`, smith: () => "[F] Use the Forge",
    depot: () => "[F] Trade at the Trading Post",
    witch: () => (isle === 5 ? "[F] Visit the Sea Witch" : isle === 4 ? "[F] Visit the Alchemist" : "[F] Visit the Apothecary"), ferry3: () => "[F] Talk to the Ferryman", ferry4: () => "[F] Talk to the Ferryman", star: () => "[F] Take the fallen star",
    well: () => (save.wellDay === save.day ? "The Moonwell is still. It refills at dawn" : "[F] Drink from the Moonwell"),
    scope: () => (!isNight() ? "The Observatory: come back at night" : save.scopeDay === save.day ? "You already watched the sky tonight" : "[F] Look through the telescope"),
    fish: n => (n.spot.blocked ? "Face the water to fish" : "[F] Cast your line"),
    chest: n => (n.c.special ? "[F] Open the cursed chest" : "[F] Open chest"), altar: () => (save.altarDay === save.day ? "The altar is quiet today" : "[F] Pray at the altar")
};
function hud(dt) {
    frames++; fpsT += dt;
    if (fpsT >= 0.5) { el.fps.textContent = Math.round(frames / fpsT) + " fps"; el.fps.style.display = settings.fps ? "" : "none"; frames = 0; fpsT = 0; }
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
    if (isle >= 2) { const mh = isleMats().filter(k => save.mats[k] > 0).map(k => `<span class="mp"><img src="${iconURL("m:" + k)}">${save.mats[k]}</span>`).join("") || "nothing yet"; if (el.logs.dataset.h !== mh) { el.logs.innerHTML = mh; el.logs.dataset.h = mh; $("logsLbl").textContent = "MATERIALS"; } }
    else el.logs.textContent = save.logs + (sendVals.length + sending.length ? ` (+${sendVals.length + sending.length} in tube)` : "");
    el.zone.textContent = inCasino() ? "THE CASINO · SAFE" : isle === 5 ? (B5.on ? (save.boat.fuel <= 0 ? "OUT OF FUEL!" : "AT SEA") : inSafe() ? "PORT HAVEN" : ARCH_BY[arch5].name) : isle === 4 ? (inSafe() ? "EMBER CAMP" : crater() ? "THE CRATER" : onLava() ? "LAVA! GET OUT!" : inSprings() ? "HOT SPRINGS" : "THE ASHLANDS") : inSafe() ? (isle === 3 ? "LANTERN CAMP" : isle === 2 ? "BASECAMP" : "SAFE ZONE") : (isle === 3 ? (inHollow() ? "THE HOLLOW" : "THE MOONCAP WILDS") : isle === 2 ? "THE HIGHLANDS" : "THE WOODS");
    { // active potions and blessings, with time left
        const bh = Object.keys(BUFFS).filter(buffOn).map(k => `<span style="color:${BUFFS[k].col};border-color:${BUFFS[k].col}">${BUFFS[k].icon} ${BUFFS[k].name} ${mmss(buffLeft(k))}</span>`).join("") + (save.phoenix > 0 ? `<span style="color:#ffb060;border-color:#ffb060">🔥 PHOENIX ×${save.phoenix}</span>` : "");
        const be = $("buffs"); if (be.dataset.h !== bh) { be.innerHTML = bh; be.dataset.h = bh; }
    }
    el.zone.className = inSafe() ? "safe" : "danger";
    el.clock.textContent = (isBlood() ? "🩸 BLOOD MOON " : isNight() ? "🌙 " : "☀ ") + fmtClock() + " · DAY " + save.day + "  " + WX_ICON[wx.type] + (save.rebirths ? "  ★" + save.rebirths : "");
    el.clock.classList.toggle("blood", isBlood());
    const k = save.contract;
    el.contract.innerHTML = k ? `<b>CONTRACT</b> <i>${money(k.reward)}</i><br>${k.text} — ${Math.min(k.prog, k.goal)}/${k.goal}` : "";
    el.contract.style.display = k ? "" : "none";
    const n = panel ? null : nearest();
    const pr = ride ? "" : fishing.on ? fishPrompt() : n && PROMPTS[n.k] ? PROMPTS[n.k](n) : "";
    el.prompt.textContent = pr;
    el.prompt.classList.toggle("show", !!pr);
    el.prompt.classList.toggle("alert", fishing.on && fishing.phase === "bite");
    ensureHotbar();
    const hot = save.hotbar.map((id, slot) => {
        if (!id) return `<div class="slot empty"><span class="k">${slot + 1}</span></div>`;
        const sel = wEquipped(id), dm = id[0] === "a" ? axeDmgFor(+id.slice(1)) : gunDmg(+id.slice(1));
        const en = id[0] === "a" ? enchTotal(+id.slice(1)) : 0;
        return `<div class="slot ${sel ? "sel" : ""}${en ? " ench" : ""}" style="--c:${wCol(id)}"><span class="k">${slot + 1}</span>${en ? `<span class="ebadge">✦${en}</span>` : ""}<img class="ic" src="${iconURL(id)}"><span class="nm">${wName(id)}</span><span class="ct">${dm} dmg</span>${sel ? '<span class="eqtag">EQUIPPED</span>' : ""}</div>`;
    }).join("");
    { const am = holdingGun() ? gunAm(save.gunEq) : null, ae = $("ammo"); ae.style.display = am ? "" : "none"; if (am) ae.innerHTML = `<small>${GUNS[save.gunEq].name.toUpperCase()}</small><b>${am.mag}</b> / ${am.res}${reloading ? "<em>RELOADING</em>" : am.mag === 0 && am.res === 0 ? "<em>NO AMMO</em>" : ""}`; }
    if (el.hot.dataset.h !== hot) { el.hot.innerHTML = hot; el.hot.dataset.h = hot; }
    { // the equipped axe's ability, with its cooldown
        const ae = $("ability"), on = !holdingGun() && !boating();
        ae.style.display = on ? "flex" : "none";
        if (on) {
            const i = save.equipped, A = ABIL[i], cd = abCd[i] || 0, full = A.cd * (1 - 0.06 * enchLv("swift"));
            if (ae.dataset.i !== String(i)) { ae.dataset.i = i; ae.style.setProperty("--c", AXES[i].rarity); ae.innerHTML = `<div class="ic"><img src="${iconURL("a" + i)}"><div class="cdw"></div><kbd>Z</kbd></div><div class="tx"><b>${A.name}</b><small>${A.desc}</small></div>`; }
            const w = ae.querySelector(".cdw"); w.style.setProperty("--p", (cd > 0 ? (cd / full) * 100 : 0) + "%"); w.textContent = cd > 0 ? Math.ceil(cd) : "";
            ae.classList.toggle("ready", cd <= 0);
        }
    }
    boatHud();
    { const en = !holdingGun() && enchTotal(save.equipped) ? "✦ " + enchShort(save.equipped) + " ✦" : "", e = $("enchLine"); if (e.textContent !== en) e.textContent = en; e.style.display = en ? "" : "none"; }
    if (panel === "inv") renderInv();
    if (panel === "shop") renderShop();
    if (panel === "ench") renderEnch();
    if (panel === "map") drawMap();
    if (panel === "ferry") renderFerry();
}
const axeDmgFor = i => { const a = AXES[i]; return Math.round(a.dmg * (a.night && isNight() ? a.night : 1) * (1 + 0.1 * (save.rebirths || 0)) * (1 + 0.1 * (save.whetLvl || 0)) * (1 + 0.12 * enchLv("sharp", i)) * dmgBuff()); };

// ---------- loop ----------
let last = performance.now();
// one bad frame shouldn't freeze the whole game: report it and keep going
let frameErrs = 0;
function frame(now) {
    try { frameBody(now); }
    catch (e) { console.error(e); if (frameErrs++ < 3) toast("Something broke: " + e.message + " (the game kept running)", "bad"); }
    requestAnimationFrame(frame);
}
function frameBody(now) {
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
        updateWorldAnim(real); updateIsle2Anim(real); updateIsle3(real, true); updateIsle4(real, true); updateIsle5(real, true); updateWeather(real); updateEcosystem(real);
        applySky();
    }
    camera.updateMatrixWorld();
    updateLabels();
    if (state === "playing" && panel !== "inv" && panel !== "map") updateNameplates(); else hidePlates();
    if (panel === "talk") updateTalk(real);
    hud(real);
    lightsFrame();
    if (FX) { gfxFrame(real); FX.render(state === "playing" || state === "paused" || state === "dead"); return; }
    renderer.clear();
    renderer.render(scene, camera);
    if (state === "playing" || state === "paused" || state === "dead") {
        renderer.clearDepth();
        renderer.render(viewScene, viewCam);
    }
}

player.maxHp = maxHpNow(); player.hp = player.maxHp;
renderMenu();
applySky();
requestAnimationFrame(frame);
$("gfxPick").classList.remove("show");

// debug/test handle (used by automated checks, harmless in play)
if (DEBUG) window.__ts4 = {
    save, player, trees, camera, renderer, gfx: { GQ, FX, sunL, grass, TSU, MODERN, hemiL, skyDome }, chests, LANDMARKS, enterIsle2, startRebirthRide, groundY, terrain2, GUNS, equipGun, fireGun, startReload, LM2, getIsle: () => isle, getRide: () => ride,
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
    interact, writeSave, doRebirth, enterIsle1, enterIsle2, enterIsle3, enterIsle4, startFight4, fight4, startEruption, getKing: () => king, VOLC, syncKing, startFight, fight: fight3, HOLLOW, dropStar, getBoss: () => boss,
    // the dev panel (dev.js) drives the game through these
    lightPool, vLights, openShop, enterIsle5, B5, ARCH, setArch5, boatEnter, boatExit, loseAtSea, rebirth4Ready, finishRebirth4, getArch: () => arch5, landingSpot, useAbility, ABIL, abCd, CSG, DB, CR, MN, VP, SC, PL, enterCasino, CS, inCasino, getCasino: () => casino, nearest,  spinSlots, bjDeal, spinRoulette, spinWheel, openCasino, get panel() { return panel; }, togglePanel, studio: { scene, animRig, flap2, makers: { deer: makeDeer, rabbit: makeRabbit, squirrel: makeSquirrel, goat: makeGoat, marmot: makeMarmot, eagle: makeEagle, fox: makeFox, shroom: makeShroomling, snail: makeSnail, moth: makeMoth, salamander: makeSalamander, beetle: makeBeetle, crow: makeCrow, bat: makeBat, butterfly: makeButterfly, crab: makeCrab, gull: makeGull, frog: makeFrog, bird: makeBird } }, MUTS, applyMut, mutFelled, get casino() { return casino; }, openEnch, enchTotal, enchTable, ENCH_AT, placeEnchTable, wildBy, buildWild, ENCH, openGift, axeSellValue, MATS, MATS_BY_ISLE, AXES, BUFFS, giveBuff, buffLeft, gainAxe, gunAm, magSize, resCap, applyAxeLook, hitTree, syncBoss, randStarSpot, curLM, toast, maxHpNow,
    FERRYMAN: { x: FERRYMAN.x, z: FERRYMAN.z }, FERRYMAN2: { x: FERRYMAN2.x, z: FERRYMAN2.z }, FERRYMAN3: { x: FERRYMAN3.x, z: FERRYMAN3.z },
    setGod(v) { godMode = !!v; }, getGod: () => godMode, setSpeed(v) { devSpeed = v; }, getSpeed: () => devSpeed,
    freezeSaves() { savesFrozen = true; }, relicObjs, collectRelic, CAVE_MOUTH, veins, MINE_MOUTH, rebirthCost, setWeather, isBlood, fishing, fishSpot, startFishing, fishAction, rollFish, syncGhosts, critters, wx, ghostObjs, hit: tryHit, equip: equipAxe, openPanel, closePanel, spawn: (k, x, z, h = 6) => makeTree(x, z, h, k)
};
// the dev panel only exists when running from source (it isn't packed into the installer)
if (DEBUG) import("./dev.js").catch(e => console.warn("dev panel failed to load:", e));

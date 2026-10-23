// TS4 dev panel: money, materials, items, islands, time, the boss... for testing only.
// game.js loads this only when running from source (npm start), and the installer never includes it.
// Open / close with the ` key (the one under Esc).
const T = window.__ts4;
if (!T) throw new Error("dev.js needs the game's debug handle (run with npm start)");

// ---------- styles ----------
const css = `
#devPanel { position: fixed; top: 0; right: 0; bottom: 0; width: min(430px, 96vw); z-index: 400; display: none; flex-direction: column;
  background: #150d24f2; border-left: 1px solid #ffd04055; box-shadow: -20px 0 60px rgba(0,0,0,.6); color: #e8dcff; font: 14px "Segoe UI", system-ui, sans-serif; user-select: none; }
#devPanel.show { display: flex; }
#devPanel * { box-sizing: border-box; }
.dvHead { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; padding: 16px 18px 10px; }
.dvTitle { white-space: nowrap; font: 900 19px "Segoe UI Black", sans-serif; letter-spacing: 4px; color: #ffd040; text-shadow: 0 3px 0 #5a2a8a; }
.dvStatus { display: flex; align-items: center; gap: 7px; font: 12px Consolas, monospace; opacity: .85; white-space: nowrap; }
.dvDot { width: 9px; height: 9px; border-radius: 50%; background: #6dffa0; box-shadow: 0 0 8px #6dffa0; }
.dvDot.off { background: #ff6a6a; box-shadow: 0 0 8px #ff6a6a; }
.dvX { cursor: pointer; margin-left: 10px; background: rgba(255,90,70,.16); color: #e8dcff; border: 1px solid rgba(255,120,100,.5); border-radius: 7px; padding: 4px 9px; font: 800 12px "Segoe UI"; }
.dvBody { flex: 1; overflow-y: auto; padding: 4px 14px 14px; }
.dvBody::-webkit-scrollbar { width: 8px; } .dvBody::-webkit-scrollbar-thumb { background: #4a3a6a; border-radius: 4px; }
.dvCard { background: #1e1530; border: 1px solid #3a2c55; border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
.dvH { font: 800 11px "Segoe UI"; letter-spacing: 3px; color: #8a7aa8; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
.dvH small { letter-spacing: 0; font-weight: 600; opacity: .8; }
.dvRow { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #261c3a; border-radius: 9px; padding: 7px 8px 7px 12px; margin-bottom: 8px; }
.dvRow label { font-weight: 700; display: flex; align-items: center; gap: 7px; white-space: nowrap; }
.dvSw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.dvIn { width: 170px; background: #0e0818; color: #fff; border: 1px solid #3a2c55; border-radius: 8px; padding: 7px 10px; font: 700 16px Consolas, monospace; text-align: right; outline: none; }
.dvIn:focus { border-color: #ffd040; } .dvIn.dirty { border-color: #ffd040; box-shadow: 0 0 0 1px #ffd04066; }
.dvIn.money { width: 190px; color: #6dffa0; font-size: 18px; }
.dvGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dvGrid .dvRow { margin: 0; padding: 6px 6px 6px 9px; min-width: 0; gap: 6px; } .dvGrid .dvRow label { font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; } .dvGrid .dvIn { width: 78px; flex: none; font-size: 13px; padding: 6px 6px; }
.dvBtns { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 2px; }
.dvB { cursor: pointer; background: #2a2040; color: #e8dcff; border: 1px solid #44365f; border-radius: 8px; padding: 7px 11px; font: 800 12px "Segoe UI"; letter-spacing: .5px; }
.dvB:hover { border-color: #ffd040; color: #ffd040; } .dvB.on { background: #ffd040; color: #1a0e00; border-color: #ffd040; }
.dvB.warn:hover { border-color: #ff6a6a; color: #ff8a7a; }
.dvHint { font: 11px Consolas; opacity: .55; margin-top: 6px; }
.dvSel { background: #0e0818; color: #fff; border: 1px solid #3a2c55; border-radius: 8px; padding: 6px 8px; font: 700 13px "Segoe UI"; flex: 1; }
.dvChip { cursor: pointer; width: 38px; height: 34px; border-radius: 8px; border: 1px dashed #5a4a7a; display: grid; place-items: center; font: 800 13px Consolas; color: #8a7aa8; }
.dvChip.got { border: 1px solid #ffd040; background: #ffd04022; color: #ffd040; }
.dvFoot { display: flex; gap: 10px; padding: 12px 14px; border-top: 1px solid #3a2c55; background: #120a1e; }
.dvFoot .dvB { padding: 12px 14px; } .dvApply { flex: 1; font: 900 15px "Segoe UI" !important; letter-spacing: 5px !important; }
.dvApply:disabled { opacity: .35; cursor: default; color: #8a7aa8 !important; border-color: #44365f !important; }
.dvApply:not(:disabled) { background: linear-gradient(#ffd040, #ffb020); color: #1a0e00; border-color: #ffd040; }
.dvCard.dvAdm { border-color: #ffd04066; background: #221830; }
.dvText { width: 100%; background: #0e0818; color: #fff; border: 1px solid #3a2c55; border-radius: 8px; padding: 8px 10px; font: 14px "Segoe UI"; outline: none; margin-bottom: 7px; user-select: text; }
.dvText:focus { border-color: #ffd040; }
.dvAdRow { display: flex; align-items: center; gap: 6px; background: #261c3a; border-radius: 9px; padding: 6px 8px; margin-bottom: 6px; font-size: 13px; }
.dvAdRow b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .dvAdRow b.adm { color: #ffd040; }
.dvAdRow span { font: 11px Consolas; color: #a89cc4; white-space: nowrap; } .dvAdRow .dvB { padding: 4px 8px; font-size: 11px; }
.dvAdRow b.quick { color: #8adcff; }
.dvAnnN:disabled { opacity: .35; }
`;
document.head.appendChild(Object.assign(document.createElement("style"), { textContent: css }));

// ---------- helpers ----------
const fmt = n => Math.floor(n).toLocaleString("en-US");
// "2.5m", "750k", "1b", "1,000,000", "$40" -> number (NaN if it makes no sense)
function parseAmt(s) {
    const m = String(s).trim().toLowerCase().replace(/[$,\s_]/g, "").match(/^(-?\d*\.?\d+)([kmbt]?)$/);
    if (!m) return NaN;
    return Math.round(parseFloat(m[1]) * { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2]]);
}
const S = () => T.save;
const ISLE_NAMES = { 1: "Pine Island", 2: "Highland Isle", 3: "Mooncap Isle", 4: "Ashfall Isle", 5: "the Archipelago" };
const allMats = () => [...T.MATS_BY_ISLE[2], ...T.MATS_BY_ISLE[3], ...T.MATS_BY_ISLE[4], ...T.MATS_BY_ISLE[5]];
const say = (m, k = "good") => T.toast("[dev] " + m, k);

// ---------- the panel ----------
const el = document.createElement("div");
el.id = "devPanel";
el.innerHTML = `
  <div class="dvHead"><div class="dvTitle">TREESIM4 DEV</div><div class="dvStatus"><span class="dvDot" id="dvDot"></span><span id="dvStat"></span><button class="dvX" data-close id="dvClose">✕</button></div></div>
  <div class="dvBody">
    <div class="dvCard dvAdm">
      <div class="dvH">ADMIN · PUBLIC SERVER <small id="dvAdStat"></small></div>
      <div id="dvAdNoKey" style="display:none"><input class="dvText" id="dvAdKey" type="password" placeholder="Paste your admin key (from admin.key.js on your main PC)" spellcheck="false" autocomplete="off"><div class="dvBtns"><button class="dvB" id="dvAdKeySave">Save key on this PC</button></div></div>
      <div id="dvAdBox">
        <div class="dvBtns" style="margin-bottom:8px"><button class="dvB on" data-annkind="quick">⚡ Quick · whoever's on now</button><button class="dvB" data-annkind="full">📢 Announcement · everyone + menu</button></div>
        <input class="dvText" id="dvAnn" maxlength="200" spellcheck="true" autocomplete="off">
        <div class="dvRow"><label>Stays up</label><span style="display:flex;gap:6px;align-items:center"><input class="dvIn dvAnnN" id="dvAnnN" value="15" style="width:64px;font-size:14px"><select class="dvSel" id="dvAnnU"><option value="1">seconds</option><option value="60">minutes</option><option value="3600">hours</option><option value="86400">days</option><option value="0">until I take it down</option></select></span></div>
        <div class="dvBtns" style="margin-bottom:8px"><button class="dvB" data-anndur="10">10s</button><button class="dvB" data-anndur="30">30s</button><button class="dvB" data-anndur="60">1m</button><button class="dvB" data-anndur="300">5m</button><button class="dvB" data-anndur="3600">1h</button><button class="dvB" data-anndur="86400">1 day</button><button class="dvB" data-anndur="604800">1 week</button><button class="dvB" data-anndur="0">until I take it down</button></div>
        <div class="dvBtns" style="margin-bottom:10px"><button class="dvB on" id="dvAnnGo">Post it</button></div>
        <div class="dvH" style="margin:4px 0 7px">UP NOW <small><button class="dvB warn" id="dvAnnAll" style="padding:3px 8px">take them all down</button></small></div>
        <div id="dvAnnList"></div>
        <input class="dvText" id="dvMotd" maxlength="200" placeholder="Message of the day (empty = the default)" spellcheck="true" autocomplete="off">
        <div class="dvBtns" style="margin-bottom:10px"><button class="dvB" id="dvMotdGo">Set message of the day</button></div>
        <div class="dvH" style="margin:4px 0 7px">PLAYERS <small id="dvAdCount"></small></div>
        <div id="dvAdPlayers"></div>
        <div class="dvH" style="margin:10px 0 7px">BANS <small><button class="dvB warn" id="dvUnbanAll" style="padding:3px 8px">lift every ban</button></small></div>
        <div id="dvAdBans"></div>
        <div class="dvH" style="margin:10px 0 7px">NAMES <small>a name stays with whoever used it for 30 days</small></div>
        <div style="display:flex;gap:6px"><input class="dvText" id="dvFreeName" maxlength="16" placeholder="Free up a name someone's holding..." spellcheck="false" autocomplete="off" style="margin:0"><button class="dvB" id="dvFreeGo">Free it</button></div>
      </div>
      <div class="dvHint">only you have the key: it's in admin.key.js (git ignores it) and on the server as ADMIN_KEY</div>
    </div>
    <div class="dvCard">
      <div class="dvH">CASH</div>
      <div class="dvRow"><label>Money</label><input class="dvIn money" id="dvMoney" spellcheck="false"></div>
      <div class="dvBtns"><button class="dvB" data-add="1e6">+1M</button><button class="dvB" data-add="1e7">+10M</button><button class="dvB" data-add="1e8">+100M</button><button class="dvB" data-set="1e9">Set 1B</button><button class="dvB" data-set="0">Zero</button></div>
      <div class="dvHint">you can type shortcuts like 2.5m, 750k or 1b</div>
    </div>
    <div class="dvCard">
      <div class="dvH">MATERIALS <small><button class="dvB" id="dvMatAll" style="padding:3px 8px">show every island</button></small></div>
      <div class="dvGrid" id="dvMats"></div>
      <div class="dvRow" style="margin-top:10px"><label style="font-weight:600;opacity:.75">Set every material to</label><span style="display:flex;gap:6px"><input class="dvIn" id="dvFillN" value="10000" style="width:90px;font-size:14px"><button class="dvB" id="dvFill">Fill all</button></span></div>
    </div>
    <div class="dvCard">
      <div class="dvH">ITEMS</div>
      <div class="dvGrid">
        <div class="dvRow"><label>🩹 Bandages</label><input class="dvIn" id="dvBand"></div>
        <div class="dvRow"><label>🔥 Phoenix</label><input class="dvIn" id="dvPhoenix"></div>
      </div>
      <div class="dvRow" style="margin-top:8px"><label>Relic pieces</label><span style="display:flex;gap:5px" id="dvRelic"></span></div>
      <div class="dvBtns"><button class="dvB" id="dvAxes">Unlock every axe</button><button class="dvB" id="dvGuns">Every gun + full ammo</button><button class="dvB" id="dvUpg">Max all upgrades</button><button class="dvB" id="dvBuffs">All potion buffs (5 min)</button></div>
    </div>
    <div class="dvCard">
      <div class="dvH">WORLD <small id="dvWorld"></small></div>
      <div class="dvBtns" style="margin-bottom:9px"><button class="dvB" data-isle="1">Pine Island</button><button class="dvB" data-isle="2">Highland Isle</button><button class="dvB" data-isle="3">Mooncap Isle</button><button class="dvB" data-isle="4">Ashfall Isle</button><button class="dvB" data-isle="5">Archipelago</button></div>
      <div class="dvBtns" style="margin-bottom:9px"><button class="dvB" data-hour="6">Dawn</button><button class="dvB" data-hour="12">Noon</button><button class="dvB" data-hour="18.5">Dusk</button><button class="dvB" data-hour="23">Midnight</button><button class="dvB" id="dvBlood">Blood moon now</button></div>
      <div class="dvRow"><label>Day</label><input class="dvIn" id="dvDay" style="width:90px"></div>
      <div class="dvRow"><label>Weather</label><span style="display:flex;gap:5px" id="dvWx"></span></div>
      <div class="dvRow"><label>Go to</label><select class="dvSel" id="dvGoSel"></select><button class="dvB" id="dvGo">Teleport</button></div>
    </div>
    <div class="dvCard">
      <div class="dvH">PLAYER</div>
      <div class="dvBtns"><button class="dvB" id="dvGod">God mode</button><button class="dvB" data-speed="1">Speed ×1</button><button class="dvB" data-speed="2">×2</button><button class="dvB" data-speed="4">×4</button><button class="dvB" id="dvHeal">Heal</button></div>
    </div>
    <div class="dvCard">
      <div class="dvH">MOONCAP ISLE <small id="dvBossTxt"></small></div>
      <div class="dvBtns"><button class="dvB" id="dvToBoss">Go fight the Elder Heart</button><button class="dvB" id="dvBoss10">Boss to 10%</button><button class="dvB warn" id="dvBossKill">Kill boss</button><button class="dvB" id="dvRegrow">Regrow boss</button><button class="dvB" id="dvStar">Drop a star near me</button></div>
    </div>
    <div class="dvCard">
      <div class="dvH">ASHFALL ISLE <small id="dvKingTxt"></small></div>
      <div class="dvBtns"><button class="dvB" id="dvToKing">Go fight the Cinder King</button><button class="dvB" id="dvKing10">King to 10%</button><button class="dvB warn" id="dvKingKill">Kill king</button><button class="dvB" id="dvKingRegrow">Regrow king</button><button class="dvB" id="dvErupt">Erupt now</button></div>
    </div>
    <div class="dvCard">
      <div class="dvH">ARCHIPELAGO <small id="dvArchTxt"></small></div>
      <div class="dvBtns" style="margin-bottom:9px"><button class="dvB" data-harbor="haven">Port Haven</button><button class="dvB" data-harbor="coral">Coral Key</button><button class="dvB" data-harbor="skull">Skull Rock</button><button class="dvB" data-harbor="frost">Frostcap</button><button class="dvB" data-harbor="storm">Storm Isle</button></div>
      <div class="dvBtns" style="margin-bottom:9px"><button class="dvB" id="dvFuel">Fill the tank</button><button class="dvB" id="dvBoatMax">Max the boat</button><button class="dvB" id="dvGhosts">+5 ghost lumberjacks</button><button class="dvB" id="dvCrates">Fill every crew crate</button></div>
      <div class="dvBtns"><button class="dvB" id="dvTMap">Treasure map</button><button class="dvB" id="dvSalv">Salvage near me</button><button class="dvB" id="dvSea">Reset bottles · flags · races</button></div>
      <div class="dvHint">harbor buttons take you and your boat to that island's dock</div>
    </div>
    <div class="dvCard">
      <div class="dvH">REBIRTH RIDES <small>these really rebirth you: snapshot first!</small></div>
      <div class="dvBtns" style="margin-bottom:9px"><button class="dvB" id="dvRide1">Ride: Pine → Highland</button><button class="dvB" id="dvRide2">Ride: Highland → Mooncap</button><button class="dvB" id="dvRide3">Ride: Mooncap → Ashfall</button><button class="dvB" id="dvRide4">Ride: Ashfall → Archipelago</button></div>
      <div class="dvBtns"><button class="dvB" id="dvSnap">Snapshot save</button><button class="dvB warn" id="dvRestore">Restore snapshot</button></div>
      <div class="dvHint" id="dvSnapTxt"></div>
    </div>
  </div>
  <div class="dvFoot"><button class="dvB" id="dvUndo">Undo edits</button><button class="dvB dvApply" id="dvApply" disabled>APPLY</button></div>`;
document.body.appendChild(el);
const $ = id => document.getElementById(id);

// ---------- staged edits (money, materials, items, day) wait for APPLY ----------
let showAllMats = false;
const fields = {}; // id -> { input, read(), write(v), int }
function field(id, read, write) { fields[id] = { input: $(id) || null, read, write }; }
function matKeys() { const i = T.getIsle(); return showAllMats || i === 1 ? allMats() : T.MATS_BY_ISLE[i]; }
function buildMats() {
    const box = $("dvMats");
    for (const k of Object.keys(fields)) if (k.startsWith("dvM_")) delete fields[k];
    box.innerHTML = matKeys().map(k => `<div class="dvRow"><label><span class="dvSw" style="background:${T.MATS[k].col}"></span>${T.MATS[k].name}</label><input class="dvIn" id="dvM_${k}"></div>`).join("");
    for (const k of matKeys()) field("dvM_" + k, () => S().mats[k] || 0, v => { S().mats[k] = v; });
    $("dvMatAll").textContent = showAllMats ? "this island only" : "show every island";
}
field("dvMoney", () => S().money, v => { S().money = v; });
field("dvBand", () => S().bandages, v => { S().bandages = v; });
field("dvPhoenix", () => S().phoenix || 0, v => { S().phoenix = v; });
field("dvDay", () => S().day, v => { S().day = Math.max(1, v); });
let relicDraft = null;
function load() { // fill every field from the live save, throwing away unapplied edits
    buildMats();
    for (const [id, f] of Object.entries(fields)) { f.input = $(id); f.input.value = fmt(f.read()); f.input.classList.remove("dirty"); }
    relicDraft = S().relic.slice();
    drawRelic(); refreshApply();
}
function dirtyFields() { return Object.entries(fields).filter(([, f]) => { const v = parseAmt(f.input.value); return !isNaN(v) && v !== Math.floor(f.read()); }); }
const relicDirty = () => relicDraft && relicDraft.some((v, i) => !!v !== !!S().relic[i]);
function refreshApply() {
    const n = dirtyFields().length + (relicDirty() ? 1 : 0);
    $("dvApply").disabled = !n; $("dvApply").textContent = n ? `APPLY (${n})` : "APPLY";
}
el.addEventListener("input", e => {
    const f = Object.values(fields).find(q => q.input === e.target); if (!f) return;
    const v = parseAmt(e.target.value);
    e.target.classList.toggle("dirty", !isNaN(v) && v !== Math.floor(f.read()));
    e.target.style.color = isNaN(v) && e.target.value.trim() ? "#ff6a6a" : "";
    refreshApply();
});
el.addEventListener("change", e => { const f = Object.values(fields).find(q => q.input === e.target); if (!f) return; const v = parseAmt(e.target.value); if (!isNaN(v)) e.target.value = fmt(v); });
function apply() {
    const changed = dirtyFields();
    for (const [, f] of changed) f.write(Math.max(0, parseAmt(f.input.value)));
    if (relicDirty()) S().relic = relicDraft.slice();
    T.writeSave();
    say(`applied ${changed.length + (relicDirty() ? 1 : 0) || "no"} change${changed.length === 1 ? "" : "s"}`, "cash");
    load();
}
function bump(id, fn) { const f = fields[id], cur = parseAmt(f.input.value); f.input.value = fmt(fn(isNaN(cur) ? f.read() : cur)); f.input.dispatchEvent(new Event("input", { bubbles: true })); }
function drawRelic() { $("dvRelic").innerHTML = relicDraft.map((g, i) => `<span class="dvChip ${g ? "got" : ""}" data-relic="${i}">${i + 1}</span>`).join(""); }

// ---------- live status ----------
function status() {
    const playing = T.state === "playing";
    $("dvDot").classList.toggle("off", !playing);
    const h = T.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    $("dvStat").textContent = `${ISLE_NAMES[T.getIsle()] || T.mp.mpIsleName(T.getIsle())} · day ${S().day} · ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}${playing ? "" : " · " + T.state}`;
    $("dvWorld").textContent = `${T.wx.type}${T.isBlood() ? " · BLOOD MOON" : ""}`;
    for (const b of el.querySelectorAll("[data-isle]")) b.classList.toggle("on", +b.dataset.isle === T.getIsle());
    for (const b of el.querySelectorAll("[data-speed]")) b.classList.toggle("on", +b.dataset.speed === T.getSpeed());
    for (const b of el.querySelectorAll("[data-wx]")) b.classList.toggle("on", b.dataset.wx === T.wx.type);
    $("dvGod").classList.toggle("on", T.getGod());
    const B = T.getBoss(), f = T.fight;
    $("dvBossTxt").textContent = T.getIsle() !== 3 ? "(go to Mooncap Isle)" : f.on ? `FIGHTING · ${fmt(B.hp)} / ${fmt(B.maxHp)} HP · phase ${f.phase}` : S().bossDay === S().day && S().bossKills ? "felled today" : `asleep · felled ${S().bossKills || 0}×`;
    // fields you're not editing follow the live game (money goes up while you play)
    for (const f2 of Object.values(fields)) if (f2.input && document.activeElement !== f2.input && !f2.input.classList.contains("dirty")) { const v = fmt(f2.read()); if (f2.input.value !== v) f2.input.value = v; }
    { const K = T.getKing(), f4 = T.fight4; $("dvKingTxt").textContent = T.getIsle() !== 4 ? "(go to Ashfall Isle)" : f4.on && K ? `FIGHTING · ${fmt(K.hp)} / ${fmt(K.maxHp)} HP · phase ${f4.phase}` : S().kingDay === S().day && S().kingKills ? "felled today" : `asleep · felled ${S().kingKills || 0}×`; }
    $("dvArchTxt").textContent = T.getIsle() !== 5 ? "(go to the Archipelago)" : `on ${T.getArch()} · fuel ${Math.round(S().boat.fuel)} · ghosts ${S().ghosts || 0} (${T.freeGhosts()} free) · bottles ${S().bottles.length}/12${S().tmap ? " · map: " + S().tmap.k : ""}`;
    const snap = localStorage.getItem("ts4_dev_snapshot");
    $("dvSnapTxt").textContent = snap ? "snapshot: " + (JSON.parse(snap).note || "saved") : "no snapshot yet";
}
setInterval(() => { if (el.classList.contains("show")) status(); }, 250);

// the go-to list follows the island you're on
function buildGo() {
    const lm = T.curLM(), i = T.getIsle();
    const opts = [["camp", "Camp / safehouse"], ...lm.filter(l => !l.camp).map(l => [l.name, l.name])];
    if (i === 1) opts.push(["ferry1", "The Ferryman"]); if (i === 2) opts.push(["ferry2", "The Ferryman (north shore)"]);
    $("dvGoSel").innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
}
function teleport(x, z, faceX = 0, faceZ = 0) { T.setPos(x, z, Math.atan2(-(faceX - x), -(faceZ - z)), 0); T.player.vel.set(0, 0, 0); }

// ---------- admin: your own line to the public server (server/worker.js checks the key on every command) ----------
let KEY_FILE = "";
try { KEY_FILE = (await import("./admin.key.js")).default || ""; } catch (e) { /* no admin.key.js on this PC: paste the key instead */ }
const adKey = () => { if (KEY_FILE) return KEY_FILE; try { return localStorage.getItem("ts4_admin_key") || ""; } catch (e) { return ""; } };
// the game sends the key when it joins, so "Tree" (your reserved name) is yours, even in the installed game on this PC
if (KEY_FILE) { T.mp.mp.key = KEY_FILE; try { if (localStorage.getItem("ts4_admin_key") !== KEY_FILE) localStorage.setItem("ts4_admin_key", KEY_FILE); } catch (e) { /* no storage */ } }
const AD = { ws: null, ok: false, err: "", players: [], bans: [], motd: "", anns: [], kind: "quick", tagged: null, armed: "" };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function adOpen() {
    if (!adKey() || (AD.ws && AD.ws.readyState <= 1)) return;
    let ws; try { ws = new WebSocket(T.mp.mpUrl()); } catch (e) { return; }
    AD.ws = ws; AD.err = "";
    ws.onopen = () => adSend("list");
    ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.t === "adminOk") {
            const now = performance.now();
            Object.assign(AD, { ok: true, err: "", players: m.players, bans: m.bans, motd: m.motd, anns: (m.anns || []).map(a => ({ ...a, until: a.left ? now + a.left : 0 })) });
            if (m.text) say(m.text); drawAdmin();
        }
        else if (m.t === "adminErr") { AD.ok = false; AD.err = m.text; say(m.text, "bad"); drawAdmin(); }
    };
    ws.onclose = () => { if (AD.ws === ws) { AD.ws = null; AD.ok = false; drawAdmin(); } };
}
function adSend(op, o = {}) {
    if (AD.ws && AD.ws.readyState === 1) AD.ws.send(JSON.stringify({ t: "admin", key: adKey(), op, ...o }));
    else adOpen();
}
function drawAdmin() {
    const has = !!adKey();
    $("dvAdNoKey").style.display = has ? "none" : ""; $("dvAdBox").style.display = has ? "" : "none";
    $("dvAdStat").textContent = !has ? "no key on this PC" : AD.err ? AD.err : AD.ok ? `connected · ${AD.players.length} online` : AD.ws ? "connecting..." : "offline";
    if (!has) return;
    setHTML("dvAnnList", AD.anns.length ? AD.anns.map(a => `<div class="dvAdRow"><b class="${a.kind === "full" ? "adm" : "quick"}" title="${esc(a.text)}">${a.kind === "full" ? "📢" : "⚡"} ${esc(a.text)}</b><span data-annleft="${esc(a.id)}"></span><button class="dvB warn" data-ad="annDel" data-id="${esc(a.id)}">Take down</button></div>`).join("") : `<div class="dvHint" style="margin:0 0 4px">nothing up right now</div>`);
    $("dvAnnAll").style.display = AD.anns.length > 1 ? "" : "none";
    annLeft();
    $("dvMotd").placeholder = "Message of the day: " + (AD.motd || "the default");
    $("dvAdCount").textContent = AD.players.length ? "" : "nobody's on";
    const me = T.mp.mp, here = T.getIsle();
    setHTML("dvAdPlayers", AD.players.map(p => `<div class="dvAdRow"><b class="${p.admin ? "adm" : ""}">${p.admin ? "[ADMIN] " : ""}${esc(p.name)}${me.on && p.id === me.id ? " (you)" : ""}</b><span>${esc(T.mp.mpIsleName(p.isle))}</span>`
        + (me.on && p.id === me.id ? "" : `<button class="dvB" data-ad="goto" data-id="${esc(p.id)}" ${me.on && p.isle === here ? "" : "disabled style=\"opacity:.35\""}>Go to</button><button class="dvB" data-ad="mute" data-id="${esc(p.id)}">${p.muted ? "Unmute" : "Mute"}</button><button class="dvB warn" data-ad="kick" data-id="${esc(p.id)}">Kick</button><button class="dvB warn" data-ad="ban" data-id="${esc(p.id)}">${AD.armed === p.id ? "Sure?" : "Ban"}</button>`) + `</div>`).join(""));
    setHTML("dvAdBans", AD.bans.length ? AD.bans.map(b => `<div class="dvAdRow"><b>${esc(b.name)}</b><span>${new Date(b.at).toLocaleDateString()}</span><button class="dvB" data-ad="unban" data-k="${esc(b.k)}">Unban</button></div>`).join("") : `<div class="dvHint" style="margin:0 0 4px">no bans</div>`);
    $("dvUnbanAll").style.display = AD.bans.length ? "" : "none";
}
// lists only redraw when they change, so a click never lands on a button that's being replaced
function setHTML(id, h) { const e = $(id); if (e.dataset.h !== h) { e.dataset.h = h; e.innerHTML = h; } }
// how long each announcement has left, counted down every second while the panel is open
const fmtLeft = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return t >= 86400 ? `${Math.floor(t / 86400)}d ${Math.floor(t % 86400 / 3600)}h` : t >= 3600 ? `${Math.floor(t / 3600)}h ${Math.floor(t % 3600 / 60)}m` : t >= 60 ? `${Math.floor(t / 60)}m ${t % 60}s` : `${t}s`; };
function annLeft() {
    const now = performance.now();
    for (const sp of el.querySelectorAll("[data-annleft]")) { const a = AD.anns.find(q => q.id === sp.dataset.annleft); if (a) sp.textContent = a.until ? fmtLeft(a.until - now) : "until you take it down"; }
}
setInterval(() => { if (el.classList.contains("show")) annLeft(); }, 1000);
// quick ones are for whoever's on right now (15 seconds unless you say); full ones reach everyone and the menu (an hour unless you say)
function annKind(kind) {
    AD.kind = kind;
    for (const b of el.querySelectorAll("[data-annkind]")) b.classList.toggle("on", b.dataset.annkind === kind);
    $("dvAnn").placeholder = kind === "full" ? "Announcement for everyone, on the server and the main menu..." : "Quick announcement for whoever's on right now...";
    annDur(kind === "full" ? 3600 : 15);
}
function annDur(secs) {
    const u = !secs ? 0 : secs % 86400 === 0 ? 86400 : secs % 3600 === 0 ? 3600 : secs % 60 === 0 ? 60 : 1;
    $("dvAnnU").value = String(u); if (u) $("dvAnnN").value = secs / u;
    $("dvAnnN").disabled = !u;
}
$("dvAnnU").addEventListener("change", () => { $("dvAnnN").disabled = $("dvAnnU").value === "0"; });
annKind("quick");
function adAction(d, b) {
    if (d.ad === "goto") { const p = AD.players.find(q => q.id === d.id); if (p) { teleport(p.x + 2.5, p.z, p.x, p.z); say("next to " + p.name); } return; }
    if (d.ad === "ban" && AD.armed !== d.id) { AD.armed = d.id; drawAdmin(); setTimeout(() => { if (AD.armed === d.id) { AD.armed = ""; drawAdmin(); } }, 3000); return; }
    AD.armed = "";
    if (d.ad === "unban") adSend("unban", { k: d.k });
    else adSend(d.ad, { id: d.id });
}
// your own player gets [ADMIN] over their head whenever you're on the server
setInterval(() => {
    const M = T.mp.mp;
    if (adKey() && M.on && M.ws && AD.tagged !== M.ws) { AD.tagged = M.ws; T.mp.mpSend({ t: "admin", key: adKey(), op: "tag" }); }
    if (el.classList.contains("show") && AD.ok) adSend("list");
}, 3000);
for (const [id, go] of [["dvFreeName", "dvFreeGo"], ["dvAnn", "dvAnnGo"], ["dvAnnN", "dvAnnGo"], ["dvMotd", "dvMotdGo"], ["dvAdKey", "dvAdKeySave"]]) $(id).addEventListener("keydown", e => { if (e.code === "Enter") { e.preventDefault(); $(go).click(); } });

// ---------- buttons ----------
$("dvWx").innerHTML = ["clear", "cloudy", "rain", "storm", "fog"].map(w => `<button class="dvB" data-wx="${w}" style="padding:5px 8px">${w}</button>`).join("");
el.addEventListener("click", e => {
    const b = e.target.closest("button, [data-relic]"); if (!b) return;
    const d = b.dataset;
    if (d.add) bump("dvMoney", v => v + +d.add);
    else if (d.set !== undefined) bump("dvMoney", () => +d.set);
    else if (d.relic !== undefined) { relicDraft[+d.relic] = relicDraft[+d.relic] ? 0 : 1; drawRelic(); refreshApply(); }
    else if (d.isle) { const n = +d.isle; if (n !== T.getIsle()) { [, T.enterIsle1, T.enterIsle2, T.enterIsle3, T.enterIsle4, T.enterIsle5][n](); S().rebirths = n - 1; teleport(n === 1 ? 0 : 3, n === 1 ? -0.5 : 4); T.writeSave(); say("now on " + ISLE_NAMES[n]); load(); buildGo(); } }
    else if (d.harbor) {
        if (T.getIsle() !== 5) { say("go to the Archipelago first", "bad"); return; }
        const D = T.DOCKS5.find(q => q.I.k === d.harbor && q.kind === "harbor"); T.B5.on = false; T.boatTo(D); T.setArch5(d.harbor, true);
        const p = D.pt(5.5, -0.8); teleport(p.x, p.z, D.pt(D.LEN).x, D.pt(D.LEN).z); say("at " + D.I.name + " harbor");
    }
    else if (d.hour) { T.setClock(+d.hour); say("time set"); }
    else if (d.wx) { T.setWeather(d.wx); }
    else if (d.speed) T.setSpeed(+d.speed);
    else if (d.ad) adAction(d, b);
    else if (d.annkind) annKind(d.annkind);
    else if (d.anndur !== undefined) annDur(+d.anndur);
    else switch (b.id) {
        case "dvClose": show(false); break;
        case "dvAnnGo": {
            const v = $("dvAnn").value.trim(); if (!v) { $("dvAnn").focus(); return; }
            const u = +$("dvAnnU").value, secs = u ? Math.round(parseFloat($("dvAnnN").value) * u) : 0;
            if (u && !(secs >= 3)) { say("say how long it stays up (3 seconds or more)", "bad"); $("dvAnnN").focus(); return; }
            adSend("announce", { text: v, kind: AD.kind, secs }); $("dvAnn").value = ""; break;
        }
        case "dvAnnAll": adSend("annDel", { id: "*" }); break;
        case "dvFreeGo": { const v = $("dvFreeName").value.trim(); if (!v) { $("dvFreeName").focus(); return; } adSend("freeName", { name: v }); $("dvFreeName").value = ""; break; }
        case "dvMotdGo": adSend("motd", { text: $("dvMotd").value.trim() }); $("dvMotd").value = ""; break;
        case "dvUnbanAll": adSend("unban", { k: "*" }); break;
        case "dvAdKeySave": { const v = $("dvAdKey").value.trim(); if (!v) return; try { localStorage.setItem("ts4_admin_key", v); } catch (e) { /* no storage */ } $("dvAdKey").value = ""; adOpen(); drawAdmin(); break; }
        case "dvApply": apply(); break;
        case "dvUndo": load(); say("edits thrown away", ""); break;
        case "dvMatAll": showAllMats = !showAllMats; load(); break;
        case "dvFill": { const v = parseAmt($("dvFillN").value); if (isNaN(v)) return; for (const k of matKeys()) bump("dvM_" + k, () => v); break; }
        case "dvAxes": T.AXES.forEach((a, i) => { if (!S().owned[i]) T.gainAxe(i); }); T.writeSave(); say("every axe unlocked"); break;
        case "dvGuns": T.GUNS.forEach((g, i) => { S().gunOwned[i] = 1; const am = T.gunAm(i); am.mag = T.magSize(i); am.res = T.resCap(i); }); T.writeSave(); say("every gun, full ammo"); break;
        case "dvUpg": Object.assign(S(), { hpLvl: 5, bootLvl: 4, oilLvl: 3, vestLvl: 4, magLvl: 3, whetLvl: 5, powderLvl: 5, magnetLvl: 3, rodLvl: 3 }); T.player.maxHp = T.maxHpNow(); T.player.hp = T.player.maxHp; T.writeSave(); say("every upgrade maxed"); break;
        case "dvBuffs": for (const k of Object.keys(T.BUFFS)) T.giveBuff(k, 300); say("every buff for 5 min"); break;
        case "dvBlood": { const s = S(); if (s.day % 3) s.day += 3 - (s.day % 3); T.setClock(22); load(); say("blood moon rising", "bad"); break; }
        case "dvGo": {
            const v = $("dvGoSel").value, i = T.getIsle();
            if (v === "camp") teleport(i === 1 ? 0 : 3, i === 1 ? -0.5 : 4);
            else if (v === "ferry1") teleport(T.FERRYMAN.x - 2, T.FERRYMAN.z, T.FERRYMAN.x, T.FERRYMAN.z);
            else if (v === "ferry2") teleport(T.FERRYMAN2.x, T.FERRYMAN2.z - 2.5, T.FERRYMAN2.x, T.FERRYMAN2.z);
            else { const lm = T.curLM().find(l => l.name === v), dd = Math.hypot(lm.x, lm.z) || 1, off = lm.r + 3; teleport(lm.x - lm.x / dd * off, lm.z - lm.z / dd * off, lm.x, lm.z); }
            break;
        }
        case "dvGod": T.setGod(!T.getGod()); say("god mode " + (T.getGod() ? "ON" : "off")); break;
        case "dvHeal": T.player.hp = T.player.maxHp; break;
        case "dvToBoss": {
            if (T.getIsle() !== 3) { say("go to Mooncap Isle first", "bad"); return; }
            if (S().bossDay === S().day && S().bossKills) { S().bossDay = 0; T.syncBoss(); }
            const H = T.HOLLOW; teleport(H.x + (0 - H.x) / Math.hypot(H.x, H.z) * 12, H.z + (0 - H.z) / Math.hypot(H.x, H.z) * 12, H.x, H.z);
            T.togglePanel("dev"); break;
        }
        case "dvBoss10": { const B = T.getBoss(); if (!T.fight.on) { say("start the fight first", "bad"); return; } B.hp = Math.ceil(B.maxHp * 0.1); break; }
        case "dvBossKill": { const B = T.getBoss(); if (!T.fight.on) { say("start the fight first", "bad"); return; } B.hp = 1; T.hitTree(B, 1, false); break; }
        case "dvRegrow": S().bossDay = 0; T.syncBoss(); say("the Elder Heart regrew"); break;
        case "dvStar": { if (T.getIsle() !== 3) { say("stars only fall on Mooncap Isle", "bad"); return; } const p = T.randStarSpot(T.player.pos.x, T.player.pos.z, 10, 22); T.dropStar(p.x, p.z); break; }
        case "dvRide1": {
            if (T.getIsle() !== 1) T.enterIsle1();
            S().money = Math.max(S().money, T.rebirthCost()); teleport(T.FERRYMAN.x - 2, T.FERRYMAN.z, T.FERRYMAN.x, T.FERRYMAN.z);
            T.togglePanel("dev"); setTimeout(() => T.startRebirthRide(1), 400); break;
        }
        case "dvRide2": {
            if (T.getIsle() !== 2) T.enterIsle2();
            S().relic = [1, 1, 1, 1, 1, 1]; S().money = Math.max(S().money, 2500000); teleport(T.FERRYMAN2.x, T.FERRYMAN2.z - 2.5, T.FERRYMAN2.x, T.FERRYMAN2.z);
            T.togglePanel("dev"); setTimeout(() => T.startRebirthRide(2), 400); break;
        }
        case "dvToKing": {
            if (T.getIsle() !== 4) { say("go to Ashfall Isle first", "bad"); return; }
            if (S().kingDay === S().day && S().kingKills) { S().kingDay = 0; T.syncKing(); }
            const V = T.VOLC, dd = Math.hypot(V.x, V.z); teleport(V.x - V.x / dd * 9, V.z - V.z / dd * 9, V.x, V.z);
            T.togglePanel("dev"); break;
        }
        case "dvKing10": { const K = T.getKing(); if (!T.fight4.on) { say("start the fight first", "bad"); return; } K.hp = Math.ceil(K.maxHp * 0.1); break; }
        case "dvKingKill": { const K = T.getKing(); if (!T.fight4.on) { say("start the fight first", "bad"); return; } K.hp = 1; T.hitTree(K, 1, false); break; }
        case "dvKingRegrow": S().kingDay = 0; T.syncKing(); say("the Cinder King rekindled"); break;
        case "dvErupt": if (T.getIsle() !== 4) { say("eruptions only happen on Ashfall Isle", "bad"); return; } T.startEruption(); T.togglePanel("dev"); break;
        case "dvRide3": {
            if (T.getIsle() !== 3) T.enterIsle3();
            S().bossKills = Math.max(1, S().bossKills || 0); S().mats.heartwood = Math.max(5, S().mats.heartwood || 0); S().money = Math.max(S().money, 25000000);
            teleport(T.FERRYMAN3.x, T.FERRYMAN3.z - 2.5, T.FERRYMAN3.x, T.FERRYMAN3.z);
            T.togglePanel("dev"); setTimeout(() => T.startRebirthRide(3), 400); break;
        }
        case "dvFuel": S().boat.fuel = 100 * (1 + 0.45 * (S().boat.tank || 0)); say("tank full"); break;
        case "dvBoatMax": Object.assign(S().boat, { tank: 5, engine: 5, cans: 3 }); S().boat.fuel = 100 * (1 + 0.45 * 5); T.writeSave(); say("biggest tank, fastest engine, three spare cans"); break;
        case "dvGhosts": S().ghosts = (S().ghosts || 0) + 5; T.syncGhosts(); T.writeSave(); say(`${S().ghosts} ghost lumberjacks`); break;
        case "dvCrates": for (const k of ["haven", "coral", "skull", "frost", "storm"]) S().crate[k] = { [{ haven: "driftwood", coral: "coral", skull: "tar", frost: "iceshard", storm: "stormglass" }[k]]: 150 }; say("every crate full"); break;
        case "dvTMap": if (T.getIsle() !== 5) { say("go to the Archipelago first", "bad"); return; } S().tmap = null; T.newTreasureMap("dev"); say("treasure map: " + S().tmap.k); break;
        case "dvSalv": if (T.getIsle() !== 5) { say("go to the Archipelago first", "bad"); return; } for (let i = 0; i < 4; i++) T.spawnSalvage(); say("salvage is floating nearby (check the map)"); break;
        case "dvSea": Object.assign(S(), { bottles: [], summits: {}, races: {}, medals: {}, bessGot: 0, tdug: 0, salvaged: 0 }); T.writeSave(); say("bottles, flags and races reset (reload to see bottles again)"); break;
        case "dvRide4": {
            if (T.getIsle() !== 4) T.enterIsle4();
            S().kingKills = Math.max(1, S().kingKills || 0); S().mats.molten = Math.max(2, S().mats.molten || 0); S().money = Math.max(S().money, 5000000);
            teleport(T.FERRYMAN4.x, T.FERRYMAN4.z - 2.5, T.FERRYMAN4.x, T.FERRYMAN4.z);
            T.togglePanel("dev"); setTimeout(() => T.startRebirthRide(4), 400); break;
        }
        case "dvSnap": T.writeSave(); localStorage.setItem("ts4_dev_snapshot", JSON.stringify({ note: `${ISLE_NAMES[T.getIsle()]}, day ${S().day}, $${fmt(S().money)} · ${new Date().toLocaleTimeString()}`, save: localStorage.getItem("ts4_save_v1") })); say("snapshot saved"); break;
        case "dvRestore": {
            const snap = localStorage.getItem("ts4_dev_snapshot"); if (!snap) { say("no snapshot yet", "bad"); return; }
            if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Click again to restore"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Restore snapshot"; }, 3000); return; }
            T.freezeSaves(); localStorage.setItem("ts4_save_v1", JSON.parse(snap).save); location.reload(); break;
        }
    }
    if (el.classList.contains("show")) status();
});

// ---------- open / close (the game calls show() from its panel system) ----------
function show(on) {
    const was = el.classList.contains("show");
    el.classList.toggle("show", !!on);
    if (on && !was) { load(); buildGo(); status(); adOpen(); drawAdmin(); }
    if (!on && was && AD.ws) { const w = AD.ws; AD.ws = null; AD.ok = false; try { w.close(1000, "panel closed"); } catch (e) { /* gone */ } }
}
window.__ts4dev = { show, toggle() { show(!el.classList.contains("show")); } };
if (T.panel === "dev") show(true);

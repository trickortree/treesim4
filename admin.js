// Tree Sim 4 admin card for the public server: announcements, the message of the day, players (go to, mute, kick, ban), bans,
// names, and Tree on 2 PCs. Only Tree can use it:
//  - on the PC with the admin key (admin.key.js, which git ignores), the dev panel shows it and it talks to the server on its
//    own line, sending the key with every command;
//  - on your other Tree PC (the one that got in with the Tree password), ` opens it in the installed game and it talks over
//    the game's own connection, which the server already knows is you.
// The game hands it what it needs with setup(G); see loadAdmin() in game.js.
const CSS = `
#adminPanel { position: fixed; top: 0; right: 0; bottom: 0; width: min(430px, 96vw); z-index: 400; display: none; flex-direction: column;
  background: #150d24f2; border-left: 1px solid #ffd04055; box-shadow: -20px 0 60px rgba(0,0,0,.6); }
#adminPanel.show { display: flex; }
#adminPanel .adHead { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 6px; font: 900 18px "Segoe UI Black", sans-serif; letter-spacing: 4px; color: #ffd040; text-shadow: 0 3px 0 #5a2a8a; }
#adminPanel .adBody { flex: 1; overflow-y: auto; padding: 6px 14px 14px; }
.adCard { color: #e8dcff; font: 14px "Segoe UI", system-ui, sans-serif; user-select: none; }
.adCard * { box-sizing: border-box; }
.adTop { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; font: 800 11px "Segoe UI"; letter-spacing: 3px; color: #ffd040; }
.adTop small, .adH small { letter-spacing: 0; font-weight: 600; color: #a89cc4; }
.adH { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 12px 0 7px; font: 800 11px "Segoe UI"; letter-spacing: 3px; color: #8a7aa8; }
.adB { cursor: pointer; background: #2a2040; color: #e8dcff; border: 1px solid #44365f; border-radius: 8px; padding: 7px 11px; font: 800 12px "Segoe UI"; letter-spacing: .5px; }
.adB:hover { border-color: #ffd040; color: #ffd040; } .adB.on { background: #ffd040; color: #1a0e00; border-color: #ffd040; }
.adB.warn:hover { border-color: #ff6a6a; color: #ff8a7a; } .adB:disabled { opacity: .35; cursor: default; }
.adX { background: rgba(255,90,70,.16); border-color: rgba(255,120,100,.5); padding: 4px 9px; }
.adBtns { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 8px; }
.adText { width: 100%; background: #0e0818; color: #fff; border: 1px solid #3a2c55; border-radius: 8px; padding: 8px 10px; font: 14px "Segoe UI"; outline: none; margin-bottom: 7px; user-select: text; }
.adText:focus, .adN:focus { border-color: #ffd040; }
.adPair { display: flex; gap: 6px; margin-bottom: 7px; } .adPair .adText { margin: 0; } .adPair .adB { white-space: nowrap; }
.adDur { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; background: #261c3a; border-radius: 9px; padding: 6px 8px 6px 12px; }
.adDur label { flex: 1; font-weight: 700; }
.adN { width: 64px; background: #0e0818; color: #fff; border: 1px solid #3a2c55; border-radius: 8px; padding: 6px 8px; font: 700 14px Consolas, monospace; text-align: right; outline: none; }
.adN:disabled { opacity: .35; }
.adSel { background: #0e0818; color: #fff; border: 1px solid #3a2c55; border-radius: 8px; padding: 6px 8px; font: 700 13px "Segoe UI"; }
.adRow { display: flex; align-items: center; gap: 6px; background: #261c3a; border-radius: 9px; padding: 6px 8px; margin-bottom: 6px; font-size: 13px; }
.adRow b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .adRow b.adm { color: #ffd040; } .adRow b.quick { color: #8adcff; }
.adRow span { font: 11px Consolas, monospace; color: #a89cc4; white-space: nowrap; } .adRow .adB { padding: 4px 8px; font-size: 11px; }
.adHint { font: 11px Consolas, monospace; color: #a89cc4; margin: 0 0 6px; }
`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtLeft = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return t >= 86400 ? `${Math.floor(t / 86400)}d ${Math.floor(t % 86400 / 3600)}h` : t >= 3600 ? `${Math.floor(t / 3600)}h ${Math.floor(t % 3600 / 60)}m` : t >= 60 ? `${Math.floor(t / 60)}m ${t % 60}s` : `${t}s`; };

let G = null, box = null, isOpen = () => false, panelEl = null;
const AD = { ws: null, ok: false, err: "", players: [], bans: [], motd: "", anns: [], tree: null, myK: "", kind: "quick", armed: "" };
const q = id => box.querySelector("#" + id);
// the game's part: { mp, mpSend, mpUrl, mpIsleName, isle(), goTo(x, z, faceX, faceZ), say(text, kind), key() }
export function setup(game) { G = game; }

// ---------- talking to the server ----------
const key = () => (G && G.key()) || "";
const viaGame = () => !key() && G.mp.on && G.mp.admin; // a Tree PC without the key: the game's own connection is already you
function adOpen() {
    if (!key()) { AD.ok = viaGame(); if (AD.ok) adSend("list"); return; }
    if (AD.ws && AD.ws.readyState <= 1) return;
    let ws; try { ws = new WebSocket(G.mpUrl()); } catch (e) { return; }
    AD.ws = ws; AD.err = "";
    ws.onopen = () => adSend("list");
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onMsg(m); };
    ws.onclose = () => { if (AD.ws === ws) { AD.ws = null; AD.ok = false; draw(); } };
}
function adClose() { if (AD.ws) { const w = AD.ws; AD.ws = null; AD.ok = false; try { w.close(1000, "panel closed"); } catch (e) { /* gone */ } } }
function adSend(op, o = {}) {
    if (key()) { if (AD.ws && AD.ws.readyState === 1) AD.ws.send(JSON.stringify({ t: "admin", key: key(), op, ...o })); else adOpen(); return; }
    if (viaGame()) G.mpSend({ t: "admin", op, ...o });
    else { AD.ok = false; draw(); }
}
// the server's answers (from this card's own line, or passed on by the game from its connection)
export function onMsg(m) {
    if (m.t === "adminOk") {
        const now = performance.now();
        Object.assign(AD, { ok: true, err: "", players: m.players, bans: m.bans, motd: m.motd, tree: m.tree || null, anns: (m.anns || []).map(a => ({ ...a, until: a.left ? now + a.left : 0 })) });
        if (m.text) G.say(m.text);
        draw();
        myPcK().then(k => { if (k !== AD.myK) { AD.myK = k; draw(); } });
    } else if (m.t === "adminErr") { AD.ok = false; AD.err = m.text; G.say(m.text, "bad"); draw(); }
}
// this PC's id as the server shows it (the end of a hash of the game's token), so its Tree slot can say "this PC"
async function myPcK() {
    try {
        const t = localStorage.getItem("ts4_mp_tok"); if (!t) return "";
        const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
        return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("").slice(-4);
    } catch (e) { return ""; }
}

// ---------- the card ----------
const HTML = `
  <div class="adTop">ADMIN · PUBLIC SERVER <small id="adStat"></small></div>
  <div id="adNoKey" style="display:none">
    <div class="adHint">Join the server as Tree to use this, or paste your admin key (from admin.key.js on your main PC).</div>
    <div class="adPair"><input class="adText" id="adKey" type="password" placeholder="Admin key" spellcheck="false" autocomplete="off"><button class="adB" id="adKeySave">Save key</button></div>
  </div>
  <div id="adBox">
    <div class="adBtns"><button class="adB on" data-annkind="quick">⚡ Quick · whoever's on now</button><button class="adB" data-annkind="full">📢 Announcement · everyone + menu</button></div>
    <input class="adText" id="adAnn" maxlength="200" spellcheck="true" autocomplete="off">
    <div class="adDur"><label>Stays up</label><input class="adN" id="adAnnN" value="15"><select class="adSel" id="adAnnU"><option value="1">seconds</option><option value="60">minutes</option><option value="3600">hours</option><option value="86400">days</option><option value="0">until I take it down</option></select></div>
    <div class="adBtns"><button class="adB" data-anndur="10">10s</button><button class="adB" data-anndur="30">30s</button><button class="adB" data-anndur="60">1m</button><button class="adB" data-anndur="300">5m</button><button class="adB" data-anndur="3600">1h</button><button class="adB" data-anndur="86400">1 day</button><button class="adB" data-anndur="604800">1 week</button><button class="adB" data-anndur="0">until I take it down</button></div>
    <div class="adBtns"><button class="adB on" id="adAnnGo">Post it</button></div>
    <div class="adH">UP NOW <button class="adB warn" id="adAnnAll" style="padding:3px 8px">take them all down</button></div>
    <div id="adAnnList"></div>
    <div class="adH">MESSAGE OF THE DAY</div>
    <div class="adPair"><input class="adText" id="adMotd" maxlength="200" spellcheck="true" autocomplete="off"><button class="adB" id="adMotdGo">Set</button></div>
    <div class="adH">PLAYERS <small id="adCount"></small></div>
    <div id="adPlayers"></div>
    <div class="adH">BANS <button class="adB warn" id="adUnbanAll" style="padding:3px 8px">lift every ban</button></div>
    <div id="adBans"></div>
    <div class="adH">NAMES <small>a name stays with whoever used it for 30 days</small></div>
    <div class="adPair"><input class="adText" id="adFreeName" maxlength="16" placeholder="Free up a name someone's holding..." spellcheck="false" autocomplete="off"><button class="adB" id="adFreeGo">Free it</button></div>
    <div class="adH">TREE ON 2 PCS <small id="adTreeInfo"></small></div>
    <div class="adPair"><input class="adText" id="adTreePass" type="password" maxlength="64" placeholder="Tree password for your other PC (6+ characters)" autocomplete="off"><button class="adB" id="adTreePassGo">Set</button></div>
    <div id="adTreeDevs"></div>
  </div>`;

// lists only redraw when they change, so a click never lands on a button that's being replaced
function setHTML(id, h) { const e = q(id); if (e.dataset.h !== h) { e.dataset.h = h; e.innerHTML = h; } }
function draw() {
    if (!box) return;
    const can = !!key() || viaGame();
    q("adNoKey").style.display = can ? "none" : ""; q("adBox").style.display = can ? "" : "none";
    q("adStat").textContent = !can ? "not Tree on this PC" : AD.err ? AD.err : AD.ok ? `connected · ${AD.players.length} online` : AD.ws ? "connecting..." : "offline";
    if (!can) return;
    setHTML("adAnnList", AD.anns.length ? AD.anns.map(a => `<div class="adRow"><b class="${a.kind === "full" ? "adm" : "quick"}" title="${esc(a.text)}">${a.kind === "full" ? "📢" : "⚡"} ${esc(a.text)}</b><span data-annleft="${esc(a.id)}"></span><button class="adB warn" data-ad="annDel" data-id="${esc(a.id)}">Take down</button></div>`).join("") : `<div class="adHint">nothing up right now</div>`);
    q("adAnnAll").style.display = AD.anns.length > 1 ? "" : "none";
    annLeft();
    q("adMotd").placeholder = AD.motd || "the default greeting";
    q("adCount").textContent = AD.players.length ? "" : "nobody's on";
    const me = G.mp, here = G.isle();
    // your own Tree (this PC, or your other one) gets no kick or ban buttons
    setHTML("adPlayers", AD.players.map(p => `<div class="adRow"><b class="${p.admin ? "adm" : ""}">${p.admin ? "[ADMIN] " : ""}${esc(p.name)}${me.on && p.id === me.id ? " (you)" : ""}</b><span>${esc(G.mpIsleName(p.isle))}</span>`
        + (p.admin ? "" : `<button class="adB" data-ad="goto" data-id="${esc(p.id)}" ${me.on && p.isle === here ? "" : "disabled"}>Go to</button><button class="adB" data-ad="mute" data-id="${esc(p.id)}">${p.muted ? "Unmute" : "Mute"}</button><button class="adB warn" data-ad="kick" data-id="${esc(p.id)}">Kick</button><button class="adB warn" data-ad="ban" data-id="${esc(p.id)}">${AD.armed === p.id ? "Sure?" : "Ban"}</button>`) + `</div>`).join(""));
    setHTML("adBans", AD.bans.length ? AD.bans.map(b => `<div class="adRow"><b>${esc(b.name)}</b><span>${new Date(b.at).toLocaleDateString()}</span><button class="adB" data-ad="unban" data-k="${esc(b.k)}">Unban</button></div>`).join("") : `<div class="adHint">no bans</div>`);
    q("adUnbanAll").style.display = AD.bans.length ? "" : "none";
    const TR = AD.tree;
    q("adTreeInfo").textContent = TR ? `${TR.devs.length} of ${TR.slots} PCs · password ${TR.pass ? "set" : "not set"}` : "";
    setHTML("adTreeDevs", TR && TR.devs.length ? TR.devs.map(d => `<div class="adRow"><b>${d.k === AD.myK ? "This PC" : "PC ····" + esc(d.k)}</b><span>${d.by === "key" ? "your key" : "password"} · last on ${new Date(d.seen).toLocaleDateString()}</span><button class="adB warn" data-ad="treeFree" data-k="${esc(d.k)}">Free</button></div>`).join("")
        : `<div class="adHint">no PCs yet: one takes a slot the next time it joins as Tree</div>`);
}
// how long each announcement has left, counted down every second while the card is open
function annLeft() {
    const now = performance.now();
    for (const sp of box.querySelectorAll("[data-annleft]")) { const a = AD.anns.find(x => x.id === sp.dataset.annleft); if (a) sp.textContent = a.until ? fmtLeft(a.until - now) : "until you take it down"; }
}
// quick ones are for whoever's on right now (15 seconds unless you say); full ones reach everyone and the menu (an hour unless you say)
function annKind(kind) {
    AD.kind = kind;
    for (const b of box.querySelectorAll("[data-annkind]")) b.classList.toggle("on", b.dataset.annkind === kind);
    q("adAnn").placeholder = kind === "full" ? "Announcement for everyone, on the server and the main menu..." : "Quick announcement for whoever's on right now...";
    annDur(kind === "full" ? 3600 : 15);
}
function annDur(secs) {
    const u = !secs ? 0 : secs % 86400 === 0 ? 86400 : secs % 3600 === 0 ? 3600 : secs % 60 === 0 ? 60 : 1;
    q("adAnnU").value = String(u); if (u) q("adAnnN").value = secs / u;
    q("adAnnN").disabled = !u;
}
function act(b) {
    const d = b.dataset;
    if (d.annkind) return annKind(d.annkind);
    if (d.anndur !== undefined) return annDur(+d.anndur);
    if (d.ad === "goto") { const p = AD.players.find(x => x.id === d.id); if (p) { G.goTo(p.x + 2.5, p.z, p.x, p.z); G.say("next to " + p.name); } return; }
    if (d.ad === "ban" && AD.armed !== d.id) { AD.armed = d.id; draw(); setTimeout(() => { if (AD.armed === d.id) { AD.armed = ""; draw(); } }, 3000); return; }
    if (d.ad) { AD.armed = ""; return d.ad === "unban" || d.ad === "treeFree" ? adSend(d.ad, { k: d.k }) : adSend(d.ad, { id: d.id }); }
    switch (b.id) {
        case "adAnnGo": {
            const v = q("adAnn").value.trim(); if (!v) { q("adAnn").focus(); return; }
            const u = +q("adAnnU").value, secs = u ? Math.round(parseFloat(q("adAnnN").value) * u) : 0;
            if (u && !(secs >= 3)) { G.say("say how long it stays up (3 seconds or more)", "bad"); q("adAnnN").focus(); return; }
            adSend("announce", { text: v, kind: AD.kind, secs }); q("adAnn").value = ""; break;
        }
        case "adAnnAll": adSend("annDel", { id: "*" }); break;
        case "adMotdGo": adSend("motd", { text: q("adMotd").value.trim() }); q("adMotd").value = ""; break;
        case "adUnbanAll": adSend("unban", { k: "*" }); break;
        case "adFreeGo": { const v = q("adFreeName").value.trim(); if (!v) { q("adFreeName").focus(); return; } adSend("freeName", { name: v }); q("adFreeName").value = ""; break; }
        case "adTreePassGo": { const v = q("adTreePass").value; if (v.length < 6) { G.say("the Tree password needs 6 characters or more", "bad"); q("adTreePass").focus(); return; } adSend("treePass", { pass: v }); q("adTreePass").value = ""; break; }
        case "adKeySave": { const v = q("adKey").value.trim(); if (!v) return; try { localStorage.setItem("ts4_admin_key", v); } catch (e) { /* no storage */ } q("adKey").value = ""; adOpen(); draw(); break; }
    }
}

// puts the card into an element (the dev panel's card, or the game's own admin panel); isOpenFn says when it's on screen
export function mount(el, isOpenFn) {
    if (!document.getElementById("adminCss")) document.head.appendChild(Object.assign(document.createElement("style"), { id: "adminCss", textContent: CSS }));
    box = el; isOpen = isOpenFn;
    box.classList.add("adCard"); box.innerHTML = HTML;
    box.addEventListener("click", e => { const b = e.target.closest("button"); if (b && box.contains(b)) act(b); });
    q("adAnnU").addEventListener("change", () => { q("adAnnN").disabled = q("adAnnU").value === "0"; });
    for (const [id, go] of [["adAnn", "adAnnGo"], ["adAnnN", "adAnnGo"], ["adMotd", "adMotdGo"], ["adFreeName", "adFreeGo"], ["adTreePass", "adTreePassGo"], ["adKey", "adKeySave"]])
        q(id).addEventListener("keydown", e => { if (e.code === "Enter") { e.preventDefault(); q(go).click(); } });
    annKind("quick");
    return { show };
}
// the game's own admin panel (the installed game has no dev panel): ` opens it, ✕ or Esc closes it
export function panel() {
    if (!panelEl) {
        panelEl = document.createElement("div"); panelEl.id = "adminPanel";
        panelEl.innerHTML = `<div class="adHead">ADMIN<button class="adB adX" data-close>✕</button></div><div class="adBody"></div>`;
        document.body.appendChild(panelEl);
        mount(panelEl.querySelector(".adBody"), () => panelEl.classList.contains("show"));
    }
    return { show(on) { panelEl.classList.toggle("show", !!on); show(on); } };
}
let shown = false;
function show(on) {
    if (on && !shown) { adOpen(); draw(); }
    if (!on && shown) adClose();
    shown = !!on;
}
let tick = 0;
setInterval(() => {
    if (!box || !isOpen()) return;
    annLeft();
    if (++tick % 3 === 0 && AD.ok) adSend("list"); // a fresh list every 3 seconds
}, 1000);

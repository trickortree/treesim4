// Tree Sim 4 public server (2.0.0), on Cloudflare Workers. One Durable Object, "Lobby", holds everyone's
// connection and passes along where each player is to the others on the same island, and the chat.
// Nothing is saved here: every player's progress stays in their own game.
// Deploy from this folder: npx wrangler deploy   (run npx wrangler dev to try it locally on ws://localhost:8787/play)
// Admin (announcements, kick, ban, mute, the message of the day) needs the ADMIN_KEY secret: npx wrangler secret put ADMIN_KEY.
// The key lives only in Cloudflare and on the admin's own PC (admin.key.js, which git ignores); the game never ships it.
import { DurableObject } from "cloudflare:workers";

const MAX_PLAYERS = 40;
const MOTD = "Welcome to the Tree Sim 4 public server! Press T to chat, hold Tab to see who's here.";
const HATS = ["", "hood", "cap", "beanie", "bandana", "straw", "top", "helmet", "horns", "crown", "witch"];
// 2.5 looks: what MY LOOK can pick, and the cosmetics (bought in the game) the server passes on
const LOOK_PICK = { hairStyle: ["short", "long", "bun", "mohawk", "spiky", "bald"], beardStyle: ["none", "short", "full", "goatee", "long"], eyes: ["round", "sleepy", "wide", "angry", "closed", "glow"],
    mouth: ["smile", "grin", "frown", "open", "flat", "fangs", "tongue"], build: ["slim", "normal", "wide"],
    cape: ["crimson", "forest", "ocean", "royal", "night", "gold"], trail: ["leaves", "sparks", "embers", "frost", "hearts", "rainbow"], axeSkin: ["gold", "frost", "shadow", "magma", "neon", "candy"] };
const CORS = { "access-control-allow-origin": "*" };

const int = (v, lo, hi, d = lo) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);
const num = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : null);
const cleanName = s => String(s || "").replace(/[^A-Za-z0-9 _\-]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
const cleanText = s => [...String(s || "")].filter(c => { const k = c.charCodeAt(0); return k >= 32 && k !== 127 && k !== 0x2028 && k !== 0x2029; }).join("").replace(/\s+/g, " ").trim().slice(0, 140); // no control characters or line breaks
function cleanLook(l) {
    l = l && typeof l === "object" ? l : {};
    const col = v => int(v, 0, 0xffffff, 0x888888);
    const out = { skin: col(l.skin), shirt: col(l.shirt), pants: col(l.pants), hat: HATS.includes(l.hat) ? l.hat : "", hatCol: col(l.hatCol) };
    for (const [k, list] of Object.entries(LOOK_PICK)) if (list.includes(l[k])) out[k] = l[k];
    for (const k of ["hair", "beard", "boots", "vest", "scarf"]) if (l[k] !== null && l[k] !== undefined) out[k] = col(l[k]);
    return out;
}
function cleanState(m) {
    const x = num(m.x, -9000, 9000), y = num(m.y, -500, 2000), z = num(m.z, -9000, 9000);
    if (x === null || y === null || z === null) return null;
    const pets = Array.isArray(m.pets) ? m.pets.slice(0, 3).map(k => String(k).replace(/[^a-z]/g, "").slice(0, 12)).filter(Boolean) : [];
    const shiny = Array.isArray(m.shiny) ? m.shiny.slice(0, 3).map(v => (v ? 1 : 0)) : [];
    const evo = Array.isArray(m.evo) ? m.evo.slice(0, 3).map(v => (v ? 1 : 0)) : [];
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100, yaw: num(m.yaw, -100, 100) || 0, pitch: num(m.pitch, -3, 3) || 0,
        sw: m.sw ? 1 : 0, axe: int(m.axe, 0, 99), isle: int(m.isle, 1, 99, 1), mi: cleanName(m.mi), pets, shiny, evo, pvp: m.pvp ? 1 : 0 };
}
const pub = a => ({ id: a.id, name: a.name, isle: a.isle, look: a.look, st: a.st, admin: a.admin ? 1 : 0, crew: a.crew || "" });
// 2.5 crews: a tag over your name, crew chat, a shared bank and rankings by trees felled. Saved here as crew:<TAG>, and each
// member's name points at their crew with crewOf:<name>. Members are names (a name stays with its owner, see Names).
const CREW_MAX = 20;
const tagKey = t => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
const crewName = s => String(s || "").replace(/[^A-Za-z0-9 '\-]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
// Announcements come in two kinds, each up for as long as the admin says (or until taken down):
//  - "quick": only for whoever is on the server right now.
//  - "full": everyone, including players who join while it's up, and the main menu.
// Games from 2.0.1 on say v: 2 in their hi and get the new messages (ann, annDel); 2.0.0 games get the old announce/news ones.
const ANN_KEEP = 50, ANN_MAX_SECS = 365 * 86400;
const annWire = (x, now = Date.now()) => ({ id: x.id, kind: x.kind, text: x.text, left: x.until ? Math.max(0, x.until - now) : 0, dur: x.until ? x.until - x.at : 0 });
// Names: nobody can be on the server under a name someone else is using, and a name stays with the game that used it
// (by a random token the game keeps) for 30 days after it was last used. "Tree" (the admin's name) and staff-sounding
// names need the admin key. A 2.0.0 game can't pick another name, so instead it plays as a Woodcutter.
const NAME_KEEP = 30 * 86400 * 1000;
// 2.5 server events: the admin starts one for a while; everyone on the server gets it
const EVENT_IDS = ["cash", "logs", "gold", "blood", "sale"];
// 2.5 shared trees: trees the admin spawns on the server. Everyone on that island chops the same health; when one falls,
// everyone who hit it gets its logs in their own game.
const STREE_MAX = 60;
// 2.5 trading: two players fill in what they give (cash, materials, pets, axes); when both say ready, each game makes the swap.
// A trade lives as trade:<id> until it's done or someone leaves.
function cleanOffer(o) {
    o = o && typeof o === "object" ? o : {};
    const mats = {};
    for (const [k, n] of Object.entries(o.mats && typeof o.mats === "object" ? o.mats : {}).slice(0, 24)) if (/^[a-z0-9_]{1,24}$/.test(k)) { const v = int(n, 0, 1e12, 0); if (v) mats[k] = v; }
    const pets = (Array.isArray(o.pets) ? o.pets : []).slice(0, 3).map(p => ({ k: String((p && p.k) || "").replace(/[^a-z]/g, "").slice(0, 16), stars: int(p && p.stars, 1, 5, 1), shiny: p && p.shiny ? 1 : 0 })).filter(p => p.k);
    const axes = [...new Set((Array.isArray(o.axes) ? o.axes : []).slice(0, 3).map(i => int(i, 1, 99, 0)).filter(Boolean))];
    return { cash: int(o.cash, 0, 1e15, 0), mats, pets, axes };
}
const EMOTE_IDS = ["wave", "cheer", "dance", "clap", "point", "bow", "laugh", "flex"];
const nameKey = n => String(n).toLowerCase().replace(/[^a-z0-9]/g, "");
const leet = k => k.replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
const reserved = n => { const k = nameKey(n); return [k, leet(k)].some(x => /^(tre{2,}\d*|admin|administrator|owner|server|mod|moderator|staff|dev|developer)$/.test(x)); };
async function tokHash(t) {
    if (typeof t !== "string" || t.length < 16 || t.length > 80) return "";
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
    return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}
// "Tree" is the admin's own name, on up to TREE_SLOTS PCs at once: the PC with the admin key takes a slot by itself,
// and another PC (school) takes one with the Tree password the admin sets in the admin card. Wrong passwords are slowed down.
const TREE_SLOTS = 2, TREE_FAILS = 10, TREE_COOL = 15 * 60 * 1000;
async function sha(t) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); }
async function passOk(P, pass) {
    if (!P || typeof pass !== "string" || !pass || pass.length > 64) return false;
    const a = new TextEncoder().encode(await sha(P.salt + pass)), b = new TextEncoder().encode(P.hash);
    return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}
async function keyOk(env, key) {
    if (!env.ADMIN_KEY || typeof key !== "string" || key.length > 200) return false;
    const a = new TextEncoder().encode(key), b = new TextEncoder().encode(env.ADMIN_KEY);
    return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}

export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        if (url.pathname === "/play" || url.pathname === "/status") {
            const lobby = env.LOBBY.get(env.LOBBY.idFromName("public"));
            if (url.pathname === "/play" && req.headers.get("Upgrade") !== "websocket") return new Response("Join from the game: this address only takes game connections.", { status: 426 });
            return lobby.fetch(req);
        }
        return new Response("Tree Sim 4 public server. Join it from the game's main menu.", { headers: { "content-type": "text/plain", ...CORS } });
    },
};

export class Lobby extends DurableObject {
    socks() { return this.ctx.getWebSockets(); }
    players() { return this.socks().map(w => ({ w, a: w.deserializeAttachment() })).filter(p => p.a && p.a.joined); }

    async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/status") {
            const ps = this.players();
            return Response.json({ online: ps.length, max: MAX_PLAYERS, names: ps.map(p => p.a.name).slice(0, MAX_PLAYERS), motd: await this.motd(), news: await this.news(), anns: (await this.anns()).filter(x => x.kind === "full").slice(-5).map(x => annWire(x)) }, { headers: CORS });
        }
        const pair = new WebSocketPair(), [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        const ip = req.headers.get("CF-Connecting-IP") || "";
        const bans = (await this.ctx.storage.get("bans")) || {};
        if (ip && bans[ip]) {
            server.send(JSON.stringify({ t: "banned" }));
            server.close(4003, "banned");
            return new Response(null, { status: 101, webSocket: client });
        }
        if (this.players().length >= MAX_PLAYERS) {
            server.send(JSON.stringify({ t: "full", max: MAX_PLAYERS }));
            server.close(1013, "full");
            return new Response(null, { status: 101, webSocket: client });
        }
        server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), name: "", isle: 1, look: null, st: null, joined: false, chatT: 0, n: 0, winT: 0, ip, admin: false, muted: false, bad: 0 });
        return new Response(null, { status: 101, webSocket: client });
    }

    async motd() { return (await this.ctx.storage.get("motd")) || MOTD; }
    // the announcements that are still up (expired ones are dropped as they're read)
    async anns() {
        const all = (await this.ctx.storage.get("anns")) || [], now = Date.now(), up = all.filter(x => !x.until || x.until > now);
        if (up.length !== all.length) await this.ctx.storage.put("anns", up);
        return up;
    }
    async events() {
        const all = (await this.ctx.storage.get("events")) || [], now = Date.now(), up = all.filter(x => x.until > now);
        if (up.length !== all.length) await this.ctx.storage.put("events", up);
        return up.map(x => ({ k: x.k, left: x.until - now }));
    }
    async sendEvents() { const msg = JSON.stringify({ t: "events", list: await this.events() }); for (const p of this.players()) if (p.a.v >= 2) this.send(p.w, msg); }
    // what a 2.0.0 game understands: the newest full announcement that's up
    async news() { const f = (await this.anns()).filter(x => x.kind === "full").pop(); return f ? { text: f.text, at: f.at } : null; }
    everyone(obj) { const msg = JSON.stringify(obj); for (const p of this.players()) this.send(p.w, msg); }

    send(w, obj) { try { w.send(typeof obj === "string" ? obj : JSON.stringify(obj)); } catch (e) { /* it's going away */ } }

    async webSocketMessage(ws, raw) {
        if (typeof raw !== "string" || raw.length > 1500) return;
        let m; try { m = JSON.parse(raw); } catch (e) { return; }
        const a = ws.deserializeAttachment(); if (!a || !m || typeof m !== "object") return;
        // at most 25 messages a second from anyone
        const now = Date.now();
        if (now - a.winT > 1000) { a.winT = now; a.n = 0; }
        if (++a.n > 25) { ws.serializeAttachment(a); return; }
        if (m.t === "admin") return this.admin(ws, a, m);
        if (m.t === "hi" && !a.joined) {
            let name = cleanName(m.name) || "Woodcutter";
            const v = int(m.v, 1, 99, 1), admin = await keyOk(this.env, m.key), h = await tokHash(m.tok), k = nameKey(name), now = Date.now();
            const same = this.players().filter(p => p.w !== ws && nameKey(p.a.name) === k);
            let why = "", mine = admin && reserved(name), you = admin;
            if (k === "tree") { why = await this.treeCheck(admin, h, m.pass, now); if (!why) mine = you = true; }
            else if (reserved(name) && !admin) why = "reserved";
            if (!why && !mine) {
                if (same.length && !(h && same[0].a.h === h)) why = "online";
                else { const rec = await this.ctx.storage.get("name:" + k); if (rec && rec.h !== h && now - rec.seen < NAME_KEEP) why = "owned"; }
            }
            if (why && v >= 2) {
                const claim = k === "tree" && why !== "slotsFull" && !!(await this.ctx.storage.get("treePass"));
                this.send(ws, { t: "nameTaken", name, why, claim: claim ? 1 : 0 }); try { ws.close(4005, "name taken"); } catch (e) { /* gone */ }
                return;
            }
            if (why) name = "Woodcutter" + (1000 + Math.floor(Math.random() * 9000));
            else {
                if (h && !mine) await this.ctx.storage.put("name:" + k, { h, name, seen: now });
                // the same game joining again (a reconnect, or another window) takes over from its old connection.
                // Tree can be on two PCs at once, so another Tree only makes way when there would be more than two.
                let out = same;
                if (k === "tree") {
                    out = same.filter(p => h && p.a.h === h);
                    const devs = (await this.ctx.storage.get("treeDevs")) || [], held = p => devs.some(d => d.h === p.a.h);
                    const rest = same.filter(p => !out.includes(p)).sort((x, y) => held(x) - held(y)); // a PC whose slot was freed goes first
                    if (rest.length >= TREE_SLOTS) out = out.concat(rest.slice(0, rest.length - TREE_SLOTS + 1));
                }
                for (const p of out) { this.send(p.w, { t: "replaced" }); this.gone(p.w, 4006); }
            }
            a.name = name; a.h = h; a.admin = you; a.boss = you; a.v = v;
            const ck = await this.ctx.storage.get("crewOf:" + nameKey(name)), cr = ck && (await this.ctx.storage.get("crew:" + ck));
            a.crew = cr && cr.members.includes(nameKey(name)) ? cr.tag : "";
            a.look = cleanLook(m.look);
            a.st = cleanState(m.st || {}) || null;
            a.isle = a.st ? a.st.isle : int(m.isle, 1, 99, 1);
            a.joined = true;
            ws.serializeAttachment(a);
            const others = this.players().filter(p => p.w !== ws);
            const full = (await this.anns()).filter(x => x.kind === "full");
            this.send(ws, { t: "welcome", id: a.id, name: a.name, admin: a.admin ? 1 : 0, motd: await this.motd(), players: others.map(p => pub(p.a)),
                ...(a.v >= 2 ? { anns: full.map(x => annWire(x)), events: await this.events(), strees: (await this.ctx.storage.get("strees")) || [] } : { news: full.length ? { text: full[full.length - 1].text, at: full[full.length - 1].at } : null }) });
            const j = JSON.stringify({ t: "join", ...pub(a) });
            for (const p of others) this.send(p.w, j);
            if (a.crew) await this.crewTell(a.crew);
            return;
        }
        if (!a.joined) return;
        if (m.t === "st") {
            const st = cleanState(m); if (!st) { ws.serializeAttachment(a); return; }
            const moved = st.isle !== a.isle;
            a.isle = st.isle; a.st = st;
            ws.serializeAttachment(a);
            // where you are goes to the players on your island (and to everyone once, when you change island)
            const msg = JSON.stringify({ t: "st", id: a.id, ...st });
            for (const p of this.players()) if (p.w !== ws && (moved || p.a.isle === a.isle)) this.send(p.w, msg);
            return;
        }
        if (m.t === "chat") {
            const text = cleanText(m.text);
            if (!text || now - (a.chatT || 0) < 700) { ws.serializeAttachment(a); return; }
            a.chatT = now; ws.serializeAttachment(a);
            if (a.muted) { this.send(ws, { t: "sys", text: "You're muted, so nobody else sees your chat." }); return; }
            const msg = JSON.stringify({ t: "chat", id: a.id, name: a.name, text, admin: a.admin ? 1 : 0 });
            for (const p of this.players()) this.send(p.w, msg);
            return;
        }
        // private messages and friend requests go to one player, found by name
        if (m.t === "pm" || m.t === "friendReq" || m.t === "friendOk") {
            const to = this.players().find(p => p.w !== ws && nameKey(p.a.name) === nameKey(cleanName(m.to)));
            // each kind has its own pace (answering a request is never held up)
            const slot = { pm: "pmT", friendReq: "frT" }[m.t], gap = m.t === "pm" ? 700 : 1000;
            if (slot && now - (a[slot] || 0) < gap) { ws.serializeAttachment(a); this.send(ws, { t: "sys", text: "Slow down a little." }); return; }
            if (slot) a[slot] = now; ws.serializeAttachment(a);
            if (!to) { this.send(ws, { t: "sys", text: `${cleanName(m.to) || "They"} isn't online.` }); return; }
            if (m.t === "pm") {
                const text = cleanText(m.text); if (!text) return;
                if (a.muted) { this.send(ws, { t: "sys", text: "You're muted, so nobody else sees your messages." }); return; }
                this.send(to.w, { t: "pm", from: a.name, text, admin: a.admin ? 1 : 0 });
                this.send(ws, { t: "pmSent", to: to.a.name, text });
            } else {
                this.send(to.w, { t: m.t, from: a.name });
                if (m.t === "friendReq") this.send(ws, { t: "sys", text: `Friend request sent to ${to.a.name}.` });
            }
            return;
        }
        if (typeof m.t === "string" && m.t.startsWith("crew")) return this.crew(ws, a, m, now);
        // 2.5 PvP: a hit on another player, if you both have PvP on, you're on the same island and close (at most 4 a second)
        if (m.t === "pvpHit") {
            if (now - (a.pvpW || 0) > 1000) { a.pvpW = now; a.pvpN = 0; }
            if (++a.pvpN > 4) { ws.serializeAttachment(a); return; }
            ws.serializeAttachment(a);
            const t = this.players().find(p => p.a.id === m.id && p.w !== ws);
            if (!t || !a.st || !t.a.st || !a.st.pvp || !t.a.st.pvp || a.isle !== t.a.isle) return;
            if (Math.hypot(a.st.x - t.a.st.x, a.st.z - t.a.st.z) > 5.5) return;
            this.send(t.w, { t: "pvpHit", fromId: a.id, from: a.name, dmg: int(m.dmg, 1, 200, 1) });
            return;
        }
        if (m.t === "pvpKO") { // you were knocked out: everyone on your island hears who did it
            if (now - (a.koT || 0) < 2000) { ws.serializeAttachment(a); return; }
            a.koT = now; ws.serializeAttachment(a);
            const k = this.players().find(p => p.a.id === m.by); if (!k) return;
            const msg = JSON.stringify({ t: "kill", killer: k.a.name, victim: a.name });
            for (const p of this.players()) if (p.a.isle === a.isle && p.a.v >= 2) this.send(p.w, msg);
            return;
        }
        if (typeof m.t === "string" && m.t.startsWith("trade")) return this.trade(ws, a, m, now);
        if (m.t === "streeHit") { // a hit on a shared tree (at most 12 a second each)
            if (now - (a.hitW || 0) > 1000) { a.hitW = now; a.hitN = 0; }
            if (++a.hitN > 12) { ws.serializeAttachment(a); return; }
            ws.serializeAttachment(a);
            const all = (await this.ctx.storage.get("strees")) || [], t = all.find(x => x.id === m.id);
            if (!t || t.isle !== a.isle) return;
            t.hp -= num(m.dmg, 1, 1e13) || 1;
            if (t.hp <= 0) {
                await this.ctx.storage.put("strees", all.filter(x => x !== t));
                const msg = JSON.stringify({ t: "streeFell", id: t.id, by: a.name });
                for (const p of this.players()) if (p.a.v >= 2) this.send(p.w, msg);
            } else {
                await this.ctx.storage.put("strees", all);
                const msg = JSON.stringify({ t: "streeHp", id: t.id, hp: Math.ceil(t.hp) });
                for (const p of this.players()) if (p.a.v >= 2 && p.a.isle === t.isle && p.w !== ws) this.send(p.w, msg);
            }
            return;
        }
        if (m.t === "emote") { // an emote goes to everyone on your island (at most one every 0.7 s)
            if (!EMOTE_IDS.includes(m.e) || now - (a.emoteT || 0) < 700) { ws.serializeAttachment(a); return; }
            a.emoteT = now; ws.serializeAttachment(a);
            const msg = JSON.stringify({ t: "emote", id: a.id, e: m.e });
            for (const p of this.players()) if (p.w !== ws && p.a.isle === a.isle) this.send(p.w, msg);
            return;
        }
        if (m.t === "look") { // a new look from MY LOOK, passed to everyone (at most every 1.5 s)
            if (now - (a.lookT || 0) < 1500) { ws.serializeAttachment(a); return; }
            a.lookT = now; a.look = cleanLook(m.look); ws.serializeAttachment(a);
            const msg = JSON.stringify({ t: "look", id: a.id, look: a.look });
            for (const p of this.players()) if (p.w !== ws) this.send(p.w, msg);
            return;
        }
        if (m.t === "isleSave") { // 2.5: your own island's layout, in parts (at most 48 of 1,300 characters), so anyone can visit it
            const i = int(m.i, 0, 47), n = int(m.n, 1, 48);
            if (i === null || n === null || i >= n || typeof m.d !== "string" || m.d.length > 1300 || !/^[a-z0-9_,;-]*$/.test(m.d)) { ws.serializeAttachment(a); return; }
            ws.serializeAttachment(a);
            const k = nameKey(a.name);
            await this.ctx.storage.put(`isleP:${k}:${i}`, m.d);
            if (i === n - 1) await this.ctx.storage.put(`isle:${k}`, { n, at: now });
            return;
        }
        if (m.t === "isleGet") { // visiting someone's island (one ask every 2 s)
            if (now - (a.isleT || 0) < 2000) { ws.serializeAttachment(a); this.send(ws, { t: "sys", text: "Slow down a little." }); return; }
            a.isleT = now; ws.serializeAttachment(a);
            const who = cleanName(m.name), k = nameKey(who), meta = who ? await this.ctx.storage.get(`isle:${k}`) : null;
            if (!meta) { this.send(ws, { t: "isleOf", name: who }); return; }
            const keys = Array.from({ length: meta.n }, (_, i) => `isleP:${k}:${i}`), got = await this.ctx.storage.get(keys);
            const on = this.players().find(p => nameKey(p.a.name) === k);
            this.send(ws, { t: "isleOf", name: on ? on.a.name : who, d: keys.map(x => got.get(x) || "").join("") });
            return;
        }
        if (m.t === "ping") { ws.serializeAttachment(a); this.send(ws, { t: "pong", ts: num(m.ts, 0, 1e15) }); return; }
        ws.serializeAttachment(a);
    }

    // ---------- trading ----------
    async tradeSend(tr, extra) {
        for (const id of [tr.a, tr.b]) {
            const p = this.players().find(q => q.a.id === id); if (!p) continue;
            const them = id === tr.a ? tr.b : tr.a;
            this.send(p.w, extra || { t: "trade", trade: { id: tr.id, me: { name: tr.names[id], offer: tr.offer[id], ready: !!tr.ready[id] }, them: { name: tr.names[them], offer: tr.offer[them], ready: !!tr.ready[them] } } });
        }
    }
    async tradeEnd(tr, why) {
        await this.ctx.storage.delete("trade:" + tr.id);
        for (const id of [tr.a, tr.b]) { const p = this.players().find(q => q.a.id === id); if (p) { p.a.trade = ""; p.w.serializeAttachment(p.a); this.send(p.w, { t: "tradeEnd", why }); } }
    }
    async trade(ws, a, m, now) {
        const sys = text => this.send(ws, { t: "sys", text });
        const tr = a.trade ? await this.ctx.storage.get("trade:" + a.trade) : null;
        if (m.t === "tradeReq") { // ask someone to trade (one ask every 2 s)
            if (now - (a.trT || 0) < 2000) return sys("Slow down a little.");
            a.trT = now; ws.serializeAttachment(a);
            if (tr) return sys("You're already trading.");
            const to = this.players().find(p => p.w !== ws && nameKey(p.a.name) === nameKey(cleanName(m.to)));
            if (!to) return sys(`${cleanName(m.to) || "They"} isn't online.`);
            if (to.a.trade) return sys(`${to.a.name} is trading with someone else.`);
            to.a.tradeInv = a.id; to.w.serializeAttachment(to.a);
            this.send(to.w, { t: "tradeReq", from: a.name, fromId: a.id });
            return sys(`Trade request sent to ${to.a.name}.`);
        }
        if (m.t === "tradeAccept") {
            if (tr) return sys("You're already trading.");
            const from = this.players().find(p => p.a.id === m.fromId);
            if (!from || a.tradeInv !== m.fromId) return sys("That trade request ran out.");
            if (from.a.trade) return sys(`${from.a.name} is trading with someone else.`);
            const id = crypto.randomUUID().slice(0, 8), t = { id, a: from.a.id, b: a.id, names: { [from.a.id]: from.a.name, [a.id]: a.name }, offer: { [from.a.id]: cleanOffer({}), [a.id]: cleanOffer({}) }, ready: {}, at: now };
            await this.ctx.storage.put("trade:" + id, t);
            for (const p of [from, this.players().find(q => q.w === ws)]) { p.a.trade = id; p.a.tradeInv = ""; p.w.serializeAttachment(p.a); }
            return this.tradeSend(t);
        }
        if (!tr) return;
        if (m.t === "tradeOffer") { // a change to what you give: both have to say ready again
            tr.offer[a.id] = cleanOffer(m.offer); tr.ready = {};
            await this.ctx.storage.put("trade:" + tr.id, tr);
            return this.tradeSend(tr);
        }
        if (m.t === "tradeReady") {
            tr.ready[a.id] = !!m.on;
            if (tr.ready[tr.a] && tr.ready[tr.b]) { // the swap: each game gives what it offered and gets the other side
                for (const id of [tr.a, tr.b]) { const p = this.players().find(q => q.a.id === id); if (p) this.send(p.w, { t: "tradeDone", give: tr.offer[id], get: tr.offer[id === tr.a ? tr.b : tr.a], with: tr.names[id === tr.a ? tr.b : tr.a] }); }
                await this.ctx.storage.delete("trade:" + tr.id);
                for (const id of [tr.a, tr.b]) { const p = this.players().find(q => q.a.id === id); if (p) { p.a.trade = ""; p.w.serializeAttachment(p.a); } }
                return;
            }
            await this.ctx.storage.put("trade:" + tr.id, tr);
            return this.tradeSend(tr);
        }
        if (m.t === "tradeCancel") return this.tradeEnd(tr, `${a.name} cancelled the trade.`);
    }

    // ---------- crews ----------
    crewWire(c) {
        const on = new Set(this.players().map(p => nameKey(p.a.name)));
        return { name: c.name, tag: c.tag, owner: c.names[c.owner] || c.owner, bank: c.bank, felled: c.felled,
            members: c.members.map(k => ({ name: c.names[k] || k, owner: k === c.owner ? 1 : 0, online: on.has(k) ? 1 : 0 })) };
    }
    // the crew's state to its members that are online
    async crewTell(tag) {
        const c = await this.ctx.storage.get("crew:" + tag); if (!c) return;
        const msg = JSON.stringify({ t: "crew", crew: this.crewWire(c) });
        for (const p of this.players()) if (p.a.crew === tag) this.send(p.w, msg);
    }
    // a player's tag changed: everyone sees the new tag over their head
    setCrewTag(p, tag) {
        p.a.crew = tag; p.w.serializeAttachment(p.a);
        const msg = JSON.stringify({ t: "crewTag", id: p.a.id, tag });
        for (const q of this.players()) this.send(q.w, msg);
    }
    async crew(ws, a, m, now) {
        const me = this.players().find(p => p.w === ws); if (!me) return;
        const k = nameKey(a.name), sys = text => this.send(ws, { t: "sys", text });
        const c = a.crew ? await this.ctx.storage.get("crew:" + a.crew) : null;
        if (m.t === "crewTop") { // rankings: the 10 crews that felled the most trees
            const all = [...(await this.ctx.storage.list({ prefix: "crew:" })).values()].sort((x, y) => y.felled - x.felled).slice(0, 10);
            this.send(ws, { t: "crewTop", list: all.map(x => ({ tag: x.tag, name: x.name, felled: x.felled, members: x.members.length })) });
            if (c) this.send(ws, { t: "crew", crew: this.crewWire(c) }); // and your own crew, up to date
            return;
        }
        if (m.t === "crewMake") {
            if (c) return sys("Leave your crew first.");
            const tag = tagKey(m.tag), name = crewName(m.name);
            if (tag.length < 2) return sys("A crew tag is 2 to 4 letters or numbers.");
            if (name.length < 3) return sys("Give your crew a name (3 to 20 letters).");
            if (await this.ctx.storage.get("crew:" + tag)) return sys(`[${tag}] is taken. Pick another tag.`);
            await this.ctx.storage.put("crew:" + tag, { name, tag, owner: k, members: [k], names: { [k]: a.name }, bank: 0, felled: 0, made: now });
            await this.ctx.storage.put("crewOf:" + k, tag);
            this.setCrewTag(me, tag); await this.crewTell(tag);
            return sys(`You made the crew [${tag}] ${name}. Invite people from the Crew panel (U).`);
        }
        if (m.t === "crewJoin") { // saying yes to an invite
            const tag = tagKey(m.tag);
            if (c) return sys("Leave your crew first.");
            if (a.crewInv !== tag) return sys("That invite ran out. Ask for a new one.");
            const cr = await this.ctx.storage.get("crew:" + tag); if (!cr) return sys("That crew is gone.");
            if (cr.members.length >= CREW_MAX) return sys(`[${tag}] is full (${CREW_MAX} people).`);
            if (!cr.members.includes(k)) cr.members.push(k); cr.names[k] = a.name;
            await this.ctx.storage.put("crew:" + tag, cr); await this.ctx.storage.put("crewOf:" + k, tag);
            a.crewInv = ""; this.setCrewTag(me, tag); await this.crewTell(tag);
            for (const p of this.players()) if (p.a.crew === tag && p.w !== ws) this.send(p.w, { t: "sys", text: `${a.name} joined the crew!` });
            return sys(`You joined [${tag}] ${cr.name}!`);
        }
        if (!c) { if (m.t === "crewInvite" || m.t === "crewChat" || m.t === "crewBank" || m.t === "crewLeave" || m.t === "crewKick") sys("You're not in a crew."); if (m.t === "crewBank" && +m.amount > 0) this.send(ws, { t: "crewPaid", amount: Math.floor(+m.amount) }); return; }
        const owner = c.owner === k;
        if (m.t === "crewInvite") {
            if (!owner) return sys("Only the crew's leader can invite.");
            const to = this.players().find(p => nameKey(p.a.name) === nameKey(cleanName(m.to)));
            if (!to) return sys(`${cleanName(m.to) || "They"} isn't online.`);
            if (to.a.crew) return sys(`${to.a.name} is already in a crew.`);
            to.a.crewInv = c.tag; to.w.serializeAttachment(to.a);
            this.send(to.w, { t: "crewInvite", from: a.name, tag: c.tag, name: c.name });
            return sys(`Crew invite sent to ${to.a.name}.`);
        }
        if (m.t === "crewChat") {
            const text = cleanText(m.text); if (!text || now - (a.chatT || 0) < 700) return;
            a.chatT = now; ws.serializeAttachment(a);
            const msg = JSON.stringify({ t: "crewChat", from: a.name, tag: c.tag, text });
            for (const p of this.players()) if (p.a.crew === c.tag) this.send(p.w, msg);
            return;
        }
        if (m.t === "crewBank") { // put money in (anyone), or take it out (the leader)
            const amt = Math.floor(+m.amount);
            if (!Number.isFinite(amt) || amt === 0 || Math.abs(amt) > 1e18) return;
            if (amt < 0) {
                if (!owner) return sys("Only the crew's leader can take money out.");
                if (c.bank < -amt) return sys("The crew bank doesn't have that much.");
                c.bank += amt; this.send(ws, { t: "crewPaid", amount: -amt });
            } else c.bank = Math.min(1e18, c.bank + amt);
            await this.ctx.storage.put("crew:" + c.tag, c); await this.crewTell(c.tag);
            const msg = JSON.stringify({ t: "sys", text: amt > 0 ? `${a.name} put $${amt.toLocaleString()} in the crew bank.` : `${a.name} took $${(-amt).toLocaleString()} out of the crew bank.` });
            for (const p of this.players()) if (p.a.crew === c.tag) this.send(p.w, msg);
            return;
        }
        if (m.t === "crewFell") { // trees felled, for the rankings (at most every 5 s)
            const n = int(m.n, 0, 500, 0); if (!n || now - (a.fellT || 0) < 5000) return;
            a.fellT = now; ws.serializeAttachment(a);
            c.felled += n; await this.ctx.storage.put("crew:" + c.tag, c);
            return;
        }
        if (m.t === "crewKick") {
            if (!owner) return sys("Only the crew's leader can kick.");
            const tk = nameKey(cleanName(m.name)); if (!c.members.includes(tk) || tk === k) return;
            c.members = c.members.filter(x => x !== tk); await this.ctx.storage.put("crew:" + c.tag, c); await this.ctx.storage.delete("crewOf:" + tk);
            const p = this.players().find(q => nameKey(q.a.name) === tk);
            if (p) { this.setCrewTag(p, ""); this.send(p.w, { t: "crew", crew: null }); this.send(p.w, { t: "sys", text: `You were kicked from [${c.tag}].` }); }
            await this.crewTell(c.tag);
            return sys(`${c.names[tk] || tk} is out of the crew.`);
        }
        if (m.t === "crewLeave") {
            c.members = c.members.filter(x => x !== k); await this.ctx.storage.delete("crewOf:" + k);
            this.setCrewTag(me, ""); this.send(ws, { t: "crew", crew: null });
            if (!c.members.length) { await this.ctx.storage.delete("crew:" + c.tag); return sys(`You left, and [${c.tag}] is gone.`); }
            if (owner) c.owner = c.members[0]; // the next member leads
            await this.ctx.storage.put("crew:" + c.tag, c); await this.crewTell(c.tag);
            return sys(`You left [${c.tag}].`);
        }
    }

    // can this game be Tree? "" when it can; otherwise why not (reserved, badPass, slotsFull, slow)
    async treeCheck(admin, h, pass, now) {
        const devs = (await this.ctx.storage.get("treeDevs")) || [], dev = h && devs.find(d => d.h === h);
        if (admin || dev) {
            if (dev) dev.seen = now; else if (h && devs.length < TREE_SLOTS) devs.push({ h, by: "key", at: now, seen: now });
            if (h) await this.ctx.storage.put("treeDevs", devs);
            return "";
        }
        const P = await this.ctx.storage.get("treePass");
        if (!P || typeof pass !== "string" || !pass || !h) return "reserved";
        let f = (await this.ctx.storage.get("treeFails")) || { n: 0, t: now };
        if (now - f.t > TREE_COOL) f = { n: 0, t: now };
        if (f.n >= TREE_FAILS) return "slow";
        if (!(await passOk(P, pass))) { f.n++; await this.ctx.storage.put("treeFails", f); return "badPass"; }
        if (devs.length >= TREE_SLOTS) return "slotsFull";
        devs.push({ h, by: "password", at: now, seen: now });
        await this.ctx.storage.put("treeDevs", devs);
        return "";
    }

    // ---------- admin: every message carries the key, so nothing depends on the connection surviving a sleep ----------
    async admin(ws, a, m) {
        // the key, or a connection that joined as Tree (with the key, or from a Tree slot)
        if (!(a.joined && a.boss) && !(await keyOk(this.env, m.key))) {
            a.bad = (a.bad || 0) + 1; ws.serializeAttachment(a);
            this.send(ws, { t: "adminErr", op: m.op, text: "Wrong admin key." });
            if (a.bad >= 3) try { ws.close(4004, "bad key"); } catch (e) { /* gone */ }
            return;
        }
        const reply = async (text = "") => {
            const bans = (await this.ctx.storage.get("bans")) || {};
            const devs = (await this.ctx.storage.get("treeDevs")) || [];
            const tree = { pass: !!(await this.ctx.storage.get("treePass")), slots: TREE_SLOTS, devs: devs.map(d => ({ k: d.h.slice(-4), by: d.by, at: d.at, seen: d.seen })) };
            this.send(ws, { t: "adminOk", op: m.op, text, tree, events: await this.events(), motd: await this.motd(), anns: (await this.anns()).map(x => annWire(x)), bans: Object.entries(bans).map(([k, b]) => ({ k: k.slice(-4), name: b.name, at: b.at })),
                players: this.players().map(p => ({ id: p.a.id, name: p.a.name, isle: p.a.isle, admin: p.a.admin ? 1 : 0, muted: p.a.muted ? 1 : 0, x: p.a.st ? p.a.st.x : 0, z: p.a.st ? p.a.st.z : 0 })) });
        };
        const op = m.op;
        if (op === "list") return reply();
        if (op === "tag") { // marks this connection as the admin's own player: a gold name and [ADMIN] in chat
            a.admin = true; ws.serializeAttachment(a);
            if (a.joined) this.everyone({ t: "adminTag", id: a.id });
            return reply("You're tagged as the admin.");
        }
        if (op === "announce") {
            const text = cleanText(m.text).slice(0, 200); if (!text) return reply("Nothing to announce.");
            const kind = m.kind === "full" ? "full" : "quick", secs = int(m.secs, 0, ANN_MAX_SECS, 15), now = Date.now();
            const x = { id: crypto.randomUUID().slice(0, 8), kind, text, at: now, until: secs ? now + Math.max(3, secs) * 1000 : 0 };
            await this.ctx.storage.put("anns", [...(await this.anns()), x].slice(-ANN_KEEP));
            const neu = JSON.stringify({ t: "ann", ...annWire(x, now) }), old = JSON.stringify({ t: "announce", text });
            const ps = this.players(); for (const p of ps) this.send(p.w, p.a.v >= 2 ? neu : old);
            return reply(`${kind === "full" ? "Announcement" : "Quick announcement"} sent to ${ps.length} player(s).`);
        }
        if (op === "annDel" || op === "clearNews") { // take one down (id), or all of them (id "*"; clearNews is the 1.13 dev panel's name for that)
            const all = await this.anns(), gone = op === "clearNews" || m.id === "*" ? all : all.filter(x => x.id === m.id);
            if (!gone.length) return reply("That one's already down.");
            await this.ctx.storage.put("anns", all.filter(x => !gone.includes(x)));
            const msg = JSON.stringify({ t: "annDel", ids: gone.map(x => x.id) });
            for (const p of this.players()) if (p.a.v >= 2) this.send(p.w, msg);
            return reply(gone.length === 1 ? "Taken down." : `Took down ${gone.length} announcements.`);
        }
        if (op === "motd") {
            const text = cleanText(m.text).slice(0, 200);
            if (text) await this.ctx.storage.put("motd", text); else await this.ctx.storage.delete("motd");
            return reply(text ? "Message of the day set." : "Message of the day back to the default.");
        }
        const p = this.players().find(q => q.a.id === m.id);
        if (p && p.a.boss && (op === "kick" || op === "ban" || op === "mute")) return reply("That's you, on another PC.");
        if (op === "kick" || op === "ban") {
            if (!p) return reply("They already left.");
            if (op === "ban" && p.a.ip) {
                const bans = (await this.ctx.storage.get("bans")) || {};
                bans[p.a.ip] = { name: p.a.name, at: Date.now() };
                await this.ctx.storage.put("bans", bans);
            }
            const word = op === "ban" ? "banned" : "kicked";
            this.send(p.w, { t: word });
            this.gone(p.w, op === "ban" ? 4003 : 4001);
            this.everyone({ t: "sys", text: `${p.a.name} was ${word} by the admin.` });
            return reply(`${p.a.name} ${word}.`);
        }
        if (op === "mute") {
            if (!p) return reply("They already left.");
            p.a.muted = !p.a.muted; p.w.serializeAttachment(p.a);
            this.send(p.w, { t: "sys", text: p.a.muted ? "The admin muted you." : "The admin unmuted you." });
            return reply(`${p.a.name} ${p.a.muted ? "muted" : "unmuted"}.`);
        }
        if (op === "treeSpawn") { // one shared tree (no reply: everyone, the admin too, gets it as a stree)
            const key = String(m.key || ""), isle = int(m.isle, 1, 99, 1), x = num(m.x, -9000, 9000), z = num(m.z, -9000, 9000);
            if (!/^[a-z0-9_]{1,40}$/.test(key) || x === null || z === null) return;
            const h = num(m.h, 2, 16) || 7, hp = Math.round(num(m.hp, 0, 1e12) || 0), mut = /^[a-z]{1,12}$/.test(m.mut || "") ? m.mut : "";
            const tree = { id: crypto.randomUUID().slice(0, 8), isle, key, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, h, hp: hp || 1000, maxHp: hp || 1000, mut };
            await this.ctx.storage.put("strees", [...((await this.ctx.storage.get("strees")) || []), tree].slice(-STREE_MAX));
            const msg = JSON.stringify({ t: "stree", tree });
            for (const p of this.players()) if (p.a.v >= 2) this.send(p.w, msg);
            return;
        }
        if (op === "treeClear") {
            const all = (await this.ctx.storage.get("strees")) || [];
            await this.ctx.storage.put("strees", []);
            const msg = JSON.stringify({ t: "streeGone", ids: all.map(x => x.id) });
            for (const p of this.players()) if (p.a.v >= 2) this.send(p.w, msg);
            return reply(`Cleared ${all.length} shared tree${all.length === 1 ? "" : "s"}.`);
        }
        if (op === "event") { // start (or restart) a server event for secs
            if (!EVENT_IDS.includes(m.k)) return reply("Unknown event.");
            const secs = int(m.secs, 30, 7 * 86400, 900), all = ((await this.ctx.storage.get("events")) || []).filter(x => x.k !== m.k && x.until > Date.now());
            await this.ctx.storage.put("events", [...all, { k: m.k, until: Date.now() + secs * 1000 }]);
            await this.sendEvents();
            return reply("Event started for everyone.");
        }
        if (op === "eventStop") {
            const all = (await this.ctx.storage.get("events")) || [];
            await this.ctx.storage.put("events", m.k === "*" ? [] : all.filter(x => x.k !== m.k));
            await this.sendEvents();
            return reply("Event stopped.");
        }
        if (op === "treePass") { // the password that lets another PC be Tree (empty turns it off)
            const pass = typeof m.pass === "string" ? m.pass : "";
            if (!pass) { await this.ctx.storage.delete("treePass"); return reply("Tree password removed: only the key can be Tree now."); }
            if (pass.length < 6 || pass.length > 64) return reply("The Tree password needs 6 to 64 characters.");
            const salt = crypto.randomUUID();
            await this.ctx.storage.put("treePass", { salt, hash: await sha(salt + pass) });
            await this.ctx.storage.delete("treeFails");
            return reply("Tree password set.");
        }
        if (op === "treeFree") { // frees a Tree slot (k: the last 4 of its PC's id, or "*")
            const devs = (await this.ctx.storage.get("treeDevs")) || [], left = devs.filter(d => !(m.k === "*" || d.h.slice(-4) === m.k));
            await this.ctx.storage.put("treeDevs", left);
            return reply(devs.length === left.length ? "That slot's already free." : "Tree slot freed.");
        }
        if (op === "freeName") { // lets someone else have a name a player is holding on to
            const k = nameKey(cleanName(m.name)); if (!k) return reply("Which name?");
            const rec = await this.ctx.storage.get("name:" + k);
            if (!rec) return reply(`Nobody owns "${cleanName(m.name)}".`);
            await this.ctx.storage.delete("name:" + k);
            return reply(`"${rec.name}" is free now.`);
        }
        if (op === "unban") {
            const bans = (await this.ctx.storage.get("bans")) || {};
            for (const k of Object.keys(bans)) if (m.k === "*" || k.slice(-4) === m.k) delete bans[k];
            await this.ctx.storage.put("bans", bans);
            return reply(m.k === "*" ? "Every ban lifted." : "Ban lifted.");
        }
        return reply("Unknown admin command.");
    }

    async webSocketClose(ws, code) { this.gone(ws, code); }
    async webSocketError(ws) { this.gone(ws, 1011); }
    gone(ws, code) {
        const a = ws.deserializeAttachment();
        try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye"); } catch (e) { /* already closed */ }
        if (a && a.joined) { const msg = JSON.stringify({ t: "leave", id: a.id }); for (const p of this.players()) if (p.w !== ws) this.send(p.w, msg); }
        if (a) { a.joined = false; try { ws.serializeAttachment(a); } catch (e) { /* closed */ } }
        if (a && a.crew) this.crewTell(a.crew).catch(() => {}); // their crew sees them go offline
        if (a && a.trade) this.ctx.storage.get("trade:" + a.trade).then(tr => tr && this.tradeEnd(tr, `${a.name} left, so the trade is off.`)).catch(() => {});
    }
}

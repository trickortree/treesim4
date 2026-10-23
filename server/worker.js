// Tree Sim 4 public server (2.0.0), on Cloudflare Workers. One Durable Object, "Lobby", holds everyone's
// connection and passes along where each player is to the others on the same island, and the chat.
// Nothing is saved here: every player's progress stays in their own game.
// Deploy from this folder: npx wrangler deploy   (run npx wrangler dev to try it locally on ws://localhost:8787/play)
// Admin (announcements, kick, ban, mute, the message of the day) needs the ADMIN_KEY secret: npx wrangler secret put ADMIN_KEY.
// The key lives only in Cloudflare and on the admin's own PC (admin.key.js, which git ignores); the game never ships it.
import { DurableObject } from "cloudflare:workers";

const MAX_PLAYERS = 40;
const MOTD = "Welcome to the Tree Sim 4 public server! Press T to chat, hold Tab to see who's here.";
const HATS = ["", "hood", "cap", "beanie", "bandana", "straw", "top", "helmet", "horns", "crown"];
const CORS = { "access-control-allow-origin": "*" };

const int = (v, lo, hi, d = lo) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);
const num = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : null);
const cleanName = s => String(s || "").replace(/[^A-Za-z0-9 _\-]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
const cleanText = s => [...String(s || "")].filter(c => { const k = c.charCodeAt(0); return k >= 32 && k !== 127 && k !== 0x2028 && k !== 0x2029; }).join("").replace(/\s+/g, " ").trim().slice(0, 140); // no control characters or line breaks
function cleanLook(l) {
    l = l && typeof l === "object" ? l : {};
    const col = v => int(v, 0, 0xffffff, 0x888888);
    return { skin: col(l.skin), shirt: col(l.shirt), pants: col(l.pants), hat: HATS.includes(l.hat) ? l.hat : "", hatCol: col(l.hatCol) };
}
function cleanState(m) {
    const x = num(m.x, -9000, 9000), y = num(m.y, -500, 2000), z = num(m.z, -9000, 9000);
    if (x === null || y === null || z === null) return null;
    const pets = Array.isArray(m.pets) ? m.pets.slice(0, 3).map(k => String(k).replace(/[^a-z]/g, "").slice(0, 12)).filter(Boolean) : [];
    const shiny = Array.isArray(m.shiny) ? m.shiny.slice(0, 3).map(v => (v ? 1 : 0)) : [];
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100, yaw: num(m.yaw, -100, 100) || 0, pitch: num(m.pitch, -3, 3) || 0,
        sw: m.sw ? 1 : 0, axe: int(m.axe, 0, 99), isle: int(m.isle, 1, 99, 1), pets, shiny };
}
const pub = a => ({ id: a.id, name: a.name, isle: a.isle, look: a.look, st: a.st, admin: a.admin ? 1 : 0 });
const NEWS_FOR = 15 * 60 * 1000; // an announcement still shows on the menu and to new arrivals for 15 minutes
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
            return Response.json({ online: ps.length, max: MAX_PLAYERS, names: ps.map(p => p.a.name).slice(0, MAX_PLAYERS), motd: await this.motd(), news: await this.news() }, { headers: CORS });
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
    async news() { const n = await this.ctx.storage.get("news"); return n && Date.now() - n.at < NEWS_FOR ? n : null; }
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
            a.name = cleanName(m.name) || "Woodcutter";
            a.look = cleanLook(m.look);
            a.st = cleanState(m.st || {}) || null;
            a.isle = a.st ? a.st.isle : int(m.isle, 1, 99, 1);
            a.joined = true;
            ws.serializeAttachment(a);
            const others = this.players().filter(p => p.w !== ws);
            this.send(ws, { t: "welcome", id: a.id, motd: await this.motd(), news: await this.news(), players: others.map(p => pub(p.a)) });
            const j = JSON.stringify({ t: "join", ...pub(a) });
            for (const p of others) this.send(p.w, j);
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
        if (m.t === "ping") { ws.serializeAttachment(a); this.send(ws, { t: "pong", ts: num(m.ts, 0, 1e15) }); return; }
        ws.serializeAttachment(a);
    }

    // ---------- admin: every message carries the key, so nothing depends on the connection surviving a sleep ----------
    async admin(ws, a, m) {
        if (!(await keyOk(this.env, m.key))) {
            a.bad = (a.bad || 0) + 1; ws.serializeAttachment(a);
            this.send(ws, { t: "adminErr", op: m.op, text: "Wrong admin key." });
            if (a.bad >= 3) try { ws.close(4004, "bad key"); } catch (e) { /* gone */ }
            return;
        }
        const reply = async (text = "") => {
            const bans = (await this.ctx.storage.get("bans")) || {};
            this.send(ws, { t: "adminOk", op: m.op, text, motd: await this.motd(), news: await this.news(), bans: Object.entries(bans).map(([k, b]) => ({ k: k.slice(-4), name: b.name, at: b.at })),
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
            await this.ctx.storage.put("news", { text, at: Date.now() });
            this.everyone({ t: "announce", text });
            return reply(`Announced to ${this.players().length} player(s).`);
        }
        if (op === "clearNews") { await this.ctx.storage.delete("news"); return reply("Announcement cleared."); }
        if (op === "motd") {
            const text = cleanText(m.text).slice(0, 200);
            if (text) await this.ctx.storage.put("motd", text); else await this.ctx.storage.delete("motd");
            return reply(text ? "Message of the day set." : "Message of the day back to the default.");
        }
        const p = this.players().find(q => q.a.id === m.id);
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
    }
}

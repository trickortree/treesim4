// Studio intro: "TREE CHOP STUDIOS" is signed out stroke by stroke (SVG stroke-dashoffset
// draw-on, same technique as the CodePen "Animated signing of signature" idea), the P in CHOP
// is an axe, the axe chops the screen, then we fade into the game.

const NS = "http://www.w3.org/2000/svg";
const HANDLE = "#c58a4e", INK = "#ffd040", STEEL = "#cfd8ee";

// single-stroke letters on a 80-tall grid. w = advance width.
const L = {
    T: { w: 50, s: ["M0,4 L50,4", "M25,4 L25,80"] },
    R: { w: 50, s: ["M4,80 L4,2", "M4,2 L28,2 C52,2 52,42 28,42 L4,42", "M26,42 L48,80"] },
    E: { w: 46, s: ["M46,4 L4,4 L4,80 L46,80", "M4,42 L36,42"] },
    C: { w: 50, s: ["M46,16 C34,-2 4,0 4,40 C4,80 34,82 46,64"] },
    H: { w: 50, s: ["M4,2 L4,80", "M46,2 L46,80", "M4,42 L46,42"] },
    O: { w: 52, s: ["M26,2 C58,2 58,78 26,78 C-6,78 -6,2 26,2 Z"] },
    // the P is an axe: wooden handle + steel head where the bowl would be
    P: { w: 56, s: [
        { d: "M14,-10 L14,92", c: HANDLE, sw: 8 },
        { d: "M14,6 C32,-6 46,-4 54,0 C45,14 45,32 54,46 C46,52 28,50 14,38 Z", c: "#eef3ff", sw: 4, head: true }
    ] },
    S: { w: 48, s: ["M44,14 C38,-2 6,0 6,22 C6,42 44,36 44,58 C44,82 8,82 2,66"] },
    U: { w: 50, s: ["M4,2 L4,56 C4,88 46,88 46,56 L46,2"] },
    D: { w: 54, s: ["M4,2 L4,80 L22,80 C62,80 62,2 22,2 L4,2"] },
    I: { w: 30, s: ["M15,4 L15,80"] }
};

const LINES = [
    { text: "TREE CHOP", y: 30 },
    { text: "STUDIOS", y: 150 }
];
const GAP = 16, WORD_GAP = 46, VBW = 640, VBH = 270;

function lineWidth(text) {
    let w = 0;
    for (const ch of text) w += ch === " " ? WORD_GAP : L[ch].w + GAP;
    return w - GAP;
}

function build(svg) {
    const strokes = [];
    for (const line of LINES) {
        let x = (VBW - lineWidth(line.text)) / 2;
        for (const ch of line.text) {
            if (ch === " ") { x += WORD_GAP; continue; }
            const g = document.createElementNS(NS, "g");
            g.setAttribute("transform", `translate(${x},${line.y})`);
            for (const st of L[ch].s) {
                const o = typeof st === "string" ? { d: st } : st;
                const p = document.createElementNS(NS, "path");
                p.setAttribute("d", o.d);
                p.setAttribute("fill", "none");
                p.setAttribute("stroke", o.c || INK);
                p.setAttribute("stroke-width", o.sw || 6);
                p.setAttribute("stroke-linecap", "round");
                p.setAttribute("stroke-linejoin", "round");
                g.appendChild(p);
                strokes.push({ p, head: !!o.head });
            }
            svg.appendChild(g);
            x += L[ch].w + GAP;
        }
    }
    return strokes;
}

function sfx(freq, dur, type, vol, slide) {
    try {
        const a = (sfx.ctx ||= new AudioContext());
        const o = a.createOscillator(), g = a.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, a.currentTime);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), a.currentTime + dur);
        g.gain.setValueAtTime(vol, a.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
        o.connect(g).connect(a.destination);
        o.start();
        o.stop(a.currentTime + dur);
    } catch (e) { /* audio is optional */ }
}

const intro = document.getElementById("intro");
const svg = document.getElementById("introSvg");
const flash = document.getElementById("introFlash");
const timers = [];
let finished = false;

function finish() {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    intro.classList.add("out");
    setTimeout(() => intro.remove(), 1300);
    window.removeEventListener("mousedown", skip, true);
    window.removeEventListener("keydown", skip, true);
}
function skip(e) { e.stopImmediatePropagation(); finish(); }
window.addEventListener("mousedown", skip, true);
window.addEventListener("keydown", skip, true);

svg.setAttribute("viewBox", `0 0 ${VBW} ${VBH}`);
const strokes = build(svg);

// the slash that comes from the axe at the end
const slash = document.createElementNS(NS, "path");
slash.setAttribute("d", "M-20,20 L330,120 L660,250");
slash.setAttribute("fill", "none");
slash.setAttribute("stroke", "#fff");
slash.setAttribute("stroke-width", "5");
slash.setAttribute("stroke-linecap", "round");
svg.appendChild(slash);

// same trick as the pen: dasharray = dashoffset = length, then transition offset to 0, one stroke after another
let delay = 400, prev = 0;
let headDone = 0;
for (const s of strokes) {
    const len = s.p.getTotalLength();
    const dur = Math.max(140, Math.round(len * 1.1));
    delay += prev + 60;
    prev = dur;
    s.p.style.transition = "none";
    s.p.setAttribute("stroke-dasharray", `${len},${len}`);
    s.p.setAttribute("stroke-dashoffset", len);
    s.len = len; s.dur = dur; s.delay = delay;
    if (s.head) {
        s.p.setAttribute("fill", STEEL);
        s.p.setAttribute("fill-opacity", "0");
        headDone = delay + dur;
    }
}
const slashLen = slash.getTotalLength();
slash.setAttribute("stroke-dasharray", `${slashLen},${slashLen}`);
slash.setAttribute("stroke-dashoffset", slashLen);
slash.style.transition = "none";
slash.style.opacity = "0";
const drawEnd = delay + prev;

svg.getBoundingClientRect(); // commit the starting state before animating

for (const s of strokes) {
    const t = [`stroke-dashoffset ${s.dur}ms ${s.delay}ms linear`];
    if (s.head) t.push(`fill-opacity 500ms ${s.delay + s.dur}ms ease-out`);
    s.p.style.transition = t.join(", ");
    s.p.setAttribute("stroke-dashoffset", "0");
    if (s.head) s.p.setAttribute("fill-opacity", "1");
}

// chop: slash, flash, shake, thunk, then fade into the game
timers.push(setTimeout(() => {
    sfx(900, 0.18, "sawtooth", 0.05, 0.2);
    slash.style.opacity = "1";
    slash.style.transition = "stroke-dashoffset 220ms ease-in";
    slash.setAttribute("stroke-dashoffset", "0");
}, drawEnd + 500));
timers.push(setTimeout(() => {
    sfx(110, 0.45, "square", 0.22, 0.25);
    sfx(60, 0.5, "sawtooth", 0.18, 0.3);
    flash.style.transition = "none";
    flash.style.opacity = "1";
    flash.getBoundingClientRect();
    flash.style.transition = "opacity 700ms ease-out";
    flash.style.opacity = "0";
    svg.classList.add("shake");
    slash.style.transition = "opacity 500ms";
    slash.style.opacity = "0";
}, drawEnd + 740));
timers.push(setTimeout(finish, drawEnd + 1900));

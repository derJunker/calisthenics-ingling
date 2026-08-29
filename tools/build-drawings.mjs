/* ---------------------------------------------------------------
   build-drawings.mjs   —   npm run build:drawings

   Liest src/drawings.json und erzeugt daraus

     public/styles/drawings.generated.css   Keyframes, Platzierung, Fokus
     public/index.html                      den SVG-Block zwischen den
                                            beiden drawings-Markern

   Beide Ausgaben sind generiert: nicht von Hand ändern, sondern die
   JSON anfassen und den Task erneut laufen lassen.

   Die Bildmaße kommen aus der Datei selbst, nicht aus der Konfiguration
   — ein neu gerendertes Sheet mit anderer Größe passt damit von allein,
   und eine falsche Bildbreite kann gar nicht erst in die CSS geraten.
   --------------------------------------------------------------- */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(ROOT, "src/drawings.json");
const CSS_OUT = join(ROOT, "public/styles/drawings.generated.css");
const HTML = join(ROOT, "public/index.html");
const ASSETS = join(ROOT, "public/assets");

const BEGIN = "<!-- drawings:begin -->";
const END = "<!-- drawings:end -->";

/* die viewBox des Hintergrund-SVG; Fokus und Platzierung rechnen darin */
const VIEW_W = 1600;
const VIEW_H = 1200;
const CENTER = { x: VIEW_W / 2, y: VIEW_H / 2, zoom: 1 };

const fail = (msg) => { console.error(`drawings: ${msg}`); process.exit(1); };
const warn = (msg) => console.warn(`drawings: ${msg}`);

/* Das Foto füllt den Bildschirm per "slice", also füllt immer mindestens
   eine Achse genau aus — welche, hängt am Seitenverhältnis des Fensters
   und steht hier noch nicht fest. Verschieben lässt sich der Ausschnitt
   deshalb nur so weit, wie der Zoom auf der *ungeschnittenen* Achse Luft
   lässt; alles darüber zeigt am Rand die weiße Seite. Wer schieben will,
   muss also zoomen: bei zoom 1 ist die Mitte die einzig sichere Lage. */
function clampFocus(where, f) {
    const zoom = f.zoom ?? 1;
    if (zoom < 1) fail(`${where}: zoom ${zoom} ist kleiner als 1, das Foto deckt den Rand nicht mehr`);

    const fit = (value, extent, axis) => {
        const slack = extent / 2 / zoom;
        const min = slack;
        const max = extent - slack;
        const held = Math.min(Math.max(value, min), max);
        if (Math.abs(held - value) > 0.5) warn(
            `${where}: ${axis} ${value} zeigt bei zoom ${zoom} über den Bildrand hinaus, ` +
            `festgehalten bei ${Math.round(held)} (erlaubt ${Math.round(min)}–${Math.round(max)}; ` +
            `mehr zoom gibt mehr Spielraum)`
        );
        return held;
    };

    return { x: fit(f.x, VIEW_W, "x"), y: fit(f.y, VIEW_H, "y"), zoom };
}

/* ---------- Bildmaße aus dem Dateikopf ---------- */

function pngSize(buf) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/* RIFF-Container: nach "WEBP" folgen Chunks aus 4 Byte Typ, 4 Byte Länge
   und der (auf gerade Länge gepolsterten) Nutzlast. Die Maße stehen je
   nach Kodierung an drei verschiedenen Stellen. */
function webpSize(buf) {
    let at = 12;
    while (at + 8 <= buf.length) {
        const type = buf.toString("ascii", at, at + 4);
        const size = buf.readUInt32LE(at + 4);
        const body = at + 8;

        if (type === "VP8X") return {
            width: buf.readUIntLE(body + 4, 3) + 1,
            height: buf.readUIntLE(body + 7, 3) + 1,
        };
        if (type === "VP8L") {
            /* 1 Byte Signatur, dann 14 Bit Breite-1 und 14 Bit Höhe-1 */
            const bits = buf.readUInt32LE(body + 1);
            return {
                width: (bits & 0x3fff) + 1,
                height: ((bits >> 14) & 0x3fff) + 1,
            };
        }
        if (type === "VP8 ") return {
            width: buf.readUInt16LE(body + 6) & 0x3fff,
            height: buf.readUInt16LE(body + 8) & 0x3fff,
        };

        at = body + size + (size % 2);
    }
    fail("WebP ohne lesbaren Bild-Chunk");
}

function imageSize(file) {
    let buf;
    try {
        buf = readFileSync(join(ASSETS, file));
    } catch {
        fail(`public/assets/${file} fehlt`);
    }
    if (buf.toString("ascii", 0, 4) === "\x89PNG") return pngSize(buf);
    if (buf.toString("ascii", 0, 4) === "RIFF" &&
        buf.toString("ascii", 8, 12) === "WEBP") return webpSize(buf);
    fail(`${file}: weder PNG noch WebP`);
}

/* ---------- Konfiguration ---------- */

const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
const breakpoint = cfg.mobileBreakpoint ?? 768;

const sprites = Object.entries(cfg.sprites ?? {}).map(([name, s]) => {
    const { width, height } = imageSize(s.file);
    const frames = s.frames;

    if (!Number.isInteger(frames) || frames < 2) fail(`${name}: "frames" fehlt oder ist < 2`);
    if (width % frames) fail(
        `${name}: ${s.file} ist ${width}px breit, das sind bei ${frames} Frames ` +
        `keine ganzen ${width / frames}px pro Frame`
    );

    const frameWidth = width / frames;
    const pingpong = (s.mode ?? "pingpong") === "pingpong";
    /* Ping-Pong zeigt den ersten und letzten Frame nur einmal pro Wende,
       läuft also über 2*(n-1) Schritte statt über 2n */
    const steps = pingpong ? frames - 1 : frames;

    return {
        name, file: s.file, invert: !!s.invert,
        frames, frameWidth, frameHeight: height, sheetWidth: width, pingpong, steps,
        duration: ((pingpong ? 2 * steps : steps) / (s.fps ?? 12)).toFixed(4),
        travel: steps * frameWidth,
    };
});

const spriteByName = new Map(sprites.map((s) => [s.name, s]));

const sections = Object.entries(cfg.sections ?? {}).map(([id, sec]) => ({
    id,
    focus: clampFocus(`Abschnitt "${id}" focus`, sec.focus ?? CENTER),
    focusMobile: clampFocus(`Abschnitt "${id}" focusMobile`, sec.focusMobile ?? sec.focus ?? CENTER),
    animations: (sec.animations ?? []).map((a, i) => {
        const sprite = spriteByName.get(a.sprite);
        if (!sprite) fail(`Abschnitt "${id}": Sprite "${a.sprite}" ist nicht definiert`);
        return { ...a, sprite, section: id, key: `${id}-${i}` };
    }),
}));

if (!sections.length) fail("keine Abschnitte konfiguriert");

/* ---------- CSS ---------- */

/* Punkt (x|y) in die Mitte der viewBox holen und dabei zoomen.
   transform-origin liegt auf 0 0, die Reihenfolge liest sich von rechts:
   erst den Fokuspunkt auf den Ursprung, dann skalieren, dann zur Mitte. */
const stage = (f) =>
    `translate(${VIEW_W / 2}px, ${VIEW_H / 2}px) scale(${f.zoom ?? 1}) ` +
    `translate(${-f.x}px, ${-f.y}px)`;

const place = (a) =>
    `translate(${a.x}px, ${a.y}px) scale(${(a.height / a.sprite.frameHeight).toFixed(6)})`;

const css = `/* GENERIERT von tools/build-drawings.mjs — nicht von Hand ändern.
   Quelle: src/drawings.json, danach \`npm run build:drawings\`. */

/* ---------- Bildausschnitt pro Abschnitt ----------
   .bg-stage trägt Foto und Zeichnungen gemeinsam, beide bleiben also
   in jedem Ausschnitt zueinander an Ort und Stelle. Ohne JavaScript
   fehlt data-section nie: das Markup liefert den ersten Abschnitt mit. */

.bg-stage {
    transform-origin: 0 0;
    transform: ${stage(sections[0].focus)};
    transition: transform 1.1s cubic-bezier(.4, 0, .2, 1);
}

${sections.map((s) => `.bg-cnt[data-section="${s.id}"] .bg-stage { transform: ${stage(s.focus)}; }`).join("\n")}

@media (max-width: ${breakpoint}px) {
    .bg-stage { transform: ${stage(sections[0].focusMobile)}; }

${sections.map((s) => `    .bg-cnt[data-section="${s.id}"] .bg-stage { transform: ${stage(s.focusMobile)}; }`).join("\n")}
}

/* ---------- Zeichnungen ----------
   Sichtbar ist nur, was zum aktuellen Abschnitt gehört; alles andere
   steht still, statt unsichtbar weiterzulaufen. */

.dw {
    opacity: 0;
    transition: opacity .6s ease;
    pointer-events: none;
}

.dw-frames {
    animation-play-state: paused;
}

${sections.filter((s) => s.animations.length).map((s) => `.bg-cnt[data-section="${s.id}"] [data-dw-section="${s.id}"] { opacity: 1; }
.bg-cnt[data-section="${s.id}"] [data-dw-section="${s.id}"] .dw-frames { animation-play-state: running; }`).join("\n")}

/* ---------- Platzierung der einzelnen Zeichnungen ----------
   transform statt x/y/width/height: die CSS-Geometrie-Eigenschaften
   ignoriert Firefox auf einem verschachtelten <svg> noch. */

${sections.flatMap((s) => s.animations).map((a) => `[data-dw="${a.key}"] { transform-origin: 0 0; transform: ${place(a)}; }`).join("\n")}

/* ---------- Laufbilder ---------- */

${sprites.map((s) => `.dw-frames--${s.name} {
    ${s.invert ? "/* schwarze Tinte auf dunklem Foto — invertiert wird sie weiß.\n       Für die Originalstriche \"invert\" in der JSON auf false setzen. */\n    filter: invert(1);\n    " : ""}animation: dw-${s.name} ${s.duration}s steps(${s.steps}) infinite;
}`).join("\n\n")}

${sprites.map((s) => s.pingpong
    ? `/* hin bis zum letzten Frame und zurück — kein Sprung am Schleifenende.
   steps() gilt je Keyframe-Abschnitt, jede Hälfte läuft also ${s.steps} Frames. */
@keyframes dw-${s.name} {
    from { transform: translateX(0); }
    50%  { transform: translateX(-${s.travel}px); }
    to   { transform: translateX(0); }
}`
    : `@keyframes dw-${s.name} {
    from { transform: translateX(0); }
    to   { transform: translateX(-${s.travel}px); }
}`).join("\n\n")}

/* Ohne Bewegung: der erste Frame bleibt stehen, der Ausschnitt springt
   ohne Überblendung. */
@media (prefers-reduced-motion: reduce) {
    .dw-frames { animation: none; }
    .bg-stage { transition: none; }
    .dw { transition: none; }
}
`;

writeFileSync(CSS_OUT, css);

/* ---------- Markup ---------- */

const markup = `${BEGIN}
<!-- GENERIERT von tools/build-drawings.mjs — nicht von Hand ändern.
     Quelle: src/drawings.json, danach \`npm run build:drawings\`. -->
<div class="bg-cnt" data-section="${sections[0].id}" data-controller="background">
    <svg class="bg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g class="bg-stage">
            <image href="./assets/teaser.jpeg" width="${VIEW_W}" height="${VIEW_H}"
                   preserveAspectRatio="xMidYMid slice"/>
${sections.flatMap((s) => s.animations).map((a) => `            <g class="dw" data-dw="${a.key}" data-dw-section="${a.section}">
                <svg width="${a.sprite.frameWidth}" height="${a.sprite.frameHeight}"
                     viewBox="0 0 ${a.sprite.frameWidth} ${a.sprite.frameHeight}" overflow="hidden">
                    <image class="dw-frames dw-frames--${a.sprite.name}" href="./assets/${a.sprite.file}"
                           width="${a.sprite.sheetWidth}" height="${a.sprite.frameHeight}"/>
                </svg>
            </g>`).join("\n")}
        </g>
    </svg>
</div>
${END}`;

const html = readFileSync(HTML, "utf8");
const from = html.indexOf(BEGIN);
const to = html.indexOf(END);
if (from < 0 || to < 0) fail(`${BEGIN} / ${END} fehlen in public/index.html`);

writeFileSync(HTML, html.slice(0, from) + markup + html.slice(to + END.length));

const count = sections.reduce((n, s) => n + s.animations.length, 0);
console.log(
    `drawings: ${sprites.length} Sprite(s), ${sections.length} Abschnitte, ` +
    `${count} Platzierung(en) -> drawings.generated.css + index.html`
);

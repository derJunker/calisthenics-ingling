import { gsap } from "gsap";

/* Der Weg auf der Karte im Abschnitt „Komm Vorbei".

   Gezeichnet wird von hinten nach vorne: die Gruppen im SVG stehen in
   der Reihenfolge Ziel -> Start, gespielt wird umgekehrt, damit der
   Strich am ZOB losläuft und am Park ankommt. Innerhalb einer Gruppe
   läuft alles der Reihe nach, wie es im SVG steht — eine Untergruppe
   (etwa das Schild „End") ist ein Element und blendet komplett auf
   einmal auf.

   Was kommt wie: ein <path> zeichnet sich am eigenen Strich entlang,
   alles andere blendet von unten auf. Zwischen zwei Etappen liegt eine
   längere Pause als zwischen den Teilen einer Etappe. */

const SECTION_GAP = 0.45;
const STEP_GAP = 0.12;

/* gleiche gefühlte Zeichengeschwindigkeit für kurze wie lange Wege:
   die Dauer hängt an der Länge des Strichs (Einheiten der viewBox pro
   Sekunde), bleibt aber in einem Rahmen, in dem sie noch lesbar ist */
const DRAW_SPEED = 320;
const DRAW_MIN = 0.35;
const DRAW_MAX = 2.4;

const FADE_DURATION = 0.5;

function drawPath(tl, path, at) {
    const length = path.getTotalLength();
    const duration = gsap.utils.clamp(DRAW_MIN, DRAW_MAX, length / DRAW_SPEED);

    tl.fromTo(path, {
        strokeDasharray: length,
        strokeDashoffset: length,
    }, {
        strokeDashoffset: 0,
        duration,
        ease: "none",
    }, at);

    return duration;
}

/* y relativ („+=10"), nicht absolut: die Gruppen im SVG sitzen auf
   eigenen Matrizen — ein festes y würde sie von deren Ursprung aus
   einfliegen lassen statt sie um zehn Einheiten anzuheben. */
function fadeUp(tl, element, at) {
    tl.from(element, {
        opacity: 0,
        y: "+=10",
        duration: FADE_DURATION,
        ease: "power2.out",
    }, at);

    return FADE_DURATION;
}

export function routeMap(section) {
    const tl = gsap.timeline({ paused: true });
    const svg = section.querySelector(".route-map");
    if (!svg) return tl;

    const stages = [...svg.querySelectorAll(":scope > g > g")].reverse();
    let at = 0;

    stages.forEach((stage) => {
        [...stage.children].forEach((element) => {
            if (element.tagName === "title") return;

            at += (element.tagName === "path"
                ? drawPath(tl, element, at)
                : fadeUp(tl, element, at)) + STEP_GAP;
        });

        at += SECTION_GAP;
    });

    return tl;
}

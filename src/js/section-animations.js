import { gsap } from "gsap";

import { textEffects } from "./text-effects";

/* Two intros, both from text-effects.js so tuning them there tunes
   every section at once:
   - headings rise word by word — few words, so the stagger reads;
   - body copy rises line by line — a per-word stagger over a full
     paragraph runs far longer than the text is worth. */
const wordsRise = (targets, speed = 1) =>
    textEffects["words-rise"](targets, speed).paused(false);

const linesRise = (targets, speed = 1) =>
    textEffects["lines-mask"](targets, speed).paused(false);

/* a section need not own every element an animation reaches for — the
   calendar section, say, only fills its .inner later — so an empty
   selection just skips the tween instead of tripping GSAP's warning */
const from = (tl, targets, vars, at) =>
    (targets.length ? tl.from(targets, vars, at) : tl);

function teaser(section) {
    return gsap.timeline({ paused: true })
        .add(wordsRise(section.querySelectorAll("h1"), 0.75), 0);
}

function textReveal(section) {
    const tl = gsap.timeline({ paused: true });

    return from(tl, section.querySelectorAll(".glass"), {
        opacity: 0,
        y: 40,
        scale: 0.96,
        duration: 0.7,
        ease: "power3.out",
    }, 0)
        .add(wordsRise(section.querySelectorAll("h2")), 0.35)
        .add(linesRise(section.querySelectorAll("p")), 0.6);
}

function headingWipe(section) {
    const tl = gsap.timeline({ paused: true })
        .add(wordsRise(section.querySelectorAll("h2")), 0);

    return from(tl, section.querySelectorAll(".inner > :not(h2)"), {
        opacity: 0,
        y: 24,
        duration: 0.6,
        ease: "power2.out",
    }, 0.4);
}

export const sectionAnimations = {
    teaser,
    "text-reveal": textReveal,
    "heading-wipe": headingWipe,
};

/* ---------------------------------------------------------------
   Text effect lab

   A registry of reversible text intros. Every entry gets the element
   it should animate plus a speed multiplier (1 = base tempo, 2 =
   twice as fast) and returns a paused timeline.

   Everything is built with .from()/.fromTo() so the section pilot can
   run the same timeline backwards when a section leaves the viewport.
   --------------------------------------------------------------- */

import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { TextPlugin } from "gsap/TextPlugin";

gsap.registerPlugin(SplitText, ScrambleTextPlugin, TextPlugin);

/* durations are authored at speed 1 and divided by the multiplier, so
   a card can be slowed down or sped up without rewriting the tween */
const timeline = (speed) => {
    const tl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
    tl.d = (seconds) => seconds / speed;
    return tl;
};

/* Splits `el` and adds `from(pieces, vars)` to `tl` — and keeps doing
   so for the life of the page.

   SplitText hands back fresh elements every time it re-splits, and it
   re-splits on its own: whenever a webfont finishes loading, and (for
   line splits) whenever the element's width changes. A tween built
   once from `.lines` therefore ends up pointing at nodes that are no
   longer in the document — it still runs, it just animates nothing,
   which is exactly how body copy stops reacting while the word-split
   headings above it carry on. Building the tween inside `onSplit`
   hands it back to GSAP, which reverts the old one, restores the
   playhead on the new one and keeps the effect alive across reflows. */
const splitFrom = (tl, el, type, mask, vars) => {
    let child;

    SplitText.create(el, {
        type,
        mask: mask ? type : undefined,
        autoSplit: true,
        onSplit: (self) => {
            if (child) tl.remove(child);
            child = gsap.timeline().from(self[type], vars);
            tl.add(child, 0);
            return child;
        },
    });

    return tl;
};

const effects = {
    /* ---------- masked reveals: the text slides out from behind itself ---------- */

    "chars-rise": (el, speed) => {
        const tl = timeline(speed);
        return splitFrom(tl, el, "chars", true, {
            yPercent: 110,
            duration: tl.d(0.7),
            stagger: tl.d(0.03),
            ease: "power4.out",
        });
    },

    "words-rise": (el, speed) => {
        const tl = timeline(speed);
        return splitFrom(tl, el, "words", true, {
            yPercent: 115,
            duration: tl.d(0.8),
            stagger: tl.d(0.07),
            ease: "power4.out",
        });
    },

    "lines-mask": (el, speed) => {
        const tl = timeline(speed);
        return splitFrom(tl, el, "lines", true, {
            yPercent: 100,
            duration: tl.d(0.9),
            stagger: tl.d(0.12),
            ease: "expo.out",
        });
    },

    /* ---------- soft reveals: no mask, the letters fade into place ---------- */

    "chars-blur": (el, speed) => {
        const tl = timeline(speed);
        return splitFrom(tl, el, "chars", false, {
            opacity: 0,
            filter: "blur(10px)",
            duration: tl.d(0.9),
            stagger: { each: tl.d(0.025), from: "random" },
        });
    },

    "blur-focus": (el, speed) => {
        const tl = timeline(speed);
        return tl.from(el, {
            opacity: 0,
            scale: 1.06,
            filter: "blur(18px)",
            duration: tl.d(1.1),
            ease: "power2.out",
        });
    },

    "tracking-in": (el, speed) => {
        const tl = timeline(speed);
        return tl.from(el, {
            opacity: 0,
            letterSpacing: "0.55em",
            filter: "blur(6px)",
            duration: tl.d(1.2),
            ease: "power4.out",
        });
    },

    /* ---------- movement: the letters travel before they settle ---------- */

    "chars-drop": (el, speed) => {
        const tl = timeline(speed);
        return splitFrom(tl, el, "chars", false, {
            yPercent: -140,
            opacity: 0,
            duration: tl.d(0.9),
            stagger: tl.d(0.035),
            ease: "back.out(2)",
        });
    },

    "wave": (el, speed) => {
        const tl = timeline(speed);
        return splitFrom(tl, el, "chars", false, {
            y: 26,
            opacity: 0,
            duration: tl.d(0.8),
            stagger: { each: tl.d(0.04), from: "center" },
            ease: "sine.out",
        });
    },

    "slide-skew": (el, speed) => {
        const tl = timeline(speed);
        return splitFrom(tl, el, "lines", false, {
            xPercent: -12,
            skewY: 6,
            opacity: 0,
            duration: tl.d(0.9),
            stagger: tl.d(0.1),
            ease: "power3.out",
        });
    },

    "flip-x": (el, speed) => {
        const tl = timeline(speed);
        gsap.set(el, { perspective: 500 });
        return splitFrom(tl, el, "chars", false, {
            rotationX: -90,
            transformOrigin: "50% 50% -14px",
            opacity: 0,
            duration: tl.d(0.8),
            stagger: tl.d(0.03),
            ease: "back.out(1.4)",
        });
    },

    "rotate-words": (el, speed) => {
        const tl = timeline(speed);
        return splitFrom(tl, el, "words", false, {
            rotation: 9,
            yPercent: 40,
            opacity: 0,
            transformOrigin: "0% 100%",
            duration: tl.d(0.9),
            stagger: tl.d(0.08),
            ease: "power3.out",
        });
    },

    /* ---------- clip / wipe ---------- */

    "wipe": (el, speed) => {
        const tl = timeline(speed);
        return splitFrom(tl, el, "lines", false, {
            clipPath: "inset(0 100% 0 0)",
            duration: tl.d(1),
            stagger: tl.d(0.14),
            ease: "power2.inOut",
        });
    },

    /* ---------- text content is rewritten, not just moved ---------- */

    "scramble": (el, speed) => {
        const tl = timeline(speed);
        return tl.from(el, {
            duration: tl.d(1.4),
            scrambleText: { text: " ", chars: "upperCase", speed: 0.5, revealDelay: 0 },
            ease: "none",
        });
    },

    "typewriter": (el, speed) => {
        const tl = timeline(speed);
        const text = el.textContent;
        el.classList.add("has-caret");
        return tl.fromTo(el,
            { text: "" },
            { text, duration: tl.d(1.8), ease: "none" });
    },

    "glitch": (el, speed) => {
        const tl = timeline(speed);

        splitFrom(tl, el, "chars", false, {
            opacity: 0,
            x: () => gsap.utils.random(-14, 14),
            y: () => gsap.utils.random(-10, 10),
            skewX: () => gsap.utils.random(-20, 20),
            duration: tl.d(0.35),
            stagger: { each: tl.d(0.012), from: "random" },
            ease: "steps(3)",
        });

        return tl
            .fromTo(el,
                { opacity: 0.4 },
                { opacity: 1, duration: tl.d(0.12), repeat: 2, yoyo: true, ease: "steps(1)" },
                "-=0.2");
    },
};

/* Not every section owns every element an effect targets (the calendar
   only fills its section later, for one). An empty selection is a normal
   state, not a mistake — hand back an empty timeline instead of letting
   GSAP warn about a target it cannot find. */
export const textEffects = Object.fromEntries(
    Object.entries(effects).map(([name, build]) => [
        name,
        (el, speed) => (gsap.utils.toArray(el).length
            ? build(el, speed)
            : gsap.timeline({ paused: true })),
    ])
);

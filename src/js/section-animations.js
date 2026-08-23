import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(SplitText);

function teaser(section) {
    const split = SplitText.create(section.querySelectorAll("h1"), {
        type: "lines",
        mask: "lines",
        autoSplit: true,
    });

    return gsap.timeline({ paused: true })
        .from(split.lines, {
            yPercent: 120,
            rotate: 4,
            duration: 1.1,
            ease: "expo.out",
            stagger: 0.12,
        });
}

function textReveal(section) {
    const heading = SplitText.create(section.querySelectorAll("h2"), {
        type: "chars",
        mask: "chars",
    });
    const body = SplitText.create(section.querySelectorAll("p"), {
        type: "lines",
        mask: "lines",
        autoSplit: true,
    });

    return gsap.timeline({ paused: true, defaults: { ease: "power3.out" } })
        .from(section.querySelectorAll(".glass"), {
            opacity: 0,
            y: 40,
            scale: 0.96,
            duration: 0.7,
        })
        .from(heading.chars, {
            yPercent: 110,
            duration: 0.7,
            stagger: 0.03,
        }, "-=0.35")
        .from(body.lines, {
            yPercent: 100,
            opacity: 0,
            duration: 0.8,
            stagger: 0.08,
        }, "-=0.35");
}

function headingWipe(section) {
    const heading = SplitText.create(section.querySelectorAll("h2"), {
        type: "words",
        mask: "words",
    });

    return gsap.timeline({ paused: true })
        .from(heading.words, {
            yPercent: 110,
            duration: 0.8,
            ease: "power4.out",
            stagger: 0.08,
        })
        .from(section.querySelectorAll(".inner > :not(h2)"), {
            opacity: 0,
            y: 24,
            duration: 0.6,
            ease: "power2.out",
        }, "-=0.4");
}

export const sectionAnimations = {
    teaser,
    "text-reveal": textReveal,
    "heading-wipe": headingWipe,
};

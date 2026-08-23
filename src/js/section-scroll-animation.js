import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { sectionAnimations } from "./section-animations";

gsap.registerPlugin(ScrollTrigger);

export const SECTION_ENTER = "section:enter";
export const SECTION_LEAVE = "section:leave";

function connect(section) {
    const build = sectionAnimations[section.dataset.animation];
    if (!build) return;

    const timeline = build(section);

    section.addEventListener(SECTION_ENTER, () => timeline.timeScale(1).play());
    section.addEventListener(SECTION_LEAVE, () => timeline.timeScale(2).reverse());

    const fire = (type, direction) => () => section.dispatchEvent(
        new CustomEvent(type, { detail: { section, direction } })
    );

    return ScrollTrigger.create({
        trigger: section,
        start: "top 65%",
        end: "bottom 35%",
        onEnter: fire(SECTION_ENTER, 1),
        onEnterBack: fire(SECTION_ENTER, -1),
        onLeave: fire(SECTION_LEAVE, 1),
        onLeaveBack: fire(SECTION_LEAVE, -1),
    });
}

function init() {
    const triggers = gsap.utils.toArray(".scroll-section").map(connect);

    ScrollTrigger.refresh();
    triggers.forEach((trigger) => {
        if (trigger?.isActive) trigger.trigger.dispatchEvent(new CustomEvent(SECTION_ENTER, {
            detail: { section: trigger.trigger, direction: 1 },
        }));
    });
}

if (document.fonts) {
    document.fonts.ready.then(init);
} else {
    window.addEventListener("load", init);
}

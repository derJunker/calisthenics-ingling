/* ---------------------------------------------------------------
   Section scroll pilot

   Replaces CSS scroll-snap. Snapping stays *native scrolling* — we
   only take over the gesture and tween window.scrollY to the next
   stop, then swallow the remaining inertia so a single flick can
   never overshoot a section.

   Deliberate non-goals (accessibility / SEO):
   - the document keeps its normal flow and real scroll offsets, so
     find-in-page, deep links, printing and crawlers are unaffected;
   - anything taller than the viewport (mobile "Anfahrt", zoomed-in
     text) scrolls freely and only snaps at its edges;
   - inner scroll containers keep their own scrolling;
   - prefers-reduced-motion turns the whole thing off — plain native
     scrolling, no hijack, no animation;
   - keyboard, focus and hash navigation move the same way as a
     gesture, and the target section receives focus so screen reader
     and Tab order follow the viewport.
   --------------------------------------------------------------- */

import { gsap } from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";

gsap.registerPlugin(ScrollToPlugin);

const STOP_SELECTOR = ".scroll-section, .site-footer";

const WHEEL_THRESHOLD = 24;   /* accumulated px before a wheel counts as intent */
const GESTURE_IDLE = 160;     /* ms of silence that ends a wheel/inertia gesture */
const SWIPE_THRESHOLD = 56;   /* px of finger travel before a swipe counts */
const EDGE_SLACK = 2;
const DURATION = 0.8;

const KEY_STEPS = {
    ArrowDown: 1, ArrowUp: -1,
    PageDown: 1, PageUp: -1,
};

const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable=false])";
/* space scrolls, unless it is meant to press something */
const PRESSABLE = "a[href], button, summary, [role=button], [role=link]";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

class ScrollPilot {
    constructor() {
        this.stops = Array.from(document.querySelectorAll(STOP_SELECTOR));
        this.animating = false;
        this.idleLocked = false;
        this.wheelAccum = 0;

        this.stops.forEach((stop) => {
            if (!stop.hasAttribute("tabindex")) stop.setAttribute("tabindex", "-1");
        });

        /* the pilot owns scrolling from here on; the CSS smooth behaviour is
           only there for the no-JS / no-pilot case and would fight the tween */
        document.documentElement.style.scrollBehavior = "auto";

        this.onWheel = this.onWheel.bind(this);
        this.onKeydown = this.onKeydown.bind(this);
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchMove = this.onTouchMove.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);
        this.onFocusIn = this.onFocusIn.bind(this);
        this.onClick = this.onClick.bind(this);

        window.addEventListener("wheel", this.onWheel, { passive: false });
        window.addEventListener("keydown", this.onKeydown);
        window.addEventListener("touchstart", this.onTouchStart, { passive: true });
        window.addEventListener("touchmove", this.onTouchMove, { passive: false });
        window.addEventListener("touchend", this.onTouchEnd, { passive: true });
        window.addEventListener("touchcancel", this.onTouchEnd, { passive: true });
        document.addEventListener("focusin", this.onFocusIn);
        document.addEventListener("click", this.onClick);
    }

    destroy() {
        window.removeEventListener("wheel", this.onWheel);
        window.removeEventListener("keydown", this.onKeydown);
        window.removeEventListener("touchstart", this.onTouchStart);
        window.removeEventListener("touchmove", this.onTouchMove);
        window.removeEventListener("touchend", this.onTouchEnd);
        window.removeEventListener("touchcancel", this.onTouchEnd);
        document.removeEventListener("focusin", this.onFocusIn);
        document.removeEventListener("click", this.onClick);

        gsap.killTweensOf(window);
        document.documentElement.style.scrollBehavior = "";
        this.animating = this.idleLocked = false;
    }

    /* ---------- geometry ---------- */

    get maxScroll() {
        return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    }

    /* scroll offsets of every stop, clamped to what is actually reachable */
    offsets() {
        const max = this.maxScroll;
        const seen = new Set();

        return this.stops
            .map((stop) => Math.min(max, Math.round(stop.getBoundingClientRect().top + window.scrollY)))
            .filter((y) => (seen.has(y) ? false : seen.add(y)));
    }

    currentIndex(offsets = this.offsets()) {
        const y = window.scrollY;
        let best = 0;
        offsets.forEach((offset, i) => {
            if (Math.abs(offset - y) < Math.abs(offsets[best] - y)) best = i;
        });
        return best;
    }

    /* is there still a screenful of this section left in that direction? */
    hasRoomWithinStop(direction) {
        const y = window.scrollY;
        const offsets = this.offsets();
        /* dvh-vs-innerHeight rounding and mobile URL bars make sections a few
           px taller than the viewport — don't read that as "more to see" */
        const screen = window.innerHeight + Math.max(24, window.innerHeight * 0.08);

        if (direction > 0) {
            const next = offsets.find((offset) => offset > y + EDGE_SLACK);
            if (next === undefined) return y < this.maxScroll - EDGE_SLACK;
            return next - y > screen;
        }

        const prev = offsets.filter((offset) => offset < y - EDGE_SLACK).pop();
        if (prev === undefined) return false;
        return y - prev > screen;
    }

    /* nearest scrollable ancestor that can still move in that direction */
    scrollsInternally(target, direction) {
        for (let el = target; el instanceof Element && el !== document.body; el = el.parentElement) {
            const { scrollHeight, clientHeight, scrollTop } = el;
            if (scrollHeight - clientHeight <= EDGE_SLACK) continue;

            const overflow = getComputedStyle(el).overflowY;
            if (overflow !== "auto" && overflow !== "scroll") continue;

            if (direction > 0 && scrollTop < scrollHeight - clientHeight - EDGE_SLACK) return true;
            if (direction < 0 && scrollTop > EDGE_SLACK) return true;
        }
        return false;
    }

    /* ---------- navigation ---------- */

    get locked() {
        return this.animating || this.idleLocked;
    }

    step(direction) {
        const offsets = this.offsets();
        this.go(this.currentIndex(offsets) + direction, offsets);
    }

    go(index, offsets = this.offsets()) {
        const clamped = Math.max(0, Math.min(offsets.length - 1, index));
        const y = offsets[clamped];
        const stop = this.stops[clamped];

        if (Math.abs(y - window.scrollY) < 1) return;

        this.animating = true;
        this.idleLocked = true;

        gsap.to(window, {
            duration: DURATION,
            ease: "power3.inOut",
            overwrite: true,
            scrollTo: { y, autoKill: false },
            onComplete: () => {
                this.animating = false;
                this.settle(stop);
                this.releaseWhenIdle();
            },
        });

        this.releaseWhenIdle();
    }

    /* hand the section to assistive tech / the Tab order, and keep the URL
       shareable — without moving the viewport we just animated */
    settle(stop) {
        if (!stop) return;

        stop.focus({ preventScroll: true });

        if (stop.id && stop.id !== window.location.hash.slice(1)) {
            window.history.replaceState(null, "", `#${stop.id}`);
        }
    }

    /* stay locked until the input stream (trackpad inertia) has gone quiet */
    releaseWhenIdle() {
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            if (this.animating) return this.releaseWhenIdle();
            this.idleLocked = false;
            this.wheelAccum = 0;
        }, GESTURE_IDLE);
    }

    /* ---------- input ---------- */

    onWheel(event) {
        if (event.ctrlKey) return;                     /* pinch zoom */

        const direction = Math.sign(event.deltaY);
        if (!direction) return;

        if (this.locked) {
            event.preventDefault();                    /* swallow the inertia tail */
            this.releaseWhenIdle();
            return;
        }

        if (this.scrollsInternally(event.target, direction)) return;
        if (this.hasRoomWithinStop(direction)) return;

        event.preventDefault();

        this.wheelAccum += event.deltaY;
        if (Math.abs(this.wheelAccum) < WHEEL_THRESHOLD) return;

        this.wheelAccum = 0;
        this.step(direction);
    }

    onKeydown(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.target instanceof Element && event.target.closest(TYPING)) return;

        let step = KEY_STEPS[event.key];

        if ((event.key === " " || event.key === "Spacebar")
            && !(event.target instanceof Element && event.target.closest(PRESSABLE))) {
            step = event.shiftKey ? -1 : 1;
        }

        if (step) {
            if (this.scrollsInternally(event.target, step)) return;
            if (!this.locked && this.hasRoomWithinStop(step)) return;

            event.preventDefault();
            if (!this.locked) this.step(step);
            return;
        }

        if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            this.go(event.key === "Home" ? 0 : this.stops.length - 1);
        }
    }

    onTouchStart(event) {
        this.touch = event.touches.length === 1
            ? { x: event.touches[0].clientX, y: event.touches[0].clientY, free: false, done: false }
            : null;
    }

    onTouchMove(event) {
        if (!this.touch || event.touches.length > 1) return;

        const delta = this.touch.y - event.touches[0].clientY;
        const direction = Math.sign(delta);

        /* a sideways drag belongs to whatever it started on — the hour
           rail, say. Swallowing it here would leave those boxes
           unreachable by finger. */
        if (!this.touch.free && Math.abs(this.touch.x - event.touches[0].clientX) > Math.abs(delta)) {
            this.touch.free = true;
            return;
        }

        if (this.locked) {
            event.preventDefault();
            return;
        }
        if (this.touch.done || this.touch.free) return;

        if (this.scrollsInternally(event.target, direction) || this.hasRoomWithinStop(direction)) {
            this.touch.free = true;
            return;
        }

        event.preventDefault();

        if (Math.abs(delta) < SWIPE_THRESHOLD) return;

        this.touch.done = true;
        this.step(direction);
    }

    onTouchEnd() {
        this.touch = null;
    }

    onFocusIn(event) {
        if (this.animating) return;

        const stop = event.target instanceof Element && event.target.closest(STOP_SELECTOR);
        if (!stop) return;

        const index = this.stops.indexOf(stop);
        const offsets = this.offsets();
        if (index < 0 || index === this.currentIndex(offsets)) return;

        this.go(index, offsets);
    }

    /* in-page links (nav, brand, skip link) travel the same way */
    onClick(event) {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

        const link = event.target instanceof Element && event.target.closest('a[href^="#"]');
        if (!link) return;

        const id = link.getAttribute("href").slice(1);
        const target = id && document.getElementById(id);
        if (!target) return;

        const stop = target.closest(STOP_SELECTOR);
        const index = stop ? this.stops.indexOf(stop) : -1;
        if (index < 0) return;

        event.preventDefault();
        window.history.pushState(null, "", `#${id}`);
        this.go(index);
    }
}

let pilot = null;

function sync() {
    if (reducedMotion.matches) {
        pilot?.destroy();
        pilot = null;
        return;
    }
    pilot ||= new ScrollPilot();
}

sync();
reducedMotion.addEventListener("change", sync);

import { Controller } from "@hotwired/stimulus"

const DOCK_AT = 24;

export default class extends Controller {
    static targets = ["link", "toggle"]

    connect() {
        this.sections = this.linkTargets
            .map((link) => document.querySelector(link.getAttribute("href")))
            .filter(Boolean);

        this.linkTargets.forEach((link, i) => link.style.setProperty("--i", String(i)));

        this.onScroll = this.onScroll.bind(this);
        this.onResize = this.onResize.bind(this);
        this.onKeydown = this.onKeydown.bind(this);
        this.onPointerDown = this.onPointerDown.bind(this);

        window.addEventListener("scroll", this.onScroll, { passive: true });
        window.addEventListener("resize", this.onResize);
        document.addEventListener("keydown", this.onKeydown);
        document.addEventListener("pointerdown", this.onPointerDown);

        this.onScroll();
    }

    disconnect() {
        window.removeEventListener("scroll", this.onScroll);
        window.removeEventListener("resize", this.onResize);
        document.removeEventListener("keydown", this.onKeydown);
        document.removeEventListener("pointerdown", this.onPointerDown);
    }

    /* ---------- docking ---------- */

    onScroll() {
        const docked = window.scrollY > DOCK_AT;

        if (docked !== this.docked) {
            this.docked = docked;
            this.element.classList.toggle("is-docked", docked);
        }

        this.updateActive();
    }

    onResize() {
        this.close();
    }

    /* ---------- active section ---------- */

    /* whichever section has crossed the 40% line last is the one you're on */
    updateActive() {
        const line = window.innerHeight * 0.4;

        let current = this.sections[0];
        for (const section of this.sections) {
            if (section.getBoundingClientRect().top <= line) current = section;
        }
        if (!current || current === this.current) return;

        this.current = current;
        this.linkTargets.forEach((link) => link.classList.toggle(
            "is-active", link.getAttribute("href") === `#${current.id}`
        ));
    }

    /* ---------- mobile menu ---------- */

    toggle() {
        this.element.classList.contains("is-open") ? this.close() : this.open();
    }

    open() {
        this.element.classList.add("is-open");
        this.toggleTarget.setAttribute("aria-expanded", "true");
        this.toggleTarget.setAttribute("aria-label", "Menü schließen");
    }

    close() {
        if (!this.element.classList.contains("is-open")) return;
        this.element.classList.remove("is-open");
        this.toggleTarget.setAttribute("aria-expanded", "false");
        this.toggleTarget.setAttribute("aria-label", "Menü öffnen");
    }

    onKeydown(event) {
        if (event.key === "Escape") this.close();
    }

    onPointerDown(event) {
        if (!this.element.contains(event.target)) this.close();
    }
}

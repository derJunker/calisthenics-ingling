import { Controller } from "@hotwired/stimulus"

/* ---------------------------------------------------------------
   Kalender

   Seven day boxes on top, one panel below them holding the hour rail
   for the selected day and the equipment multiselect.

   The day boxes carry the forecast only as a border colour — the
   numbers that matter when you pick a time (rain chance, degrees)
   sit on the hour boxes themselves. Those are wide enough to read at
   a glance, so the rail scrolls sideways and the chevrons page it.

   Data privacy is a design constraint, not a footnote:
   - nothing identifying is collected — no name, no e-mail, the
     browser never sends anything but day, hours and equipment ids;
   - the only thing kept locally is a random token per day, so this
     browser can delete its own entry again. It is not an account and
     lives in localStorage, not in a cookie, so nothing is ever sent
     to a third party;
   - the weather comes from our own endpoint, so no visitor ever
     talks to a forecast provider directly.
   --------------------------------------------------------------- */

const CALENDAR_URL = "./api/calendar.php";
const WEATHER_URL = "./api/weather.php";

const STORE_KEY = "calisthenics:kalender";

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WEEKDAYS_LONG = [
    "Sonntag", "Montag", "Dienstag", "Mittwoch",
    "Donnerstag", "Freitag", "Samstag",
];

/* one shape per condition the weather endpoint can report, drawn on a
   24x24 box; the colour tints both the icon and the day box's border */
const CONDITIONS = {
    clear: { color: "#f5c451", label: "sonnig", path: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" },
    cloudy: { color: "#9fb3c8", label: "bewölkt", path: "M7 18h9.5a3.5 3.5 0 0 0 .3-7 5.5 5.5 0 0 0-10.6 1.2A3.2 3.2 0 0 0 7 18" },
    rain: { color: "#4da3ff", label: "Regen", path: "M7 15h9.5a3.5 3.5 0 0 0 .3-7 5.5 5.5 0 0 0-10.6 1.2A3.2 3.2 0 0 0 7 15M9 18v2M13 18v2M17 18v2" },
    storm: { color: "#b98cd8", label: "Gewitter", path: "M7 14h9.5a3.5 3.5 0 0 0 .3-7 5.5 5.5 0 0 0-10.6 1.2A3.2 3.2 0 0 0 7 14M13 15l-3 4h4l-3 4" },
};

const FALLBACK_HOURS = { start: 6, end: 22 };

/* how many equipment names fit into an hour box before the rest is
   folded into a "+2" */
const GEAR_SHOWN = 2;

/* the hour the rail opens on when the selected day is not today */
const DEFAULT_HOUR = 16;

/* how often an open tab re-reads the counts while the section is on
   screen — somebody who leaves the page open all evening should not
   see the numbers from when they arrived */
const POLL_INTERVAL = 120_000;

/* how many placeholder boxes stand in for the rail until the first
   response arrives */
const SKELETON_HOURS = 6;

const iso = (date) => `${date.getFullYear()}-`
    + `${String(date.getMonth() + 1).padStart(2, "0")}-`
    + `${String(date.getDate()).padStart(2, "0")}`;

const parseISO = (value) => {
    const [y, m, d] = String(value).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
};

const escapeHTML = (value) => String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])
);

const people = (count) => (count === 1 ? "1 Person" : `${count} Personen`);

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default class extends Controller {
    static targets = [
        "days", "hours", "prev", "next", "equipment",
        "dayLabel", "dayWeather", "status", "submit", "remove",
    ]

    async connect() {
        this.hourRange = FALLBACK_HOURS;
        this.equipment = [];
        this.days = [];
        this.weather = new Map();

        this.selectedHours = new Set();
        this.selectedEquipment = new Set();
        this.mine = this.readStore();

        this.selectedDate = iso(new Date());
        this.syncing = false;

        this.renderSkeleton();
        this.setStatus("Daten werden geladen …");

        this.onResize = () => this.updateNav();
        window.addEventListener("resize", this.onResize);

        /* coming back to the tab is the moment stale counts are most
           likely and most visible */
        this.onVisibility = () => {
            if (document.visibilityState === "visible") this.sync();
        };
        document.addEventListener("visibilitychange", this.onVisibility);

        /* the slow poll only runs while the section is actually on
           screen — a tab parked on another part of the page asks for
           nothing */
        this.observer = new IntersectionObserver(([entry]) => {
            entry.isIntersecting ? this.startPoll() : this.stopPoll();
        });
        this.observer.observe(this.element);

        await this.load();

        /* connect() may outlive the element on a hot reload */
        if (!this.element.isConnected) return;

        this.selectedDate = this.days[0].date;

        this.renderEquipment();
        this.render();
        this.revealHour(this.openingHour());
    }

    disconnect() {
        window.removeEventListener("resize", this.onResize);
        document.removeEventListener("visibilitychange", this.onVisibility);
        this.observer?.disconnect();
        this.stopPoll();
    }

    /* ---------- data ---------- */

    async load() {
        const [calendar, weather] = await Promise.all([
            this.fetchJSON(CALENDAR_URL),
            this.fetchJSON(WEATHER_URL),
        ]);

        if (calendar?.days) {
            this.hourRange = calendar.hours || FALLBACK_HOURS;
            this.equipment = calendar.equipment || [];
            this.days = calendar.days || [];
        }

        /* the calendar's own day list is the source of truth for which
           seven days exist — weather only decorates them */
        if (!this.days.length) this.days = this.emptyWeek();

        (weather?.days || []).forEach((day) => this.weather.set(day.date, day));

        this.setStatus(calendar?.days ? "" : "Termine sind gerade nicht erreichbar.");
    }

    emptyWeek() {
        const today = new Date();

        return Array.from({ length: 7 }, (_, i) => {
            const day = new Date(today);
            day.setDate(today.getDate() + i);
            return { date: iso(day), slots: [] };
        });
    }

    /* an error response still carries a readable reason ("die Stunde
       ist voll", "zu viele Änderungen") — hand it back so submit()
       can show it instead of a generic failure */
    async fetchJSON(url, options) {
        try {
            const response = await fetch(url, options);
            const data = await response.json();

            if (!response.ok) return data?.error ? data : null;
            return data;
        } catch {
            return null;
        }
    }

    get day() {
        return this.days.find((day) => day.date === this.selectedDate) || { date: this.selectedDate, slots: [] };
    }

    slot(hour) {
        return this.day.slots.find((slot) => slot.hour === hour);
    }

    hourWeather(hour) {
        return this.weather.get(this.selectedDate)?.hours?.find((entry) => entry.hour === hour);
    }

    label(id) {
        return this.equipment.find((item) => item.id === id);
    }

    /* ---------- own entries (localStorage, deletable) ---------- */

    readStore() {
        try {
            const stored = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
            const today = iso(new Date());

            /* drop what has passed — the browser keeps no history either */
            return Object.fromEntries(
                Object.entries(stored).filter(([date]) => date >= today)
            );
        } catch {
            return {};
        }
    }

    writeStore() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(this.mine));
        } catch {
            /* private mode: the entry still went out, it just can't be
               deleted from this browser afterwards */
        }
    }

    token() {
        const buffer = new Uint8Array(16);
        crypto.getRandomValues(buffer);
        return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    /* ---------- rendering ---------- */

    /* the panel would otherwise sit empty between page load and the
       first response — placeholders of the right size hold the layout
       still and say "something is coming" without a spinner */
    renderSkeleton() {
        const bars = (...widths) => widths
            .map((width) => `<span class="cal-bar" style="width: ${width}"></span>`)
            .join("");

        this.daysTarget.innerHTML = Array.from({ length: 7 }, () => `
            <div class="cal-day cal-skeleton" aria-hidden="true">${bars("70%", "90%", "50%")}</div>
        `).join("");

        this.hoursTarget.innerHTML = Array.from({ length: SKELETON_HOURS }, () => `
            <div class="cal-hour cal-skeleton" aria-hidden="true">${bars("55%", "85%", "65%", "95%")}</div>
        `).join("");
    }

    render() {
        this.renderDays();
        this.renderPanelHead();
        this.renderHours();
        this.renderChips();
        this.renderActions();
        this.updateNav();
    }

    renderDays() {
        this.daysTarget.innerHTML = this.days.map((day, index) => {
            const date = parseISO(day.date);
            const weather = this.weather.get(day.date);
            const condition = CONDITIONS[weather?.condition] || CONDITIONS.cloudy;
            const count = day.slots.reduce((sum, slot) => sum + slot.people, 0);
            const selected = day.date === this.selectedDate;

            const name = index === 0 ? "Heute" : WEEKDAYS[date.getDay()];
            const readable = `${WEEKDAYS_LONG[date.getDay()]}, ${date.getDate()}. ${date.getMonth() + 1}.`
                + `, ${condition.label}, ${people(count)} angemeldet`;

            return `
                <button class="cal-day" type="button"
                        aria-pressed="${selected}" aria-label="${escapeHTML(readable)}"
                        style="--weather: ${condition.color}"
                        data-date="${day.date}" data-action="calendar#selectDay">
                    <span class="cal-day-name">${escapeHTML(name)}</span>
                    <span class="cal-day-date">${date.getDate()}.${date.getMonth() + 1}.</span>
                    <span class="cal-day-people${count ? " is-busy" : ""}">${count}</span>
                </button>
            `;
        }).join("");
    }

    renderPanelHead() {
        const date = parseISO(this.selectedDate);
        const weather = this.weather.get(this.selectedDate);
        const condition = CONDITIONS[weather?.condition];

        this.dayLabelTarget.textContent =
            `${WEEKDAYS_LONG[date.getDay()]}, ${date.getDate()}.${date.getMonth() + 1}.`;

        this.dayWeatherTarget.textContent = weather
            ? `${condition?.label ?? ""} · ${weather.tempMin}–${weather.tempMax}°`
            : "";
    }

    renderHours() {
        const { start, end } = this.hourRange;
        const hours = [];

        for (let hour = start; hour <= end; hour++) hours.push(hour);

        this.hoursTarget.innerHTML = hours.map((hour) => {
            const slot = this.slot(hour);
            const count = slot?.people ?? 0;
            const selected = this.selectedHours.has(hour);

            const weather = this.hourWeather(hour);
            const condition = CONDITIONS[weather?.condition];

            const gear = (slot?.equipment || [])
                .map((id) => this.label(id))
                .filter(Boolean)
                .map((item) => item.label);

            const readable = [
                `${hour} Uhr`,
                weather && `${condition?.label ?? ""}, ${weather.rainChance} Prozent Regen, ${weather.temp} Grad`,
                count ? `${people(count)} da` : "noch niemand da",
                gear.length && `dabei: ${gear.join(", ")}`,
            ].filter(Boolean).join(", ");

            return `
                <button class="cal-hour" type="button"
                        aria-pressed="${selected}" aria-label="${escapeHTML(readable)}"
                        style="--weather: ${condition?.color ?? "rgb(255 255 255 / .3)"}"
                        data-hour="${hour}" data-action="calendar#toggleHour">
                    <span class="cal-hour-time">${String(hour).padStart(2, "0")}:00</span>
                    ${this.hourWeatherHTML(weather, condition)}
                    <span class="cal-hour-people${count ? " is-busy" : ""}">
                        ${count ? escapeHTML(people(count)) : "frei"}
                    </span>
                    <span class="cal-hour-gear">${this.gearHTML(gear)}</span>
                </button>
            `;
        }).join("");
    }

    hourWeatherHTML(weather, condition) {
        if (!weather) return `<span class="cal-hour-weather"></span>`;

        return `
            <span class="cal-hour-weather">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="${condition?.path ?? CONDITIONS.cloudy.path}"/>
                </svg>
                <span class="cal-hour-rain">${weather.rainChance}%</span>
                <span class="cal-hour-temp">${weather.temp}°</span>
            </span>
        `;
    }

    /* full names, never abbreviations — a code nobody can decipher is
       worse than no information at all */
    gearHTML(gear) {
        if (!gear.length) return `<i class="cal-gear-none">kein Equipment</i>`;

        const shown = gear.slice(0, GEAR_SHOWN)
            .map((label) => `<i>${escapeHTML(label)}</i>`)
            .join("");

        const rest = gear.length - GEAR_SHOWN;
        return shown + (rest > 0 ? `<i title="${escapeHTML(gear.join(", "))}">+${rest}</i>` : "");
    }

    renderEquipment() {
        this.equipmentTarget.innerHTML = this.equipment.map((item) => `
            <button class="cal-chip" type="button" aria-pressed="false"
                    data-equipment="${escapeHTML(item.id)}" data-action="calendar#toggleEquipment">
                ${escapeHTML(item.label)}
            </button>
        `).join("");
    }

    renderChips() {
        this.equipmentTarget.querySelectorAll("[data-equipment]").forEach((chip) => {
            chip.setAttribute("aria-pressed", String(this.selectedEquipment.has(chip.dataset.equipment)));
        });
    }

    renderActions() {
        const entry = this.mine[this.selectedDate];

        this.submitTarget.disabled = this.selectedHours.size === 0;
        this.submitTarget.textContent = entry ? "Eintrag aktualisieren" : "Eintragen";
        this.removeTarget.hidden = !entry;
    }

    setStatus(message, tone = "") {
        if (!this.hasStatusTarget) return;
        this.statusTarget.textContent = message;
        this.statusTarget.dataset.tone = tone;
    }

    /* ---------- the hour rail ---------- */

    /* one chevron press moves just under a full screen of boxes, so a
       couple of them stay on screen as an anchor */
    page(event) {
        const direction = Number(event.currentTarget.dataset.direction);

        this.hoursTarget.scrollBy({
            left: direction * this.hoursTarget.clientWidth * 0.8,
            behavior: reducedMotion() ? "auto" : "smooth",
        });
    }

    railMoved() {
        this.updateNav();
    }

    updateNav() {
        if (!this.hasPrevTarget) return;

        const rail = this.hoursTarget;
        const max = rail.scrollWidth - rail.clientWidth;
        const scrollable = max > 2;

        [this.prevTarget, this.nextTarget].forEach((button) => {
            button.hidden = !scrollable;
        });

        this.prevTarget.disabled = rail.scrollLeft <= 2;
        this.nextTarget.disabled = rail.scrollLeft >= max - 2;
    }

    /* today opens on the current hour, any other day on the afternoon */
    openingHour() {
        const busiest = this.day.slots.slice().sort((a, b) => b.people - a.people)[0];

        if (this.selectedDate === iso(new Date())) return new Date().getHours();
        return busiest?.hour ?? DEFAULT_HOUR;
    }

    revealHour(hour) {
        const rail = this.hoursTarget;
        const box = rail.querySelector(`[data-hour="${hour}"]`);
        if (!box) return;

        rail.scrollLeft += box.getBoundingClientRect().left - rail.getBoundingClientRect().left;
        this.updateNav();
    }

    /* ---------- interaction ---------- */

    selectDay(event) {
        const date = event.currentTarget.dataset.date;
        if (date === this.selectedDate) return;

        this.selectedDate = date;
        this.restoreSelection();
        this.setStatus("");
        this.render();
        this.revealHour(this.openingHour());
    }

    /* switching days shows what this browser announced for that day */
    restoreSelection() {
        const entry = this.mine[this.selectedDate];

        this.selectedHours = new Set(entry?.hours || []);
        this.selectedEquipment = new Set(entry?.equipment || []);
    }

    toggleHour(event) {
        const hour = Number(event.currentTarget.dataset.hour);

        this.selectedHours.has(hour)
            ? this.selectedHours.delete(hour)
            : this.selectedHours.add(hour);

        event.currentTarget.setAttribute("aria-pressed", String(this.selectedHours.has(hour)));
        this.renderActions();
    }

    toggleEquipment(event) {
        const id = event.currentTarget.dataset.equipment;

        this.selectedEquipment.has(id)
            ? this.selectedEquipment.delete(id)
            : this.selectedEquipment.add(id);

        event.currentTarget.setAttribute("aria-pressed", String(this.selectedEquipment.has(id)));
    }

    /* ---------- submit / delete ---------- */

    async submit() {
        if (!this.selectedHours.size) return;

        const entry = {
            date: this.selectedDate,
            hours: [...this.selectedHours].sort((a, b) => a - b),
            equipment: [...this.selectedEquipment],
            token: this.mine[this.selectedDate]?.token || this.token(),
        };

        this.submitTarget.disabled = true;
        this.setStatus("Wird gesendet …");

        const result = await this.fetchJSON(CALENDAR_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry),
        });

        if (!result?.ok) {
            this.setStatus(result?.error || "Das hat nicht geklappt. Bitte später nochmal.", "error");
            this.renderActions();
            return;
        }

        this.mine[this.selectedDate] = { ...entry, token: result.token || entry.token };
        this.writeStore();

        await this.refresh();
        this.setStatus("Eingetragen. Bis dann!", "ok");
    }

    async remove() {
        const entry = this.mine[this.selectedDate];
        if (!entry) return;

        const result = await this.fetchJSON(CALENDAR_URL, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: entry.date, token: entry.token }),
        });

        if (!result?.ok) {
            this.setStatus("Löschen hat nicht geklappt. Bitte später nochmal.", "error");
            return;
        }

        delete this.mine[this.selectedDate];
        this.writeStore();

        this.selectedHours = new Set();
        this.selectedEquipment = new Set();

        await this.refresh();
        this.setStatus("Eintrag gelöscht.", "ok");
    }

    /* re-rendering replaces the boxes and resets scrollLeft — put the
       rail back where the visitor left it */
    keepRail(update) {
        const left = this.hoursTarget.scrollLeft;
        update();
        this.hoursTarget.scrollLeft = left;
        this.updateNav();
    }

    /* the counts come back from the server after every write — the
       endpoint aggregates, so this browser's own entry is already in
       them and nothing has to be mirrored locally */
    async refresh() {
        const calendar = await this.fetchJSON(CALENDAR_URL);
        if (!calendar?.days?.length) return;

        this.days = calendar.days;
        this.keepRail(() => this.render());
    }

    /* ---------- staying current ---------- */

    /* a tab left open past midnight looks at a week that no longer
       starts today — that needs the whole week again, not just fresh
       counts for days that have moved */
    async sync() {
        if (this.syncing || document.visibilityState === "hidden") return;
        if (!this.days.length) return;

        this.syncing = true;

        try {
            if (this.days[0].date === iso(new Date())) {
                await this.refresh();
            } else {
                await this.reload();
            }
        } finally {
            this.syncing = false;
        }
    }

    /* keeps the visitor on the day they were looking at, as long as it
       is still one of the seven */
    async reload() {
        const previous = this.selectedDate;

        this.weather = new Map();
        this.mine = this.readStore();

        await this.load();
        if (!this.element.isConnected) return;

        this.selectedDate = this.days.some((day) => day.date === previous)
            ? previous
            : this.days[0].date;

        this.restoreSelection();
        this.renderEquipment();
        this.keepRail(() => this.render());
    }

    startPoll() {
        if (this.poll) return;
        this.poll = setInterval(() => this.sync(), POLL_INTERVAL);
    }

    stopPoll() {
        clearInterval(this.poll);
        this.poll = null;
    }
}

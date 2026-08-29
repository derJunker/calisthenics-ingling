import { Controller } from "@hotwired/stimulus";

import { SECTION_ENTER } from "../section-scroll-animation";

/* Schreibt den gerade sichtbaren Abschnitt als data-section auf den
   Hintergrund. Alles Weitere — Bildausschnitt und welche Zeichnungen
   laufen — hängt in drawings.generated.css an diesem einen Attribut.

   Nur auf ENTER hören, nicht auf LEAVE: zwischen zwei Abschnitten gibt
   es ein Stück Weg, auf dem der eine schon weg und der nächste noch
   nicht da ist. Der zuletzt betretene bleibt so lange stehen. */
export default class extends Controller {
    connect() {
        this.sections = Array.from(document.querySelectorAll(".scroll-section[id]"));
        this.onEnter = (event) => {
            this.element.dataset.section = event.detail.section.id;
        };
        this.sections.forEach((s) => s.addEventListener(SECTION_ENTER, this.onEnter));
    }

    disconnect() {
        this.sections.forEach((s) => s.removeEventListener(SECTION_ENTER, this.onEnter));
    }
}

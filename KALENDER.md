# Kalender — what is still missing

The calendar section (`#kalender`) is complete on the front end: markup in
`public/index.html`, behaviour in `src/js/controllers/calendar_controller.js`,
styling in `public/styles/sections/calendar.css`. Beide Endpoints sind
inzwischen echt: der Kalender speichert in `calendar_entries`, das Wetter
holt und cacht den Forecast, der Server ist eingerichtet, der
Equipment-Katalog gefüllt. Was noch fehlt, steht unten — im
Wesentlichen zwei Platzhalter in der Datenschutzerklärung, die
Logfile-Aufbewahrung und der AV-Vertrag.

## 1. Backend — `public/api/calendar.php`

**Erledigt.** Der Endpoint schreibt und liest echt, Tabelle
`calendar_entries` (siehe `schema.sql`): eine Zeile pro angekündigter
Stunde, `(date, hour, token, equipment, created_at)`, unique über
`(date, hour, token)`, Index auf `date` und `(token, date)`. Keine
Spalte identifiziert eine Person.

- **Upsert.** Eine erneute Anmeldung desselben Tokens für denselben Tag
  löscht dessen Zeilen und schreibt neu, beides in einer Transaktion —
  die Zahlen wachsen also nicht mit jeder Änderung mit.
- **Delete.** `DELETE` trifft genau `(date, token)` und antwortet
  `ok: false`, wenn nichts getroffen wurde.
- **Aggregiert gelesen.** `{hour, people, equipment[]}` pro Tag;
  `people` zählt Tokens, das Equipment ist die Vereinigung der Stunde,
  in der Reihenfolge des Katalogs. Einzelzeilen verlassen den Server nie.
- **Missbrauch.** `SLOT_CAP = 30` Personen pro Stunde (geprüft ohne die
  eigenen Zeilen, danach `409`), dazu eine Schreibbremse pro Token in
  APCu (`RATE_LIMIT = 20` pro `RATE_WINDOW = 600 s`, danach `429`) —
  im Arbeitsspeicher, nie in der DB, ohne APCu entfällt sie.
- **Aufräumen.** `sweep()` löscht alles mit `date < heute`, und zwar
  beim ersten Request des Tages: ein indizierter Blick sagt, ob
  überhaupt etwas Vergangenes daliegt — ist nichts da, kostet der
  Aufruf nur diesen Treffer. Läuft auf GET wie auf den Schreibwegen.
- **Timezone.** `date_default_timezone_set('Europe/Berlin')` steht drin.
- **Ohne DB** antworten alle drei Methoden `503` mit Klartext-Grund
  statt einer leeren Woche, die fälschlich „frei" behauptet. Der
  Controller zeigt dann „Termine sind gerade nicht erreichbar."
- `mockDay()` und die Fixtures sind weg.

Geprüft gegen SQLite über HTTP: Upsert ersetzt statt zu addieren,
doppeltes Löschen meldet `ok: false`, unbekannte Equipment-ids und
Uhrzeiten außerhalb `6..22` fallen raus, ein Datum außerhalb der sieben
Tage ergibt `422`, ein Token, das nicht wie eines aussieht (inklusive
SQL-Versuch), bekommt einfach ein neues, der 31. Besucher einer Stunde
`409`, und eine untergeschobene Zeile von vorgestern verschwindet durch
den Sweep.

## 2. Weather — `public/api/weather.php`

**Erledigt.** Der Endpoint holt den Forecast serverseitig bei Open-Meteo
(`hourly=temperature_2m,precipitation_probability,weathercode`,
`daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max`,
`forecast_days=7`, `timezone=Europe/Berlin`, Koordinaten des Parks:
48.546944 / 13.437540) und legt das fertige Antwort-JSON in der Tabelle
`weather_cache` ab — ein Upstream-Call pro Stunde (`CACHE_TTL`) für alle
Besucher zusammen, per Upsert, also auch bei parallelen Requests genau
eine Zeile. Keine Besucher-IP erreicht den Anbieter. WMO-Codes werden auf
`clear | cloudy | rain | storm` gemappt, Unbekanntes fällt auf `cloudy`
zurück. Fällt Open-Meteo aus, geht der letzte gecachte Stand raus (auch
ein abgelaufener), sonst `{"days": []}`; ohne erreichbare DB läuft der
Endpoint ungecacht weiter. Der Controller rendert auch ganz ohne Wetter.

### Zugangsdaten — `public/api/config.php`

`config()` sucht die Zugangsdaten in dieser Reihenfolge: Umgebung
(`DB_DSN`, `DB_USER`, `DB_PASS`) → `../../config.local.php` (oberhalb des
Webroots, beim aktuellen Hoster nicht verfügbar) → `config.local*.php`
neben den Endpoints. Der Normalfall ist also die Datei im Webroot, mit
drei Schichten abgesichert:

1. Sie ist PHP und enthält nur ein `return [...]` — direkt aufgerufen
   führt der Server sie aus und liefert eine leere Antwort, nie den
   Inhalt (nachgeprüft: 0 Bytes Ausgabe).
2. Die `.htaccess` in `public/api/` verbietet den Zugriff zusätzlich;
   für nginx steht die `location`-Regel dort als Kommentar.
3. Der Dateiname darf einen Zufalls-Zusatz tragen —
   `config.local.7f3c9a21.php` wird genauso gefunden. Das ist die
   Versicherung für den einen Fall, in dem 1. und 2. nichts nützen:
   PHP steigt aus und `.php` geht im Klartext raus. Dann muss der Name
   erst geraten werden.

`db()` gibt die geteilte `PDO`-Verbindung zurück oder `null`, wenn nichts
hinterlegt oder die DB nicht erreichbar ist — Aufrufer müssen `null`
abfangen, damit eine kaputte DB weder die Seite mitreißt noch per
Exception die Zugangsdaten ausgibt. `calendar.php` nutzt dieselben zwei
Funktionen, sobald es echt wird.

Einrichten: **erledigt** — Zugangsdatei angelegt, `schema.sql`
eingespielt, der Direktaufruf der Config geprüft. Lokal liegt keine
`config.local*.php`, hier antworten die Endpoints deshalb `503`.

## 3. Frontend — `src/js/controllers/calendar_controller.js`

- [x] **Re-fetch statt optimistischem Merge.** `submit()` und `remove()`
      holen nach einer erfolgreichen Antwort die Woche neu (`refresh()`,
      innerhalb von `keepRail()`); `applyLocally()`/`contribute()` sind
      weg. `fetchJSON()` reicht jetzt auch den Fehlertext einer
      abgelehnten Antwort durch, damit „die Stunde ist voll" und „zu
      viele Änderungen" sichtbar werden statt einer Allgemeinfloskel.
- [x] **Staleness.** `sync()` läuft bei `visibilitychange` (nur wenn der
      Tab sichtbar wird) und alle `POLL_INTERVAL = 120 s`, solange die
      Sektion per `IntersectionObserver` auf dem Schirm ist — sonst
      fragt der Tab gar nichts. Ist der erste Tag der Woche nicht mehr
      heute (Tab über Mitternacht offen), lädt `reload()` die ganze
      Woche neu statt nur die Zahlen und hält dabei den gewählten Tag,
      solange er noch zu den sieben gehört. `load()` setzt den
      gewählten Tag nicht mehr selbst.
- [x] **Equipment catalogue.** Ringe, Parallettes, Gummibänder, Chalk,
      Gewichte. Alte ids (`rope`, `mat`) fallen beim Lesen wie beim
      Schreiben durch den Katalogfilter, Altbestand stört also nicht.
- [x] **Skeleton.** `renderSkeleton()` stellt vor der ersten Antwort
      sieben Tages- und sechs Stundenkästen in Originalgröße hin
      (`.cal-skeleton`, `.cal-bar`, Puls-Animation, unter
      `prefers-reduced-motion` ohne Animation) — das Layout springt
      nicht mehr, wenn die Daten landen.

## 4. DSGVO / legal

The data model is already built to need no consent banner: no name, no e-mail,
no IP, no cookie — the only client-side state is a random per-day token in
`localStorage`, which exists solely so a browser can delete its own entry
(Art. 17) and is therefore technically necessary. What is left is outside the
code:

- [x] **`public/impressum.html`** steht (Name, Anschrift, E-Mail,
      §18 Abs. 1 MStV), aus dem Footer verlinkt.
- [ ] **`public/datenschutz.html`** steht mit elf Abschnitten, es fehlen
      noch zwei Platzhalter: der Serverstandort (Zeile 225) und das
      Datum unter „Stand:" (Zeile 306). Ein Wetter-Abschnitt ist
      bewusst nicht drin — der Forecast wird serverseitig geholt und
      gecacht, kein Besucher spricht mit dem Anbieter.
- [x] **Retention.** Erledigt im Endpoint (`sweep()`, siehe §1) — der
      erste Request nach Mitternacht räumt auf. Für den Fall, dass die
      Seite tagelang niemand besucht, liegt `api/cleanup.php` daneben:
      per Cron (`php cleanup.php`) oder von Hand aufrufbar, löscht
      zusätzlich alles mit `created_at` älter als sieben Tage.
- [ ] **Server logs.** The web server's access log holds IPs by default.
      Shorten the retention or anonymise the last octet; note the choice in the
      Datenschutzerklärung.
- [ ] **AV-Vertrag** with the hoster.

## 5. Verification

- Automatisierte Tests sind bewusst keine geplant.
- [ ] Die Sektion einmal bei 360×640 ansehen: fünf Chips sollten ohne
      das Eigenscrollen von `.cal-chips` passen, und die Skelett-Kästen
      sollten genauso hoch sein wie die echten.

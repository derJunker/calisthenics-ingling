# Kalender — what is still missing

The calendar section (`#kalender`) is complete on the front end: markup in
`public/index.html`, behaviour in `src/js/controllers/calendar_controller.js`,
styling in `public/styles/sections/calendar.css`. Both endpoints it talks to
are **mocks** — they answer in the right shape, but nothing is stored and no
real forecast is fetched. Everything below is what turning that into the real
thing still needs.

## 1. Backend — `public/api/calendar.php`

Currently: `read()` fabricates bookings from the day of the year (`mockDay()`),
`POST` validates and throws the result away, `DELETE` always answers `ok`.

- [ ] **Storage.** One row per announced hour, e.g.
      `(id, date DATE, hour TINYINT, token CHAR(32), equipment JSON/…)`. No
      column that identifies a person — see §4. Index on `date` (read path) and
      on `(token, date)` (delete path).
- [ ] **Upsert instead of insert.** `announce()` gets a `token`; re-submitting
      the same day from the same browser must *replace* that browser's rows for
      the day, not add to them. Without this the counts inflate every time
      somebody changes their mind. The frontend already sends the stored token
      back and labels the button "Eintrag aktualisieren" in that case.
- [ ] **Real delete.** `DELETE` must remove exactly the rows carrying that
      `(date, token)` pair and report `ok: false` when nothing matched, so the
      UI can stop claiming success.
- [ ] **Aggregate on read.** Hand out `{hour, people, equipment[]}` per day, as
      the mock does — never the individual rows. The equipment list per hour is
      the distinct union, so a single visitor can't be picked out of it.
- [ ] **Abuse limit.** Nothing stops one browser from minting new tokens and
      inflating a slot. A per-slot cap (say 30 people/hour) plus a short-lived
      per-token submit limit keeps this in check without storing an IP. If a
      rate limit per origin is needed, keep it in memory (APCu/Redis with a
      minutes-long TTL), never in the database.
- [ ] **Timezone.** Both endpoints use PHP's default TZ while the browser uses
      the visitor's local date. On a server running UTC the seven-day window
      can be off by a day in the evening. Add
      `date_default_timezone_set('Europe/Berlin');` to both files.
- [ ] Drop `mockDay()` and the `MOCK_PATTERN` fixtures once the real read path
      is in.

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

Einrichten:

- [ ] `cp config.local.php.example "config.local.$(openssl rand -hex 4).php"`
      und ausfüllen.
- [ ] `schema.sql` einspielen (`mysql -u USER -p DBNAME < schema.sql`).
- [ ] Einmal `https://…/api/config.local.<zufall>.php` aufrufen: muss 403
      liefern (Apache mit .htaccess) oder eine leere Seite (PHP läuft) —
      auf keinen Fall den Dateiinhalt.
- [ ] Falls SQLite statt MySQL: die `.sqlite`-Datei nicht im Webroot
      ablegen, die würde ausgeliefert.

## 3. Frontend — `src/js/controllers/calendar_controller.js`

- [ ] **Re-fetch instead of the optimistic merge.** `applyLocally()` /
      `contribute()` mirror your own submission into the local data because the
      mock forgets it. Once the backend persists, replace that with a `GET`
      after a successful `POST`/`DELETE` (keeping `keepRail()` so the rail does
      not jump). The merge helpers can then go.
- [ ] **Staleness.** Data is fetched once on `connect()`. Somebody who leaves
      the page open all evening sees yesterday's counts. Re-fetch when the tab
      becomes visible again (`visibilitychange`), and possibly on a slow poll
      while the section is on screen.
- [ ] **Equipment catalogue.** `EQUIPMENT` in `calendar.php` holds six
      placeholders. Fill in the real items; `label` is shown everywhere, so keep
      each one short enough to still read inside an hour box.
- [ ] Optional polish: a skeleton/empty state for the moment between page load
      and the first response (right now the panel is briefly empty apart from
      the "Daten werden geladen …" status line).

## 4. DSGVO / legal

The data model is already built to need no consent banner: no name, no e-mail,
no IP, no cookie — the only client-side state is a random per-day token in
`localStorage`, which exists solely so a browser can delete its own entry
(Art. 17) and is therefore technically necessary. What is left is outside the
code:

- [ ] **`public/datenschutz.html` and `public/impressum.html` do not exist.**
      Both are linked from the footer and from the calendar panel, so those
      links are currently dead. Impressum is required (§5 DDG), the
      Datenschutzerklärung must describe the calendar entries, the retention
      period, the weather call and the hoster.
- [ ] **Retention.** A daily job (cron or a probabilistic sweep on read) that
      deletes every row whose `date` is in the past. Without it the table
      slowly becomes a movement history, which is exactly what the design
      avoids.
- [ ] **Server logs.** The web server's access log holds IPs by default.
      Shorten the retention or anonymise the last octet; note the choice in the
      Datenschutzerklärung.
- [ ] **AV-Vertrag** with the hoster, and — if the weather provider is called
      per request rather than from the cache — a line about it in the
      Datenschutzerklärung.

## 5. Verification

- [ ] No automated tests exist for any of this. Worth having once the backend
      is real: the date-window validation in `announce()`, the upsert/delete
      semantics, and the aggregation.
- [ ] Re-check the section at 360×640 after the equipment catalogue grows — the
      chip list scrolls inside itself (`.cal-chips`), but a very long list makes
      that scroll area the main way to reach the last items.

# Kalender — what is still missing

The calendar section (`#kalender`) is complete on the front end: markup in
`public/index.html`, behaviour in `src/js/controllers/calendar_controller.js`,
styling in `public/styles/sections/calendar.css`. Beide Endpoints sind
inzwischen echt: der Kalender speichert in `calendar_entries`, das Wetter
holt und cacht den Forecast. Was noch fehlt, steht unten — im
Wesentlichen das Einrichten auf dem Server, der Equipment-Katalog und
die beiden Rechtstexte.

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
- **Aufräumen.** `sweep()` löscht bei im Schnitt jedem 20. GET alles mit
  `date < heute` (`RETENTION_CHANCE`).
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

Einrichten:

- [ ] `cp config.local.php.example "config.local.$(openssl rand -hex 4).php"`
      und ausfüllen.
- [ ] `schema.sql` einspielen (`mysql -u USER -p DBNAME < schema.sql`) —
      enthält jetzt `weather_cache` **und** `calendar_entries`.
- [ ] Einmal `https://…/api/config.local.<zufall>.php` aufrufen: muss 403
      liefern (Apache mit .htaccess) oder eine leere Seite (PHP läuft) —
      auf keinen Fall den Dateiinhalt.
- [ ] Falls SQLite statt MySQL: die `.sqlite`-Datei nicht im Webroot
      ablegen, die würde ausgeliefert.

## 3. Frontend — `src/js/controllers/calendar_controller.js`

- [x] **Re-fetch statt optimistischem Merge.** `submit()` und `remove()`
      holen nach einer erfolgreichen Antwort die Woche neu (`refresh()`,
      innerhalb von `keepRail()`); `applyLocally()`/`contribute()` sind
      weg. `fetchJSON()` reicht jetzt auch den Fehlertext einer
      abgelehnten Antwort durch, damit „die Stunde ist voll" und „zu
      viele Änderungen" sichtbar werden statt einer Allgemeinfloskel.
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
- [x] **Retention.** Erledigt im Endpoint (`sweep()`, siehe §1). Ein
      zusätzlicher Cron (`DELETE FROM calendar_entries WHERE date <
      CURDATE()`) schadet nicht, ist aber nicht nötig.
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

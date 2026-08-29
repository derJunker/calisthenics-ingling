# calisthenics-ingling

Statische Info-Seite zum Calisthenics Park Ingling (Passau) mit einem
PHP-Backend für Terminkalender und Wetter. Gehostet bei Hostinger (Apache).

## Aufbau

- `public/` ist das Document Root. `index.html` ist die einzige Seite der
  Website, dazu die beiden Rechtstexte `impressum.html` und
  `datenschutz.html`.
- `public/api/` enthält die Endpoints `calendar.php` und `weather.php`;
  Zugangsdaten liegen in `config.local.php` (nicht im Repo) und werden
  über `public/api/.htaccess` gegen direkten Abruf gesperrt.
- Frontend-JS: Quelle in `src/js/` (Stimulus + GSAP), gebündelt nach
  `public/js/out.js` — die Bundle-Datei ist gitignoriert.
- Details zum Kalender stehen in `KALENDER.md`.

## Befehle

```
npm run build            # Zeichnungen + esbuild src/js/main.js -> public/js/out.js
npm run build:drawings   # nur src/drawings.json -> CSS und index.html
npm run build:js         # nur das JS-Bundle
npm run dev              # build + php -S localhost:8000 -t public
```

## Zeichnungen auf dem Hintergrund

Die handgezeichneten Figuren sind Sprite-Sheets (ein WebP, alle Frames
nebeneinander), die im Hintergrund-SVG laufen. Gesteuert wird alles über
**`src/drawings.json`** — das ist die einzige Datei, die von Hand
angefasst wird:

- `sprites` — je Zeichnung Dateiname, Frame-Anzahl, Tempo, Laufrichtung
  (`pingpong` läuft hin und zurück, `loop` nur vorwärts) und `invert`
  für weiße statt schwarzer Striche.
- `sections` — je Abschnitt (der `id` im HTML) der Bildausschnitt und
  welche Zeichnungen dort laufen.

```
npm run build:drawings   # JSON -> drawings.generated.css + Block in index.html
npm run build            # dasselbe, danach das JS-Bundle
```

`public/styles/drawings.generated.css` und der Bereich zwischen
`<!-- drawings:begin -->` und `<!-- drawings:end -->` in `index.html`
sind **generiert** — Änderungen dort überschreibt der nächste Lauf.

### Koordinaten

Alle Zahlen sind Einheiten der viewBox des Hintergrund-SVG, `0 0 1600
1200` — dieselbe Fläche wie `teaser.jpeg`. Eine Zeichnung bei `x: 645,
y: 393` sitzt also immer an derselben Stelle des Fotos, egal wie groß
das Fenster ist. `height` ist die Höhe der Figur in denselben
Einheiten, die Breite ergibt sich aus dem Seitenverhältnis des Sheets.

### Bildausschnitt

Foto und Zeichnungen hängen gemeinsam in `.bg-stage`, verschoben wird
also beides zusammen. `focus` holt den Punkt `x|y` in die Bildmitte und
zoomt um `zoom`; `focusMobile` gilt bis `mobileBreakpoint` (768px), wo
das Foto seitlich stark beschnitten wird.

Verschieben geht nur so weit, wie der Zoom Luft lässt: das Foto füllt
den Bildschirm per `slice`, also füllt immer mindestens eine Achse
genau aus, und bei `zoom: 1` ist die Mitte die einzig sichere Lage. Der
Build klemmt zu weite Werte ab und sagt beim Laufen, welcher Bereich
erlaubt gewesen wäre. Wer schieben will, muss also zoomen.

Welcher Abschnitt gerade gilt, schreibt `background_controller.js` als
`data-section` auf `.bg-cnt`; die CSS hängt komplett an diesem einen
Attribut. Ohne JavaScript bleibt der erste Abschnitt stehen.

### Eine neue Zeichnung

Die Sheets entstehen in `~/Dokumente/cali-pdfs` aus den
reMarkable-Dateien:

```
python extract_drawings.py --doc <ordner> --out <name>_svg
python make_sprite.py <name> --src <name>_svg --install
```

`--install` legt das WebP in `public/assets/`; `make_sprite.py` druckt
zum Schluss den fertigen JSON-Schnipsel für `src/drawings.json`.

## Routing

Ausgeliefert wird statisch aus `public/`. Verlinkt wird mit
`.html`-Endung (`impressum.html`, `datenschutz.html`) — das funktioniert
auf Apache wie im lokalen `php -S` ohne Zusatzkonfiguration.
`public/.htaccess` mappt zusätzlich `/impressum` und `/datenschutz` auf
die jeweilige Datei; ohne diese Regel liefert `php -S` unter der
endungslosen URL stumm die Startseite aus.

## Rechtstexte

- **Livegang: September 2026.** Dieses Datum steht als „Stand" in
  Abschnitt 11 von `datenschutz.html`.
- Serverstandort (Abschnitt 6): Frankfurt am Main, Deutschland. Keine
  Platzhalter mehr offen.
- Beide Seiten kommen ohne JavaScript und ohne jede externe Ressource
  aus (keine Fonts, keine CDN, keine Karten) — Abschnitt 2 der
  Datenschutzerklärung sagt genau das zu. Diese Zusage bei Änderungen
  nicht brechen.
- Die Rechtstexte sind wörtlich vorgegeben und werden nicht
  umformuliert. Weicht die Implementierung vom Text ab, wird der Text
  angepasst — nicht umgekehrt.

## Aufräumen der Kalendereinträge

Die Datenschutzerklärung sagt zu: Einträge werden gelöscht, sobald der
Tag vergangen ist, spätestens nach sieben Tagen.

Das erledigt `sweep()` in `calendar.php` — **beim ersten Request des
Tages**, auf GET wie auf den Schreibwegen. Kein Zufall, kein Marker: ein
indizierter Blick (`idx_date`) prüft, ob überhaupt etwas Vergangenes
daliegt; ist nichts da, kostet der Aufruf genau diesen Treffer und
schreibt nichts. Ein Cron ist damit nicht nötig, solange die Seite
überhaupt besucht wird.

`public/api/cleanup.php` ist der Notnagel für den Fall, dass tagelang
niemand vorbeikommt. Er löscht zusätzlich alles mit `created_at` älter
als sieben Tage. Zwei Wege:

```
php /home/USER/domains/DOMAIN/public_html/api/cleanup.php   # CLI, auch von Hand
https://…/api/cleanup.php?key=<cleanup_key>                 # für externe Pinger
```

Der HTTP-Weg ist geschlossen (404), solange `cleanup_key` in der
`config.local*.php` leer ist — und leer ist der Normalfall. Er wird nur
gebraucht, wenn ein externer Dienst (cron-job.org o. ä.) die URL
anpingen soll; über die CLI wird der Schlüssel nie geprüft.

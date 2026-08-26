-- Einmalig einspielen:  mysql -u USER -p DBNAME < schema.sql

-- Der geteilte Wetter-Cache: eine Zeile pro Cache-Schlüssel, die das
-- fertige Antwort-JSON hält. Alle Besucher lesen dieselbe Zeile, und
-- neu geholt wird nur, wenn `fetched_at` älter als eine Stunde ist.
CREATE TABLE IF NOT EXISTS weather_cache (
    cache_key   VARCHAR(64)  NOT NULL PRIMARY KEY,
    payload     MEDIUMTEXT   NOT NULL,
    fetched_at  DATETIME     NOT NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- SQLite-Variante, falls kein MySQL zur Verfügung steht:
-- CREATE TABLE IF NOT EXISTS weather_cache (
--     cache_key  TEXT NOT NULL PRIMARY KEY,
--     payload    TEXT NOT NULL,
--     fetched_at TEXT NOT NULL
-- );

-- Der Kalender: eine Zeile pro angekündigter Stunde. Bewusst ohne
-- jede Spalte, die eine Person identifiziert — kein Name, keine
-- E-Mail, keine IP, kein User-Agent. `token` ist eine Zufallszahl,
-- die der Browser selbst erzeugt und in seinem localStorage behält;
-- der Server benutzt sie für genau eine Sache: diesem Browser das
-- Löschen des eigenen Eintrags zu erlauben (Art. 17 DSGVO).
--
-- `equipment` hält die Auswahl derselben Anmeldung als JSON-Liste von
-- ids; sie wiederholt sich pro Stunde, was das Aggregieren beim Lesen
-- trivial macht.
--
-- Vergangene Zeilen werden gelöscht (sweep() in calendar.php beim
-- ersten Request des Tages, auf Wunsch `cleanup.php` per Cron) — der Datenbestand soll
-- nie zu einer Bewegungshistorie anwachsen.
CREATE TABLE IF NOT EXISTS calendar_entries (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    date       DATE         NOT NULL,
    hour       TINYINT      NOT NULL,
    token      CHAR(32)     NOT NULL,
    equipment  TEXT         NOT NULL,
    created_at DATETIME     NOT NULL,
    UNIQUE KEY uniq_slot (date, hour, token),
    KEY idx_date (date),
    KEY idx_token_date (token, date)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- SQLite-Variante:
-- CREATE TABLE IF NOT EXISTS calendar_entries (
--     id         INTEGER PRIMARY KEY AUTOINCREMENT,
--     date       TEXT NOT NULL,
--     hour       INTEGER NOT NULL,
--     token      TEXT NOT NULL,
--     equipment  TEXT NOT NULL,
--     created_at TEXT NOT NULL,
--     UNIQUE (date, hour, token)
-- );
-- CREATE INDEX IF NOT EXISTS idx_date ON calendar_entries (date);
-- CREATE INDEX IF NOT EXISTS idx_token_date ON calendar_entries (token, date);

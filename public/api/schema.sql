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

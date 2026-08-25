<?php
/* ---------------------------------------------------------------
   Wetter — Open-Meteo

   Liefert für die nächsten 7 Tage je eine Tages-Zusammenfassung (das
   tönt den Rahmen der Tages-Box) und einen Eintrag pro Stunde, den
   die Stunden-Boxen zeigen.

   Der Forecast wird serverseitig geholt und in der Datenbank
   zwischengespeichert (Tabelle `weather_cache`, siehe schema.sql):
   ein Upstream-Call pro Stunde für alle Besucher zusammen. Das hält uns aus jedem Rate-Limit heraus und —
   wichtiger — es erreicht keine Besucher-IP jemals den Anbieter
   (DSGVO). Fällt Open-Meteo aus, wird der letzte bekannte Stand
   weitergereicht; gibt es auch den nicht, kommt eine leere Liste —
   der Controller rendert den Kalender auch ganz ohne Wetter. Ohne
   erreichbare DB läuft der Endpoint weiter, dann eben ungecacht.
   --------------------------------------------------------------- */

declare(strict_types=1);

require __DIR__ . '/config.php';

date_default_timezone_set('Europe/Berlin');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=300');

const DAYS = 7;
const HOUR_START = 6;
const HOUR_END = 22;

/* Der Park bei Ingling hinter dem Staudamm. */
const LATITUDE = 48.546944;
const LONGITUDE = 13.437540;

const TIMEZONE = 'Europe/Berlin';

/* ein Upstream-Call pro Stunde, geteilt von allen Besuchern */
const CACHE_TTL = 3600;
const CACHE_KEY = 'forecast';

const UPSTREAM = 'https://api.open-meteo.com/v1/forecast';
const UPSTREAM_TIMEOUT = 6;

/* ---------- WMO-Codes -> die vier ids, die das Frontend zeichnen kann ---------- */

/** alles Unbekannte fällt auf `cloudy` zurück, damit kein Icon bricht */
function condition(?int $code): string
{
    return match (true) {
        $code === null => 'cloudy',
        $code <= 1 => 'clear',                    /* klar, überwiegend klar */
        $code <= 3 => 'cloudy',                   /* teils bewölkt, bedeckt */
        $code >= 95 => 'storm',                   /* Gewitter, mit/ohne Hagel */
        $code >= 51 && $code <= 86 => 'rain',     /* Niesel, Regen, Schnee, Schauer */
        default => 'cloudy',                      /* Nebel (45/48) und der Rest */
    };
}

/* ---------- Cache (Tabelle `weather_cache`) ---------- */

/**
 * Der zuletzt gespeicherte Stand. `$fresh` verlangt zusätzlich, dass
 * er jünger als CACHE_TTL ist — ohne das Flag wird auch ein alter
 * Stand zurückgegeben, was die Notfall-Antwort ist, wenn Open-Meteo
 * gerade nicht antwortet.
 */
function cached(bool $fresh): ?array
{
    $pdo = db();
    if (!$pdo) return null;

    try {
        $statement = $pdo->prepare(
            'SELECT payload, fetched_at FROM weather_cache WHERE cache_key = ?'
        );
        $statement->execute([CACHE_KEY]);
        $row = $statement->fetch();
    } catch (Throwable) {
        error_log('weather_cache: Lesen fehlgeschlagen');
        return null;
    }

    if (!$row) return null;

    $age = time() - (int) strtotime((string) $row['fetched_at']);
    if ($fresh && $age >= CACHE_TTL) return null;

    $data = json_decode((string) $row['payload'], true);

    return is_array($data) ? $data : null;
}

function store(array $payload): void
{
    $pdo = db();
    if (!$pdo) return;

    /* eine Zeile pro Schlüssel — der Upsert hält es dabei, auch wenn
       zwei Requests gleichzeitig ablaufen. Der Zeitstempel kommt aus
       PHP statt aus NOW()/CURRENT_TIMESTAMP, damit dieselbe Abfrage
       auf MySQL wie auf SQLite läuft. */
    $sqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';

    $sql = 'INSERT INTO weather_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?) '
        . ($sqlite
            ? 'ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at'
            : 'ON DUPLICATE KEY UPDATE payload = VALUES(payload), fetched_at = VALUES(fetched_at)');

    try {
        $pdo->prepare($sql)->execute([
            CACHE_KEY,
            json_encode($payload, JSON_THROW_ON_ERROR),
            date('Y-m-d H:i:s'),
        ]);
    } catch (Throwable) {
        error_log('weather_cache: Schreiben fehlgeschlagen');
    }
}

/* ---------- Upstream ---------- */

function fetchForecast(): ?array
{
    $url = UPSTREAM . '?' . http_build_query([
        'latitude' => LATITUDE,
        'longitude' => LONGITUDE,
        'hourly' => 'temperature_2m,precipitation_probability,weathercode',
        'daily' => 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
        'timezone' => TIMEZONE,
        'forecast_days' => DAYS,
    ]);

    $raw = request($url);
    if ($raw === null) return null;

    $data = json_decode($raw, true);

    return isset($data['daily']['time'], $data['hourly']['time']) ? $data : null;
}

function request(string $url): ?string
{
    if (function_exists('curl_init')) {
        $handle = curl_init($url);
        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => UPSTREAM_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => UPSTREAM_TIMEOUT,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $raw = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        curl_close($handle);

        return is_string($raw) && $status === 200 ? $raw : null;
    }

    $context = stream_context_create(['http' => [
        'timeout' => UPSTREAM_TIMEOUT,
        'ignore_errors' => true,
    ]]);
    $raw = @file_get_contents($url, false, $context);

    return is_string($raw) ? $raw : null;
}

/* ---------- Antwort-Modell ---------- */

/** die stündlichen Reihen nach Datum gruppieren, auf HOUR_START..HOUR_END beschnitten */
function hoursByDate(array $hourly): array
{
    $byDate = [];

    foreach ($hourly['time'] as $index => $stamp) {
        [$date, $time] = array_pad(explode('T', (string) $stamp, 2), 2, '00:00');
        $hour = (int) substr($time, 0, 2);

        if ($hour < HOUR_START || $hour > HOUR_END) continue;

        $byDate[$date][] = [
            'hour' => $hour,
            'condition' => condition(isset($hourly['weathercode'][$index]) ? (int) $hourly['weathercode'][$index] : null),
            'rainChance' => (int) round((float) ($hourly['precipitation_probability'][$index] ?? 0)),
            'temp' => (int) round((float) ($hourly['temperature_2m'][$index] ?? 0)),
        ];
    }

    return $byDate;
}

function days(array $forecast): array
{
    $daily = $forecast['daily'];
    $hours = hoursByDate($forecast['hourly']);
    $days = [];

    foreach ($daily['time'] as $index => $date) {
        $days[] = [
            'date' => (string) $date,
            'condition' => condition(isset($daily['weathercode'][$index]) ? (int) $daily['weathercode'][$index] : null),
            'rainChance' => (int) round((float) ($daily['precipitation_probability_max'][$index] ?? 0)),
            'tempMax' => (int) round((float) ($daily['temperature_2m_max'][$index] ?? 0)),
            'tempMin' => (int) round((float) ($daily['temperature_2m_min'][$index] ?? 0)),
            'hours' => $hours[(string) $date] ?? [],
        ];
    }

    return $days;
}

/* ---------- Auslieferung ---------- */

$payload = cached(true);

if ($payload === null) {
    $forecast = fetchForecast();

    if ($forecast !== null) {
        $payload = ['days' => days($forecast)];
        store($payload);
    } else {
        /* Anbieter weg: lieber ein Stand von gestern als gar keiner */
        $payload = cached(false) ?? ['days' => []];
    }
}

echo json_encode($payload, JSON_THROW_ON_ERROR);

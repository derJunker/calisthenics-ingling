<?php
/* ---------------------------------------------------------------
   Kalender

     GET                       -> { equipment, hours, days }
     POST   {date,hours,equipment,token}
                               -> { ok, token }
     DELETE {date,token}       -> { ok }

   Gespeichert wird in `calendar_entries` (siehe schema.sql), eine
   Zeile pro angekündigter Stunde. Der Datenschutz ist hier kein
   Nachsatz, sondern das Datenmodell:

   - nichts Identifizierendes wird abgelegt: kein Name, keine
     E-Mail, keine IP, kein User-Agent — und der Access-Log des
     Webservers gehört entsprechend kurz gehalten;
   - `token` ist eine Zufalls-id, die der Browser selbst erzeugt und
     in seinem localStorage behält. Der Server sieht nur eine opake
     Zeichenkette und benutzt sie für genau eine Sache: diesem
     Browser das Löschen des eigenen Eintrags zu erlauben (Art. 17).
     Sie ist kein Login und wird nirgends geloggt;
   - gelesen wird ausschließlich aggregiert — Anzahl und Equipment
     pro Stunde, nie die Zeilen einzelner Besucher;
   - vergangene Tage verschwinden von selbst (RETENTION_CHANCE),
     damit der Bestand nie zu einer Bewegungshistorie anwächst.

   Ohne erreichbare Datenbank liefert GET eine leere Woche und die
   Schreibwege einen sauberen Fehler — die Seite bleibt heil.
   --------------------------------------------------------------- */

declare(strict_types=1);

require __DIR__ . '/config.php';

date_default_timezone_set('Europe/Berlin');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const DAYS = 7;
const HOUR_START = 6;
const HOUR_END = 22;

/* Obergrenze pro Stunde. Sie schützt die Anzeige davor, dass jemand
   mit frisch erfundenen Tokens einen Slot aufbläst — mehr Leute als
   das passen ohnehin nicht sinnvoll an die Stangen. */
const SLOT_CAP = 30;

/* Kurzlebige Schreibbremse pro Token: höchstens so viele Schreib-
   Requests in diesem Fenster. Liegt im Arbeitsspeicher (APCu), nie
   in der Datenbank — ein Zähler pro Token ist nichts, was einen Tag
   überdauern sollte. Fehlt APCu, entfällt die Bremse; die
   Slot-Obergrenze greift weiter. */
const RATE_LIMIT = 20;
const RATE_WINDOW = 600;

/* Aufräumen der vergangenen Tage: im Schnitt bei jedem 20. Request.
   Ein Cron darf dasselbe gerne zusätzlich tun. */
const RETENTION_CHANCE = 20;

/* Der Katalog. `label` erscheint überall, wo das Gerät auftaucht —
   kurz genug halten, dass es in einer Stunden-Box noch lesbar ist. */
const EQUIPMENT = [
    ['id' => 'rings',       'label' => 'Ringe'],
    ['id' => 'bands',       'label' => 'Bänder'],
    ['id' => 'parallettes', 'label' => 'Parallettes'],
    ['id' => 'rope',        'label' => 'Springseil'],
    ['id' => 'chalk',       'label' => 'Chalk'],
    ['id' => 'mat',         'label' => 'Matte'],
];

/* ---------- Hilfen ---------- */

function body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);

    return is_array($data) ? $data : [];
}

function fail(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message], JSON_THROW_ON_ERROR);
    exit;
}

/** die sieben Tage des Fensters, heute zuerst */
function window(): array
{
    $today = new DateTimeImmutable('today');
    $dates = [];

    for ($i = 0; $i < DAYS; $i++) {
        $dates[] = $today->modify("+$i day")->format('Y-m-d');
    }

    return $dates;
}

/**
 * Das Token so, wie es der Browser geschickt hat — oder null, wenn es
 * fehlt oder nicht wie eines aussieht. Die Form wird geprüft, damit
 * niemand über dieses Feld etwas anderes in die Spalte legt.
 */
function token(array $data): ?string
{
    $token = (string) ($data['token'] ?? '');

    return preg_match('/^[0-9a-f]{32}$/', $token) === 1 ? $token : null;
}

/**
 * Schreibbremse pro Token. Reines Gedächtnis: APCu mit Ablaufzeit,
 * kein Eintrag überlebt RATE_WINDOW. Ohne APCu immer true.
 */
function withinRateLimit(string $token): bool
{
    if (!function_exists('apcu_inc')) return true;

    $key = 'cal:' . hash('sha256', $token);
    $count = apcu_inc($key, 1, $ok, RATE_WINDOW);

    /* fällt der Zähler aus, wird durchgelassen — die Bremse darf
       niemanden aussperren, den sie nicht zählen kann */
    return !is_int($count) || $count <= RATE_LIMIT;
}

/** vergangene Tage wegräumen, gelegentlich und beiläufig */
function sweep(PDO $pdo): void
{
    if (random_int(1, RETENTION_CHANCE) !== 1) return;

    try {
        $pdo->prepare('DELETE FROM calendar_entries WHERE date < ?')
            ->execute([(new DateTimeImmutable('today'))->format('Y-m-d')]);
    } catch (Throwable) {
        error_log('calendar_entries: Aufräumen fehlgeschlagen');
    }
}

/* ---------- Lesen ---------- */

/**
 * Die Zeilen des Fensters, verdichtet zu `{hour, people, equipment[]}`
 * pro Tag. `people` zählt Tokens, das Equipment ist die Vereinigung
 * über alle Anmeldungen der Stunde — aus beidem lässt sich niemand
 * einzeln herauslesen.
 */
function aggregate(array $rows, array $dates): array
{
    $slots = [];

    foreach ($rows as $row) {
        $date = (string) $row['date'];
        $hour = (int) $row['hour'];

        $slot = &$slots[$date][$hour];
        $slot ??= ['hour' => $hour, 'people' => 0, 'equipment' => []];
        $slot['people']++;

        foreach ((array) json_decode((string) $row['equipment'], true) as $id) {
            $slot['equipment'][(string) $id] = true;
        }

        unset($slot);
    }

    $days = [];

    foreach ($dates as $date) {
        $hours = $slots[$date] ?? [];
        ksort($hours);

        $days[] = [
            'date' => $date,
            'slots' => array_values(array_map(static fn(array $slot): array => [
                'hour' => $slot['hour'],
                'people' => $slot['people'],
                'equipment' => array_values(array_intersect(
                    array_column(EQUIPMENT, 'id'),
                    array_keys($slot['equipment'])
                )),
            ], $hours)),
        ];
    }

    return $days;
}

function read(): array
{
    $dates = window();
    $pdo = db();

    if (!$pdo) fail(503, 'Termine sind gerade nicht erreichbar.');

    sweep($pdo);

    try {
        $statement = $pdo->prepare(
            'SELECT date, hour, equipment FROM calendar_entries WHERE date BETWEEN ? AND ?'
        );
        $statement->execute([$dates[0], $dates[DAYS - 1]]);
        $rows = $statement->fetchAll();
    } catch (Throwable) {
        /* lieber ehrlich nicht erreichbar als eine Woche, die
           fälschlich überall "frei" behauptet */
        error_log('calendar_entries: Lesen fehlgeschlagen');
        fail(503, 'Termine sind gerade nicht erreichbar.');
    }

    return [
        'equipment' => EQUIPMENT,
        'hours' => ['start' => HOUR_START, 'end' => HOUR_END],
        'days' => aggregate($rows, $dates),
    ];
}

/* ---------- Schreiben ---------- */

/**
 * Eine Anmeldung ersetzt die vorherige desselben Browsers für diesen
 * Tag — löschen und neu schreiben in einer Transaktion. Ohne das
 * würden die Zahlen bei jeder Änderung mitwachsen.
 */
function announce(array $data): array
{
    $date = (string) ($data['date'] ?? '');
    $dates = window();

    if (!in_array($date, $dates, true)) {
        fail(422, 'Datum liegt außerhalb der nächsten 7 Tage.');
    }

    $hours = array_values(array_unique(array_filter(
        array_map('intval', (array) ($data['hours'] ?? [])),
        static fn(int $hour): bool => $hour >= HOUR_START && $hour <= HOUR_END
    )));

    if (!$hours) fail(422, 'Bitte mindestens eine Uhrzeit wählen.');

    $equipment = array_values(array_intersect(
        array_column(EQUIPMENT, 'id'),
        array_map('strval', (array) ($data['equipment'] ?? []))
    ));

    /* ein unbekanntes oder fehlendes Token bekommt ein neues — der
       Browser merkt es sich und kann damit später löschen */
    $token = token($data) ?? bin2hex(random_bytes(16));

    if (!withinRateLimit($token)) {
        fail(429, 'Zu viele Änderungen. Bitte kurz warten.');
    }

    $pdo = db();
    if (!$pdo) fail(503, 'Termine sind gerade nicht erreichbar.');

    try {
        $pdo->beginTransaction();

        $pdo->prepare('DELETE FROM calendar_entries WHERE date = ? AND token = ?')
            ->execute([$date, $token]);

        /* die Obergrenze zählt, was ohne diesen Browser schon da ist */
        $counter = $pdo->prepare(
            'SELECT COUNT(*) FROM calendar_entries WHERE date = ? AND hour = ?'
        );

        $insert = $pdo->prepare(
            'INSERT INTO calendar_entries (date, hour, token, equipment, created_at)'
            . ' VALUES (?, ?, ?, ?, ?)'
        );

        $now = date('Y-m-d H:i:s');
        $payload = json_encode($equipment, JSON_THROW_ON_ERROR);

        foreach ($hours as $hour) {
            $counter->execute([$date, $hour]);

            if ((int) $counter->fetchColumn() >= SLOT_CAP) {
                $pdo->rollBack();
                fail(409, sprintf('%d Uhr ist schon voll. Bitte eine andere Zeit wählen.', $hour));
            }

            $insert->execute([$date, $hour, $token, $payload, $now]);
        }

        $pdo->commit();
    } catch (Throwable) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('calendar_entries: Schreiben fehlgeschlagen');
        fail(503, 'Das hat nicht geklappt. Bitte später nochmal.');
    }

    return ['ok' => true, 'token' => $token, 'date' => $date];
}

/** löscht genau die Zeilen dieses Browsers an diesem Tag */
function withdraw(array $data): array
{
    $date = (string) ($data['date'] ?? '');
    $token = token($data);

    if ($token === null || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        fail(422, 'Eintrag nicht gefunden.');
    }

    $pdo = db();
    if (!$pdo) fail(503, 'Termine sind gerade nicht erreichbar.');

    if (!withinRateLimit($token)) {
        fail(429, 'Zu viele Änderungen. Bitte kurz warten.');
    }

    try {
        $statement = $pdo->prepare('DELETE FROM calendar_entries WHERE date = ? AND token = ?');
        $statement->execute([$date, $token]);
    } catch (Throwable) {
        error_log('calendar_entries: Löschen fehlgeschlagen');
        fail(503, 'Das hat nicht geklappt. Bitte später nochmal.');
    }

    /* nichts getroffen: der Eintrag war schon weg (oder der Tag
       vorbei) — das darf die Oberfläche nicht als Erfolg zeigen */
    return ['ok' => $statement->rowCount() > 0];
}

/* ---------- Routing ---------- */

switch ($_SERVER['REQUEST_METHOD'] ?? 'GET') {
    case 'GET':
        echo json_encode(read(), JSON_THROW_ON_ERROR);
        break;

    case 'POST':
        echo json_encode(announce(body()), JSON_THROW_ON_ERROR);
        break;

    case 'DELETE':
        echo json_encode(withdraw(body()), JSON_THROW_ON_ERROR);
        break;

    default:
        header('Allow: GET, POST, DELETE');
        fail(405, 'Methode nicht erlaubt.');
}

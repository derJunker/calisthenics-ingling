<?php
/* ---------------------------------------------------------------
   Kalender — MOCK

   Stand-in for the real backend. It answers in the shape the
   frontend expects, but nothing is persisted: a POST is acknowledged
   and forgotten, a DELETE always succeeds. The controller merges its
   own submission into the view optimistically, so the UI already
   behaves like the finished thing.

     GET                       -> { equipment, hours, days }
     POST   {date,hours,equipment,token}
                               -> { ok, token }
     DELETE {date,token}       -> { ok }

   What the real implementation has to keep (DSGVO):
   - store nothing that identifies a person: no name, no e-mail, no
     IP, no user agent, and keep the web server's access log short;
   - `token` is a random id the browser generates and keeps in its own
     localStorage. The server only ever sees an opaque string and uses
     it for one thing: letting that browser delete its own entry
     (Art. 17). It is not a login and must not be logged;
   - delete every entry once its day has passed (a cron / a DELETE
     ... WHERE date < CURDATE()), so the data set never grows a
     history of who was where;
   - aggregate on read: hand out counts and equipment per hour, never
     rows per visitor.
   --------------------------------------------------------------- */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const DAYS = 7;
const HOUR_START = 6;
const HOUR_END = 22;

/* The catalogue. Add your items here — `label` is shown wherever the
   item appears, so keep it short enough to still read inside an hour
   box. */
const EQUIPMENT = [
    ['id' => 'rings',       'label' => 'Ringe'],
    ['id' => 'bands',       'label' => 'Bänder'],
    ['id' => 'parallettes', 'label' => 'Parallettes'],
    ['id' => 'rope',        'label' => 'Springseil'],
    ['id' => 'chalk',       'label' => 'Chalk'],
    ['id' => 'mat',         'label' => 'Matte'],
];

/* ---------- mock read model ---------- */

/** deterministic pseudo-booking so the grid is not empty while developing */
function mockDay(DateTimeImmutable $day, int $index): array
{
    $slots = [];
    $seed = (int) $day->format('z');

    foreach ([17, 18, 19] as $offset => $hour) {
        $people = ($seed + $index * 3 + $offset) % 4;
        if ($people === 0) continue;

        $slots[] = [
            'hour' => $hour,
            'people' => $people,
            'equipment' => array_values(array_slice(
                array_column(EQUIPMENT, 'id'),
                ($seed + $offset) % 4,
                $people > 2 ? 2 : 1
            )),
        ];
    }

    return ['date' => $day->format('Y-m-d'), 'slots' => $slots];
}

function read(): array
{
    $today = new DateTimeImmutable('today');
    $days = [];

    for ($i = 0; $i < DAYS; $i++) {
        $days[] = mockDay($today->modify("+$i day"), $i);
    }

    return [
        'equipment' => EQUIPMENT,
        'hours' => ['start' => HOUR_START, 'end' => HOUR_END],
        'days' => $days,
    ];
}

/* ---------- write (mock: validated, then dropped) ---------- */

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

function announce(array $data): array
{
    $date = (string) ($data['date'] ?? '');
    $hours = array_map('intval', (array) ($data['hours'] ?? []));
    $equipment = array_values(array_intersect(
        array_map('strval', (array) ($data['equipment'] ?? [])),
        array_column(EQUIPMENT, 'id')
    ));

    $day = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
    $today = new DateTimeImmutable('today');

    if (!$day || $day < $today || $day > $today->modify('+' . (DAYS - 1) . ' day')) {
        fail(422, 'Datum liegt außerhalb der nächsten 7 Tage.');
    }

    $hours = array_values(array_unique(array_filter(
        $hours,
        static fn(int $hour): bool => $hour >= HOUR_START && $hour <= HOUR_END
    )));

    if (!$hours) fail(422, 'Bitte mindestens eine Uhrzeit wählen.');

    /* the real endpoint would upsert (date, hour, token, equipment) here */
    return [
        'ok' => true,
        'token' => (string) ($data['token'] ?? '') ?: bin2hex(random_bytes(16)),
        'date' => $date,
        'hours' => $hours,
        'equipment' => $equipment,
    ];
}

/* ---------- routing ---------- */

switch ($_SERVER['REQUEST_METHOD'] ?? 'GET') {
    case 'GET':
        echo json_encode(read(), JSON_THROW_ON_ERROR);
        break;

    case 'POST':
        echo json_encode(announce(body()), JSON_THROW_ON_ERROR);
        break;

    case 'DELETE':
        /* the real endpoint deletes every row carrying this token */
        echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
        break;

    default:
        header('Allow: GET, POST, DELETE');
        fail(405, 'Methode nicht erlaubt.');
}

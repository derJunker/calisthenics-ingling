<?php
/* ---------------------------------------------------------------
   Aufräumen — der Cron zum Sweep in calendar.php

   calendar.php räumt selbst auf: der erste Request nach Mitternacht
   löscht die vergangenen Tage (sweep()). Das genügt, solange die
   Seite überhaupt besucht wird — genau darauf darf man sich aber
   nicht verlassen: bleibt der Verkehr aus, bleiben auch die Zeilen
   liegen. Die Datenschutzerklärung sagt Löschung zu, sobald der Tag
   vergangen ist, spätestens nach sieben Tagen. Dieses Skript hält
   die Zusage unabhängig von Besuchern ein.

   Ohne Cron ist es der manuelle Notnagel — einmal von Hand
   aufgerufen, wenn die Seite länger stillstand.

   Gelöscht wird zweierlei:

     1. alles vor dem heutigen Tag                  (`date < heute`)
     2. alles, was älter als sieben Tage ist   (`created_at`-Kappe) —
        die Versicherung gegen Zeilen, deren `date` in der Zukunft
        liegt und die deshalb an Regel 1 vorbeirutschen.

   Aufruf, zwei Wege:

     CLI (bevorzugt, im hPanel als Cron-Job)
         php /home/USER/domains/DOMAIN/public_html/api/cleanup.php

     HTTP (wenn nur ein URL-Pinger zur Verfügung steht)
         https://.../api/cleanup.php?key=<cleanup_key>

     Der HTTP-Weg ist zu, solange `cleanup_key` in der
     config.local*.php leer ist — dann antwortet das Skript 404.

   Empfohlene Frequenz: einmal täglich kurz nach Mitternacht
   (Europe/Berlin), z. B. `5 0 * * *`. Öfter schadet nicht.
   --------------------------------------------------------------- */

declare(strict_types=1);

require __DIR__ . '/config.php';

date_default_timezone_set('Europe/Berlin');

/* Aufbewahrung als harte Obergrenze — dieselben sieben Tage, die
   Abschnitt 4 der Datenschutzerklärung nennt. */
const MAX_AGE_DAYS = 7;

const CLI = PHP_SAPI === 'cli';

/**
 * Über HTTP nur mit passendem Schlüssel. Ohne hinterlegten Schlüssel
 * existiert der Endpoint nach außen schlicht nicht — 404 statt 403,
 * damit ein Scanner nicht erfährt, dass hier etwas zu erraten wäre.
 */
function authorize(): void
{
    if (CLI) return;

    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');

    $expected = (string) (config()['cleanup_key'] ?? '');
    $given = (string) ($_GET['key'] ?? '');

    if ($expected === '' || !hash_equals($expected, $given)) {
        http_response_code(404);
        echo "Not Found\n";
        exit;
    }
}

function done(string $message, int $status = 0): never
{
    echo $message, "\n";
    if (!CLI && $status !== 0) http_response_code(500);
    exit($status);
}

authorize();

$pdo = db();
if (!$pdo) done('Aufraeumen: keine Datenbankverbindung.', 1);

$today = (new DateTimeImmutable('today'))->format('Y-m-d');
$cutoff = (new DateTimeImmutable('today'))
    ->sub(new DateInterval('P' . MAX_AGE_DAYS . 'D'))
    ->format('Y-m-d H:i:s');

try {
    $past = $pdo->prepare('DELETE FROM calendar_entries WHERE date < ?');
    $past->execute([$today]);

    $stale = $pdo->prepare('DELETE FROM calendar_entries WHERE created_at < ?');
    $stale->execute([$cutoff]);
} catch (Throwable) {
    /* Details bleiben im Log des Servers, nicht in der Antwort */
    error_log('calendar_entries: Aufraeumen fehlgeschlagen');
    done('Aufraeumen: fehlgeschlagen, siehe error_log.', 1);
}

done(sprintf(
    'Aufraeumen ok: %d Zeile(n) vor %s, %d Zeile(n) aelter als %d Tage.',
    $past->rowCount(),
    $today,
    $stale->rowCount(),
    MAX_AGE_DAYS
));

<?php
/* ---------------------------------------------------------------
   Konfiguration & Datenbank

   Die Zugangsdaten stehen NICHT hier drin, sondern in einer
   `config.local*.php`, die nicht im Git liegt. Gesucht wird sie in
   dieser Reihenfolge:

     1. Umgebungsvariablen (DB_DSN, DB_USER, DB_PASS)
     2. ../../config.local.php      ← oberhalb des Webroots, falls
                                      der Hoster das hergibt
     3. ./config.local*.php         ← daneben, im Webroot

   Variante 3 ist hier der Normalfall. Sie ist aus drei Gründen
   trotzdem in Ordnung:

   - Die Datei ist PHP und besteht nur aus einem `return [...]`.
     Ruft jemand sie direkt auf, führt der Server sie aus und
     bekommt eine leere Antwort — nie den Inhalt.
   - Die .htaccess in diesem Verzeichnis verbietet den Zugriff
     zusätzlich (Apache; für nginx steht die Regel dort als
     Kommentar).
   - Der Dateiname darf einen beliebigen Zufalls-Zusatz tragen:
     `config.local.7f3c9a21.php` wird genauso gefunden wie
     `config.local.php`. Das ist die Versicherung gegen den einen
     Fall, in dem die ersten beiden Schichten nichts nützen — wenn
     PHP aussteigt und .php-Dateien im Klartext ausgeliefert werden.
     Dann muss der Name erst geraten werden.

   Zum Einrichten: `config.local.php.example` kopieren, ausfüllen,
   idealerweise mit Zufalls-Zusatz im Namen.
   --------------------------------------------------------------- */

declare(strict_types=1);

function config(): array
{
    static $config = null;

    if ($config !== null) return $config;

    $config = ['dsn' => '', 'user' => '', 'pass' => ''];

    $candidates = array_merge(
        [__DIR__ . '/../../config.local.php'],
        glob(__DIR__ . '/config.local*.php') ?: []
    );

    foreach ($candidates as $path) {
        /* die Vorlage ist keine Konfiguration */
        if (!is_readable($path) || str_ends_with($path, '.example')) continue;

        $local = require $path;
        if (is_array($local)) $config = $local + $config;
        break;
    }

    /* die Umgebung schlägt die Datei — praktisch für Deployments,
       die Secrets injizieren statt sie abzulegen */
    foreach (['dsn' => 'DB_DSN', 'user' => 'DB_USER', 'pass' => 'DB_PASS'] as $key => $name) {
        $value = getenv($name);
        if (is_string($value) && $value !== '') $config[$key] = $value;
    }

    return $config;
}

/**
 * Die geteilte Verbindung — oder null, wenn keine Zugangsdaten
 * hinterlegt sind bzw. die DB nicht erreichbar ist. Aufrufer müssen
 * mit null umgehen können: eine kaputte DB darf die Seite nicht
 * mitreißen, und eine PDO-Exception würde die Zugangsdaten im
 * Klartext in die Ausgabe schreiben.
 */
function db(): ?PDO
{
    static $pdo = null;
    static $tried = false;

    if ($tried) return $pdo;
    $tried = true;

    $config = config();
    if ($config['dsn'] === '') return null;

    try {
        $pdo = new PDO($config['dsn'], $config['user'], $config['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (Throwable) {
        error_log('DB-Verbindung fehlgeschlagen');
        $pdo = null;
    }

    return $pdo;
}

<?php
/**
 * MTBank payment checker — run every 2 minutes via crontab:
 *
 *   */2 * * * * /usr/bin/php /path/to/server/cron/mtbank_check_payments.php >> /path/to/server/logs/mtbank_cron.log 2>&1
 *
 * Calls Node internal endpoint which:
 *  1) pulls incoming payments from MTBank Open API (via AvTunProxy)
 *  2) if purpose contains invoice number (EW-YYYYMM-…) and amount matches → marks invoice paid
 *
 * Required .env (server/.env):
 *   MTBANK_API_KEY, MTBANK_CONSENT_ID, MTBANK_CRON_SECRET (or CRM_API_KEY)
 *   PUBLIC_APP_URL or INTERNAL_API_URL — base URL of the Node API
 */

declare(strict_types=1);

$root = dirname(__DIR__);
$envFile = $root . '/.env';
$env = load_env($envFile);

$baseUrl = rtrim(
    $env['INTERNAL_API_URL']
        ?? $env['PUBLIC_APP_URL']
        ?? $env['APP_URL']
        ?? 'http://127.0.0.1:' . ($env['PORT'] ?? '5000'),
    '/'
);
$secret = $env['MTBANK_CRON_SECRET'] ?? $env['CRM_API_KEY'] ?? '';
if ($secret === '') {
    fwrite(STDERR, '[' . date('c') . "] MTBANK_CRON_SECRET / CRM_API_KEY is empty\n");
    exit(1);
}

$url = $baseUrl . '/api/internal/bank/sync?lookbackDays=7';
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Accept: application/json',
        'X-Cron-Secret: ' . $secret,
        'X-Api-Key: ' . $secret,
    ],
    CURLOPT_POSTFIELDS => json_encode(['lookbackDays' => 7], JSON_UNESCAPED_UNICODE),
    CURLOPT_TIMEOUT => 90,
    CURLOPT_CONNECTTIMEOUT => 15,
]);

$body = curl_exec($ch);
$errno = curl_errno($ch);
$error = curl_error($ch);
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$ts = date('c');
if ($errno) {
    fwrite(STDERR, "[$ts] curl error: $error\n");
    exit(2);
}

$data = json_decode((string) $body, true);
$paidCount = is_array($data['paid'] ?? null) ? count($data['paid']) : 0;
$scanned = $data['scanned'] ?? '?';
$ok = !empty($data['ok']);

echo "[$ts] HTTP $status ok=" . ($ok ? '1' : '0')
    . " scanned=$scanned paid=$paidCount"
    . (isset($data['message']) ? ' message=' . $data['message'] : '')
    . (isset($data['error']) ? ' error=' . $data['error'] : '')
    . "\n";

if (!$ok || $status >= 400) {
    if (is_array($data) && !empty($data['skipped'])) {
        echo "  skipped: " . json_encode($data['skipped'], JSON_UNESCAPED_UNICODE) . "\n";
    }
    exit($status >= 400 ? 3 : 0);
}

if ($paidCount > 0) {
    echo '  paid: ' . json_encode($data['paid'], JSON_UNESCAPED_UNICODE) . "\n";
}

exit(0);

/**
 * @return array<string, string>
 */
function load_env(string $path): array
{
    $out = [];
    if (!is_readable($path)) {
        return $out;
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES);
    if ($lines === false) {
        return $out;
    }
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (!str_contains($line, '=')) {
            continue;
        }
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v);
        if (
            (str_starts_with($v, '"') && str_ends_with($v, '"'))
            || (str_starts_with($v, "'") && str_ends_with($v, "'"))
        ) {
            $v = substr($v, 1, -1);
        }
        $out[$k] = $v;
    }
    return $out;
}

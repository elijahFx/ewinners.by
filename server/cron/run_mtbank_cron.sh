#!/usr/bin/env bash
# Optional wrapper if php binary path differs on the host.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec php "$DIR/mtbank_check_payments.php" "$@"

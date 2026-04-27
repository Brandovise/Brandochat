#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

docker compose --env-file .env.demo -f docker-compose.demo.yml down
echo "Demo app containers stopped."

#!/usr/bin/env zsh

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  print -u2 \
    "Docker nebyl nalezen. Nainstaluj a spusť Docker Desktop."

  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  print -u2 \
    "Docker Compose není dostupný."

  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env

  print \
    "Vytvořen soubor .env z .env.example"
fi

print "Spouštím PiCloud..."

docker compose up --build
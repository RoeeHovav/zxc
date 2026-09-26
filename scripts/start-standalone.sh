#!/bin/sh
# Runs the production build (`output: "standalone"`) the same way the Docker image does.
# Usage: npm run build && npm run start:standalone   (PORT / HOSTNAME / DATABASE_URL from the environment)
set -eu
cd "$(dirname "$0")/.."
[ -f .next/standalone/server.js ] || { echo "Run 'npm run build' first." >&2; exit 1; }
# Static assets are not part of the traced output; copy them next to server.js.
rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
exec node .next/standalone/server.js

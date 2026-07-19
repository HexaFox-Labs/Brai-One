#!/bin/sh
set -eu

exec /srv/opt/node-v22.22.3/bin/node \
  /srv/opt/brai-agent-runtime/dist/host-id-pool-cli.bundle.js "$@"

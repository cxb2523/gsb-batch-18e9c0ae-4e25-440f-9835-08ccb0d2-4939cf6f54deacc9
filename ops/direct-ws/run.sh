#!/bin/sh
# Start (or restart) the direct WebSocket container. The Zima's Docker has no build or compose, so Caddy with the Cloudflare plugin is built
# once with the official builder image (see README) and mounted into the stock caddy image.
D=/DATA/AppData/ot-direct
docker rm -f ot-direct >/dev/null 2>&1
docker run -d --name ot-direct --restart unless-stopped -p 8443:443 --env-file "$D/.env" \
  -v "$D/bin/caddy:/usr/bin/caddy:ro" -v "$D/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$D/data:/data" -v "$D/config:/config" caddy:2

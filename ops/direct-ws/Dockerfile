# Caddy with the Cloudflare DNS plugin, built from the official images: it gets (and renews) its HTTPS certificate by adding a record to the
# puffsco.com zone, so no port 80 or 443 has to be reachable from the internet.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Direct WebSocket route

The browser game's connection can go straight to the server at `wss://ws.puffsco.com:4443/ws` instead of through the Cloudflare tunnel
(which drops connections at random). The page (`web/tta-ui.js`) checks this address when it loads and falls back to the tunnel if it
does not answer, so nothing breaks while it is not set up.

Set up, once:

1. DNS: `ws.puffsco.com`, type A, pointing at the home IP, **DNS only** (grey cloud). Done.
2. Router: forward external TCP 4443 to the Zima `192.168.40.134` port 8443. Done.
3. A Cloudflare API token that may edit DNS for puffsco.com only (dashboard, My Profile, API Tokens, Create Token, the "Edit zone DNS"
   template, zone resources: puffsco.com). On the Zima put it in `/DATA/AppData/ot-direct/.env` as one line: `CF_API_TOKEN=...`
   (and `chmod 600` it). It is a secret: it is not in the repository.
4. On the Zima: copy this folder to `/DATA/AppData/ot-direct/`. Its Docker has no build or compose, so build Caddy once with
   `mkdir -p bin && docker run --rm -v "$PWD/bin:/out" caddy:2-builder sh -c "xcaddy build --with github.com/caddy-dns/cloudflare --output /out/caddy"`,
   then run `./run.sh`. Caddy gets and renews the certificate itself.
5. Check: `curl -i https://ws.puffsco.com:4443/__d` answers 204, and a game page load logs `JS| route direct`.

Turn it off for a device: open the game with `?ws=off`. Turn it off for everyone: stop the container (the page falls back to the tunnel
within 4 seconds).
